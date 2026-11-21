/* mech-mushroom.js: red mushrooms stand in clusters beside the forest path. The Hunter picks them, carries up to three
   on a short string at the side of his pack, and hops them into the basket by the pot at home.
   The basket and the pot belong to the supper mechanic (ctx.larder); this file only fills the basket. */
(function () {
  'use strict';
  const HH = window.HH;

  /* ---------- tuning: everything to adjust by feel lives here ---------- */
  const TUNE = {
    clusters: 5,             // clusters standing in the forest at any time (of the eight spots)
    carryMax: 3,             // most mushrooms the Hunter can carry
    reach: 1.2,              // pick-up distance
    squashS: 0.12,           // anticipation: the cluster crouches before it hops
    hopS: 0.44,              // flight from the ground to the string on the Hunter's pack
    hopHeight: 0.9,          // arc height of that hop
    windS: 0.13,             // anticipation: a carried mushroom swells a little before it leaves the string
    flyS: 0.5,               // flight from the pack to the basket
    flyGapS: 0.28,           // delay between mushrooms hopping into the basket
    flyHeight: 1.0,          // arc height of that flight
    regrowStagger: 0.45,     // seconds between regrown clusters popping in
    regrowDelay: 0.5,        // seconds after the homecoming before the first one
    glimmerEvery: 1.6,       // a cluster in sight of the Hunter gives off a little dust this often
    glimmerRange: 5.0,       // ...when he is closer than this
    promptHeight: 0.72,      // the key prompt floats this high over a cluster
    liftHeight: 0.04,        // how far a cluster in reach lifts off the ground
    liftScale: 0.08,         // ...and how much it swells
    // the string on the pack
    anchor: [-0.27, 0.46, -0.27],   // where it hangs from, in the Hunter's body space (side, up, back), by the end of the bedroll
    linkLength: 0.15,        // distance between two mushrooms on the string
    mushroomScale: 0.95,    // size of a carried mushroom
    swingStiff: 60,          // how fast the string swings back to hanging (higher = stiffer)
    swingSoft: 0.7,          // each lower mushroom is this much looser than the one above it
    swingDamp: 5.0,          // how quickly the swinging dies down
    swingLean: 0.02,         // how far the string trails behind per unit of walking speed (radians)
    swingStep: 0.03          // little bounce of the string in time with the steps (radians)
  };

  /* Fixed look of a lone mushroom, used on the string and in flight (same colours as the scenery ones). */
  const P = HH.PAL;

  const CSS = [
    '.hhm-mush { display: inline-flex; align-items: center; }',
    '.hhm-in { display: inline-flex; align-items: center; gap: 7px; }',
    '.hhm-mush svg { flex: none; opacity: 0.95; }',
    '.hhm-pips { display: inline-flex; gap: 4px; }',
    '.hhm-pip { box-sizing: border-box; width: 12px; height: 10px; border-radius: 6px 6px 2.5px 2.5px; border: 1.5px solid var(--panel-line); background: rgba(244, 230, 200, 0.06); transition: background 0.18s ease, border-color 0.18s ease, box-shadow 0.18s ease; }',
    '.hhm-pip.is-on { background: #d65a45; border-color: #d65a45; box-shadow: 0 0 9px rgba(230, 90, 70, 0.5); }',
    '.hhm-pip.is-pop { animation: hhm-pop 0.34s cubic-bezier(0.3, 1.7, 0.5, 1); }',
    '.hhm-mush.is-full .hhm-pip.is-on { background: #c24433; border-color: #c24433; }',
    '@keyframes hhm-pop { 0% { transform: scale(0.4, 1.9); } 55% { transform: scale(1.25, 0.7); } 100% { transform: scale(1); } }',
    /* phone: the chip has no room left beside the portrait button (it is only about 9 px short of it with the sprint marks showing),
       so here the mushrooms take no room in the chip at all: a small tab of the same panel hangs just under it, only while he carries some */
    '#game.is-touch .hhm-mush { position: relative; width: 0; height: 0; margin-left: -8px; }',
    '#game.is-touch .hhm-in { position: absolute; left: -4px; top: 29px; gap: 5px; padding: 5px 9px 5px 7px; border-radius: 10px; background: var(--panel); border: 1px solid var(--panel-line); white-space: nowrap; transition: opacity 0.25s ease, transform 0.25s ease; }',
    '#game.is-touch .hhm-mush.is-idle .hhm-in { opacity: 0; transform: translateY(-4px); }',
    '#game.is-touch .hhm-mush svg { width: 15px; height: 12px; }',
    '#game.is-touch .hhm-pips { gap: 3px; }',
    '#game.is-touch .hhm-pip { width: 10px; height: 9px; }',
    '@media (prefers-reduced-motion: reduce) { .hhm-pip.is-pop { animation: none; } }'
  ].join('\n');

  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
  const ease = t => t * t * (3 - 2 * t);

  /* one red-capped mushroom, a little larger than life, centred on the middle of its stem */
  function makeShroom(T) {
    const k = new HH.Kit();
    k.cyl(0.032, 0.04, 0.11, 6, 0, 0, 0, HH.col(P.cream));
    k.cone(0.095, 0.08, 7, 0, 0.082, 0, HH.col(P.mushroom));
    k.box(0.04, 0.026, 0.04, 0.045, 0.09, 0.04, HH.col(P.white), { r: 0.008 });
    k.box(0.036, 0.026, 0.036, -0.05, 0.085, 0.02, HH.col(P.white), { r: 0.008 });
    k.box(0.03, 0.024, 0.03, 0.0, 0.082, -0.06, HH.col(P.white), { r: 0.008 });
    return k.build({ cast: false });
  }

  const M = {
    name: 'mushroom',
    spots: [], clusters: [], regrow: [], flyers: [],
    carry: 0, string: null, links: [], pips: [], pipsEl: null, prompt: null,
    promptK: 0, promptAt: null, wobble: 0, deliver: null, dbg: false, placed: false,
    pf: 0, ps: 0, gait: 0, picked: 0,

    init(ctx) {
      const { T, W, scene, hunter } = ctx;
      M.T = T; M.ctx = ctx;

      M.spots = (W.mushroomSpots || []).map((s, i) => ({ i, x: s.x, z: s.z, taken: false }));
      // five of the eight hold a cluster at the start; the one by the waystone is always among the places
      const order = M.spots.slice().sort(() => Math.random() - 0.5);
      order.slice(0, Math.min(TUNE.clusters, order.length)).forEach(s => M.addCluster(ctx, s, 0));

      // the string on the pack: a chain of links, each with a cord segment and a mushroom, swinging like pendulums
      M.string = new T.Group();
      M.string.position.set(TUNE.anchor[0], TUNE.anchor[1], TUNE.anchor[2]);
      let parent = M.string;
      const cord = HH.col(P.tan);
      for (let i = 0; i < TUNE.carryMax; i++) {
        const link = new T.Group();
        link.position.y = i === 0 ? 0 : -TUNE.linkLength;
        const k = new HH.Kit();
        k.cyl(0.009, 0.009, TUNE.linkLength + 0.01, 5, 0, -TUNE.linkLength / 2, 0, cord);
        if (i === 0) k.cyl(0.02, 0.02, 0.025, 6, 0, 0.0, 0, cord);   // the knot it hangs from
        link.add(k.build({ cast: false }));
        const m = makeShroom(T);
        m.position.y = -0.1;
        m.rotation.y = i * 1.9;
        m.userData = { pop: 1, popT: 1 };
        m.visible = false;
        link.add(m);
        link.userData = { m, a: 0, v: 0, b: 0, w: 0, L: 0.2 + 0.16 * (i + 1) };
        parent.add(link);
        M.links.push(link);
        parent = link;
      }
      hunter.torso.add(M.string);

      // a few mushrooms in flight to the basket
      for (let i = 0; i < 4; i++) {
        const g = new T.Group();
        const m = makeShroom(T);
        g.add(m);
        g.visible = false;
        scene.add(g);
        M.flyers.push(g);
      }

      M.prompt = HH.makePrompt('↵');
      M.prompt.visible = false;
      scene.add(M.prompt);

      // interface: a small mushroom and one mark for each one the Hunter can carry
      const style = document.createElement('style');
      style.textContent = CSS;
      document.head.appendChild(style);
      const el = document.createElement('span');
      el.className = 'hhm-mush';
      el.setAttribute('role', 'img');
      el.innerHTML = '<span class="hhm-in"><svg viewBox="0 0 20 16" width="17" height="14" aria-hidden="true"><path d="M1.5 9.2C1.5 4.6 5.3 1 10 1s8.5 3.6 8.5 8.2c0 .6-.4 1-1 1H2.5c-.6 0-1-.4-1-1z" fill="#d65a45"/><circle cx="6" cy="6" r="1.5" fill="#f5ecd9"/><circle cx="11.5" cy="4.6" r="1.2" fill="#f5ecd9"/><circle cx="14.4" cy="7.3" r="1.1" fill="#f5ecd9"/><path d="M7 10.2h6l-.7 4.4c-.1.6-.6 1-1.2 1H8.9c-.6 0-1.1-.4-1.2-1z" fill="#ecd4a8"/></svg><span class="hhm-pips"></span></span>';
      const pipsEl = el.querySelector('.hhm-pips');
      for (let i = 0; i < TUNE.carryMax; i++) { const p = document.createElement('i'); p.className = 'hhm-pip'; pipsEl.appendChild(p); M.pips.push(p); }
      M.pipsEl = el;
      M.placeChip();
      M.syncHud();
    },

    /* the chip sits right after the wood marks; the sprint marks follow it (they put themselves after the wood marks too,
       so this is repeated on the first step, when every mechanic has been set up) */
    placeChip() {
      const wood = M.ctx.hud.querySelector('.hhw-wood');
      const el = M.pipsEl;
      if (wood && wood.parentNode) { if (wood.nextSibling !== el) wood.parentNode.insertBefore(el, wood.nextSibling); }
      else if (!el.parentNode) { const who = M.ctx.hud.querySelectorAll('.who'); const w = who[who.length - 1]; if (w) w.parentNode.insertBefore(el, w.nextSibling); }
    },

    /* ---------- clusters ---------- */
    addCluster(ctx, spot, grow) {
      const { T, W, scene } = ctx;
      const k = new HH.Kit();
      W.drawMushrooms(k, 0, 0, HH.rng(spot.i * 331 + 17 + Math.floor(Math.random() * 1000)));
      const inner = k.build();
      const g = new T.Group();
      g.add(inner);
      g.position.set(spot.x, 0, spot.z);
      g.rotation.y = Math.random() * 6.283;
      if (grow) g.scale.setScalar(0.001);
      scene.add(g);
      const c = { g, spot, state: grow ? 'grow' : 'ready', t: grow ? 0 : 1, lift: 0, glim: Math.random() * TUNE.glimmerEvery, fx: 0, fz: 0 };
      spot.taken = true;
      M.clusters.push(c);
      return c;
    },

    slotPos(i, out) {
      const l = M.links[clamp(i, 0, M.links.length - 1)];
      l.userData.m.updateWorldMatrix(true, false);
      return l.userData.m.getWorldPosition(out);
    },

    syncHud() {
      for (let i = 0; i < M.pips.length; i++) M.pips[i].classList.toggle('is-on', i < M.carry);
      M.pipsEl.classList.toggle('is-full', M.carry >= TUNE.carryMax);
      M.pipsEl.classList.toggle('is-idle', M.carry <= 0);
      M.pipsEl.setAttribute('aria-label', 'Mushrooms carried: ' + M.carry + ' of ' + TUNE.carryMax);
    },
    popPip(i) {
      const p = M.pips[i]; if (!p) return;
      p.classList.remove('is-pop'); void p.offsetWidth; p.classList.add('is-pop');
    },
    setCarry(n, pop) {
      const was = M.carry;
      M.carry = clamp(n, 0, TUNE.carryMax);
      for (let i = 0; i < M.links.length; i++) {
        const m = M.links[i].userData.m;
        if (i < M.carry && i >= was) { m.userData.pop = pop ? 0.001 : 1; m.userData.popT = pop ? 0 : 1; }
        if (i >= M.carry) { m.userData.pop = 0; m.userData.popT = 0; m.visible = false; }
      }
      M.syncHud();
      if (pop) for (let i = was; i < M.carry; i++) M.popPip(i);
    },

    airborne() { return M.flyers.filter(f => f.visible).length; },
    hopping() { return M.clusters.filter(c => c.state === 'hop').length; },

    update(ctx, dt) {
      const { T, hunter, st } = ctx;
      const H = ctx.input.hunter;
      if (!M.dbg && window.game && window.game.debug) { M.dbg = true; M.attachDebug(ctx); }
      if (!M.placed) { M.placed = true; M.placeChip(); }
      const t = st.time;
      const tmp = M._tmp || (M._tmp = new T.Vector3());
      const to = M._to || (M._to = new T.Vector3());
      dt = Math.min(dt, 0.1);

      /* ----- pick up ----- */
      const slotsFree = TUNE.carryMax - M.carry - M.hopping();
      let near = null, nd = TUNE.reach;
      for (const c of M.clusters) {
        if (c.state !== 'ready') continue;
        const d = Math.hypot(hunter.x - c.spot.x, hunter.z - c.spot.z);
        if (d < nd) { nd = d; near = c; }
      }
      if (near && slotsFree > 0 && H.act && st.started) {
        H.act = false;                       // claimed: the lantern stays down
        near.state = 'squash'; near.t = 0;
        ctx.sparks(near.spot.x, 0.12, near.spot.z, 6, { speed: 0.8, up: 1.1, size: 0.05, life: 0.7 });
      }
      for (const c of M.clusters) {
        const g = c.g;
        if (c.state === 'grow') {
          c.t += dt / 0.4;
          if (c.t > 0) {
            const k = clamp(c.t, 0, 1), s = Math.max(0.001, HH.easeOutBack(k));
            g.scale.setScalar(s);
            if (c.t >= 1) { c.state = 'ready'; g.scale.setScalar(1); }
          }
        } else if (c.state === 'ready') {
          // lifts a touch and swells when in reach
          const want = (c === near && slotsFree > 0) ? 1 : 0;
          c.lift = HH.damp(c.lift, want, 12, dt);
          g.position.y = c.lift * TUNE.liftHeight;
          g.scale.setScalar(1 + c.lift * TUNE.liftScale);
          c.glim -= dt;
          if (c.glim < 0 && Math.hypot(hunter.x - c.spot.x, hunter.z - c.spot.z) < TUNE.glimmerRange) {
            c.glim = TUNE.glimmerEvery * (0.7 + Math.random() * 0.6);
            ctx.sparks(c.spot.x, 0.25, c.spot.z, 1, { speed: 0.12, up: 0.45, size: 0.045, life: 1.4, grav: 0.1 });
          }
        } else if (c.state === 'squash') {
          c.t += dt / TUNE.squashS;
          const k = clamp(c.t, 0, 1), s = ease(k);
          g.scale.set(1 + 0.14 * s, 1 - 0.32 * s, 1 + 0.14 * s);
          g.position.y = 0;
          if (c.t >= 1) {
            c.state = 'hop'; c.t = 0; c.fx = g.position.x; c.fz = g.position.z;
            c.slot = M.carry + M.hopping() - 1;       // this cluster's place on the string (counted without itself)
            ctx.sparks(g.position.x, 0.1, g.position.z, 8, { speed: 1.1, up: 1.3, size: 0.055, life: 0.8 });
          }
        } else if (c.state === 'hop') {
          c.t += dt / TUNE.hopS;
          const k = clamp(c.t, 0, 1);
          M.slotPos(clamp(c.slot, 0, TUNE.carryMax - 1), tmp);
          const e = HH.easeOutCubic(k);
          g.position.set(HH.lerp(c.fx, tmp.x, e), HH.lerp(0, tmp.y, e) + Math.sin(k * Math.PI) * TUNE.hopHeight, HH.lerp(c.fz, tmp.z, e));
          g.rotation.y += dt * 9;
          const stretch = 1 + Math.sin(k * Math.PI) * 0.18;
          const s = HH.lerp(1, 0.4, ease(k));
          g.scale.set(s / Math.sqrt(stretch), s * stretch, s / Math.sqrt(stretch));
          if (c.t >= 1) {
            // lands on the string with a pop
            c.state = 'gone';
            g.visible = false;
            c.spot.taken = false;
            M.picked++;
            M.setCarry(M.carry + 1, true);
            M.wobble = 1;
            M.kick(0.9, 0.5);
            hunter.hop = Math.max(hunter.hop, 0.7);
            ctx.sparks(tmp.x, tmp.y + 0.1, tmp.z, 10, { speed: 1.2, up: 1.5, size: 0.055, life: 0.8 });
            ctx.pulseHud();
          }
        }
      }
      M.clusters = M.clusters.filter(c => {
        if (c.state === 'gone') { ctx.scene.remove(c.g); return false; }
        return true;
      });

      /* ----- the string: mushrooms pop in, the whole thing swings with the walk ----- */
      M.swing(ctx, dt, t);
      for (let i = 0; i < M.links.length; i++) {
        const m = M.links[i].userData.m, u = m.userData;
        if (u.winding) continue;
        if (i < M.carry) {
          if (u.pop < 1) { u.popT = (u.popT || 0) + dt / 0.34; u.pop = HH.easeOutBack(clamp(u.popT, 0, 1)); }
          m.scale.setScalar(Math.max(0.001, u.pop) * TUNE.mushroomScale);
          m.visible = true;
        } else m.visible = false;
      }

      /* ----- into the basket ----- */
      const L = ctx.larder;
      if (L) {
        const dB = Math.hypot(hunter.x - L.pos.x, hunter.z - L.pos.z);
        const D = M.deliver;
        if (!D && M.carry > 0 && st.started && dB < L.reach && L.room('mushroom') - M.airborne() > 0) {
          M.deliver = { phase: 'wind', t: 0, idx: M.carry - 1 };
          M.links[M.deliver.idx].userData.m.userData.winding = true;
        }
        if (M.deliver) {
          const d = M.deliver, m = M.links[d.idx].userData.m;
          if (d.phase === 'wind') {
            d.t += dt / TUNE.windS;
            const k = clamp(d.t, 0, 1);
            m.scale.setScalar(TUNE.mushroomScale * (1 + 0.25 * Math.sin(k * Math.PI * 0.5)));
            if (d.t >= 1) {
              const fl = M.flyers.find(f => !f.visible);
              if (fl) {
                M.slotPos(d.idx, tmp);
                fl.userData = { from: tmp.clone(), t: 0, spin: 4 + Math.random() * 2 };
                fl.visible = true; fl.position.copy(tmp); fl.scale.setScalar(TUNE.mushroomScale);
                m.userData.winding = false; m.visible = false;
                M.setCarry(M.carry - 1, false);
                M.wobble = 0.6; M.kick(-0.5, 0.2);
                d.phase = 'gap'; d.t = 0;
              } else { m.userData.winding = false; M.deliver = null; }
            }
          } else if (d.phase === 'gap') {
            d.t += dt / TUNE.flyGapS;
            if (d.t >= 1) M.deliver = null;
          }
        }
        for (const f of M.flyers) {
          if (!f.visible) continue;
          const u = f.userData;
          u.t += dt / TUNE.flyS;
          const k = clamp(u.t, 0, 1), e = HH.easeInOut(k);
          to.set(L.pos.x, L.pos.y, L.pos.z);
          f.position.set(HH.lerp(u.from.x, to.x, e), HH.lerp(u.from.y, to.y, e) + Math.sin(k * Math.PI) * TUNE.flyHeight, HH.lerp(u.from.z, to.z, e));
          f.rotation.set(Math.sin(k * Math.PI) * 0.5, k * u.spin, k * 1.5);
          f.scale.setScalar(HH.lerp(TUNE.mushroomScale, 0.7, k));
          if (u.t >= 1) {
            f.visible = false;
            if (L.add('mushroom')) {
              ctx.sparks(to.x, to.y + 0.05, to.z, 8, { speed: 1.0, up: 1.6, size: 0.055, life: 0.8 });
              ctx.pulseHud();
              hunter.hop = Math.max(hunter.hop, 0.4);
            } else M.setCarry(M.carry + 1, true);    // the basket was full after all: back on the string
          }
        }
      }

      /* ----- clusters come back after a homecoming ----- */
      for (let i = M.regrow.length - 1; i >= 0; i--) {
        const r = M.regrow[i];
        r.t -= dt;
        if (r.t > 0) continue;
        const free = M.spots.filter(s => !s.taken);
        if (free.length) {
          const s = free[Math.floor(Math.random() * free.length)];
          const c = M.addCluster(ctx, s, 1);
          c.t = 0;
          ctx.sparks(s.x, 0.15, s.z, 7, { speed: 0.7, up: 1.2, size: 0.055, life: 0.9 });
        }
        M.regrow.splice(i, 1);
      }

      /* ----- the key prompt over the cluster in reach ----- */
      const target = (near && slotsFree > 0 && st.started) ? near : null;
      if (target) M.promptAt = target;
      M.promptK = HH.damp(M.promptK, target ? 1 : 0, 12, dt);
      const pa = M.promptAt;
      M.prompt.visible = !!pa && M.promptK > 0.02;
      if (pa) {
        M.prompt.scale.setScalar(0.5 * HH.easeOutBack(clamp(M.promptK, 0, 1)));
        M.prompt.position.set(pa.spot.x, TUNE.promptHeight + Math.sin(t * 3) * 0.04 + pa.lift * TUNE.liftHeight, pa.spot.z);
      }
    },

    /* a shove to the string: forward (+ back) and sideways, in radians per second, as if the pack had been bumped */
    kick(f, s) {
      for (const l of M.links) { l.userData.v += f * (1 + Math.random() * 0.2); l.userData.w += (Math.random() - 0.5) * 2 * s * 4; }
    },

    /* each mushroom on the string is a pendulum: the Hunter's speeding up, slowing down and turning push it,
       and each one lower down is looser, so the string curls a little */
    swing(ctx, dt, t) {
      if (dt <= 0) return;
      const h = ctx.hunter, f = h.facing;
      const vf = h.vx * Math.sin(f) + h.vz * Math.cos(f);          // speed along the way he faces
      const vs = h.vx * Math.cos(f) - h.vz * Math.sin(f);          // speed to his local +x
      const af = clamp((vf - M.pf) / dt, -40, 40), as = clamp((vs - M.ps) / dt, -40, 40);
      M.pf = vf; M.ps = vs;
      const speed = Math.hypot(h.vx, h.vz);
      M.gait += dt * (2 + speed * 2.2);                              // a step rhythm that grows with the pace
      const steps = clamp(speed / 4, 0, 1.4);
      let prevA = 0, prevB = 0;
      const n = 3, sub = Math.max(1, Math.ceil(dt / 0.016)), hd = dt / sub;
      for (let i = 0; i < M.links.length; i++) {
        const u = M.links[i].userData;
        const k = TUNE.swingStiff * Math.pow(TUNE.swingSoft, i);
        for (let s = 0; s < sub; s++) {
          const ca = TUNE.swingLean * vf + Math.sin(M.gait * 3.1 - i * 0.7) * TUNE.swingStep * steps;
          const cb = Math.sin(M.gait * 1.55 - i * 0.7) * TUNE.swingStep * 0.6 * steps - TUNE.swingLean * 0.3 * vs;
          u.v += (-k * (u.a - ca) - TUNE.swingDamp * u.v + af / u.L) * hd;
          u.w += (-k * (u.b - cb) - TUNE.swingDamp * u.w - as / u.L) * hd;
          u.a += u.v * hd; u.b += u.w * hd;
        }
        u.a = clamp(u.a, -1.0, 1.0); u.b = clamp(u.b, -0.8, 0.8);
        M.links[i].rotation.set(u.a - prevA, 0, u.b - prevB);
        prevA = u.a; prevB = u.b;
      }
      void n; void t;
    },

    on(event, data, ctx) {
      if (event === 'homecoming') {
        // clusters that were picked come back, one by one, at free spots
        const missing = TUNE.clusters - M.clusters.length - M.regrow.length;
        for (let i = 0; i < missing; i++) M.regrow.push({ t: i * TUNE.regrowStagger + TUNE.regrowDelay });
      } else if (event === 'packlost') {
        // the dark takes everything on the string, and anything on its way to it
        const v = new M.T.Vector3();
        for (let i = 0; i < M.carry; i++) {
          M.slotPos(i, v);
          ctx.sparks(v.x, v.y, v.z, 7, { speed: 0.9, up: 1.2, size: 0.06, life: 0.8, grav: -0.4 });
          for (let j = 0; j < 4; j++) ctx.particles.spawn({
            x: v.x + (Math.random() - 0.5) * 0.12, y: v.y + Math.random() * 0.1, z: v.z + (Math.random() - 0.5) * 0.12,
            vx: (Math.random() - 0.5) * 0.7, vy: 0.2 + Math.random() * 0.5, vz: (Math.random() - 0.5) * 0.7,
            life: 0.8 + Math.random() * 0.4, size: 0.16 + Math.random() * 0.08, r: 0.5, g: 0.34, b: 0.3, grav: 0.1, drag: 2.2, wob: 0.1, fadeIn: 0.05
          });
        }
        if (M.deliver) { M.links[M.deliver.idx].userData.m.userData.winding = false; M.deliver = null; }
        M.setCarry(0, false);
        M.wobble = 0;
        for (const c of M.clusters) {
          if (c.state === 'squash' || c.state === 'hop') { c.state = 'gone'; c.spot.taken = false; c.g.visible = false; }
        }
      }
    },

    attachDebug(ctx) {
      window.game.debug.mushroom = {
        give(n) { M.setCarry(M.carry + (n === undefined ? 1 : n), true); return this.state(); },
        state() {
          return {
            carried: M.carry, picked: M.picked, regrowing: M.regrow.length, airborne: M.airborne(),
            clusters: M.clusters.filter(c => c.state === 'ready' || c.state === 'grow').length,
            spots: M.spots.map(s => s.taken), at: M.clusters.map(c => ({ spot: c.spot.i, x: +c.spot.x.toFixed(1), z: +c.spot.z.toFixed(1), s: c.state }))
          };
        }
      };
    }
  };
  (HH.mechanics = HH.mechanics || []).push(M);
})();
