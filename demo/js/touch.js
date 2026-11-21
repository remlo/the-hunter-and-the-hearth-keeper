/* touch.js: on phones and tablets one person plays both characters, switching between them.
   A floating thumbstick walks the active character, one round button acts, and the other character's
   portrait (top right) switches. Everything here is its own DOM inside #game and one <style> element.
   HH.touchMode is decided at load time, because the key prompts in the world read it when they are created. */
(function () {
  'use strict';
  const HH = window.HH;

  /* ---------- tuning ---------- */
  const TUNE = {
    stickRadius: 56,          // px the knob can travel from the base
    stickDead: 0.15,          // fraction of the radius that does nothing
    stickBase: 112,           // px, the base ring
    stickKnob: 48,            // px
    actSize: 72,              // px, action button
    swapSize: 56,             // px, portrait
    edge: 20,                 // px, gap from the screen edge (or the safe area, if larger)
    labelSeconds: 1.5,        // how long "You are the Hunter" stays up
    scalePortrait: 0.5,       // ctx.view.soloScale: smaller is closer
    scaleLandscape: 0.44,
    glide: 7                  // ctx.view.soloGlide
  };

  /* ---------- deciding the mode ---------- */
  let coarse = false;
  try { coarse = !!(window.matchMedia && window.matchMedia('(pointer: coarse)').matches) && navigator.maxTouchPoints > 0; } catch (e) { /* no matchMedia */ }
  const forced = /#touch$/.test(String(location.href));
  HH.touchMode = coarse || forced;
  const ON = HH.touchMode;

  /* ---------- icons: small inline SVG ---------- */
  const ICON = {
    flame: '<svg viewBox="0 0 24 24" width="30" height="30" aria-hidden="true"><path d="M12.6 2.2c.5 3-1 4.6-2.6 6.4C8.3 10.500 7 12.200 7 14.800 7 18.400 9.200 21.200 12.200 21.200S17.500 18.700 17.500 15.300c0-2-.9-3.500-1.900-4.600-.2 1.300-.8 2.200-1.600 2.700.5-3.700-.1-7.800-1.400-11.200Z" fill="currentColor"/><path d="M12.200 21.200c-1.700 0-3-1.300-3-3.100 0-1.700 1.400-2.600 2.300-4 .8 1 2.200 1.900 2.200 3.900 0 1.700-.7 3.200-1.500 3.200Z" fill="#fff1cf" opacity=".85"/></svg>',
    lantern: '<svg viewBox="0 0 20 24" width="{s}" height="{h}" aria-hidden="true"><path d="M7 4a3 3 0 0 1 6 0" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/><rect x="4" y="4.6" width="12" height="3" rx="1.2" fill="currentColor"/><rect x="6" y="8.6" width="8" height="10.4" rx="1" fill="currentColor" opacity=".55"/><rect x="5.1" y="7.8" width="9.8" height="12" rx="2" fill="none" stroke="currentColor" stroke-width="1.7"/><rect x="3.4" y="19.6" width="13.2" height="2.8" rx="1.2" fill="currentColor"/></svg>',
    house: '<svg viewBox="0 0 24 24" width="25" height="25" aria-hidden="true"><path d="M3.500 11.500 12 4l8.500 7.500" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M6 10.500V20h12v-9.500" fill="currentColor"/><rect x="10.300" y="14" width="3.400" height="6" rx="1" fill="#1b1310" opacity=".55"/></svg>'
  };
  const lanternIcon = (w, h) => ICON.lantern.replace('{s}', w).replace('{h}', h);

  const CSS = [
    '#game.is-touch { -webkit-touch-callout: none; -webkit-tap-highlight-color: transparent; }',
    '#game.is-touch .t-ctl, #game.is-touch .t-ctl * { -webkit-user-select: none; user-select: none; -webkit-touch-callout: none; touch-action: none; }',

    /* the status chips: top left, stacked and compact; no keys, no names */
    '#game.is-touch #hud { flex-direction: column; flex-wrap: nowrap; align-items: flex-start; align-content: flex-start; justify-content: flex-start; gap: 6px; padding-top: max(12px, env(safe-area-inset-top, 0px)); padding-bottom: 0; padding-left: max(12px, env(safe-area-inset-left, 0px)); padding-right: 0; }',
    '#game.is-touch #hud > .chip:last-child { margin-left: 0; }',
    '#game.is-touch #hud .hint, #game.is-touch #hud .who { display: none; }',
    '#game.is-touch #hud .chip { gap: 8px; padding: 6px 8px; border-radius: 12px; }',
    '#game.is-touch #hud .chip.t-hollow { display: none; }',

    /* floating stick */
    '.t-stick { position: absolute; left: 0; top: 0; z-index: 3; width: var(--tb); height: var(--tb); margin: calc(var(--tb) / -2) 0 0 calc(var(--tb) / -2); border-radius: 50%; pointer-events: none; opacity: 0; transform: translate(var(--sx, 0px), var(--sy, 0px)) scale(0.86); background: radial-gradient(circle, rgba(244,230,200,0.08) 0%, rgba(244,230,200,0.2) 100%); border: 2px solid rgba(244,230,200,0.5); box-shadow: 0 6px 22px rgba(0,0,0,0.28); transition: opacity 0.22s ease, transform 0.22s cubic-bezier(0.3, 1.4, 0.5, 1); }',
    '.t-stick.is-on { opacity: 1; transform: translate(var(--sx, 0px), var(--sy, 0px)) scale(1); transition: opacity 0.1s ease, transform 0.16s cubic-bezier(0.3, 1.4, 0.5, 1); }',
    '.t-knob { position: absolute; left: 50%; top: 50%; width: var(--tk); height: var(--tk); margin: calc(var(--tk) / -2) 0 0 calc(var(--tk) / -2); border-radius: 50%; background: radial-gradient(circle at 38% 30%, #fff1cf, var(--ink) 55%, var(--ink-soft)); opacity: 0.92; box-shadow: 0 3px 0 rgba(0,0,0,0.3), 0 6px 14px rgba(0,0,0,0.3); transform: translate(var(--kx, 0px), var(--ky, 0px)); }',

    /* shared round button */
    '.t-btn { position: absolute; z-index: 3; box-sizing: border-box; padding: 0; margin: 0; border: 0; border-radius: 50%; font: inherit; color: var(--ink); cursor: pointer; outline: none; opacity: 0; visibility: hidden; transition: opacity 0.5s ease 0.35s, transform 0.14s ease, box-shadow 0.25s ease, background-color 0.25s ease, visibility 0s linear 0.85s; }',
    '#game.is-playing .t-btn, #game.is-playing .t-who-wrap { visibility: visible; opacity: 1; transition: opacity 0.5s ease 0.35s, transform 0.14s ease, box-shadow 0.25s ease, background-color 0.25s ease, visibility 0s; }',

    /* the action button */
    '.t-act { right: max(var(--te), env(safe-area-inset-right, 0px)); bottom: max(calc(var(--te) + 4px), env(safe-area-inset-bottom, 0px)); width: var(--ta); height: var(--ta); background: rgba(38, 28, 22, 0.88); border: 2px solid rgba(244,230,200,0.42); box-shadow: 0 5px 0 rgba(0,0,0,0.4), 0 10px 22px rgba(0,0,0,0.35); display: grid; place-items: center; color: var(--ink-soft); }',
    '.t-act .t-ico { display: grid; place-items: center; }',
    '.t-act.is-keeper .t-ico { color: var(--ember); }',
    '.t-act.is-hunter .t-ico { color: #b4cbeb; }',
    '.t-act.is-ready { background: radial-gradient(circle at 50% 38%, #ffcf80, var(--ember) 55%, var(--ember-deep)); border-color: rgba(255,241,207,0.6); color: #2c1b10; box-shadow: 0 5px 0 #a9541d, 0 0 26px rgba(255,180,74,0.75), 0 10px 22px rgba(0,0,0,0.3); animation: t-breathe 1.4s ease-in-out infinite; }',
    '.t-act.is-ready .t-ico { color: #2c1b10; }',
    '.t-act:active, .t-act.is-down { transform: translateY(4px) scale(0.96); box-shadow: 0 1px 0 rgba(0,0,0,0.32), 0 4px 10px rgba(0,0,0,0.3); }',
    '.t-act.is-ready:active, .t-act.is-ready.is-down { box-shadow: 0 1px 0 #a9541d, 0 0 30px rgba(255,180,74,0.9); }',
    '.t-act .t-ico.is-swap { animation: t-pop 0.34s cubic-bezier(0.3, 1.6, 0.5, 1); }',
    '.t-act.is-tap::after { content: ""; position: absolute; inset: -2px; border-radius: 50%; border: 2px solid var(--ember); animation: t-ripple 0.45s ease-out forwards; pointer-events: none; }',

    /* the portrait: the other character, with a ring that carries the one thing worth watching */
    '.t-swap { top: max(12px, env(safe-area-inset-top, 0px)); right: max(12px, env(safe-area-inset-right, 0px)); width: var(--ts); display: flex; flex-direction: column; align-items: center; gap: 4px; padding: 0; border-radius: 12px; background: none; }',
    '.t-swap { position: absolute; }',
    '.t-disc { --ring: 1; --rc: var(--keeper); position: relative; width: var(--ts); height: var(--ts); border-radius: 50%; display: grid; place-items: center; background: conic-gradient(var(--rc) calc(var(--ring) * 360deg), rgba(244,230,200,0.16) 0); box-shadow: 0 4px 0 rgba(0,0,0,0.3), 0 8px 18px rgba(0,0,0,0.3); transition: transform 0.14s ease, box-shadow 0.25s ease; }',
    '.t-disc::before { content: ""; position: absolute; inset: 4px; border-radius: 50%; background: #1b1310; }',
    '.t-face { position: relative; width: calc(var(--ts) - 14px); height: calc(var(--ts) - 14px); border-radius: 50%; display: grid; place-items: center; background: var(--keeper); color: #1b1310; transition: background-color 0.3s ease; }',
    '.t-swap.is-hunter .t-face { background: var(--hunter); }',
    '.t-swap.is-keeper .t-disc { --rc: var(--keeper); }',
    '.t-swap.is-hunter .t-disc { --rc: var(--ember); }',
    '.t-face > span { display: grid; place-items: center; }',
    '.t-face > span.is-swap { animation: t-pop 0.34s cubic-bezier(0.3, 1.6, 0.5, 1); }',
    '.t-swap:active .t-disc, .t-swap.is-down .t-disc { transform: translateY(3px) scale(0.94); box-shadow: 0 1px 0 rgba(0,0,0,0.3), 0 3px 8px rgba(0,0,0,0.3); }',
    '.t-swap.is-low .t-disc { animation: t-ringpulse 0.9s ease-out infinite; }',
    '.t-name { font: 700 10px/1 var(--body); letter-spacing: 0.04em; color: var(--ink); text-shadow: 0 1px 2px rgba(0,0,0,0.7); white-space: nowrap; }',

    /* who you are now */
    '.t-who-wrap { position: absolute; left: 0; right: 0; top: 24%; z-index: 4; display: flex; justify-content: center; pointer-events: none; visibility: hidden; }',
    '.t-who { padding: 9px 18px; border-radius: 999px; background: var(--panel); border: 1px solid var(--panel-line); font: 700 15px/1 var(--body); color: var(--ink); opacity: 0; transform: translateY(8px) scale(0.96); display: flex; align-items: center; gap: 8px; }',
    '.t-who i { width: 10px; height: 10px; border-radius: 3px; display: block; }',
    '.t-who.is-on { animation: t-who var(--tw, 1500ms) ease-out forwards; }',

    '@keyframes t-pop { 0% { transform: scale(0.55) rotate(-8deg); opacity: 0.2; } 100% { transform: none; opacity: 1; } }',
    '@keyframes t-breathe { 50% { box-shadow: 0 5px 0 #a9541d, 0 0 38px rgba(255,180,74,0.95), 0 10px 22px rgba(0,0,0,0.3); } }',
    '@keyframes t-ripple { 0% { transform: scale(1); opacity: 0.9; } 100% { transform: scale(1.5); opacity: 0; } }',
    '@keyframes t-ringpulse { 0% { box-shadow: 0 4px 0 rgba(0,0,0,0.3), 0 0 0 0 rgba(255,180,74,0.9); } 100% { box-shadow: 0 4px 0 rgba(0,0,0,0.3), 0 0 0 16px rgba(255,180,74,0); } }',
    '@keyframes t-who { 0% { opacity: 0; transform: translateY(8px) scale(0.96); } 14% { opacity: 1; transform: none; } 78% { opacity: 1; transform: none; } 100% { opacity: 0; transform: translateY(-4px); } }',

    /* the title card in touch wording */
    '#game.is-touch #start { cursor: default; }',
    '#game.is-touch .roles .t-line { font-size: 14px; line-height: 1.45; }',

    '@media (prefers-reduced-motion: reduce) {',
    '  .t-stick, .t-stick.is-on, .t-btn, .t-disc, .t-face { transition: none; }',
    '  .t-act.is-ready, .t-swap.is-low .t-disc, .t-act .t-ico.is-swap, .t-face > span.is-swap, .t-act.is-tap::after { animation: none; }',
    '  .t-who.is-on { animation: none; opacity: 1; transform: none; }',
    '}'
  ].join('\n');

  /* ---------- the mechanic ---------- */
  const M = {
    name: 'touch',
    ctx: null, game: null, els: null,
    stickId: null, stickOrigin: { x: 0, y: 0 },
    shown: { who: '', ring: -1, low: false, ready: false },
    whoTimer: 0, tapTimer: 0, scaleKey: '',

    init(ctx) {
      if (!ON) return;
      this.ctx = ctx;
      const game = this.game = document.getElementById('game');
      game.classList.add('is-touch');
      ctx.solo = 'keeper';
      ctx.view.soloGlide = TUNE.glide;

      const style = document.createElement('style');
      style.textContent = CSS;
      document.head.appendChild(style);
      game.style.setProperty('--tb', TUNE.stickBase + 'px');
      game.style.setProperty('--tk', TUNE.stickKnob + 'px');
      game.style.setProperty('--ta', TUNE.actSize + 'px');
      game.style.setProperty('--ts', TUNE.swapSize + 'px');
      game.style.setProperty('--te', TUNE.edge + 'px');

      this.rewriteTitle();
      this.build();
      this.bind();
      this.fitScale(true);
      this.refresh(true);
    },

    rewriteTitle() {
      const eyebrow = document.querySelector('#start .eyebrow'), roles = document.querySelector('#start .roles'), play = document.getElementById('play');
      if (eyebrow) eyebrow.textContent = 'One player, two characters';
      if (roles) {
        roles.textContent = '';
        const p = document.createElement('span');
        p.className = 't-line';
        p.textContent = 'Drag anywhere to walk. Tap the round button to act. Tap the portrait to switch.';
        roles.appendChild(p);
      }
      if (play) play.textContent = 'Tap to play';
    },

    build() {
      const game = this.game, el = this.els = {};
      const mk = (tag, cls, parent, html) => { const n = document.createElement(tag); n.className = cls; if (html) n.innerHTML = html; (parent || game).appendChild(n); return n; };

      el.stick = mk('div', 't-stick');
      el.stick.setAttribute('aria-hidden', 'true');
      el.knob = mk('div', 't-knob', el.stick);

      el.act = mk('button', 't-btn t-ctl t-act is-keeper');
      el.act.type = 'button';
      el.act.setAttribute('aria-label', 'Act');
      el.actIco = mk('span', 't-ico', el.act, ICON.flame);

      el.swap = mk('button', 't-btn t-ctl t-swap is-hunter');
      el.swap.type = 'button';
      el.disc = mk('span', 't-disc', el.swap);
      el.face = mk('span', 't-face', el.disc);
      el.faceIco = mk('span', '', el.face, lanternIcon(19, 23));
      el.name = mk('span', 't-name', el.swap, 'Hunter');

      el.whoWrap = mk('div', 't-who-wrap');
      el.who = mk('div', 't-who', el.whoWrap);
      el.whoWrap.setAttribute('aria-live', 'polite');
    },

    bind() {
      const ctx = this.ctx, game = this.game, el = this.els, self = this;
      const noMenu = e => e.preventDefault();
      game.addEventListener('contextmenu', noMenu);
      game.addEventListener('selectstart', noMenu);
      game.addEventListener('dragstart', noMenu);

      // the stick: any touch that begins on the scene
      game.addEventListener('pointerdown', e => {
        if (self.stickId !== null) return;
        if (e.target.closest && e.target.closest('.t-ctl, #start, #resume, #splash')) return;
        if (e.pointerType === 'mouse' && e.button !== 0) return;
        self.stickId = e.pointerId;
        try { game.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
        const r = game.getBoundingClientRect();
        self.stickOrigin.x = e.clientX - r.left; self.stickOrigin.y = e.clientY - r.top;
        el.stick.style.setProperty('--sx', self.stickOrigin.x + 'px');
        el.stick.style.setProperty('--sy', self.stickOrigin.y + 'px');
        self.moveKnob(0, 0);
        el.stick.classList.add('is-on');
        self.stick(0, 0);
      });
      game.addEventListener('pointermove', e => {
        if (e.pointerId !== self.stickId) return;
        const r = game.getBoundingClientRect();
        self.dragTo(e.clientX - r.left - self.stickOrigin.x, e.clientY - r.top - self.stickOrigin.y);
      });
      const up = e => {
        if (e.pointerId !== self.stickId) return;
        self.stickId = null;
        try { game.releasePointerCapture(e.pointerId); } catch (err) { /* ignore */ }
        self.stick(0, 0);
        self.moveKnob(0, 0);
        el.stick.classList.remove('is-on');
      };
      game.addEventListener('pointerup', up);
      game.addEventListener('pointercancel', up);
      game.addEventListener('lostpointercapture', up);

      // the buttons: they take their own touches, the stick keeps its own pointer id
      const press = (btn, fn) => {
        btn.addEventListener('pointerdown', e => { e.stopPropagation(); e.preventDefault(); btn.classList.add('is-down'); fn(); });
        const off = () => btn.classList.remove('is-down');
        btn.addEventListener('pointerup', off); btn.addEventListener('pointercancel', off); btn.addEventListener('pointerleave', off);
        btn.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); fn(); } });
      };
      press(el.act, () => self.tap());
      press(el.swap, () => self.switchTo());

      // orientation
      window.addEventListener('resize', () => self.fitScale(false));
      window.addEventListener('orientationchange', () => self.fitScale(false));
    },

    /* ---------- stick ---------- */
    moveKnob(x, y) {
      this.els.knob.style.setProperty('--kx', x.toFixed(1) + 'px');
      this.els.knob.style.setProperty('--ky', y.toFixed(1) + 'px');
    },
    dragTo(dx, dy) {
      const R = TUNE.stickRadius, len = Math.hypot(dx, dy);
      const k = len > R ? R / len : 1;
      const kx = dx * k, ky = dy * k;
      this.moveKnob(kx, ky);
      let m = Math.min(1, len / R), ix = 0, iy = 0;
      if (m > TUNE.stickDead) {
        const s = (m - TUNE.stickDead) / (1 - TUNE.stickDead);
        ix = (dx / len) * s; iy = (-dy / len) * s;
      }
      this.ctx.virtual.ix = ix; this.ctx.virtual.iy = iy;
    },
    stick(ix, iy) { this.ctx.virtual.ix = ix; this.ctx.virtual.iy = iy; },

    /* ---------- action and switch ---------- */
    tap() {
      this.ctx.virtual.act = true;
      const a = this.els.act;
      a.classList.remove('is-tap'); void a.offsetWidth; a.classList.add('is-tap');
      clearTimeout(this.tapTimer);
      this.tapTimer = setTimeout(() => a.classList.remove('is-tap'), 480);
    },
    switchTo() {
      const ctx = this.ctx;
      ctx.solo = ctx.solo === 'keeper' ? 'hunter' : 'keeper';
      ctx.virtual.act = false;
      this.refresh(false);
      this.sayWho();
    },
    sayWho() {
      const w = this.els.who, hunter = this.ctx.solo === 'hunter';
      w.innerHTML = '<i style="background:var(' + (hunter ? '--hunter' : '--keeper') + ')"></i>';
      w.appendChild(document.createTextNode('You are the ' + (hunter ? 'Hunter' : 'Hearth Keeper')));
      w.style.setProperty('--tw', TUNE.labelSeconds * 1000 + 'ms');
      w.classList.remove('is-on'); void w.offsetWidth; w.classList.add('is-on');
    },

    /* ---------- the picture follows the state ---------- */
    refresh(quiet) {
      const ctx = this.ctx, el = this.els, hunter = ctx.solo === 'hunter';
      const who = ctx.solo;
      if (this.shown.who !== who) {
        this.shown.who = who;
        el.act.classList.toggle('is-keeper', !hunter);
        el.act.classList.toggle('is-hunter', hunter);
        el.act.setAttribute('aria-label', hunter ? 'Raise the lantern' : 'Stoke the fire');
        el.actIco.innerHTML = hunter ? lanternIcon(28, 34) : ICON.flame;
        // the portrait shows the one you are NOT playing
        el.swap.classList.toggle('is-hunter', !hunter);
        el.swap.classList.toggle('is-keeper', hunter);
        el.swap.setAttribute('aria-label', 'Switch to the ' + (hunter ? 'Keeper' : 'Hunter'));
        el.faceIco.innerHTML = hunter ? ICON.house : lanternIcon(19, 23);
        el.name.textContent = hunter ? 'Keeper' : 'Hunter';
        if (!quiet) {
          [el.actIco, el.faceIco].forEach(n => { n.classList.remove('is-swap'); void n.offsetWidth; n.classList.add('is-swap'); });
        }
        this.shown.ring = -1;
      }
    },

    update(ctx, dt) {
      if (!ON || !this.els) return;
      this.refresh(true);
      const el = this.els, st = ctx.st, hunter = ctx.solo === 'hunter';
      // ring: the lantern when the portrait is the Hunter, full and steady when it is the Keeper
      const ring = hunter ? 1 : Math.max(0, Math.min(1, st.fuel));
      if (Math.abs(ring - this.shown.ring) > 0.004) { this.shown.ring = ring; el.disc.style.setProperty('--ring', ring.toFixed(3)); }
      const low = !hunter && st.fuel < ctx.TUNE.lanternLowAt && !st.home;
      if (low !== this.shown.low) { this.shown.low = low; el.swap.classList.toggle('is-low', low); }
      const ready = !!st.canStoke && !hunter;
      if (ready !== this.shown.ready) { this.shown.ready = ready; el.act.classList.toggle('is-ready', ready); }
      // chips with nothing left to show (the Keeper's, once its keys are hidden) step aside
      const chips = ctx.hud ? ctx.hud.querySelectorAll('.chip') : [];
      for (let i = 0; i < chips.length; i++) {
        let any = false;
        for (let c = chips[i].firstElementChild; c; c = c.nextElementSibling) {
          if (!c.classList.contains('who') && !c.classList.contains('hint') && getComputedStyle(c).display !== 'none') { any = true; break; }
        }
        chips[i].classList.toggle('t-hollow', !any);
      }
    },

    /* the zoom depends on the shape of the screen */
    fitScale(force) {
      const ctx = this.ctx, r = this.game.getBoundingClientRect();
      const key = r.width >= r.height ? 'land' : 'port';
      if (!force && key === this.scaleKey) return;
      this.scaleKey = key;
      ctx.view.soloScale = key === 'land' ? TUNE.scaleLandscape : TUNE.scalePortrait;
    },

    on(event, data, ctx) {}
  };

  /* ---------- test hooks ---------- */
  M.debugApi = function () {
    const self = this;
    return {
      state() {
        const c = self.ctx;
        return { on: ON, solo: c.solo, ix: +c.virtual.ix.toFixed(3), iy: +c.virtual.iy.toFixed(3), act: c.virtual.act, soloScale: c.view.soloScale, ring: self.shown.ring, low: self.shown.low, ready: self.shown.ready, stickOn: self.stickId !== null };
      },
      switch() { self.switchTo(); return this.state(); },
      stick(ix, iy) { self.stick(ix, iy); return this.state(); },
      tap() { self.tap(); return this.state(); }
    };
  };

  const mech = {
    name: 'touch',
    init(ctx) {
      if (!ON) return;
      M.init(ctx);
      if (window.game && window.game.debug) window.game.debug.touch = M.debugApi();
    },
    update(ctx, dt) { if (ON) M.update(ctx, dt); },
    on(event, data, ctx) { /* nothing yet */ }
  };
  (HH.mechanics = HH.mechanics || []).push(mech);
})();
