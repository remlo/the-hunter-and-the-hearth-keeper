/* mech-supper.js: the Hearth Keeper cooks supper at the hearth; eating it gives the Hunter sprint bursts (a better meal, more bursts).
   One press at the pot starts it, five stirs on the beat, and the meal waits in the pot until the Hunter comes home. */
(function () {
  'use strict';
  const HH = window.HH, T = window.THREE;

  /* ---------- tuning: every number you will want to feel out is here ---------- */
  const TUNE = {
    potX: -3.75, potZ: -2.0,        // beside the hearth, clear of the pile and the back wall
    reach: 1.0,                     // the Keeper claims the press this close to the pot
    leaveReach: 1.9,                // walk further than this and the beats wait
    beats: 5,
    beatSeconds: 1.1,               // the ring closes on the target this long after a beat begins
    goodWindow: 0.22,               // seconds either side of the moment of closing that counts as a good stir
    lateGrace: 0.28,                // a beat is missed this long after closing without a press
    beatGap: 0.32,                  // breath between beats
    goodNeeded: 3,                  // good stirs for a good supper
    goldenNeeded: 5,                // good stirs for golden
    sprint: { plain: 1, good: 2, golden: 3 },        // sprint bursts the Hunter gets from eating each kind of supper
    stewPale: 0xe3cf8f, stewRich: 0xa24a1f, stewGold: 0xe29a2c,
    ringColor: 0xf4e6c8, targetColor: 0xffb44a,
    eatSeconds: 1.8,                // the little eating scene after a homecoming
    basketX: -3.7, basketZ: -1.15,  // the wicker basket on the floor in front of the pot (+z side), its edge on the rug corner; any nearer the door wall (+x) and the wall hides it from the camera
    basketR: 0.27,                  // its collision circle
    larderMax: 3,                   // most carrots and most mushrooms the basket holds (each kind)
    larderReach: 1.7,               // how close a character must be to the basket for their things to hop in (for the other mechanics)
    hopSeconds: 0.42,               // a carrot or mushroom hopping from the basket into the pot
    hopGap: 0.28                    // delay between the carrot and the mushroom
  };

  const QUALITY_NAME = { plain: 'plain supper', good: 'good supper', golden: 'golden supper' };
  const QUALITY_ORDER = ['plain', 'good', 'golden'];

  const CSS = [
    '#supper-ready { display: none; align-items: center; gap: 7px; padding-left: 10px; margin-left: 2px; border-left: 1px solid var(--panel-line); white-space: nowrap; font-weight: 700; color: var(--ink); }',
    '#supper-ready.is-on { display: flex; }',
    '#supper-ready .lamp { width: 8px; height: 8px; border-radius: 50%; background: var(--ember); box-shadow: 0 0 8px rgba(255, 180, 74, 0.9); animation: supperLamp 1.8s ease-in-out infinite; }',
    '#supper-ready.is-golden .lamp { background: #ffd25e; box-shadow: 0 0 12px rgba(255, 210, 94, 1); }',
    '#supper-ready.is-pop { animation: supperPop 0.7s cubic-bezier(.2,1.5,.4,1); }',
    '@keyframes supperPop { 0% { transform: scale(0.6); } 55% { transform: scale(1.28); } 100% { transform: scale(1); } }',
    '@keyframes supperLamp { 0%, 100% { opacity: 0.55; } 50% { opacity: 1; } }',
    '@media (max-width: 860px) { #supper-ready .txt { display: none; } }',
    '@media (prefers-reduced-motion: reduce) { #supper-ready .lamp, #supper-ready.is-pop { animation: none; } }'
  ].join('\n');

  const BOWL_SVG = '<svg viewBox="0 0 24 20" width="20" height="17" aria-hidden="true">' +
    '<path class="steam" d="M8 5c-1.4-1.2 1.4-2.2 0-3.6" fill="none" stroke-width="1.5" stroke-linecap="round"/>' +
    '<path class="steam" d="M14 5c-1.4-1.2 1.4-2.2 0-3.6" fill="none" stroke-width="1.5" stroke-linecap="round"/>' +
    '<path class="stew" d="M3.6 8.2h16.8a8.4 8.4 0 0 1-16.8 0z"/>' +
    '<path d="M2 8.2h20" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" fill="none"/>' +
    '<path d="M8 17.6h8" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" fill="none"/></svg>';
  HH.bowlSvg = BOWL_SVG;                // the sprint marks in the Hunter's chip draw the same bowl

  const mech = {
    name: 'supper',
    phase: 'idle',                  // idle | cooking | ready | eating
    quality: null, good: 0, beat: 0,
    stirs: 0, beatState: 'gap', beatT: 0, beatPressed: false, gapT: 0.4,
    eatT: 0, pending: null,
    glow: 0, wobble: 0, wobbleV: 0, ladleSpin: 0, ladleVel: 0, depth: 0, shown: 0, promptK: 0, ringK: 0, resultT: 0, flash: 0, steamAcc: 0,
    ringFlash: 0, ringHit: 0, lastWas: '',
    fed: { carrot: false, mushroom: false },   // what went into the pot for this supper
    shake: 0, hops: [], needKey: ''
  };

  mech.init = function (ctx) {
    const T_ = ctx.T, W = ctx.W, scene = ctx.scene;
    this.ctx = ctx;
    const P = HH.PAL;
    const px = TUNE.potX, pz = TUNE.potZ;

    /* the pot: a stone ring to stand on, a round iron pot, a rim, handles, a ladle, and a stew surface that changes colour */
    const k = new HH.Kit();
    const ironC = HH.col(0x3a3638), ironL = HH.col(0x4c4648), stoneC = HH.tint(P.stone, -0.1, 0, 0), stoneL = HH.tint(P.stone, -0.02, 0, 0);
    // hearth stones it sits on, with an ember bed glowing between them
    k.cyl(0.46, 0.5, 0.07, 8, px, 0.035, pz, stoneC);
    for (let i = 0; i < 6; i++) {
      const a = i / 6 * Math.PI * 2 + 0.3;
      k.box(0.2, 0.14, 0.17, px + Math.cos(a) * 0.37, 0.12, pz + Math.sin(a) * 0.37, i % 2 ? stoneL : stoneC, { r: 0.05, ry: -a });
    }
    k.cyl(0.26, 0.26, 0.03, 8, px, 0.09, pz, HH.hdr(0xff7a2a, 1.5), { glow: true });
    const rootPot = new T_.Group();
    rootPot.position.set(px, 0, pz);
    scene.add(k.build({ cast: true }));

    const pk = new HH.Kit();
    // belly: three stacked tapering drums read as a round pot at this scale
    pk.cyl(0.26, 0.2, 0.12, 10, 0, 0.24, 0, ironC);
    pk.cyl(0.3, 0.26, 0.14, 10, 0, 0.37, 0, ironC);
    pk.cyl(0.29, 0.3, 0.1, 10, 0, 0.49, 0, ironL);
    pk.geo(new T_.TorusGeometry(0.3, 0.036, 5, 12), 0, 0.545, 0, ironL, { rx: Math.PI / 2 });   // open rim, so the stew shows
    pk.box(0.14, 0.05, 0.07, 0.37, 0.5, 0, ironL, { r: 0.02 });   // handles
    pk.box(0.14, 0.05, 0.07, -0.37, 0.5, 0, ironL, { r: 0.02 });
    pk.cyl(0.05, 0.05, 0.1, 6, 0.3, 0.45, 0.06, ironC, { rz: Math.PI / 2 });
    rootPot.add(pk.build());
    this.pot = rootPot;

    // the stew surface: its own mesh so the colour can move
    this.stewMat = HH.lit({ flat: true, color: HH.col(TUNE.stewPale).clone() });
    this.stew = new T_.Mesh(new T_.CylinderGeometry(0.275, 0.275, 0.04, 10), this.stewMat);
    this.stew.position.y = 0.53;
    rootPot.add(this.stew);
    // little things floating in it
    this.bits = [];
    const bitGeo = new T_.IcosahedronGeometry(1, 0);
    [[0x7e9641, 0.045], [0xdb7a2d, 0.05], [0xecd4a8, 0.04], [0xdb7a2d, 0.04], [0x7e9641, 0.036], [0xc9925a, 0.04]].forEach((b, i) => {
      const m = new T_.Mesh(bitGeo, HH.lit({ flat: true, color: HH.col(b[0]) }));
      m.scale.set(b[1], b[1] * 0.6, b[1]);
      m.userData = { a: i / 6 * 6.283, r: 0.1 + (i % 3) * 0.06, s: 0.4 + (i % 2) * 0.3 };
      rootPot.add(m);
      this.bits.push(m);
    });
    // the ladle
    this.ladle = new T_.Group();
    const lk = new HH.Kit();
    lk.cyl(0.03, 0.03, 0.72, 5, 0, 0.3, 0, HH.col(P.woodL), { rx: 0.2 });
    lk.cyl(0.075, 0.06, 0.05, 7, 0, -0.04, 0.0, HH.col(P.woodD), { rx: 0 });
    this.ladle.add(lk.build());
    this.ladle.position.set(0, 0.52, 0.02);
    rootPot.add(this.ladle);
    // gold glow disc over the pot, used by a golden supper
    const gcv = document.createElement('canvas'); gcv.width = gcv.height = 64;
    const gx = gcv.getContext('2d'), gr = gx.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.55, 'rgba(255,255,255,0.35)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    gx.fillStyle = gr; gx.fillRect(0, 0, 64, 64);
    this.glowMat = new T_.MeshBasicMaterial({ map: new T_.CanvasTexture(gcv), color: HH.hdr(0xffc060, 0.9), transparent: true, opacity: 0, depthWrite: false, blending: T_.AdditiveBlending });
    this.glowDisc = new T_.Mesh(new T_.CircleGeometry(0.62, 20), this.glowMat);
    this.glowDisc.rotation.x = -Math.PI / 2; this.glowDisc.position.y = 0.58; this.glowDisc.renderOrder = 4;
    rootPot.add(this.glowDisc);
    scene.add(rootPot);

    // collision: nobody walks through the pot, same as the other furniture
    W.col.circles.push({ x: px, z: pz, r: 0.42 });

    this.buildLarder(ctx);

    // the prompt and the ring above the pot
    this.prompt = HH.makePrompt('E');
    this.buildNeedPrompt();
    this.prompt.position.set(px, 1.5, pz + 0.1);
    this.prompt.visible = false;
    scene.add(this.prompt);

    this.ringCv = document.createElement('canvas');
    this.ringCv.width = this.ringCv.height = 192;
    this.ringTex = new T_.CanvasTexture(this.ringCv);
    this.ringTex.encoding = T_.sRGBEncoding;
    this.ring = new T_.Sprite(new T_.SpriteMaterial({ map: this.ringTex, transparent: true, depthTest: false, depthWrite: false }));
    this.ring.renderOrder = 11;
    this.ring.scale.setScalar(1.15);
    this.ring.position.set(px, 1.4, pz + 0.1);
    this.ring.visible = false;
    scene.add(this.ring);

    // a warm light for the pot, in a free warm slot, so a golden supper actually lights its corner
    this.slot = ctx.warm(6);   // slots 4 and 5 belong to the waystone
    this.slot.pos.set(px, 0.9, pz + 0.3, 0.001);
    this.slot.col.set(0, 0, 0);

    /* interface: a label by the Keeper's chip while supper waits (the Hunter's reward shows in the sprint marks) */
    const style = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);
    const chips = ctx.hud.querySelectorAll('.chip');
    this.readyEl = document.createElement('span');
    this.readyEl.id = 'supper-ready';
    this.readyEl.innerHTML = '<span class="lamp"></span><span class="txt"></span>';
    this.readyTxt = this.readyEl.querySelector('.txt');
    if (chips[0]) chips[0].appendChild(this.readyEl);
    this.stewColor = new T_.Color();
    this.setStew(0, 0);
  };

  /* stew colour from how many stirs have landed (depth 0..1) and how many were good */
  mech.setStew = function (stirs, good) {
    const d = Math.min(1, stirs * 0.1 + good * 0.1);        // 0 .. 1 (five good stirs = 1)
    this.depth = d;
    const c = this.stewMat.color;
    c.copy(HH.col(TUNE.stewPale)).lerp(HH.col(TUNE.stewRich), d);
    if (this.quality === 'golden' || (this.phase === 'ready' && this.quality === 'golden')) c.lerp(HH.col(TUNE.stewGold), 0.55);
  };

  mech.steam = function (ctx, n, strong) {
    const ps = ctx.particles;
    for (let i = 0; i < n; i++) {
      const a = Math.random() * 6.283, d = Math.random() * 0.2;
      ps.spawn({
        x: TUNE.potX + Math.cos(a) * d, y: 0.62 + Math.random() * 0.06, z: TUNE.potZ + Math.sin(a) * d,
        vx: (Math.random() - 0.5) * 0.25, vy: (strong ? 0.9 : 0.5) + Math.random() * (strong ? 0.8 : 0.4), vz: 0.08 + Math.random() * 0.15,
        life: 1.1 + Math.random() * 0.9, size: (strong ? 0.2 : 0.14) + Math.random() * 0.1,
        r: 0.5, g: 0.46, b: 0.4, grav: 0.25, drag: 0.9, wob: 0.18, fadeIn: 0.25
      });
    }
  };

  const clamp01 = x => Math.max(0, Math.min(1, x));

  /* ---------- the basket: carrots and mushrooms wait here for the pot ---------- */
  const KINDS = ['carrot', 'mushroom'];

  // a carrot: orange root, green top (origin in the middle of the root)
  function makeCarrot(P) {
    const k = new HH.Kit();
    k.cone(0.044, 0.27, 6, 0, 0, 0, HH.col(P.autumn), { rx: Math.PI });
    k.cyl(0.046, 0.044, 0.035, 6, 0, 0.1, 0, HH.col(P.autumnL));
    k.cyl(0.03, 0.04, 0.03, 6, 0, 0.14, 0, HH.col(P.leafD));
    [[0, 0.05, 0.38], [0.04, -0.02, -0.34], [-0.035, -0.04, 0.05]].forEach((l, i) => {
      k.cone(0.026, 0.17, 4, l[0], 0.23, l[1], HH.col(i === 2 ? P.leaf : P.leafL), { rz: l[2] * 0.9, rx: l[1] * 4 });
    });
    return k.build({ cast: true });
  }
  // a mushroom: the same red cap, white spots and cream stem that the forest ones are drawn with, a little larger
  function makeMushroom(P) {
    const k = new HH.Kit();
    k.cyl(0.036, 0.048, 0.13, 6, 0, 0.065, 0, HH.col(P.cream));
    k.cone(0.115, 0.09, 7, 0, 0.15, 0, HH.col(P.mushroom));
    [[0.045, 0.158, 0.035], [-0.055, 0.152, 0.025], [0.0, 0.136, -0.07], [0.0, 0.178, 0.0]].forEach((s, i) =>
      k.box(i === 3 ? 0.035 : 0.045, 0.028, i === 3 ? 0.035 : 0.045, s[0], s[1], s[2], HH.col(P.white), { r: 0.01 }));
    return k.build({ cast: true });
  }

  mech.buildLarder = function (ctx) {
    const T_ = ctx.T, W = ctx.W, P = HH.PAL;
    const bx = TUNE.basketX, bz = TUNE.basketZ, rim = 0.2;
    const root = new T_.Group();
    root.position.set(bx, 0, bz);
    const k = new HH.Kit();
    const wick = [HH.col(P.tan), HH.col(P.woodL), HH.col(P.tan)];
    k.cyl(0.2, 0.17, 0.05, 10, 0, 0.03, 0, HH.col(P.woodD));
    k.cyl(0.215, 0.2, 0.065, 10, 0, 0.085, 0, wick[0]);
    k.cyl(0.235, 0.215, 0.065, 10, 0, 0.15, 0, HH.col(P.brown));
    k.cyl(0.25, 0.235, 0.06, 10, 0, 0.21, 0, wick[2]);
    // weave: short vertical staves around the belly
    for (let i = 0; i < 10; i++) {
      const a = i / 10 * Math.PI * 2 + 0.15;
      k.box(0.05, 0.2, 0.03, Math.cos(a) * 0.228, 0.13, Math.sin(a) * 0.228, i % 2 ? HH.col(P.woodL) : HH.col(P.wood), { r: 0.01, ry: -a + Math.PI / 2 });
    }
    k.geo(new T_.TorusGeometry(0.245, 0.034, 5, 12), 0, rim + 0.04, 0, HH.col(P.woodD), { rx: Math.PI / 2 });   // braided rim
    k.cyl(0.205, 0.205, 0.012, 10, 0, rim + 0.045, 0, HH.col(P.woodDD));                                    // the dark inside, where things stand
    // a low handle arching over the mouth
    k.geo(new T_.TorusGeometry(0.24, 0.022, 5, 10, Math.PI), 0, rim + 0.04, 0, HH.col(P.woodD), { s: [1, 0.78, 1], rz: 0 });
    root.add(k.build({ cast: true }));
    ctx.scene.add(root);

    // what lies in it: three slots of each kind around the inside, a carrot and a mushroom alternating
    this.items = { carrot: [], mushroom: [] };
    this.larderN = { carrot: 0, mushroom: 0 };
    const floorY = rim + 0.052;
    KINDS.forEach((kind, ki) => {
      for (let i = 0; i < TUNE.larderMax; i++) {
        const a = Math.PI * 0.35 + (i * 2 + ki) / 6 * Math.PI * 2, rad = kind === 'carrot' ? 0.1 : 0.115;
        const outer = new T_.Group(), inner = new T_.Group();
        outer.position.set(Math.cos(a) * rad, floorY, Math.sin(a) * rad);
        outer.rotation.y = -a;
        if (kind === 'carrot') {
          inner.position.y = 0.07; inner.rotation.z = -0.42 - 0.08 * i;
          inner.add(makeCarrot(P));
        } else {
          inner.rotation.z = -0.1; inner.add(makeMushroom(P));
        }
        outer.add(inner);
        outer.visible = false;
        root.add(outer);
        this.items[kind].push({ g: outer, pop: 0, popT: 0 });
      }
    });
    this.basket = root;

    // two flyers for the hop into the pot
    this.flyers = KINDS.map(kind => {
      const g = new T_.Group(); g.add(kind === 'carrot' ? makeCarrot(P) : makeMushroom(P));
      g.visible = false; ctx.scene.add(g);
      return { kind, g, t: 0, from: new T_.Vector3(), live: false };
    });

    W.col.circles.push({ x: bx, z: bz, r: TUNE.basketR });

    const self = this;
    ctx.larder = {
      max: TUNE.larderMax,                          // most of each kind
      pos: { x: bx, y: floorY + 0.2, z: bz },       // where a thing flying to the basket should land (the basket's mouth)
      reach: TUNE.larderReach,                      // how close a character must be for their things to hop in
      count: kind => self.larderN[kind] || 0,
      room: kind => KINDS.indexOf(kind) < 0 ? 0 : TUNE.larderMax - self.larderN[kind],
      add: kind => self.larderAdd(kind)
    };
  };

  mech.larderAdd = function (kind) {
    if (KINDS.indexOf(kind) < 0 || this.larderN[kind] >= TUNE.larderMax) return false;
    const it = this.items[kind][this.larderN[kind]++];
    it.pop = 0.001; it.popT = 0; it.g.visible = true; it.g.scale.setScalar(0.001);
    const p = this.ctx.larder.pos;
    this.ctx.sparks(p.x, p.y, p.z, 9, { speed: 1.0, up: 1.6, size: 0.06, life: 0.7 });
    return true;
  };

  /* the pictures beside the key prompt: one small tile with a carrot and a mushroom, bright when the basket has one, grey when not */
  mech.buildNeedPrompt = function () {
    const T_ = this.ctx.T;
    this.needCv = document.createElement('canvas');
    this.needCv.width = 256; this.needCv.height = 128;
    this.needTex = new T_.CanvasTexture(this.needCv);
    this.needTex.encoding = T_.sRGBEncoding;
    this.keyImg = this.prompt.material.map.image;        // the shared key (or tap mark) tile, drawn once by the helper
    this.prompt.material.map = this.needTex;
    this.prompt.center.set(0.25, 0.5);          // the key tile stays over the pot, the pictures sit to its right
    this.drawNeedPrompt(true);
  };
  mech.drawNeedPrompt = function (force) {
    const key = this.larderN.carrot + ':' + this.larderN.mushroom;
    if (!force && key === this.needKey) return;
    this.needKey = key;
    const x = this.needCv.getContext('2d');
    x.clearRect(0, 0, 256, 128);
    x.drawImage(this.keyImg, 0, 0);
    const rr = (px, py, w, h, r) => { x.beginPath(); x.moveTo(px + r, py); x.arcTo(px + w, py, px + w, py + h, r); x.arcTo(px + w, py + h, px, py + h, r); x.arcTo(px, py + h, px, py, r); x.arcTo(px, py, px + w, py, r); x.closePath(); };
    x.fillStyle = 'rgba(30,20,16,0.55)'; rr(122, 28, 118, 84, 20); x.fill();
    x.fillStyle = '#f3e3c2'; rr(122, 20, 118, 84, 20); x.fill();
    const has = { carrot: this.larderN.carrot > 0, mushroom: this.larderN.mushroom > 0 };
    // carrot
    x.save(); x.translate(156, 62); x.rotate(0.62); x.globalAlpha = has.carrot ? 1 : 0.55;
    x.fillStyle = has.carrot ? '#e8832f' : '#a8a095';
    x.beginPath(); x.moveTo(-9, -22); x.lineTo(9, -22); x.lineTo(0, 24); x.closePath(); x.fill();
    x.fillStyle = has.carrot ? '#f2a449' : '#bcb4a8'; x.fillRect(-9, -22, 18, 6);
    x.fillStyle = has.carrot ? '#6f9a35' : '#9a9a8c';
    [[-7, -0.5], [0, 0], [7, 0.5]].forEach(l => { x.save(); x.translate(l[0] * 0.6, -22); x.rotate(l[1]); x.beginPath(); x.moveTo(-4, 0); x.lineTo(4, 0); x.lineTo(0, -20); x.closePath(); x.fill(); x.restore(); });
    x.restore();
    // mushroom
    x.save(); x.translate(208, 66); x.globalAlpha = has.mushroom ? 1 : 0.55;
    x.fillStyle = has.mushroom ? '#ecd4a8' : '#c9c1b2';
    rr(-8, -2, 16, 24, 5); x.fill();
    x.fillStyle = has.mushroom ? '#c5513d' : '#a8a095';
    x.beginPath(); x.ellipse(0, 0, 24, 21, 0, Math.PI, 0); x.closePath(); x.fill();
    x.fillStyle = has.mushroom ? '#f5ecd9' : '#d4cdc0';
    [[-10, -9, 4.5], [8, -12, 4], [1, -3, 3.4]].forEach(s => { x.beginPath(); x.arc(s[0], s[1], s[2], 0, 7); x.fill(); });
    x.restore();
    this.needTex.needsUpdate = true;
  };

  mech.updateLarder = function (ctx, dt) {
    // things that have just landed pop in
    KINDS.forEach(kind => this.items[kind].forEach((it, i) => {
      if (i >= this.larderN[kind]) { it.g.visible = false; return; }
      it.g.visible = true;
      if (it.pop < 1) { it.popT += dt / 0.34; it.pop = HH.easeOutBack(clamp01(it.popT)); if (it.popT >= 1) it.pop = 1; }
      it.g.scale.setScalar(Math.max(0.001, it.pop));
    }));
    // things hopping from the basket into the pot
    const T_ = ctx.T;
    for (const f of this.flyers) {
      if (!f.live) continue;
      f.t += dt / TUNE.hopSeconds;
      if (f.t < 0) { f.g.visible = false; continue; }
      const k = clamp01(f.t), e = HH.easeInOut(k);
      f.g.visible = true;
      f.g.position.set(HH.lerp(f.from.x, TUNE.potX, e), HH.lerp(f.from.y, 0.6, e) + Math.sin(k * Math.PI) * 0.6, HH.lerp(f.from.z, TUNE.potZ, e));
      f.g.rotation.set(k * 2.2, k * 5, k * 1.4);
      f.g.scale.setScalar(HH.lerp(1, 0.55, e));
      if (f.t >= 1) {
        f.live = false; f.g.visible = false;
        this.steam(ctx, 6, true);                         // the splash
        ctx.sparks(TUNE.potX, 0.62, TUNE.potZ, 8, { speed: 0.8, up: 1.5, size: 0.06, life: 0.8 });
        this.wobbleV = Math.max(this.wobbleV, 1.0);
      }
    }
    // the empty wobble
    this.shake = Math.max(0, this.shake - dt * 2.8);
    this.pot.rotation.z = Math.sin(ctx.st.time * 42) * 0.13 * this.shake * this.shake;
    // the picture tile
    this.drawNeedPrompt(false);
  };

  /* ---------- the cooking ---------- */
  // a press at the idle pot: needs something in the basket; one carrot and one mushroom (when there are) hop into the pot
  mech.tryStart = function () {
    if (this.phase === 'eating') this.phase = 'idle';
    if (this.phase !== 'idle') return false;
    const have = KINDS.filter(kind => this.larderN[kind] > 0);
    if (!have.length) { this.shake = 1; this.wobbleV = Math.max(this.wobbleV, 0.3); return false; }   // nothing to cook: an empty wobble
    const ctx = this.ctx;
    this.basket.updateMatrixWorld(true);
    const v = new ctx.T.Vector3();
    have.forEach((kind, i) => {
      const it = this.items[kind][--this.larderN[kind]];
      it.g.visible = false;
      it.g.getWorldPosition(v);
      const f = this.flyers[KINDS.indexOf(kind)];
      f.from.copy(v); f.from.y += 0.2; f.t = -i * TUNE.hopGap / TUNE.hopSeconds; f.live = true;
      f.g.position.copy(f.from); f.g.visible = false;
    });
    const ok = this.start();
    this.fed = { carrot: have.indexOf('carrot') >= 0, mushroom: have.indexOf('mushroom') >= 0 };
    this.gapT = Math.max(this.gapT, (have.length - 1) * TUNE.hopGap + TUNE.hopSeconds + 0.15);   // the first ring waits for the last splash
    return ok;
  };

  mech.start = function () {
    if (this.phase === 'eating') this.phase = 'idle';
    if (this.phase !== 'idle') return false;
    this.fed = { carrot: true, mushroom: true };
    this.phase = 'cooking';
    this.quality = null; this.good = 0; this.stirs = 0; this.beat = 0;
    this.beatState = 'gap'; this.gapT = 0.55; this.beatT = 0; this.beatPressed = false;
    this.setStew(0, 0);
    this.steam(this.ctx, 8, true);
    this.wobbleV = 1.2;
    this.ctx.keeper.playAct('throw');
    this.ctx.keeper.hop = 0.5;
    return true;
  };

  mech.stir = function (good, silent) {
    // good = true for a perfectly timed stir
    const ctx = this.ctx;
    if (this.phase !== 'cooking') return false;
    this.stirs++;
    if (good) this.good++;
    this.beatState = 'gap'; this.gapT = TUNE.beatGap; this.beatPressed = false; this.beatT = 0;
    this.beat++;
    this.setStew(this.stirs, this.good);
    this.ladleVel = good ? 16 : 9;
    this.wobbleV = good ? 1.5 : 0.7;
    this.ringHit = good ? 1 : -1;
    this.ringFlash = 1;
    ctx.keeper.playAct('throw');
    if (good) ctx.keeper.hop = 0.55;
    this.steam(ctx, good ? 9 : 4, good);
    if (good) ctx.sparks(TUNE.potX, 0.66, TUNE.potZ, 7, { speed: 0.7, up: 1.8, size: 0.06, life: 0.9 });
    this.flash = good ? 1 : 0.35;
    if (this.stirs >= TUNE.beats) {
      const q = this.good >= TUNE.goldenNeeded ? 'golden' : this.good >= TUNE.goodNeeded ? 'good' : 'plain';
      this.finish(this.fed.carrot && this.fed.mushroom ? q : 'plain');   // a stew of one kind stays plain, however well it was stirred
    }
    return true;
  };

  mech.finish = function (quality) {
    const ctx = this.ctx;
    if (this.phase === 'ready' || this.phase === 'eating') return false;
    if (QUALITY_ORDER.indexOf(quality) < 0) quality = 'plain';
    this.phase = 'ready';
    this.quality = quality;
    this.resultT = 1;
    if (this.good === 0 && quality !== 'plain') this.good = quality === 'golden' ? TUNE.goldenNeeded : TUNE.goodNeeded;   // test hook path
    if (this.stirs < TUNE.beats) { this.stirs = TUNE.beats; }
    // colour the stew by result: plain stays pale and thin, golden is rich and shines
    this.setStew(quality === 'golden' ? 5 : quality === 'good' ? 4 : 1, quality === 'golden' ? 5 : quality === 'good' ? 3 : 0);
    this.steam(ctx, quality === 'plain' ? 10 : 16, true);
    this.wobbleV = 1.4;
    if (quality === 'golden') {
      ctx.sparks(TUNE.potX, 0.7, TUNE.potZ, 34, { speed: 1.3, up: 2.9, size: 0.09, life: 1.4, grav: -0.5 });
      this.glowKick = 1;
      this.readyEl.classList.toggle('is-golden', true);
    } else {
      this.readyEl.classList.remove('is-golden');
      if (quality === 'good') ctx.sparks(TUNE.potX, 0.66, TUNE.potZ, 10, { speed: 0.9, up: 2.0, size: 0.07, life: 1.0 });
    }
    this.readyTxt.textContent = QUALITY_NAME[quality] + ' is ready';
    this.readyEl.classList.add('is-on');
    this.readyEl.classList.remove('is-pop'); void this.readyEl.offsetWidth; this.readyEl.classList.add('is-pop');
    this.ringK = 0;
    return true;
  };

  mech.eat = function (ctx) {
    const q = this.quality;
    this.phase = 'eating';
    this.eatT = 0;
    this.eaten = q;
    ctx.keeper.playAct('cheer');
    ctx.hunter.hop = 1;
    ctx.sparks(TUNE.potX, 0.7, TUNE.potZ, 24, { speed: 1.2, up: 2.6, size: 0.08, life: 1.3, grav: -0.5 });
    ctx.sparks(ctx.W.fire.x, 0.5, ctx.W.fire.z + 0.25, 26, { speed: 1.3, up: 3.0, grav: -0.3, life: 1.6 });
    ctx.sparks(ctx.hunter.x, 0.9, ctx.hunter.z, 18, { speed: 1.1, up: 2.2, size: 0.07, life: 1.3, grav: -0.4 });
    ctx.view.pulseSeam(0.6);
    ctx.st.roar = Math.max(ctx.st.roar, 0.5);
    ctx.pulseHud();
    if (ctx.sprint) ctx.sprint.set(TUNE.sprint[q], q);   // the meal becomes sprint bursts for the Hunter
    this.readyEl.classList.remove('is-on');
    this.resetPot();
  };

  mech.resetPot = function () {
    this.quality = null; this.good = 0; this.stirs = 0; this.beat = 0;
    this.setStew(0, 0);
    this.depth = 0;
    this.glowKick = 0;
  };

  /* ---------- per step ---------- */
  mech.update = function (ctx, dt) {
    if (!this.api || !window.game || !window.game.debug || window.game.debug.supper !== this.api) this.attachHooks(ctx);
    const kp = ctx.keeper, st = ctx.st;
    const dPot = Math.hypot(kp.x - TUNE.potX, kp.z - TUNE.potZ);
    const inReach = dPot < TUNE.reach;
    const press = ctx.input.keeper.act;

    // claim the press: next to the pot, E belongs to the pot and never throws a log
    if (inReach && press) {
      ctx.input.keeper.act = false;
      if (this.phase === 'idle' || this.phase === 'eating') this.tryStart();
      else if (this.phase === 'cooking') this.press();
      else if (this.phase === 'ready') { this.wobbleV = 0.5; this.steam(ctx, 3, false); }
    }

    if (this.phase === 'cooking') this.tickBeats(ctx, dt, dPot);

    // the Keeper faces the pot while stirring
    if (this.phase === 'cooking' && kp.act > 0) {
      const want = Math.atan2(TUNE.potX - kp.x, TUNE.potZ - kp.z);
      let d = want - kp.facing; while (d > Math.PI) d -= 6.283; while (d < -Math.PI) d += 6.283;
      kp.facing += d * (1 - Math.exp(-12 * dt));
    }

    if (this.phase === 'eating') {
      this.eatT += dt;
      if (this.eatT > TUNE.eatSeconds) this.phase = 'idle';
    }

    this.animate(ctx, dt, dPot, inReach);
  };

  mech.press = function () {
    // between rings a press only nudges the pot: a stir needs a ring to aim at
    if (this.beatState === 'gap' || this.away) { this.wobbleV = Math.max(this.wobbleV, 0.35); return; }
    const good = Math.abs(this.beatT - TUNE.beatSeconds) <= TUNE.goodWindow;   // beatT is 1.1 at the moment the ring closes
    this.stir(good);
  };

  mech.tickBeats = function (ctx, dt, dPot) {
    // walk away and the pot waits for you
    this.away = dPot > TUNE.leaveReach;
    if (this.away) { this.beatT = 0; return; }
    if (this.beatState === 'gap') {
      this.gapT -= dt;
      if (this.gapT <= 0) { this.beatState = 'ring'; this.beatT = 0; this.beatPressed = false; }
    } else {
      this.beatT += dt;
      if (this.beatT > TUNE.beatSeconds + TUNE.lateGrace) {
        // missed: the ladle drifts on its own, a thin puff, and the next beat comes
        this.stir(false);
        this.ringHit = -1;
      }
    }
  };

  mech.animate = function (ctx, dt, dPot, inReach) {
    const t = ctx.st.time;
    // pot squash: a spring after each stir
    this.wobbleV += (-this.wobble * 160 - this.wobbleV * 11) * dt;
    this.wobble += this.wobbleV * dt;
    const sq = this.wobble * 0.07;
    this.pot.scale.set(1 + sq, 1 - sq * 1.4, 1 + sq);
    // ladle circles the surface
    this.ladleVel *= Math.exp(-3.2 * dt);
    this.ladleSpin += (this.ladleVel + (this.phase === 'cooking' ? 0.7 : 0.25)) * dt;
    const lr = 0.12;
    this.ladle.position.set(Math.cos(this.ladleSpin) * lr, 0.52, Math.sin(this.ladleSpin) * lr);
    this.ladle.rotation.set(Math.sin(this.ladleSpin) * -0.2, 0, Math.cos(this.ladleSpin) * 0.2);
    // bits swirl, faster after a stir
    this.bits.forEach(b => {
      const u = b.userData;
      u.a += (0.25 * u.s + this.ladleVel * 0.18) * dt;
      b.position.set(Math.cos(u.a) * u.r, 0.555 + Math.sin(t * 2 + u.a * 3) * 0.004, Math.sin(u.a) * u.r);
      b.rotation.y = u.a * 2;
    });
    // gentle simmer steam while there is stew
    const busy = this.phase === 'cooking' || this.phase === 'ready';
    this.steamAcc += dt * (busy ? (this.phase === 'ready' ? 4.5 : 3) : 0.0);
    while (this.steamAcc > 1) { this.steamAcc -= 1; this.steam(ctx, 1, false); }

    // glow: a ready golden supper lights its corner
    const golden = this.phase === 'ready' && this.quality === 'golden';
    this.glowKick = Math.max(0, (this.glowKick || 0) - dt * 0.9);
    const targetGlow = golden ? 1 : (this.phase === 'ready' ? 0.18 : 0);
    this.glow = HH.damp(this.glow, targetGlow, 3.5, dt);
    const g = this.glow * (1 + (this.glowKick || 0) * 0.8 + 0.06 * Math.sin(t * 3.1));
    this.glowMat.opacity = 0.34 * clamp01(g) * (golden ? 1 : 0.6);
    this.glowDisc.scale.setScalar(0.9 + 0.1 * Math.sin(t * 2.4) + (this.glowKick || 0) * 0.3);
    this.slot.pos.set(TUNE.potX, 0.95, TUNE.potZ + 0.2, 0.001 + 3.2 * clamp01(this.glow + this.flash * 0.35));
    this.slot.col.set(1.0, 0.62, 0.2).multiplyScalar(0.55 * g + 0.5 * this.flash);
    this.flash = Math.max(0, this.flash - dt * 2.6);

    // key prompt when the Keeper is in reach
    const want = ctx.st.started && inReach && this.phase !== 'eating' && this.phase !== 'ready' ? 1 : 0;   // no prompt while a finished supper waits: there is nothing to press for
    this.promptK = HH.damp(this.promptK, want, 12, dt);
    this.prompt.visible = this.promptK > 0.02 && this.phase !== 'cooking';
    const ps_ = 0.62 * HH.easeOutBack(clamp01(this.promptK));
    this.prompt.scale.set(ps_ * 2, ps_, 1);          // the sprite is two tiles wide: the key and the pictures
    this.prompt.position.y = 1.5 + Math.sin(t * 3 + 1) * 0.04;
    // while cooking the ring is the prompt
    const showRing = this.phase === 'cooking' && !this.away && (this.beatState === 'ring' || this.ringFlash > 0);
    this.ringK = HH.damp(this.ringK, showRing ? 1 : 0, 14, dt);
    this.ring.visible = this.ringK > 0.02;
    if (this.ring.visible) {
      this.ring.scale.setScalar(1.15 * (0.7 + 0.3 * HH.easeOutBack(clamp01(this.ringK))));
      this.ring.position.y = 1.42 + Math.sin(t * 3) * 0.02;
      this.drawRing();
    }
    this.ringFlash = Math.max(0, this.ringFlash - dt * 3.2);

    this.updateLarder(ctx, dt);

    // interface
    this.hudTick(dt);
  };

  mech.hudTick = function () { /* the interface only changes on events; nothing to do per frame */ };

  mech.drawRing = function () {
    const cv = this.ringCv, x = cv.getContext('2d'), s = 192, c = s / 2;
    x.clearRect(0, 0, s, s);
    const target = 38;                                        // radius of the target circle in px
    const p = this.beatState === 'ring' ? clamp01(this.beatT / TUNE.beatSeconds) : 1;
    const over = this.beatState === 'ring' ? Math.max(0, (this.beatT - TUNE.beatSeconds) / TUNE.lateGrace) : 0;
    const e = p * p * (3 - 2 * p);
    const r = target + (84 - target) * (1 - (p * 0.65 + e * 0.35)) - over * 8;
    const near = this.beatState === 'ring' && Math.abs(this.beatT - TUNE.beatSeconds) <= TUNE.goodWindow;
    // backing disc so the ring reads over the stove and the floor
    x.fillStyle = 'rgba(30,20,16,0.26)';
    x.beginPath(); x.arc(c, c + 4, 90, 0, 7); x.fill();
    // target circle
    x.lineWidth = near ? 9 : 6;
    x.strokeStyle = near ? '#ffd25e' : '#ffb44a';
    x.shadowColor = near ? 'rgba(255,200,80,0.9)' : 'rgba(0,0,0,0)'; x.shadowBlur = near ? 14 : 0;
    x.beginPath(); x.arc(c, c, target, 0, 7); x.stroke();
    x.shadowBlur = 0;
    // closing ring
    if (this.beatState === 'ring') {
      x.lineWidth = 7;
      x.strokeStyle = near ? '#fff3c9' : '#f4e6c8';
      x.beginPath(); x.arc(c, c, Math.max(8, r), 0, 7); x.stroke();
    }
    // result flash: a ring that pops outward (green-gold for good, dull for a miss)
    if (this.ringFlash > 0) {
      const k = 1 - this.ringFlash;
      x.lineWidth = 8 * this.ringFlash + 2;
      x.strokeStyle = this.ringHit > 0 ? 'rgba(255,226,120,' + this.ringFlash + ')' : 'rgba(180,165,140,' + this.ringFlash * 0.8 + ')';
      x.beginPath(); x.arc(c, c, target + k * (this.ringHit > 0 ? 40 : 14), 0, 7); x.stroke();
    }
    // how many stirs so far: five pips under the ring
    for (let i = 0; i < TUNE.beats; i++) {
      x.fillStyle = i < this.stirs ? '#ffb44a' : 'rgba(244,230,200,0.3)';
      x.beginPath(); x.arc(c + (i - 2) * 16, s - 12, 5, 0, 7); x.fill();
    }
    this.ringTex.needsUpdate = true;
  };

  /* ---------- events ---------- */
  mech.on = function (event, data, ctx) {
    if (event === 'homecoming') {
      if (this.phase === 'ready') this.eat(ctx);   // with no supper waiting nothing happens: unused bursts are kept
    }
  };

  /* ---------- test hooks ---------- */
  mech.attachHooks = function (ctx) {
    const self = this;
    const game = window.game;
    if (!game) return;
    game.debug = game.debug || {};
    game.debug.supper = this.api = {
      start: () => self.start(),
      stir: good => self.stir(good !== false),
      finish: q => { if (self.phase === 'eating') self.phase = 'idle'; if (self.phase === 'idle') self.start(); return self.finish(q || 'good'); },
      give: (kind, n) => { let k = 0; for (let i = 0; i < (n === undefined ? 1 : n); i++) { if (self.larderAdd(kind)) k++; } return k; },   // put n of a kind in the basket, up to the room there is
      state: () => ({ phase: self.phase, quality: self.quality, stirs: self.stirs, good: self.good, beat: self.beat, beatState: self.beatState, beatT: +self.beatT.toFixed(2),
        larder: { carrot: self.larderN.carrot, mushroom: self.larderN.mushroom }, fed: { carrot: self.fed.carrot, mushroom: self.fed.mushroom } })
    };
  };

  (HH.mechanics = HH.mechanics || []).push(mech);
})();
