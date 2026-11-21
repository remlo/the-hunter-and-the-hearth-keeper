/* world.js: the clearing, the cottage, the garden, the path and the forest edge.
   Layout is authored in screen-aligned (u, v) coordinates and converted to world x, z. */
(function () {
  'use strict';
  const T = THREE, HH = window.HH, P = HH.PAL;
  const clamp = HH.clamp, lerp = HH.lerp, smooth = HH.smooth;

  const W = HH.world = {};
  W.R = 11;        // radius of the clearing's warm light
  W.RW = 10.35;    // walkable radius of the clearing
  const C = W.cot = { x0: -9.2, x1: -2.2, z0: -3.7, z1: 2.3, t: 0.24, h: 1.78, doorZ: -0.7, doorW: 1.3 };
  C.zc = (C.z0 + C.z1) / 2;
  const HX = -5.0; // hearth centre along the back wall
  W.fire = new T.Vector3(HX, 0.14, C.z0 + 0.68);
  W.hearthFront = { x: HX, z: C.z0 + 1.75 };
  W.pile = { x: HX - 2.0, z: C.z0 + 0.48 };
  W.chimneyTop = new T.Vector3(HX, 4.62, C.z0 + 0.12);
  W.waystone = HH.uv2w(78.6, 0.9);

  /* ---------- the path ---------- */
  const ctrl = [[-0.62, -1.62], [0.9, -0.2], [3.5, 0.9], [7, 1.1], [11, 0.6], [17, -0.8], [24, -1.8], [32, -0.6],
    [40, 1.6], [48, 2.2], [56, 0.6], [64, -1.4], [72, -0.6], [77, 0.3], [79, 0.5]];
  const curve = new T.CatmullRomCurve3(ctrl.map(c => new T.Vector3(c[0], 0, c[1])), false, 'centripetal');
  const NP = 320;
  const pathUV = curve.getSpacedPoints(NP).map(p => ({ u: p.x, v: p.z }));
  const pathW = pathUV.map(p => HH.uv2w(p.u, p.v));
  const tab = [];
  (function () {
    let j = 0;
    for (let u = 0; u <= 82.01; u += 0.25) {
      while (j < NP - 1 && pathUV[j + 1].u < u) j++;
      const a = pathUV[j], b = pathUV[Math.min(j + 1, NP)];
      const t = b.u > a.u ? clamp((u - a.u) / (b.u - a.u), 0, 1) : 0;
      tab.push(a.v + (b.v - a.v) * t);
    }
  })();
  W.pathV = function (u) {
    const f = clamp(u, 0, 82) / 0.25, i = Math.floor(f), t = f - i;
    const a = tab[i], b = tab[i + 1] !== undefined ? tab[i + 1] : a;
    return a + (b - a) * t;
  };
  W.hw = u => lerp(1.5, 4.2, smooth(11.5, 17, u)) + 1.6 * smooth(70, 76, u);
  W.distPath = function (x, z) {
    let best = 1e9;
    for (let i = 0; i < NP; i++) {
      const a = pathW[i], b = pathW[i + 1];
      const dx = b.x - a.x, dz = b.z - a.z;
      const t = clamp(((x - a.x) * dx + (z - a.z) * dz) / (dx * dx + dz * dz + 1e-9), 0, 1);
      const px = a.x + dx * t - x, pz = a.z + dz * t - z;
      const d = px * px + pz * pz;
      if (d < best) best = d;
    }
    return Math.sqrt(best);
  };
  const U0 = 9.6, U1 = 80.5;

  /* ---------- collision ---------- */
  const col = W.col = { boxes: [], circles: [], segs: [] };
  const addBox = (x0, x1, z0, z1) => col.boxes.push({ x0: Math.min(x0, x1), x1: Math.max(x0, x1), z0: Math.min(z0, z1), z1: Math.max(z0, z1) });
  const addCircle = (x, z, r) => col.circles.push({ x, z, r });
  const addSeg = (x1, z1, x2, z2, r) => col.segs.push({ x1, z1, x2, z2, r: r || 0.1 });

  /* keeps a point inside the walkable world: the clearing plus a corridor along the path */
  W.constrain = function (p) {
    const d = Math.hypot(p.x, p.z);
    if (d <= W.RW) return;
    const uv = HH.w2uv(p.x, p.z);
    if (uv.u >= U0 && uv.u <= U1 && Math.abs(uv.v - W.pathV(uv.u)) <= W.hw(uv.u)) return;
    const c1x = p.x * W.RW / d, c1z = p.z * W.RW / d;
    const cu = clamp(uv.u, U0, U1), pv = W.pathV(cu), h = W.hw(cu);
    const c2 = HH.uv2w(cu, clamp(uv.v, pv - h, pv + h));
    const d1 = (p.x - c1x) * (p.x - c1x) + (p.z - c1z) * (p.z - c1z);
    const d2 = (p.x - c2.x) * (p.x - c2.x) + (p.z - c2.z) * (p.z - c2.z);
    if (d1 < d2) { p.x = c1x; p.z = c1z; } else { p.x = c2.x; p.z = c2.z; }
  };
  W.collide = function (p, r) {
    for (let pass = 0; pass < 2; pass++) {
      for (let i = 0; i < col.boxes.length; i++) {
        const b = col.boxes[i];
        const cx = clamp(p.x, b.x0, b.x1), cz = clamp(p.z, b.z0, b.z1);
        let dx = p.x - cx, dz = p.z - cz;
        const d2 = dx * dx + dz * dz;
        if (d2 >= r * r) continue;
        if (d2 > 1e-8) { const d = Math.sqrt(d2); p.x = cx + dx / d * r; p.z = cz + dz / d * r; }
        else {
          const l = p.x - b.x0, rr = b.x1 - p.x, n = p.z - b.z0, f = b.z1 - p.z, m = Math.min(l, rr, n, f);
          if (m === l) p.x = b.x0 - r; else if (m === rr) p.x = b.x1 + r; else if (m === n) p.z = b.z0 - r; else p.z = b.z1 + r;
        }
      }
      for (let i = 0; i < col.circles.length; i++) {
        const c = col.circles[i];
        const dx = p.x - c.x, dz = p.z - c.z, rr = r + c.r, d2 = dx * dx + dz * dz;
        if (d2 >= rr * rr) continue;
        const d = Math.sqrt(d2) || 0.0001;
        p.x = c.x + dx / d * rr; p.z = c.z + dz / d * rr;
      }
      for (let i = 0; i < col.segs.length; i++) {
        const s = col.segs[i];
        const sx = s.x2 - s.x1, sz = s.z2 - s.z1;
        const t = clamp(((p.x - s.x1) * sx + (p.z - s.z1) * sz) / (sx * sx + sz * sz + 1e-9), 0, 1);
        const cx = s.x1 + sx * t, cz = s.z1 + sz * t;
        const dx = p.x - cx, dz = p.z - cz, rr = r + s.r, d2 = dx * dx + dz * dz;
        if (d2 >= rr * rr) continue;
        const d = Math.sqrt(d2) || 0.0001;
        p.x = cx + dx / d * rr; p.z = cz + dz / d * rr;
      }
      W.constrain(p);
    }
  };
  W.inside = function (x, z) {
    return x > C.x0 - 0.05 && x < C.x1 + 0.3 && z > C.z0 - 0.05 && z < C.z1 + 0.05;
  };

  /* ---------- small shared pieces ---------- */
  function stoneShade(rnd) {
    const k = rnd();
    const base = k < 0.5 ? P.stone : P.stoneL;
    return HH.tint(base, (rnd() - 0.5) * 0.07, 0.02, (rnd() - 0.5) * 0.04);
  }
  function woodShade(rnd, base) { return HH.tint(base || P.wood, (rnd() - 0.5) * 0.06, 0, 0); }

  /* fills a volume with courses of stone blocks running along x */
  function stoneBlocks(k, x0, x1, y0, y1, z0, z1, rnd, o) {
    const rows = Math.max(1, Math.round((y1 - y0) / 0.36));
    const ch = (y1 - y0) / rows, zc = (z0 + z1) / 2, d = z1 - z0;
    for (let r = 0; r < rows; r++) {
      let a = x0, first = true;
      while (a < x1 - 0.01) {
        let bl = 0.42 + rnd() * 0.36;
        if (first && r % 2) bl *= 0.6;
        first = false;
        if (x1 - (a + bl) < 0.26) bl = x1 - a;
        const jz = (rnd() - 0.5) * 0.03;
        k.box(bl - 0.025, ch - 0.02, d + jz * 2, a + bl / 2, y0 + ch * (r + 0.5), zc, o && o.color ? o.color : stoneShade(rnd), { r: 0.045 });
        a += bl;
      }
    }
  }

  function makeLog(len, rad) {
    const k = new HH.Kit();
    const bark = HH.faceShade(P.woodD, 0.05, 7);
    k.cyl(rad, rad, len, 8, 0, 0, 0, bark, { rx: Math.PI / 2 });
    k.cyl(rad * 0.86, rad * 0.86, 0.02, 8, 0, 0, len / 2 + 0.004, HH.col(P.tan), { rx: Math.PI / 2 });
    k.cyl(rad * 0.86, rad * 0.86, 0.02, 8, 0, 0, -len / 2 - 0.004, HH.col(P.tan), { rx: Math.PI / 2 });
    k.cyl(rad * 0.4, rad * 0.4, 0.02, 6, 0, 0, len / 2 + 0.012, HH.col(P.brown), { rx: Math.PI / 2 });
    return k.build();
  }
  W.makeLog = makeLog;

  /* ---------- ground ---------- */
  function buildGround() {
    const u0 = -30, u1 = 96, v0 = -25, v1 = 24.2, step = 0.6;
    const nu = Math.round((u1 - u0) / step), nv = Math.round((v1 - v0) / step);
    const pos = [], colr = [], nor = [], idx = [];
    const c = new T.Color(), c2 = new T.Color();
    const doorW = { x: C.x1 + 0.9, z: C.doorZ };
    for (let j = 0; j <= nv; j++) {
      for (let i = 0; i <= nu; i++) {
        const u = u0 + i * step, v = v0 + j * step;
        const w = HH.uv2w(u, v), x = w.x, z = w.z;
        const dist = Math.hypot(x, z);
        const n = HH.fbm(x * 0.21 + 3.1, z * 0.21 - 1.7), n2 = HH.noise2(x * 0.95, z * 0.95), n3 = HH.noise2(x * 0.5 + 40, z * 0.5 + 11);
        // meadow
        c.setHex(P.grassD).lerp(c2.setHex(P.grassL), smooth(0.28, 0.72, n));
        c.lerp(c2.setHex(P.grass), 0.35);
        c.lerp(c2.setHex(0xa7a850), smooth(0.62, 0.9, n3) * 0.35 * (1 - smooth(6, 10, dist)));
        // forest floor
        const tf = smooth(W.R - 2.0, W.R + 3.5, dist + (n2 - 0.5) * 2.2);
        c2.setHex(0x4f6a3a).lerp(new T.Color(0x66543a), smooth(0.4, 0.78, n3));
        c.lerp(c2, tf);
        // path
        if (u > -3 && u < 84 && Math.abs(v) < 9) {
          const dp = W.distPath(x, z);
          const fade = lerp(1, 0.62, smooth(12, 36, u));
          const pw = lerp(1.0, 0.72, smooth(10, 30, u)) + (n2 - 0.5) * 0.55;
          const tp = (1 - smooth(pw - 0.4, pw + 0.3, dp)) * fade;
          c2.setHex(P.path).lerp(new T.Color(P.pathD), smooth(0.3, 0.8, n));
          c.lerp(c2, tp);
        }
        // worn earth by the door and around the garden
        const dd = Math.hypot(x - doorW.x, z - doorW.z);
        c.lerp(c2.setHex(P.pathD), (1 - smooth(0.8, 2.2, dd + (n2 - 0.5))) * 0.85);
        const gx = clamp(x, -7.6, -4.2), gz = clamp(z, 3.7, 6.3);
        c.lerp(c2.setHex(P.soilL), (1 - smooth(0.1, 0.9, Math.hypot(x - gx, z - gz) + (n2 - 0.5) * 0.5)) * 0.7);
        c.convertSRGBToLinear();
        pos.push(x, 0, z); nor.push(0, 1, 0); colr.push(c.r, c.g, c.b);
      }
    }
    for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) {
      const a = j * (nu + 1) + i, b = a + 1, d = a + nu + 1, e = d + 1;
      idx.push(a, d, b, b, d, e);
    }
    const g = new T.BufferGeometry();
    g.setAttribute('position', new T.Float32BufferAttribute(pos, 3));
    g.setAttribute('normal', new T.Float32BufferAttribute(nor, 3));
    g.setAttribute('color', new T.Float32BufferAttribute(colr, 3));
    g.setIndex(idx);
    const m = new T.Mesh(g, HH.mats.smooth);
    m.receiveShadow = true;
    m.frustumCulled = false;
    return m;
  }

  /* ---------- cottage walls ---------- */
  const WIN = HH.hdr(0xffb648, 1.0);
  function wallRun(k, o) {
    const t = C.t, mid = o.fixed + o.out * t / 2, rnd = o.rnd;
    const put = (len, h, th, a, y, off, color, opt) => {
      if (o.axis === 'x') k.box(len, h, th, a, y, mid + off * o.out, color, opt);
      else {
        const op = opt ? Object.assign({}, opt) : undefined;
        if (op && op.rz) { op.rx = -op.rz * o.out; delete op.rz; }
        k.box(th, h, len, mid + off * o.out, y, a, color, op);
      }
    };
    const spans = [];
    let s = o.a0;
    (o.doors || []).forEach(d => { spans.push([s, d.c - d.w / 2]); s = d.c + d.w / 2; });
    spans.push([s, o.a1]);
    spans.forEach(sp => {
      const len = sp[1] - sp[0];
      if (len < 0.05) return;
      put(len, 1.22, t - 0.06, (sp[0] + sp[1]) / 2, 1.0, 0, HH.col(P.plaster), { r: 0.02 });
      let a = sp[0];
      while (a < sp[1] - 0.01) {
        let bl = 0.46 + rnd() * 0.4;
        if (sp[1] - (a + bl) < 0.3) bl = sp[1] - a;
        put(bl - 0.03, 0.42, t + 0.1, a + bl / 2, 0.21, 0.02, stoneShade(rnd), { r: 0.05 });
        a += bl;
      }
    });
    put(o.a1 - o.a0, 0.2, t + 0.06, (o.a0 + o.a1) / 2, 1.68, 0, HH.col(P.wood), { r: 0.035 });
    (o.studs || []).forEach(a => put(0.2, 1.2, t + 0.05, a, 1.0, 0, woodShade(rnd, P.woodD), { r: 0.03 }));
    (o.doors || []).forEach(d => {
      put(0.2, 1.6, t + 0.08, d.c - d.w / 2 - 0.08, 0.8, 0, HH.col(P.woodD), { r: 0.03 });
      put(0.2, 1.6, t + 0.08, d.c + d.w / 2 + 0.08, 0.8, 0, HH.col(P.woodD), { r: 0.03 });
    });
    (o.braces || []).forEach(b => put(b.len || 1.5, 0.13, t + 0.02, b.a, 1.02, 0, HH.col(P.woodD), { rz: b.rz, r: 0.03 }));
    (o.windows || []).forEach(a => {
      put(0.98, 0.1, t + 0.14, a, 1.4, 0, HH.col(P.wood), { r: 0.03 });
      put(0.98, 0.1, t + 0.14, a, 0.68, 0, HH.col(P.wood), { r: 0.03 });
      put(0.1, 0.8, t + 0.14, a - 0.44, 1.04, 0, HH.col(P.wood), { r: 0.03 });
      put(0.1, 0.8, t + 0.14, a + 0.44, 1.04, 0, HH.col(P.wood), { r: 0.03 });
      put(0.055, 0.64, t + 0.08, a, 1.04, 0, HH.col(P.woodD), { r: 0.015 });
      put(0.8, 0.055, t + 0.08, a, 1.04, 0, HH.col(P.woodD), { r: 0.015 });
      put(0.8, 0.64, t + 0.02, a, 1.04, 0, WIN, { glow: true, r: 0 });
      put(1.08, 0.07, t + 0.24, a, 0.61, 0, HH.col(P.woodL), { r: 0.025 });
    });
  }

  function buildCottage() {
    const k = new HH.Kit(), rnd = HH.rng(11), t = C.t;
    // floor planks
    for (let i = 0; i < 12; i++) {
      const z = C.z0 + 0.25 + i * 0.5;
      let x = C.x0;
      while (x < C.x1 - 0.01) {
        let len = 1.8 + rnd() * 2.2;
        if (C.x1 - (x + len) < 0.9) len = C.x1 - x;
        k.box(len - 0.03, 0.06, 0.47, x + len / 2, 0, z, HH.tint(rnd() < 0.5 ? P.wood : P.woodL, (rnd() - 0.5) * 0.05 - 0.02, -0.04, 0), { r: 0.02 });
        x += len;
      }
    }
    // walls: -Z (back right), -X (back left), +Z (front left), +X (front right, with the door)
    wallRun(k, { axis: 'x', fixed: C.z0, out: -1, a0: C.x0 - t, a1: C.x1 + t, rnd, studs: [-7.3, -3.3], windows: [-8.3] });
    wallRun(k, { axis: 'z', fixed: C.x0, out: -1, a0: C.z0 - t, a1: C.z1 + t, rnd, studs: [-1.95, 0.55], windows: [-0.7] });
    wallRun(k, {
      axis: 'x', fixed: C.z1, out: 1, a0: C.x0 - t, a1: C.x1 + t, rnd, studs: [-6.85, -5.7, -4.55], windows: [-7.75, -3.65],
      braces: [{ a: -6.28, rz: 0.72, len: 1.5 }, { a: -5.12, rz: -0.72, len: 1.5 }]
    });
    wallRun(k, {
      axis: 'z', fixed: C.x1, out: 1, a0: C.z0 - t, a1: C.z1 + t, rnd, studs: [-2.6, 0.45], windows: [1.3],
      doors: [{ c: C.doorZ, w: C.doorW }], braces: [{ a: -2.0, rz: 0.75, len: 1.35 }]
    });
    [[C.x0 - t / 2, C.z0 - t / 2], [C.x1 + t / 2, C.z0 - t / 2], [C.x0 - t / 2, C.z1 + t / 2], [C.x1 + t / 2, C.z1 + t / 2]].forEach(p =>
      k.box(0.34, 1.8, 0.34, p[0], 0.9, p[1], HH.col(P.woodD), { r: 0.04 }));
    addBox(C.x0 - t, C.x0, C.z0 - t, C.z1 + t);
    addBox(C.x0 - t, C.x1 + t, C.z0 - t, C.z0);
    addBox(C.x0 - t, C.x1 + t, C.z1, C.z1 + t);
    addBox(C.x1, C.x1 + t, C.z0 - t, C.doorZ - C.doorW / 2);
    addBox(C.x1, C.x1 + t, C.doorZ + C.doorW / 2, C.z1 + t);
    // open door leaf and the step
    const hx = C.x1 + t + 0.02, hz = C.doorZ - C.doorW / 2 - 0.1;
    k.push(hx, 0, hz, 0.22);
    for (let i = 0; i < 3; i++) k.box(0.38, 1.46, 0.08, 0.2 + i * 0.39, 0.77, 0, woodShade(rnd, i === 1 ? P.wood : P.woodL), { r: 0.025 });
    k.box(1.16, 0.1, 0.12, 0.59, 1.22, 0, HH.col(P.woodD), { r: 0.025 });
    k.box(1.16, 0.1, 0.12, 0.59, 0.34, 0, HH.col(P.woodD), { r: 0.025 });
    k.box(0.07, 0.07, 0.16, 1.02, 0.78, 0, HH.col(P.iron), { r: 0.02 });
    k.pop();
    addSeg(hx, hz, hx + 1.15, hz - 0.25, 0.08);
    k.box(0.8, 0.12, 1.7, C.x1 + t + 0.42, 0.04, C.doorZ, stoneShade(rnd), { r: 0.05 });
    k.box(0.5, 0.08, 0.7, C.x1 + t + 1.25, 0.02, C.doorZ + 0.25, stoneShade(rnd), { r: 0.04, ry: 0.3 });
    k.box(0.45, 0.08, 0.6, C.x1 + t + 1.9, 0.02, C.doorZ - 0.15, stoneShade(rnd), { r: 0.04, ry: -0.2 });

    /* the hearth: the heart of the home */
    const zb = C.z0 - 0.3, zf = C.z0 + 0.95;
    // The opening is tall and the fire sits near its front, so the flames read from the raised camera.
    stoneBlocks(k, HX - 1.15, HX - 0.65, 0, 1.26, zb, zf, rnd);
    stoneBlocks(k, HX + 0.65, HX + 1.15, 0, 1.26, zb, zf, rnd);
    k.box(1.32, 1.36, 0.5, HX, 0.68, zb + 0.25, HH.col(P.soot), { r: 0.02 });
    k.box(1.32, 0.1, 1.2, HX, 0.04, C.z0 + 0.32, HH.tint(P.stone, -0.16, 0, 0), { r: 0.02 });
    // arch stones
    k.box(0.5, 0.34, zf - zb, HX - 0.47, 1.36, (zb + zf) / 2, stoneShade(rnd), { r: 0.05, rz: 0.34 });
    k.box(0.5, 0.34, zf - zb, HX + 0.47, 1.36, (zb + zf) / 2, stoneShade(rnd), { r: 0.05, rz: -0.34 });
    k.box(0.4, 0.38, zf - zb + 0.04, HX, 1.47, (zb + zf) / 2, HH.tint(P.stoneL, 0.03, 0, 0), { r: 0.05 });
    k.box(0.5, 0.36, zf - zb, HX - 0.9, 1.44, (zb + zf) / 2, stoneShade(rnd), { r: 0.05 });
    k.box(0.5, 0.36, zf - zb, HX + 0.9, 1.44, (zb + zf) / 2, stoneShade(rnd), { r: 0.05 });
    stoneBlocks(k, HX - 1.15, HX + 1.15, 1.62, 1.96, zb, zf, rnd);
    k.box(2.66, 0.13, zf - C.z0 + 0.16, HX, 2.02, (C.z0 + zf) / 2 + 0.08, HH.col(P.woodD), { r: 0.04 });
    stoneBlocks(k, HX - 0.95, HX + 0.95, 2.08, 2.46, zb, C.z0 + 0.72, rnd);
    stoneBlocks(k, HX - 0.6, HX + 0.6, 2.46, 4.3, zb, C.z0 + 0.56, rnd);
    stoneBlocks(k, HX - 0.7, HX + 0.7, 4.3, 4.56, zb - 0.08, C.z0 + 0.64, rnd);
    k.box(0.8, 0.06, 0.5, HX, 4.56, (zb + C.z0 + 0.56) / 2, HH.col(P.soot), { r: 0 });
    k.box(3.0, 0.07, 0.8, HX, 0.035, zf + 0.34, HH.tint(P.stone, -0.04, 0, 0), { r: 0.03 });
    // mantel things
    k.cyl(0.09, 0.11, 0.2, 7, HX - 0.9, 2.19, C.z0 + 0.82, HH.col(P.blue));
    k.cyl(0.07, 0.09, 0.14, 7, HX - 0.62, 2.16, C.z0 + 0.88, HH.col(P.cream));
    k.box(0.3, 0.2, 0.06, HX + 0.75, 2.19, C.z0 + 0.82, HH.col(P.woodL), { r: 0.02, rx: -0.2 });
    // charred logs in the firebox
    k.cyl(0.085, 0.085, 0.86, 7, HX, 0.19, C.z0 + 0.56, HH.col(0x33261f), { rz: Math.PI / 2, ry: 0.35 });
    k.cyl(0.085, 0.085, 0.86, 7, HX, 0.24, C.z0 + 0.72, HH.col(0x3d2b22), { rz: Math.PI / 2, ry: -0.4 });
    k.box(0.8, 0.05, 0.42, HX, 0.115, C.z0 + 0.64, HH.hdr(0xff7a2a, 1.6), { glow: true, r: 0 });
    addBox(HX - 1.17, HX + 1.17, C.z0, zf);

    // wood rack (the logs themselves are separate so they can be thrown)
    const px = W.pile.x, pz = W.pile.z;
    [pz - 0.28, pz + 0.28].forEach(z => {
      k.box(1.18, 0.07, 0.08, px, 0.035, z, HH.col(P.woodD), { r: 0.02 });
      k.box(0.08, 0.66, 0.08, px - 0.55, 0.33, z, HH.col(P.woodD), { r: 0.02 });
      k.box(0.08, 0.66, 0.08, px + 0.55, 0.33, z, HH.col(P.woodD), { r: 0.02 });
    });
    addBox(px - 0.6, px + 0.6, C.z0, pz + 0.42);

    // bed
    const bx = C.x0 + 0.68, bz = C.z0 + 1.25;
    k.box(1.1, 0.26, 2.0, bx, 0.2, bz, HH.col(P.wood), { r: 0.04 });
    k.box(1.0, 0.16, 1.9, bx, 0.4, bz, HH.col(P.white), { r: 0.06 });
    k.box(1.06, 0.2, 1.25, bx, 0.44, bz + 0.34, HH.col(P.red), { r: 0.07 });
    k.box(1.06, 0.2, 0.16, bx, 0.45, bz - 0.2, HH.col(P.cream), { r: 0.06 });
    k.box(0.7, 0.14, 0.42, bx, 0.52, bz - 0.68, HH.col(P.white), { r: 0.07 });
    k.box(1.16, 0.86, 0.12, bx, 0.43, bz - 1.02, HH.col(P.woodD), { r: 0.04 });
    k.box(1.16, 0.5, 0.12, bx, 0.25, bz + 1.02, HH.col(P.woodD), { r: 0.04 });
    addBox(bx - 0.58, bx + 0.58, bz - 1.08, bz + 1.08);

    // table, stools, supper things
    const tx = -7.35, tz = 0.05;
    k.box(1.5, 0.1, 0.95, tx, 0.62, tz, HH.col(P.woodL), { r: 0.035 });
    [[-0.62, -0.36], [0.62, -0.36], [-0.62, 0.36], [0.62, 0.36]].forEach(p => k.box(0.12, 0.58, 0.12, tx + p[0], 0.29, tz + p[1], HH.col(P.wood), { r: 0.03 }));
    k.cyl(0.17, 0.11, 0.1, 8, tx - 0.3, 0.72, tz + 0.05, HH.col(P.cream));
    k.cyl(0.13, 0.13, 0.03, 8, tx - 0.3, 0.765, tz + 0.05, HH.col(P.autumnL));
    k.cyl(0.07, 0.06, 0.14, 7, tx + 0.35, 0.74, tz - 0.18, HH.col(P.blue));
    k.box(0.3, 0.12, 0.18, tx + 0.25, 0.73, tz + 0.22, HH.col(P.tan), { r: 0.06, ry: 0.4 });
    addBox(tx - 0.75, tx + 0.75, tz - 0.48, tz + 0.48);
    [[tx - 0.35, tz - 0.9], [tx + 0.4, tz + 0.92]].forEach(p => {
      k.cyl(0.24, 0.24, 0.08, 8, p[0], 0.36, p[1], HH.col(P.woodL));
      k.cyl(0.06, 0.08, 0.34, 6, p[0], 0.17, p[1], HH.col(P.woodD));
      addCircle(p[0], p[1], 0.22);
    });

    // rug in front of the fire
    k.box(2.5, 0.03, 1.5, HX, 0.045, C.z0 + 2.35, HH.col(P.rug), { r: 0.012 });
    k.box(2.2, 0.03, 1.2, HX, 0.052, C.z0 + 2.35, HH.col(P.rugD), { r: 0.012 });
    k.box(1.9, 0.03, 0.9, HX, 0.059, C.z0 + 2.35, HH.col(P.rug), { r: 0.012 });
    k.box(0.5, 0.03, 0.5, HX, 0.066, C.z0 + 2.35, HH.col(P.gold), { r: 0.012, ry: Math.PI / 4 });

    // shelf on the back-left wall
    const sx = C.x0 + 0.24, sz = 1.25;
    k.box(0.4, 1.4, 1.2, sx, 0.7, sz, HH.col(P.wood), { r: 0.03 });
    [0.42, 0.82, 1.2].forEach((y, r) => {
      k.box(0.36, 0.05, 1.1, sx + 0.04, y, sz, HH.col(P.woodL), { r: 0.015 });
      let z = sz - 0.46;
      for (let i = 0; i < 6; i++) {
        const wdt = 0.09 + rnd() * 0.07, hh = 0.2 + rnd() * 0.12;
        const cc = [P.red, P.blue, P.olive, P.gold, P.cream, P.tan][(i + r * 2) % 6];
        if (rnd() > 0.2) k.box(0.22, hh, wdt, sx + 0.1, y + 0.025 + hh / 2, z + wdt / 2, HH.tint(cc, -0.04, -0.08, 0), { r: 0.012 });
        z += wdt + 0.035;
      }
    });
    addBox(sx - 0.25, sx + 0.25, sz - 0.62, sz + 0.62);

    // things by the door, outside
    const ox = C.x1 + t + 0.5;
    k.cyl(0.3, 0.26, 0.74, 9, ox, 0.37, 1.15, HH.faceShade(P.wood, 0.04, 3));
    k.cyl(0.315, 0.315, 0.06, 9, ox, 0.2, 1.15, HH.col(P.iron));
    k.cyl(0.315, 0.315, 0.06, 9, ox, 0.56, 1.15, HH.col(P.iron));
    k.cyl(0.27, 0.27, 0.03, 9, ox, 0.75, 1.15, HH.col(P.woodL));
    k.box(0.6, 0.5, 0.6, ox + 0.05, 0.25, 1.95, HH.col(P.woodL), { r: 0.03, ry: 0.15 });
    k.box(0.64, 0.08, 0.64, ox + 0.05, 0.5, 1.95, HH.col(P.wood), { r: 0.02, ry: 0.15 });
    k.box(0.64, 0.08, 0.08, ox + 0.05, 0.25, 2.24, HH.col(P.wood), { r: 0.02, ry: 0.15 });
    addCircle(ox, 1.15, 0.3); addBox(ox - 0.28, ox + 0.38, 1.62, 2.28);
    // the hidden ground behind the cottage is closed off
    addBox(C.x0 - 0.5, C.x1 + 2.9, C.z0 - 7, C.z0 - t);
    addBox(C.x0 - 6, C.x0 - t, C.z0 - 1, C.z1 + 1.25);
    return k.build();
  }

  /* ---------- roof (its own materials so it can fade when someone is inside) ---------- */
  function buildRoof() {
    const k = new HH.Kit(), rnd = HH.rng(23), t = C.t;
    const eaveY = 1.5, rise = 2.45, hs = (C.z1 - C.z0) / 2 + t + 0.5;
    const ang = Math.atan2(rise, hs), sl = Math.hypot(rise, hs), ridgeY = eaveY + rise;
    const xa = C.x0 - t - 0.55, xb = C.x1 + t + 0.55, len = xb - xa;
    const rows = 7, cols = 9, rowL = sl / rows, tw = len / cols;
    [1, -1].forEach(sg => {
      const ny = Math.cos(ang), nz = sg * Math.sin(ang);
      const dz = sg * Math.cos(ang), dy = -Math.sin(ang);
      k.box(len - 0.12, 0.08, sl, (xa + xb) / 2, ridgeY + dy * sl / 2 - ny * 0.07, C.zc + dz * sl / 2 - nz * 0.07, HH.col(P.woodDD), { rx: sg * ang, r: 0.02 });
      for (let r = 0; r < rows; r++) {
        const d = (r + 0.5) * rowL + 0.03;
        const off = (r % 2) * tw * 0.5;
        for (let c = -1; c < cols; c++) {
          let x0 = xa + c * tw + off, x1 = x0 + tw;
          x0 = Math.max(x0, xa); x1 = Math.min(x1, xb);
          if (x1 - x0 < 0.08) continue;
          const pick = rnd();
          const shade = HH.tint(pick < 0.2 ? P.slateL : pick < 0.45 ? P.slateD : P.slate, (rnd() - 0.5) * 0.035, 0, 0);
          k.box(x1 - x0 - 0.035, 0.11, rowL + 0.12, (x0 + x1) / 2, ridgeY + dy * d + ny * 0.045, C.zc + dz * d + nz * 0.045, shade, { rx: sg * (ang - 0.075), r: 0.035 });
        }
      }
      // barge boards at both gable ends
      [xa + 0.06, xb - 0.06].forEach(x => k.box(0.14, 0.2, sl + 0.14, x, ridgeY + dy * sl / 2 - ny * 0.04, C.zc + dz * sl / 2 - nz * 0.04, HH.col(P.wood), { rx: sg * ang, r: 0.03 }));
    });
    for (let c = 0; c < cols; c++) k.box(tw - 0.04, 0.15, 0.4, xa + (c + 0.5) * tw, ridgeY + 0.05, C.zc, HH.tint(P.slateD, (rnd() - 0.5) * 0.03, 0, 0), { r: 0.05 });
    // gables
    const half = (C.z1 - C.z0) / 2 + t, apex = eaveY + (hs - half) * Math.tan(ang) + half * Math.tan(ang) - 0.2, baseY = 1.76;
    const shape = new T.Shape();
    shape.moveTo(-half, 0); shape.lineTo(half, 0); shape.lineTo(0, apex - baseY); shape.lineTo(-half, 0);
    const gGeo = new T.ExtrudeGeometry(shape, { depth: 0.16, bevelEnabled: false });
    gGeo.translate(0, 0, -0.08);
    [C.x1 + t / 2, C.x0 - t / 2].forEach((x, i) => {
      k.geo(gGeo, x, baseY, C.zc, HH.col(P.plaster), { ry: Math.PI / 2, smooth: true });
      const fx = x + (i === 0 ? 0.09 : -0.09);
      k.box(0.08, 0.14, half * 2 - 0.1, fx, baseY + 0.07, C.zc, HH.col(P.wood), { r: 0.02 });
      k.box(0.08, 0.13, 2.5, fx, baseY + 1.2, C.zc, HH.col(P.wood), { r: 0.02 });
      k.box(0.08, 1.2, 0.14, fx, baseY + 0.6, C.zc - 0.62, HH.col(P.woodD), { r: 0.02 });
      k.box(0.08, 1.2, 0.14, fx, baseY + 0.6, C.zc + 0.62, HH.col(P.woodD), { r: 0.02 });
      k.box(0.1, 0.62, 0.62, x, baseY + 0.62, C.zc, WIN, { glow: true, r: 0 });
      k.box(0.2, 0.05, 0.62, x, baseY + 0.62, C.zc, HH.col(P.woodD), { r: 0.012 });
      k.box(0.2, 0.62, 0.05, x, baseY + 0.62, C.zc, HH.col(P.woodD), { r: 0.012 });
    });
    const mats = {
      smooth: HH.lit({ flat: false }), flat: HH.lit({ flat: true }), leaf: HH.lit({ flat: true, sway: true }),
      glow: new T.MeshBasicMaterial({ vertexColors: true })
    };
    const g = k.build({ mats, cast: false });
    g.userData.mats = [mats.smooth, mats.flat, mats.glow];
    return g;
  }

  /* ---------- garden and fences ---------- */
  function fenceRun(k, pts, rnd, o) {
    o = o || {};
    const ph = o.h || 0.8;
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i];
      const tall = o.tall && o.tall.indexOf(i) >= 0;
      const h = tall ? ph * 1.45 : ph + (rnd() - 0.5) * 0.08;
      k.box(0.17, h, 0.17, p.x, h / 2, p.z, woodShade(rnd, P.woodD), { r: 0.035, ry: rnd() * 0.3 });
      if (tall) k.box(0.25, 0.08, 0.25, p.x, h + 0.02, p.z, HH.col(P.wood), { r: 0.03 });
      if (i < pts.length - 1) {
        const q = pts[i + 1], dx = q.x - p.x, dz = q.z - p.z, len = Math.hypot(dx, dz), ry = Math.atan2(-dz, dx);
        [0.3, 0.58].forEach(y => k.box(len + 0.1, 0.1, 0.07, (p.x + q.x) / 2, y + (rnd() - 0.5) * 0.03, (p.z + q.z) / 2, woodShade(rnd, P.wood), { ry, r: 0.025, rz: (rnd() - 0.5) * 0.03 }));
        addSeg(p.x, p.z, q.x, q.z, 0.1);
      }
    }
  }

  function buildYard() {
    const k = new HH.Kit(), rnd = HH.rng(31);
    // garden bed
    const gx0 = -7.5, gx1 = -4.3, gz0 = 3.9, gz1 = 6.1, gcx = (gx0 + gx1) / 2, gcz = (gz0 + gz1) / 2;
    k.box(gx1 - gx0, 0.16, gz1 - gz0, gcx, 0.07, gcz, HH.col(P.soil), { r: 0.04 });
    for (let i = 0; i < 4; i++) k.box(gx1 - gx0 - 0.3, 0.07, 0.3, gcx, 0.16, gz0 + 0.38 + i * 0.48, HH.col(P.soilL), { r: 0.035 });
    k.box(gx1 - gx0 + 0.16, 0.22, 0.1, gcx, 0.11, gz0 - 0.05, HH.col(P.woodD), { r: 0.02 });
    k.box(gx1 - gx0 + 0.16, 0.22, 0.1, gcx, 0.11, gz1 + 0.05, HH.col(P.woodD), { r: 0.02 });
    k.box(0.1, 0.22, gz1 - gz0, gx0 - 0.05, 0.11, gcz, HH.col(P.woodD), { r: 0.02 });
    k.box(0.1, 0.22, gz1 - gz0, gx1 + 0.05, 0.11, gcz, HH.col(P.woodD), { r: 0.02 });
    for (let i = 0; i < 6; i++) { // carrots
      const x = gx0 + 0.42 + i * 0.47, z = gz0 + 0.38;
      for (let j = 0; j < 3; j++) k.cone(0.05, 0.3, 4, x + (j - 1) * 0.05, 0.36, z, HH.col(P.leafL), { leaf: true, rz: (j - 1) * 0.35, rx: (rnd() - 0.5) * 0.4, sway: 0.5 });
      k.cyl(0.055, 0.04, 0.07, 6, x, 0.21, z, HH.col(P.autumn));
    }
    for (let i = 0; i < 5; i++) { // cabbages
      const x = gx0 + 0.5 + i * 0.55, z = gz0 + 0.86;
      k.ico(0.2, x, 0.3, z, HH.faceShade(P.leaf, 0.06, 40 + i), { s: [1, 0.72, 1], ry: rnd() * 3 });
      k.ico(0.12, x, 0.39, z, HH.col(P.leafL), { s: [1, 0.7, 1], ry: rnd() * 3 });
    }
    for (let i = 0; i < 7; i++) { // sprouts
      const x = gx0 + 0.36 + i * 0.41, z = gz0 + 1.34;
      k.box(0.03, 0.16, 0.03, x, 0.27, z, HH.col(P.leaf), { leaf: true, sway: 0.3 });
      k.box(0.13, 0.03, 0.07, x + 0.06, 0.35, z, HH.col(P.leafL), { leaf: true, rz: 0.5, sway: 0.5, r: 0.012 });
      k.box(0.13, 0.03, 0.07, x - 0.06, 0.35, z, HH.col(P.leafL), { leaf: true, rz: -0.5, sway: 0.5, r: 0.012 });
    }
    for (let i = 0; i < 5; i++) { // bean poles
      const x = gx0 + 0.55 + i * 0.55, z = gz0 + 1.84;
      k.box(0.04, 0.62, 0.04, x, 0.46, z, HH.col(P.woodL), { r: 0.01 });
      k.ico(0.15, x, 0.42, z, HH.faceShade(P.leaf, 0.07, 60 + i), { s: [1, 1.5, 1], leaf: true, sway: 0.4 });
      k.ico(0.045, x + 0.1, 0.5, z + 0.08, HH.col(P.red), {});
      k.ico(0.04, x - 0.08, 0.36, z + 0.1, HH.col(P.red), {});
    }
    addBox(gx0, gx1, gz0, gz1);
    // garden fence, open towards the yard
    const fx0 = gx0 - 0.3, fx1 = gx1 + 0.3, fz0 = gz0 - 0.3, fz1 = gz1 + 0.3;
    const run = (ax, az, bx, bz, n) => { const pts = []; for (let i = 0; i <= n; i++) pts.push({ x: lerp(ax, bx, i / n), z: lerp(az, bz, i / n) }); return pts; };
    fenceRun(k, run(fx1, fz0, fx0, fz0, 3).concat(run(fx0, fz0, fx0, fz1, 2).slice(1), run(fx0, fz1, fx1, fz1, 3).slice(1), run(fx1, fz1, fx1, fz1 - 1.05, 1).slice(1)), rnd, { h: 0.72 });
    // rim fence either side of the gate
    const gate = Math.atan2(W.pathV(10.9), 10.9), rr = 10.95, gap = 0.145;
    const arc = (a0, a1) => { const n = Math.max(1, Math.round(Math.abs(a1 - a0) * rr / 1.5)); const pts = []; for (let i = 0; i <= n; i++) { const a = lerp(a0, a1, i / n); pts.push(HH.uv2w(Math.cos(a) * rr, Math.sin(a) * rr)); } return pts; };
    fenceRun(k, arc(gate + gap, 1.42), rnd, { tall: [0] });
    fenceRun(k, arc(gate - gap, -0.78), rnd, { tall: [0] });
    // chopping block, axe and a stack of split wood
    const cb = { x: 1.9, z: -4.4 };
    k.cyl(0.34, 0.38, 0.42, 8, cb.x, 0.21, cb.z, HH.faceShade(P.woodD, 0.05, 5));
    k.cyl(0.31, 0.31, 0.03, 8, cb.x, 0.43, cb.z, HH.col(P.tan));
    k.box(0.06, 0.62, 0.06, cb.x + 0.05, 0.7, cb.z, HH.col(P.woodL), { rz: -0.5, r: 0.02 });
    k.box(0.07, 0.2, 0.26, cb.x - 0.08, 0.5, cb.z, HH.col(P.stoneL), { rz: -0.5, r: 0.02 });
    addCircle(cb.x, cb.z, 0.36);
    for (let r = 0; r < 3; r++) for (let i = 0; i < 4 - r; i++) {
      const x = 3.25 + r * 0.15 + i * 0.3, y = 0.15 + r * 0.26, z = -5.3;
      k.cyl(0.14, 0.14, 0.8, 7, x, y, z, HH.faceShade(P.woodD, 0.05, 80 + i + r * 5), { rx: Math.PI / 2, ry: 0.5 });
      k.cyl(0.12, 0.12, 0.02, 7, x + 0.19, y, z + 0.35, HH.col(P.tan), { rx: Math.PI / 2, ry: 0.5 });
    }
    addSeg(3.1, -5.1, 4.3, -5.5, 0.4);
    return k.build();
  }

  /* ---------- plants and rocks ---------- */
  function roundTree(k, x, z, h, hue, rnd) {
    const th = h * 0.4, s = h / 4.4;
    k.cyl(0.15 * s, 0.26 * s, th, 6, x, th / 2, z, HH.faceShade(P.bark, 0.04, (rnd() * 999) | 0), { ry: rnd() * 3 });
    const r = h * 0.3, cy = th + r * 0.62;
    const sw = (v) => clamp((v.y - th * 0.7) / (h * 0.9), 0, 1);
    const dark = hue === P.autumn ? P.autumnD : P.leafD, lite = hue === P.autumn ? P.autumnL : P.leafL;
    k.ico(r, x, cy, z, HH.faceShade(hue, 0.07, (rnd() * 999) | 0), { detail: 1, s: [1, 0.9, 1], leaf: true, sway: sw, ry: rnd() * 3 });
    const n = 3 + ((rnd() * 2) | 0);
    for (let i = 0; i < n; i++) {
      const a = rnd() * Math.PI * 2 + i * 2.1, rr = r * (0.55 + rnd() * 0.22), up = (rnd() - 0.35) * r * 0.9;
      const hx = i === 0 ? lite : (i % 2 ? hue : dark);
      k.ico(rr, x + Math.cos(a) * r * 0.62, cy + up, z + Math.sin(a) * r * 0.62, HH.faceShade(hx, 0.06, (rnd() * 999) | 0), { detail: rr > 0.9 ? 1 : 0, s: [1, 0.86, 1], leaf: true, sway: sw, ry: rnd() * 3, rx: rnd() });
    }
  }
  function pineTree(k, x, z, h, rnd) {
    const s = h / 4.6;
    k.cyl(0.1 * s, 0.2 * s, h * 0.3, 6, x, h * 0.15, z, HH.faceShade(P.bark, 0.04, (rnd() * 999) | 0));
    const sw = (v) => clamp((v.y - h * 0.2) / h, 0, 1);
    const tiers = [[0.3, 0.42, 0.22], [0.235, 0.38, 0.46], [0.165, 0.36, 0.7]];
    tiers.forEach((tr, i) => {
      k.cone(h * tr[0], h * tr[1], 7, x, h * tr[2] + h * tr[1] / 2, z, HH.faceShade(i === 1 ? P.pineD : P.pine, 0.05, (rnd() * 999) | 0), { leaf: true, sway: sw, ry: rnd() * 3 });
    });
  }
  function bush(k, x, z, s, rnd, berries) {
    const hue = rnd() < 0.5 ? P.leaf : P.leafD;
    const n = 2 + ((rnd() * 2) | 0);
    for (let i = 0; i < n; i++) {
      const a = rnd() * 6.28, r = s * (0.36 + rnd() * 0.16), d = i === 0 ? 0 : s * 0.34;
      const bx = x + Math.cos(a) * d, bz = z + Math.sin(a) * d;
      k.ico(r, bx, r * 0.72, bz, HH.faceShade(i ? hue : P.leaf, 0.07, (rnd() * 999) | 0), { s: [1, 0.82, 1], leaf: true, sway: 0.35, ry: rnd() * 3, rx: rnd() });
      if (berries) for (let j = 0; j < 3; j++) { const b = rnd() * 6.28; k.ico(0.05, bx + Math.cos(b) * r * 0.8, r * (0.8 + rnd() * 0.5), bz + Math.sin(b) * r * 0.8, HH.col(P.red), {}); }
    }
  }
  function rock(k, x, z, s, rnd, mossy) {
    k.ico(s, x, s * 0.42, z, HH.faceShade(rnd() < 0.5 ? P.stone : P.stoneL, 0.06, (rnd() * 999) | 0), { s: [1, 0.66, 0.82], ry: rnd() * 3, rx: (rnd() - 0.5) * 0.4 });
    if (mossy) k.ico(s * 0.62, x - s * 0.1, s * 0.66, z, HH.faceShade(P.moss, 0.05, (rnd() * 999) | 0), { s: [1, 0.34, 0.8], ry: rnd() * 3 });
  }
  function tuft(k, x, z, s, rnd, hue) {
    const col = HH.tint(hue || P.grassL, (rnd() - 0.5) * 0.08 + 0.02, 0, 0);
    for (let j = 0; j < 3; j++) {
      const h = (0.2 + rnd() * 0.16) * s;
      k.cone(0.05 * s, h, 3, x + (j - 1) * 0.06 * s, h / 2, z + (rnd() - 0.5) * 0.08, col, { leaf: true, rz: (j - 1) * -0.32, ry: rnd() * 3, sway: (v, ly) => (ly / h + 0.5) * 0.5 });
    }
  }
  function flowers(k, x, z, rnd, hue) {
    const n = 3 + ((rnd() * 3) | 0);
    for (let i = 0; i < n; i++) {
      const a = rnd() * 6.28, d = rnd() * 0.3, fx = x + Math.cos(a) * d, fz = z + Math.sin(a) * d, h = 0.16 + rnd() * 0.12;
      k.box(0.025, h, 0.025, fx, h / 2, fz, HH.col(P.leaf), { leaf: true, sway: 0.3, r: 0 });
      k.box(0.11, 0.05, 0.11, fx, h + 0.02, fz, HH.col(hue || P.white), { leaf: true, sway: 0.6, ry: rnd() * 1.5, r: 0.02 });
      k.box(0.05, 0.05, 0.05, fx, h + 0.05, fz, HH.col(P.gold), { leaf: true, sway: 0.6, r: 0.015 });
    }
    k.ico(0.16, x, 0.06, z, HH.col(P.leafD), { s: [1, 0.5, 1], leaf: true, sway: 0.1 });
  }
  function mushrooms(k, x, z, rnd) {
    const n = 2 + ((rnd() * 2) | 0);
    for (let i = 0; i < n; i++) {
      const s = i === 0 ? 1 : 0.6, mx = x + i * 0.24 * (rnd() < 0.5 ? 1 : -1), mz = z + i * 0.16;
      k.cyl(0.05 * s, 0.065 * s, 0.2 * s, 6, mx, 0.1 * s, mz, HH.col(P.cream));
      k.cone(0.18 * s, 0.14 * s, 7, mx, 0.25 * s, mz, HH.col(P.mushroom));
      k.box(0.045 * s, 0.03, 0.045 * s, mx + 0.07 * s, 0.25 * s, mz + 0.07 * s, HH.col(P.white), { r: 0.01 });
      k.box(0.04 * s, 0.03, 0.04 * s, mx - 0.08 * s, 0.24 * s, mz + 0.03 * s, HH.col(P.white), { r: 0.01 });
    }
  }
  function stump(k, x, z, rnd) {
    k.cyl(0.26, 0.33, 0.34, 7, x, 0.17, z, HH.faceShade(P.bark, 0.05, (rnd() * 999) | 0), { ry: rnd() * 3 });
    k.cyl(0.23, 0.23, 0.03, 7, x, 0.345, z, HH.col(P.tan), { ry: rnd() * 3 });
  }

  /* trees and props placed by hand inside the clearing */
  function buildClearingPlants() {
    const k = new HH.Kit(), rnd = HH.rng(47);
    // behind the cottage
    roundTree(k, -0.4, -6.4, 5.6, P.autumn, rnd);
    roundTree(k, -4.4, -7.5, 5.0, P.leaf, rnd);
    pineTree(k, -7.6, -6.6, 5.2, rnd);
    roundTree(k, -10.4, -3.4, 4.4, P.leaf, rnd);
    pineTree(k, -2.4, -8.4, 4.6, rnd);
    bush(k, -1.3, -4.5, 1.15, rnd, true); bush(k, 0.3, -4.9, 0.9, rnd); rock(k, -0.4, -4.2, 0.42, rnd, true);
    bush(k, -9.95, 2.9, 1.2, rnd); bush(k, -10.3, 1.4, 1.0, rnd, true); rock(k, -9.9, 3.75, 0.36, rnd, true);
    bush(k, -10.4, -0.6, 1.1, rnd);
    addCircle(-0.4, -6.4, 0.5);
    // yard dressing
    bush(k, -1.55, 3.05, 0.85, rnd, true); addCircle(-1.55, 3.05, 0.42);
    rock(k, 4.6, 5.2, 0.5, rnd, true); addCircle(4.6, 5.2, 0.42);
    rock(k, 5.25, 5.55, 0.26, rnd);
    rock(k, 6.9, -0.9, 0.34, rnd, true); addCircle(6.9, -0.9, 0.3);
    stump(k, -1.6, 7.6, rnd); addCircle(-1.6, 7.6, 0.32);
    bush(k, 0.6, 9.2, 1.0, rnd); addCircle(0.6, 9.2, 0.5);
    bush(k, -8.6, 7.2, 0.9, rnd, true);
    [[-9.75, 4.6], [-3.2, 3.2], [-0.9, -2.9], [3.6, 3.2], [6.7, -1.3], [1.3, 6.4], [-3.6, 7.4], [7.9, -5.4], [2.4, -7.4], [6.9, 4.9], [8.3, 1.7], [-6.2, 8.1]].forEach((p, i) =>
      flowers(k, p[0], p[1], rnd, i % 4 === 3 ? 0xf0d27a : P.white));
    // stepping stones along the first stretch of path
    for (let i = 6; i < 64; i += 7) {
      const p = pathW[i], q = pathW[i + 1], a = Math.atan2(-(q.z - p.z), q.x - p.x);
      k.box(0.5 + rnd() * 0.2, 0.07, 0.4 + rnd() * 0.15, p.x + (rnd() - 0.5) * 0.3, 0.012, p.z + (rnd() - 0.5) * 0.3, stoneShade(rnd), { r: 0.035, ry: a + (rnd() - 0.5) * 0.6 });
    }
    // grass
    let placed = 0, guard = 0;
    while (placed < 300 && guard++ < 4000) {
      const a = rnd() * 6.28, d = Math.sqrt(rnd()) * (W.R + 1.5), x = Math.cos(a) * d, z = Math.sin(a) * d;
      if (x > C.x0 - 0.6 && x < C.x1 + 0.6 && z > C.z0 - 0.6 && z < C.z1 + 0.6) continue;
      if (x > -7.9 && x < -3.9 && z > 3.5 && z < 6.5) continue;
      if (W.distPath(x, z) < 1.35) continue;
      tuft(k, x, z, 0.9 + rnd() * 0.5, rnd);
      placed++;
    }
    return k.build();
  }

  function vmax(u) {
    let m = -1e9;
    if (Math.abs(u) < W.RW) m = Math.sqrt(W.RW * W.RW - u * u);
    if (u >= U0 && u <= U1 + 1) m = Math.max(m, W.pathV(u) + W.hw(u));
    return m;
  }

  function buildForest(scene) {
    const rnd = HH.rng(101), chunks = {}, CW = 14;
    const kitFor = u => { const i = Math.floor((u + 30) / CW); return chunks[i] || (chunks[i] = new HH.Kit()); };
    const sp = 2.25;
    for (let u = -27; u <= 93; u += sp) {
      for (let v = -22; v <= 21.5; v += sp) {
        const uu = u + (rnd() - 0.5) * 1.7, vv = v + (rnd() - 0.5) * 1.7;
        const w = HH.uv2w(uu, vv), dist = Math.hypot(w.x, w.z);
        const r1 = rnd(), r2 = rnd(), r3 = rnd();
        if (dist < W.R + 0.7) continue;
        const inU = uu >= U0 - 1 && uu <= U1 + 1.5;
        const pv = W.pathV(uu), hw = W.hw(uu);
        if (inU && Math.abs(vv - pv) < hw + 0.75) continue;
        const sdC = dist - (W.R + 13), sdP = Math.max(Math.abs(vv - 0.4) - 12, uu - 88, -uu);
        if (Math.min(sdC, sdP) > 4.5) continue;
        const k = kitFor(uu);
        const depth = clamp((dist - W.R) / 50, 0, 1);
        let maxH = 9;
        const vm = vmax(uu);
        if (vm > -1e8 && vv > vm) maxH = (vv - vm) / 1.12;
        if (maxH < 1.5) {
          if (maxH > 0.5 && r1 < 0.55) bush(k, w.x, w.z, clamp(maxH * 0.95, 0.6, 1.25), rnd, r2 < 0.25);
          else if (r1 < 0.72) rock(k, w.x, w.z, 0.28 + r2 * 0.25, rnd, true);
          else if (r1 < 0.86) stump(k, w.x, w.z, rnd);
          else tuft(k, w.x, w.z, 1.5, rnd, P.leaf);
          continue;
        }
        let h = lerp(3.4, 5.9, r2);
        if (h > maxH) h = maxH * (0.86 + r3 * 0.14);
        const pPine = 0.26 + 0.36 * depth, pOrange = 0.2 * (1 - depth) * (1 - smooth(4, 16, dist - W.R) * 0.6);
        if (r1 < pPine) pineTree(k, w.x, w.z, h * 1.05, rnd);
        else roundTree(k, w.x, w.z, h, r1 < pPine + pOrange ? P.autumn : (r3 < 0.5 ? P.leaf : P.leafD), rnd);
        if (rnd() < 0.3) tuft(k, w.x + 0.8, w.z + 0.5, 1.3, rnd, P.leaf);
      }
    }
    // things inside the walkable corridor, kept clear of the path itself
    const cr = HH.rng(202);
    for (let u = 15; u < 78; u += 2.6) {
      const uu = u + (cr() - 0.5) * 1.6, side = cr() < 0.5 ? -1 : 1, pv = W.pathV(uu), hw = W.hw(uu);
      const off = side * lerp(1.7, hw - 0.3, cr()), vv = pv + off, w = HH.uv2w(uu, vv), k = kitFor(uu), pick = cr();
      if (pick < 0.2 && side < 0) { roundTree(k, w.x, w.z, 3.6 + cr() * 1.4, cr() < 0.5 ? P.leaf : P.leafD, cr); addCircle(w.x, w.z, 0.34); }
      else if (pick < 0.3 && side < 0) { pineTree(k, w.x, w.z, 4 + cr() * 1.5, cr); addCircle(w.x, w.z, 0.3); }
      else if (pick < 0.5) { const s = 0.36 + cr() * 0.3; rock(k, w.x, w.z, s, cr, true); addCircle(w.x, w.z, s * 0.8); }
      else if (pick < 0.64) { stump(k, w.x, w.z, cr); addCircle(w.x, w.z, 0.3); }
      else if (pick < 0.82) mushrooms(k, w.x, w.z, cr);
      else bush(k, w.x, w.z, 0.7 + cr() * 0.3, cr, cr() < 0.4), addCircle(w.x, w.z, 0.36);
      for (let i = 0; i < 3; i++) {
        const tu = uu + (cr() - 0.5) * 2.6, tv = W.pathV(tu) + (cr() < 0.5 ? -1 : 1) * lerp(1.3, W.hw(tu), cr()), tw = HH.uv2w(tu, tv);
        tuft(kitFor(tu), tw.x, tw.z, 1.1 + cr() * 0.5, cr, P.leaf);
      }
    }
    // the dark waystone at the end of the path
    const ws = W.waystone, k = kitFor(78.6);
    k.ico(0.74, ws.x, 1.1, ws.z, HH.faceShade(P.stone, 0.05, 9), { s: [0.8, 1.75, 0.6], ry: 0.5, detail: 0 });
    rock(k, ws.x + 0.6, ws.z + 0.3, 0.36, cr, true); rock(k, ws.x - 0.55, ws.z + 0.2, 0.3, cr, true); rock(k, ws.x + 0.1, ws.z - 0.6, 0.26, cr);
    const rune = HH.hdr(0x6fd6e6, 0.75);
    k.push(ws.x + 0.24, 1.25, ws.z + 0.4, Math.PI / 4 + 0.15);
    [[0, 0.16, 0.18, 0.035], [0, -0.16, 0.18, 0.035], [0.11, 0, 0.035, 0.3], [-0.11, 0, 0.035, 0.3]].forEach(b => k.box(b[2], b[3], 0.03, b[0], b[1], 0, rune, { glow: true, r: 0 }));
    k.box(0.05, 0.05, 0.03, 0, 0, 0, rune, { glow: true, r: 0, rz: Math.PI / 4 });
    k.pop();
    addCircle(ws.x, ws.z, 0.6);
    mushrooms(k, ws.x - 1.2, ws.z + 0.9, cr);
    Object.keys(chunks).forEach(i => scene.add(chunks[i].build()));
  }

  W.build = function (scene) {
    scene.add(buildGround());
    scene.add(buildCottage());
    scene.add(buildYard());
    scene.add(buildClearingPlants());
    buildForest(scene);
    const roof = buildRoof();
    scene.add(roof);
    W.roof = roof;
    // the wood pile: five real logs
    W.logSlots = [[-0.31, 0.2], [0, 0.2], [0.31, 0.2], [-0.155, 0.47], [0.155, 0.47]].map(s => new T.Vector3(W.pile.x + s[0], s[1], W.pile.z));
    W.logs = W.logSlots.map((s, i) => { const m = makeLog(0.72, 0.145); m.position.copy(s); m.rotation.z = i * 1.3; scene.add(m); return m; });
  };
})();
