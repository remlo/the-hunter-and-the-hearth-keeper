/* mech-waystone.js: the Hunter lights the standing stone at the end of the path and a spark flies home.
   The Hunter raises the lantern near the stone (game.js plays the gesture; this file does not claim the press),
   the stone catches a moment later, and a spark runs the path back to the hearth, where the Keeper sees it arrive.
   Lighting it once lengthens the lantern's burn for the rest of the session. */
(function () {
  'use strict';
  const T = THREE, HH = window.HH;
  const clamp = HH.clamp, lerp = HH.lerp, smooth = HH.smooth;

  /* ---------- tuning: everything to adjust by feel is here ---------- */
  const TUNE_WS = {
    reach: 2.0,            // how close the Hunter must stand to light the stone
    promptReach: 2.4,      // the key prompt shows a little earlier than the press works
    catchDelay: 0.6,       // seconds from the raised lantern to the stone catching
    lightRadius: 6,        // final radius of the stone's warm light
    lightGrow: 1.4,        // seconds for that light to grow
    lightY: 1.7,           // height of the light
    lightIntensity: 1.9,   // steady brightness (the lantern is about 1.9 to 3.0)
    lightFlash: 0.9,       // extra brightness at the moment it catches, fading over flashSeconds
    flashSeconds: 0.9,
    flicker: 0.035,        // gentle: fraction of radius and brightness
    safeRadius: 5,         // the lantern does not burn inside this
    sparkSeconds: 2.5,     // stone to hearth
    sparkHeight: 1.5,      // flight height along the path
    sparkBob: 0.14,
    sparkLightRadius: 5,
    sparkLightIntensity: 2.4,
    burnBonus: 1.25,       // one time reward: multiplies TUNE.lanternBurnSeconds
    markStagger: 0.11,     // seconds between glowing marks catching
    markBase: 1.5          // brightness of the glowing marks
  };

  const WARM = [1.0, 0.5, 0.15];
  const S = { phase: 'dark', pending: -1, litT: 0, spark: null, rewarded: false, zone: null, attached: false, prompt: null, promptK: 0, emberAcc: 0 };
  let marks = [], markMat, sparkMesh, curve, prevPos, tagTimer = 0;
  let ui = {};

  /* ---------- interface: a small stone marker in the Hunter's chip ---------- */
  function buildUi(ctx) {
    const css = document.createElement('style');
    css.textContent = [
      '.ws-mark { position: relative; flex: none; width: 36px; height: 36px; border-radius: 50%; display: grid; place-items: center; color: var(--ash, #8d909a); background: rgba(244, 230, 200, 0.16); transition: background-color 0.5s ease, color 0.5s ease, box-shadow 0.5s ease; }',
      '.ws-mark::before { content: ""; position: absolute; inset: 3px; border-radius: 50%; background: #1b1310; }',
      '.ws-mark svg { position: relative; display: block; overflow: visible; }',
      '.ws-mark .ws-stone { fill: currentColor; opacity: 0.55; transition: opacity 0.5s ease; }',
      '.ws-mark .ws-rune { fill: none; stroke: #1b1310; stroke-width: 1.5; stroke-linecap: round; transition: stroke 0.5s ease; }',
      '.ws-mark.is-lit { background: var(--ember); color: var(--ember); box-shadow: 0 0 14px rgba(255, 180, 74, 0.5); }',
      '.ws-mark.is-lit .ws-stone { opacity: 1; }',
      '.ws-mark.is-lit .ws-rune { stroke: #fff1cf; }',
      '.ws-mark.is-pulse { animation: ws-pulse 0.9s ease-out; }',
      '.ws-mark.is-pop svg { animation: ws-pop 0.5s cubic-bezier(0.3, 1.6, 0.5, 1); }',
      '.ws-tag { position: absolute; left: 50%; bottom: calc(100% + 10px); transform: translate(-50%, 6px); padding: 5px 9px; border-radius: 9px; background: var(--panel); border: 1px solid var(--panel-line); color: var(--ember); font: 700 12px/1 var(--body); white-space: nowrap; opacity: 0; pointer-events: none; }',
      '.ws-tag.is-on { animation: ws-tag 3.2s ease-out forwards; }',
      '@keyframes ws-pulse { 0% { box-shadow: 0 0 0 0 rgba(255, 180, 74, 0.9), 0 0 14px rgba(255, 180, 74, 0.5); } 100% { box-shadow: 0 0 0 18px rgba(255, 180, 74, 0), 0 0 14px rgba(255, 180, 74, 0.5); } }',
      '@keyframes ws-pop { 0% { transform: scale(0.7); } 100% { transform: scale(1); } }',
      '@keyframes ws-tag { 0% { opacity: 0; transform: translate(-50%, 6px); } 12% { opacity: 1; transform: translate(-50%, 0); } 78% { opacity: 1; transform: translate(-50%, 0); } 100% { opacity: 0; transform: translate(-50%, -3px); } }',
      '@media (max-width: 520px) { .ws-mark { width: 32px; height: 32px; } }',
      '@media (prefers-reduced-motion: reduce) { .ws-mark, .ws-mark .ws-stone, .ws-mark .ws-rune { transition: none; } .ws-mark.is-pulse, .ws-mark.is-pop svg, .ws-tag.is-on { animation: none; } .ws-tag.is-on { opacity: 1; transform: translate(-50%, 0); } }'
    ].join('\n');
    document.head.appendChild(css);

    const el = document.createElement('div');
    el.className = 'ws-mark';
    el.setAttribute('role', 'img');
    el.setAttribute('aria-label', 'Waystone: dark');
    el.title = 'The waystone at the end of the path';
    el.innerHTML = '<svg viewBox="0 0 20 24" width="14" height="17" aria-hidden="true">' +
      '<path class="ws-stone" d="M5.2 22.4 3.6 11.2 6.6 3.4 11.2 1.6 15.4 5.2 16.6 12.6 14.6 22.4Z"/>' +
      '<path class="ws-rune" d="M7.4 10.2h5.6M7.4 15h5.6M8.8 8.2v8.6M11.6 8.2v8.6"/></svg>' +
      '<span class="ws-tag">lantern burns longer</span>';
    const lan = document.getElementById('lantern');
    if (lan && lan.parentNode) lan.parentNode.insertBefore(el, lan.nextSibling);
    else if (ctx.hud) ctx.hud.appendChild(el);
    ui = { el, tag: el.querySelector('.ws-tag') };
  }

  function setUiLit(lit) {
    if (!ui.el) return;
    ui.el.classList.toggle('is-lit', lit);
    ui.el.setAttribute('aria-label', lit ? 'Waystone: lit' : 'Waystone: dark');
    if (lit) { ui.el.classList.remove('is-pop'); void ui.el.offsetWidth; ui.el.classList.add('is-pop'); }
  }
  function pulseUi() { ui.el.classList.remove('is-pulse'); void ui.el.offsetWidth; ui.el.classList.add('is-pulse'); }
  function showTag() {
    ui.tag.classList.remove('is-on'); void ui.tag.offsetWidth; ui.tag.classList.add('is-on');
  }

  /* ---------- the key prompt: same look as the wood pile's, a wider key ---------- */
  function makeEnterPrompt() {
    const cv = document.createElement('canvas');
    cv.width = 192; cv.height = 128;
    const x = cv.getContext('2d');
    const rr = (px, py, w, h, r) => { x.beginPath(); x.moveTo(px + r, py); x.arcTo(px + w, py, px + w, py + h, r); x.arcTo(px + w, py + h, px, py + h, r); x.arcTo(px, py + h, px, py, r); x.arcTo(px, py, px + w, py, r); x.closePath(); };
    x.fillStyle = 'rgba(30,20,16,0.55)'; rr(22, 28, 148, 84, 20); x.fill();
    x.fillStyle = '#f3e3c2'; rr(22, 20, 148, 84, 20); x.fill();
    x.fillStyle = '#3a2a22';
    x.font = '700 42px "Zen Maru Gothic", "Segoe UI", sans-serif';
    x.textAlign = 'center'; x.textBaseline = 'middle';
    x.fillText('Enter', 96, 63);
    const tex = new T.CanvasTexture(cv);
    tex.encoding = T.sRGBEncoding;
    const sp = new T.Sprite(new T.SpriteMaterial({ map: tex, transparent: true, depthTest: false, depthWrite: false }));
    sp.renderOrder = 10;
    sp.scale.set(0.93, 0.62, 1);
    return sp;
  }

  /* ---------- the glowing marks, laid over the stone's own rune ---------- */
  function buildMarks(ctx) {
    const ws = ctx.W.waystone;
    markMat = new T.MeshBasicMaterial({ vertexColors: true });
    markMat.color.setScalar(0.001);
    const hot = HH.hdr(0xffd890, TUNE_WS.markBase * 1.5), amber = HH.hdr(0xffa53a, TUNE_WS.markBase * 1.4);
    // the stone's own cyan rune sits at (+0.24, 1.25, +0.4) facing the camera; mine lie just in front of it and cover it
    const yaw = Math.PI / 4 + 0.15, nx = Math.sin(yaw), nz = Math.cos(yaw);
    const make = (lx, ly, lz, ry, sc, parts) => {
      const k = new HH.Kit();
      parts.forEach(p => k.box(p[2], p[3], 0.05, p[0], p[1], 0, p[4] || amber, { glow: true, r: 0, rz: p[5] || 0 }));
      const g = k.build({ mats: { glow: markMat }, cast: false, receive: false });
      const holder = new T.Group();
      holder.add(g);
      holder.position.set(ws.x + lx, ly, ws.z + lz);
      holder.rotation.y = ry;
      holder.userData.sc = sc;
      holder.scale.setScalar(0.001);
      holder.visible = false;
      ctx.scene.add(holder);
      marks.push(holder);
    };
    // main rune: a hash, bigger than the cyan one beneath it, with a hot diamond at the centre
    make(0.24 + nx * 0.035, 1.25, 0.4 + nz * 0.035, yaw, 1, [
      [0, 0.17, 0.36, 0.065], [0, -0.17, 0.36, 0.065], [0.125, 0, 0.065, 0.5], [-0.125, 0, 0.065, 0.5],
      [0, 0, 0.12, 0.12, hot, Math.PI / 4]
    ]);
    // a short mark above it and two small ones below, climbing the stone
    make(0.2 + nx * 0.02, 1.86, 0.34 + nz * 0.02, yaw + 0.05, 1, [[0, 0, 0.17, 0.05], [0, 0.11, 0.05, 0.17], [0, 0, 0.07, 0.07, hot, Math.PI / 4]]);
    make(0.2 + nx * 0.02, 0.66, 0.36 + nz * 0.02, yaw - 0.05, 1, [[0, 0, 0.05, 0.2], [0.08, 0.04, 0.05, 0.11], [-0.08, -0.04, 0.05, 0.11]]);
  }

  /* ---------- the spark's route: path back to the gate, then through the door to the hearth ---------- */
  function buildRoute(ctx) {
    const W = ctx.W, h = TUNE_WS.sparkHeight, pts = [];
    pts.push(new T.Vector3(W.waystone.x, 2.9, W.waystone.z));
    for (let u = 78; u > 0.5; u -= 2.5) {
      const p = HH.uv2w(u, W.pathV(u));
      const lift = smooth(76, 70, u) ;          // starts high over the stone, settles to flight height
      pts.push(new T.Vector3(p.x, h + (1 - lift) * 0.9 + Math.sin(u * 0.35) * 0.18, p.z));
    }
    pts.push(new T.Vector3(-2.7, 1.35, -0.7));  // through the door
    pts.push(new T.Vector3(-4.1, 1.05, W.fire.z + 0.95));
    pts.push(new T.Vector3(W.fire.x, 0.78, W.fire.z + 0.4));
    curve = new T.CatmullRomCurve3(pts, false, 'centripetal');
    curve.arcLengthDivisions = 400;
    prevPos = new T.Vector3();
  }

  function buildSpark(ctx) {
    const k = new HH.Kit();
    k.ico(0.1, 0, 0, 0, HH.hdr(0xfff0c8, 3.2), { glow: true, detail: 0 });
    sparkMesh = k.build({ cast: false, receive: false });
    sparkMesh.visible = false;
    ctx.scene.add(sparkMesh);
  }

  /* ---------- the sequence ---------- */
  function startLighting(ctx, delay) {
    if (S.phase !== 'dark') return false;
    S.phase = 'lighting';
    S.pending = delay;
    return true;
  }

  function catches(ctx) {
    const ws = ctx.W.waystone;
    S.phase = 'lit'; S.pending = -1; S.litT = 0;
    marks.forEach(m => { m.visible = true; });
    S.zone = { x: ws.x, z: ws.z, r: TUNE_WS.safeRadius };
    ctx.safeZones.push(S.zone);
    ctx.sparks(ws.x, 2.3, ws.z, 34, { speed: 2.4, up: 3.2, life: 1.3, size: 0.09 });
    ctx.sparks(ws.x, 1.3, ws.z, 26, { speed: 3.0, up: 1.2, life: 1.0, size: 0.075, grav: -0.8 });
    setUiLit(true);
    pulseUi();
    // the spark leaves the top of the stone
    S.spark = { t: 0 };
    curve.getPointAt(0, prevPos);
  }

  function arrives(ctx) {
    const f = ctx.W.fire;
    S.spark = null;
    sparkMesh.visible = false;
    ctx.warm(5).pos.set(0, 0, 0, 0.001);
    ctx.st.roar = 1;
    ctx.sparks(f.x, 0.55, f.z + 0.3, 36, { speed: 1.5, up: 3.0, life: 1.4 });
    ctx.sparks(f.x, 0.9, f.z + 0.35, 16, { speed: 1.0, up: 3.8, life: 1.6, grav: -0.5, size: 0.065 });
    ctx.view.pulseSeam(1);
    if (ctx.keeper.act <= 0) ctx.keeper.playAct('cheer');
    pulseUi();
    if (!S.rewarded) {
      S.rewarded = true;
      ctx.TUNE.lanternBurnSeconds *= TUNE_WS.burnBonus;
      showTag();
    }
    ctx.emit('waystone');
  }

  function flyingSpark(ctx, dt) {
    const sp = S.spark, ps = ctx.particles, P = new T.Vector3();
    sp.t += dt;
    const k = clamp(sp.t / TUNE_WS.sparkSeconds, 0, 1);
    const e = lerp(k, smooth(0, 1, k), 0.4);          // a little easing at each end, mostly steady
    curve.getPointAt(e, P);
    P.y += Math.sin(sp.t * 13) * TUNE_WS.sparkBob * Math.sin(k * Math.PI);
    const dist = P.distanceTo(prevPos), n = Math.max(3, Math.ceil(dist / 0.14));
    for (let i = 1; i <= n; i++) {
      const f = i / n, x = lerp(prevPos.x, P.x, f), y = lerp(prevPos.y, P.y, f), z = lerp(prevPos.z, P.z, f);
      ps.spawn({
        x, y, z, vx: (Math.random() - 0.5) * 0.5, vy: 0.2 + Math.random() * 0.5, vz: (Math.random() - 0.5) * 0.5,
        life: 0.2 + Math.random() * 0.12, size: 0.17 + Math.random() * 0.1, r: 3.4, g: 1.9, b: 0.55, drag: 1.2, wob: 0.15
      });
      if (Math.random() < 0.35) {
        ps.spawn({
          x, y, z, vx: (Math.random() - 0.5) * 0.7, vy: 0.3 + Math.random() * 0.6, vz: (Math.random() - 0.5) * 0.7,
          life: 0.8 + Math.random() * 0.7, size: 0.05 + Math.random() * 0.04, r: 3.0, g: 1.3, b: 0.35, grav: -0.9, drag: 0.9, wob: 0.3
        });
      }
    }
    // the head: a bright blob in the particles and a small spinning gem
    ps.spawn({ x: P.x, y: P.y, z: P.z, life: 0.07, size: 0.62, r: 3.6, g: 2.4, b: 0.95, fadeIn: 0.01 });
    sparkMesh.visible = true;
    sparkMesh.position.copy(P);
    sparkMesh.rotation.set(sp.t * 7, sp.t * 5, 0);
    sparkMesh.scale.setScalar(1 + Math.sin(sp.t * 30) * 0.15);
    prevPos.copy(P);
    // a small moving light so the ground along the path lights up as it passes
    const wp = ctx.warm(5);
    wp.pos.set(P.x, Math.max(P.y, 0.9), P.z, TUNE_WS.sparkLightRadius);
    wp.col.set(WARM[0], WARM[1], WARM[2]).multiplyScalar(TUNE_WS.sparkLightIntensity * (0.6 + 0.4 * smooth(0, 0.08, k)));
    if (k >= 1) arrives(ctx);
  }

  function stoneLight(ctx, dt) {
    const wp = ctx.warm(4), ws = ctx.W.waystone, t = ctx.st.time;
    if (S.phase !== 'lit') { wp.pos.set(ws.x, TUNE_WS.lightY, ws.z, 0.001); wp.col.set(0, 0, 0); return; }
    S.litT += dt;
    const g = HH.easeOutCubic(clamp(S.litT / TUNE_WS.lightGrow, 0, 1));
    const fl = 1 + HH.wob(t * 0.8, 3.1) * TUNE_WS.flicker;
    const flash = 1 + TUNE_WS.lightFlash * Math.max(0, 1 - S.litT / TUNE_WS.flashSeconds);
    wp.pos.set(ws.x, TUNE_WS.lightY, ws.z, Math.max(0.001, TUNE_WS.lightRadius * g * fl));
    wp.col.set(WARM[0], WARM[1], WARM[2]).multiplyScalar(TUNE_WS.lightIntensity * flash * fl);
    // the marks catch one after another, then breathe
    marks.forEach((m, i) => {
      const a = clamp((S.litT - i * TUNE_WS.markStagger) / 0.35, 0, 1);
      m.scale.setScalar(Math.max(0.001, HH.easeOutBack(a)));
    });
    markMat.color.setScalar((0.85 + 0.15 * Math.sin(t * 2.1) + 0.12 * HH.wob(t, 1.3)) * (1 + 1.2 * Math.max(0, 1 - S.litT / 0.7)));
    // an ember now and then rises from the top
    S.emberAcc += dt * 1.6;
    while (S.emberAcc > 1) {
      S.emberAcc -= 1;
      ctx.particles.spawn({ x: ws.x + (Math.random() - 0.5) * 0.4, y: 2.2 + Math.random() * 0.3, z: ws.z + (Math.random() - 0.5) * 0.3, vx: (Math.random() - 0.5) * 0.3, vy: 0.5 + Math.random() * 0.6, vz: (Math.random() - 0.5) * 0.3, life: 1.2 + Math.random() * 0.9, size: 0.045 + Math.random() * 0.04, r: 3.0, g: 1.3, b: 0.35, drag: 0.6, wob: 0.25 });
    }
  }

  function reset(ctx) {
    S.phase = 'dark'; S.pending = -1; S.litT = 0; S.spark = null; S.emberAcc = 0;
    if (S.zone) { const i = ctx.safeZones.indexOf(S.zone); if (i >= 0) ctx.safeZones.splice(i, 1); S.zone = null; }
    marks.forEach(m => { m.visible = false; m.scale.setScalar(0.001); });
    markMat.color.setScalar(0.001);
    sparkMesh.visible = false;
    ctx.warm(5).pos.set(0, 0, 0, 0.001);
    ctx.warm(4).pos.set(ctx.W.waystone.x, TUNE_WS.lightY, ctx.W.waystone.z, 0.001);
    if (S.rewarded) { S.rewarded = false; ctx.TUNE.lanternBurnSeconds /= TUNE_WS.burnBonus; }
    setUiLit(false);
    ui.tag.classList.remove('is-on');
  }

  function attachDebug(ctx) {
    // window.game is created after init, and before that the name belongs to the #game element, so wait for .debug
    if (!window.game || !window.game.debug) return;
    S.attached = true;
    window.game.debug.waystone = {
      light() { return startLighting(ctx, 0); },
      reset() { reset(ctx); return this; },
      state() {
        return {
          phase: S.phase, lit: S.phase === 'lit', rewarded: S.rewarded, burnSeconds: ctx.TUNE.lanternBurnSeconds,
          sparkT: S.spark ? +S.spark.t.toFixed(2) : null, lightRadius: +ctx.warm(4).pos.w.toFixed(2),
          safeZone: ctx.safeZones.indexOf(S.zone) >= 0, tune: TUNE_WS
        };
      }
    };
  }

  HH.mechanics = HH.mechanics || [];
  HH.mechanics.push({
    name: 'waystone',
    init(ctx) {
      buildUi(ctx);
      buildMarks(ctx);
      buildRoute(ctx);
      buildSpark(ctx);
      S.prompt = HH.touchMode ? HH.makePrompt('') : makeEnterPrompt();   // on a touch screen the shared tap mark replaces the key
      S.prompt.visible = false;
      ctx.scene.add(S.prompt);
      ctx.warm(4).pos.set(ctx.W.waystone.x, TUNE_WS.lightY, ctx.W.waystone.z, 0.001);
      ctx.warm(5).pos.set(0, 0, 0, 0.001);
    },
    update(ctx, dt) {
      if (!S.attached) attachDebug(ctx);
      const ws = ctx.W.waystone, h = ctx.hunter, st = ctx.st;
      const d = Math.hypot(h.x - ws.x, h.z - ws.z);

      // the press: not claimed, so the raise gesture plays; the stone catches after a beat
      if (S.phase === 'dark' && ctx.input.hunter.act && h.act <= 0 && st.fuel > 0 && d < TUNE_WS.reach) startLighting(ctx, TUNE_WS.catchDelay);
      if (S.phase === 'lighting') {
        S.pending -= dt;
        // turn to the stone, and a thread of sparks runs from the lantern to it
        let a = Math.atan2(ws.x - h.x, ws.z - h.z) - h.facing;
        while (a > Math.PI) a -= 6.283; while (a < -Math.PI) a += 6.283;
        h.facing += a * (1 - Math.exp(-10 * dt));
        if (S.pending > 0 && S.pending < TUNE_WS.catchDelay) {
          const lw = h.lanternWorld, tx = ws.x - lw.x, ty = 1.9 - lw.y, tz = ws.z - lw.z, sec = 0.45;
          ctx.particles.spawn({ x: lw.x, y: lw.y + 0.3, z: lw.z, vx: tx / sec + (Math.random() - 0.5) * 0.6, vy: ty / sec + Math.random() * 0.8, vz: tz / sec + (Math.random() - 0.5) * 0.6, life: sec, size: 0.055 + Math.random() * 0.04, r: 3.0, g: 1.5, b: 0.4, drag: 0, wob: 0.1 });
        }
        if (S.pending <= 0) catches(ctx);
      }

      stoneLight(ctx, dt);
      if (S.spark) flyingSpark(ctx, dt);
      else if (S.phase !== 'lit') ctx.warm(5).col.set(0, 0, 0);

      // the key prompt over the stone
      const want = S.phase === 'dark' && d < TUNE_WS.promptReach && st.started ? 1 : 0;
      S.promptK = HH.damp(S.promptK, want, 12, dt);
      S.prompt.visible = S.promptK > 0.02;
      S.prompt.scale.set(HH.touchMode ? 0.62 : 0.93, 0.62, 1).multiplyScalar(HH.easeOutBack(clamp(S.promptK, 0, 1)));
      S.prompt.material.opacity = st.fuel > 0 ? 1 : 0.4;
      S.prompt.position.set(ws.x, 3.15 + Math.sin(st.time * 3) * 0.04, ws.z);
    },
    on(event, data, ctx) {}
  });
})();
