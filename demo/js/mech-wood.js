/* mech-wood.js: the Hunter gathers fallen branches in the forest and carries them home to the wood pile.
   The Keeper's stokes now depend on what comes back on the Hunter's back. */
(function () {
  'use strict';
  const HH = window.HH;

  /* ---------- tuning: everything to adjust by feel lives here ---------- */
  const TUNE = {
    bundles: 9,              // bundles lying in the forest at any time
    carryMax: 5,             // most the Hunter can carry
    reach: 1.2,              // pick-up distance
    deliverReach: 2.2,       // distance from the pile at which carried wood flies off the Hunter's back
    squashS: 0.12,           // anticipation: the bundle crouches before it hops
    hopS: 0.46,              // flight from the ground to the Hunter's back
    hopHeight: 1.0,          // arc height of that hop
    windS: 0.13,             // anticipation: the carried log lifts before it leaves the back
    flyS: 0.44,              // flight from the back to the pile
    flyGapS: 0.26,           // delay between logs when delivering
    flyHeight: 1.1,
    regrowStagger: 0.35,     // seconds between regrown bundles popping in
    glimmerEvery: 1.3,       // a bundle in sight of the Hunter gives off a little dust this often
    glimmerRange: 5.5,
    promptHeight: 0.95,
    yardLogs: 4,             // logs on the pile outside when the game starts (the bottom row)
    yardMax: 10,             // most the pile outside can hold; it only takes what does not fit on the hearth rack
    yardReach: 2.1,          // distance from that pile at which the Hunter's surplus flies off the pack, and the Keeper can fetch
    armful: 5,               // most logs the Keeper takes from the pile outside in one go
    fetchGapS: 0.09,         // delay between logs hopping from the pile into the Keeper's arms
    fetchFlyS: 0.3,          // flight of one such log
    fetchHeight: 0.55,       // arc height of that hop
    yardPromptHeight: 1.45   // the Keeper's key prompt floats this high over the pile outside
  };

  /* The Keeper's armful: five logs held against the chest. [depth, height, yaw, slide along the log] inside the bundle,
     filled from the chest outwards (bottom row first, then the top row), so one or two logs rest against the body.
     Like the Hunter's pack the logs lie across the body, so positions differ in depth and height, never along x. */
  const ARMS = [[-0.104, 0, 0.04, 0.01], [0, 0, -0.03, -0.01], [0.104, 0, 0.03, 0.012], [-0.052, 0.09, -0.04, -0.01], [0.052, 0.09, 0.03, 0.01]];

  /* Fixed places a bundle can lie: [u along the path, side from -1 to 1 as a share of the half-width].
     Kept off the centre line so wood is beside the path, never in the way. */
  const SPOTS = [
    [18.5, 0.62], [22, -0.6], [25.5, 0.55], [29, -0.7], [33, 0.64], [36.5, -0.52], [40, 0.7], [43.5, -0.62],
    [47, 0.5], [51, -0.68], [54.5, 0.62], [58, -0.55], [61.5, 0.66], [65, -0.6], [68.5, 0.55], [72, -0.64]
  ];
  const START = [0, 2, 4, 5, 7, 9, 10, 12, 14];   // indices into SPOTS that hold a bundle at the start

  const CSS = [
    '.hhw-wood { display: inline-flex; align-items: center; gap: 7px; }',
    '.hhw-wood svg { color: var(--ink-soft); opacity: 0.85; flex: none; }',
    '.hhw-pips { display: inline-flex; gap: 4px; }',
    '.hhw-pip { box-sizing: border-box; width: 14px; height: 9px; border-radius: 3px; border: 1.5px solid var(--panel-line); background: rgba(244, 230, 200, 0.06); transition: background 0.18s ease, border-color 0.18s ease, box-shadow 0.18s ease; }',
    '.hhw-pip.is-on { background: var(--ember); border-color: var(--ember); box-shadow: 0 0 9px rgba(255, 180, 74, 0.55); }',
    '.hhw-pip.is-pop { animation: hhw-pop 0.34s cubic-bezier(0.3, 1.7, 0.5, 1); }',
    '.hhw-wood.is-full .hhw-pip.is-on { background: var(--ember-deep); border-color: var(--ember-deep); }',
    '@keyframes hhw-pop { 0% { transform: scale(0.4, 1.9); } 55% { transform: scale(1.25, 0.7); } 100% { transform: scale(1); } }',
    '@media (prefers-reduced-motion: reduce) { .hhw-pip.is-pop { animation: none; } }'
  ].join('\n');

  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
  const ease = t => t * t * (3 - 2 * t);

  const M = {
    name: 'wood',
    bundles: [], carried: null, pips: [], pipsEl: null, prompt: null, flyLogs: [],
    yard: 0, arms: 0, armsG: null, fetch: null, kDeliver: null, yardPrompt: null, yardPromptK: 0,
    carry: 0, deliver: null, regrow: [], gathered: 0, dbg: false, wobble: 0, promptK: 0, promptAt: null, glimmer: 0,

    init(ctx) {
      const { T, W, scene, hunter, keeper } = ctx;
      ctx.TUNE.autoRestock = false;
      M.T = T; M.ctx = ctx;

      // spots that would trap a walker (trees, rocks) are dropped up front
      M.spots = SPOTS.map((s, i) => {
        const hw = W.hw(s[0]), p = HH.uv2w(s[0], W.pathV(s[0]) + s[1] * hw);
        const probe = { x: p.x, z: p.z };
        W.collide(probe, 0.5);
        return { i, x: p.x, z: p.z, ok: Math.hypot(probe.x - p.x, probe.z - p.z) < 0.02, taken: false };
      }).filter(s => s.ok);
      const starts = START.map(i => M.spots.find(s => s.i === i)).filter(Boolean);
      // top up from the rest if a start spot was dropped
      for (const s of M.spots) { if (starts.length >= TUNE.bundles) break; if (starts.indexOf(s) < 0) starts.push(s); }
      starts.slice(0, TUNE.bundles).forEach(s => M.addBundle(ctx, s, 1));

      // what the Hunter carries: up to five logs strapped across the pack, three below and two on top
      M.carried = new T.Group();
      M.carried.position.set(0, 0.0, -0.5);
      // each log lies across the back (left to right); its place in the bundle is in depth and height, so the ends show a 3 + 2 stack
      // [depth, height, yaw, slide along the log]; filled from the Hunter's back outwards, bottom row first, then the top row,
      // so a single log rests against the back and never hangs in the air behind it
      [[0.15, 0.115, 0.05, 0.015], [0, 0.115, 0.03, 0.02], [-0.15, 0.115, -0.04, -0.025], [0.075, 0.245, 0.04, -0.02], [-0.075, 0.245, -0.03, 0.025]].forEach((p, i) => {
        const log = W.makeLog(0.52, 0.072);
        log.position.set(p[3], p[1], p[0]);
        log.rotation.set(0, Math.PI / 2 + p[2], 0);
        log.userData.home = log.position.clone();
        log.userData.pop = 1;
        log.visible = false;
        M.carried.add(log);
      });
      hunter.torso.add(M.carried);

      // what the Keeper carries: a small bundle held against the chest, between the hands
      M.armsG = new T.Group();
      M.armsG.position.set(0, 0.2, 0.33);
      ARMS.forEach(p => {
        const log = W.makeLog(0.36, 0.05);
        log.position.set(p[3], p[1], p[0]);
        log.rotation.set(0, Math.PI / 2 + p[2], 0);
        log.userData.home = log.position.clone();
        log.userData.pop = 1;
        log.visible = false;
        M.armsG.add(log);
      });
      keeper.torso.add(M.armsG);

      // the pile outside starts with its bottom row
      ctx.st.yard = M.yard = clamp(TUNE.yardLogs, 0, TUNE.yardMax);
      W.yardLogs.forEach((l, i) => { l.visible = i < M.yard; l.userData.pop = 1; });

      // flying logs for deliveries and for the Keeper's armful
      for (let i = 0; i < 12; i++) {
        const l = W.makeLog(0.52, 0.072);
        l.visible = false; scene.add(l); M.flyLogs.push(l);
      }

      M.prompt = HH.makePrompt('↵');
      M.prompt.visible = false;
      scene.add(M.prompt);
      M.yardPrompt = HH.makePrompt('E');       // the Keeper's key (a tap mark on a phone, made by the same helper)
      M.yardPrompt.visible = false;
      scene.add(M.yardPrompt);
      // interface: one pip per log the Hunter can carry
      const style = document.createElement('style');
      style.textContent = CSS;
      document.head.appendChild(style);
      const who = document.getElementById('lantern').parentElement.querySelector('.who');
      const el = document.createElement('span');
      el.className = 'hhw-wood';
      el.setAttribute('role', 'img');
      el.innerHTML = '<svg viewBox="0 0 22 14" width="19" height="12" aria-hidden="true"><rect x="1" y="6" width="14" height="6.4" rx="3.2" fill="currentColor"/><circle cx="14.6" cy="9.2" r="2.6" fill="#2a1d15"/><rect x="6" y="0.8" width="14" height="6.4" rx="3.2" fill="currentColor" opacity="0.7"/></svg><span class="hhw-pips"></span>';
      const pipsEl = el.querySelector('.hhw-pips');
      for (let i = 0; i < TUNE.carryMax; i++) { const p = document.createElement('i'); p.className = 'hhw-pip'; pipsEl.appendChild(p); M.pips.push(p); }
      who.parentNode.insertBefore(el, who.nextSibling);
      M.pipsEl = el;
      M.syncHud();
    },

    /* ---------- bundles ---------- */
    addBundle(ctx, spot, grow) {
      const { T, W, scene } = ctx;
      const g = new T.Group();
      const r = HH.rng(spot.i * 977 + 13 + Math.floor(Math.random() * 1000));
      const n = r() < 0.5 ? 3 : 2;
      const layout = n === 3 ? [[-0.085, 0.07], [0.085, 0.07], [0, 0.195]] : [[-0.075, 0.07], [0.085, 0.075]];
      const inner = new T.Group();
      layout.forEach((p, k) => {
        const l = W.makeLog(0.56 + r() * 0.14, 0.062 + r() * 0.016);
        l.position.set(p[0], p[1], (r() - 0.5) * 0.08);
        l.rotation.set(0, (r() - 0.5) * 0.3, (r() - 0.5) * 0.12);
        inner.add(l);
      });
      // a twine band so the bundle reads as something to pick up
      const k = new HH.Kit();
      k.box(0.3, 0.2, 0.04, 0, 0.11, 0.0, HH.col(HH.PAL.tan), { r: 0.015 });
      inner.add(k.build());
      g.add(inner);
      g.position.set(spot.x, 0, spot.z);
      g.rotation.y = r() * 6.283;
      g.scale.setScalar(0.001);
      scene.add(g);
      const b = { g, inner, spot, state: grow ? 'grow' : 'ready', t: grow ? 0 : 1, lift: 0, glim: Math.random() * TUNE.glimmerEvery, fx: 0, fz: 0 };
      spot.taken = true;
      M.bundles.push(b);
      return b;
    },

    backPos(ctx, out) {
      const h = ctx.hunter, f = h.facing;
      return out.set(h.x - Math.sin(f) * 0.42, 0.5, h.z - Math.cos(f) * 0.42);
    },

    syncHud() {
      for (let i = 0; i < M.pips.length; i++) M.pips[i].classList.toggle('is-on', i < M.carry);
      M.pipsEl.classList.toggle('is-full', M.carry >= TUNE.carryMax);
      M.pipsEl.setAttribute('aria-label', 'Wood carried: ' + M.carry + ' of ' + TUNE.carryMax);
      for (let i = 0; i < M.carried.children.length; i++) M.carried.children[i].visible = i < M.carry && M.carried.children[i].userData.pop > 0.02;
    },
    popPip(i) {
      const p = M.pips[i]; if (!p) return;
      p.classList.remove('is-pop'); void p.offsetWidth; p.classList.add('is-pop');
    },
    setCarry(n, pop) {
      const was = M.carry;
      M.carry = clamp(n, 0, TUNE.carryMax);
      for (let i = 0; i < M.carried.children.length; i++) {
        const l = M.carried.children[i];
        if (i < M.carry && i >= was) { l.userData.pop = pop ? 0.001 : 1; l.userData.popT = pop ? 0 : 1; }
      }
      M.syncHud();
      if (pop) for (let i = was; i < M.carry; i++) M.popPip(i);
    },

    update(ctx, dt) {
      const { T, W, hunter, keeper, st } = ctx;
      const H = ctx.input.hunter;
      if (!M.dbg && window.game && window.game.debug) { M.dbg = true; M.attachDebug(ctx); }
      const t = st.time;
      const tmp = M._tmp || (M._tmp = new T.Vector3());

      /* ----- pick up ----- */
      const slotsFree = TUNE.carryMax - M.carry - M.bundles.filter(b => b.state === 'hop').length;
      let near = null, nd = TUNE.reach;
      for (const b of M.bundles) {
        if (b.state !== 'ready') continue;
        const d = Math.hypot(hunter.x - b.spot.x, hunter.z - b.spot.z);
        if (d < nd) { nd = d; near = b; }
      }
      if (near && slotsFree > 0 && H.act && st.started) {
        H.act = false;                       // claimed: the lantern stays down
        near.state = 'squash'; near.t = 0;
        ctx.sparks(near.spot.x, 0.15, near.spot.z, 8, { speed: 0.9, up: 1.2, size: 0.06, life: 0.7 });
      }
      for (const b of M.bundles) {
        const g = b.g;
        if (b.state === 'grow') {
          b.t += dt / 0.4;
          if (b.t > 0) {
            const k = clamp(b.t, 0, 1), s = Math.max(0.001, HH.easeOutBack(k));
            g.scale.set(s, s, s);
            if (b.t >= 1) { b.state = 'ready'; g.scale.setScalar(1); }
          }
        } else if (b.state === 'ready') {
          // lifts a touch and brightens when in reach
          const want = (b === near && slotsFree > 0) ? 1 : 0;
          b.lift = HH.damp(b.lift, want, 12, dt);
          g.position.y = b.lift * 0.05;
          g.scale.setScalar(1 + b.lift * 0.07);
          b.glim -= dt;
          if (b.glim < 0 && Math.hypot(hunter.x - b.spot.x, hunter.z - b.spot.z) < TUNE.glimmerRange) {
            b.glim = TUNE.glimmerEvery * (0.7 + Math.random() * 0.6);
            ctx.sparks(b.spot.x, 0.3, b.spot.z, 1, { speed: 0.15, up: 0.5, size: 0.05, life: 1.4, grav: 0.1 });
          }
        } else if (b.state === 'squash') {
          b.t += dt / TUNE.squashS;
          const k = clamp(b.t, 0, 1), s = ease(k);
          g.scale.set(1 + 0.12 * s, 1 - 0.3 * s, 1 + 0.12 * s);
          g.position.y = 0;
          if (b.t >= 1) {
            b.state = 'hop'; b.t = 0; b.fx = g.position.x; b.fz = g.position.z;
            ctx.sparks(g.position.x, 0.12, g.position.z, 10, { speed: 1.2, up: 1.4, size: 0.06, life: 0.8 });
          }
        } else if (b.state === 'hop') {
          b.t += dt / TUNE.hopS;
          const k = clamp(b.t, 0, 1);
          M.backPos(ctx, tmp);
          const e = HH.easeOutCubic(k);
          g.position.set(HH.lerp(b.fx, tmp.x, e), HH.lerp(0, tmp.y, e) + Math.sin(k * Math.PI) * TUNE.hopHeight, HH.lerp(b.fz, tmp.z, e));
          g.rotation.y += dt * 9;
          const stretch = 1 + Math.sin(k * Math.PI) * 0.18;
          const s = HH.lerp(1, 0.55, ease(k));
          g.scale.set(s / Math.sqrt(stretch), s * stretch, s / Math.sqrt(stretch));
          if (b.t >= 1) {
            // lands on the back with a pop
            b.state = 'gone';
            g.visible = false;
            M.gathered++;
            b.spot.taken = false;
            M.setCarry(M.carry + 1, true);
            M.wobble = 1;
            hunter.hop = Math.max(hunter.hop, 0.8);
            ctx.sparks(tmp.x, tmp.y + 0.15, tmp.z, 12, { speed: 1.3, up: 1.7, size: 0.06, life: 0.8 });
            ctx.pulseHud();
          }
        }
      }
      M.bundles = M.bundles.filter(b => {
        if (b.state === 'gone') { ctx.scene.remove(b.g); return false; }
        return true;
      });

      /* ----- carried logs pop in and the pack jiggles on a landing ----- */
      M.wobble = Math.max(0, M.wobble - dt * 2.4);
      for (let i = 0; i < M.carried.children.length; i++) {
        const l = M.carried.children[i];
        if (l.userData.winding) continue;
        if (i < M.carry) {
          if (l.userData.pop < 1) { l.userData.popT = (l.userData.popT || 0) + dt / 0.34; l.userData.pop = HH.easeOutBack(clamp(l.userData.popT, 0, 1)); }
          const s = Math.max(0.001, l.userData.pop);
          l.scale.setScalar(s);
          l.visible = true;
          l.position.y = l.userData.home.y + Math.sin(t * 40 + i * 2) * 0.012 * M.wobble;
        } else l.visible = false;
      }
      M.carried.rotation.x = Math.sin(M.wobble * 9) * 0.09 * M.wobble;

      /* ----- deliver ----- */
      // the hearth rack always comes first; the pile outside takes only what cannot fit indoors
      const dPile = Math.hypot(hunter.x - W.pile.x, hunter.z - W.pile.z);
      const dYard = Math.hypot(hunter.x - W.yardPile.x, hunter.z - W.yardPile.z);
      // room on the rack for the Hunter's wood: what the Keeper is already carrying in keeps its place,
      // so her armful always fits and she is never left holding logs
      const room = M.rackRoom(ctx) - M.arms - M.airborne('arms') - (M.fetch ? M.fetch.left : 0);
      const D = M.deliver;
      if (!D && M.carry > 0 && st.started) {
        if (dPile < TUNE.deliverReach && room > 0 && st.throwT < 0) {
          M.deliver = { phase: 'wind', t: 0, idx: M.carry - 1, dest: 'rack' };
          M.carried.children[M.deliver.idx].userData.winding = true;
        } else if (dYard < TUNE.yardReach && M.carry - Math.max(0, room) > 0 && M.yardRoom() > 0) {
          // wood that does not fit on the rack goes to the pile outside; wood that fits nowhere stays on the Hunter's back
          M.deliver = { phase: 'wind', t: 0, idx: M.carry - 1, dest: 'yard' };
          M.carried.children[M.deliver.idx].userData.winding = true;
        }
      }
      if (M.deliver) {
        const d = M.deliver, log = M.carried.children[d.idx];
        if (d.phase === 'wind') {
          d.t += dt / TUNE.windS;
          const k = clamp(d.t, 0, 1);
          log.scale.setScalar(1 + 0.22 * Math.sin(k * Math.PI * 0.5));
          log.position.y = log.userData.home.y + 0.06 * k;
          if (d.t >= 1) {
            // leaves the back
            M.carried.updateWorldMatrix(true, false);
            log.getWorldPosition(tmp);
            M.launch(ctx, tmp, d.dest, 'hunter');
            log.userData.winding = false; log.visible = false;
            M.setCarry(M.carry - 1, false);
            M.carried.children.forEach((c, i) => { if (i >= M.carry) c.userData.pop = 0; });
            M.wobble = 0.6;
            d.phase = 'gap'; d.t = 0;
          }
        } else if (d.phase === 'gap') {
          d.t += dt / TUNE.flyGapS;
          if (d.t >= 1) M.deliver = null;
        }
      }
      M.updateKeeper(ctx, dt);
      if (M.flyLogs.some(l => l.visible && l.userData.dest === 'arms')) keeper.root.updateMatrixWorld(true);
      for (const l of M.flyLogs) {
        if (!l.visible) continue;
        const u = l.userData;
        const toArms = u.dest === 'arms';
        u.t += dt / (toArms ? TUNE.fetchFlyS : TUNE.flyS);
        const k = clamp(u.t, 0, 1), e = HH.easeInOut(k);
        if (toArms) M.armsG.children[u.slot].getWorldPosition(u.to);   // the Keeper keeps walking: aim at the spot in the arms
        const to = u.to, h = toArms ? TUNE.fetchHeight : TUNE.flyHeight;
        l.position.set(HH.lerp(u.from.x, to.x, e), HH.lerp(u.from.y, to.y, e) + Math.sin(k * Math.PI) * h, HH.lerp(u.from.z, to.z, e));
        l.rotation.set(k * u.spin, k * 3, k * 2);
        l.scale.setScalar(HH.lerp(u.startScale, u.endScale, k));
        if (u.t >= 1) {
          l.visible = false;
          const byKeeper = u.src === 'keeper';
          if (toArms) {
            M.setArms(M.arms + 1, true);
            ctx.sparks(to.x, to.y, to.z, 5, { speed: 0.7, up: 1.2, size: 0.05, life: 0.6 });
            if (!M.fetch && !M.flyLogs.some(o => o.visible && o.userData.dest === 'arms')) keeper.hop = Math.max(keeper.hop, 0.6);   // the last one lands
          } else if (u.dest === 'yard') {
            if (M.yard >= TUNE.yardMax) M.setCarry(M.carry + 1, true);   // pile outside was full after all
            else {
              M.setYard(M.yard + 1, true);
              ctx.sparks(to.x, 0.5, to.z, 14, { speed: 1.1, up: 2.0, size: 0.07, life: 0.9 });
              hunter.hop = Math.max(hunter.hop, 0.5);
            }
          } else {
            const got = ctx.addLogs(1);
            if (got < 1) { if (byKeeper) M.setArms(M.arms + 1, true); else M.setCarry(M.carry + 1, true); }   // rack was full after all
            else {
              ctx.sparks(to.x, 0.5, to.z, 14, { speed: 1.1, up: 2.0, size: 0.07, life: 0.9 });
              ctx.pulseHud();
              if (!byKeeper) {
                if (keeper.act <= 0) keeper.playAct('cheer');
                hunter.hop = Math.max(hunter.hop, 0.5);
              }
            }
          }
        }
      }

      /* ----- the logs on the pile outside pop in as they land ----- */
      for (let i = 0; i < W.yardLogs.length; i++) {
        const l = W.yardLogs[i];
        l.visible = i < M.yard;
        if (!l.visible || l.userData.pop >= 1) continue;
        l.userData.pop = Math.min(1, l.userData.pop + dt / 0.34);
        l.scale.setScalar(Math.max(0.001, HH.easeOutBack(l.userData.pop)));
      }

      /* ----- regrow after a homecoming ----- */
      for (let i = M.regrow.length - 1; i >= 0; i--) {
        const r = M.regrow[i];
        r.t -= dt;
        if (r.t > 0) continue;
        const free = M.spots.filter(s => !s.taken);
        if (free.length) {
          const s = free[Math.floor(Math.random() * free.length)];
          const b = M.addBundle(ctx, s, 1);
          b.t = 0;
          ctx.sparks(s.x, 0.2, s.z, 8, { speed: 0.8, up: 1.4, size: 0.06, life: 0.9 });
        }
        M.regrow.splice(i, 1);
      }

      /* ----- the key prompt over the bundle in reach ----- */
      const target = (near && slotsFree > 0 && st.started) ? near : null;
      if (target) M.promptAt = target;
      M.promptK = HH.damp(M.promptK, target ? 1 : 0, 12, dt);
      const pa = M.promptAt;
      M.prompt.visible = !!pa && M.promptK > 0.02;
      if (pa) {
        M.prompt.scale.setScalar(0.5 * HH.easeOutBack(clamp(M.promptK, 0, 1)));
        M.prompt.position.set(pa.spot.x, TUNE.promptHeight + Math.sin(t * 3) * 0.04 + pa.lift * 0.05, pa.spot.z);
      }
    },

    flyBusy(ctx) { return M.flyLogs.some(l => l.visible); },

    /* how many logs the hearth rack can still take, counting the ones already in the air towards it */
    rackRoom(ctx) {
      const { st } = ctx;
      return ctx.TUNE.pileMax - st.logs - st.restock.length - M.flyLogs.filter(l => l.visible && l.userData.dest === 'rack').length;
    },
    yardRoom() {
      return TUNE.yardMax - M.yard - M.flyLogs.filter(l => l.visible && l.userData.dest === 'yard').length;
    },
    airborne(dest) { return M.flyLogs.filter(l => l.visible && l.userData.dest === dest).length; },

    /* the pile outside holds n logs (pop: the newest one lands with a pop) */
    setYard(n, pop) {
      const W = M.ctx.W, was = M.yard;
      M.yard = M.ctx.st.yard = clamp(n, 0, TUNE.yardMax);
      for (let i = was; i < M.yard; i++) {
        const l = W.yardLogs[i];
        l.userData.pop = pop ? 0 : 1;
        l.scale.setScalar(pop ? 0.001 : 1);
      }
      W.yardLogs.forEach((l, i) => { l.visible = i < M.yard; });
    },

    /* the Keeper holds n logs in her arms */
    setArms(n, pop) {
      const was = M.arms;
      M.arms = clamp(n, 0, ARMS.length);
      M.armsG.children.forEach((l, i) => {
        if (i < M.arms && i >= was) { l.userData.pop = pop ? 0.001 : 1; l.userData.popT = pop ? 0 : 1; }
        l.visible = i < M.arms && l.userData.pop > 0.02;
      });
    },

    /* the Keeper: fetch an armful from the pile outside, carry it, throw it onto the rack by the hearth */
    updateKeeper(ctx, dt) {
      const { W, keeper, st } = ctx;
      const K = ctx.input.keeper, t = st.time;
      const tmp = M._tmpK || (M._tmpK = new ctx.T.Vector3());
      const room = M.rackRoom(ctx);
      const dYard = Math.hypot(keeper.x - W.yardPile.x, keeper.z - W.yardPile.z);
      const dRack = Math.hypot(keeper.x - W.pile.x, keeper.z - W.pile.z);
      const incoming = M.airborne('arms');

      /* ----- fetch ----- */
      const can = st.started && M.arms === 0 && !M.fetch && incoming === 0 && !M.kDeliver && M.yard > 0 && room > 0 && dYard < TUNE.yardReach;
      if (can && K.act) {
        K.act = false;                        // claimed: nothing else happens on this press
        M.fetch = { left: Math.min(TUNE.armful, M.yard, room), gap: 0 };
      }
      if (M.fetch) {
        const f = M.fetch;
        f.gap -= dt;
        if (f.gap <= 0 && f.left > 0 && M.flyLogs.some(l => !l.visible)) {
          const slot = M.arms + M.airborne('arms');
          M.setYard(M.yard - 1, false);       // the log leaves the pile and hops into the arms
          M.yardLaunch(ctx, W.yardSlots[M.yard], slot);
          f.left--; f.gap = TUNE.fetchGapS;
        }
        if (f.left <= 0) M.fetch = null;
      }

      /* ----- the arms: pop-in, then the carry pose ----- */
      for (let i = 0; i < M.armsG.children.length; i++) {
        const l = M.armsG.children[i], u = l.userData;
        if (u.winding) continue;
        if (i < M.arms) {
          if (u.pop < 1) { u.popT = (u.popT || 0) + dt / 0.3; u.pop = HH.easeOutBack(clamp(u.popT, 0, 1)); }
          l.scale.setScalar(Math.max(0.001, u.pop));
          l.visible = true;
        } else l.visible = false;
      }
      keeper.carry = (M.arms > 0 || M.fetch || incoming > 0) ? 1 : 0;

      /* ----- deliver to the rack by the hearth, one log after another like the Hunter ----- */
      if (!M.kDeliver && M.arms > 0 && !M.fetch && incoming === 0 && st.started && dRack < TUNE.deliverReach && room > 0 && st.throwT < 0) {
        M.kDeliver = { phase: 'wind', t: 0, idx: M.arms - 1 };
        M.armsG.children[M.kDeliver.idx].userData.winding = true;
      }
      if (M.kDeliver) {
        const d = M.kDeliver, log = M.armsG.children[d.idx];
        if (d.phase === 'wind') {
          d.t += dt / TUNE.windS;
          const k = clamp(d.t, 0, 1);
          log.scale.setScalar(1 + 0.22 * Math.sin(k * Math.PI * 0.5));
          log.position.y = log.userData.home.y + 0.04 * k;
          if (d.t >= 1) {
            M.armsG.updateWorldMatrix(true, false);
            log.getWorldPosition(tmp);
            M.launch(ctx, tmp, 'rack', 'keeper');
            log.userData.winding = false; log.visible = false; log.position.y = log.userData.home.y; log.scale.setScalar(1);
            M.setArms(M.arms - 1, false);
            M.armsG.children.forEach((c, i) => { if (i >= M.arms) c.userData.pop = 0; });
            d.phase = 'gap'; d.t = 0;
          }
        } else if (d.phase === 'gap') {
          d.t += dt / TUNE.flyGapS;
          if (d.t >= 1) M.kDeliver = null;
        }
      }

      /* ----- the key prompt over the pile outside ----- */
      M.yardPromptK = HH.damp(M.yardPromptK, can ? 1 : 0, 12, dt);
      const yp = M.yardPrompt;
      yp.visible = M.yardPromptK > 0.02;
      yp.scale.setScalar(0.55 * HH.easeOutBack(clamp(M.yardPromptK, 0, 1)));
      yp.position.set(W.yardPile.x, TUNE.yardPromptHeight + Math.sin(t * 3) * 0.04, W.yardPile.z);
    },

    /* send a log flying from the Hunter's back (or the Keeper's arms) to the rack by the hearth or the pile outside */
    launch(ctx, from, dest, src) {
      const { st, W } = ctx;
      const fl = M.flyLogs.find(l => !l.visible);
      if (!fl) return;
      const to = new M.T.Vector3();
      if (dest === 'yard') {
        const slot = Math.min(TUNE.yardMax - 1, M.yard + M.airborne('yard'));
        to.copy(W.yardSlots[slot]); to.y += 0.35;
      } else {
        const slot = Math.min(ctx.TUNE.pileMax - 1, st.logs + st.restock.length + M.airborne('rack'));
        to.copy(W.logSlots[slot]); to.y += 0.35;
      }
      fl.userData = { from: from.clone(), to, t: 0, spin: 4 + Math.random() * 2, startScale: src === 'keeper' ? 0.7 : 1, endScale: 0.55, dest, src };
      fl.visible = true; fl.position.copy(from); fl.scale.setScalar(fl.userData.startScale);
    },

    /* a log hops from the pile outside into the Keeper's arms */
    yardLaunch(ctx, from, slot) {
      const fl = M.flyLogs.find(l => !l.visible);
      if (!fl) return;
      fl.userData = { from: from.clone(), to: new M.T.Vector3(), t: 0, spin: 1.5 + Math.random(), startScale: 1.5, endScale: 0.7, dest: 'arms', src: 'yard', slot };
      fl.visible = true; fl.position.copy(from); fl.scale.setScalar(1.5);
    },

    on(event, data, ctx) {
      if (event === 'homecoming') {
        // bundles that were gathered come back somewhere else
        const missing = TUNE.bundles - M.bundles.length - M.regrow.length;
        
        for (let i = 0; i < missing; i++) M.regrow.push({ t: i * TUNE.regrowStagger + 0.3 });
      }
    },

    attachDebug(ctx) {
      window.game.debug.wood = {
        give(n) { M.setCarry(M.carry + (n === undefined ? 1 : n), true); return this; },
        yard(n) { M.setYard(n, false); return this; },   // set how many logs lie on the pile outside
        state() {
          return { carry: M.carry, yard: M.yard, arms: M.arms, bundles: M.bundles.filter(b => b.state === 'ready' || b.state === 'grow').length, gathered: M.gathered,
            pile: ctx.st.logs + ctx.st.restock.length, spots: M.spots.length, regrowing: M.regrow.length,
            at: M.bundles.map(b => ({ x: +b.spot.x.toFixed(1), z: +b.spot.z.toFixed(1), s: b.state })) };
        }
      };
    }
  };
  (HH.mechanics = HH.mechanics || []).push(M);
})();
