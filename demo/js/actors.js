/* actors.js: the two characters, the fires, the lantern, particles and chimney smoke. */
(function () {
  'use strict';
  const T = THREE, HH = window.HH, P = HH.PAL;
  const clamp = HH.clamp, lerp = HH.lerp, damp = HH.damp;

  function part(fn, parent, x, y, z) {
    const k = new HH.Kit();
    fn(k);
    const g = k.build();
    g.position.set(x || 0, y || 0, z || 0);
    if (parent) parent.add(g);
    return g;
  }

  /* ---------- the lantern the Hunter carries ---------- */
  function makeLantern() {
    const grip = new T.Group(), g = new T.Group();
    g.position.y = -0.16; // hangs from the grip by its handle
    grip.add(g);
    part(k => {
      const iron = HH.col(P.iron);
      k.box(0.2, 0.035, 0.2, 0, -0.235, 0, iron, { r: 0.012 });
      k.box(0.17, 0.03, 0.17, 0, 0.0, 0, iron, { r: 0.012 });
      k.box(0.09, 0.035, 0.09, 0, 0.03, 0, iron, { r: 0.012 });
      [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(p => k.box(0.02, 0.23, 0.02, p[0] * 0.085, -0.115, p[1] * 0.085, iron, { r: 0 }));
      k.box(0.018, 0.1, 0.018, -0.05, 0.1, 0, iron, { r: 0 });
      k.box(0.018, 0.1, 0.018, 0.05, 0.1, 0, iron, { r: 0 });
      k.box(0.12, 0.018, 0.018, 0, 0.15, 0, iron, { r: 0 });
    }, g);
    const glass = new T.Mesh(new T.BoxGeometry(0.16, 0.2, 0.16), new T.MeshBasicMaterial({ color: 0xffffff }));
    glass.position.y = -0.115;
    g.add(glass);
    grip.userData.glass = glass;
    return grip;
  }

  /* ---------- characters: one rig, two outfits ---------- */
  HH.makeCharacter = function (kind) {
    const hunter = kind === 'hunter';
    const root = new T.Group(), rig = new T.Group();
    root.add(rig);
    const skin = HH.col(P.skin);
    const top = HH.col(hunter ? P.blue : P.white);
    const topD = hunter ? HH.tint(P.blue, -0.06, 0, 0) : HH.col(P.olive);

    const leg = side => {
      const pivot = new T.Group();
      pivot.position.set(side * 0.115, 0.22, 0);
      part(k => {
        k.box(0.18, 0.13, 0.2, 0, -0.06, 0, hunter ? HH.col(P.woodD) : HH.tint(P.olive, -0.07, 0, 0), { r: 0.04 });
        k.box(0.19, 0.11, 0.25, 0, -0.165, 0.02, HH.col(P.boot), { r: 0.045 });
      }, pivot);
      rig.add(pivot);
      return pivot;
    };
    const legL = leg(-1), legR = leg(1);

    const torso = new T.Group();
    torso.position.y = 0.2;
    rig.add(torso);
    part(k => {
      if (hunter) {
        k.box(0.48, 0.38, 0.33, 0, 0.2, 0, top, { r: 0.09 });
        k.box(0.52, 0.13, 0.36, 0, 0.07, 0, topD, { r: 0.05 });
        k.box(0.5, 0.075, 0.345, 0, 0.16, 0, HH.col(P.woodD), { r: 0.025 });
        k.box(0.1, 0.09, 0.03, 0, 0.16, 0.175, HH.col(P.gold), { r: 0.015 });
        // scarf
        k.box(0.5, 0.12, 0.4, 0, 0.385, 0.01, HH.col(P.red), { r: 0.05 });
        k.box(0.14, 0.2, 0.07, -0.13, 0.28, 0.185, HH.tint(P.red, -0.04, 0, 0), { r: 0.03, rz: 0.2 });
        // pack
        k.box(0.36, 0.33, 0.17, 0, 0.2, -0.24, HH.col(P.brown), { r: 0.05 });
        k.box(0.38, 0.12, 0.19, 0, 0.32, -0.24, HH.col(P.woodD), { r: 0.04 });
        k.box(0.07, 0.07, 0.03, 0, 0.27, -0.335, HH.col(P.gold), { r: 0.015 });
        k.cyl(0.07, 0.07, 0.4, 7, 0, 0.44, -0.24, HH.col(P.cream), { rz: Math.PI / 2, smooth: true });
      } else {
        k.box(0.47, 0.38, 0.32, 0, 0.2, 0, top, { r: 0.09 });
        k.box(0.58, 0.2, 0.42, 0, 0.06, 0, topD, { r: 0.07 });
        k.box(0.34, 0.25, 0.04, 0, 0.23, 0.155, topD, { r: 0.02 });
        k.box(0.5, 0.06, 0.345, 0, 0.165, 0, HH.tint(P.olive, -0.08, 0, 0), { r: 0.02 });
        k.box(0.07, 0.14, 0.04, -0.13, 0.35, 0.15, topD, { r: 0.015 });
        k.box(0.07, 0.14, 0.04, 0.13, 0.35, 0.15, topD, { r: 0.015 });
        k.box(0.16, 0.12, 0.035, 0.13, 0.1, 0.215, HH.col(P.cream), { r: 0.015 });
      }
    }, torso);

    const arm = side => {
      const pivot = new T.Group();
      pivot.position.set(side * 0.31, 0.33, 0);
      part(k => {
        k.box(0.15, 0.2, 0.17, 0, -0.07, 0, top, { r: 0.05 });
        k.box(0.14, 0.12, 0.15, 0, -0.21, 0, skin, { r: 0.05 });
      }, pivot);
      torso.add(pivot);
      return pivot;
    };
    const armL = arm(-1), armR = arm(1);

    const head = new T.Group();
    head.position.y = 0.67;
    torso.add(head);
    part(k => {
      k.box(0.66, 0.58, 0.58, 0, 0, 0, skin, { r: 0.11 });
      k.box(0.1, 0.06, 0.02, -0.2, -0.1, 0.286, HH.tint(P.skin, -0.06, 0.1, -0.02), { r: 0.01 });
      k.box(0.1, 0.06, 0.02, 0.2, -0.1, 0.286, HH.tint(P.skin, -0.06, 0.1, -0.02), { r: 0.01 });
      if (hunter) {
        const h = HH.col(P.hair), hd = HH.col(P.hairD);
        k.box(0.74, 0.24, 0.66, 0, 0.25, -0.02, h, { r: 0.08 });
        k.box(0.74, 0.46, 0.16, 0, 0.07, -0.28, h, { r: 0.06 });
        k.box(0.12, 0.34, 0.42, -0.34, 0.1, -0.06, h, { r: 0.05 });
        k.box(0.12, 0.34, 0.42, 0.34, 0.1, -0.06, h, { r: 0.05 });
        k.box(0.26, 0.17, 0.14, -0.22, 0.2, 0.28, hd, { r: 0.05, rz: 0.18 });
        k.box(0.24, 0.2, 0.14, 0.02, 0.19, 0.29, h, { r: 0.05, rz: -0.12 });
        k.box(0.24, 0.16, 0.14, 0.24, 0.21, 0.28, hd, { r: 0.05, rz: -0.25 });
        k.box(0.24, 0.16, 0.24, -0.14, 0.38, 0.02, hd, { r: 0.06, rz: 0.3, ry: 0.3 });
        k.box(0.22, 0.15, 0.22, 0.17, 0.39, -0.1, h, { r: 0.06, rz: -0.25 });
      } else {
        const h = HH.col(P.blond), hd = HH.col(P.blondD);
        k.box(0.73, 0.22, 0.65, 0, 0.25, -0.02, h, { r: 0.09 });
        k.box(0.73, 0.5, 0.16, 0, 0.05, -0.28, h, { r: 0.06 });
        k.box(0.12, 0.44, 0.3, -0.335, 0.05, -0.1, h, { r: 0.05 });
        k.box(0.12, 0.44, 0.3, 0.335, 0.05, -0.1, h, { r: 0.05 });
        k.box(0.34, 0.15, 0.13, -0.19, 0.2, 0.28, h, { r: 0.05, rz: 0.3 });
        k.box(0.34, 0.15, 0.13, 0.19, 0.2, 0.28, hd, { r: 0.05, rz: -0.3 });
        k.box(0.3, 0.26, 0.3, 0, 0.44, -0.2, hd, { r: 0.1 });
        k.box(0.34, 0.07, 0.34, 0, 0.34, -0.2, HH.col(P.olive), { r: 0.03 });
      }
    }, head);
    const eyes = part(k => {
      k.box(0.075, 0.135, 0.03, -0.14, 0, 0, HH.col(P.eye), { r: 0.014 });
      k.box(0.075, 0.135, 0.03, 0.14, 0, 0, HH.col(P.eye), { r: 0.014 });
    }, head, 0, -0.02, 0.29);
    eyes.children.forEach(m => { m.castShadow = false; });

    let lantern = null;
    if (hunter) {
      lantern = makeLantern();
      lantern.position.set(0, -0.27, 0.02);
      armR.add(lantern);
    }

    const c = {
      kind, root, rig, torso, head, eyes, legL, legR, armL, armR, lantern,
      x: 0, z: 0, vx: 0, vz: 0, facing: 0, speed01: 0, phase: 0, t: Math.random() * 10,
      blink: 2 + Math.random() * 3, act: 0, actKind: '', hop: 0,
      lanternWorld: new T.Vector3()
    };

    c.playAct = function (name) { c.actKind = name; c.act = 1; };

    c.update = function (dt) {
      c.t += dt;
      const sp = Math.hypot(c.vx, c.vz);
      c.speed01 = damp(c.speed01, clamp(sp / 3.6, 0, 1), 12, dt);
      const s = c.speed01;
      if (sp > 0.25) {
        const target = Math.atan2(c.vx, c.vz);
        let d = target - c.facing;
        while (d > Math.PI) d -= Math.PI * 2;
        while (d < -Math.PI) d += Math.PI * 2;
        c.facing += d * (1 - Math.exp(-14 * dt));
      }
      c.phase += dt * (6.5 + 5.5 * s) * s;
      const sw = Math.sin(c.phase), bob = Math.abs(Math.cos(c.phase));
      const breathe = Math.sin(c.t * 2.1);
      root.position.set(c.x, 0, c.z);
      root.rotation.y = c.facing;
      c.hop = Math.max(0, c.hop - dt * 3.2);
      const hopY = Math.sin((1 - c.hop) * Math.PI) * 0.16 * (c.hop > 0 ? 1 : 0);
      rig.position.y = bob * 0.055 * s + hopY;
      rig.rotation.x = 0.11 * s;
      rig.rotation.z = sw * 0.035 * s;
      legL.rotation.x = sw * 0.8 * s;
      legR.rotation.x = -sw * 0.8 * s;
      torso.scale.y = 1 + breathe * 0.014 * (1 - s);
      head.position.y = 0.67 + breathe * 0.006 * (1 - s);
      head.rotation.x = -0.05 * s + Math.sin(c.phase * 2) * 0.02 * s;
      head.rotation.z = -sw * 0.03 * s;
      // blinking
      c.blink -= dt;
      if (c.blink < 0) c.blink = 2.4 + Math.random() * 3.2;
      eyes.scale.y = c.blink < 0.11 ? 0.12 : 1;
      // arms
      let aL = -sw * 0.75 * s + breathe * 0.03, aR = sw * 0.75 * s - breathe * 0.03, aLz = -0.06, aRz = 0.06;
      if (hunter) { aR = -0.82 + sw * 0.07 * s + breathe * 0.02; aRz = 0.16; }
      if (c.act > 0) {
        c.act = Math.max(0, c.act - dt * (c.actKind === 'raise' ? 0.95 : 2.4));
        const k = Math.sin((1 - c.act) * Math.PI);
        if (c.actKind === 'throw') { aR = lerp(aR, -2.5, k); aL = lerp(aL, -1.2, k * 0.6); rig.rotation.x += 0.16 * k; }
        if (c.actKind === 'raise') { const kk = Math.min(1, k * 1.6); aR = lerp(aR, -2.55, kk); aRz = lerp(aRz, 0.3, kk); head.rotation.x -= 0.14 * kk; }
        if (c.actKind === 'cheer') { aL = lerp(aL, -2.6, k); aR = lerp(aR, hunter ? aR : -2.6, k); }
      }
      armL.rotation.set(aL, 0, aLz);
      armR.rotation.set(aR, 0, aRz);
      if (lantern) {
        // the lantern hangs upright from the hand and lags a little behind the walk
        lantern.rotation.x = -aR + Math.sin(c.phase + 0.6) * 0.16 * s;
        lantern.rotation.z = -aRz + Math.sin(c.t * 1.7) * 0.03;
      }
    };
    c.syncLantern = function () {
      if (!lantern) return;
      root.updateMatrixWorld(true);
      lantern.userData.glass.getWorldPosition(c.lanternWorld);
    };
    return c;
  };

  /* ---------- fire: nested low-poly flames, driven by a few readable parameters ---------- */
  const flameGeo = new T.LatheGeometry([
    new T.Vector2(0.0, 0.0), new T.Vector2(0.4, 0.1), new T.Vector2(0.5, 0.3), new T.Vector2(0.38, 0.56),
    new T.Vector2(0.17, 0.82), new T.Vector2(0.0, 1.0)
  ], 6);

  HH.makeFire = function (size) {
    const g = new T.Group();
    const layer = (hex, k, s, x, z, ph) => {
      // drawn after the world without writing depth, so inner flames show through outer ones
      const m = new T.Mesh(flameGeo, new T.MeshBasicMaterial({ color: HH.hdr(hex, k), side: T.DoubleSide, depthWrite: false }));
      m.userData = { s, x, z, ph, base: HH.hdr(hex, k) };
      m.renderOrder = 3 + g.children.length;
      g.add(m);
      return m;
    };
    const layers = [
      layer(0xff5a1c, 1.25, 1.0, 0, 0, 0.0),
      layer(0xff9226, 1.7, 0.68, 0, 0.03, 1.7),
      layer(0xffd870, 2.4, 0.4, 0, 0.06, 3.1),
      layer(0xff6a20, 1.3, 0.52, -0.3, -0.04, 4.4),
      layer(0xff7a24, 1.35, 0.46, 0.31, -0.02, 5.9),
      layer(0xffa838, 1.7, 0.26, 0.29, 0.02, 2.6)
    ];
    const f = { group: g, height: 1, width: 1, flicker: 0.1, lean: 0, bright: 1, t: Math.random() * 20 };
    f.update = function (dt) {
      f.t += dt * (1 + f.flicker * 1.6);
      layers.forEach((m, i) => {
        const u = m.userData, w1 = HH.wob(f.t, u.ph), w2 = HH.wob(f.t * 1.31 + 3, u.ph * 1.7), w3 = HH.wob(f.t * 0.6, u.ph + 9);
        const side = i >= 3 ? 0.8 : 1;
        const h = Math.max(0.05, f.height * u.s * size * side * (1 + w1 * (0.09 + f.flicker * 0.55)));
        const w = Math.max(0.03, f.width * u.s * size * 0.62 * (1 + w2 * (0.05 + f.flicker * 0.2)));
        m.scale.set(w, h, w);
        m.position.set(u.x * size * f.width, 0, u.z * size);
        m.rotation.z = -f.lean * (0.7 + 0.3 * u.s) + w2 * (0.05 + f.flicker * 0.3);
        m.rotation.x = w3 * 0.05;
        m.rotation.y += dt * (0.6 + i * 0.2);
        m.material.color.copy(u.base).multiplyScalar(f.bright * (1 + w3 * 0.08));
      });
    };
    return f;
  };

  /* ---------- particles: embers, sparks and drifting motes ---------- */
  HH.makeParticles = function (cap) {
    const pos = new Float32Array(cap * 3), colr = new Float32Array(cap * 4), size = new Float32Array(cap);
    const list = [];
    for (let i = 0; i < cap; i++) list.push({ life: 0 });
    const geo = new T.BufferGeometry();
    geo.setAttribute('position', new T.BufferAttribute(pos, 3));
    geo.setAttribute('aCol', new T.BufferAttribute(colr, 4));
    geo.setAttribute('aSize', new T.BufferAttribute(size, 1));
    const mat = new T.ShaderMaterial({
      uniforms: { uPx: { value: 60 } },
      vertexShader: 'attribute vec4 aCol; attribute float aSize; uniform float uPx; varying vec4 vCol;\nvoid main(){ vCol = aCol; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); gl_PointSize = max(1.0, aSize * uPx); }',
      fragmentShader: 'varying vec4 vCol;\nvoid main(){ float r = length(gl_PointCoord - 0.5) * 2.0; float a = smoothstep(1.0, 0.25, r); gl_FragColor = vec4(vCol.rgb * a * vCol.a, 1.0); }',
      blending: T.AdditiveBlending, depthWrite: false, transparent: true
    });
    const pts = new T.Points(geo, mat);
    pts.frustumCulled = false;
    pts.renderOrder = 5;
    let cursor = 0;
    const ps = { points: pts, material: mat };
    ps.spawn = function (o) {
      for (let n = 0; n < cap; n++) {
        cursor = (cursor + 1) % cap;
        const p = list[cursor];
        if (p.life > 0 && n < cap - 1) continue;
        p.x = o.x; p.y = o.y; p.z = o.z;
        p.vx = o.vx || 0; p.vy = o.vy || 0; p.vz = o.vz || 0;
        p.life = p.max = o.life || 1;
        p.size = o.size || 0.1;
        p.r = o.r; p.g = o.g; p.b = o.b;
        p.grav = o.grav || 0; p.drag = o.drag || 0; p.wob = o.wob || 0; p.seed = Math.random() * 100;
        p.fadeIn = o.fadeIn || 0.08;
        return;
      }
    };
    ps.update = function (dt, t) {
      for (let i = 0; i < cap; i++) {
        const p = list[i];
        if (p.life <= 0) { size[i] = 0; colr[i * 4 + 3] = 0; continue; }
        p.life -= dt;
        p.vy += p.grav * dt;
        const dr = Math.exp(-p.drag * dt);
        p.vx *= dr; p.vy *= dr; p.vz *= dr;
        p.x += (p.vx + Math.sin(t * 2.3 + p.seed) * p.wob) * dt;
        p.y += p.vy * dt;
        p.z += (p.vz + Math.cos(t * 1.9 + p.seed * 1.3) * p.wob) * dt;
        const age = 1 - p.life / p.max;
        const a = Math.min(1, age * p.max / p.fadeIn) * Math.min(1, (1 - age) * 2.2);
        pos[i * 3] = p.x; pos[i * 3 + 1] = p.y; pos[i * 3 + 2] = p.z;
        colr[i * 4] = p.r; colr[i * 4 + 1] = p.g; colr[i * 4 + 2] = p.b; colr[i * 4 + 3] = Math.max(0, a);
        size[i] = p.size;
      }
      geo.attributes.position.needsUpdate = true;
      geo.attributes.aCol.needsUpdate = true;
      geo.attributes.aSize.needsUpdate = true;
    };
    return ps;
  };

  /* ---------- chimney smoke: a few soft blocks that rise and thin out ---------- */
  HH.makeSmoke = function (origin) {
    const g = new T.Group();
    const mat = HH.lit({ flat: true, color: HH.col(0xd9cdbf) });
    const geo = new T.IcosahedronGeometry(1, 0);
    const puffs = [];
    for (let i = 0; i < 6; i++) {
      const m = new T.Mesh(geo, mat);
      m.userData = { age: i / 6, seed: Math.random() * 10 };
      g.add(m);
      puffs.push(m);
    }
    return {
      group: g, rate: 1,
      update(dt, t) {
        puffs.forEach(m => {
          const u = m.userData;
          u.age += dt * 0.16 * this.rate;
          if (u.age > 1) { u.age -= 1; u.seed = Math.random() * 10; }
          const a = u.age, s = Math.sin(Math.min(1, a * 3) * Math.PI / 2) * (1 - HH.smooth(0.55, 1, a)) * (0.2 + a * 0.36);
          m.scale.setScalar(Math.max(0.001, s));
          m.position.set(origin.x + Math.sin(u.seed + a * 3) * 0.2 + a * 0.9, origin.y + a * 3.4, origin.z + Math.cos(u.seed * 1.7 + a * 2) * 0.16 - a * 0.3);
          m.rotation.set(a * 2 + u.seed, a * 1.4, u.seed);
        });
      }
    };
  };

  /* ---------- a small key prompt that floats in the world ---------- */
  HH.makePrompt = function (label) {
    const cv = document.createElement('canvas');
    cv.width = 128; cv.height = 128;
    const x = cv.getContext('2d');
    const rr = (px, py, w, h, r) => { x.beginPath(); x.moveTo(px + r, py); x.arcTo(px + w, py, px + w, py + h, r); x.arcTo(px + w, py + h, px, py + h, r); x.arcTo(px, py + h, px, py, r); x.arcTo(px, py, px + w, py, r); x.closePath(); };
    x.fillStyle = 'rgba(30,20,16,0.55)'; rr(22, 28, 84, 84, 20); x.fill();
    x.fillStyle = '#f3e3c2'; rr(22, 20, 84, 84, 20); x.fill();
    x.fillStyle = '#3a2a22';
    x.font = '700 54px "Zen Maru Gothic", "Segoe UI", sans-serif';
    x.textAlign = 'center'; x.textBaseline = 'middle';
    x.fillText(label, 64, 65);
    const tex = new T.CanvasTexture(cv);
    tex.encoding = T.sRGBEncoding;
    const sp = new T.Sprite(new T.SpriteMaterial({ map: tex, transparent: true, depthTest: false, depthWrite: false }));
    sp.renderOrder = 10;
    sp.scale.setScalar(0.62);
    return sp;
  };
})();
