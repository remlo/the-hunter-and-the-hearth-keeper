/* mech-sprint.js: the Hunter's supper turns into sprint bursts. Eating gives one to three; each press of the
   sprint button spends one for a short, strong run with dust thrown back from the heels.
   Other mechanics talk to it through ctx.sprint = { set(n, quality), count(), active() }. */
(function () {
  'use strict';
  const HH = window.HH;

  /* ---------- tuning: every number you will want to feel out is here ---------- */
  const TUNE = {
    maxBursts: 3,           // most bursts the Hunter can hold
    burstSeconds: 1.2,      // how long one burst lasts
    speedMult: 1.9,         // walking speed times this at the peak of a burst
    easeIn: 0.1,            // seconds to reach full speed
    easeOut: 0.2,           // seconds to come back to walking speed at the end
    cooldown: 0.3,          // a new burst cannot start until this long after the last one ended
    kick: 0.8,              // the little hop at the start (0 to 1, the same scale as the Hunter's other hops)
    dustEvery: 0.032,       // seconds between puffs from the heels while running
    dustPerPuff: 2,         // one for each heel
    dustSize: 0.17,         // size of a puff of dust
    dustLife: 0.65,         // how long a puff hangs in the air
    dustBack: 1.9,          // how hard dust is thrown backwards
    skidPuffs: 16,          // puffs in the skid at the end of a burst
    startPuffs: 12,         // puffs kicked up at the start
    dustPale: [0.5, 0.46, 0.4],          // colour of the dust (additive, so pale)
    dustGolden: [0.66, 0.52, 0.28],      // a golden supper's dust is a little warmer
    shakeSeconds: 0.4       // the marks shake this long when you press with none left
  };

  /* the bowl takes the colours the supper's stew has: plain, good, golden */
  const CSS = [
    '.hhs-sprint { display: none; align-items: center; gap: 8px; padding-left: 10px; margin-left: 2px; border-left: 1px solid var(--panel-line); white-space: nowrap; color: var(--ink); }',
    '.hhs-sprint.is-on { display: inline-flex; }',
    '.hhs-sprint svg { flex: none; }',
    '.hhs-sprint .stew { fill: var(--ember); transition: fill 0.3s ease; }',
    '.hhs-sprint .steam { stroke: var(--ink-soft); opacity: 0; animation: hhs-steam 2.4s ease-in-out infinite; }',
    '.hhs-sprint .steam + .steam { animation-delay: 1.1s; }',
    '.hhs-sprint.q-good .stew { fill: #e2862a; }',
    '.hhs-sprint.q-golden .stew { fill: #ffd25e; }',
    '.hhs-sprint.q-golden .hhs-bowl { filter: drop-shadow(0 0 5px rgba(255, 190, 80, 0.85)); }',
    '.hhs-bowl { display: inline-flex; }',
    '.hhs-bowl.is-pop { animation: hhs-bowlpop 0.5s cubic-bezier(0.2, 1.5, 0.4, 1); }',
    '.hhs-marks { display: inline-flex; gap: 4px; }',
    /* the marks lean forward, so they read as speed rather than as wood */
    '.hhs-mark { box-sizing: border-box; width: 12px; height: 9px; border-radius: 2.5px; border: 1.5px solid var(--panel-line); background: rgba(244, 230, 200, 0.06); transform: skewX(-24deg); transition: background 0.18s ease, border-color 0.18s ease, box-shadow 0.18s ease; }',
    '.hhs-mark.is-on { background: var(--ember); border-color: var(--ember); box-shadow: 0 0 9px rgba(255, 180, 74, 0.55); }',
    '.hhs-sprint.q-golden .hhs-mark.is-on { background: #ffd25e; border-color: #ffd25e; box-shadow: 0 0 10px rgba(255, 210, 94, 0.7); }',
    '.hhs-mark.is-pop { animation: hhs-pop 0.34s cubic-bezier(0.3, 1.7, 0.5, 1); }',
    '.hhs-sprint.is-shake .hhs-marks { animation: hhs-shake 0.4s ease-in-out; }',
    '@keyframes hhs-pop { 0% { transform: skewX(-24deg) scale(0.4, 1.9); } 55% { transform: skewX(-24deg) scale(1.3, 0.7); } 100% { transform: skewX(-24deg); } }',
    '@keyframes hhs-bowlpop { 0% { transform: scale(0.6); } 55% { transform: scale(1.28); } 100% { transform: scale(1); } }',
    '@keyframes hhs-shake { 0%, 100% { transform: translateX(0); } 18% { transform: translateX(-3px); } 40% { transform: translateX(3px); } 62% { transform: translateX(-2px); } 82% { transform: translateX(1.5px); } }',
    '@keyframes hhs-steam { 0%, 100% { opacity: 0; transform: translateY(1px); } 50% { opacity: 0.9; transform: translateY(-1.5px); } }',
    '@media (prefers-reduced-motion: reduce) { .hhs-mark.is-pop, .hhs-bowl.is-pop, .hhs-sprint.is-shake .hhs-marks, .hhs-sprint .steam { animation: none; } }'
  ].join('\n');

  const QUALITY_ORDER = ['plain', 'good', 'golden'];
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
  const ease = t => t * t * (3 - 2 * t);

  const M = {
    name: 'sprint',
    count: 0, quality: 'plain', given: false,
    t: -1,                  // seconds into the running burst, or -1 when none is running
    lastEnd: -99,           // game time when the last burst ended
    dustAcc: 0, dbg: false, shakeT: 0,
    el: null, marks: [], bowl: null,

    init(ctx) {
      M.ctx = ctx;
      const style = document.createElement('style');
      style.textContent = CSS;
      document.head.appendChild(style);

      // the marks sit in the Hunter's chip, after the wood marks
      const wood = ctx.hud.querySelector('.hhw-wood');
      const el = document.createElement('span');
      el.className = 'hhs-sprint';
      el.setAttribute('role', 'img');
      el.innerHTML = '<span class="hhs-bowl">' + (HH.bowlSvg || '') + '</span><span class="hhs-marks" aria-hidden="true"></span>';
      const marksEl = el.querySelector('.hhs-marks');
      for (let i = 0; i < TUNE.maxBursts; i++) { const m = document.createElement('i'); m.className = 'hhs-mark'; marksEl.appendChild(m); M.marks.push(m); }
      M.bowl = el.querySelector('.hhs-bowl');
      if (wood && wood.parentNode) wood.parentNode.insertBefore(el, wood.nextSibling);
      else { const chips = ctx.hud.querySelectorAll('.chip'); (chips[1] || ctx.hud).appendChild(el); }
      M.el = el;
      M.sync();

      // for other mechanics and the phone button
      ctx.sprint = {
        set(n, quality) { M.set(n, quality); },     // replaces the number of bursts; it does not add
        count: () => M.count,
        active: () => M.t >= 0
      };
    },

    /* ---------- the bursts the Hunter holds ---------- */
    set(n, quality) {
      const was = M.count;
      M.count = clamp(Math.round(Number(n) || 0), 0, TUNE.maxBursts);
      if (QUALITY_ORDER.indexOf(quality) >= 0) M.quality = quality;
      if (M.count > 0) M.given = true;
      M.sync();
      if (M.count > 0 || was > 0) {
        for (let i = was; i < M.count; i++) M.popMark(i);
        M.bowl.classList.remove('is-pop'); void M.bowl.offsetWidth; M.bowl.classList.add('is-pop');
      }
    },
    popMark(i) {
      const m = M.marks[i]; if (!m) return;
      m.classList.remove('is-pop'); void m.offsetWidth; m.classList.add('is-pop');
    },
    sync() {
      for (let i = 0; i < M.marks.length; i++) M.marks[i].classList.toggle('is-on', i < M.count);
      M.el.classList.toggle('is-on', M.count > 0 || M.given);
      M.el.classList.toggle('q-good', M.quality === 'good');
      M.el.classList.toggle('q-golden', M.quality === 'golden');
      M.el.setAttribute('aria-label', 'Sprint bursts: ' + M.count);
    },
    shake() {
      const el = M.el;
      el.classList.remove('is-shake'); void el.offsetWidth; el.classList.add('is-shake');
      clearTimeout(M.shakeTimer);
      M.shakeTimer = setTimeout(() => el.classList.remove('is-shake'), TUNE.shakeSeconds * 1000 + 40);
    },

    /* ---------- the burst ---------- */
    // one press of the button; returns true when a burst started
    press(ctx, force) {
      const st = ctx.st;
      if (ctx.freeze.hunter) return false;
      if (M.t >= 0) return false;                         // one is already running: nothing to answer
      if (st.time - M.lastEnd < TUNE.cooldown) return false;
      if (M.count <= 0) { M.shake(); return false; }      // none left: the marks answer, the world does not
      // standing still there is nowhere to sprint to: the marks answer and the burst is kept, not wasted
      const inp = ctx.input.hunter;
      if (!force && Math.hypot(inp.ix || 0, inp.iy || 0) < 0.2) { M.shake(); return false; }
      M.count -= 1;
      M.t = 0;
      M.dustAcc = 0;
      M.sync();
      M.popMark(M.count);                                 // the mark that was just used pops as it empties
      const h = ctx.hunter;
      h.hop = Math.max(h.hop, TUNE.kick);
      M.dust(ctx, TUNE.startPuffs, 1.3, 0.9);
      ctx.pulseHud();
      return true;
    },

    end(ctx, skid) {
      M.t = -1;
      M.lastEnd = ctx.st.time;
      ctx.speed.hunter = 1;
      ctx.hunter.sprint = 0;
      if (skid) M.skid(ctx);
    },

    // direction the Hunter is running: from the real velocity, else the way he faces
    dir(ctx) {
      const h = ctx.hunter, sp = Math.hypot(h.vx, h.vz);
      if (sp > 0.5) return { x: h.vx / sp, z: h.vz / sp };
      return { x: Math.sin(h.facing), z: Math.cos(h.facing) };
    },

    dustColor(ctx) { return M.quality === 'golden' ? TUNE.dustGolden : TUNE.dustPale; },

    // puffs from the heels, thrown back; back is how hard, spread how wide
    dust(ctx, n, back, spread) {
      const h = ctx.hunter, d = M.dir(ctx), col = M.dustColor(ctx), ps = ctx.particles;
      const sx = -d.z, sz = d.x;                           // sideways
      for (let i = 0; i < n; i++) {
        const side = (i % 2 ? 1 : -1) * 0.13 + (Math.random() - 0.5) * 0.1;
        const b = back * (0.5 + Math.random() * 0.7);
        ps.spawn({
          x: h.x - d.x * 0.18 + sx * side, y: 0.06 + Math.random() * 0.1, z: h.z - d.z * 0.18 + sz * side,
          vx: -d.x * b + sx * (Math.random() - 0.5) * spread * 0.8, vy: 0.3 + Math.random() * 0.7, vz: -d.z * b + sz * (Math.random() - 0.5) * spread * 0.8,
          life: TUNE.dustLife * (0.7 + Math.random() * 0.6), size: TUNE.dustSize * (0.6 + Math.random() * 0.8),
          r: col[0], g: col[1], b: col[2], grav: 0.25, drag: 2.2, wob: 0.1, fadeIn: 0.06
        });
      }
    },

    // the skid: dust slides on past the feet and fans out sideways
    skid(ctx) {
      const h = ctx.hunter, d = M.dir(ctx), col = M.dustColor(ctx), ps = ctx.particles;
      const sx = -d.z, sz = d.x;
      for (let i = 0; i < TUNE.skidPuffs; i++) {
        const fan = (Math.random() - 0.5) * 2;
        const f = 0.5 + Math.random() * 1.3;
        ps.spawn({
          x: h.x + d.x * 0.1 + sx * fan * 0.15, y: 0.06 + Math.random() * 0.08, z: h.z + d.z * 0.1 + sz * fan * 0.15,
          vx: d.x * f + sx * fan * 1.6, vy: 0.15 + Math.random() * 0.5, vz: d.z * f + sz * fan * 1.6,
          life: TUNE.dustLife * (0.9 + Math.random() * 0.7), size: TUNE.dustSize * (0.8 + Math.random() * 0.9),
          r: col[0], g: col[1], b: col[2], grav: 0.15, drag: 2.8, wob: 0.1, fadeIn: 0.06
        });
      }
    },

    update(ctx, dt) {
      if (!M.dbg && window.game && window.game.debug) { M.dbg = true; M.attachDebug(ctx); }
      const h = ctx.hunter;

      if (ctx.input.hunter.sprint) M.press(ctx);

      if (M.t >= 0) {
        if (ctx.freeze.hunter) { M.end(ctx, false); return; }        // cut short: back to walking speed at once
        M.t += dt;
        if (M.t >= TUNE.burstSeconds) { M.end(ctx, true); return; }
        const kIn = ease(clamp(M.t / TUNE.easeIn, 0, 1)), kOut = ease(clamp((TUNE.burstSeconds - M.t) / TUNE.easeOut, 0, 1));
        ctx.speed.hunter = 1 + (TUNE.speedMult - 1) * kIn * kOut;
        h.sprint = 1;
        M.dustAcc += dt;
        while (M.dustAcc >= TUNE.dustEvery) {
          M.dustAcc -= TUNE.dustEvery;
          M.dust(ctx, TUNE.dustPerPuff, TUNE.dustBack, 0.7);
        }
      } else if (ctx.speed.hunter !== 1) ctx.speed.hunter = 1;
    },

    attachDebug(ctx) {
      window.game.debug.sprint = {
        give(n) { M.set(n === undefined ? 1 : n, M.quality); return this.state(); },
        use() { return M.press(ctx, true); },   // as if the button were pressed while walking
        state() { return { count: M.count, active: M.t >= 0, t: M.t < 0 ? -1 : +M.t.toFixed(2), speed: ctx.speed.hunter, quality: M.quality, pose: ctx.hunter.sprint, sinceEnd: +(ctx.st.time - M.lastEnd).toFixed(2) }; }
      };
    },

    on() { /* nothing to listen for yet */ }
  };

  (HH.mechanics = HH.mechanics || []).push(M);
})();
