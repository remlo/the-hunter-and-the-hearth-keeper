/* mech-garden.js: the Hearth Keeper tends three garden plots and grows carrots for supper.
   One press at a plot sows it, waters it, or pulls the ripe carrot; carrots ride in her hip pouch and hop into the basket by the pot.
   A plot goes: bare, sown, thirsty (15 s later), watered, growing (40 s), ripe, picked, bare again. */
(function () {
  'use strict';
  const HH = window.HH, T = window.THREE, P = HH.PAL;

  /* ---------- tuning: everything to adjust by feel lives here ---------- */
  const TUNE = {
    reach: 1.6,              // the Keeper acts on the nearest plot that needs something within this distance
    pouchMax: 3,             // most carrots the pouch holds
    thirstyAfterS: 15,       // seconds after sowing before the sprout droops
    growS: 40,               // seconds from watering to a ripe carrot
    soloWaterS: 2,           // playing alone as the Hunter: a thirsty sprout waters itself this long after it droops
    start: ['ripe', 'thirsty', 'bare'],   // stage of each plot when the game starts (a first supper is possible early)

    sowS: 1.5,               // how long the sowing takes (she is busy this long)
    sproutAtS: 1.0,          // when in the sowing the sprout pops up
    waterS: 1.75,            // how long the watering takes
    pourFromS: 0.55,         // when the drops start to fall
    pourToS: 1.2,            // when they stop
    soakAtS: 0.8,            // when the soil starts to darken
    springAtS: 1.05,         // when the sprout springs up
    pickS: 1.4,              // how long the pulling takes
    tugFromS: 0.3,           // when the tug begins
    popAtS: 0.8,             // when the carrot pops out

    sproutPopS: 0.5,         // seconds for the new sprout to pop up
    dryRate: 1.6,            // how quickly the soil goes pale (per second)
    soakRate: 2.2,           // how quickly the soil darkens
    ripeSoilWet: 0.78,        // how much of the wet patch is left when the carrot is ripe (1 is all of it)
    wigEveryS: 4,            // a ripe carrot wiggles about this often
    glintEveryS: 2.4,        // and gives off a glint about this often

    moundRX: 0.21, moundRZ: 0.19, moundH: 0.075,   // the mound of soil: half widths and height
    markerH: 0.27,           // the little marker stick
    dropHeight: 0.42,        // the water-drop mark floats this high over a thirsty sprout
    dropSize: 0.34,
    promptHeight: { bare: 0.72, thirsty: 1.12, ripe: 0.98 },   // the key prompt floats this high over each kind of plot
    shoulderTop: 0.04,       // how high the carrot's base sits when ripe (up from the soil row)
    leafHeight: 0.38,        // height of the tallest leaf when ripe

    pouchScale: 1.45,        // size of a carrot in the pouch
    pouchAt: [0.265, 0.12, 0.04],   // where the pouch mouth is, on the Keeper's torso
    pickHangS: 0.16,         // the carrot hangs in the air this long after it pops
    pickRiseS: 0.34,         // how long it flies up out of the soil
    pickRiseH: 1.0,          // how high it goes
    pickFlyS: 0.46,          // flight from the top of the pop to the pouch
    deliverWindS: 0.16,      // the carrot lifts out of the pouch before it hops
    deliverFlyS: 0.5,        // flight from the pouch to the basket
    deliverHeight: 0.85,     // arc height of that hop
    deliverGapS: 0.34,       // delay between carrots going into the basket
    returnFlyS: 0.34         // a carrot the basket refused hops back to the pouch
  };

  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
  const ease = t => t * t * (3 - 2 * t);
  const smoothstep = (a, b, x) => ease(clamp((x - a) / (b - a), 0, 1));
  const spring = (o, key, target, k, c, dt) => {
    const v = key + 'V';
    o[v] += (-(o[key] - target) * k - o[v] * c) * dt;
    o[key] += o[v] * dt;
  };

  const CSS = [
    '.hhg-carry { display: inline-flex; align-items: center; gap: 7px; }',
    '.hhg-carry.is-none { display: none; }',
    '.hhg-carry svg { flex: none; }',
    '.hhg-pips { display: inline-flex; gap: 4px; }',
    '.hhg-pip { box-sizing: border-box; width: 14px; height: 9px; border-radius: 3px; border: 1.5px solid var(--panel-line); background: rgba(244, 230, 200, 0.06); transition: background 0.18s ease, border-color 0.18s ease, box-shadow 0.18s ease; }',
    '.hhg-pip.is-on { background: #e8843a; border-color: #e8843a; box-shadow: 0 0 9px rgba(232, 132, 58, 0.55); }',
    '.hhg-pip.is-pop { animation: hhg-pop 0.34s cubic-bezier(0.3, 1.7, 0.5, 1); }',
    '.hhg-carry.is-full .hhg-pip.is-on { background: #c96a26; border-color: #c96a26; }',
    '@keyframes hhg-pop { 0% { transform: scale(0.4, 1.9); } 55% { transform: scale(1.25, 0.7); } 100% { transform: scale(1); } }',
    '@media (prefers-reduced-motion: reduce) { .hhg-pip.is-pop { animation: none; } }',
    '#game.is-touch .hhg-carry { gap: 5px; }',
    '#game.is-touch .hhg-carry svg { width: 18px; height: 13px; }',
    '#game.is-touch .hhg-pips { gap: 3px; }',
    '#game.is-touch .hhg-pip { width: 10px; height: 8px; }'
  ].join('\n');

  /* ---------- models ---------- */
  const _c = new T.Color();
  // a four-sided leaf blade standing on y = 0, darker at the base and lighter at the tip
  function bladeMesh(h, r, hexA, hexB) {
    const k = new HH.Kit(), a = HH.col(hexA), b = HH.col(hexB);
    k.cone(r, h, 4, 0, h / 2, 0, (v, ly) => _c.copy(a).lerp(b, clamp(ly / h + 0.5, 0, 1)), { leaf: true, sway: (v, ly) => clamp(ly / h + 0.5, 0, 1) * 0.55 });
    return k.build();
  }
  // a leaf cone tilted by t away from upright, towards azimuth phi, with its base at (x, y, z)
  function leafCone(k, x, y, z, phi, t, h, r, hexA, hexB) {
    const a = HH.col(hexA), b = HH.col(hexB);
    k.cone(r, h, 4, x + Math.sin(t) * Math.cos(phi) * h / 2, y + Math.cos(t) * h / 2, z - Math.sin(t) * Math.sin(phi) * h / 2,
      (v, ly) => _c.copy(a).lerp(b, clamp(ly / h + 0.5, 0, 1)), { ry: phi, rz: -t });
  }
  // a whole carrot with its origin at the shoulder: orange root hanging down (len 0 for only the shoulder), green top above
  function makeCarrot(len) {
    const k = new HH.Kit(), cA = HH.col(P.autumn), cB = HH.col(P.autumnD);
    if (len > 0) {
      k.cone(0.068, len, 8, 0, -len / 2, 0, (v, ly) => _c.copy(cA).lerp(cB, clamp(ly / len + 0.5, 0, 1)), { rz: Math.PI });
      k.cyl(0.07, 0.07, 0.012, 8, 0, -len * 0.3, 0, HH.col(P.autumnD));
      k.cyl(0.058, 0.058, 0.012, 8, 0, -len * 0.55, 0, HH.col(P.autumnD));
    }
    k.cyl(0.07, 0.07, 0.05, 8, 0, -0.02, 0, HH.col(P.autumn));
    k.ico(0.07, 0, 0.0, 0, HH.col(P.autumnL), { s: [1, 0.55, 1], detail: 1 });
    const ts = [0.2, 0.5, 0.34, 0.62, 0.28], hs = [0.27, 0.22, 0.25, 0.19, 0.23];
    for (let i = 0; i < 5; i++) leafCone(k, Math.cos(i * 2.4) * 0.02, 0.01, Math.sin(i * 2.4) * 0.02, i * 2.4, ts[i], hs[i], 0.036, i % 2 ? P.leaf : P.leafD, i % 2 ? 0xa2c050 : P.leafL);
    return k.build();
  }
  function dome(hex, seed, rx, ry, rz) {
    const k = new HH.Kit();
    k.ico(1, 0, 0, 0, HH.faceShade(hex, 0.07, seed), { s: [rx, ry, rz], detail: 1 });
    return k.build({ cast: false });
  }
  function makeCan() {
    const k = new HH.Kit(), blue = HH.col(0x6a8fb8), blueL = HH.col(0x9db8d4), wood = HH.col(P.woodD);
    k.cyl(0.075, 0.085, 0.12, 10, 0, 0, 0, blue);
    k.cyl(0.08, 0.08, 0.016, 10, 0, 0.066, 0, blueL);
    k.cyl(0.021, 0.03, 0.17, 6, 0.13, 0.065, 0, blue, { rz: -0.95 });
    k.cyl(0.04, 0.034, 0.03, 8, 0.2, 0.14, 0, blueL, { rz: -0.95 });
    k.box(0.03, 0.14, 0.022, -0.092, 0.035, 0, wood, { r: 0.008, rz: -0.25 });
    const g = new T.Group(), inner = k.build({ cast: false });
    inner.rotation.y = -Math.PI / 2;           // the spout points along +z
    g.add(inner);
    const spout = new T.Object3D();
    spout.position.set(0, 0.16, 0.24);
    g.add(spout);
    g.userData.spout = spout;
    return g;
  }
  function dropTexture() {
    const cv = document.createElement('canvas');
    cv.width = cv.height = 96;
    const x = cv.getContext('2d');
    const path = () => { x.beginPath(); x.moveTo(48, 8); x.bezierCurveTo(60, 34, 76, 48, 76, 62); x.arc(48, 62, 28, 0, Math.PI, false); x.bezierCurveTo(20, 48, 36, 34, 48, 8); x.closePath(); };
    path(); x.fillStyle = 'rgba(30,20,16,0.5)'; x.save(); x.translate(0, 5); x.fill(); x.restore();
    path(); const gr = x.createLinearGradient(0, 8, 0, 90); gr.addColorStop(0, '#8fd0ff'); gr.addColorStop(1, '#2f86d4'); x.fillStyle = gr; x.fill();
    x.lineWidth = 5; x.strokeStyle = '#f6efe0'; x.stroke();
    x.fillStyle = 'rgba(255,255,255,0.8)'; x.beginPath(); x.ellipse(37, 64, 5, 10, 0.3, 0, Math.PI * 2); x.fill();
    const tex = new T.CanvasTexture(cv);
    tex.encoding = T.sRGBEncoding;
    return tex;
  }

  const BLADES = [   // [tilt, size, azimuth step, which colours, shows from this growth]
    [0.4, 1.0, 0, 0, 0.06], [0.7, 0.8, 2.4, 1, 0.1], [0.5, 0.95, 4.8, 0, 0.16], [0.85, 0.7, 7.2, 1, 0.26],
    [0.35, 1.05, 9.6, 0, 0.4], [0.62, 0.85, 12.0, 1, 0.55], [0.98, 0.6, 14.4, 0, 0.7]
  ];

  const M = {
    name: 'garden',
    plots: [], flyers: [], slots: [], pouch: 0, act: null, froze: false, gap: 0, dbg: false,
    prompt: null, promptK: 0, promptAt: null, carryEl: null, pips: [],
    bend: 0, bendV: 0, bendT: 0, rW: 0, lW: 0, rAng: 0, lAng: 0, tilt: 0, canK: 0, canOn: false, pourAcc: 0, moveGate: 0,

    init(ctx) {
      const { W, scene, keeper } = ctx;
      M.ctx = ctx;
      const style = document.createElement('style');
      style.textContent = CSS;
      document.head.appendChild(style);

      // templates, built once and cloned for the three plots
      const tpl = {
        base: dome(0x80593d, 11, TUNE.moundRX, TUNE.moundH, TUNE.moundRZ),
        dry: dome(0xcdb286, 12, TUNE.moundRX, TUNE.moundH, TUNE.moundRZ),
        wet: dome(0x56382a, 13, TUNE.moundRX, TUNE.moundH, TUNE.moundRZ),
        blades: [bladeMesh(0.38, 0.05, P.leaf, 0x9cc04e), bladeMesh(0.38, 0.05, 0x7aa042, 0xb4d65e)]
      };
      // clods around a bare mound, cracks on the dry one, a sheen on the wet one
      const kc = new HH.Kit();
      [[0.2, 0.06, 0.1, 0.04], [-0.14, 0.05, -0.17, 0.032], [0.1, 0.045, -0.2, 0.028]].forEach((c, i) => kc.ico(c[3], c[0], c[1] * 0.4, c[2], HH.faceShade(0x6a4630, 0.08, 20 + i), { s: [1, 0.7, 1], detail: 0 }));
      tpl.clods = kc.build({ cast: false });
      const kd = new HH.Kit();
      [[0.0, 0.0, 0.1, 0.0, 0.12], [-0.03, 0.04, 0.9, 1.6, 0.1], [0.04, -0.04, -0.7, 2.2, 0.09]].forEach(c => kd.box(c[4], 0.01, 0.014, c[0], TUNE.moundH * 0.97 + 0.004, c[1], HH.col(0x8f7552), { ry: c[2], r: 0 }));
      tpl.cracks = kd.build({ cast: false });
      const kw = new HH.Kit();
      tpl.sheen = kw.build({ cast: false });
      const km = new HH.Kit();
      km.box(0.034, TUNE.markerH, 0.022, 0, TUNE.markerH / 2 - 0.045, 0, HH.col(P.woodL), { r: 0.01 });
      km.box(0.1, 0.075, 0.016, 0.0, TUNE.markerH - 0.075, 0.0, HH.col(P.cream), { r: 0.012, rz: 0.12 });
      km.box(0.07, 0.014, 0.018, 0.0, TUNE.markerH - 0.075, 0.002, HH.col(P.autumn), { r: 0.004, rz: 0.12 });
      tpl.marker = km.build();
      // the sprout: a stem and two leaves, fresh and straw-dry
      const sprout = (stemHex, leafHex, leafTip) => {
        const ks = new HH.Kit(), kl = new HH.Kit();
        ks.box(0.034, 0.15, 0.034, 0, 0.075, 0, HH.col(stemHex), { r: 0.01, leaf: true, sway: (v, ly) => clamp(ly / 0.15 + 0.5, 0, 1) * 0.3 });
        kl.box(0.15, 0.03, 0.08, 0.075, 0, 0, HH.col(leafHex), { r: 0.012, leaf: true, sway: 0.3 });
        kl.box(0.06, 0.032, 0.05, 0.14, 0.002, 0, HH.col(leafTip), { r: 0.012, leaf: true, sway: 0.3 });
        return { stem: ks.build(), leaf: kl.build() };
      };
      tpl.fresh = sprout(0x7fb03f, 0x9ccc4a, 0xb7de63);
      tpl.dryS = sprout(0xa8a04c, 0xbcb05a, 0xd9ca88);
      const ksh = new HH.Kit();
      ksh.cyl(0.07, 0.056, 0.11, 8, 0, 0.055, 0, HH.col(P.autumn));
      ksh.cyl(0.072, 0.072, 0.012, 8, 0, 0.035, 0, HH.col(P.autumnD));
      ksh.ico(0.07, 0, 0.11, 0, HH.col(P.autumnL), { s: [1, 0.5, 1], detail: 1 });
      ksh.ico(0.024, 0, 0.13, 0, HH.col(P.leafD), { s: [1, 0.6, 1] });
      tpl.shoulder = ksh.build();
      M.tpl = tpl;
      M.dropTex = dropTexture();

      W.garden.plots.forEach((pos, i) => {
        const root = new T.Group();
        root.position.set(pos.x, 0.195, pos.z);
        const soil = new T.Group(), base = tpl.base.clone(), dry = tpl.dry.clone(), wet = tpl.wet.clone();
        dry.position.y = 0.005; wet.position.y = 0.01;
        const dryG = new T.Group(), wetG = new T.Group();
        dryG.add(dry, tpl.cracks.clone()); wetG.add(wet, tpl.sheen.clone());
        soil.add(base, tpl.clods.clone(), dryG, wetG);
        const marker = tpl.marker.clone();
        marker.position.set(-0.01, 0, -0.205 + (i === 2 ? 0 : 0));
        marker.rotation.z = 0.06; marker.rotation.y = 0.2;
        root.add(soil, marker);
        const plant = new T.Group();
        // the sprout
        const sp = new T.Group(), stemPiv = new T.Group(), top = new T.Group();
        top.position.y = 0.15;
        const sprites = { stem: [tpl.fresh.stem.clone(), tpl.dryS.stem.clone()], leaves: [] };
        stemPiv.add(sprites.stem[0], sprites.stem[1]);
        const leafTilts = [];
        [0.785, 0.785 + Math.PI].forEach(yaw => {
          const piv = new T.Group(), tilt = new T.Group();
          piv.rotation.y = yaw;
          const a = tpl.fresh.leaf.clone(), b = tpl.dryS.leaf.clone();
          tilt.add(a, b); piv.add(tilt); top.add(piv);
          leafTilts.push(tilt); sprites.leaves.push([a, b]);
        });
        stemPiv.add(top); sp.add(stemPiv); plant.add(sp);
        // the full leaves
        const bl = BLADES.map((b, n) => {
          const piv = new T.Group(), tilt = new T.Group();
          piv.rotation.y = b[2];
          piv.position.set(Math.cos(b[2]) * 0.025, 0, -Math.sin(b[2]) * 0.025);
          tilt.add(tpl.blades[b[3]].clone()); piv.add(tilt); plant.add(piv);
          return { piv, tilt };
        });
        const shoulder = tpl.shoulder.clone();
        plant.add(shoulder);
        root.add(plant);
        scene.add(root);
        const drop = new T.Sprite(new T.SpriteMaterial({ map: M.dropTex, transparent: true, depthTest: false, depthWrite: false }));
        drop.renderOrder = 9; drop.visible = false;
        scene.add(drop);
        M.plots.push({
          i, x: pos.x, z: pos.z, root, soil, dryG, wetG, plant, sp, stemPiv, leafTilts, sprites, bl, shoulder, drop,
          stage: 'bare', t: 0, seq: null, hold: { plant: false, soil: false }, plantOn: false, plantK: 0,
          droop: 0, droopV: 0, sq: 0, sqV: 0, punch: 0, punchV: 0, lift: 0, dryK: 0, wetK: 0, dropK: 0, shK: 0,
          wig: 0, wigT: 1 + i * 1.3, glintT: 0.6 + i * 0.9, bob: i * 2
        });
      });
      M.plots.forEach((p, i) => M.setStage(p, TUNE.start[i] || 'bare', true));

      // the pouch on her hip: three slots, each a carrot top poking out
      M.pouchG = new T.Group();
      M.pouchG.position.set(TUNE.pouchAt[0], TUNE.pouchAt[1], TUNE.pouchAt[2]);
      keeper.torso.add(M.pouchG);
      const sl = [[-0.032, 0.0, 0.03, 0.34, 0.2], [0.0, 0.012, -0.03, -0.05, -0.28], [0.032, 0.0, 0.03, -0.34, 0.2]];
      sl.forEach((s, i) => {
        const g = new T.Group(), c = makeCarrot(0.02);
        g.add(c);
        g.position.set(s[0], s[1], s[2]);
        g.rotation.set(s[4], i * 1.7, s[3], 'YXZ');
        g.userData = { base: g.rotation.clone(), pop: 1, popT: 1 };
        g.visible = false;
        M.pouchG.add(g); M.slots.push(g);
      });
      // the carrots that fly (out of the soil, into the basket)
      for (let i = 0; i < 5; i++) {
        const g = new T.Group(), body = new T.Group();
        body.add(makeCarrot(0.3));
        g.add(body);
        g.userData.body = body;
        g.visible = false; scene.add(g); M.flyers.push(g);
      }
      // the can she waters with, in her left hand
      M.can = makeCan();
      M.can.visible = false;
      keeper.armL.add(M.can);
      M.can.position.set(0, -0.33, 0);

      M.prompt = HH.makePrompt('E');
      M.prompt.visible = false;
      scene.add(M.prompt);

      // her bend rides on top of the character's own animation
      const orig = keeper.update;
      keeper.update = function (dt) { orig.call(keeper, dt); M.applyPose(dt); };

      // interface: a carrot and three marks in the Keeper's chip
      const chip = ctx.hud.querySelector('.chip');
      const el = document.createElement('span');
      el.className = 'hhg-carry is-none';
      el.setAttribute('role', 'img');
      el.innerHTML = '<svg viewBox="0 0 24 16" width="21" height="14" aria-hidden="true"><path d="M5 5.2 L19 9.6 Q21 10.3 19 11 L5 15.2 Q3.2 15.7 3.2 13.6 L3.2 7 Q3.2 4.7 5 5.2Z" fill="#e8843a" transform="translate(1 -3)"/><path d="M5 9.4 L20.6 9.4" stroke="#b9561d" stroke-width="1" opacity="0.55" transform="translate(-0.4 -0.8)"/><path d="M3.4 5.4 C1.6 3.2 1.2 2.2 0.7 0.9 M3.6 5 C3.8 2.6 4 1.8 5.2 0.5 M3.8 5.3 C5 3.4 6.4 2.7 8 2.3" fill="none" stroke="#7aa84a" stroke-width="1.7" stroke-linecap="round"/></svg><span class="hhg-pips"></span>';
      const pe = el.querySelector('.hhg-pips');
      for (let i = 0; i < TUNE.pouchMax; i++) { const q = document.createElement('i'); q.className = 'hhg-pip'; pe.appendChild(q); M.pips.push(q); }
      chip.appendChild(el);
      M.carryEl = el;
      M.syncHud();
    },

    syncHud(popIdx) {
      for (let i = 0; i < M.pips.length; i++) M.pips[i].classList.toggle('is-on', i < M.pouch);
      M.carryEl.classList.toggle('is-none', M.pouch <= 0);
      M.carryEl.classList.toggle('is-full', M.pouch >= TUNE.pouchMax);
      M.carryEl.setAttribute('aria-label', 'Carrots carried: ' + M.pouch + ' of ' + TUNE.pouchMax);
      if (popIdx !== undefined && M.pips[popIdx]) { const p = M.pips[popIdx]; p.classList.remove('is-pop'); void p.offsetWidth; p.classList.add('is-pop'); }
    },

    /* the pouch holds n carrots */
    setPouch(n, popLast) {
      const was = M.pouch;
      M.pouch = clamp(n, 0, TUNE.pouchMax);
      M.slots.forEach((s, i) => {
        if (i < M.pouch && i >= was) { s.userData.pop = popLast ? 0.001 : 1; s.userData.popT = popLast ? 0 : 1; }
      });
      M.syncHud(popLast && M.pouch > was ? M.pouch - 1 : undefined);
    },
    airborne(kinds) { return M.flyers.filter(f => f.visible && kinds.indexOf(f.userData.kind) >= 0).length; },
    free() { return TUNE.pouchMax - M.pouch - M.airborne(['pick', 'return']); },

    /* put a plot straight into a stage, with no ceremony */
    setStage(p, stage, snap) {
      p.stage = stage; p.t = 0; p.seq = null;
      p.hold.plant = p.hold.soil = false;
      p.plantOn = stage !== 'bare';
      if (snap) {
        p.plantK = p.plantOn ? 1 : 0;
        p.droop = p.droopV = 0; p.sq = p.sqV = 0; p.punch = p.punchV = 0; p.lift = 0;
        p.dryK = stage === 'thirsty' ? 1 : 0;
        p.wetK = (stage === 'growing' ? 1 : stage === 'ripe' ? TUNE.ripeSoilWet : 0);
        p.dropK = stage === 'thirsty' ? 1 : 0;
        p.shK = stage === 'ripe' ? 1 : 0;
        if (stage === 'thirsty') p.droop = 1;
      }
    },

    tick(p, dt) {
      p.t += dt;
      if (p.stage === 'sown' && p.t >= TUNE.thirstyAfterS) { p.t -= TUNE.thirstyAfterS; p.stage = 'thirsty'; }
      if (p.stage === 'growing' && p.t >= TUNE.growS) {
        p.t -= TUNE.growS; p.stage = 'ripe';
        p.punchV += 3.2; p.wigT = 1.2; p.glintT = 0.3;
        M.ctx.sparks(p.x, 0.5, p.z, 12, { speed: 0.9, up: 1.6, size: 0.06, life: 0.8 });
      }
    },

    /* the one press: sow, water or pull */
    begin(p, auto) {
      const kind = p.stage === 'bare' ? 'sow' : p.stage === 'thirsty' ? 'water' : 'pick';
      p.seq = { kind, t: 0, auto: !!auto, ev: {} };
      if (kind === 'sow') { p.stage = 'sown'; p.t = 0; p.plantOn = false; p.plantK = 0; }
      if (kind === 'water') { p.stage = 'growing'; p.t = 0; p.hold.plant = true; p.hold.soil = true; }
      if (!auto) {
        M.act = { p, kind };
        if (!M.ctx.freeze.keeper) { M.ctx.freeze.keeper = true; M.froze = true; }
      }
    },
    endAct() {
      M.act = null;
      if (M.froze) { M.ctx.freeze.keeper = false; M.froze = false; }
    },

    seeds(p, n) {
      const ps = M.ctx.particles;
      for (let i = 0; i < n; i++) {
        ps.spawn({ x: p.x + 0.28 + (Math.random() - 0.5) * 0.16, y: 0.62 + Math.random() * 0.1, z: p.z + (Math.random() - 0.5) * 0.2,
          vx: -0.45 + (Math.random() - 0.5) * 0.3, vy: 0.3 + Math.random() * 0.4, vz: (Math.random() - 0.5) * 0.5,
          life: 0.5, size: 0.04, r: 1.5, g: 1.05, b: 0.35, grav: -3.2, drag: 0.4 });
      }
    },
    drops(p, n, from) {
      const ps = M.ctx.particles, g = 6.5;
      for (let i = 0; i < n; i++) {
        const sx = from.x + (Math.random() - 0.5) * 0.04, sz = from.z + (Math.random() - 0.5) * 0.04, sy = from.y;
        const tx = p.x + (Math.random() - 0.5) * 0.24, tz = p.z + (Math.random() - 0.5) * 0.24, ty = 0.3;
        const tf = Math.sqrt(2 * Math.max(0.05, sy - ty) / g);
        ps.spawn({ x: sx, y: sy, z: sz, vx: (tx - sx) / tf, vy: 0, vz: (tz - sz) / tf, life: tf, size: 0.055, r: 0.55, g: 1.5, b: 3.4, grav: -g, fadeIn: 0.02 });
      }
    },
    crumbs(p, n) {
      const ps = M.ctx.particles;
      for (let i = 0; i < n; i++) {
        const a = Math.random() * 6.283, sp = 0.5 + Math.random() * 1.1;
        ps.spawn({ x: p.x + Math.cos(a) * 0.08, y: 0.3, z: p.z + Math.sin(a) * 0.08, vx: Math.cos(a) * sp, vy: 1.2 + Math.random() * 1.6, vz: Math.sin(a) * sp,
          life: 0.7 + Math.random() * 0.4, size: 0.05 + Math.random() * 0.03, r: 0.95, g: 0.5, b: 0.2, grav: -6, drag: 0.8 });
      }
    },
    splash(p, n) {
      const ps = M.ctx.particles;
      for (let i = 0; i < n; i++) {
        const a = Math.random() * 6.283, sp = 0.3 + Math.random() * 0.5;
        ps.spawn({ x: p.x + Math.cos(a) * 0.1, y: 0.28, z: p.z + Math.sin(a) * 0.1, vx: Math.cos(a) * sp, vy: 0.9 + Math.random() * 0.7, vz: Math.sin(a) * sp, life: 0.45, size: 0.04, r: 0.6, g: 1.5, b: 3.2, grav: -5 });
      }
    },

    /* one plot's sowing, watering or pulling, moment by moment */
    runSeq(p, dt) {
      const s = p.seq; if (!s) return;
      const ctx = M.ctx, { keeper } = ctx;
      s.t += dt;
      const t = s.t, ev = s.ev;
      if (s.kind === 'sow') {
        if (t > 0.32 && t < 0.62) { s.acc = (s.acc || 0) + dt; while (s.acc > 0.04) { s.acc -= 0.04; M.seeds(p, 2); } }
        [0.8, 1.0].forEach((at, n) => { if (t >= at && !ev['pat' + n]) { ev['pat' + n] = 1; p.sqV += 3.4; if (!s.auto) M.bendV += 1.6; ctx.sparks(p.x, 0.3, p.z, 4, { speed: 0.5, up: 0.8, size: 0.045, life: 0.5, grav: -2 }); } });
        if (t >= TUNE.sproutAtS && !ev.sprout) { ev.sprout = 1; p.plantOn = true; p.punchV += 2.2; ctx.sparks(p.x, 0.32, p.z, 8, { speed: 0.8, up: 1.4, size: 0.055, life: 0.7 }); }
        if (t >= TUNE.sowS) M.finish(p);
      } else if (s.kind === 'water') {
        if (t >= TUNE.pourFromS && t < TUNE.pourToS) {
          s.acc = (s.acc || 0) + dt;
          while (s.acc > 0.016) {
            s.acc -= 0.016;
            const from = M.spoutPos(p, s);
            M.drops(p, 1, from);
          }
        }
        [0.85, 1.05, 1.25].forEach((at, n) => { if (t >= at && !ev['sp' + n]) { ev['sp' + n] = 1; M.splash(p, 6); } });
        if (t >= TUNE.soakAtS && p.hold.soil) { p.hold.soil = false; p.sqV += 1.2; }
        if (t >= TUNE.springAtS && p.hold.plant) { p.hold.plant = false; p.punchV += 2.6; ctx.sparks(p.x, 0.35, p.z, 10, { speed: 0.9, up: 1.5, size: 0.055, life: 0.8 }); }
        if (t >= TUNE.waterS) M.finish(p);
      } else if (s.kind === 'pick') {
        if (t >= TUNE.popAtS && !ev.pop) {
          ev.pop = 1;
          M.launchPick(p);
          p.stage = 'bare'; p.t = 0; p.plantOn = false; p.plantK = 0; p.shK = 0;
          p.sqV -= 4.5; p.lift = 0;
          M.crumbs(p, 16);
          ctx.sparks(p.x, 0.25, p.z, 6, { speed: 0.9, up: 1.2, size: 0.05, life: 0.6, grav: -3 });
          if (!s.auto) keeper.hop = Math.max(keeper.hop, 0.45);
        }
        if (t >= TUNE.pickS) M.finish(p);
      }
    },
    finish(p) {
      p.seq = null;
      if (M.act && M.act.p === p) M.endAct();
    },
    spoutPos(p, s) {
      const ctx = M.ctx;
      if (s.auto || !M.can.visible) return { x: p.x + 0.3, y: 0.85, z: p.z };
      ctx.keeper.root.updateMatrixWorld(true);
      const v = M._sp || (M._sp = new T.Vector3());
      M.can.userData.spout.getWorldPosition(v);
      return { x: v.x, y: Math.max(0.55, v.y), z: v.z };
    },

    /* the keeper's pose follows the plot's timeline: a spring for the bend (so it overshoots a little), eased arms */
    poseTargets(dt) {
      const a = M.act;
      let bendT = 0, rW = 0, lW = 0, canOn = false, tiltT = 0;
      if (a && a.p.seq) {
        const t = a.p.seq.t, k = a.kind;
        if (k === 'sow') {
          bendT = t < 0.12 ? -0.12 : t < 1.12 ? 1.0 : -0.06;
          rW = (t > 0.08 && t < 1.2) ? 1 : 0;
          M.rAng = (t < 0.7) ? -1.35 + (t > 0.32 ? Math.sin(t * 20) * 0.22 : 0) : -1.05;
        } else if (k === 'water') {
          bendT = t < 0.25 ? -0.08 : t < 1.3 ? 0.55 : -0.04;
          lW = (t > 0.08 && t < 1.55) ? 1 : 0;
          canOn = t > 0.12 && t < 1.6;
          M.lAng = -1.3;
          tiltT = (t > 0.45 && t < 1.25) ? 1 : 0;
        } else {
          bendT = t < 0.12 ? -0.1 : t < TUNE.tugFromS ? 0.95 : t < TUNE.popAtS ? 0.6 + 0.1 * Math.sin(t * 40) : t < 1.0 ? -0.3 : 0;
          rW = lW = (t > 0.08 && t < 1.2) ? 1 : 0;
          const ang = t < TUNE.tugFromS ? -1.5 : t < TUNE.popAtS ? -1.5 + 0.8 * smoothstep(TUNE.tugFromS, TUNE.popAtS, t) : -2.1;
          M.rAng = M.lAng = ang;
        }
      }
      M.bendT = bendT; M.canOn = canOn;
      M.rW = HH.damp(M.rW, rW, 14, dt); M.lW = HH.damp(M.lW, lW, 14, dt);
      M.tilt = HH.damp(M.tilt, tiltT, 9, dt);
      M.canK = HH.damp(M.canK, canOn ? 1 : 0, 14, dt);
      spring(M, 'bend', M.bendT, 140, 13, dt);
    },
    applyPose(dt) {
      const ctx = M.ctx, k = ctx.keeper;
      if (Math.abs(M.bend) > 0.002) {
        k.rig.rotation.x += 0.55 * M.bend;
        k.head.rotation.x += 0.22 * M.bend;
      }
      if (M.rW > 0.01) { k.armR.rotation.x = HH.lerp(k.armR.rotation.x, M.rAng, M.rW); k.armR.rotation.z = HH.lerp(k.armR.rotation.z, 0.06, M.rW); }
      if (M.lW > 0.01) { k.armL.rotation.x = HH.lerp(k.armL.rotation.x, M.lAng, M.lW); k.armL.rotation.z = HH.lerp(k.armL.rotation.z, -0.06, M.lW); }
      const cs = HH.easeOutBack(clamp(M.canK, 0, 1));
      M.can.visible = M.canK > 0.02;
      M.can.scale.setScalar(Math.max(0.001, cs));
      M.can.rotation.set(-(k.armL.rotation.x + 0.55 * M.bend) + M.tilt * 0.95, 0, 0);
    },

    /* a carrot flies out of the soil */
    launchPick(p) {
      const f = M.flyers.find(x => !x.visible);
      if (!f) { M.setPouch(M.pouch + 1, true); return; }
      f.userData.kind = 'pick'; f.userData.t = 0; f.userData.p = p; f.userData.spin = (Math.random() < 0.5 ? -1 : 1) * (7 + Math.random() * 3);
      f.userData.body.scale.set(1, 1, 1);
      f.visible = true; f.rotation.set(0, Math.random() * 6, 0);
      f.position.set(p.x, 0.3, p.z); f.scale.setScalar(1);
    },
    launchDeliver() {
      const f = M.flyers.find(x => !x.visible);
      if (!f) return false;
      const idx = M.pouch - 1;
      f.userData.kind = 'deliver'; f.userData.t = 0; f.userData.idx = idx; f.userData.spin = 6.283 * 1;
      f.visible = true; f.rotation.set(0, 0, 0);
      f.userData.body.scale.set(1, 0.2, 1);
      M.setPouch(M.pouch - 1, false);
      M.slotWorld(idx, f.position);
      f.scale.setScalar(TUNE.pouchScale);
      f.userData.from = new T.Vector3().copy(f.position);
      return true;
    },
    slotWorld(i, out) {
      const ctx = M.ctx;
      ctx.keeper.root.updateMatrixWorld(true);
      M.slots[Math.min(i, M.slots.length - 1)].getWorldPosition(out);
      return out;
    },

    updateFlyers(ctx, dt) {
      const { keeper } = ctx, L = ctx.larder;
      const tmp = M._t || (M._t = new T.Vector3());
      for (const f of M.flyers) {
        if (!f.visible) continue;
        const u = f.userData;
        u.t += dt;
        if (u.kind === 'pick') {
          const p = u.p, tR = TUNE.pickRiseS, tH = TUNE.pickHangS, tF = TUNE.pickFlyS;
          if (u.t < tR) {
            const k = u.t / tR, e = HH.easeOutCubic(k);
            f.position.set(p.x + 0.04 * e, 0.3 + (TUNE.pickRiseH - 0.3) * e, p.z);
            f.rotation.y += u.spin * dt;
            const st = 1 + Math.sin(k * Math.PI) * 0.12;
            f.scale.set(1 / Math.sqrt(st), st, 1 / Math.sqrt(st));
          } else if (u.t < tR + tH) {
            const k = (u.t - tR) / tH;
            f.position.set(p.x + 0.04, TUNE.pickRiseH + Math.sin(k * Math.PI) * 0.05, p.z);
            f.rotation.y += u.spin * 0.4 * dt;
            f.scale.setScalar(1);
            u.hx = f.position.x; u.hy = f.position.y; u.hz = f.position.z;
          } else {
            const k = clamp((u.t - tR - tH) / tF, 0, 1), e = HH.easeInOut(k);
            M.slotWorld(M.pouch, tmp);
            if (u.hx === undefined) { u.hx = p.x + 0.04; u.hy = TUNE.pickRiseH; u.hz = p.z; }
            f.position.set(HH.lerp(u.hx, tmp.x, e), HH.lerp(u.hy, tmp.y, e) + Math.sin(k * Math.PI) * 0.22, HH.lerp(u.hz, tmp.z, e));
            f.rotation.y += u.spin * 0.5 * (1 - k) * dt;
            f.scale.setScalar(HH.lerp(1, TUNE.pouchScale, e));
            f.userData.body.scale.y = HH.lerp(1, 0.2, smoothstep(0.55, 1, k));
            if (k >= 1) {
              f.visible = false; u.hx = undefined;
              M.setPouch(M.pouch + 1, true);
              keeper.hop = Math.max(keeper.hop, 0.4);
              ctx.sparks(tmp.x, tmp.y + 0.05, tmp.z, 6, { speed: 0.8, up: 1.3, size: 0.05, life: 0.6 });
            }
          }
        } else if (u.kind === 'deliver') {
          const tW = TUNE.deliverWindS, tF = TUNE.deliverFlyS;
          if (u.t < tW) {
            const k = u.t / tW;
            M.slotWorld(u.idx, tmp);
            f.position.set(tmp.x, tmp.y + 0.14 * ease(k), tmp.z);
            f.userData.body.scale.set(1, HH.lerp(0.2, 1, ease(k)), 1);
            f.rotation.set(0, keeper.facing, 0);
            u.sx = f.position.x; u.sy = f.position.y; u.sz = f.position.z;
            f.scale.setScalar(TUNE.pouchScale * (1 + 0.12 * Math.sin(k * Math.PI * 0.5)));
          } else {
            const k = clamp((u.t - tW) / tF, 0, 1), e = HH.easeInOut(k);
            f.position.set(HH.lerp(u.sx, L.pos.x, e), HH.lerp(u.sy, L.pos.y, e) + Math.sin(k * Math.PI) * TUNE.deliverHeight, HH.lerp(u.sz, L.pos.z, e));
            f.rotation.z = k * u.spin; f.rotation.x = 0;
            f.userData.body.scale.set(1, 1, 1);
            f.scale.setScalar(HH.lerp(TUNE.pouchScale, 0.55, e));
            if (k >= 1) {
              f.visible = false; f.rotation.set(0, 0, 0);
              if (L.add('carrot')) {
                ctx.sparks(L.pos.x, L.pos.y + 0.1, L.pos.z, 8, { speed: 0.8, up: 1.4, size: 0.055, life: 0.7 });
                keeper.hop = Math.max(keeper.hop, 0.45);
                M.delivered = (M.delivered || 0) + 1;
              } else {
                // the basket was full after all: back into the pouch
                const r = M.flyers.find(x => !x.visible);
                if (r) { r.userData.kind = 'return'; r.userData.t = 0; r.userData.from = new T.Vector3(L.pos.x, L.pos.y, L.pos.z); r.visible = true; r.rotation.set(0, 0, 0); r.userData.body.scale.set(1, 1, 1); r.scale.setScalar(0.55); r.position.copy(r.userData.from); }
                else M.setPouch(M.pouch + 1, true);
                M.gap = 1.5;
              }
            }
          }
        } else if (u.kind === 'return') {
          const k = clamp(u.t / TUNE.returnFlyS, 0, 1), e = HH.easeInOut(k);
          M.slotWorld(M.pouch, tmp);
          f.position.set(HH.lerp(u.from.x, tmp.x, e), HH.lerp(u.from.y, tmp.y, e) + Math.sin(k * Math.PI) * 0.4, HH.lerp(u.from.z, tmp.z, e));
          f.scale.setScalar(HH.lerp(0.55, TUNE.pouchScale, e));
          f.userData.body.scale.y = HH.lerp(1, 0.2, smoothstep(0.5, 1, k));
          if (k >= 1) { f.visible = false; M.setPouch(M.pouch + 1, true); }
        }
      }
    },

    /* what a plot looks like right now, from its stage and its little springs */
    showPlot(p, dt, t) {
      const ctx = M.ctx;
      const stg = p.stage;
      // the sprout pops up when sown
      if (p.plantOn) p.plantK = Math.min(1, p.plantK + dt / TUNE.sproutPopS); else p.plantK = 0;
      const g = stg === 'growing' ? clamp(p.t / TUNE.growS, 0, 1) : stg === 'ripe' ? 1 : 0;
      const pk = Math.max(0.001, HH.easeOutBack(p.plantK));
      // the sprout slumps when thirsty and springs back when watered
      spring(p, 'droop', (stg === 'thirsty' || p.hold.plant) ? 1 : 0, 70, 7, dt);
      spring(p, 'sq', 0, 230, 15, dt);
      spring(p, 'punch', 0, 150, 9, dt);
      // soil: pale and dry when thirsty, dark when watered
      const dryT = (stg === 'thirsty' || p.hold.soil) ? 1 : 0;
      p.dryK = dryT ? Math.min(1, p.dryK + dt * TUNE.dryRate) : Math.max(0, p.dryK - dt * 6);
      const wetT = (stg === 'growing' || stg === 'ripe') && !p.hold.soil ? (stg === 'ripe' ? TUNE.ripeSoilWet : HH.lerp(1, TUNE.ripeSoilWet, g)) : 0;
      p.wetK = wetT > p.wetK ? Math.min(wetT, p.wetK + dt * TUNE.soakRate) : Math.max(wetT, p.wetK - dt * (stg === 'bare' ? 7 : 0.5));
      const sq = clamp(p.sq, -0.7, 0.9);
      p.soil.scale.set(1 + sq * 0.22, 1 - sq * 0.5, 1 + sq * 0.22);
      const dk = ease(p.dryK), wk = ease(p.wetK);
      p.dryG.visible = dk > 0.01; p.dryG.scale.set(Math.max(0.001, dk), 1, Math.max(0.001, dk));
      p.wetG.visible = wk > 0.01; p.wetG.scale.set(Math.max(0.001, wk), 1, Math.max(0.001, wk));

      // plant
      p.plant.visible = p.plantK > 0.002;
      const s = p.seq, pickT = s && s.kind === 'pick' ? s.t : 0;
      const tugK = pickT > TUNE.tugFromS ? smoothstep(TUNE.tugFromS, TUNE.popAtS, pickT) : 0;
      p.wig = Math.max(0, p.wig - dt * 2.2);
      let rz = 0, rx = 0, lift = 0;
      if (tugK > 0 && pickT < TUNE.popAtS) { rz = Math.sin(t * 46) * 0.14 * tugK; rx = Math.cos(t * 41) * 0.08 * tugK; lift = 0.08 * tugK * tugK; p.sqV -= 0.8 * tugK * dt * 60 * 0.05; }
      else if (stg === 'ripe' && p.plantK >= 1) {
        p.wigT -= dt; p.glintT -= dt;
        if (p.wigT < 0) { p.wig = 1; p.wigT = TUNE.wigEveryS * (0.75 + Math.random() * 0.5); }
        if (p.glintT < 0) {
          p.glintT = TUNE.glintEveryS * (0.7 + Math.random() * 0.6);
          ctx.particles.spawn({ x: p.x + 0.04, y: 0.195 + TUNE.shoulderTop + 0.16, z: p.z + 0.05, vy: 0.15, life: 0.34, size: 0.1, r: 2.6, g: 2.1, b: 1.0, fadeIn: 0.05 });
          ctx.sparks(p.x, 0.195 + TUNE.shoulderTop + 0.14, p.z, 2, { speed: 0.3, up: 0.7, size: 0.04, life: 0.6, grav: 0.2 });
        }
        rz = Math.sin(t * 34) * 0.1 * p.wig; rx = Math.cos(t * 29) * 0.06 * p.wig;
        lift = 0.012 * Math.abs(Math.sin(t * 17)) * p.wig;
      }
      p.lift = lift;
      p.plant.position.y = lift;
      p.plant.rotation.set(rx, 0, rz);
      const pu = 1 + clamp(p.punch, -0.5, 0.8) * 0.28;
      p.plant.scale.set(pk * (2 - pu) * 1, pk * pu, pk * (2 - pu));

      // sprout
      const spK = 1 - smoothstep(0.06, 0.22, g);
      p.sp.visible = spK > 0.01;
      p.sp.scale.setScalar(Math.max(0.001, spK) * 1.35);
      const d = clamp(p.droop, -0.35, 1.25), wilt = d > 0.42;
      p.stemPiv.rotation.set(0, 0, -(d >= 0 ? d * 0.95 : d * 0.35));
      p.leafTilts.forEach(tl => { tl.rotation.z = HH.lerp(0.5, -1.2, clamp(d, -0.3, 1.25) * 0.8 + (d > 1 ? (d - 1) * 0.2 : 0)); });
      p.sprites.stem[0].visible = !wilt; p.sprites.stem[1].visible = wilt;
      p.sprites.leaves.forEach(pair => { pair[0].visible = !wilt; pair[1].visible = wilt; });
      p.sp.rotation.y = 0;

      // full leaves
      p.bl.forEach((b, n) => {
        const B = BLADES[n];
        const pop = HH.easeOutBack(clamp((g - B[4]) / 0.13, 0, 1));
        b.piv.visible = pop > 0.01;
        const sz = B[1] * (0.45 + 0.55 * HH.easeOutCubic(g)) * Math.max(0.001, pop);
        b.piv.scale.set(sz * 1.0, sz, sz * 1.0);
        b.tilt.rotation.z = -B[0] * HH.lerp(0.7, 1.05, g);
      });
      // the orange shoulder
      const shT = stg === 'ripe' ? 1 : stg === 'growing' ? HH.lerp(0, 0.55, smoothstep(0.25, 1, g)) : 0;
      p.shK = HH.damp(p.shK, shT, stg === 'ripe' ? 5 : 20, dt);
      const e = ease(clamp(p.shK, 0, 1));
      p.shoulder.visible = p.shK > 0.02;
      p.shoulder.position.y = HH.lerp(-0.13, TUNE.shoulderTop, e);
      const ss = HH.lerp(0.4, 1.3, e);
      p.shoulder.scale.set(ss, 1, ss);

      // the water-drop mark: pops up over a thirsty sprout and bobs
      const dropWant = stg === 'thirsty' && !p.hold.plant && !(s && s.kind === 'water');
      p.dropK = dropWant ? Math.min(1, p.dropK + dt / 0.35) : Math.max(0, p.dropK - dt / 0.18);
      p.drop.visible = p.dropK > 0.01;
      if (p.drop.visible) {
        const sc = TUNE.dropSize * Math.max(0.001, HH.easeOutBack(clamp(p.dropK, 0, 1))) * (1 + Math.sin(t * 5 + p.bob) * 0.04);
        p.drop.scale.set(sc, sc, sc);
        p.drop.position.set(p.x, 0.195 + TUNE.dropHeight + Math.sin(t * 3.2 + p.bob) * 0.06, p.z);
      }
    },

    update(ctx, dt) {
      const { st, keeper } = ctx;
      if (!M.dbg && window.game && window.game.debug) { M.dbg = true; M.attachDebug(ctx); }
      const t = st.time, K = ctx.input.keeper;

      // clocks, and the Keeper doing the watering for herself when the player is away as the Hunter
      for (const p of M.plots) {
        M.tick(p, dt);
        if (p.stage === 'thirsty' && ctx.solo === 'hunter' && !p.seq && p.t >= TUNE.soloWaterS) M.begin(p, true);
      }

      // the nearest plot with something to do
      let target = null, nd = TUNE.reach;
      if (st.started && !M.act && ctx.solo !== 'hunter') {
        for (const p of M.plots) {
          if (p.seq) continue;
          const can = p.stage === 'bare' || p.stage === 'thirsty' || (p.stage === 'ripe' && M.free() > 0);
          if (!can) continue;
          const d = Math.hypot(keeper.x - p.x, keeper.z - p.z);
          if (d < nd) { nd = d; target = p; }
        }
      }
      if (target && K.act) { K.act = false; M.begin(target, false); target = null; }

      // while she works she turns to the plot
      if (M.act) {
        const p = M.act.p;
        let dA = Math.atan2(p.x - keeper.x, p.z - keeper.z) - keeper.facing;
        while (dA > Math.PI) dA -= Math.PI * 2;
        while (dA < -Math.PI) dA += Math.PI * 2;
        keeper.facing += dA * (1 - Math.exp(-14 * dt));
      }
      for (const p of M.plots) M.runSeq(p, dt);
      M.poseTargets(dt);
      for (const p of M.plots) M.showPlot(p, dt, t);

      // the pouch
      M.slots.forEach((sl, i) => {
        const u = sl.userData;
        if (i < M.pouch) {
          if (u.pop < 1) { u.popT += dt / 0.34; u.pop = HH.easeOutBack(clamp(u.popT, 0, 1)); }
          sl.visible = true;
          sl.scale.setScalar(TUNE.pouchScale * Math.max(0.001, u.pop));
          const w = keeper.speed01 * Math.sin(keeper.phase * 2 + i);
          sl.rotation.set(u.base.x + w * 0.12, u.base.y, u.base.z + Math.sin(t * 2.2 + i * 2) * 0.03 + w * 0.1);
        } else sl.visible = false;
      });

      // into the basket, one after another
      const L = ctx.larder;
      M.gap -= dt;
      if (L && st.started && !M.act && M.pouch > 0 && M.gap <= 0 && Math.hypot(keeper.x - L.pos.x, keeper.z - L.pos.z) < L.reach &&
          L.room('carrot') - M.airborne(['deliver']) > 0) {
        if (M.launchDeliver()) M.gap = TUNE.deliverGapS;
      }
      M.updateFlyers(ctx, dt);

      // the key prompt over the plot she would act on
      if (target) M.promptAt = target;
      M.promptK = HH.damp(M.promptK, target ? 1 : 0, 12, dt);
      const pa = M.promptAt;
      M.prompt.visible = !!pa && M.promptK > 0.02;
      if (pa) {
        M.prompt.scale.setScalar(0.5 * HH.easeOutBack(clamp(M.promptK, 0, 1)));
        const h = TUNE.promptHeight[pa.stage === 'ripe' ? 'ripe' : pa.stage === 'thirsty' ? 'thirsty' : 'bare'];
        M.prompt.position.set(pa.x, 0.195 + h + Math.sin(t * 3) * 0.04, pa.z);
      }
    },

    attachDebug(ctx) {
      window.game.debug.garden = {
        state() {
          return { plots: M.plots.map(p => ({ i: p.i, stage: p.stage, t: +p.t.toFixed(2), busy: p.seq ? p.seq.kind : null })), pouch: M.pouch, flying: M.airborne(['pick', 'deliver', 'return']), delivered: M.delivered || 0 };
        },
        set(i, stage) {
          const p = M.plots[i];
          if (!p || ['bare', 'sown', 'thirsty', 'growing', 'ripe'].indexOf(stage) < 0) return this;
          M.setStage(p, stage, true);
          if (M.act && M.act.p === p) M.endAct();
          return this;
        },
        skip(seconds) { M.plots.forEach(p => M.tick(p, seconds)); return this; },
        give(n) { M.setPouch(n === undefined ? M.pouch + 1 : n, true); return this; }
      };
    }
  };
  (HH.mechanics = HH.mechanics || []).push(M);
})();
