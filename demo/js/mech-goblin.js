/* mech-goblin.js: a goblin stalks the Hunter at the edge of the lantern's light and steals wood.
   It is a thief, not a fighter: it never hurts anyone. It lives in the treeline, glints its eyes as the only warning,
   steps out, keeps pace just outside the light, feints and then lunges when the lantern is low and the Hunter carries wood.
   Raise the lantern to drive it off, stoke the fire to scatter it. One goblin at a time, no sound. */
(function () {
  'use strict';
  const T = THREE, HH = window.HH;
  const clamp = HH.clamp, lerp = HH.lerp, smooth = HH.smooth, damp = HH.damp;
  const TAU = Math.PI * 2;

  /* ---------- tuning: everything to adjust by feel is here ---------- */
  const TG = {
    // arriving
    arriveAfter: 8,         // seconds the Hunter must have been away from home before it may show up
    arriveMinU: 16,         // and the Hunter must be this far along the path
    glintSeconds: 0.8,      // eyes alone at the treeline before it hops out: the only warning
    glintReach: 4.8,        // the glint shows no further than this from the Hunter, so it is on screen even in a full lantern
    hopWind: 0.24,          // crouch before the hop out
    hopHeight: 0.8,         // how high the hop out goes
    gravity: 17,            // how fast hops fall
    // watching
    watchMargin: 0.6,       // it stands this far outside the edge of the light
    edgeInset: 0.35,        // how far inside the corridor edge the treeline spots lie
    scurrySpeed: 6.5,       // its running speed when keeping pace (the Hunter walks at 4)
    catchUpSpeed: 9,        // when it is far from its place
    sideSwitchCost: 1.5,    // how strongly it prefers to stay on its current side of the path
    alongCost: 0.06,        // how strongly it prefers to stay where it is along the path
    spotSmooth: 6,          // how softly its place follows the Hunter (higher is tighter)
    // feinting
    feintBelow: 0.5,        // below this lantern level (and wood on the pack) it starts to feint
    feintGapLong: 8,        // seconds between feints with little wood and a lantern near half
    feintGapShort: 1.6,     // seconds between feints with a full pack and a nearly dead lantern
    feintWind: 0.4,         // wind-up before the dart
    feintDepth: 1.9,        // how far into the light the dart goes
    feintMinDist: 1.4,      // it never darts closer than this to the Hunter
    feintHold: 0.35,        // grabbing at the air before it hops back
    // lunging
    lungeWaitMin: 2.2,      // wait before a lunge, shortest and longest
    lungeWaitMax: 4.0,
    creepRate: 1.4,         // when a lunge is due but it cannot be seen, it edges this much closer per second, into the light and into view
    creepMin: 2.4,          // and never stands closer than this while it waits
    crouchSeconds: 0.5,     // the warning crouch
    dashSpeed: 6.5,
    dashMax: 1.4,           // longest dash
    grabDist: 0.9,          // it grabs when this close
    skidSeconds: 0.45,      // skid to a stop after a missed dash
    // leaving
    fleeSpeed: 7.2,
    stolenAway: 10,         // seconds hidden after a theft
    repelAway: 5,           // seconds hidden after being driven off
    flareAfter: 3,          // seconds hidden after a flare has ended
    // the raised lantern
    driveScale: 1.0,        // it counts as too close if nearer than lantern radius times this ...
    drivePad: 0.2,          // ... plus this (the spec's 1.15 would catch a watcher at full light, which should only flinch)
    flinchSeconds: 0.85,
    flinchHop: 0.5,
    // looks
    size: 0.68,             // body scale against the Hunter
    eyeGlow: 1.5,           // brightness of the eyes
    eyeFlare: 3.6,          // in the crouch
    haloStrength: 0.6       // soft glow around the eyes so the glint reads
  };

  const SPH = new T.SphereGeometry(1, 16, 10), CONE = new T.ConeGeometry(1, 1, 10);
  const CY = 0.4;      // height of the tumble pivot
  const UMIN = 13.5, UMAX = 79;

  /* ---------- state ---------- */
  const G = {
    mood: 'hidden', ph: '', t: 0,
    x: 0, z: 0, y: 0, vy: 0, vx: 0, vz: 0, face: 0, pitch: 0, appear: 1,
    hop: null, tum: null, away: 0, hideT: 0, flareHold: 0, leave: 0, fleeTo: null, fleeSpeed: 7.2,
    feintT: -1, lungeT: -1, hasLog: false, logK: 0, fx: 0, fz: 0, tx: 0, tz: 0, spotT: 0,
    runPh: 0, sq: 0, sqv: 0, sqT: 0, tw: [0, 0], twT: [1, 2], gl: null, glT: 3, blinkT: 2, eyeOpen: 1, eyeK: 2.4,
    stuckT: 0, latch: false, latchT: 0, flareSeen: false, attached: false, haloAcc: 0, dustAcc: 0, leafAcc: 0, bodyOn: true
  };
  const P = {}, SP = {};   // pose targets (set every step by the mood) and their smoothed values
  let ctx = null, R = null, vtmp = null;

  /* ---------- the rig ---------- */
  function part(fn, parent, x, y, z, list) {
    const k = new HH.Kit();
    fn(k);
    const g = k.build();
    g.position.set(x || 0, y || 0, z || 0);
    if (parent) parent.add(g);
    if (list) list.push(g);
    return g;
  }

  function buildRig() {
    const C = HH.col, bodyParts = [];
    const ball = (k, rx, ry, rz, x, y, z, color, o) => k.geo(SPH, x, y, z, color, Object.assign({ s: [rx, ry, rz], smooth: true }, o));
    const rb = (k, w, h, d, x, y, z, color, o) => k.box(w, h, d, x, y, z, color, Object.assign({ smooth: true }, o));
    const cone = (k, r, len, x, y, z, color, rx, rz, o) => k.geo(CONE, x, y, z, color, Object.assign({ s: [r, len, r * 0.85], rx: rx || 0, rz: rz || 0, smooth: true }, o));
    const bp = (fn, parent, x, y, z) => part(fn, parent, x, y, z, bodyParts);

    const skin = C(0x86a03a), skinL = C(0x95b043), skinD = C(0x6d8830), earIn = C(0xc98a52);
    const hood = C(0x704a2b), hoodD = C(0x5b3a20), hoodL = C(0x815635);
    const tunic = C(0x7a5733), tunicD = C(0x624223), tunicL = C(0x8b6a40);
    const beltC = C(0x45291a), gold = C(0xe0a437), boot = C(0x6b4025), bootD = C(0x57331b);
    const noseC = C(0xe9923c), tusk = C(0xf1e6c2), mouthC = C(0x2c1a14), stitch = C(0xe09a45);

    const root = new T.Group(), tum = new T.Group(), rig = new T.Group(), body = new T.Group();
    root.add(tum); tum.add(rig); rig.add(body);
    tum.position.y = CY; rig.position.y = -CY;
    body.scale.setScalar(TG.size);

    const mkLeg = side => {
      const p = new T.Group();
      p.position.set(side * 0.12, 0.2, 0);
      bp(k => {
        rb(k, 0.15, 0.17, 0.16, 0, -0.07, 0, skin, { r: 0.06 });
        rb(k, 0.215, 0.15, 0.29, 0, -0.15, 0.04, boot, { r: 0.065 });
        rb(k, 0.225, 0.05, 0.235, 0, -0.085, 0, bootD, { r: 0.02 });
      }, p);
      body.add(p);
      return p;
    };
    const legL = mkLeg(-1), legR = mkLeg(1);

    const torso = new T.Group();
    torso.position.y = 0.2;
    body.add(torso);
    bp(k => {
      rb(k, 0.5, 0.4, 0.36, 0, 0.2, 0, tunic, { r: 0.15 });
      rb(k, 0.55, 0.15, 0.41, 0, 0.06, 0, tunicD, { r: 0.07 });
      ball(k, 0.2, 0.1, 0.17, 0, 0.42, 0.02, skinD);
      // ragged hem: points hanging all round
      [[-0.21, 0.17, 0.14], [-0.08, 0.2, 0.1], [0.06, 0.205, 0.13], [0.19, 0.17, 0.1], [-0.25, 0.0, 0.12], [0.25, 0.0, 0.11],
        [-0.13, -0.19, 0.12], [0.1, -0.2, 0.1], [0.0, -0.21, 0.13], [-0.24, -0.1, 0.1], [0.24, -0.1, 0.12]].forEach(p =>
        cone(k, 0.055, p[2], p[0], -0.025, p[1], tunicD, Math.PI, 0));
      rb(k, 0.52, 0.07, 0.385, 0, 0.17, 0, beltC, { r: 0.03 });
      rb(k, 0.125, 0.105, 0.03, 0, 0.17, 0.195, gold, { r: 0.022 });
      rb(k, 0.06, 0.05, 0.035, 0, 0.17, 0.2, beltC, { r: 0.012 });
      rb(k, 0.07, 0.4, 0.025, 0.13, 0.27, 0.185, beltC, { r: 0.012, rz: -0.5 });
      rb(k, 0.14, 0.15, 0.025, -0.13, 0.28, 0.185, tunicL, { r: 0.02, rz: 0.1 });
      // a short ragged collar like the cape in the art
      ball(k, 0.3, 0.07, 0.25, 0, 0.4, -0.01, tunicD);
      [-0.2, -0.07, 0.07, 0.2].forEach((x, i) => cone(k, 0.05, 0.1, x, 0.36, 0.2 - Math.abs(x) * 0.4, tunicD, Math.PI - 0.5, 0));
    }, torso);

    const fingers = { L: [], R: [] };
    const mkArm = side => {
      const piv = new T.Group();
      piv.position.set(side * 0.31, 0.33, 0);
      bp(k => {
        rb(k, 0.16, 0.17, 0.17, 0, -0.03, 0, tunic, { r: 0.06 });
        ball(k, 0.07, 0.13, 0.07, 0, -0.17, 0, skin);
        rb(k, 0.11, 0.05, 0.11, 0, -0.24, 0, beltC, { r: 0.02 });
      }, piv);
      const hand = new T.Group();
      hand.position.set(0, -0.3, 0);
      piv.add(hand);
      bp(k => ball(k, 0.09, 0.08, 0.09, 0, 0, 0, skinL), hand);
      const list = side < 0 ? fingers.L : fingers.R;
      [-0.05, 0, 0.05].forEach((fx, i) => {
        const f = new T.Group();
        f.position.set(fx, -0.055, 0.035);
        bp(k => ball(k, 0.03, 0.06, 0.03, 0, -0.045, 0, skinL), f);
        hand.add(f); list.push(f);
      });
      const th = new T.Group();
      th.position.set(side * -0.085, -0.02, 0.03);
      bp(k => ball(k, 0.032, 0.055, 0.032, 0, -0.03, 0, skinL), th);
      hand.add(th); list.push(th);
      torso.add(piv);
      return piv;
    };
    const armL = mkArm(-1), armR = mkArm(1);

    const head = new T.Group();
    head.position.y = 0.6;
    torso.add(head);
    bp(k => {
      rb(k, 0.68, 0.56, 0.58, 0, 0, 0, skin, { r: 0.2 });
      ball(k, 0.27, 0.15, 0.22, 0, -0.17, 0.05, skinL);
      // hood: a dome over the crown and back, a fold across the brow, the nape cover and the pointed tip
      ball(k, 0.365, 0.27, 0.34, 0, 0.15, -0.12, hood);
      ball(k, 0.31, 0.17, 0.15, 0, -0.08, -0.29, hoodD);
      rb(k, 0.5, 0.07, 0.11, 0, 0.145, 0.262, hoodL, { r: 0.033, rx: -0.3 });
      cone(k, 0.19, 0.74, 0.02, 0.58, -0.25, hood, -0.42, -0.12);
      // the stitch mark on the tip's front
      [0.6, -0.6].forEach(r => rb(k, 0.12, 0.025, 0.025, 0.045, 0.38, 0.172, stitch, { r: 0.01, rz: r, rx: -0.5 }));
      rb(k, 0.1, 0.022, 0.022, 0.045, 0.38, 0.178, stitch, { r: 0.01, rz: 0, rx: -0.5 });
      // face: long orange nose, one tusk, a frown, angry brows
      cone(k, 0.075, 0.2, 0, -0.065, 0.36, noseC, Math.PI / 2 + 0.2, 0);
      ball(k, 0.07, 0.06, 0.06, 0, -0.04, 0.29, noseC);
      cone(k, 0.04, 0.13, 0.115, -0.2, 0.27, tusk, 0.1, 0.06);
      k.geo(new T.TorusGeometry(0.085, 0.017, 6, 14, Math.PI), -0.01, -0.255, 0.285, mouthC, { s: [1, 0.8, 0.6], smooth: true });
      [-1, 1].forEach(s => rb(k, 0.15, 0.04, 0.04, s * 0.15, 0.085, 0.285, hoodD, { r: 0.015, rz: -s * 0.4 }));
    }, head);

    // big pointed ears out to the sides
    const ears = [-1, 1].map(side => {
      const piv = new T.Group(), tip = new T.Group();
      piv.position.set(side * 0.29, -0.02, -0.02);
      piv.add(tip);
      bp(k => {
        cone(k, 0.2, 0.6, 0, 0.3, 0, skin, 0, 0, { s: [0.2, 0.6, 0.075] });
        cone(k, 0.12, 0.45, 0, 0.27, 0.045, earIn, 0, 0, { s: [0.12, 0.45, 0.05] });
      }, tip);
      head.add(piv);
      return { piv, tip, side };
    });

    // eyes: glowing, with a dark slit so they read as a goblin's
    const eyeMat = new T.MeshBasicMaterial({ vertexColors: true });
    eyeMat.color.setScalar(TG.eyeGlow);
    const eyeCol = HH.hdr(0xd2f03a, 1.0);
    const mats = Object.assign({}, HH.mats, { glow: eyeMat });
    const eyes = [-1, 1].map(side => {
      const g = new T.Group();
      g.position.set(side * 0.155, -0.015, 0.285);
      g.userData.side = side;
      head.add(g);
      const k = new HH.Kit();
      k.geo(SPH, 0, 0, 0, eyeCol, { s: [0.06, 0.063, 0.03], glow: true, rz: -side * 0.22 });
      g.add(k.build({ cast: false, receive: false, mats }));
      const pu = part(kk => ball(kk, 0.012, 0.042, 0.012, 0, 0, 0.026, C(0x14100a), { rz: -side * 0.22 }), g, 0, 0, 0);
      pu.children.forEach(m => { m.castShadow = false; });
      return g;
    });

    // the stolen log, held in front
    const hold = new T.Group();
    hold.position.set(0, 0.2, 0.42);
    torso.add(hold);
    const log = ctx.W.makeLog(0.64, 0.085);
    log.rotation.y = Math.PI / 2;
    log.rotation.x = 0.1;
    hold.add(log);
    hold.visible = false;

    ctx.scene.add(root);
    root.visible = false;
    return { root, tum, rig, body, torso, head, legL, legR, armL, armR, ears, eyes, eyeMat, fingers, hold, bodyParts };
  }

  function setBody(on) {
    if (G.bodyOn === on) return;
    G.bodyOn = on;
    R.bodyParts.forEach(g => { g.visible = on; });
  }

  /* ---------- small helpers ---------- */
  const rnd = (a, b) => a + Math.random() * (b - a);
  const dist2 = (ax, az, bx, bz) => Math.hypot(ax - bx, az - bz);
  function angTo(ax, az, bx, bz) { return Math.atan2(bx - ax, bz - az); }
  function turn(to, rate, dt) {
    let d = to - G.face;
    while (d > Math.PI) d -= TAU; while (d < -Math.PI) d += TAU;
    G.face += d * (1 - Math.exp(-rate * dt));
  }
  function enter(mood, ph) { G.mood = mood; G.ph = ph || ''; G.t = 0; }
  // is it inside the Hunter's picture? The crouch is the warning before a lunge, so it must never happen out of sight
  // (the Hunter's half of a split screen is narrow, and a phone held upright shows even less to the sides)
  function inSight() {
    const v = ctx.view;
    if (!v || !v.project) return true;
    vtmp = vtmp || new T.Vector3();
    const p = v.project(vtmp.set(G.x, 0.5, G.z), 'B');
    if (p.x < 0.12 || p.x > 0.88 || p.y < 0.12 || p.y > 0.92) return false;   // well inside the picture, clear of the edges and the controls
    if (v.q > 1.0005 && !v.solo) {            // split screen: this picture only shows on the Hunter's side of the seam
      const n = v.final.uN.value, s = v.size();
      if ((p.x - 0.5) * s.w * n.x + (p.y - 0.5) * s.h * n.y < 0.05 * s.h) return false;
    }
    return true;
  }

  function leaves(x, y, z, n, spread) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * TAU, s = (spread || 0.9) * (0.3 + Math.random());
      ctx.particles.spawn({
        x: x + (Math.random() - 0.5) * 0.3, y: y + Math.random() * 0.3, z: z + (Math.random() - 0.5) * 0.3,
        vx: Math.cos(a) * s, vy: 0.5 + Math.random() * 1.1, vz: Math.sin(a) * s,
        life: 0.7 + Math.random() * 0.7, size: 0.04 + Math.random() * 0.04,
        r: 0.3 + Math.random() * 0.3, g: 0.8 + Math.random() * 0.4, b: 0.12, grav: -1.8, drag: 1.2, wob: 0.5
      });
    }
  }
  function dust(x, z, n, vx, vz) {
    for (let i = 0; i < n; i++) {
      ctx.particles.spawn({
        x: x + (Math.random() - 0.5) * 0.25, y: 0.08 + Math.random() * 0.1, z: z + (Math.random() - 0.5) * 0.25,
        vx: (vx || 0) * 0.15 + (Math.random() - 0.5) * 0.9, vy: 0.3 + Math.random() * 0.7, vz: (vz || 0) * 0.15 + (Math.random() - 0.5) * 0.9,
        life: 0.35 + Math.random() * 0.35, size: 0.1 + Math.random() * 0.1, r: 0.55, g: 0.42, b: 0.26, grav: -0.5, drag: 2.2, wob: 0.2
      });
    }
  }

  /* ---------- where it may stand ---------- */
  const clearLimit = () => ctx.W.R + 2.15;
  function spotOK(x, z) {
    if (Math.hypot(x, z) < clearLimit() + 0.1) return false;
    for (const s of ctx.safeZones) if (Math.hypot(x - s.x, z - s.z) < s.r + 0.8) return false;
    const p = { x, z };
    ctx.W.collide(p, 0.28);
    if (Math.hypot(p.x - x, p.z - z) >= 0.06) return false;
    for (const c of ctx.W.col.circles) if (Math.hypot(c.x - x, c.z - z) < c.r + 0.28 + 0.75) return false;   // room to get at it
    return true;
  }
  // push a point out of trunks, the clearing and every safe zone
  function legal(p) {
    const lim = clearLimit();
    for (let i = 0; i < 3; i++) {
      ctx.W.collide(p, 0.28);
      const d = Math.hypot(p.x, p.z);
      if (d < lim) { if (d < 0.001) { p.x = lim; p.z = 0; } else { p.x *= lim / d; p.z *= lim / d; } }
      for (const s of ctx.safeZones) {
        const dx = p.x - s.x, dz = p.z - s.z, dd = Math.hypot(dx, dz), l = s.r + 0.6;
        if (dd < l) { if (dd < 0.001) p.x += l; else { p.x = s.x + dx / dd * l; p.z = s.z + dz / dd * l; } }
      }
    }
    return p;
  }

  // the corridor-edge spot whose distance to the Hunter is nearest to `target`
  function pickEdge(target) {
    const h = ctx.hunter, W = ctx.W, hu = HH.w2uv(h.x, h.z), gu = HH.w2uv(G.x, G.z);
    const side0 = Math.sign(gu.v - W.pathV(gu.u)) || (G.pref || 1);
    let best = null, bs = 1e9;
    const u0 = Math.max(UMIN, hu.u - 22), u1 = Math.min(UMAX, hu.u + 22);
    for (let s = -1; s <= 1; s += 2) {
      for (let u = u0; u <= u1; u += 0.6) {
        const half = W.hw(u) - TG.edgeInset, p = HH.uv2w(u, W.pathV(u) + s * half);
        const d = Math.hypot(p.x - h.x, p.z - h.z);
        const sc = Math.abs(d - target) + (s !== side0 ? TG.sideSwitchCost : 0) + TG.alongCost * Math.abs(u - gu.u);
        if (sc >= bs) continue;
        if (!spotOK(p.x, p.z)) continue;
        bs = sc; best = { x: p.x, z: p.z, u, s, d };
      }
    }
    return best;
  }
  function watchSpot() {
    const h = ctx.hunter, edge = ctx.st.lanRadius + TG.watchMargin;
    const target = G.creep > 0 ? Math.max(Math.min(edge, TG.creepMin), edge - G.creep) : edge, e = pickEdge(target);
    if (!e) return { x: G.x, z: G.z };
    G.pref = e.s;
    let x = e.x, z = e.z;
    if (e.d > target) { const k = target / e.d; x = h.x + (e.x - h.x) * k; z = h.z + (e.z - h.z) * k; }
    return legal({ x, z });
  }
  // the nearest treeline spot to run to
  function pickTreeline(away) {
    const h = ctx.hunter, W = ctx.W, gd = dist2(G.x, G.z, h.x, h.z), gu = HH.w2uv(G.x, G.z);
    let best = null, bs = 1e9;
    for (let s = -1; s <= 1; s += 2) {
      for (let u = Math.max(UMIN, gu.u - 10); u <= Math.min(UMAX, gu.u + 10); u += 0.7) {
        const p = HH.uv2w(u, W.pathV(u) + s * (W.hw(u) - TG.edgeInset));
        let sc = dist2(p.x, p.z, G.x, G.z);
        const dh = dist2(p.x, p.z, h.x, h.z);
        if (away && dh < gd + 1.0) sc += 8 + (gd + 1 - dh);
        if (sc >= bs) continue;
        if (!spotOK(p.x, p.z)) continue;
        bs = sc; best = p;
      }
    }
    return best || { x: G.x, z: G.z };
  }

  /* ---------- movement ---------- */
  // far from its goal it travels along an inner lane of the corridor rather than hugging the trunks at the edge
  function route(tx, tz) {
    const W = ctx.W, dist = Math.hypot(tx - G.x, tz - G.z);
    if (dist < 3.5) return { x: tx, z: tz };
    const g = HH.w2uv(G.x, G.z), t = HH.w2uv(tx, tz), du = t.u - g.u;
    const wu = clamp(g.u + clamp(du, -3, 3), UMIN - 1, UMAX + 1), hw = W.hw(wu);
    const frac = Math.abs(du) > 0.01 ? clamp(Math.abs(wu - g.u) / Math.abs(du), 0, 1) : 1;
    const gOff = g.v - W.pathV(g.u), tOff = clamp(t.v - W.pathV(t.u), -hw, hw);
    const off = clamp(lerp(gOff, tOff, frac), -0.55 * hw, 0.55 * hw);
    return HH.uv2w(wu, W.pathV(wu) + off);
  }
  // the first trunk or rock on the straight line a -> b (nearest to a), or null
  function blocker(ax, az, bx, bz, margin, skip) {
    const cs = ctx.W.col.circles, dx = bx - ax, dz = bz - az, L = Math.hypot(dx, dz);
    if (L < 0.01) return null;
    const ux = dx / L, uz = dz / L, x0 = Math.min(ax, bx) - 2, x1 = Math.max(ax, bx) + 2, z0 = Math.min(az, bz) - 2, z1 = Math.max(az, bz) + 2;
    let best = null, bt = 1e9;
    for (let i = 0; i < cs.length; i++) {
      const c = cs[i];
      if (c === skip || c.x < x0 || c.x > x1 || c.z < z0 || c.z > z1) continue;
      const rx = c.x - ax, rz = c.z - az, t = rx * ux + rz * uz;
      if (t < -0.3 || t > L + 0.3) continue;
      if (Math.abs(rx * uz - rz * ux) >= c.r + 0.28 + margin || t >= bt) continue;
      bt = t; best = c;
    }
    return best;
  }
  // if a trunk or rock stands between it and its goal, aim for a point round it: the best of a ring of waypoints
  function detour(gx, gz) {
    if (Math.hypot(gx - G.x, gz - G.z) < 2.0) { G.wp = null; return { x: gx, z: gz }; }
    const c = blocker(G.x, G.z, gx, gz, 0.03);
    if (!c) { G.wp = null; return { x: gx, z: gz }; }
    if (G.wp && G.wp.c === c && Math.hypot(G.wp.x - G.x, G.wp.z - G.z) > 0.4 && !blocker(G.x, G.z, G.wp.x, G.wp.z, 0.02, c)) return { x: G.wp.x, z: G.wp.z };
    const W = ctx.W, rad = c.r + 0.28 + 0.4;
    let best = null, bs = 1e9;
    for (let i = 0; i < 14; i++) {
      const a = i / 14 * TAU, wx = c.x + Math.cos(a) * rad, wz = c.z + Math.sin(a) * rad;
      const uv = HH.w2uv(wx, wz);
      if (Math.abs(uv.v - W.pathV(uv.u)) > W.hw(uv.u) - 0.15) continue;
      let sc = Math.hypot(wx - G.x, wz - G.z) + Math.hypot(gx - wx, gz - wz);
      if (blocker(G.x, G.z, wx, wz, 0.02, c)) sc += 6;
      if (blocker(wx, wz, gx, gz, 0.05, c)) sc += 3;
      if (sc < bs) { bs = sc; best = { x: wx, z: wz }; }
    }
    G.wp = best ? { c, x: best.x, z: best.z } : null;
    return best || { x: gx, z: gz };
  }
  function steer(tx, tz, speed, rate, dt) {
    const goal = route(tx, tz);
    const dx = goal.x - G.x, dz = goal.z - G.z, d = Math.hypot(dx, dz), want = Math.min(speed, Math.hypot(tx - G.x, tz - G.z) * 7);
    let ux = d > 1e-4 ? dx / d : 0, uz = d > 1e-4 ? dz / d : 0;
    if (d > 1e-4) { const w = detour(goal.x, goal.z), wx = w.x - G.x, wz = w.z - G.z, wl = Math.hypot(wx, wz) || 1; ux = wx / wl; uz = wz / wl; }
    // stuck against something: back off towards the middle of the path for a moment
    if (want > 2 && G.moved < want * 0.2) G.stuckT += dt; else G.stuckT = Math.max(0, G.stuckT - dt);
    if (G.stuckT > 0.45) {
      const gu = HH.w2uv(G.x, G.z), cc = HH.uv2w(gu.u, ctx.W.pathV(gu.u)), cx = cc.x - G.x, cz = cc.z - G.z, cl = Math.hypot(cx, cz) || 1;
      ux = cx / cl; uz = cz / cl;
      if (G.stuckT > 1.0) G.stuckT = 0;
    }
    const k = 1 - Math.exp(-rate * dt);
    G.vx += (ux * want - G.vx) * k; G.vz += (uz * want - G.vz) * k;
    G.x += G.vx * dt; G.z += G.vz * dt;
  }
  function settleLegal() {
    const p = legal({ x: G.x, z: G.z });
    if (Math.abs(p.x - G.x) > 1e-4 || Math.abs(p.z - G.z) > 1e-4) {
      G.x = p.x; G.z = p.z;
    }
  }
  function doHop(tx, tz, h, then) {
    const p = legal({ x: tx, z: tz }), g = TG.gravity, vy = Math.sqrt(2 * g * Math.max(0.02, h)), Tt = 2 * vy / g;
    G.hop = { tx: p.x, tz: p.z, vx: (p.x - G.x) / Tt, vz: (p.z - G.z) / Tt, then };
    G.vy = vy; G.y = 0.001; G.vx = G.vz = 0;
  }
  function physics(dt) {
    if (!G.hop) return;
    G.vy -= TG.gravity * dt;
    G.y += G.vy * dt;
    G.x += G.hop.vx * dt; G.z += G.hop.vz * dt;
    if (G.y <= 0 && G.vy < 0) {
      const hp = G.hop;
      G.y = 0; G.vy = 0; G.x = hp.tx; G.z = hp.tz; G.hop = null;
      G.sq = Math.max(G.sq, 0.4); G.sqv = 0;
      dust(G.x, G.z, 5);
      if (G.tum) { G.tum = null; G.pitch = 0; }
      if (hp.then) hp.then();
    }
  }

  /* ---------- the moods ---------- */
  function defaults() {
    P.aL = -0.35; P.aR = -0.35; P.azL = 0.16; P.azR = -0.16; P.curl = 0.55; P.lean = 0.05; P.hp = -0.22; P.hy = 0;
    P.earBack = 0; P.earUp = 0; P.swing = 1; P.eyeOpen = 1; P.eyeK = TG.eyeGlow; P.bob = 1; P.shake = 0;
  }
  function setHidden(hide) {
    G.mood = 'hidden'; G.ph = ''; G.t = 0;
    R.root.visible = false;
    G.hideT = Math.max(0, hide || 0);
    G.hasLog = false; G.hop = null; G.tum = null; G.y = 0; G.vy = 0; G.vx = G.vz = 0; G.pitch = 0; G.appear = 1; G.sq = 0; G.sqv = 0;
    G.feintT = -1; G.lungeT = -1; G.gl = null; G.wp = null; G.stuckT = 0; G.creep = 0;
    R.hold.visible = false;
    setBody(true);
  }
  function canArrive(strict) {
    const st = ctx.st, h = ctx.hunter;
    if (st.home || st.fuel <= 0 || st.flare > 0) return false;
    if (ctx.safeZones.some(z => Math.hypot(h.x - z.x, h.z - z.z) < z.r)) return false;
    if (!strict) return true;
    return G.hideT <= 0 && G.flareHold <= 0 && G.away >= TG.arriveAfter && HH.w2uv(h.x, h.z).u > TG.arriveMinU;
  }
  function beginGlint() {
    const e = pickEdge(Math.min(ctx.st.lanRadius + TG.watchMargin, TG.glintReach));
    if (!e) { G.hideT = 2; return false; }
    G.x = e.x; G.z = e.z; G.y = 0; G.vx = G.vz = 0; G.pref = e.s;
    G.face = angTo(G.x, G.z, ctx.hunter.x, ctx.hunter.z);
    G.sq = 0; G.sqT = 0.2; G.appear = 1; G.eyeOpen = 0.05;
    setBody(false);
    R.root.visible = true;
    enter('glint');
    leaves(G.x, 0.3, G.z, 7, 0.8);
    return true;
  }
  function beginEmerge() {
    setBody(true);
    G.appear = 0.05;
    enter('emerge', 'wind');
    leaves(G.x, 0.4, G.z, 12, 1.4);
  }
  function startWatch() { enter('watch'); G.tx = G.x; G.tz = G.z; G.spotT = 0; }
  function nextFeintGap() {
    const wood = ctx.wood ? ctx.wood.count() : 0, mx = ctx.wood && ctx.wood.max || 5;
    const k = clamp(0.5 * wood / mx + 0.5 * (1 - ctx.st.fuel / TG.feintBelow), 0, 1);
    return lerp(TG.feintGapLong, TG.feintGapShort, k) * rnd(0.8, 1.2);
  }
  function beginFeint() {
    enter('feint', 'wind');
    G.fx = G.x; G.fz = G.z;
  }
  function beginFlee(o) {
    o = o || {};
    if (G.mood === 'glint') { setHidden(o.hide); return; }
    const p = pickTreeline(o.away !== false);
    G.fleeTo = p; G.leave = o.hide || 0; G.fleeSpeed = o.speed || TG.fleeSpeed;
    G.hop = null; G.y = 0; G.vy = 0; G.tum = null; G.pitch = 0;
    enter('flee');
  }
  function beginStartle() {
    enter('startle');
    G.vx = G.vz = 0;
    G.sq = 0.3;
    doHop(G.x, G.z, 0.6, () => beginFlee({ hide: 0 }));
  }
  function beginTumble() {
    const h = ctx.hunter;
    let dx = G.x - h.x, dz = G.z - h.z; const d = Math.hypot(dx, dz) || 1; dx /= d; dz /= d;
    G.face = angTo(G.x, G.z, h.x, h.z);
    enter('tumble', 'air');
    G.leave = TG.repelAway; G.vx = G.vz = 0;
    G.feintT = G.lungeT = -1;
    const tmp = { x: G.x + dx * 2.6, z: G.z + dz * 2.6 };
    G.tum = { t: 0, dur: 2 * Math.sqrt(2 * 0.8 * TG.gravity) / TG.gravity };
    doHop(tmp.x, tmp.z, 0.8, () => { G.ph = 'dazed'; G.t = 0; G.sq = 0.5; });
    ctx.sparks(G.x, 0.7, G.z, 12, { speed: 1.8, up: 1.6, size: 0.07 });
  }
  function beginFlinch() {
    const h = ctx.hunter;
    let dx = G.x - h.x, dz = G.z - h.z; const d = Math.hypot(dx, dz) || 1; dx /= d; dz /= d;
    enter('flinch', 'air');
    G.vx = G.vz = 0;
    doHop(G.x + dx * TG.flinchHop, G.z + dz * TG.flinchHop, 0.28, () => { G.ph = 'hold'; G.t = 0; });
  }
  function enterGrab() {
    const got = ctx.wood ? ctx.wood.take(1) : 0;
    G.vx = G.vz = 0;
    if (got > 0) {
      G.hasLog = true; G.logK = 0; R.hold.visible = true;
      ctx.hunter.hop = 1;
      vtmp = vtmp || new T.Vector3();
      ctx.wood.packPos(vtmp);
      ctx.sparks(vtmp.x, Math.max(0.6, vtmp.y), vtmp.z, 16, { speed: 2.0, up: 2.2, size: 0.08 });
      enter('grab');
      G.leave = TG.stolenAway;
      doHop(G.x, G.z, 0.3, () => beginFlee({ hide: TG.stolenAway }));
    } else {
      enter('skid');
    }
  }

  function moodStep(dt) {
    const st = ctx.st, h = ctx.hunter;
    defaults();
    const dH = dist2(G.x, G.z, h.x, h.z), toH = angTo(G.x, G.z, h.x, h.z);
    G.t += dt;
    const t = G.t;
    switch (G.mood) {
      case 'hidden':
        if (canArrive(true)) beginGlint();
        break;

      case 'glint': {
        turn(toH, 12, dt);
        // eyes open, a blink to catch the eye, then steady with a faint pulse
        let o = smooth(0.12, 0.3, t);
        if (t > 0.5 && t < 0.6) o = 0.08;
        G.eyeOpen = o;
        P.eyeK = TG.eyeGlow * (1.15 + 0.2 * Math.sin(t * 14));
        G.leafAcc += dt;
        if (G.leafAcc > 0.16) { G.leafAcc = 0; leaves(G.x, 0.45, G.z, 3, 0.7); }
        if (t >= TG.glintSeconds) beginEmerge();
        break;
      }

      case 'emerge':
        turn(toH, 12, dt);
        G.appear = Math.min(1, G.appear + dt / 0.25);
        P.lean = 0.1;
        if (G.ph === 'wind') {
          G.sqT = 0.42; P.aL = P.aR = 0.5;
          if (t >= TG.hopWind) {
            const w = watchSpot();
            doHop(w.x, w.z, TG.hopHeight, () => { G.ph = 'settle'; G.t = 0; });
            G.ph = 'air';
          }
        } else if (G.ph === 'air') {
          G.sqT = -0.2; P.aL = P.aR = -1.6; P.azL = 0.5; P.azR = -0.5;
        } else {
          G.sqT = 0;
          if (t > 0.3) startWatch();
        }
        break;

      case 'watch': {
        G.sqT = 0;
        turn(toH, 11, dt);
        G.spotT -= dt;
        if (G.spotT <= 0) { G.spotT = 0.12; const w = watchSpot(); G.wx = w.x; G.wz = w.z; }
        const k = 1 - Math.exp(-TG.spotSmooth * dt);
        G.tx += ((G.wx === undefined ? G.x : G.wx) - G.tx) * k;
        G.tz += ((G.wz === undefined ? G.z : G.wz) - G.tz) * k;
        const dd = dist2(G.x, G.z, G.tx, G.tz);
        steer(G.tx, G.tz, dd > 5 ? TG.catchUpSpeed : TG.scurrySpeed, 12, dt);
        // idle: look over the shoulder now and then
        G.glT -= dt;
        if (G.glT <= 0 && !G.gl && dd < 0.5) { G.gl = { t: 0, dir: Math.random() < 0.5 ? -1 : 1 }; G.glT = rnd(3, 6.5); }
        const wood = ctx.wood ? ctx.wood.count() : 0, low = st.fuel < TG.feintBelow, vlow = st.fuel < ctx.TUNE.lanternLowAt;
        if (wood > 0 && low) {
          if (G.feintT < 0) G.feintT = nextFeintGap();
          if (vlow && G.lungeT < 0) G.lungeT = rnd(TG.lungeWaitMin, TG.lungeWaitMax);
          G.feintT -= dt; if (vlow) G.lungeT = Math.max(0, G.lungeT - dt);   // at 0 a lunge is due, and stays due until it can be made
          const settled = dd < 1.0 && t > 0.6;
          const due = vlow && G.lungeT <= 0 && dH < 10;
          if (due && settled && inSight()) { enter('crouch'); G.lungeT = -1; G.creep = 0; }
          else {
            // a lunge is due but it stands out of sight: it edges closer until it can be seen, and only then crouches
            if (due && !inSight()) G.creep = Math.min(8, (G.creep || 0) + TG.creepRate * dt);
            if (!due && G.feintT <= 0 && settled) beginFeint();
          }
        } else { G.feintT = -1; G.lungeT = -1; G.creep = Math.max(0, (G.creep || 0) - dt); }
        break;
      }

      case 'feint':
        turn(toH, 12, dt);
        if (G.ph === 'wind') {
          G.sqT = 0.45; P.aL = P.aR = 0.65; P.lean = -0.1; P.earBack = 0.6;
          if (t >= TG.feintWind) {
            const want = Math.max(TG.feintMinDist, dH - TG.feintDepth), k = dH > 0.01 ? (dH - want) / dH : 0;
            doHop(G.x + (h.x - G.x) * k, G.z + (h.z - G.z) * k, 0.2, () => { G.ph = 'hold'; G.t = 0; });
            G.ph = 'dart';
          }
        } else if (G.ph === 'dart') {
          G.sqT = -0.25; P.aL = P.aR = -1.6; P.azL = 0.1; P.azR = -0.1; P.curl = 0.1; P.lean = 0.4;
        } else if (G.ph === 'hold') {
          G.sqT = 0.15; P.aL = P.aR = -1.5; P.azL = 0.15; P.azR = -0.15; P.curl = 0.5 + 0.45 * Math.sin(t * 34); P.lean = 0.35;
          if (t >= TG.feintHold) {
            const w = watchSpot();
            doHop(w.x, w.z, 0.4, () => { G.ph = 'settle'; G.t = 0; });
            G.ph = 'retreat';
          }
        } else if (G.ph === 'retreat') {
          G.sqT = -0.15; P.aL = P.aR = -0.2; P.lean = -0.1;
        } else {
          G.sqT = 0;
          if (t > 0.3) { G.feintT = nextFeintGap(); startWatch(); }
        }
        break;

      case 'crouch':
        turn(toH, 14, dt);
        G.sqT = 0.5; P.aL = P.aR = 0.7; P.azL = 0.0; P.azR = 0.0; P.curl = 1; P.lean = 0.3; P.hp = -0.45; P.earBack = 1;
        P.eyeK = lerp(TG.eyeGlow, TG.eyeFlare, smooth(0, 0.3, t)); P.shake = 1;
        if (t >= TG.crouchSeconds) { if ((ctx.wood ? ctx.wood.count() : 0) > 0) { enter('dash'); G.sqT = -0.2; G.sq = -0.2; dust(G.x, G.z, 8); } else { startWatch(); } }
        break;

      case 'dash': {
        const dx = h.x - G.x, dz = h.z - G.z, d = Math.hypot(dx, dz) || 1;
        turn(Math.atan2(dx, dz), 16, dt);
        const sp = lerp(0, TG.dashSpeed, 1 - Math.exp(-t * 22));
        G.vx = dx / d * sp; G.vz = dz / d * sp;
        G.x += G.vx * dt; G.z += G.vz * dt;
        G.sqT = -0.12; P.aL = P.aR = -1.45; P.azL = 0.25; P.azR = -0.25; P.curl = 0.1; P.lean = 0.5; P.hp = -0.55; P.swing = 0.35; P.eyeK = TG.eyeFlare;
        G.dustAcc += dt;
        if (G.dustAcc > 0.045) { G.dustAcc = 0; dust(G.x, G.z, 2, -G.vx, -G.vz); }
        if (d < TG.grabDist) enterGrab();
        else if (t >= TG.dashMax || !(ctx.wood && ctx.wood.count() > 0)) { enter('skid'); }
        break;
      }

      case 'skid': {
        const k = Math.exp(-8 * dt);
        G.vx *= k; G.vz *= k; G.x += G.vx * dt; G.z += G.vz * dt;
        turn(toH, 10, dt);
        G.sqT = t < 0.2 ? 0.35 : 0; P.aL = -0.3; P.aR = -0.3; P.azL = -0.9; P.azR = 0.9; P.lean = -0.35; P.earBack = 0.5; P.swing = 0;
        if (t < 0.25 && Math.hypot(G.vx, G.vz) > 1) { G.dustAcc += dt; if (G.dustAcc > 0.04) { G.dustAcc = 0; dust(G.x, G.z, 3, G.vx, G.vz); } }
        if (t >= TG.skidSeconds) { G.feintT = nextFeintGap(); G.lungeT = -1; startWatch(); }
        break;
      }

      case 'grab':
        turn(toH, 10, dt);
        G.sqT = -0.1; P.aL = P.aR = -1.2; P.azL = 0.5; P.azR = -0.5; P.curl = 1; P.earUp = 1; P.lean = 0.05; P.eyeK = TG.eyeFlare;
        break;

      case 'flee': {
        if (!G.fleeTo) G.fleeTo = pickTreeline(true);
        const dx = G.fleeTo.x - G.x, dz = G.fleeTo.z - G.z, d = Math.hypot(dx, dz);
        steer(G.fleeTo.x, G.fleeTo.z, G.fleeSpeed, 14, dt);
        if (Math.hypot(G.vx, G.vz) > 0.6) turn(Math.atan2(G.vx, G.vz), 14, dt);
        G.sqT = 0; P.lean = 0.35; P.earBack = 0.8;
        if (G.hasLog) { P.aL = P.aR = -1.2; P.azL = 0.5; P.azR = -0.5; P.curl = 1; P.swing = 0.1; }
        else { P.aL = P.aR = -0.3; P.swing = 1.2; }
        G.dustAcc += dt;
        if (G.dustAcc > 0.09) { G.dustAcc = 0; dust(G.x, G.z, 1, -G.vx, -G.vz); }
        if (d < 0.5 || (G.stuckT > 0.3 && d < 1.8) || t > 5) { enter("vanish"); leaves(G.x, 0.5, G.z, 10, 1.2); }
        break;
      }

      case 'vanish': {
        G.vx *= Math.exp(-10 * dt); G.vz *= Math.exp(-10 * dt); G.x += G.vx * dt; G.z += G.vz * dt;
        const k = clamp(t / 0.3, 0, 1);
        G.appear = Math.max(0.001, 1 - HH.easeInOut(k));
        G.sqT = 0.5 * k; P.lean = 0.5;
        P.eyeOpen = 1 - k; G.eyeOpen = 1 - k;
        if (G.hasLog) { P.aL = P.aR = -1.2; P.azL = 0.5; P.azR = -0.5; P.curl = 1; P.swing = 0; }
        if (t >= 0.3) { leaves(G.x, 0.4, G.z, 6, 0.9); setHidden(G.leave); }
        break;
      }

      case 'startle':
        turn(toH, 12, dt);
        G.sqT = -0.3; P.aL = P.aR = -2.9; P.azL = -0.5; P.azR = 0.5; P.curl = 0.0; P.earUp = 1; P.lean = -0.2; P.eyeK = TG.eyeFlare; P.eyeOpen = 1.3;
        break;

      case 'tumble':
        if (G.ph === 'air') {
          const k = G.tum ? clamp(G.t / G.tum.dur, 0, 1) : 1;
          G.pitch = -TAU * HH.easeOutCubic(k) * 1.0;
          P.aL = -2.3; P.aR = -2.6; P.azL = -0.9; P.azR = 0.9; P.curl = 0.1; P.earUp = 0.6; P.eyeOpen = 1.3; P.eyeK = TG.eyeFlare; P.swing = 0;
          G.sqT = -0.1;
        } else {
          G.pitch = 0; turn(angTo(G.x, G.z, h.x, h.z) + Math.PI, 8, dt);
          G.sqT = 0.45; P.aL = 0.1; P.aR = 0.1; P.azL = -0.4; P.azR = 0.4; P.earBack = 1; P.eyeOpen = 0.45; P.lean = 0.3; P.swing = 0;
          if (t >= 0.4) beginFlee({ hide: TG.repelAway, speed: TG.fleeSpeed * 1.2 });
        }
        break;

      case 'flinch':
        turn(toH, 10, dt);
        P.aR = -2.35; P.azR = -1.0; P.aL = -1.1; P.azL = 0.55; P.curl = 0.9; P.hy = -0.5; P.earBack = 0.9; P.eyeOpen = 0.3; P.lean = -0.15;
        if (G.ph === 'air') { G.sqT = -0.2; }
        else {
          G.sqT = 0.2;
          if (t >= TG.flinchSeconds) { G.feintT = G.feintT < 0 ? -1 : G.feintT; startWatch(); }
        }
        break;
    }
    if (G.mood !== 'tumble' && !G.tum) G.pitch = 0;
  }

  /* ---------- global rules, checked every step while it is out ---------- */
  function rules(inSafe) {
    const st = ctx.st, m = G.mood;
    if (m === 'hidden') return;
    const leaving = m === 'flee' || m === 'vanish' || m === 'startle' || m === 'tumble';
    if (m === 'glint' && !canArrive(false)) { setHidden(1); return; }
    if (leaving) return;
    if (st.fuel <= 0 && !st.home) beginFlee({ hide: 0 });
    else if (st.home || inSafe) { beginFlee({ hide: 0, away: false }); }
    else if (st.flare > 0) beginStartle();
  }

  /* ---------- pose: turns the mood's targets into the actual rig ---------- */
  function applyPose(dt) {
    const t = ctx.st.time;
    const kk = r => 1 - Math.exp(-r * dt);
    const air = G.y > 0.03 ? 1 : 0;
    const sp = G.hop ? 0 : Math.hypot(G.vx, G.vz), run = clamp(sp / TG.scurrySpeed, 0, 1.25);
    G.runPh += dt * (9 + 9 * run) * (run > 0.05 ? 1 : 0);
    const sw = Math.sin(G.runPh), bob = Math.abs(Math.cos(G.runPh)), breathe = Math.sin(t * 2.7);

    // smooth the targets
    const fields = [['aL', 16], ['aR', 16], ['azL', 14], ['azR', 14], ['curl', 18], ['lean', 10], ['hp', 10], ['hy', 8], ['earBack', 14], ['earUp', 14], ['swing', 10], ['eyeOpen', 18], ['eyeK', 14], ['shake', 20]];
    for (let i = 0; i < fields.length; i++) { const f = fields[i][0]; SP[f] = SP[f] === undefined ? P[f] : SP[f] + (P[f] - SP[f]) * kk(fields[i][1]); }

    // squash spring
    G.sqv += (-230 * (G.sq - G.sqT) - 16 * G.sqv) * dt;
    G.sq += G.sqv * dt;
    G.sq = clamp(G.sq, -0.45, 0.65);
    R.rig.scale.set(1 + G.sq * 0.45, 1 - G.sq, 1 + G.sq * 0.45);

    // root
    R.root.position.set(G.x, G.y, G.z);
    R.root.rotation.y = G.face;
    R.root.scale.setScalar(Math.max(0.001, G.appear));
    R.tum.rotation.x = G.pitch;

    // idle bob and breathing, scampering when it runs
    const shakeX = SP.shake * Math.sin(t * 70) * 0.012;
    R.rig.position.set(shakeX, -CY + bob * 0.07 * run + Math.sin(t * 3.3) * 0.006 * (1 - run) * SP.eyeOpen, 0);
    R.rig.rotation.x = SP.lean + run * 0.3 + breathe * 0.012;
    R.rig.rotation.z = sw * 0.07 * run;
    R.torso.scale.y = 1 + breathe * 0.02 * (1 - run);
    R.legL.rotation.x = air ? -0.7 : sw * 1.05 * run;
    R.legR.rotation.x = air ? -0.35 : -sw * 1.05 * run;

    // head: a look over the shoulder, a nod
    let hy = SP.hy;
    if (G.gl) {
      G.gl.t += dt;
      const k = G.gl.t / 1.2;
      if (k >= 1 || G.mood !== 'watch') G.gl = null; else hy += G.gl.dir * 1.0 * Math.pow(Math.sin(Math.PI * k), 0.6);
    }
    R.head.rotation.y = hy + Math.sin(t * 1.3) * 0.03;
    R.head.rotation.x = SP.hp + breathe * 0.015 - run * 0.1;
    R.head.rotation.z = -sw * 0.04 * run;

    // arms and fingers
    const swing = SP.swing * run * 0.95;
    R.armL.rotation.set(SP.aL - sw * swing + breathe * 0.03, 0, SP.azL);
    R.armR.rotation.set(SP.aR + sw * swing - breathe * 0.03, 0, SP.azR);
    const curl = -SP.curl * 1.35;
    R.fingers.L.forEach((f, i) => { f.rotation.x = curl * (0.85 + 0.15 * (i % 2)); });
    R.fingers.R.forEach((f, i) => { f.rotation.x = curl * (0.85 + 0.15 * (i % 2)); });

    // ears: twitch at random, lay back, perk up
    for (let i = 0; i < 2; i++) {
      G.twT[i] -= dt;
      if (G.twT[i] < 0) { G.tw[i] = 1; G.twT[i] = rnd(1.2, 4.2); }
      G.tw[i] *= Math.exp(-5 * dt);
      const e = R.ears[i], tilt = 0.55 - SP.earBack * 0.95 + SP.earUp * 0.5 + G.tw[i] * 0.45 * Math.sin(t * 46 + i);
      e.piv.rotation.y = -e.side * SP.earBack * 0.75 + e.side * SP.earUp * 0.1;
      e.tip.rotation.z = -e.side * (Math.PI / 2 - tilt);
    }

    // eyes: blink now and then, glow
    G.blinkT -= dt;
    let blink = 1;
    if (G.blinkT < 0.11 && G.mood !== 'glint') blink = 0.1;
    if (G.blinkT < 0) G.blinkT = rnd(2.2, 5);
    const op = (G.mood === 'glint' || G.mood === 'vanish') ? G.eyeOpen : SP.eyeOpen;
    G.eyeOpen = G.mood === 'glint' || G.mood === 'vanish' ? G.eyeOpen : 1;
    const es = Math.max(0.06, op * blink);
    const ef = G.mood === "glint" ? 1.5 : 1;
    R.eyes.forEach(e => { e.scale.set(ef, es * ef, ef); e.position.x = e.userData.side * 0.155 * (G.mood === "glint" ? 2.0 : 1); });
    R.eyeMat.color.setScalar(SP.eyeK);

    // held log pops in and sits between the hands
    G.logK = G.hasLog ? Math.min(1, G.logK + dt / 0.3) : 0;
    R.hold.scale.setScalar(Math.max(0.01, HH.easeOutBack(G.logK)));
    R.hold.position.set(0, 0.2 + Math.sin(G.runPh * 2) * 0.03 * run, 0.42);
  }

  // a soft glow round each eye so the glint reads without any body to see
  function halos(dt) {
    if (!R.root.visible) return;
    const es = (G.mood === 'glint' || G.mood === 'vanish') ? G.eyeOpen : SP.eyeOpen;
    if (es < 0.2) return;
    R.root.updateMatrixWorld(true);
    vtmp = vtmp || new T.Vector3();
    const k = (SP.eyeK / TG.eyeGlow) * TG.haloStrength * clamp(G.appear, 0, 1), big = G.mood === "glint" ? 1.35 : 1;
    R.eyes.forEach(e => {
      e.getWorldPosition(vtmp);
      ctx.particles.spawn({ x: vtmp.x, y: vtmp.y, z: vtmp.z, life: 0.04, size: 0.17 * big * (0.8 + 0.2 * k), r: 0.5 * k, g: 0.85 * k, b: 0.1 * k, fadeIn: 0.01 });
    });
  }

  /* ---------- events ---------- */
  function onRaise(c) {
    const st = c.st, m = G.mood, h = c.hunter;
    // playing alone: the Hunter's raise asks the Keeper for a stoke when things are bad, once per flare
    if (c.solo === 'hunter' && !G.latch && st.flare <= 0 && (st.fuel < c.TUNE.lanternLowAt || m === 'crouch' || m === 'dash')) {
      if (c.stoke()) { G.latch = true; G.latchT = 0; G.flareSeen = false; }
    }
    if (m === 'hidden' || m === 'glint' || m === 'flee' || m === 'vanish' || m === 'startle' || m === 'tumble' || m === 'grab') return;
    const d = dist2(G.x, G.z, h.x, h.z), near = d <= st.lanRadius * TG.driveScale + TG.drivePad;
    if (m === 'feint' || m === 'crouch' || m === 'dash' || m === 'skid' || near) beginTumble();
    else if (m === 'watch') beginFlinch();
    else if (m === 'flinch') { G.t = 0; }
  }

  function attachDebug() {
    if (!window.game || !window.game.debug) return;
    G.attached = true;
    const out = () => {
      if (G.mood === 'hidden' || G.mood === 'glint') {
        const w = watchSpot();
        G.x = w.x; G.z = w.z; G.y = 0; G.vx = G.vz = 0; G.appear = 1; G.eyeOpen = 1;
        G.face = angTo(G.x, G.z, ctx.hunter.x, ctx.hunter.z);
        setBody(true); R.root.visible = true; startWatch();
      }
    };
    window.game.debug.goblin = {
      state() {
        const h = ctx.hunter;
        return {
          mood: G.mood, phase: G.ph, t: +G.t.toFixed(2), x: +G.x.toFixed(2), z: +G.z.toFixed(2), y: +G.y.toFixed(2),
          dist: +dist2(G.x, G.z, h.x, h.z).toFixed(2), light: +ctx.st.lanRadius.toFixed(2), visible: R.root.visible, hasLog: G.hasLog,
          hideT: +G.hideT.toFixed(2), away: +G.away.toFixed(2), flareHold: +G.flareHold.toFixed(2),
          feintT: +G.feintT.toFixed(2), lungeT: +G.lungeT.toFixed(2), clearDist: +Math.hypot(G.x, G.z).toFixed(2), latch: G.latch, spot: [G.wx, G.wz], vel: [+G.vx.toFixed(2), +G.vz.toFixed(2)], tune: TG
        };
      },
      arrive() {
        G.hideT = 0; G.flareHold = 0; G.away = 99;
        if (G.mood === 'hidden') beginGlint();
        return this;
      },
      force(mood) {
        switch (mood) {
          case 'feint': out(); beginFeint(); break;
          case 'crouch': out(); enter('crouch'); break;
          case 'dash': out(); enter('dash'); break;
          case 'grab': {
            out();
            const h = ctx.hunter, a = angTo(h.x, h.z, G.x, G.z);
            G.x = h.x + Math.sin(a) * 0.8; G.z = h.z + Math.cos(a) * 0.8;
            enterGrab();
            break;
          }
          case 'repel': out(); beginTumble(); break;
          case 'scatter': out(); beginStartle(); break;
          case 'hide': setHidden(0); break;
        }
        return this;
      },
      raw: G,
      place(x, z) { out(); G.x = x; G.z = z; G.tx = x; G.tz = z; G.vx = G.vz = 0; return this; }
    };
  }

  HH.mechanics = HH.mechanics || [];
  HH.mechanics.push({
    name: 'goblin',
    init(c) {
      ctx = c;
      R = buildRig();
      defaults();
      Object.keys(P).forEach(k => { SP[k] = P[k]; });
      G.pref = Math.random() < 0.5 ? -1 : 1;
    },
    update(c, dt) {
      if (!G.attached) attachDebug();
      const st = c.st, h = c.hunter;
      const inSafe = c.safeZones.some(z => Math.hypot(h.x - z.x, h.z - z.z) < z.r);
      // timers
      if (st.flare > 0) { G.flareHold = TG.flareAfter; G.flareSeen = true; } else G.flareHold = Math.max(0, G.flareHold - dt);
      if (!st.home) G.away += dt; else G.away = 0;
      G.hideT = Math.max(0, G.hideT - dt);
      if (G.latch) {
        G.latchT += dt;
        if (G.flareSeen && st.flare <= 0) G.latch = false;
        else if (!G.flareSeen && G.latchT > 2.5) G.latch = false;
      }
      G.moved = G.lx === undefined ? 99 : Math.hypot(G.x - G.lx, G.z - G.lz) / dt; G.lx = G.x; G.lz = G.z;
      rules(inSafe);
      moodStep(dt);
      physics(dt);
      if (G.mood !== 'hidden') {
        if (!G.hop && G.mood !== 'dash' && G.mood !== 'skid' && G.mood !== 'glint') settleLegal();
        else if (G.mood === 'dash' || G.mood === 'skid') settleLegal();
        applyPose(dt);
        halos(dt);
      }
    },
    on(event, data, c) {
      if (!ctx) return;
      if (event === 'raise') onRaise(c);
      else if (event === 'stoke') {
        G.flareSeen = true;
        const m = G.mood;
        if (m === 'glint') setHidden(0);
        else if (m !== 'hidden' && m !== 'flee' && m !== 'vanish' && m !== 'startle' && m !== 'tumble') beginStartle();
      } else if (event === 'home') { G.away = 0; }
      else if (event === 'away') { G.away = 0; }
    }
  });
})();
