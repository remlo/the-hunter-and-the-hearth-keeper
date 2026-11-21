/* The hunter and the hearth keeper: web demo.
   kit.js: palette, helpers, light-aware materials and the geometry builder.
   Everything in the demo is built from simple shapes through this file. */
(function () {
  'use strict';
  const T = THREE;
  const HH = window.HH = {};

  /* ---------- palette (sRGB). First ten are sampled from the asset reference sheet. ---------- */
  HH.PAL = {
    cream: 0xecd4a8, tan: 0xc9925a, brown: 0x9d6334, bark: 0x4a372f, olive: 0x70893a,
    blue: 0x4d6c94, red: 0xb5493a, gold: 0xdba63c, stoneL: 0x9e9799, stone: 0x7c777a,
    // derived from the ten above
    grass: 0x889a40, grassL: 0xa0ad4e, grassD: 0x67823a, soil: 0x5b4030, soilL: 0x6d4d38,
    path: 0xc9a268, pathD: 0xb18853,
    plaster: 0xecdcb9, plasterD: 0xdcc8a0, slate: 0x5b5576, slateD: 0x4a4564, slateL: 0x6c6689,
    woodL: 0xbd874d, wood: 0x9d683a, woodD: 0x734a2b, woodDD: 0x513625,
    leaf: 0x698e3b, leafL: 0x88a745, leafD: 0x4e7437, pine: 0x416c41, pineD: 0x34593b,
    autumn: 0xdb7a2d, autumnL: 0xeb9c3d, autumnD: 0xba6128,
    skin: 0xf2c79c, hair: 0x7c4b2e, hairD: 0x623a24, blond: 0xdeb054, blondD: 0xc4923f,
    boot: 0x5b3b29, white: 0xf5ecd9, soot: 0x2b2321, iron: 0x3b3537, eye: 0x2d211f,
    moss: 0x7e9641, mushroom: 0xc5513d, rug: 0xa8433a, rugD: 0x8c362f
  };

  /* ---------- small maths ---------- */
  HH.clamp = (x, a, b) => Math.max(a, Math.min(b, x));
  HH.lerp = (a, b, t) => a + (b - a) * t;
  HH.smooth = (a, b, x) => { const t = HH.clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
  HH.damp = (cur, target, rate, dt) => target + (cur - target) * Math.exp(-rate * dt);
  HH.easeOutBack = t => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2); };
  HH.easeOutCubic = t => 1 - Math.pow(1 - t, 3);
  HH.easeInOut = t => t * t * (3 - 2 * t);

  HH.rng = function (seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  };
  function hash2(ix, iz) {
    let h = Math.imul(ix, 374761393) + Math.imul(iz, 668265263);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
  }
  HH.noise2 = function (x, z) {
    const ix = Math.floor(x), iz = Math.floor(z);
    const fx = x - ix, fz = z - iz;
    const sx = fx * fx * (3 - 2 * fx), sz = fz * fz * (3 - 2 * fz);
    const a = hash2(ix, iz), b = hash2(ix + 1, iz), c = hash2(ix, iz + 1), d = hash2(ix + 1, iz + 1);
    return a + (b - a) * sx + (c - a) * sz + (a - b - c + d) * sx * sz;
  };
  HH.fbm = (x, z) => HH.noise2(x, z) * 0.6 + HH.noise2(x * 2.1 + 7.3, z * 2.1 - 3.1) * 0.28 + HH.noise2(x * 4.3 - 1.7, z * 4.3 + 9.2) * 0.12;
  // cheap wobble for fire and light, values around -1..1
  HH.wob = (t, s) => Math.sin(t * 7.3 + s) * 0.5 + Math.sin(t * 12.7 + s * 2.3 + 1.3) * 0.3 + Math.sin(t * 19.1 + s * 3.7 + 2.1) * 0.2;

  /* Screen-aligned layout coordinates: u runs to screen right, v runs towards the camera. */
  const S = Math.SQRT1_2;
  HH.uv2w = (u, v) => ({ x: (u + v) * S, z: (-u + v) * S });
  HH.w2uv = (x, z) => ({ u: (x - z) * S, v: (x + z) * S });

  /* ---------- colour (materials work in linear light, the palette is sRGB) ---------- */
  const colCache = {};
  HH.col = function (hex) {
    let c = colCache[hex];
    if (!c) c = colCache[hex] = new T.Color(hex).convertSRGBToLinear();
    return c;
  };
  HH.tint = (hex, dl, ds, dh) => new T.Color(hex).offsetHSL(dh || 0, ds || 0, dl || 0).convertSRGBToLinear();
  HH.mixc = (hexA, hexB, t) => new T.Color(hexA).lerp(new T.Color(hexB), t).convertSRGBToLinear();
  HH.hdr = (hex, k) => new T.Color(hex).convertSRGBToLinear().multiplyScalar(k);

  /* ---------- shared uniforms: the world's light rules live here ---------- */
  HH.NUM_WARM = 8; // 0 hearth, 1 lantern, 2 flourish ring, 3 cold halo, 4 and 5 waystone, 6 supper, 7 free
  HH.U = {
    uTime: { value: 0 },
    uClear: { value: new T.Vector4(0, 0, 11, 9) },          // clearing centre x,z, radius, falloff
    uWarmPos: { value: Array.from({ length: HH.NUM_WARM }, () => new T.Vector4()) }, // xyz, radius
    uWarmCol: { value: Array.from({ length: HH.NUM_WARM }, () => new T.Vector3()) },
    uDread: { value: 0 },                                   // 1 when the lantern is out
    uVoidCol: { value: new T.Color(0x070b10).convertSRGBToLinear() },
    uMistCol: { value: new T.Color(0x24384a).convertSRGBToLinear() }
  };

  const VERT_PARS = [
    'varying vec3 vWPos;',
    '#ifdef USE_SWAY',
    'attribute float sway;',
    'uniform float uTime;',
    '#endif'
  ].join('\n');
  const VERT_SWAY = [
    '#ifdef USE_SWAY',
    '  float swPh = position.x * 0.45 + position.z * 0.37;',
    '  transformed.x += (sin(uTime * 1.25 + swPh) + 0.4 * sin(uTime * 2.9 + swPh * 2.1)) * 0.055 * sway;',
    '  transformed.z += cos(uTime * 1.05 + swPh * 1.3) * 0.045 * sway;',
    '#endif'
  ].join('\n');
  const FRAG_PARS = [
    'varying vec3 vWPos;',
    'uniform vec4 uClear;',
    'uniform vec4 uWarmPos[' + HH.NUM_WARM + '];',
    'uniform vec3 uWarmCol[' + HH.NUM_WARM + '];',
    'uniform float uDread;',
    'uniform vec3 uVoidCol;',
    'uniform vec3 uMistCol;'
  ].join('\n');
  /* Warm light means safe. Sun and sky are "home" light and fade with distance from the clearing;
     the forest version is cooler, darker and loses colour with depth. Warm point lights are added
     on top, untouched, so the lantern is the only warm thing out there. */
  const FRAG_MAIN = [
    '{',
    '  vec3 hc = gl_FragColor.rgb;',
    '  float hDist = length(vWPos.xz - uClear.xy);',
    '  float hWarm = 1.0 - smoothstep(uClear.z, uClear.z + uClear.w, hDist);',
    '  float hDepth = clamp((hDist - uClear.z) / 50.0, 0.0, 1.0);',
    '  float hLum = dot(hc, vec3(0.2126, 0.7152, 0.0722));',
    '  float hSat = mix(0.55, 0.16, hDepth) * (1.0 - 0.85 * uDread);',
    '  float hBri = mix(0.36, 0.15, hDepth) * (1.0 - 0.12 * uDread);',
    '  vec3 hTint = mix(vec3(0.60, 0.80, 1.02), vec3(0.48, 0.66, 1.05), hDepth);',
    '  hTint = mix(hTint, vec3(0.78, 0.8, 0.84), uDread * 0.8);',
    '  vec3 hGloom = mix(vec3(hLum), hc, hSat) * hTint * hBri;',
    '  hc = mix(hGloom, hc, hWarm);',
    '  vec3 hN = inverseTransformDirection(normal, viewMatrix);',
    '  vec3 hSum = vec3(0.0);',
    '  vec3 hHaze = vec3(0.0);',
    '  float hMask = 0.0;',
    '  for (int i = 0; i < ' + HH.NUM_WARM + '; i++) {',
    '    vec3 hL = uWarmPos[i].xyz - vWPos;',
    '    float hD = length(hL);',
    '    float hA = clamp(1.0 - hD / max(uWarmPos[i].w, 0.001), 0.0, 1.0);',
    '    hA = hA * hA * (3.0 - 2.0 * hA);',
    '    float hNdl = max(dot(hN, hL / max(hD, 0.001)), 0.0);',
    '    hSum += uWarmCol[i] * hA * (0.3 + 0.7 * hNdl);',
    '    hHaze += uWarmCol[i] * hA * hA;',
    '    hMask = max(hMask, hA * min(1.0, dot(uWarmCol[i], vec3(0.6))));',
    '  }',
    '  float hMist = (1.0 - hWarm) * (1.0 - smoothstep(0.0, 3.2, vWPos.y)) * mix(0.16, 0.5, hDepth);',
    '  hc = mix(hc, uMistCol * (1.0 - 0.4 * uDread), hMist * (1.0 - hMask));',
    '  // warm light fills shadow more than it lifts what the sun already lit, so nothing burns out at home',
    '  float hRoom = 1.0 - 0.7 * smoothstep(0.2, 1.0, dot(hc, vec3(0.2126, 0.7152, 0.0722)));',
    '  hc += diffuseColor.rgb * hSum * hRoom + hHaze * 0.012 * (1.0 - hWarm);',
    '  float hU = (vWPos.x - vWPos.z) * 0.70711;',
    '  float hV = (vWPos.x + vWPos.z) * 0.70711;',
    '  float hSdC = hDist - (uClear.z + 13.0);',
    '  float hSdP = max(max(abs(hV - 0.4) - 12.0, hU - 88.0), -hU);',
    '  float hVoid = smoothstep(0.0, 6.0, min(hSdC, hSdP));',
    '  hc = mix(hc, uVoidCol, hVoid);',
    '  gl_FragColor.rgb = hc;',
    '}'
  ].join('\n');

  HH.lit = function (o) {
    o = o || {};
    const mat = new T.MeshLambertMaterial({ vertexColors: true, flatShading: !!o.flat });
    if (o.color !== undefined) { mat.vertexColors = false; mat.color.copy(o.color); }
    mat.defines = {};
    if (o.sway) mat.defines.USE_SWAY = '';
    mat.onBeforeCompile = function (shader) {
      for (const k in HH.U) shader.uniforms[k] = HH.U[k];
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\n' + VERT_PARS)
        .replace('#include <begin_vertex>', '#include <begin_vertex>\n' + VERT_SWAY)
        .replace('#include <project_vertex>', 'vWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;\n#include <project_vertex>');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\n' + FRAG_PARS)
        .replace('#include <output_fragment>', '#include <output_fragment>\n' + FRAG_MAIN);
    };
    mat.customProgramCacheKey = () => 'hh-lit' + (o.sway ? '-sway' : '');
    return mat;
  };

  HH.mats = {
    smooth: HH.lit({ flat: false }),
    flat: HH.lit({ flat: true }),
    leaf: HH.lit({ flat: true, sway: true }),
    glow: new T.MeshBasicMaterial({ vertexColors: true })
  };

  /* ---------- geometry builder: merges many simple shapes into a few vertex-coloured meshes ---------- */
  const _v = new T.Vector3(), _n = new T.Vector3(), _nm = new T.Matrix3();

  class Builder {
    constructor() { this.p = []; this.n = []; this.c = []; this.s = []; }
    get empty() { return this.p.length === 0; }
    add(geo, m, color, sway) {
      const pos = geo.attributes.position, nor = geo.attributes.normal, idx = geo.index;
      _nm.getNormalMatrix(m);
      const count = idx ? idx.count : pos.count;
      const colFn = typeof color === 'function', swFn = typeof sway === 'function';
      for (let i = 0; i < count; i++) {
        const k = idx ? idx.getX(i) : i;
        _v.fromBufferAttribute(pos, k);
        const ly = _v.y;
        _v.applyMatrix4(m);
        this.p.push(_v.x, _v.y, _v.z);
        if (nor) _n.fromBufferAttribute(nor, k).applyMatrix3(_nm).normalize(); else _n.set(0, 1, 0);
        this.n.push(_n.x, _n.y, _n.z);
        const cc = colFn ? color(_v, ly, (i / 3) | 0) : color;
        this.c.push(cc.r, cc.g, cc.b);
        this.s.push(swFn ? sway(_v, ly) : (sway || 0));
      }
    }
    mesh(material, withSway) {
      const g = new T.BufferGeometry();
      g.setAttribute('position', new T.Float32BufferAttribute(this.p, 3));
      g.setAttribute('normal', new T.Float32BufferAttribute(this.n, 3));
      g.setAttribute('color', new T.Float32BufferAttribute(this.c, 3));
      if (withSway) g.setAttribute('sway', new T.Float32BufferAttribute(this.s, 1));
      g.computeBoundingSphere();
      g.computeBoundingBox();
      return new T.Mesh(g, material);
    }
  }

  const geoCache = {};
  function cached(key, make) { return geoCache[key] || (geoCache[key] = make()); }
  const r3 = x => Math.round(x * 1000) / 1000;

  class Kit {
    constructor() {
      this.smooth = new Builder(); this.flat = new Builder(); this.leaf = new Builder(); this.glow = new Builder();
      this.stack = [new T.Matrix4()];
    }
    get top() { return this.stack[this.stack.length - 1]; }
    push(x, y, z, ry, s, rx, rz) {
      const m = new T.Matrix4().compose(
        new T.Vector3(x || 0, y || 0, z || 0),
        new T.Quaternion().setFromEuler(new T.Euler(rx || 0, ry || 0, rz || 0, 'YXZ')),
        typeof s === 'object' && s ? new T.Vector3(s[0], s[1], s[2]) : new T.Vector3(s || 1, s || 1, s || 1));
      this.stack.push(new T.Matrix4().multiplyMatrices(this.top, m));
      return this;
    }
    pop() { this.stack.pop(); return this; }
    at(x, y, z, ry, s, fn) { this.push(x, y, z, ry, s); fn(this); this.pop(); return this; }
    _m(x, y, z, o, sx, sy, sz) {
      const e = new T.Euler(o && o.rx || 0, o && o.ry || 0, o && o.rz || 0, 'YXZ');
      const m = new T.Matrix4().compose(new T.Vector3(x, y, z), new T.Quaternion().setFromEuler(e), new T.Vector3(sx || 1, sy || 1, sz || 1));
      return m.premultiply(this.top);
    }
    _into(o, dflt) {
      if (o && o.glow) return this.glow;
      if (o && o.leaf) return this.leaf;
      if (o && o.flat) return this.flat;
      if (o && o.smooth) return this.smooth;
      return this[dflt];
    }
    /* rounded box, centred on x,y,z. o.r: bevel radius (0 for a crisp box). */
    box(w, h, d, x, y, z, color, o) {
      const minD = Math.min(w, h, d);
      let r = o && o.r !== undefined ? o.r : Math.min(0.05, minD * 0.3);
      r = Math.min(r, minD * 0.49);
      let geo, m;
      if (r <= 0.0001) {
        geo = cached('box', () => new T.BoxGeometry(1, 1, 1));
        m = this._m(x, y, z, o, w, h, d);
      } else {
        const key = 'rb|' + r3(w) + '|' + r3(h) + '|' + r3(d) + '|' + r3(r);
        geo = cached(key, () => new T.RoundedBoxGeometry(w, h, d, 1, r));
        m = this._m(x, y, z, o);
      }
      this._into(o, 'smooth').add(geo, m, color, o && o.sway);
      return this;
    }
    /* box sitting on y0 */
    boxb(w, h, d, x, y0, z, color, o) { return this.box(w, h, d, x, y0 + h / 2, z, color, o); }
    cyl(rt, rb, h, seg, x, y, z, color, o) {
      const key = 'cy|' + r3(rt) + '|' + r3(rb) + '|' + r3(h) + '|' + seg;
      const geo = cached(key, () => new T.CylinderGeometry(rt, rb, h, seg, 1));
      this._into(o, 'flat').add(geo, this._m(x, y, z, o), color, o && o.sway);
      return this;
    }
    cone(r, h, seg, x, y, z, color, o) {
      const key = 'co|' + r3(r) + '|' + r3(h) + '|' + seg;
      const geo = cached(key, () => new T.ConeGeometry(r, h, seg, 1));
      this._into(o, 'flat').add(geo, this._m(x, y, z, o), color, o && o.sway);
      return this;
    }
    ico(r, x, y, z, color, o) {
      const det = o && o.detail || 0;
      const geo = cached('ic|' + det, () => new T.IcosahedronGeometry(1, det));
      const s = o && o.s || [1, 1, 1];
      this._into(o, 'flat').add(geo, this._m(x, y, z, o, r * s[0], r * s[1], r * s[2]), color, o && o.sway);
      return this;
    }
    geo(geo, x, y, z, color, o) {
      const s = o && o.s || [1, 1, 1];
      this._into(o, 'flat').add(geo, this._m(x, y, z, o, s[0], s[1], s[2]), color, o && o.sway);
      return this;
    }
    /* o.cast, o.receive default true; o.mats overrides materials (used by the fading roof) */
    build(o) {
      o = o || {};
      const mats = o.mats || HH.mats;
      const g = new T.Group();
      const add = (b, mat, sway) => {
        if (b.empty) return;
        const mesh = b.mesh(mat, sway);
        mesh.castShadow = o.cast !== false;
        mesh.receiveShadow = o.receive !== false;
        g.add(mesh);
      };
      add(this.smooth, mats.smooth);
      add(this.flat, mats.flat);
      add(this.leaf, mats.leaf, true);
      if (!this.glow.empty) { const mesh = this.glow.mesh(mats.glow); g.add(mesh); }
      return g;
    }
  }
  HH.Kit = Kit;

  /* per-face shade variation for flat foliage and stone, cached so a face keeps one colour */
  HH.faceShade = function (hex, amount, seed) {
    const rnd = HH.rng(seed || 1);
    const shades = [];
    for (let i = 0; i < 7; i++) shades.push(HH.tint(hex, (rnd() - 0.5) * amount, 0, (rnd() - 0.5) * 0.012));
    let off = (rnd() * 97) | 0;
    return (v, ly, face) => shades[(Math.imul(face + off, 2654435761) >>> 0) % 7];
  };
})();
