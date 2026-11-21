/* mech-supper.js: the Hearth Keeper cooks supper at the hearth; a good meal makes the Hunter's next lantern last longer.
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
    burn: { plain: 0.9, good: 0.8, golden: 0.65 },   // lantern burn multiplier for the next trip
    stewPale: 0xe3cf8f, stewRich: 0xa24a1f, stewGold: 0xe29a2c,
    ringColor: 0xf4e6c8, targetColor: 0xffb44a,
    eatSeconds: 1.8                 // the little eating scene after a homecoming
  };

  const QUALITY_NAME = { plain: 'plain supper', good: 'good supper', golden: 'golden supper' };
  const QUALITY_ORDER = ['plain', 'good', 'golden'];

  const CSS = [
    '#supper-bowl { display: none; align-items: center; gap: 6px; padding-left: 10px; margin-left: 2px; border-left: 1px solid var(--panel-line); white-space: nowrap; font-family: var(--body); font-weight: 700; color: var(--ink); }',
    '#supper-bowl.is-on { display: flex; }',
    '#supper-bowl svg { flex: none; }',
    '#supper-bowl .stew { fill: var(--ember); transition: fill 0.3s ease; }',
    '#supper-bowl .steam { stroke: var(--ink-soft); opacity: 0; }',
    '#supper-bowl.is-good .stew { fill: #e2862a; }',
    '#supper-bowl.is-golden .stew { fill: #ffd25e; }',
    '#supper-bowl.is-golden { text-shadow: 0 0 10px rgba(255, 190, 80, 0.75); }',
    '#supper-bowl.is-golden svg { filter: drop-shadow(0 0 5px rgba(255, 190, 80, 0.85)); }',
    '#supper-bowl.is-pop svg { animation: supperPop 0.7s cubic-bezier(.2,1.5,.4,1); }',
    '#supper-bowl .steam { animation: supperSteam 2.4s ease-in-out infinite; }',
    '#supper-bowl .steam + .steam { animation-delay: 1.1s; }',
    '#supper-bowl .pips { display: inline-flex; gap: 3px; }',
    '#supper-bowl .pips i { width: 5px; height: 5px; border-radius: 50%; background: var(--ember); }',
    '#supper-bowl .pips i.off { background: rgba(244, 230, 200, 0.18); }',
    '#supper-ready { display: none; align-items: center; gap: 7px; padding-left: 10px; margin-left: 2px; border-left: 1px solid var(--panel-line); white-space: nowrap; font-weight: 700; color: var(--ink); }',
    '#supper-ready.is-on { display: flex; }',
    '#supper-ready .lamp { width: 8px; height: 8px; border-radius: 50%; background: var(--ember); box-shadow: 0 0 8px rgba(255, 180, 74, 0.9); animation: supperLamp 1.8s ease-in-out infinite; }',
    '#supper-ready.is-golden .lamp { background: #ffd25e; box-shadow: 0 0 12px rgba(255, 210, 94, 1); }',
    '#supper-ready.is-pop { animation: supperPop 0.7s cubic-bezier(.2,1.5,.4,1); }',
    '@keyframes supperPop { 0% { transform: scale(0.6); } 55% { transform: scale(1.28); } 100% { transform: scale(1); } }',
    '@keyframes supperSteam { 0%, 100% { opacity: 0; transform: translateY(1px); } 50% { opacity: 0.9; transform: translateY(-1.5px); } }',
    '@keyframes supperLamp { 0%, 100% { opacity: 0.55; } 50% { opacity: 1; } }',
    '@media (max-width: 860px) { #supper-ready .txt, #supper-bowl .txt { display: none; } }',
    '@media (prefers-reduced-motion: reduce) { #supper-bowl .steam, #supper-ready .lamp, #supper-bowl.is-pop svg, #supper-ready.is-pop { animation: none; } }'
  ].join('\n');

  const BOWL_SVG = '<svg viewBox="0 0 24 20" width="20" height="17" aria-hidden="true">' +
    '<path class="steam" d="M8 5c-1.4-1.2 1.4-2.2 0-3.6" fill="none" stroke-width="1.5" stroke-linecap="round"/>' +
    '<path class="steam" d="M14 5c-1.4-1.2 1.4-2.2 0-3.6" fill="none" stroke-width="1.5" stroke-linecap="round"/>' +
    '<path class="stew" d="M3.6 8.2h16.8a8.4 8.4 0 0 1-16.8 0z"/>' +
    '<path d="M2 8.2h20" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" fill="none"/>' +
    '<path d="M8 17.6h8" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" fill="none"/></svg>';

  const mech = {
    name: 'supper',
    phase: 'idle',                  // idle | cooking | ready | eating
    quality: null, good: 0, beat: 0,
    stirs: 0, beatState: 'gap', beatT: 0, beatPressed: false, gapT: 0.4,
    bonus: null,                    // quality of the supper powering this trip, or null
    eatT: 0, pending: null,
    glow: 0, wobble: 0, wobbleV: 0, ladleSpin: 0, ladleVel: 0, depth: 0, shown: 0, promptK: 0, ringK: 0, resultT: 0, flash: 0, steamAcc: 0,
    ringFlash: 0, ringHit: 0, lastWas: ''
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

    // the prompt and the ring above the pot
    this.prompt = HH.makePrompt('E');
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

    /* interface: a bowl in the Hunter's chip while the bonus lasts, a label by the Keeper's chip while supper waits */
    const style = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);
    const chips = ctx.hud.querySelectorAll('.chip');
    this.bowlEl = document.createElement('span');
    this.bowlEl.id = 'supper-bowl';
    this.bowlEl.innerHTML = BOWL_SVG + '<span class="txt"></span><span class="pips" aria-hidden="true"><i></i><i></i><i></i></span>';
    this.bowlEl.setAttribute('role', 'img');
    this.bowlTxt = this.bowlEl.querySelector('.txt');
    this.pips = this.bowlEl.querySelectorAll('.pips i');
    this.readyEl = document.createElement('span');
    this.readyEl.id = 'supper-ready';
    this.readyEl.innerHTML = '<span class="lamp"></span><span class="txt"></span>';
    this.readyTxt = this.readyEl.querySelector('.txt');
    if (chips[0]) chips[0].appendChild(this.readyEl);
    if (chips[1]) chips[1].appendChild(this.bowlEl);
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

  /* ---------- the cooking ---------- */
  mech.start = function () {
    if (this.phase === 'eating') this.phase = 'idle';
    if (this.phase !== 'idle') return false;
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
    if (this.stirs >= TUNE.beats) this.finish(this.good >= TUNE.goldenNeeded ? 'golden' : this.good >= TUNE.goodNeeded ? 'good' : 'plain');
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
    ctx.st.burnMult = TUNE.burn[q];
    this.bonus = q;
    this.readyEl.classList.remove('is-on');
    this.showBowl(q);
    this.resetPot();
  };

  mech.resetPot = function () {
    this.quality = null; this.good = 0; this.stirs = 0; this.beat = 0;
    this.setStew(0, 0);
    this.depth = 0;
    this.glowKick = 0;
  };

  mech.showBowl = function (q) {
    const el = this.bowlEl;
    el.classList.add('is-on');
    el.classList.toggle('is-good', q === 'good');
    el.classList.toggle('is-golden', q === 'golden');
    this.bowlTxt.textContent = q;
    el.setAttribute('aria-label', 'Next lantern burns slower: ' + QUALITY_NAME[q]);
    const n = QUALITY_ORDER.indexOf(q) + 1;
    this.pips.forEach((p, i) => p.classList.toggle('off', i >= n));
    el.classList.remove('is-pop'); void el.offsetWidth; el.classList.add('is-pop');
  };

  mech.hideBowl = function () { this.bowlEl.classList.remove('is-on', 'is-pop'); };

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
      if (this.phase === 'idle' || this.phase === 'eating') this.start();
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
    this.prompt.scale.setScalar(0.62 * HH.easeOutBack(clamp01(this.promptK)));
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
      if (this.phase === 'ready') this.eat(ctx);
      else {
        // no supper waiting: last trip's bonus ends
        ctx.st.burnMult = 1;
        this.bonus = null;
        this.hideBowl();
      }
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
      state: () => ({ phase: self.phase, quality: self.quality, stirs: self.stirs, good: self.good, beat: self.beat, beatState: self.beatState, beatT: +self.beatT.toFixed(2), bonus: self.bonus, burnMult: ctx.st.burnMult })
    };
  };

  (HH.mechanics = HH.mechanics || []).push(mech);
})();
