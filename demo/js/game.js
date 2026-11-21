/* game.js: input, the two players, the fire that links them, the interface and the loop. */
(function () {
  'use strict';
  const T = THREE, HH = window.HH, W = HH.world, C = W.cot;
  const clamp = HH.clamp, lerp = HH.lerp, smooth = HH.smooth, damp = HH.damp;
  const S = Math.SQRT1_2;

  /* Starting values, to tune by feel. These are what carries over to the real game. */
  const TUNE = HH.TUNE = {
    walkSpeed: 4.0,            // units per second, both players
    lanternBurnSeconds: 45,    // design doc says 3:00; shortened so a short demo shows the whole arc
    deepBurnMult: 1.5,         // burn rate in the deeper band
    deepStart: 45,             // distance from the clearing centre where the deeper band begins
    lanternRadius: 7.4,        // reach of a full lantern
    lanternRadiusLow: 2.6,     // reach just before it goes out
    lanternLowAt: 0.28,        // below this the lantern (and the hearth) flicker
    relightSeconds: 0.8,       // time to relight in the clearing's warm light
    flareSeconds: 20,          // a stoke: wider light, burn paused
    flareRadiusMult: 1.6,
    stokeGift: 0.12,           // a stoke also rekindles a dead lantern to this level
    logs: 5,                   // logs on the pile when the game starts
    pileMax: 10,               // most the pile (and the rack) can hold
    stokeReach: 1.75,
    raiseCost: 0.06,           // a raise in the forest costs this share of a full lantern
    autoRestock: true          // the pile refills by itself when the Hunter comes home; a gathering mechanic turns this off
  };

  const WARM = new T.Vector3(1.0, 0.5, 0.15);       // lantern light, linear
  const HEARTH = new T.Vector3(1.0, 0.5, 0.17);

  HH.start = function () {
    const stage = document.getElementById('game'), canvas = document.getElementById('view');
    const scene = new T.Scene();
    W.build(scene);
    const view = HH.makeView(canvas, scene);

    const keeper = HH.makeCharacter('keeper'), hunter = HH.makeCharacter('hunter');
    scene.add(keeper.root, hunter.root);
    keeper.x = -5.45; keeper.z = -1.75; keeper.facing = 0.55;
    hunter.x = -4.35; hunter.z = -0.55; hunter.facing = 1.0;

    const fire = HH.makeFire(1.08);
    fire.group.position.copy(W.fire);
    scene.add(fire.group);
    const ps = HH.makeParticles(460);
    scene.add(ps.points);
    view.particles = ps;
    const smoke = HH.makeSmoke(W.chimneyTop);
    scene.add(smoke.group);
    const prompt = HH.makePrompt('E');
    prompt.position.set(W.pile.x, 1.78, W.pile.z + 0.25);
    prompt.visible = false;
    scene.add(prompt);

    const roofMats = W.roof.userData.mats;
    roofMats.forEach(m => { m.transparent = true; });

    /* ---------- state ---------- */
    const st = {
      started: false, time: 0, frozen: false,
      fuel: 1, flare: 0, home: true, tripMax: 0, awayT: 0, owedWood: false,
      logs: TUNE.logs, throwT: -1, throwLog: null, throwFrom: new T.Vector3(),
      roofT: 0, roar: 0, flutter: 0, ring: 0, flarePop: 0, raise: 0,
      lanRadius: TUNE.lanternRadius, lanOn: 1, dread: 0, health: 1,
      canStoke: false, promptK: 0, restock: [], dim: 0.22,
      burnMult: 1                // mechanics scale the lantern's burn rate through this (below 1 burns slower)
    };
    W.logs.forEach((l, i) => { l.visible = i < st.logs; });   // the rack starts with five, the other places empty
    const ringPos = new T.Vector3();
    const glass = hunter.lantern.userData.glass.material.color;
    const glassLit = HH.hdr(0xffb347, 2.1), glassOut = HH.col(0x2a2c33);

    /* ---------- input ---------- */
    const keys = {}, pressed = {};
    const used = { KeyW: 1, KeyA: 1, KeyS: 1, KeyD: 1, KeyE: 1, ArrowUp: 1, ArrowDown: 1, ArrowLeft: 1, ArrowRight: 1, Enter: 1, NumpadEnter: 1, ShiftRight: 1, Space: 1 };
    const padPrev = [false, false];
    const auto = { keeper: null, hunter: null };

    function begin() {
      if (st.started) return;
      st.started = true;
      stage.classList.add('is-playing');
      try { canvas.focus({ preventScroll: true }); } catch (e) { /* older browsers */ }
    }
    window.addEventListener('keydown', e => {
      if (!st.started) { if (e.code === 'Enter' || e.code === 'Space') { e.preventDefault(); begin(); } return; }
      if (used[e.code]) e.preventDefault();
      if (!e.repeat) { keys[e.code] = true; pressed[e.code] = true; }
    });
    window.addEventListener('keyup', e => { keys[e.code] = false; });
    const resume = document.getElementById('resume');
    window.addEventListener('blur', () => { for (const k in keys) keys[k] = false; if (st.started) resume.hidden = false; });
    window.addEventListener('focus', () => { resume.hidden = true; });
    stage.addEventListener('pointerdown', () => { resume.hidden = true; begin(); try { canvas.focus({ preventScroll: true }); } catch (e) { /* ignore */ } });

    // An embedded frame may not be allowed to read gamepads; if so, stop asking and stay on the keyboard.
    let padsOk = typeof navigator.getGamepads === 'function';
    function readPads() {
      if (!padsOk) return [];
      try { return Array.prototype.filter.call(navigator.getGamepads(), p => p && p.connected); }
      catch (e) { padsOk = false; return []; }
    }

    function readInput(who) {
      const a = auto[who];
      if (a) return { ix: a.ix, iy: a.iy, act: false };
      if (ctx.freeze[who]) return { ix: 0, iy: 0, act: false };
      if (!st.started) return { ix: 0, iy: 0, act: false };
      // playing alone: one character is active and takes every control; the other stands still
      if (ctx.solo) {
        if (who !== ctx.solo) return { ix: 0, iy: 0, act: false };
        let sx = (keys.KeyD || keys.ArrowRight ? 1 : 0) - (keys.KeyA || keys.ArrowLeft ? 1 : 0), sy = (keys.KeyW || keys.ArrowUp ? 1 : 0) - (keys.KeyS || keys.ArrowDown ? 1 : 0);
        let sact = !!(pressed.KeyE || pressed.Enter || pressed.NumpadEnter || pressed.ShiftRight);
        const v = ctx.virtual;
        if (v.ix || v.iy) { sx = v.ix; sy = v.iy; }
        if (v.act) { sact = true; v.act = false; }
        return { ix: sx, iy: sy, act: sact };
      }
      let ix = 0, iy = 0, act = false;
      if (who === 'keeper') {
        ix = (keys.KeyD ? 1 : 0) - (keys.KeyA ? 1 : 0); iy = (keys.KeyW ? 1 : 0) - (keys.KeyS ? 1 : 0);
        act = !!pressed.KeyE;
      } else {
        ix = (keys.ArrowRight ? 1 : 0) - (keys.ArrowLeft ? 1 : 0); iy = (keys.ArrowUp ? 1 : 0) - (keys.ArrowDown ? 1 : 0);
        act = !!(pressed.Enter || pressed.NumpadEnter || pressed.ShiftRight);
      }
      // gamepads: first pad is the Hearth Keeper, second is the Hunter
      const idx = who === 'keeper' ? 0 : 1, pad = readPads()[idx];
      if (pad) {
        const dz = v => Math.abs(v) < 0.22 ? 0 : v;
        const b = i => !!(pad.buttons[i] && pad.buttons[i].pressed);
        const px = dz(pad.axes[0] || 0) + (b(15) ? 1 : 0) - (b(14) ? 1 : 0), py = -dz(pad.axes[1] || 0) + (b(12) ? 1 : 0) - (b(13) ? 1 : 0);
        if (px || py) { ix = px; iy = py; }
        const down = b(0) || b(2);
        if (down && !padPrev[idx]) act = true;
        padPrev[idx] = down;
      }
      return { ix, iy, act };
    }

    function move(c, inp, dt) {
      let ix = inp.ix, iy = inp.iy;
      const len = Math.hypot(ix, iy);
      if (len > 1) { ix /= len; iy /= len; }
      const tvx = S * (ix - iy) * TUNE.walkSpeed, tvz = -S * (ix + iy) * TUNE.walkSpeed;
      const k = 1 - Math.exp(-(len > 0.01 ? 13 : 17) * dt);
      c.vx += (tvx - c.vx) * k; c.vz += (tvz - c.vz) * k;
      const p = { x: c.x + c.vx * dt, z: c.z + c.vz * dt };
      W.collide(p, 0.3);
      c.x = p.x; c.z = p.z;
    }

    /* ---------- effects ---------- */
    function sparks(x, y, z, n, o) {
      o = o || {};
      for (let i = 0; i < n; i++) {
        const a = Math.random() * 6.283, sp = (o.speed || 1.6) * (0.3 + Math.random());
        ps.spawn({
          x: x + (Math.random() - 0.5) * 0.2, y: y + Math.random() * 0.2, z: z + (Math.random() - 0.5) * 0.2,
          vx: Math.cos(a) * sp, vy: (o.up || 2.2) * (0.4 + Math.random()), vz: Math.sin(a) * sp,
          life: (o.life || 1.0) * (0.6 + Math.random() * 0.8), size: (o.size || 0.085) * (0.6 + Math.random() * 0.8),
          r: 3.2, g: 1.5 + Math.random() * 0.6, b: 0.4, grav: o.grav !== undefined ? o.grav : -1.6, drag: 1.6, wob: 0.35
        });
      }
    }

    function stokeLands() {
      st.flare = TUNE.flareSeconds;
      st.fuel = Math.min(1, Math.max(st.fuel, 0) + TUNE.stokeGift);
      st.roar = 1; st.flarePop = 1;
      sparks(W.fire.x, 0.5, W.fire.z + 0.25, 30, { speed: 1.5, up: 2.8 });
      sparks(hunter.lanternWorld.x, hunter.lanternWorld.y, hunter.lanternWorld.z, 22, { speed: 2.0, up: 2.0, size: 0.075 });
      view.pulseSeam(1);
      hunter.hop = 1;
      pulseHud();
      emit('stoke');
    }

    function homecoming() {
      st.ring = 1;
      ringPos.set(hunter.x, 0.5, hunter.z);
      sparks(hunter.x, 0.5, hunter.z, 36, { speed: 2.2, up: 2.6, grav: -0.6, life: 1.5 });
      st.roar = Math.max(st.roar, 0.75);
      sparks(W.fire.x, 0.5, W.fire.z + 0.25, 14, { speed: 1.2, up: 2.4 });
      view.pulseSeam(1);
      hunter.hop = 1;
      if (keeper.act <= 0) keeper.playAct('cheer');
      st.owedWood = TUNE.autoRestock && st.logs < TUNE.pileMax;
      pulseHud();
      emit('homecoming', { tripMax: st.tripMax, awayT: st.awayT });
    }

    /* ---------- mechanics: each one lives in its own file (js/mech-*.js) and plugs in here ----------
       A mechanic is an object pushed onto HH.mechanics before HH.start runs:
         { name, init(ctx), update(ctx, dt), on(event, data, ctx) }      every method is optional
       update runs each step after the players have moved and before the stoke and lantern rules, so a
       mechanic can claim a button press by setting ctx.input.keeper.act or ctx.input.hunter.act to false.
       Events sent to on(): 'stoke' (a log has landed), 'homecoming' ({ tripMax, awayT }), 'home', 'away',
       plus anything a mechanic sends itself with ctx.emit(name, data). */
    const mechs = (HH.mechanics || []).slice();
    function emit(name, data) { for (const m of mechs) { if (m.on) m.on(name, data, ctx); } }
    // put up to n logs back on the pile with the usual pop-in; returns how many fitted
    function addLogs(n) {
      const have = st.logs + st.restock.length, add = Math.max(0, Math.min(n, TUNE.pileMax - have));
      for (let k = 0; k < add; k++) st.restock.push({ i: have + k, t: -k * 0.14 - 0.15 });
      return add;
    }
    const ctx = {
      T, HH, W, TUNE, st, scene, view, keeper, hunter, fire, particles: ps,
      input: { keeper: { ix: 0, iy: 0, act: false }, hunter: { ix: 0, iy: 0, act: false } },   // this step's input
      sparks, pulseHud, emit, addLogs,
      freeze: { keeper: false, hunter: false },         // true: that character ignores all input (movement and action)
      // ask for a stoke as the Keeper's press would (wherever she stands); true if a log started its throw
      stoke() {
        if (st.logs > 0 && st.throwT < 0 && st.restock.length === 0) {
          st.throwLog = W.logs[st.logs - 1];
          st.throwFrom.copy(st.throwLog.position);
          st.throwT = 0; st.logs -= 1; st.canStoke = false;
          keeper.playAct('throw');
          return true;
        }
        return false;
      },
      near: (c, p, r) => Math.hypot(c.x - p.x, c.z - p.z) < r,
      safeZones: [],                                    // { x, z, r }: pools of warm light where the lantern does not burn
      warm: i => ({ pos: HH.U.uWarmPos.value[i], col: HH.U.uWarmCol.value[i] }),   // warm-light slots: 4 and 5 waystone, 6 supper, 7 free
      hud: document.getElementById('hud'),
      // Playing alone (the touch mode uses this): set solo to 'keeper' or 'hunter' and that character takes all
      // input while the other stands still, and the camera follows it as one view with no split. Leave it null for two players.
      solo: null,
      virtual: { ix: 0, iy: 0, act: false }           // an on-screen stick and button write here; act is cleared once read
    };

    /* ---------- interface ---------- */
    const lanternEl = document.getElementById('lantern'), keeperAct = document.getElementById('keeper-act'), keeperTxt = document.getElementById('keeper-act-txt');
    let hudFuel = -1, hudFlare = -1, hudCls = '';
    function pulseHud() { lanternEl.classList.remove('is-pulse'); void lanternEl.offsetWidth; lanternEl.classList.add('is-pulse'); }
    function hud() {
      const f = clamp(st.fuel, 0, 1), fl = clamp(st.flare / TUNE.flareSeconds, 0, 1);
      if (Math.abs(f - hudFuel) > 0.004) { hudFuel = f; lanternEl.style.setProperty('--fuel', f.toFixed(3)); }
      if (Math.abs(fl - hudFlare) > 0.004) { hudFlare = fl; lanternEl.style.setProperty('--flare', fl.toFixed(3)); }
      const empty = st.logs === 0 && st.throwT < 0 && st.restock.length === 0;
      const outside = (st.yard || 0) > 0;     // the wood mechanic keeps the count of logs on the pile outside
      const cls = (f <= 0 ? 'out' : (f < TUNE.lanternLowAt && !st.home && st.flare <= 0 ? 'low' : 'ok')) + (st.flare > 0 ? ' flare' : '') + (st.canStoke ? ' stoke' : '') + (empty ? ' empty' : '') + (empty && outside ? ' outside' : '');
      if (cls !== hudCls) {
        hudCls = cls;
        keeperAct.classList.toggle('is-empty', empty);
        keeperTxt.textContent = empty ? (outside ? 'out of wood, fetch more from the pile outside' : 'out of wood, the Hunter brings more home') : 'stoke the fire';
        lanternEl.classList.toggle('is-out', f <= 0);
        lanternEl.classList.toggle('is-low', cls.indexOf('low') === 0);
        lanternEl.classList.toggle('is-flare', st.flare > 0);
        keeperAct.classList.toggle('is-ready', st.canStoke);
        lanternEl.setAttribute('aria-label', f <= 0 ? 'Lantern: out' : (st.flare > 0 ? 'Lantern: flaring' : (cls.indexOf('low') === 0 ? 'Lantern: low' : 'Lantern: burning')));
      }
    }

    /* ---------- one step of the world ---------- */
    let moteAcc = 0, emberAcc = 0, coolAcc = 0, flareAcc = 0;
    function step(dt) {
      st.time += dt;
      const t = st.time;
      HH.U.uTime.value = t;

      // players
      ['keeper', 'hunter'].forEach(who => { const a = auto[who]; if (a) { a.t -= dt; if (a.t <= 0) auto[who] = null; } });
      const inK = readInput('keeper'), inH = readInput('hunter');
      for (const k in pressed) pressed[k] = false;
      move(keeper, inK, dt);
      move(hunter, inH, dt);

      // mechanics get the first look at this step's input
      ctx.input.keeper = inK; ctx.input.hunter = inH;
      for (const m of mechs) { if (m.update) m.update(ctx, dt); }

      // the roof lifts away while anyone is inside
      const anyInside = W.inside(keeper.x, keeper.z) || W.inside(hunter.x, hunter.z);
      st.roofT = clamp(st.roofT + (anyInside ? 1 : -1) * dt / 0.5, 0, 1);
      const re = HH.easeInOut(st.roofT);
      W.roof.visible = st.roofT < 0.995;
      W.roof.position.y = re * 2.6;
      roofMats.forEach(m => { m.opacity = 1 - re; });

      // the lantern: burns only outside the clearing's warm light
      const dH = Math.hypot(hunter.x, hunter.z);
      const wasHome = st.home;
      if (st.home && dH > W.R + 0.5) st.home = false;
      else if (!st.home && dH < W.R - 0.4) st.home = true;
      if (!st.home) { st.tripMax = Math.max(st.tripMax, dH); st.awayT += dt; }
      if (st.home && !wasHome) {
        if (st.tripMax > W.R + 3.5 && st.awayT > 2.5) homecoming();
        st.tripMax = 0; st.awayT = 0;
      }
      if (st.home !== wasHome) emit(st.home ? 'home' : 'away');
      st.flare = Math.max(0, st.flare - dt);
      const inSafe = ctx.safeZones.some(z => Math.hypot(hunter.x - z.x, hunter.z - z.z) < z.r);
      if (st.home) st.fuel = Math.min(1, Math.max(st.fuel, 0) + dt / TUNE.relightSeconds);
      else if (st.flare <= 0 && !inSafe) st.fuel = Math.max(0, st.fuel - dt / TUNE.lanternBurnSeconds * st.burnMult * (dH > TUNE.deepStart ? TUNE.deepBurnMult : 1));
      const lit = st.fuel > 0;

      // stoke: the Keeper throws a real log from the pile
      const dHearth = Math.hypot(keeper.x - W.hearthFront.x, keeper.z - W.hearthFront.z);
      const dPile = Math.hypot(keeper.x - W.pile.x, keeper.z - (W.pile.z + 1.0));
      st.canStoke = st.logs > 0 && st.throwT < 0 && st.restock.length === 0 && (dHearth < TUNE.stokeReach || dPile < 1.3);
      if (inK.act && st.canStoke) {
        st.throwLog = W.logs[st.logs - 1];
        st.throwFrom.copy(st.throwLog.position);
        st.throwT = 0; st.logs -= 1; st.canStoke = false;
        keeper.playAct('throw');
      }
      if (st.throwT >= 0) {
        st.throwT += dt / 0.52;
        const k = Math.min(1, st.throwT), log = st.throwLog;
        const tx = W.fire.x, ty = 0.3, tz = W.fire.z + 0.05;
        log.position.set(lerp(st.throwFrom.x, tx, k), lerp(st.throwFrom.y, ty, k) + Math.sin(k * Math.PI) * 1.05, lerp(st.throwFrom.z, tz, k) + Math.sin(k * Math.PI) * 0.55);
        log.rotation.set(k * 5.5, k * 2.2, 0);
        log.scale.setScalar(1 - smooth(0.82, 1, k) * 0.7);
        // face the fire while throwing
        const want = Math.atan2(W.fire.x - keeper.x, W.fire.z - keeper.z);
        let d = want - keeper.facing; while (d > Math.PI) d -= 6.283; while (d < -Math.PI) d += 6.283;
        keeper.facing += d * (1 - Math.exp(-12 * dt));
        if (st.throwT >= 1) { log.visible = false; st.throwT = -1; stokeLands(); }
      }
      // the Hunter's signal: raise the lantern, and the hearth answers
      if (inH.act && hunter.act <= 0) {
        hunter.playAct('raise'); st.raise = 1; st.flutter = 1;
        if (lit) sparks(hunter.lanternWorld.x, hunter.lanternWorld.y + 0.5, hunter.lanternWorld.z, 8, { speed: 0.8, up: 1.6, size: 0.06 });
        let cost = 0;
        if (!st.home && !inSafe && st.fuel > 0 && st.flare <= 0 && Math.hypot(hunter.x - W.waystone.x, hunter.z - W.waystone.z) > 2.4 && st.fuel > 0.02) {
          cost = Math.min(TUNE.raiseCost, st.fuel - 0.02);
          st.fuel -= cost;
        }
        emit('raise', { cost });
      }
      // wood comes home with the Hunter
      if (st.owedWood && st.throwT < 0 && Math.hypot(hunter.x - W.hearthFront.x, hunter.z - W.hearthFront.z) < 5.5) {
        st.owedWood = false;
        for (let i = st.logs; i < TUNE.pileMax; i++) st.restock.push({ i, t: -(i - st.logs) * 0.14 - 0.15 });
      }
      for (let n = st.restock.length - 1; n >= 0; n--) {
        const r = st.restock[n], log = W.logs[r.i];
        r.t += dt / 0.32;
        if (r.t > 0) {
          log.visible = true;
          log.position.copy(W.logSlots[r.i]);
          log.position.y += (1 - Math.min(1, r.t)) * 0.35;
          log.rotation.set(0, 0, r.i * 1.3);
          log.scale.setScalar(Math.max(0.01, HH.easeOutBack(Math.min(1, r.t))));
          if (r.t >= 1) { st.logs = Math.max(st.logs, r.i + 1); st.restock.splice(n, 1); }
        }
      }

      keeper.update(dt);
      hunter.update(dt);
      hunter.syncLantern();

      // lantern light
      st.flarePop = Math.max(0, st.flarePop - dt * 1.8);
      st.raise = Math.max(0, st.raise - dt * 1.1);
      st.lanOn = damp(st.lanOn, lit ? 1 : 0, lit ? 9 : 5, dt);
      const lowK = 1 - smooth(0.0, TUNE.lanternLowAt, st.fuel);
      let targetR = lerp(TUNE.lanternRadiusLow, TUNE.lanternRadius, Math.pow(clamp(st.fuel, 0, 1), 0.65));
      if (st.flare > 0) targetR *= lerp(1, TUNE.flareRadiusMult, smooth(0, 1.2, st.flare));
      st.lanRadius = damp(st.lanRadius, targetR, 3.5, dt);
      const lanFlick = 1 + HH.wob(t * 1.4, 2.0) * (0.025 + 0.11 * lowK * (st.flare > 0 ? 0.2 : 1));
      const lanR = st.lanRadius * lanFlick * (1 + st.flarePop * 0.3 + Math.sin(st.raise * Math.PI) * 0.12) * st.lanOn;
      // in the clearing's own light the lantern is only a small glow; out in the dark it is everything
      const atHome = 1 - smooth(W.R - 1, W.R + 7, dH);
      const lanI = (1.9 + 1.1 * clamp(st.fuel * 2, 0, 1)) * (st.flare > 0 ? 1.25 : 1) * (1 + st.flarePop * 0.8) * st.lanOn * (0.94 + 0.06 * lanFlick) * lerp(1, 0.22, atHome);
      HH.U.uWarmPos.value[1].set(hunter.lanternWorld.x, hunter.lanternWorld.y + 0.25, hunter.lanternWorld.z, Math.max(0.001, lanR));
      HH.U.uWarmCol.value[1].copy(WARM).multiplyScalar(lanI);
      glass.copy(glassOut).lerp(glassLit, st.lanOn * (0.75 + 0.25 * lanFlick) * (st.flare > 0 ? 1.25 : 1));
      st.dread = damp(st.dread, (!lit && !st.home) ? 1 : 0, 1.6, dt);
      HH.U.uDread.value = st.dread;
      // with the lantern out, a faint cold halo keeps the Hunter readable in the gloom (it is not warm light)
      HH.U.uWarmPos.value[3].set(hunter.x, 1.2, hunter.z, 3.6);
      HH.U.uWarmCol.value[3].set(0.42, 0.5, 0.62).multiplyScalar(0.3 * st.dread);

      // the hearth mirrors the lantern: tall and steady, flickering when low, thin when out
      st.health = damp(st.health, st.home ? 1 : clamp(st.fuel, 0, 1), 2.5, dt);
      st.roar = Math.max(0, st.roar - dt * 0.85);
      st.flutter = Math.max(0, st.flutter - dt * 0.9);
      const hl = st.health, flaring = st.flare > 0 ? smooth(0, 1.5, st.flare) : 0;
      const out = 1 - smooth(0.0, 0.06, hl);
      fire.height = lerp(0.66, 1.0, smooth(0.0, 0.6, hl)) * (1 + flaring * 0.22) + st.roar * 0.75;
      fire.width = lerp(0.24, 1.0, smooth(0.0, 0.45, hl)) * (1 + flaring * 0.12 + st.roar * 0.2);
      fire.flicker = lerp(0.5, 0.05, smooth(0.06, TUNE.lanternLowAt + 0.25, hl)) * (1 - flaring * 0.6) * (1 - out * 0.7) + st.flutter * 0.45;
      fire.lean = out * (0.55 + Math.sin(t * 0.8) * 0.18) + st.flutter * Math.sin(t * 9) * 0.25;
      fire.bright = lerp(0.82, 1, smooth(0, 0.5, hl)) * (1 + flaring * 0.2 + st.roar * 0.5);
      fire.update(dt);
      const hFl = 1 + HH.wob(t, 5.0) * (0.03 + fire.flicker * 0.22);
      HH.U.uWarmPos.value[0].set(W.fire.x, 0.8, W.fire.z + 0.7, 5.6 * (0.78 + 0.22 * hl) * (1 + st.roar * 0.3 + flaring * 0.08) * hFl);
      HH.U.uWarmCol.value[0].copy(HEARTH).multiplyScalar((0.34 + 0.46 * hl + st.roar * 0.5 + flaring * 0.22) * hFl);
      smoke.rate = 0.6 + hl * 0.5 + st.roar * 1.5;
      smoke.update(dt, t);

      // homecoming ring of light
      st.ring = Math.max(0, st.ring - dt / 1.5);
      const rk = 1 - st.ring;
      HH.U.uWarmPos.value[2].set(ringPos.x, ringPos.y, ringPos.z, st.ring > 0 ? lerp(2, 10, HH.easeOutCubic(rk)) : 0.001);
      HH.U.uWarmCol.value[2].copy(WARM).multiplyScalar(st.ring * st.ring * 2.4);

      // particles
      emberAcc += dt * (3 + fire.bright * 5 + st.roar * 30);
      while (emberAcc > 1) {
        emberAcc -= 1;
        ps.spawn({ x: W.fire.x + (Math.random() - 0.5) * 0.5, y: 0.45 + Math.random() * 0.3, z: W.fire.z + 0.1 + Math.random() * 0.3, vx: (Math.random() - 0.5) * 0.3, vy: 0.7 + Math.random() * 0.9, vz: 0.15 + Math.random() * 0.35, life: 0.9 + Math.random() * 0.9, size: 0.045 + Math.random() * 0.045, r: 3.0, g: 1.3, b: 0.35, drag: 0.6, wob: 0.25 });
      }
      moteAcc += dt * 5;
      while (moteAcc > 1) {
        moteAcc -= 1;
        const a = Math.random() * 6.283, d = Math.sqrt(Math.random()) * (W.R + 1);
        ps.spawn({ x: Math.cos(a) * d, y: 0.4 + Math.random() * 2.6, z: Math.sin(a) * d, vx: 0.12, vy: 0.04 + Math.random() * 0.08, vz: -0.05, life: 5 + Math.random() * 4, size: 0.055 + Math.random() * 0.05, r: 1.5, g: 1.05, b: 0.45, wob: 0.14, fadeIn: 1.2 });
      }
      if (!st.home) {
        coolAcc += dt * 3.5;
        while (coolAcc > 1) {
          coolAcc -= 1;
          const a = Math.random() * 6.283, d = 1.5 + Math.random() * 8;
          ps.spawn({ x: hunter.x + Math.cos(a) * d, y: 0.3 + Math.random() * 2.4, z: hunter.z + Math.sin(a) * d, vx: 0.1, vy: 0.03, vz: -0.06, life: 4 + Math.random() * 3, size: 0.05 + Math.random() * 0.04, r: 0.16, g: 0.26, b: 0.36, wob: 0.12, fadeIn: 1.4 });
        }
      }
      if (st.flare > 0 && lit) {
        flareAcc += dt * 9;
        while (flareAcc > 1) {
          flareAcc -= 1;
          ps.spawn({ x: hunter.lanternWorld.x + (Math.random() - 0.5) * 0.2, y: hunter.lanternWorld.y, z: hunter.lanternWorld.z + (Math.random() - 0.5) * 0.2, vx: (Math.random() - 0.5) * 0.5, vy: 0.9 + Math.random(), vz: (Math.random() - 0.5) * 0.5, life: 0.8 + Math.random() * 0.8, size: 0.04 + Math.random() * 0.04, r: 3.0, g: 1.5, b: 0.4, drag: 0.8, wob: 0.3 });
        }
      }
      ps.update(dt, t);

      // key prompt over the wood pile
      st.promptK = damp(st.promptK, st.canStoke && st.started ? 1 : 0, 12, dt);
      prompt.visible = st.promptK > 0.02;
      prompt.scale.setScalar(0.62 * HH.easeOutBack(clamp(st.promptK, 0, 1)));
      prompt.position.y = 1.78 + Math.sin(t * 3) * 0.04;

      // camera
      st.dim = damp(st.dim, st.started ? 0 : 0.22, 4, dt);
      view.final.uDim.value = st.dim;
      view.solo = ctx.solo ? (ctx.solo === 'hunter' ? 'B' : 'A') : null;
      view.update(dt, keeper, hunter, st.home && Math.hypot(keeper.x, keeper.z) < W.R + 0.5);
      hud();
    }

    /* ---------- loop ---------- */
    let last = performance.now();
    function tick(now) {
      requestAnimationFrame(tick);
      let dt = (now - last) / 1000;
      last = now;
      if (dt > 0.25) dt = 1 / 60; else view.govern(dt);
      dt = Math.min(dt, 1 / 20);
      view.resize();
      if (!st.frozen) step(dt);
      view.render(st.time);
    }

    document.getElementById('play').addEventListener('click', begin);

    /* ---------- hooks for looking at specific moments ---------- */
    const who = n => (n === 'hunter' ? hunter : keeper);
    const debug = {
      place(n, x, z) { const c = who(n); c.x = x; c.z = z; c.vx = c.vz = 0; view.snap(); return this; },
      placeUV(n, u, v) { const w = HH.uv2w(u, v); return this.place(n, w.x, w.z); },
      face(n, a) { who(n).facing = a; return this; },
      setLantern(f) { st.fuel = clamp(f, 0, 1); return this; },
      setFlare(s) { st.flare = s; return this; },
      setLogs(n) { st.logs = clamp(n, 0, TUNE.pileMax); W.logs.forEach((l, i) => { l.visible = i < st.logs; l.position.copy(W.logSlots[i]); l.scale.setScalar(1); }); return this; },
      stoke() { ctx.stoke(); return this; },
      raise() { hunter.playAct('raise'); st.raise = 1; st.flutter = 1; return this; },
      homecoming() { homecoming(); return this; },
      walk(n, ix, iy, seconds) { auto[n] = { ix, iy, t: seconds }; return this; },
      begin() { begin(); return this; },
      freeze(b) { st.frozen = b !== false; return this; },
      inspect(n, V) { view.inspect = n ? { who: n === 'hunter' ? 'B' : 'A', V: V || 5 } : null; return this; },
      advance(seconds) { const n = Math.max(1, Math.round(seconds * 60)); for (let i = 0; i < n; i++) step(1 / 60); view.resize(); view.render(st.time); return this; },
      state() {
        return {
          keeper: { x: +keeper.x.toFixed(2), z: +keeper.z.toFixed(2) }, hunter: { x: +hunter.x.toFixed(2), z: +hunter.z.toFixed(2) },
          fuel: +st.fuel.toFixed(3), flare: +st.flare.toFixed(2), logs: st.logs, home: st.home, roofT: +st.roofT.toFixed(2),
          q: +view.q.toFixed(3), split: view.split, V: +view.V.toFixed(2), size: view.size(), started: st.started
        };
      }
    };
    // Set before the mechanics start: until now the name `game` pointed at the #game element,
    // and a mechanic that added its hooks on the first step would have put them on that element.
    window.game = { debug, tune: TUNE, view, state: st, ctx, mechanics: mechs };

    mechs.forEach(m => { if (m.init) m.init(ctx); });
    view.resize();
    view.snap();
    step(1 / 60);
    requestAnimationFrame(tick);
  };
})();
