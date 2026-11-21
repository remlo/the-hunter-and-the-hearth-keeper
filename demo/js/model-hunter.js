/* model-hunter.js: trial. Shows the Hunter built in Blender (assets/hunter.glb) instead of the code-built one.
   Only active when the address contains #model. Without it this file returns at once and changes nothing.
   The code-built Hunter stays in place: its groups, pivots and animation keep running. The Blender parts are
   hung on those same groups (head, arms, legs, body), the code-built meshes they replace are hidden, and every
   part gets the demo's own lit material so the hearth, the lantern and the gloom treat it like the rest of the world.
   If the loader or the file fails, one console.warn is written and the code-built Hunter is left alone. */
(function () {
  'use strict';
  if (String(location.hash).indexOf('model') < 0) return;

  const T = THREE, HH = window.HH;
  const LOADER_URL = 'https://cdn.jsdelivr.net/npm/three@0.147.0/examples/js/loaders/GLTFLoader.js';
  const GLB_URL = 'assets/hunter.glb';

  // Which demo group each Blender object hangs on. Blender's +X (the _L objects) is the demo's +X group.
  const BODY = ['Body', 'Vest', 'TunicHem', 'Pauldrons', 'Strap', 'Belt', 'Buckle', 'Scarf', 'Pack', 'Bedroll', 'Sword'];
  const HEAD = ['Head', 'Hair'];
  const EYES = ['Eyes'];
  const ARM = ['Arm', 'Hand', 'Sleeve', 'Bracer'];
  const LEG = ['Leg', 'Trouser', 'Boot'];
  // 'Lantern' is deliberately left out: the demo's own lantern (and its glass) stays.

  let gltf = null, done = false, warned = false;
  function warn(why) {
    if (warned) return;
    warned = true; done = true;
    console.warn('model-hunter: could not show the Blender Hunter, keeping the code-built one (' + (why && why.message || why) + ')');
  }

  /* the object name a mesh belongs to, e.g. "Sleeve_L" for the mesh of any of its material slots */
  function objectName(mesh) {
    const known = /^(Body|Head|Hair|Eyes|Vest|TunicHem|Pauldrons|Strap|Belt|Buckle|Scarf|Pack|Bedroll|Sword|Lantern|(?:Arm|Hand|Sleeve|Bracer|Leg|Trouser|Boot)_[LR])/;
    for (let o = mesh; o; o = o.parent) {
      const m = known.exec(o.name || '');
      if (m) return m[1];
    }
    return '';
  }

  /* position of a group's pivot in the rig's frame (the rig itself sits at the feet) */
  function pivotInRig(g, rig) {
    const p = new T.Vector3();
    for (let o = g; o && o !== rig; o = o.parent) p.add(o.position);
    return p;
  }

  function install() {
    const hunter = window.game.ctx.hunter, rig = hunter.rig;
    const pieces = [];   // { name, geo (in the glTF's own frame), rgb }
    gltf.scene.updateMatrixWorld(true);
    gltf.scene.traverse(o => {
      if (!o.isMesh) return;
      const name = objectName(o);
      if (!name || name === 'Lantern') return;
      const geo = o.geometry.clone();
      geo.applyMatrix4(o.matrixWorld);
      pieces.push({ name, geo, color: o.material.color.clone() });
    });
    if (!pieces.length) throw new Error('no meshes found in ' + GLB_URL);

    // same height as the code-built Hunter: the top of its hair, measured before anything is hidden
    rig.updateMatrixWorld(true);
    const codeTop = new T.Box3().setFromObject(hunter.head.children[0]).max.y - rig.position.y;
    let modelTop = -Infinity;
    pieces.forEach(p => { p.geo.computeBoundingBox(); modelTop = Math.max(modelTop, p.geo.boundingBox.max.y); });
    const S = codeTop / modelTop;

    // where each group's pivot is, then which group a piece goes to
    const groups = {
      body: hunter.torso, head: hunter.head, eyes: hunter.eyes,
      legP: hunter.legR, legN: hunter.legL, armP: hunter.armR, armN: hunter.armL
    };
    const piv = {};
    for (const k in groups) piv[k] = pivotInRig(groups[k], rig);
    function target(name, geo) {
      if (BODY.indexOf(name) >= 0) return 'body';
      if (HEAD.indexOf(name) >= 0) return 'head';
      if (EYES.indexOf(name) >= 0) return 'eyes';
      const base = name.split('_')[0];
      geo.computeBoundingBox();
      const cx = (geo.boundingBox.min.x + geo.boundingBox.max.x) / 2;
      const side = cx >= 0 ? 'P' : 'N';
      if (ARM.indexOf(base) >= 0) return 'arm' + side;
      if (LEG.indexOf(base) >= 0) return 'leg' + side;
      return null;
    }

    // hide the code-built meshes the Blender parts replace (each group's first child is its built part)
    const hide = g => { if (g.children[0]) g.children[0].visible = false; };
    [hunter.torso, hunter.head, hunter.legL, hunter.legR, hunter.armL, hunter.armR].forEach(hide);
    hunter.eyes.children.forEach(m => { m.visible = false; });

    // one merged mesh per group and colour, lit by the demo's own material
    const buckets = {}, mats = {};
    const m4 = new T.Matrix4();
    pieces.forEach(p => {
      const t = target(p.name, p.geo);
      if (!t) return;
      const key = t + '|' + p.color.getHexString();
      const b = buckets[key] || (buckets[key] = { t, color: p.color, pos: [], nor: [] });
      m4.makeTranslation(-piv[t].x, -piv[t].y, -piv[t].z).multiply(new T.Matrix4().makeScale(S, S, S));
      const g = p.geo;
      g.applyMatrix4(m4);
      const pa = g.attributes.position, na = g.attributes.normal, ix = g.index;
      const n = ix ? ix.count : pa.count;
      for (let i = 0; i < n; i++) {
        const k = ix ? ix.getX(i) : i;
        b.pos.push(pa.getX(k), pa.getY(k), pa.getZ(k));
        b.nor.push(na.getX(k), na.getY(k), na.getZ(k));
      }
      g.dispose();
    });
    const added = [];
    for (const key in buckets) {
      const b = buckets[key];
      const geo = new T.BufferGeometry();
      geo.setAttribute('position', new T.Float32BufferAttribute(b.pos, 3));
      geo.setAttribute('normal', new T.Float32BufferAttribute(b.nor, 3));
      geo.computeBoundingSphere();
      const hex = b.color.getHexString();
      const mat = mats[hex] || (mats[hex] = HH.lit({ color: b.color }));
      const mesh = new T.Mesh(geo, mat);
      mesh.castShadow = true; mesh.receiveShadow = true;
      mesh.name = 'blender-' + key;
      groups[b.t].add(mesh);
      added.push(mesh);
    }
    HH.modelHunter = { scale: S, meshes: added };
    done = true;
  }

  function tryInstall() {
    if (done || !gltf) return;
    if (!(window.game && window.game.ctx && window.game.ctx.hunter)) return;
    try { install(); } catch (e) { warn(e); }
  }

  const s = document.createElement('script');
  s.src = LOADER_URL;
  s.onerror = () => warn('GLTFLoader script did not load');
  s.onload = () => {
    try {
      new T.GLTFLoader().load(GLB_URL, g => { gltf = g; tryInstall(); }, undefined, e => warn(e));
    } catch (e) { warn(e); }
  };
  (document.head || document.documentElement).appendChild(s);

  // the game object only exists once the game has started
  const timer = setInterval(() => { if (done) clearInterval(timer); else tryInstall(); }, 150);
})();
