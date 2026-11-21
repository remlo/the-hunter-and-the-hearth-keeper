/* view.js: the camera pair, the shared and split screen, lighting rig and post-processing.

   The split is a moving seam. Together, one camera frames both players. When they are too far
   apart to share a frame, each gets a camera that keeps them centred in their own half, and the
   seam sits at right angles to the line between them. At the moment of splitting both cameras
   show exactly the same picture, so the screen never pops: the two halves slide apart, and when
   the players meet again the world knits back together. */
(function () {
  'use strict';
  const T = THREE, HH = window.HH;
  const clamp = HH.clamp, lerp = HH.lerp, smooth = HH.smooth, damp = HH.damp;
  const S = Math.SQRT1_2;

  const VS = 'varying vec2 vUv;\nvoid main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }';

  const FS_COMPOSITE = [
    'uniform sampler2D tA; uniform sampler2D tB; uniform vec2 uRes; uniform vec2 uN; varying vec2 vUv;',
    'void main(){',
    '  float s = dot(gl_FragCoord.xy - 0.5 * uRes, uN);',
    '  gl_FragColor = s < 0.0 ? texture2D(tA, vUv) : texture2D(tB, vUv);',
    '}'
  ].join('\n');

  const FS_PREFILTER = [
    'uniform sampler2D tSrc; uniform vec2 uTexel; uniform float uThreshold; uniform float uKnee; varying vec2 vUv;',
    'uniform vec2 uRes; uniform vec2 uN; uniform float uLineA;',
    'void main(){',
    '  vec3 c = texture2D(tSrc, vUv + uTexel * vec2(-0.5, -0.5)).rgb + texture2D(tSrc, vUv + uTexel * vec2(0.5, -0.5)).rgb',
    '         + texture2D(tSrc, vUv + uTexel * vec2(-0.5, 0.5)).rgb + texture2D(tSrc, vUv + uTexel * vec2(0.5, 0.5)).rgb;',
    '  c *= 0.25;',
    '  c = min(c, vec3(12.0));',
    '  float br = max(c.r, max(c.g, c.b));',
    '  float soft = clamp(br - uThreshold + uKnee, 0.0, 2.0 * uKnee);',
    '  soft = soft * soft / (4.0 * uKnee + 0.0001);',
    '  float contrib = max(soft, br - uThreshold) / max(br, 0.0001);',
    '  // glow fades out at the seam so one half never bleeds light into the other',
    '  float sd = abs(dot(vUv * uRes - 0.5 * uRes, uN));',
    '  contrib *= mix(1.0, smoothstep(0.0, uRes.y * 0.085, sd), uLineA);',
    '  gl_FragColor = vec4(c * contrib, 1.0);',
    '}'
  ].join('\n');

  const FS_DOWN = [
    'uniform sampler2D tSrc; uniform vec2 uTexel; varying vec2 vUv;',
    'void main(){',
    '  vec3 c = texture2D(tSrc, vUv).rgb * 4.0;',
    '  c += texture2D(tSrc, vUv + uTexel * vec2(-1.0, -1.0)).rgb + texture2D(tSrc, vUv + uTexel * vec2(1.0, -1.0)).rgb;',
    '  c += texture2D(tSrc, vUv + uTexel * vec2(-1.0, 1.0)).rgb + texture2D(tSrc, vUv + uTexel * vec2(1.0, 1.0)).rgb;',
    '  gl_FragColor = vec4(c / 8.0, 1.0);',
    '}'
  ].join('\n');

  const FS_UP = [
    'uniform sampler2D tSrc; uniform sampler2D tAdd; uniform vec2 uTexel; uniform float uMix; varying vec2 vUv;',
    'void main(){',
    '  vec3 c = texture2D(tSrc, vUv + uTexel * vec2(-2.0, 0.0)).rgb + texture2D(tSrc, vUv + uTexel * vec2(2.0, 0.0)).rgb',
    '         + texture2D(tSrc, vUv + uTexel * vec2(0.0, -2.0)).rgb + texture2D(tSrc, vUv + uTexel * vec2(0.0, 2.0)).rgb;',
    '  c += 2.0 * (texture2D(tSrc, vUv + uTexel * vec2(-1.0, -1.0)).rgb + texture2D(tSrc, vUv + uTexel * vec2(1.0, -1.0)).rgb',
    '         + texture2D(tSrc, vUv + uTexel * vec2(-1.0, 1.0)).rgb + texture2D(tSrc, vUv + uTexel * vec2(1.0, 1.0)).rgb);',
    '  gl_FragColor = vec4(c / 12.0 * uMix + texture2D(tAdd, vUv).rgb, 1.0);',
    '}'
  ].join('\n');

  const FS_FINAL = [
    'uniform sampler2D tScene; uniform sampler2D tBloom;',
    'uniform vec2 uRes; uniform vec2 uN; uniform float uLineW; uniform float uLineA; uniform float uSeam; uniform vec3 uSeamCol;',
    'uniform vec2 uFocus; uniform float uTilt; uniform float uBloom; uniform float uExposure; uniform float uVig; uniform float uTime; uniform float uDim;',
    'varying vec2 vUv;',
    'vec3 RRTAndODTFit(vec3 v){ vec3 a = v * (v + 0.0245786) - 0.000090537; vec3 b = v * (0.983729 * v + 0.4329510) + 0.238081; return a / b; }',
    'vec3 aces(vec3 c){',
    '  const mat3 inM = mat3(vec3(0.59719, 0.07600, 0.02840), vec3(0.35458, 0.90834, 0.13383), vec3(0.04823, 0.01566, 0.83777));',
    '  const mat3 outM = mat3(vec3(1.60475, -0.10208, -0.00327), vec3(-0.53108, 1.10813, -0.07276), vec3(-0.07367, -0.00605, 1.07602));',
    '  c *= 1.0 / 0.6; c = inM * c; c = RRTAndODTFit(c); c = outM * c; return clamp(c, 0.0, 1.0);',
    '}',
    'vec3 toSRGB(vec3 c){ return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(vec3(0.0031308), c)); }',
    'float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }',
    'void main(){',
    '  float dy = max(max(uFocus.x - vUv.y, vUv.y - uFocus.y), 0.0);',
    '  float blur = smoothstep(0.0, 0.3, dy) * uTilt;',
    '  vec3 c = texture2D(tScene, vUv).rgb;',
    '  if (blur > 0.25) {',
    '    vec3 acc = c;',
    '    for (int i = 0; i < 8; i++) {',
    '      float fi = float(i);',
    '      float an = fi * 2.39996 + 0.7;',
    '      float rd = sqrt((fi + 0.5) / 8.0) * blur;',
    '      acc += texture2D(tScene, vUv + vec2(cos(an), sin(an)) * rd / uRes).rgb;',
    '    }',
    '    c = acc / 9.0;',
    '  }',
    '  c += texture2D(tBloom, vUv).rgb * uBloom;',
    '  c = aces(c * uExposure);',
    '  vec2 q = (vUv - 0.5) * vec2(1.0, 0.92);',
    '  c *= 1.0 - uVig * smoothstep(0.42, 1.0, length(q) * 1.42);',
    '  c = toSRGB(c);',
    '  c *= 1.0 - uDim;',
    '  float sd = abs(dot(gl_FragCoord.xy - 0.5 * uRes, uN));',
    '  float px = uRes.y / 900.0;',
    '  float shade = (1.0 - smoothstep(uLineW, uLineW + 16.0 * px, sd)) * uLineA;',
    '  c *= 1.0 - 0.38 * shade;',
    '  float core = (1.0 - smoothstep(uLineW - 1.2 * px, uLineW + 0.6 * px, sd)) * uLineA;',
    '  c = mix(c, vec3(0.085, 0.058, 0.046), core);',
    '  float thread = (1.0 - smoothstep(0.0, 1.3 * px, sd)) * uLineA;',
    '  c += uSeamCol * thread * (0.16 + 0.9 * uSeam);',
    '  c += uSeamCol * uSeam * 0.55 * exp(-sd / (26.0 * px));',
    '  c += (hash(gl_FragCoord.xy + fract(uTime) * 61.0) - 0.5) / 255.0;',
    '  gl_FragColor = vec4(c, 1.0);',
    '}'
  ].join('\n');

  HH.makeView = function (canvas, scene) {
    const renderer = new T.WebGLRenderer({ canvas, antialias: false, alpha: false, stencil: false, powerPreference: 'high-performance' });
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = T.PCFSoftShadowMap;
    renderer.toneMapping = T.NoToneMapping;
    renderer.setClearColor(HH.U.uVoidCol.value, 1);
    const gl2 = renderer.capabilities.isWebGL2;
    const texType = gl2 ? T.HalfFloatType : T.UnsignedByteType;

    /* camera basis: fixed elevated orthographic view, 45 degrees round, 42 degrees up */
    const ELEV = 42 * Math.PI / 180, ce = Math.cos(ELEV), se = Math.sin(ELEV);
    const camDir = new T.Vector3(ce * S, se, ce * S);
    const mkCam = () => { const c = new T.OrthographicCamera(-1, 1, 1, -1, 1, 220); c.up.set(0, 1, 0); return c; };
    const camA = mkCam(), camB = mkCam();

    /* light: a low golden sun and a soft sky. Both are "home" light: the materials fade them out in the forest. */
    const sunDir = new T.Vector3(-0.334, 0.559, 0.758).normalize();
    const sun = new T.DirectionalLight(new T.Color(0xffc58a).convertSRGBToLinear(), 2.05);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    const SHADOW_HALF = 19;
    Object.assign(sun.shadow.camera, { left: -SHADOW_HALF, right: SHADOW_HALF, top: SHADOW_HALF, bottom: -SHADOW_HALF, near: 1, far: 150 });
    sun.shadow.camera.updateProjectionMatrix();
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.035;
    scene.add(sun, sun.target);
    const hemi = new T.HemisphereLight(new T.Color(0xcbb4d2).convertSRGBToLinear(), new T.Color(0x8d7a48).convertSRGBToLinear(), 0.92);
    scene.add(hemi);
    const lr = new T.Vector3().crossVectors(new T.Vector3(0, 1, 0), sunDir).normalize();
    const lu = new T.Vector3().crossVectors(sunDir, lr).normalize();
    const texel = SHADOW_HALF * 2 / 2048;
    const _t = new T.Vector3();
    function placeSun(target) {
      // snap to shadow texels so shadows do not shimmer as the camera glides
      const a = target.dot(lr), b = target.dot(lu);
      _t.copy(target).addScaledVector(lr, Math.round(a / texel) * texel - a).addScaledVector(lu, Math.round(b / texel) * texel - b);
      sun.target.position.copy(_t);
      sun.position.copy(_t).addScaledVector(sunDir, 70);
      sun.target.updateMatrixWorld();
      sun.updateMatrixWorld();
    }

    /* render targets */
    let W = 2, H = 2, scale = 1;
    const rtOpts = (samples) => ({ type: texType, minFilter: T.LinearFilter, magFilter: T.LinearFilter, generateMipmaps: false, depthBuffer: samples !== undefined, samples: samples || 0 });
    const rtA = new T.WebGLRenderTarget(2, 2, rtOpts(gl2 ? 4 : 0));
    const rtB = new T.WebGLRenderTarget(2, 2, rtOpts(gl2 ? 4 : 0));
    const rtC = new T.WebGLRenderTarget(2, 2, rtOpts());
    const LEVELS = 4;
    const down = [], up = [];
    for (let i = 0; i < LEVELS; i++) { down.push(new T.WebGLRenderTarget(2, 2, rtOpts())); if (i < LEVELS - 1) up.push(new T.WebGLRenderTarget(2, 2, rtOpts())); }

    const fsScene = new T.Scene(), fsCam = new T.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const fsMesh = new T.Mesh(new T.PlaneGeometry(2, 2));
    fsMesh.frustumCulled = false;
    fsScene.add(fsMesh);
    const mk = (fs, uniforms) => new T.ShaderMaterial({ vertexShader: VS, fragmentShader: fs, uniforms, depthTest: false, depthWrite: false });
    const mComposite = mk(FS_COMPOSITE, { tA: { value: null }, tB: { value: null }, uRes: { value: new T.Vector2() }, uN: { value: new T.Vector2(1, 0) } });
    const mPre = mk(FS_PREFILTER, { tSrc: { value: null }, uTexel: { value: new T.Vector2() }, uThreshold: { value: 1.15 }, uKnee: { value: 0.45 }, uRes: { value: new T.Vector2() }, uN: { value: new T.Vector2(1, 0) }, uLineA: { value: 0 } });
    const mDown = mk(FS_DOWN, { tSrc: { value: null }, uTexel: { value: new T.Vector2() } });
    const mUp = mk(FS_UP, { tSrc: { value: null }, tAdd: { value: null }, uTexel: { value: new T.Vector2() }, uMix: { value: 1 } });
    const mFinal = mk(FS_FINAL, {
      tScene: { value: null }, tBloom: { value: null }, uRes: { value: new T.Vector2() }, uN: { value: new T.Vector2(1, 0) },
      uLineW: { value: 0 }, uLineA: { value: 0 }, uSeam: { value: 0 }, uSeamCol: { value: new T.Color(1.0, 0.62, 0.25) },
      uFocus: { value: new T.Vector2(0.3, 0.7) }, uTilt: { value: 2.4 }, uBloom: { value: 0.42 }, uExposure: { value: 1.0 },
      uVig: { value: 0.3 }, uTime: { value: 0 }, uDim: { value: 0 }
    });
    function pass(mat, target) { fsMesh.material = mat; renderer.setRenderTarget(target); renderer.render(fsScene, fsCam); }

    const view = {
      renderer, sun, hemi, camA, camB, final: mFinal.uniforms, pre: mPre.uniforms,
      vFar: 15, nearScale: 0.76, homeScale: 1.28,
      q: 0, split: false, lineVis: 0, seam: 0, homeBlend: 1, V: 12, pxPerUnit: 60,
      onSplit: null, onMerge: null, particles: null
    };

    const sA = { x: 0, z: 0 }, sB = { x: 0, z: 0 };
    let snapNext = true;
    const tA = new T.Vector3(), tB = new T.Vector3();
    const nrm = new T.Vector2(1, 0);
    let focusLo = 0.5, focusHi = 0.5;
    let aspect = 1;

    view.snap = function () { snapNext = true; };

    view.resize = function () {
      const cw = Math.max(2, canvas.clientWidth), ch = Math.max(2, canvas.clientHeight);
      const dpr = Math.min(window.devicePixelRatio || 1, 1.5) * scale;
      const w = Math.max(2, Math.round(cw * dpr)), h = Math.max(2, Math.round(ch * dpr));
      if (w === W && h === H) return;
      W = w; H = h; aspect = W / H;
      renderer.setPixelRatio(1);
      renderer.setSize(W, H, false);
      rtA.setSize(W, H); rtB.setSize(W, H); rtC.setSize(W, H);
      let lw = W, lh = H;
      for (let i = 0; i < LEVELS; i++) {
        lw = Math.max(2, Math.round(lw / 2)); lh = Math.max(2, Math.round(lh / 2));
        down[i].setSize(lw, lh);
        if (i < LEVELS - 1) up[i].setSize(lw, lh);
      }
    };

    /* dynamic resolution: if frames run long for a while, render fewer pixels rather than drop frames */
    let slowT = 0;
    view.govern = function (dt) {
      // only judge frames the browser is really trying to draw at full rate
      if (document.visibilityState !== 'visible' || !document.hasFocus() || dt > 0.1) { slowT = 0; return; }
      if (dt > 1 / 42) slowT += dt; else slowT = Math.max(0, slowT - dt * 0.5);
      if (slowT > 2.5 && scale > 0.62) { scale *= 0.85; slowT = 0; view.resize(); }
    };

    function setCam(cam, cx, cy, V) {
      // cx, cy: centre of the view in camera-plane units; back to a point on the ground
      const w = HH.uv2w(cx, -cy / se);
      cam.left = -V * aspect / 2; cam.right = V * aspect / 2; cam.top = V / 2; cam.bottom = -V / 2;
      cam.position.set(w.x + camDir.x * 90, camDir.y * 90, w.z + camDir.z * 90);
      cam.lookAt(w.x, 0, w.z);
      cam.updateProjectionMatrix();
      cam.updateMatrixWorld();
      return w;
    }

    view.update = function (dt, pA, pB, home) {
      if (snapNext) { sA.x = pA.x; sA.z = pA.z; sB.x = pB.x; sB.z = pB.z; view.homeBlend = home ? 1 : 0; snapNext = false; }
      const rate = 6.5;
      sA.x = damp(sA.x, pA.x, rate, dt); sA.z = damp(sA.z, pA.z, rate, dt);
      sB.x = damp(sB.x, pB.x, rate, dt); sB.z = damp(sB.z, pB.z, rate, dt);
      view.homeBlend = damp(view.homeBlend, home ? 1 : 0, 1.7, dt);

      const vFar = clamp(21 / aspect, view.vFar, view.vFar * 1.6); // narrow windows see a taller slice, within reason
      const vMax = vFar * lerp(1, view.homeScale, HH.easeInOut(view.homeBlend));
      const ax = (sA.x - sA.z) * S, ay = -(sA.x + sA.z) * S * se;
      const bx = (sB.x - sB.z) * S, by = -(sB.x + sB.z) * S * se;
      const dx = bx - ax, dy = by - ay;
      const halfW = vMax * aspect / 2, halfH = vMax / 2 * 0.94;
      const q = Math.hypot(dx / halfW, dy / halfH);
      view.q = q;
      let V, cAx, cAy, cBx, cBy;
      if (q <= 1) {
        V = lerp(vFar * view.nearScale, vMax, smooth(0.22, 1, q));
        cAx = cBx = (ax + bx) / 2; cAy = cBy = (ay + by) / 2;
      } else {
        V = vMax;
        const hx = dx / (2 * q), hy = dy / (2 * q);
        cAx = ax + hx; cAy = ay + hy; cBx = bx - hx; cBy = by - hy;
      }
      if (Math.hypot(dx, dy) > 0.01) nrm.set(dx, dy).normalize();
      if (view.inspect) { // close look at one player, for checking details only
        const px = view.inspect.who === 'B' ? bx : ax, py = view.inspect.who === 'B' ? by : ay;
        cAx = cBx = px; cAy = cBy = py + 0.5; V = view.inspect.V; view.q = 0;
      }
      view.V = V;
      view.pxPerUnit = H / V;
      const wA = setCam(camA, cAx, cAy, V); tA.set(wA.x, 0, wA.z);
      const wB = setCam(camB, cBx, cBy, V); tB.set(wB.x, 0, wB.z);

      const was = view.split;
      if (!view.split && q > 1.035) view.split = true;
      else if (view.split && q < 0.992) view.split = false;
      if (view.split !== was) { if (view.split) { if (view.onSplit) view.onSplit(); } else if (view.onMerge) view.onMerge(); }
      view.lineVis = view.inspect ? 0 : smooth(1.0, 1.1, q);
      view.seam = Math.max(0, view.seam - dt * 1.5);

      // focus band for the tilt-shift: keep both players sharp
      const yA = 0.5 + (ay + 0.45 - cAy) / V, yB = 0.5 + (by + 0.45 - cBy) / V;
      focusLo = Math.min(yA, yB) - 0.2; focusHi = Math.max(yA, yB) + 0.2;
    };

    view.pulseSeam = function (k) { view.seam = Math.max(view.seam, k); };

    /* scissor box for one side of the seam, so each split view only shades its own half */
    function sideBox(sign, rt) {
      const cx = W / 2, cy = H / 2, pts = [];
      const corners = [[0, 0], [W, 0], [W, H], [0, H]];
      for (let i = 0; i < 4; i++) {
        const a = corners[i], b = corners[(i + 1) % 4];
        const da = ((a[0] - cx) * nrm.x + (a[1] - cy) * nrm.y) * sign, db = ((b[0] - cx) * nrm.x + (b[1] - cy) * nrm.y) * sign;
        if (da >= 0) pts.push(a);
        if ((da < 0) !== (db < 0)) { const t = da / (da - db); pts.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]); }
      }
      let x0 = W, y0 = H, x1 = 0, y1 = 0;
      pts.forEach(p => { x0 = Math.min(x0, p[0]); y0 = Math.min(y0, p[1]); x1 = Math.max(x1, p[0]); y1 = Math.max(y1, p[1]); });
      x0 = clamp(Math.floor(x0) - 3, 0, W); y0 = clamp(Math.floor(y0) - 3, 0, H);
      x1 = clamp(Math.ceil(x1) + 3, 0, W); y1 = clamp(Math.ceil(y1) + 3, 0, H);
      rt.scissorTest = true;
      rt.scissor.set(x0, y0, Math.max(1, x1 - x0), Math.max(1, y1 - y0));
    }

    view.render = function (time) {
      const two = view.q > 1.0005;
      if (view.particles) view.particles.material.uniforms.uPx.value = view.pxPerUnit;
      placeSun(tA);
      if (two) sideBox(-1, rtA); else rtA.scissorTest = false;
      renderer.setRenderTarget(rtA);
      renderer.render(scene, camA);
      let src = rtA.texture;
      if (two) {
        placeSun(tB);
        sideBox(1, rtB);
        renderer.setRenderTarget(rtB);
        renderer.render(scene, camB);
        mComposite.uniforms.tA.value = rtA.texture; mComposite.uniforms.tB.value = rtB.texture;
        mComposite.uniforms.uRes.value.set(W, H); mComposite.uniforms.uN.value.copy(nrm);
        pass(mComposite, rtC);
        src = rtC.texture;
      }
      // bloom: bright things only, blurred down and back up
      mPre.uniforms.tSrc.value = src; mPre.uniforms.uTexel.value.set(1 / W, 1 / H);
      mPre.uniforms.uRes.value.set(W, H); mPre.uniforms.uN.value.copy(nrm); mPre.uniforms.uLineA.value = view.lineVis;
      pass(mPre, down[0]);
      for (let i = 1; i < LEVELS; i++) {
        mDown.uniforms.tSrc.value = down[i - 1].texture;
        mDown.uniforms.uTexel.value.set(1 / down[i - 1].width, 1 / down[i - 1].height);
        pass(mDown, down[i]);
      }
      let cur = down[LEVELS - 1];
      for (let i = LEVELS - 2; i >= 0; i--) {
        mUp.uniforms.tSrc.value = cur.texture; mUp.uniforms.tAdd.value = down[i].texture;
        mUp.uniforms.uTexel.value.set(1 / cur.width, 1 / cur.height);
        pass(mUp, up[i]);
        cur = up[i];
      }
      const f = mFinal.uniforms;
      f.tScene.value = src; f.tBloom.value = cur.texture;
      f.uRes.value.set(W, H); f.uN.value.copy(nrm);
      const px = H / 900;
      f.uLineW.value = 3.2 * px * view.lineVis;
      f.uLineA.value = view.lineVis;
      f.uSeam.value = view.seam;
      f.uFocus.value.set(focusLo, focusHi);
      f.uTime.value = time;
      pass(mFinal, null);
    };

    /* where a world point lands on screen (0..1, y up), for the given side's camera */
    const _p = new T.Vector3();
    view.project = function (v, which) {
      _p.copy(v).project(which === 'B' ? camB : camA);
      return { x: _p.x * 0.5 + 0.5, y: _p.y * 0.5 + 0.5 };
    };
    view.size = () => ({ w: W, h: H, scale });
    return view;
  };
})();
