/* mech-dark.js: what waits in the forest when the lantern goes out.
   After a few seconds of dark away from home, two huge eyes open in the gloom and come closer, one heavy step at a time.
   Light closes them again (a stoke, the clearing, a pool of warm light). If they reach the Hunter, the fire calls the
   Hunter home: a short sequence that empties the pack and sets the Hunter down by the hearth. The Keeper is never held. */
(function () {
  'use strict';
  const T = THREE, HH = window.HH;
  const clamp = HH.clamp, lerp = HH.lerp, smooth = HH.smooth;

  /* ---------- tuning: everything to adjust by feel is here ---------- */
  const TUNE_DK = {
    waitSeconds: 3.0,        // lantern out, away from home and not in a safe zone, for this long before the eyes open
    openDistance: 9,         // how far from the Hunter the eyes open (on the deeper side of the path)
    openAngle: 0.95,         // radians: the eyes open up-screen from straight down the path (0.95 is 54 degrees), so both stay inside the Hunter's half of the split
    eyeHeight: 2.4,         // height of the eyes above the ground
    eyeGap: 0.95,            // each eye sits this far from the middle (in world units on screen)
    eyeWidth: 1.1,           // width of one eye
    eyeSlant: 0.2,           // radians: the inner corners sit lower, which makes the look heavy
    openSeconds: 1.5,        // lids opening: a slit first, a pause, then wide
    approachDelay: 1.0,      // the eyes only watch for this long before the first step
    blinkEvery: [3.2, 6.0],  // slow blink, every so many seconds (min, max)
    blinkSeconds: 0.7,
    closeSeconds: 0.4,       // lids closing when light returns
    retreatSpeed: 3.5,       // the closed eyes draw back this fast
    speed: 2.6,              // average approach speed (the Hunter walks at 4)
    stepSeconds: 0.9,        // one heavy step
    stepDip: 0.2,            // how far the eyes rise and fall with each step
    catchDistance: 1.2,      // this close and the fire calls the Hunter home
    clearingMargin: 1.0,     // the eyes never come nearer than this beyond the clearing's edge
    loomScale: 0.22,         // the eyes grow this much bigger as they close in
    dustCount: 22,           // puffs in the ring under each step
    dustRadius: 0.9,         // where the ring starts
    dustSpeed: 1.7,          // how fast it spreads
    dustLife: 1.0,
    dustSize: 0.8,
    dustLevel: 0.17,         // brightness of the pale dust (it is added on top of the picture)
    shakeFar: 0.02,          // shudder of the Hunter's view at the first steps (view units)
    shakeNear: 0.085,        // and when the eyes are right there
    haloLevel: 0.38,        // soft glow around the eyes

    /* the caught sequence: times in seconds from the moment the eyes reach the Hunter */
    caughtSeconds: 2.2,      // the Hunter is released at this time
    cowerScale: 0.8,         // the Hunter squashes to this height while cowering
    loomDistance: 0.55,      // the eyes come to this far from the Hunter
    loomHeight: 2.0,         // and lower to this height
    loomGrow: 0.4,           // and grow this much
    glowAt: 0.75,            // the ember glow opens at the Hunter
    glowRadius: 5.5,
    glowIntensity: 2.7,
    vanishFrom: 0.85,        // the Hunter shrinks into it
    vanishSeconds: 0.35,
    packAt: 0.9,             // the pack empties
    eyesCloseFrom: 1.0,      // the eyes shut and go
    dipFrom: 1.0,            // the whole picture dips to dark (about a quarter of a second)
    dipRise: 0.22,
    jumpAt: 1.25,            // the Hunter is set down by the hearth (in the dark)
    dipHoldUntil: 1.55,      // dark for a moment longer so the camera has caught up (the single view glides)
    dipFall: 0.4,            // and back to light
    burstAt: 1.4,            // the fire surges
    popFrom: 1.5,            // the Hunter pops back
    popSeconds: 0.5,
    keeperHopAt: 1.55,
    sideStep: 1.15,          // the Hunter lands this far to one side of the spot in front of the hearth
    shakeCaught: 0.1
  };

  const S = {
    phase: 'idle',           // idle, watch, closing, caught
    outT: 0, age: 0, lid: 0, closeT: 0, closeFrom: 0,
    blinkIn: 4, blinkT: -1,
    stepP: 0, steps: 0, foot: 1,
    x: 0, z: 0, y: 0, loom: 0, growK: 0,
    c: null, attached: false, tmp: new T.Vector3(), tmp2: new T.Vector3()
  };
  let group, eyes = [], haloTex;
  let camRight = { x: 1, z: 0 };

  /* ---------- the eyes: two almond lids, a slit pupil, a glow; billboards, because the camera is fixed ---------- */
  function almond(up, dn, k) {
    const sh = new T.Shape();
    sh.moveTo(-1, 0); sh.quadraticCurveTo(0, up * 2, 1, 0); sh.quadraticCurveTo(0, -dn * 2, -1, 0);
    const g = new T.ShapeGeometry(sh, 10);
    g.scale(k, k, 1);
    return g;
  }
  function makeHalo() {
    const cv = document.createElement('canvas');
    cv.width = cv.height = 64;
    const x = cv.getContext('2d'), g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
    g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.35, 'rgba(255,255,255,0.35)'); g.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = g; x.fillRect(0, 0, 64, 64);
    haloTex = new T.CanvasTexture(cv);
  }
  function buildEyes(ctx) {
    makeHalo();
    group = new T.Group();
    group.visible = false;
    const k = TUNE_DK.eyeWidth / 2;
    const outerGeo = almond(0.55, 0.4, k), innerGeo = almond(0.55, 0.4, k * 0.62), pupGeo = new T.CircleGeometry(1, 16);
    const haloGeo = new T.PlaneGeometry(1, 1);
    for (let i = 0; i < 2; i++) {
      const side = i === 0 ? -1 : 1;
      const holder = new T.Group();
      holder.position.x = side * TUNE_DK.eyeGap;
      holder.rotation.z = -side * TUNE_DK.eyeSlant;
      const lid = new T.Group();
      const outer = new T.Mesh(outerGeo, new T.MeshBasicMaterial({ color: HH.hdr(0xa9bb45, 1.7), side: T.DoubleSide, depthWrite: false }));
      const inner = new T.Mesh(innerGeo, new T.MeshBasicMaterial({ color: HH.hdr(0xe6f08c, 2.8), side: T.DoubleSide, depthWrite: false }));
      const pup = new T.Mesh(pupGeo, new T.MeshBasicMaterial({ color: 0x050604, side: T.DoubleSide, depthWrite: false }));
      outer.renderOrder = 21; inner.renderOrder = 22; pup.renderOrder = 23;
      inner.position.z = 0.01; pup.position.z = 0.02;
      lid.add(outer, inner, pup);
      holder.add(lid);
      const halo = new T.Mesh(haloGeo, new T.MeshBasicMaterial({
        map: haloTex, color: HH.hdr(0xb4c64a, TUNE_DK.haloLevel), blending: T.AdditiveBlending, transparent: true, depthWrite: false
      }));
      halo.scale.set(3.4, 2.2, 1);
      halo.position.z = -0.01;
      halo.renderOrder = 20;
      holder.add(halo);
      group.add(holder);
      eyes.push({ holder, lid, pup, halo, side });
    }
    ctx.scene.add(group);
  }

  function inSafe(ctx) {
    const h = ctx.hunter;
    return ctx.safeZones.some(z => Math.hypot(h.x - z.x, h.z - z.z) < z.r);
  }

  /* where the eyes open: on the deeper side along the path, else to a side, always outside the clearing */
  function pickSpawn(ctx) {
    const h = ctx.hunter, W = ctx.W, R = TUNE_DK.openDistance, uv = HH.w2uv(h.x, h.z);
    const cands = [];
    // deeper along the path, angled a little towards the top of the screen so both eyes stay inside the Hunter's half of a split view
    const a = TUNE_DK.openAngle, d0 = HH.uv2w(Math.cos(a), -Math.sin(a));
    if (uv.u + R * Math.cos(a) <= 86) cands.push({ x: h.x + d0.x * R, z: h.z + d0.z * R });
    const sides = [1, -1].map(s => { const d = HH.uv2w(0, s); return { x: h.x + d.x * R, z: h.z + d.z * R }; });
    sides.sort((a, b) => Math.hypot(b.x, b.z) - Math.hypot(a.x, a.z));   // the side further from home first
    sides.forEach(c => cands.push(c));
    const ok = c => Math.hypot(c.x, c.z) > W.R + TUNE_DK.clearingMargin + 1;
    return cands.find(ok) || cands[0] || { x: h.x + R, z: h.z };
  }

  function openEyes(ctx, at) {
    if (S.phase !== 'idle') return false;
    const sp = at || pickSpawn(ctx);
    S.x = sp.x; S.z = sp.z; S.y = TUNE_DK.eyeHeight;
    S.phase = 'watch'; S.age = 0; S.lid = 0; S.stepP = 0; S.steps = 0; S.blinkT = -1; S.loom = 0;
    S.blinkIn = lerp(TUNE_DK.blinkEvery[0], TUNE_DK.blinkEvery[1], Math.random());
    return true;
  }
  function beginClose() {
    if (S.phase !== 'watch') return false;
    S.phase = 'closing'; S.closeT = 0; S.closeFrom = S.lid;
    return true;
  }
  function hideEyes() {
    S.phase = 'idle'; S.outT = 0; S.lid = 0; S.age = 0;
    group.visible = false;
  }

  function lidCurve(age) {
    const a = TUNE_DK.openSeconds;
    if (age < 0.3 * a) return 0.2 * smooth(0, 1, age / (0.3 * a));
    if (age < 0.5 * a) return 0.2;
    return 0.2 + 0.8 * HH.easeOutCubic(clamp((age - 0.5 * a) / (0.5 * a), 0, 1));
  }

  /* ---------- dust and shudder ---------- */
  function dust(ctx, x, z) {
    const n = TUNE_DK.dustCount, lv = TUNE_DK.dustLevel;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * 6.283 + Math.random() * 0.4, sp = TUNE_DK.dustSpeed * (0.6 + Math.random() * 0.6);
      ctx.particles.spawn({
        x: x + Math.cos(a) * TUNE_DK.dustRadius * 0.6, y: 0.1 + Math.random() * 0.1, z: z + Math.sin(a) * TUNE_DK.dustRadius * 0.6,
        vx: Math.cos(a) * sp, vy: 0.25 + Math.random() * 0.35, vz: Math.sin(a) * sp,
        life: TUNE_DK.dustLife * (0.7 + Math.random() * 0.5), size: TUNE_DK.dustSize * (0.6 + Math.random() * 0.7),
        r: 0.9 * lv, g: 0.95 * lv, b: 0.78 * lv, drag: 2.4, wob: 0.1, fadeIn: 0.1
      });
    }
    // a few grains thrown up
    for (let i = 0; i < 6; i++) {
      const a = Math.random() * 6.283;
      ctx.particles.spawn({
        x: x + Math.cos(a) * 0.4, y: 0.15, z: z + Math.sin(a) * 0.4, vx: Math.cos(a) * 0.8, vy: 1.4 + Math.random() * 1.0, vz: Math.sin(a) * 0.8,
        life: 0.6 + Math.random() * 0.3, size: 0.12 + Math.random() * 0.08, r: 0.8 * lv, g: 0.85 * lv, b: 0.7 * lv, grav: -5, drag: 1.0, fadeIn: 0.04
      });
    }
  }
  function shake(ctx, k) { if (ctx.view.shake) ctx.view.shake(k); }
  function closeness(ctx) {
    const d = Math.hypot(S.x - ctx.hunter.x, S.z - ctx.hunter.z);
    return 1 - clamp((d - TUNE_DK.catchDistance) / (TUNE_DK.openDistance - TUNE_DK.catchDistance), 0, 1);
  }
  function footfall(ctx) {
    S.foot = -S.foot; S.steps++;
    dust(ctx, S.x + camRight.x * S.foot * 0.8, S.z + camRight.z * S.foot * 0.8);
    shake(ctx, lerp(TUNE_DK.shakeFar, TUNE_DK.shakeNear, closeness(ctx)));
  }

  /* ---------- watching and coming closer ---------- */
  function watchStep(ctx, dt) {
    const h = ctx.hunter, W = ctx.W;
    S.age += dt;
    S.lid = lidCurve(S.age);
    S.blinkIn -= dt;
    if (S.blinkIn <= 0 && S.blinkT < 0 && S.age > TUNE_DK.openSeconds) { S.blinkT = 0; S.blinkIn = lerp(TUNE_DK.blinkEvery[0], TUNE_DK.blinkEvery[1], Math.random()); }
    if (S.blinkT >= 0) { S.blinkT += dt; if (S.blinkT > TUNE_DK.blinkSeconds) S.blinkT = -1; }
    if (S.age > TUNE_DK.approachDelay) {
      S.stepP += dt / TUNE_DK.stepSeconds;
      const mult = 2 * Math.pow(Math.sin(Math.PI * S.stepP), 2);   // surges forward, stands still as the foot lands
      let dx = h.x - S.x, dz = h.z - S.z, d = Math.hypot(dx, dz) || 1;
      const ds = Math.min(TUNE_DK.speed * mult * dt, Math.max(0, d - 0.2));
      S.x += dx / d * ds; S.z += dz / d * ds;
      const r = Math.hypot(S.x, S.z), rmin = W.R + TUNE_DK.clearingMargin;
      if (r < rmin) { S.x *= rmin / r; S.z *= rmin / r; }
      if (S.stepP >= 1) { S.stepP -= 1; footfall(ctx); }
    }
    S.loom = closeness(ctx);
    if (Math.hypot(S.x - h.x, S.z - h.z) < TUNE_DK.catchDistance) startCaught(ctx);
  }
  function closeStep(ctx, dt) {
    const h = ctx.hunter;
    S.closeT += dt;
    S.lid = S.closeFrom * (1 - smooth(0, 1, S.closeT / TUNE_DK.closeSeconds));
    const dx = S.x - h.x, dz = S.z - h.z, d = Math.hypot(dx, dz) || 1;
    S.x += dx / d * TUNE_DK.retreatSpeed * dt; S.z += dz / d * TUNE_DK.retreatSpeed * dt;
    if (S.closeT >= TUNE_DK.closeSeconds) hideEyes();
  }

  /* ---------- caught ---------- */
  function startCaught(ctx) {
    if (S.phase === 'caught') return false;
    if (S.phase === 'idle') { openEyes(ctx, { x: ctx.hunter.x + 3, z: ctx.hunter.z }); S.lid = 1; S.age = TUNE_DK.openSeconds; }
    const h = ctx.hunter, W = ctx.W;
    let dx = S.x - h.x, dz = S.z - h.z, d = Math.hypot(dx, dz);
    if (d < 0.01) { dx = 1; dz = 0; d = 1; }
    // where the Hunter will stand: in front of the hearth, a step to the side away from the Keeper
    const k = ctx.keeper, hf = W.hearthFront;
    const side = Math.abs(hf.x + TUNE_DK.sideStep - k.x) >= Math.abs(hf.x - TUNE_DK.sideStep - k.x) ? 1 : -1;
    const dest = { x: hf.x + side * TUNE_DK.sideStep, z: hf.z + 0.15 };
    W.collide(dest, 0.3);
    S.c = {
      t: 0, hx: h.x, hz: h.z, ex: S.x, ez: S.z, dirx: dx / d, dirz: dz / d, dest,
      jumped: false, packed: false, glowed: false, burst: false, hopped: false, froze: !ctx.freeze.hunter, startLid: S.lid, burstDone: false
    };
    S.phase = 'caught';
    ctx.freeze.hunter = true;
    h.vx = h.vz = 0;
    shake(ctx, TUNE_DK.shakeCaught);
    dust(ctx, S.x, S.z);
    return true;
  }

  function finishCaught(ctx) {
    const h = ctx.hunter;
    h.root.scale.setScalar(1);
    if (S.c && S.c.froze) ctx.freeze.hunter = false;
    S.c = null;
    ctx.warm(7).pos.set(0, 0, 0, 0.001); ctx.warm(7).col.set(0, 0, 0);
    hideEyes();
  }

  function caughtStep(ctx, dt) {
    const c = S.c, h = ctx.hunter, st = ctx.st, W = ctx.W, D = TUNE_DK, ps = ctx.particles;
    c.t += dt;
    const t = c.t;
    h.vx = h.vz = 0;

    // the eyes loom right over the Hunter, then shut and go
    const lk = HH.easeOutCubic(clamp(t / 0.45, 0, 1));
    S.x = lerp(c.ex, c.hx + c.dirx * D.loomDistance, lk);
    S.z = lerp(c.ez, c.hz + c.dirz * D.loomDistance, lk);
    S.y = lerp(D.eyeHeight, D.loomHeight, lk);
    S.growK = lk * D.loomGrow;
    const closeK = smooth(D.eyesCloseFrom, D.eyesCloseFrom + 0.3, t);
    S.lid = lerp(c.startLid, 1, lk) * (1 - closeK);
    S.blinkT = -1;

    // before the jump the Hunter stays where they were caught; after it, at the hearth
    const px = c.jumped ? c.dest.x : c.hx, pz = c.jumped ? c.dest.z : c.hz;
    if (!c.jumped) {
      const want = Math.atan2(S.x - h.x, S.z - h.z);
      let a = want - h.facing; while (a > Math.PI) a -= 6.283; while (a < -Math.PI) a += 6.283;
      h.facing += a * (1 - Math.exp(-14 * dt));
    }

    // Hunter's body: cower, then vanish into the glow, then pop back by the fire
    let sx = 1, sy = 1, sz = 1;
    if (t < D.vanishFrom + D.vanishSeconds) {
      const k = smooth(0, 0.22, t);
      const tr = Math.sin(t * 52) * 0.018 * k;
      sy = 1 - (1 - D.cowerScale) * k; sx = sz = 1 + 0.07 * k + tr;
      const v = clamp((t - D.vanishFrom) / D.vanishSeconds, 0, 1);
      const f = Math.max(0.001, 1 - v * v);
      sx *= f; sy *= f; sz *= f;
    } else if (t < D.popFrom) {
      sx = sy = sz = 0.001;
    } else {
      const p = clamp((t - D.popFrom) / D.popSeconds, 0, 1), f = Math.max(0.001, HH.easeOutBack(p));
      sx = sy = sz = f;
    }
    h.root.scale.set(Math.max(0.001, sx), Math.max(0.001, sy), Math.max(0.001, sz));

    // the ember glow opens at the Hunter
    const wp = ctx.warm(7);
    const ember = [1.0, 0.42, 0.1];
    if (!c.glowed && t >= D.glowAt) {
      c.glowed = true;
      ctx.sparks(c.hx, 0.6, c.hz, 40, { speed: 2.6, up: 3.0, life: 1.3, size: 0.09 });
      shake(ctx, D.shakeCaught * 0.6);
    }
    if (t >= D.glowAt && !c.jumped) {
      const g = HH.easeOutCubic(clamp((t - D.glowAt) / 0.4, 0, 1));
      wp.pos.set(c.hx, 0.9, c.hz, Math.max(0.001, D.glowRadius * g));
      wp.col.set(ember[0], ember[1], ember[2]).multiplyScalar(D.glowIntensity * (0.7 + 0.3 * g));
      ps.spawn({ x: c.hx, y: 0.7, z: c.hz, life: 0.14, size: 0.5 + 1.6 * g, r: 3.6, g: 1.6, b: 0.4, fadeIn: 0.02 });
    }
    // the pack: a burst of sparks where it was
    if (!c.packed && t >= D.packAt) {
      c.packed = true;
      if (ctx.wood && ctx.wood.count) ctx.wood.take(ctx.wood.count());
      ctx.emit('packlost');   // tell the other mechanics the pack is gone
      const bx = c.hx - Math.sin(h.facing) * 0.3, bz = c.hz - Math.cos(h.facing) * 0.3;
      ctx.sparks(bx, 0.75, bz, 22, { speed: 2.0, up: 2.4, life: 1.2, size: 0.1 });
      for (let i = 0; i < 6; i++) ps.spawn({ x: bx + (Math.random() - 0.5) * 0.3, y: 0.7 + Math.random() * 0.3, z: bz + (Math.random() - 0.5) * 0.3, vx: (Math.random() - 0.5) * 0.8, vy: 0.5, vz: (Math.random() - 0.5) * 0.8, life: 0.5, size: 0.55, r: 2.2, g: 0.9, b: 0.25, drag: 2, fadeIn: 0.03 });
    }

    // the jump, in the dark
    if (!c.jumped && t >= D.jumpAt) {
      c.jumped = true;
      h.x = c.dest.x; h.z = c.dest.z; h.vx = h.vz = 0;
      h.facing = Math.atan2(W.fire.x - h.x, W.fire.z - h.z) + 0.5 * (h.x < W.hearthFront.x ? -1 : 1);
      ctx.view.snap();
    }
    if (c.jumped) {
      if (!c.burst && t >= D.burstAt) {
        c.burst = true;
        st.roar = 1;
        ctx.sparks(W.fire.x, 0.55, W.fire.z + 0.3, 34, { speed: 1.6, up: 3.0, life: 1.4 });
        ctx.sparks(px, 0.5, pz, 24, { speed: 2.2, up: 2.6, grav: -0.6, life: 1.4 });
        ctx.view.pulseSeam(1);
      }
      if (t >= D.popFrom) {
        const p = clamp((t - D.popFrom) / D.popSeconds, 0, 1);
        const g = 1 - smooth(0, 1, clamp((t - D.popFrom) / (D.caughtSeconds - D.popFrom), 0, 1));
        wp.pos.set(px, 0.9, pz, Math.max(0.001, 4.2 * (0.6 + 0.4 * HH.easeOutCubic(p))));
        wp.col.set(ember[0], ember[1], ember[2]).multiplyScalar(2.0 * g);
        if (p < 1) ps.spawn({ x: px, y: 0.6, z: pz, life: 0.14, size: 0.5 + 1.0 * (1 - p), r: 3.2, g: 1.5, b: 0.4, fadeIn: 0.02 });
      }
      if (!c.hopped && t >= D.keeperHopAt) { c.hopped = true; ctx.keeper.hop = 1; }
    }

    // the dip: the whole picture goes dark around the jump and comes back
    let dip = 0;
    if (t >= D.dipFrom) {
      if (t < D.jumpAt + 0.05) dip = smooth(D.dipFrom, D.dipFrom + D.dipRise, t);
      else if (t < D.dipHoldUntil) dip = 1;
      else dip = 1 - smooth(D.dipHoldUntil, D.dipHoldUntil + D.dipFall, t);
    }
    if (dip > 0) st.dim = Math.max(st.dim, dip);

    if (t >= D.caughtSeconds) finishCaught(ctx);
  }

  /* ---------- drawing the eyes ---------- */
  function drawEyes(ctx, dt) {
    if (S.phase === 'idle') { group.visible = false; return; }
    const cam = ctx.view.camB, h = ctx.hunter;
    cam.getWorldDirection(S.tmp);               // forward: away from the camera
    const fwd = S.tmp;
    camRight.x = 1; camRight.z = 0;
    S.tmp2.set(1, 0, 0).applyQuaternion(cam.quaternion);
    const rl = Math.hypot(S.tmp2.x, S.tmp2.z) || 1;
    camRight.x = S.tmp2.x / rl; camRight.z = S.tmp2.z / rl;
    // a blink dips the lid; stepping rises and dips the whole pair
    let blink = 0;
    if (S.blinkT >= 0) { const b = S.blinkT / TUNE_DK.blinkSeconds; blink = b < 0.35 ? smooth(0, 0.35, b) : 1 - smooth(0.35, 1, b); }
    const open = clamp(S.lid * (1 - 0.95 * blink), 0, 1);
    let bob = 0;
    if (S.phase === 'watch' && S.age > TUNE_DK.approachDelay) {
      const p = S.stepP;
      bob = TUNE_DK.stepDip * (Math.sin(Math.PI * p) - 0.55 * Math.exp(-p * 9));
    }
    const sc = 1.25 * (1 + TUNE_DK.loomScale * S.loom + (S.phase === 'caught' ? S.growK : 0));
    const wy = S.y + bob;
    // slightly towards the camera along its view line (no change on screen) so trees do not slice through the flat eyes
    group.position.set(S.x - fwd.x * 2.5, wy - fwd.y * 2.5, S.z - fwd.z * 2.5);
    group.quaternion.copy(cam.quaternion);
    group.scale.setScalar(sc);
    // the pupils look at the Hunter
    S.tmp2.set(h.x - S.x, 0.9 - wy, h.z - S.z);
    const up = new T.Vector3(0, 1, 0).applyQuaternion(cam.quaternion), right = new T.Vector3(1, 0, 0).applyQuaternion(cam.quaternion);
    let lx = S.tmp2.dot(right), ly = S.tmp2.dot(up);
    const ll = Math.hypot(lx, ly) || 1; lx /= ll; ly /= ll;
    const flick = 1 + HH.wob(ctx.st.time * 0.9, 4.1) * 0.05;
    eyes.forEach(e => {
      e.lid.scale.y = Math.max(0.015, open);
      e.pup.scale.set(0.075, 0.27 * clamp(open * 1.3, 0.05, 1), 1);
      e.pup.position.set(lx * 0.17, ly * 0.06, 0.02);
      e.halo.material.color.copy(HH.hdr(0xb4c64a, TUNE_DK.haloLevel * flick * open));
      e.halo.visible = open > 0.03;
    });
    group.visible = open > 0.012;
  }

  /* ---------- debug ---------- */
  function attachDebug(ctx) {
    if (!window.game || !window.game.debug) return;
    S.attached = true;
    window.game.debug.dark = {
      open() { return openEyes(ctx); },
      close() { return beginClose(); },
      catch() { return startCaught(ctx); },
      state() {
        const h = ctx.hunter, on = S.phase !== 'idle';
        return {
          phase: S.phase, timer: +S.outT.toFixed(2), age: +S.age.toFixed(2), steps: S.steps,
          eyes: on ? { x: +S.x.toFixed(2), y: +(S.y).toFixed(2), z: +S.z.toFixed(2), open: +S.lid.toFixed(2) } : null,
          dist: on ? +Math.hypot(S.x - h.x, S.z - h.z).toFixed(2) : null,
          caughtT: S.c ? +S.c.t.toFixed(2) : null, tune: TUNE_DK
        };
      }
    };
  }

  HH.mechanics = HH.mechanics || [];
  HH.mechanics.push({
    name: 'dark',
    init(ctx) {
      buildEyes(ctx);
      ctx.warm(7).pos.set(0, 0, 0, 0.001);
      ctx.warm(7).col.set(0, 0, 0);
    },
    update(ctx, dt) {
      if (!S.attached) attachDebug(ctx);
      const st = ctx.st;
      if (S.phase === 'caught') caughtStep(ctx, dt);
      else {
        const away = !st.home && !inSafe(ctx);
        if (S.phase === 'idle') {
          S.outT = (st.started && st.fuel <= 0 && away) ? S.outT + dt : 0;
          if (S.outT >= TUNE_DK.waitSeconds) openEyes(ctx);
        } else if (S.phase === 'watch') {
          if (st.fuel > 0 || !away) beginClose();
          else watchStep(ctx, dt);
        }
        if (S.phase === 'closing') closeStep(ctx, dt);
      }
      drawEyes(ctx, dt);
    },
    on(event, data, ctx) {}
  });
})();
