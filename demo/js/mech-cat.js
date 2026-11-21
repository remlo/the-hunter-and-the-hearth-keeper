/* mech-cat.js: a grey cat asleep on the red blanket of the bed in the cottage.
   It breathes, twitches an ear and flicks its tail now and then. When someone comes near the bed it lifts its head,
   opens its eyes and watches them; when they leave it blinks slowly and goes back to sleep.
   A log landing on the fire turns one ear and opens one eye for a moment. Scenery only: no prompt, no collision. */
(function () {
  'use strict';
  const T = THREE, HH = window.HH;
  const clamp = HH.clamp, lerp = HH.lerp, damp = HH.damp;

  /* ---------- tuning: everything to adjust by feel is here ---------- */
  const TUNE_CAT = {
    offsetX: 0.07,         // sideways from the bed's centre line (positive is towards the room, away from the wall)
    offsetZ: 0.5,          // along the bed from its middle towards the foot (the blanket covers about -0.28 to +0.97)
    blanketTop: 0.535,     // height of the blanket's top: the cat sits on this
    yaw: 0.95,             // which way it faces, in radians (0.785 looks straight at the game camera)
    size: 1.0,             // scales the whole cat (1.0 is about 0.5 long curled up)
    wakeDistance: 1.6,     // a character this close to the bed wakes it
    liftHead: 0.07,        // how far the head rises when awake
    lookLimit: 1.0,        // the most the head turns from straight ahead to watch someone (radians)
    breathRate: 1.7,       // breaths: radians per second (about one breath every 3.7 seconds)
    breathDepth: 0.045,    // how much the body swells with each breath (fraction of its height)
    wakeEase: 3.2,         // how quickly it wakes (higher is quicker)
    sleepEase: 2.2,        // how quickly it settles
    eyeEase: 5.5,           // how quickly the eyelids move
    settleBlink: 1.7,      // seconds of slow blinking before the head goes down again
    earTwitchEvery: [3.5, 8],    // seconds between ear twitches (min, max)
    earTwitchLen: 0.28,    // length of a twitch
    earTwitchSize: 0.45,   // how far the ear flicks (radians)
    tailFlickEvery: [4.5, 10],   // seconds between tail tip flicks
    tailFlickLen: 0.9,     // length of a flick
    tailFlickSize: 0.55,   // how far the tip swings (radians)
    stokeEyeSeconds: 1.7,  // how long one eye stays open after a log lands
    stokeEarSeconds: 2.2,  // how long one ear stays turned
    wakeHold: 5            // debug wake() keeps it awake this many seconds
  };

  const G = { cat: null, attached: false, built: false };
  const S = {
    t: 0, alert: 0, lookYaw: 0, eyeL: 0, eyeR: 0, state: 'asleep', settleT: -1, prevNear: false, holdT: 0,
    earT: [-1, -1], earNext: 4, earWho: 0, tailT: -1, tailNext: 6, stokeEye: -1, stokeEar: -1, stokeSide: 0, stokeWho: 0
  };

  /* ---------- small builders (the character code's helpers are private to it) ---------- */
  const SPH = new T.SphereGeometry(1, 20, 14), CONE = new T.ConeGeometry(1, 1, 14);
  const ball = (k, rx, ry, rz, x, y, z, color, o) => k.geo(SPH, x, y, z, color, Object.assign({ s: [rx, ry, rz], smooth: true }, o));
  const part = (fn, parent, x, y, z) => {
    const k = new HH.Kit();
    fn(k);
    const g = k.build();
    g.position.set(x || 0, y || 0, z || 0);
    if (parent) parent.add(g);
    return g;
  };
  const rnd = r => r[0] + Math.random() * (r[1] - r[0]);
  // a smooth 0 to 1 to 0 pulse over t in 0..1
  const pulse = u => (u <= 0 || u >= 1) ? 0 : Math.sin(u * Math.PI);

  function buildCat(ctx) {
    const C = HH.col;
    const grey = C(0x9a9ca4), greyD = C(0x6d7079), greyL = C(0xb0b2b8), pale = C(0xe3dfd8), pink = C(0xe99aa2), nose = C(0xdd7f8c);
    const eyeC = C(0x2c2224), eyeOpen = C(0xd9e86a), pupil = C(0x24301a);

    const root = new T.Group();            // sits on the blanket, turned to face the camera
    const body = new T.Group();            // breathes: scaled upward from its base
    root.add(body);

    // the curled body, a haunch that bulges at the side, and a pale chest under the chin
    part(k => {
      ball(k, 0.2, 0.125, 0.215, 0, 0.115, -0.03, grey);
      ball(k, 0.115, 0.105, 0.14, 0.11, 0.1, -0.1, grey);
      ball(k, 0.125, 0.085, 0.1, 0, 0.075, 0.115, pale);
      // darker stripes across the back, following its curve
      const surf = z => 0.115 + 0.125 * Math.sqrt(Math.max(0, 1 - Math.pow((z + 0.03) / 0.215, 2)));
      [-0.13, -0.065, 0.0, 0.065].forEach((z, i) => {
        const slope = Math.atan2(surf(z + 0.01) - surf(z - 0.01), 0.02);
        ball(k, 0.085 - i * 0.004, 0.017, 0.022, 0.01 * i, surf(z) - 0.004, z, greyD, { rx: -slope });
      });
      [-0.1, -0.03].forEach((z, i) => {
        const slope = Math.atan2(surf(z + 0.01) - surf(z - 0.01), 0.02);
        ball(k, 0.04, 0.015, 0.02, 0.13 + i * 0.02, surf(z) - 0.03, z + 0.0, greyD, { rx: -slope, rz: -0.9 });
      });
    }, body);

    // the head, resting on two pale paws
    const head = new T.Group();
    head.position.set(0, 0.12, 0.21);
    head.scale.setScalar(1.12);
    root.add(head);
    part(k => {
      ball(k, 0.125, 0.1, 0.105, 0, 0, 0, grey);
      ball(k, 0.07, 0.03, 0.05, 0, 0.085, 0.02, greyD);                              // a dark patch on the crown
      ball(k, 0.065, 0.045, 0.05, 0, -0.04, 0.075, pale);                            // muzzle
      ball(k, 0.05, 0.035, 0.04, -0.05, -0.05, 0.065, pale);
      ball(k, 0.05, 0.035, 0.04, 0.05, -0.05, 0.065, pale);
      ball(k, 0.018, 0.012, 0.013, 0, -0.012, 0.118, nose);                          // nose
      [-1, 1].forEach(s => ball(k, 0.03, 0.009, 0.01, s * 0.058, 0.05, 0.088, greyD, { rx: 0.3, rz: s * 0.12 }));   // brow marks
    }, head);
    // whiskers are left out on purpose: at this size they would shimmer

    const eyes = [];
    [-1, 1].forEach(s => {
      const eg = new T.Group();
      eg.position.set(s * 0.058, 0.016, 0.083);
      head.add(eg);
      const closed = part(k => ball(k, 0.03, 0.0075, 0.012, 0, 0, 0, eyeC, { rz: s * -0.18 }), eg);
      const open = part(k => {
        ball(k, 0.026, 0.026, 0.015, 0, 0, 0, eyeOpen);
        ball(k, 0.009, 0.02, 0.012, 0, 0, 0.007, pupil);
      }, eg);
      [closed, open].forEach(g => g.traverse(m => { m.castShadow = false; }));
      open.scale.set(1, 0.001, 1);
      eyes.push({ closed, open });
    });

    // ears: a soft cone with a pink inner, pivoting at its base
    const ears = [-1, 1].map(s => {
      const pivot = new T.Group();
      pivot.position.set(s * 0.078, 0.082, -0.015);
      head.add(pivot);
      const baseZ = s * -0.28;
      pivot.rotation.set(0.12, 0, baseZ);
      part(k => {
        k.geo(CONE, 0, 0.045, 0, grey, { s: [0.05, 0.1, 0.03], smooth: true });
        k.geo(CONE, 0, 0.04, 0.014, pink, { s: [0.03, 0.07, 0.014], smooth: true });
      }, pivot);
      return { pivot, baseZ, side: s };
    });

    // front paws, tucked under the chin
    [-1, 1].forEach(s => part(k => {
      ball(k, 0.042, 0.032, 0.06, 0, 0, 0, pale);
    }, root, s * 0.06, 0.03, 0.285));

    // the tail: a chain of soft balls curling round the body from behind to the front, the end of it a pivot that flicks
    const tail = new T.Group();
    root.add(tail);
    const N = 12, tipFrom = 8, pts = [];
    for (let i = 0; i < N; i++) {
      const u = i / (N - 1), ph = lerp(Math.PI * 0.92, 0.72, u), R = 0.255;
      pts.push({ x: Math.sin(ph) * R + 0.01, z: Math.cos(ph) * R * 0.9 - 0.03, r: lerp(0.056, 0.038, u) });
    }
    part(k => pts.forEach((p, i) => { if (i < tipFrom) ball(k, p.r, p.r, p.r * 1.05, p.x, p.r * 0.92, p.z, i % 2 ? greyD : grey); }), tail);
    const tip = new T.Group();
    tip.position.set(pts[tipFrom - 1].x, 0, pts[tipFrom - 1].z);
    tail.add(tip);
    part(k => pts.forEach((p, i) => {
      if (i >= tipFrom) ball(k, p.r, p.r, p.r * 1.05, p.x - pts[tipFrom - 1].x, p.r * 0.92, p.z - pts[tipFrom - 1].z, i === N - 1 ? greyD : (i % 2 ? greyD : grey));
    }), tip);

    root.scale.setScalar(TUNE_CAT.size);
    ctx.scene.add(root);
    return { root, body, head, eyes, ears, tail, tip };
  }

  function bedPos(ctx) {
    const c = ctx.W.cot;
    return { bx: c.x0 + 0.68, bz: c.z0 + 1.25 };
  }

  function nearest(ctx, bx, bz) {
    let best = null, bd = 1e9;
    [ctx.keeper, ctx.hunter].forEach(c => {
      const d = Math.hypot(c.x - bx, c.z - bz);
      if (d < bd) { bd = d; best = c; }
    });
    return { who: best, d: bd };
  }

  function placeCat(ctx) {
    const b = bedPos(ctx);
    G.cat.root.position.set(b.bx + TUNE_CAT.offsetX, TUNE_CAT.blanketTop - 0.008 * TUNE_CAT.size, b.bz + TUNE_CAT.offsetZ);
    G.cat.root.rotation.y = TUNE_CAT.yaw;
  }

  function attachDebug(ctx) {
    if (!window.game || !window.game.debug) return;
    G.attached = true;
    window.game.debug.cat = {
      state() {
        return {
          state: S.state, alert: +S.alert.toFixed(2), eyeLeft: +S.eyeL.toFixed(2), eyeRight: +S.eyeR.toFixed(2),
          lookYaw: +S.lookYaw.toFixed(2), earTwitch: S.earT[0] >= 0 || S.earT[1] >= 0, tailFlick: S.tailT >= 0,
          stokeEye: S.stokeEye >= 0, stokeEar: S.stokeEar >= 0, holdSeconds: +Math.max(0, S.holdT).toFixed(1),
          position: G.cat.root.position.toArray().map(v => +v.toFixed(3)), tune: TUNE_CAT
        };
      },
      wake() { S.holdT = TUNE_CAT.wakeHold; return this; }
    };
  }

  function animate(ctx, dt) {
    const c = G.cat, b = bedPos(ctx), tn = TUNE_CAT;
    S.t += dt;

    // who is near, and the waking and settling that follows
    const n = nearest(ctx, b.bx, b.bz);
    S.holdT -= dt;
    const near = n.d < tn.wakeDistance || S.holdT > 0;
    if (S.prevNear && !near) S.settleT = 0;      // they left: start the slow blinks
    if (near) S.settleT = -1;
    S.prevNear = near;
    let eyeTarget = 0, alertTarget = 0;
    if (near) { alertTarget = 1; eyeTarget = S.alert > 0.35 ? 1 : 0; }
    else if (S.settleT >= 0) {
      S.settleT += dt;
      const u = S.settleT;
      // eyes still open, then a slow blink, half open again, a second slow close; the head goes down at the end
      eyeTarget = u < 0.3 ? 1 : u < 0.75 ? 0 : u < 1.05 ? 0.8 : 0;
      alertTarget = u < tn.settleBlink * 0.55 ? 1 : 0;
      if (u > tn.settleBlink + 1.5) S.settleT = -1;
    }
    S.alert = damp(S.alert, alertTarget, alertTarget > S.alert ? tn.wakeEase : tn.sleepEase, dt);
    const awake = S.alert;

    // looking at whoever is nearest: turn the head from the body's heading towards them
    let lookTarget = 0;
    if (near || S.settleT >= 0) {
      let a = Math.atan2(n.who.x - c.root.position.x, n.who.z - c.root.position.z) - tn.yaw;
      while (a > Math.PI) a -= Math.PI * 2; while (a < -Math.PI) a += Math.PI * 2;
      lookTarget = clamp(a, -tn.lookLimit, tn.lookLimit);
    }
    S.lookYaw = damp(S.lookYaw, lookTarget * awake, 3.5, dt);

    // the log landing: one ear turns, one eye opens, then sleep on
    if (S.stokeEye >= 0) { S.stokeEye += dt; if (S.stokeEye > tn.stokeEyeSeconds) S.stokeEye = -1; }
    if (S.stokeEar >= 0) { S.stokeEar += dt; if (S.stokeEar > tn.stokeEarSeconds) S.stokeEar = -1; }
    let stokeEye = 0;
    if (S.stokeEye >= 0) {
      const u = S.stokeEye;
      stokeEye = u < 0.3 ? u / 0.3 : u < tn.stokeEyeSeconds - 0.5 ? 1 : (tn.stokeEyeSeconds - u) / 0.5;
      stokeEye = clamp(stokeEye, 0, 1) * 0.85;
    }
    const target = [eyeTarget, eyeTarget];
    target[S.stokeWho] = Math.max(target[S.stokeWho], stokeEye);
    S.eyeL = damp(S.eyeL, target[0], tn.eyeEase, dt);
    S.eyeR = damp(S.eyeR, target[1], tn.eyeEase, dt);
    const eyeAmt = [S.eyeL, S.eyeR];

    // idle twitches
    S.earNext -= dt;
    if (S.earNext <= 0 && S.earT[0] < 0 && S.earT[1] < 0) { S.earWho = Math.random() < 0.5 ? 0 : 1; S.earT[S.earWho] = 0; S.earNext = rnd(tn.earTwitchEvery); }
    for (let i = 0; i < 2; i++) if (S.earT[i] >= 0) { S.earT[i] += dt; if (S.earT[i] > tn.earTwitchLen) S.earT[i] = -1; }
    S.tailNext -= dt;
    if (S.tailNext <= 0 && S.tailT < 0) { S.tailT = 0; S.tailNext = rnd(tn.tailFlickEvery); }
    if (S.tailT >= 0) { S.tailT += dt; if (S.tailT > tn.tailFlickLen) S.tailT = -1; }

    // body: breathing swells it from its base; a little faster and shallower when awake
    const br = Math.sin(S.t * tn.breathRate * (1 + 0.25 * awake));
    const depth = tn.breathDepth * (1 - 0.4 * awake);
    c.body.scale.set(1 + br * depth * 0.5, 1 + br * depth, 1 + br * depth * 0.5);
    c.tail.position.y = br * 0.002;

    // head: rests on the paws asleep; lifts, turns and looks when awake
    const h = c.head;
    h.position.set(0, 0.12 + tn.liftHead * awake + br * 0.003, 0.21 - 0.025 * awake);
    h.rotation.set(lerp(0.16, -0.2, awake), S.lookYaw, lerp(0.07, 0, awake), 'YXZ');

    // eyes: a closed line fades out as the bright eye opens
    c.eyes.forEach((e, i) => {
      const o = clamp(eyeAmt[i], 0, 1);
      e.open.scale.set(1, Math.max(0.001, o), 1);
      e.open.visible = o > 0.03;
      e.closed.scale.set(1, 1, Math.max(0.001, 1 - o * 1.3));
      e.closed.visible = o < 0.7;
    });

    // ears: held back a little asleep, pricked when awake, plus twitches and the turn towards the fire
    c.ears.forEach((e, i) => {
      let tw = 0;
      if (S.earT[i] >= 0) tw = Math.sin((S.earT[i] / tn.earTwitchLen) * Math.PI * 2) * pulse(S.earT[i] / tn.earTwitchLen) * 1.6 * tn.earTwitchSize;
      let turn = 0;
      if (S.stokeEar >= 0 && i === S.stokeWho) {
        const u = S.stokeEar / tn.stokeEarSeconds;
        turn = clamp(Math.min(u / 0.15, (1 - u) / 0.25, 1), 0, 1);
      }
      const sleepPose = 1 - awake;
      e.pivot.rotation.z = e.baseZ * lerp(0.7, 1.0, sleepPose) + e.side * -0.08 * awake + tw * e.side - e.side * 0.2 * turn;
      e.pivot.rotation.x = 0.12 + 0.1 * sleepPose - 0.18 * awake - 0.35 * turn;
      e.pivot.rotation.y = -e.side * 0.45 * turn;
    });

    // tail tip flick
    if (S.tailT >= 0) {
      const u = S.tailT / tn.tailFlickLen;
      c.tip.rotation.y = Math.sin(u * Math.PI * 3) * pulse(u) * tn.tailFlickSize;
    } else c.tip.rotation.y = damp(c.tip.rotation.y, 0, 8, dt);

    // names for the state: asleep, waking, awake, settling
    S.state = awake < 0.04 && eyeAmt[0] < 0.05 && eyeAmt[1] < 0.05 ? (S.stokeEye >= 0 ? 'listening' : 'asleep')
      : near ? (awake > 0.9 ? 'awake' : 'waking') : (S.settleT >= 0 ? 'settling' : awake > 0.04 ? 'settling' : 'listening');
  }

  HH.mechanics = HH.mechanics || [];
  HH.mechanics.push({
    name: 'cat',
    init(ctx) {
      G.cat = buildCat(ctx);
      placeCat(ctx);
      G.built = true;
    },
    update(ctx, dt) {
      if (!G.built) return;
      if (!G.attached) attachDebug(ctx);
      animate(ctx, dt);
    },
    on(event, data, ctx) {
      if (event === 'stoke') {
        S.stokeEye = 0; S.stokeEar = 0; S.stokeWho = Math.random() < 0.5 ? 0 : 1;
      }
    }
  });
})();
