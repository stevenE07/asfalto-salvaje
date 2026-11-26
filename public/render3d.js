// Asfalto Salvaje — render 3D (Three.js): vista aérea en perspectiva.
// El mundo 2D de la simulación (x, y) se mapea a 3D como (x, altura, y).
import * as THREE from '/vendor/three/three.module.js';

const { ROAD, CURB, WALL } = window.Tracks;
const { F, VIEW_W, VIEW_H } = window.Common;
const TAU = Math.PI * 2;
const TILT = 1.08;            // inclinación de la cámara sobre el piso (~62°)
const FOV = 42;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

let renderer, scene, camera, hemi, sun;
let cssW = 1, cssH = 1, dpr = 1, dRef = 4000;
let worldRoot = null;
let night = false;
const fogC = new THREE.Color(0x14121f);
const pv = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

// ------------------------------------------------------------------ geometrías
const geoCache = new Map();
const shared = new Set();
function geo(spec) {
  const key = spec.join('|');
  if (geoCache.has(key)) return geoCache.get(key);
  const [k, a, b, c, d] = spec;
  let g;
  if (k === 'box') g = new THREE.BoxGeometry(a, b, c);
  else if (k === 'sph') g = new THREE.SphereGeometry(a, b || 12, c || 8);
  else if (k === 'cyl') g = new THREE.CylinderGeometry(a, b, c, d || 10);
  else if (k === 'cone') g = new THREE.ConeGeometry(a, b, c || 10, 1, true);
  else if (k === 'ico') g = new THREE.IcosahedronGeometry(a, b || 0);
  else if (k === 'dod') g = new THREE.DodecahedronGeometry(a);
  else if (k === 'circ') g = new THREE.CircleGeometry(a, b || 28).rotateX(-Math.PI / 2);
  else if (k === 'ring') g = new THREE.RingGeometry(a, b, c || 56).rotateX(-Math.PI / 2);
  else if (k === 'plane') g = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
  else g = new THREE.BoxGeometry(1, 1, 1);
  geoCache.set(key, g);
  shared.add(g);
  return g;
}
const lam = (o) => new THREE.MeshLambertMaterial(o);
const bas = (o) => new THREE.MeshBasicMaterial(o);
const mesh = (spec, mat) => new THREE.Mesh(geo(spec), mat);

function groundTexture(th) {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 128;
  const c = cv.getContext('2d');
  c.fillStyle = th.ground; c.fillRect(0, 0, 128, 128);
  let s = 99;
  const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  for (let i = 0; i < 90; i++) {
    c.fillStyle = th.dots[Math.floor(rnd() * th.dots.length)];
    c.beginPath(); c.arc(rnd() * 128, rnd() * 128, 2 + rnd() * 7, 0, TAU); c.fill();
  }
  const t = new THREE.CanvasTexture(cv);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function crateTexture() {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 96;
  const c = cv.getContext('2d');
  const g = c.createLinearGradient(0, 0, 96, 96);
  g.addColorStop(0, '#ffe066'); g.addColorStop(1, '#ff7a1a');
  c.fillStyle = g; c.fillRect(0, 0, 96, 96);
  c.strokeStyle = '#fff'; c.lineWidth = 7; c.strokeRect(4, 4, 88, 88);
  c.fillStyle = '#fff'; c.font = 'bold 70px "Rubik", system-ui, sans-serif';
  c.textAlign = 'center'; c.textBaseline = 'middle';
  c.fillText('?', 48, 54);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// ------------------------------------------------------------------ cintas planas
// Colores CSS con alfa (rgba) -> color + opacidad
function cssCol(c) {
  const m = typeof c === 'string' && c.match(/^rgba?\(([^)]+)\)$/i);
  if (m) {
    const p = m[1].split(',').map((s) => parseFloat(s));
    return { color: new THREE.Color(`rgb(${p[0] | 0},${p[1] | 0},${p[2] | 0})`), opacity: p.length > 3 ? p[3] : 1 };
  }
  return { color: new THREE.Color(c || '#ffffff'), opacity: 1 };
}

// Agrega un quad plano (4 esquinas en el piso) con el giro correcto para que
// la cara mire hacia arriba.
function pushQuad(pos, idx, h, c0, c1, c2, c3) {
  const base = pos.length / 3;
  const up = (c1[1] - c0[1]) * (c2[0] - c0[0]) - (c1[0] - c0[0]) * (c2[1] - c0[1]);
  const q = up > 0 ? [c0, c1, c2, c3] : [c0, c3, c2, c1];
  for (const c of q) pos.push(c[0], h, c[1]);
  idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
}

function flatGeometry(pos, idx, colors) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  const nrm = new Float32Array(pos.length);
  for (let i = 1; i < nrm.length; i += 3) nrm[i] = 1;
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  if (colors) g.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  g.setIndex(idx);
  return g;
}

// Tira de quads entre dos distancias laterales respecto de la línea central.
function ribbon(T, d0, d1, h, color, onAt) {
  const N = T.N, pos = [], idx = [];
  const px = (i, d) => [T.xs[i] - T.ty[i] * d, T.ys[i] + T.tx[i] * d];
  for (let i = 0; i < N; i++) {
    if (onAt && !onAt(i)) continue;
    const j = (i + 1) % N;
    pushQuad(pos, idx, h, px(i, d0), px(i, d1), px(j, d1), px(j, d0));
  }
  const cc = cssCol(color);
  const m = new THREE.Mesh(flatGeometry(pos, idx), lam({
    color: cc.color, transparent: cc.opacity < 1, opacity: cc.opacity, depthWrite: cc.opacity >= 1,
  }));
  m.matrixAutoUpdate = false;
  return m;
}

// Cajas repetidas a lo largo de la pista (cordones y muros)
function stripBoxes(T, dists, every, grow, hgt, depth, y, colors, basic) {
  const N = T.N;
  const n = Math.ceil(N / every) * dists.length;
  const mat = basic ? bas({ color: 0xffffff }) : lam({ color: 0xffffff });
  const im = new THREE.InstancedMesh(geo(['box', 1, 1, 1]), mat, n);
  const mx = new THREE.Matrix4(), q = new THREE.Quaternion(), v = new THREE.Vector3(), sc = new THREE.Vector3();
  const col = new THREE.Color();
  let k = 0;
  for (let si = 0; si < dists.length; si++) {
    const d = dists[si];
    for (let i = 0; i < N; i += every) {
      const j = (i + every) % N;
      const ax = T.xs[i] - T.ty[i] * d, ay = T.ys[i] + T.tx[i] * d;
      const bx = T.xs[j] - T.ty[j] * d, by = T.ys[j] + T.tx[j] * d;
      const len = Math.hypot(bx - ax, by - ay) + grow;
      q.setFromAxisAngle(UP, -Math.atan2(by - ay, bx - ax));
      v.set((ax + bx) / 2, y, (ay + by) / 2);
      sc.set(len, hgt, depth);
      mx.compose(v, q, sc);
      im.setMatrixAt(k, mx);
      col.set(colors[(Math.floor(i / every) + si) % colors.length]);
      im.setColorAt(k, col);
      k++;
    }
  }
  im.count = k;
  im.instanceMatrix.needsUpdate = true;
  if (im.instanceColor) im.instanceColor.needsUpdate = true;
  return im;
}

// ------------------------------------------------------------------ decorados
const MODELS = {
  tree: [{ g: ['cyl', 5, 7, 28, 7], c: 0x6b4a2a, y: 14 }, { g: ['sph', 30, 10, 8], c: 0x2f7d2c, y: 50, s: [1, 1.1, 1] }, { g: ['sph', 19, 8, 6], c: 0x3b9238, y: 70 }],
  bush: [{ g: ['sph', 17, 8, 6], c: 0x3c8a33, y: 12, s: [1.5, 0.9, 1.3] }],
  flowers: [{ g: ['sph', 9, 7, 5], c: 0xff6b9a, y: 5, s: [1.6, 0.4, 1.6] }],
  cactus: [{ g: ['cyl', 13, 15, 58, 10], c: 0x3f8f4a, y: 29 }, { g: ['sph', 13, 8, 6], c: 0x4a9c55, y: 58 }],
  rock: [{ g: ['dod', 26], c: 0x9a765a, y: 15, s: [1.1, 0.8, 1] }],
  skull: [{ g: ['sph', 15, 8, 6], c: 0xe8e2d0, y: 11 }],
  pine: [{ g: ['cyl', 6, 8, 22, 6], c: 0x5a4030, y: 11 }, { g: ['cone', 30, 80, 9], c: 0x2f5d46, y: 58 }],
  ice: [{ g: ['ico', 24, 0], c: 0xa9d8f2, y: 17, s: [1, 1.3, 1] }],
  snowman: [{ g: ['sph', 22, 10, 8], c: 0xfdfdff, y: 21 }, { g: ['sph', 14, 10, 8], c: 0xf0f6ff, y: 50 }],
  building: [{ g: ['box', 1, 1, 1], c: 0x120e22, y: 0.5, bld: 1 }, { g: ['box', 1.03, 0.07, 1.03], c: 0xff3fd2, y: 0.74, bld: 1, basic: 1 }],
  lamp: [{ g: ['cyl', 3, 4, 96, 6], c: 0x2a2440, y: 48 }, { g: ['sph', 10, 10, 8], c: 0xffe9a8, y: 100, basic: 1 }],
};
const NEON = [0xff3fd2, 0x3ff0ff, 0xffe14d];
const TINT = [1, 0.9, 1.1];

function buildDecor(list, root) {
  const byType = new Map();
  for (const d of list) {
    if (!MODELS[d.type]) continue;
    if (!byType.has(d.type)) byType.set(d.type, []);
    byType.get(d.type).push(d);
  }
  const mx = new THREE.Matrix4(), q = new THREE.Quaternion(), v = new THREE.Vector3(), sc = new THREE.Vector3();
  const col = new THREE.Color();
  for (const [type, items] of byType) {
    for (const part of MODELS[type]) {
      const mat = part.basic ? bas({ color: 0xffffff }) : lam({ color: 0xffffff });
      const im = new THREE.InstancedMesh(geo(part.g), mat, items.length);
      items.forEach((d, i) => {
        const ps = part.s || [1, 1, 1];
        let y = part.y, s0 = d.s, s1 = d.s, s2 = d.s;
        if (part.bld) {
          const w = 90 * d.s + 44, h = 150 * d.s + 130;
          s0 = w; s1 = h; s2 = w; y = part.y * h;
        } else y *= d.s;
        q.setFromAxisAngle(UP, d.r);
        v.set(d.x, y, d.y);
        sc.set(s0 * ps[0], s1 * ps[1], s2 * ps[2]);
        mx.compose(v, q, sc);
        im.setMatrixAt(i, mx);
        if (part.bld && part.basic) col.set(NEON[d.c % 3]);
        else col.set(part.c).multiplyScalar(TINT[d.c % 3]);
        im.setColorAt(i, col);
      });
      im.instanceMatrix.needsUpdate = true;
      if (im.instanceColor) im.instanceColor.needsUpdate = true;
      root.add(im);
    }
  }
}

// ------------------------------------------------------------------ escena estática
function buildTrackScene(T, decor) {
  const root = new THREE.Group();
  const th = T.theme, b = T.bounds, pad = 3000;
  const gw = b.maxX - b.minX + pad * 2, gh = b.maxY - b.minY + pad * 2;
  const tex = groundTexture(th);
  tex.repeat.set(gw / 340, gh / 340);
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(gw, gh), lam({ map: tex }));
  ground.rotation.x = -Math.PI / 2;
  ground.position.set((b.minX + b.maxX) / 2, -1, (b.minY + b.maxY) / 2);
  root.add(ground);

  root.add(ribbon(T, -(WALL + 10), WALL + 10, 0.4, th.runoff));
  root.add(ribbon(T, -(ROAD + CURB), ROAD + CURB, 1.0, th.road));
  root.add(ribbon(T, -(ROAD - 14), -(ROAD - 10), 1.5, th.edge || '#ffffff'));
  root.add(ribbon(T, ROAD - 14, ROAD - 10, 1.5, th.edge || '#ffffff'));
  root.add(ribbon(T, -3, 3, 1.5, th.line || '#ffffff', (i) => Math.floor(i / 3) % 2 === 0));
  root.add(stripBoxes(T, [-(ROAD + CURB / 2), ROAD + CURB / 2], 1, 1, 4, CURB, 2, [th.curbA || '#d8333a', th.curbB || '#f5f5f5']));
  root.add(stripBoxes(T, [-(WALL + 8), WALL + 8], 3, 2, 58, 16, 29, [th.wallA, th.wallB], !!th.night));

  // línea de largada
  const i0 = T.startIdx;
  const ux = T.tx[i0], uy = T.ty[i0], nx = -uy, ny = ux;
  const sq = (ROAD * 2) / 12, pos = [], col = [], idx = [];
  const c = new THREE.Color();
  const wp = (lx, ly) => [T.xs[i0] + ux * lx + nx * ly, T.ys[i0] + uy * lx + ny * ly];
  for (let r = 0; r < 2; r++) for (let k = 0; k < 12; k++) {
    const x0 = -sq + r * sq, y0 = -ROAD + k * sq;
    pushQuad(pos, idx, 1.6, wp(x0, y0), wp(x0 + sq, y0), wp(x0 + sq, y0 + sq), wp(x0, y0 + sq));
    c.set((r + k) % 2 ? 0x15161a : 0xfafafa);
    for (let q = 0; q < 4; q++) col.push(c.r, c.g, c.b);
  }
  root.add(new THREE.Mesh(flatGeometry(pos, idx, col), lam({ vertexColors: true })));

  if (decor) buildDecor(decor, root);
  return root;
}

function buildArenaScene(A) {
  const root = new THREE.Group();
  const th = A.theme;
  const tex = groundTexture(th);
  tex.repeat.set(A.w / 300, A.h / 300);
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(A.w, A.h), lam({ map: tex }));
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(A.w / 2, 0, A.h / 2);
  root.add(floor);
  const outer = new THREE.Mesh(new THREE.PlaneGeometry(A.w + 9000, A.h + 9000), lam({ color: 0x191a1e }));
  outer.rotation.x = -Math.PI / 2;
  outer.position.set(A.w / 2, -8, A.h / 2);
  root.add(outer);

  const wallMat = lam({ color: 0x2a2c31 }), topMat = lam({ color: th.wallA });
  for (const [x, z, w, d] of [[A.w / 2, -24, A.w + 96, 48], [A.w / 2, A.h + 24, A.w + 96, 48], [-24, A.h / 2, 48, A.h + 96], [A.w + 24, A.h / 2, 48, A.h + 96]]) {
    const m = mesh(['box', w, 86, d], wallMat);
    m.position.set(x, 43, z); root.add(m);
    const t = mesh(['box', w + 6, 10, d + 6], topMat);
    t.position.set(x, 90, z); root.add(t);
  }
  const pMat = lam({ color: 0x24262b }), rimMat = lam({ color: th.wallA });
  for (const k of A.circles) {
    const m = mesh(['cyl', k.r, k.r, 74, 24], pMat);
    m.position.set(k.x, 37, k.y); root.add(m);
    const r = mesh(['cyl', k.r + 4, k.r + 4, 9, 24], rimMat);
    r.position.set(k.x, 76, k.y); root.add(r);
  }
  const cols = [0xb5452f, 0x2f6db5, 0x3f8f4a];
  A.rects.forEach((q, i) => {
    const m = mesh(['box', q.w, 58, q.h], lam({ color: cols[i % 3] }));
    m.position.set(q.x + q.w / 2, 29, q.y + q.h / 2);
    root.add(m);
  });
  return root;
}

function disposeTree(obj) {
  obj.traverse((o) => {
    if (o.geometry && !shared.has(o.geometry)) o.geometry.dispose();
    if (o.material) {
      for (const m of (Array.isArray(o.material) ? o.material : [o.material])) {
        if (m.map) m.map.dispose();
        m.dispose();
      }
    }
  });
}

function applyTheme(th) {
  night = !!th.night;
  const g = new THREE.Color(th.ground);
  if (night) fogC.set(0x0b0916); else fogC.copy(g).lerp(new THREE.Color(0xffffff), 0.3);
  scene.fog.color.copy(fogC);
  renderer.setClearColor(fogC);
  hemi.color.set(night ? 0x8899dd : 0xffffff);
  hemi.groundColor.set(night ? 0x14112a : g.getHex());
  hemi.intensity = night ? 1.1 : 2.1;
  sun.intensity = night ? 0.5 : 1.7;
  sun.color.set(night ? 0x9fb0ff : 0xfff3df);
}

// ------------------------------------------------------------------ objetos dinámicos
let dyn, carsGroup, zoneGroup, safeRing, skidMesh, skidGeo;
let pFire, pSmoke, crateTex;
const carObjs = new Map();
const pools = {};

function Pool(factory) {
  const items = [];
  let used = 0;
  return {
    get() {
      if (used >= items.length) { const o = factory(); items.push(o); dyn.add(o); }
      const o = items[used++];
      o.visible = true;
      return o;
    },
    begin() { used = 0; },
    end() { for (let i = used; i < items.length; i++) items[i].visible = false; },
  };
}

function makeCar() {
  const g = new THREE.Group();
  const body = lam({ color: 0xffffff }), dark = lam({ color: 0x24262c });
  const u = {};
  u.shadow = mesh(['circ', 28], bas({ color: 0x000000, transparent: true, opacity: 0.26, depthWrite: false }));
  u.shadow.position.y = 0.9;
  u.body = mesh(['box', 48, 13, 26], body);
  u.body.position.y = 12;
  u.nose = mesh(['box', 8, 8, 22], body);
  u.nose.position.set(23, 8.5, 0);
  u.stripe = mesh(['box', 40, 1.5, 6], bas({ color: 0xffffff }));
  u.stripe.position.y = 19;
  u.cabin = mesh(['box', 20, 12, 20], lam({ color: 0x1c2633 }));
  u.cabin.position.set(-2, 24, 0);
  u.glass = mesh(['box', 3, 8, 17], lam({ color: 0x9fd0ff, transparent: true, opacity: 0.65 }));
  u.glass.position.set(8.6, 24, 0);
  u.spoiler = mesh(['box', 5, 10, 27], dark);
  u.spoiler.position.set(-24, 23, 0);
  const tire = lam({ color: 0x16171a });
  u.wheels = [];
  for (const [x, z] of [[15, 13], [15, -13], [-15, 13], [-15, -13]]) {
    const w = new THREE.Group();
    const m = mesh(['cyl', 8, 8, 9, 12], tire);
    m.rotation.x = Math.PI / 2;
    w.add(m);
    w.position.set(x, 8, z);
    g.add(w);
    u.wheels.push(w);
  }
  u.head = bas({ color: 0xfff6c4 });
  u.brakeMat = bas({ color: 0x5a1010 });
  for (const z of [8, -8]) {
    const h = mesh(['box', 2.5, 4, 6], u.head);
    h.position.set(24.6, 13.5, z);
    g.add(h);
    const b = mesh(['box', 2.5, 4, 6], u.brakeMat);
    b.position.set(-25.6, 13.5, z);
    g.add(b);
  }
  u.flame = mesh(['cone', 8, 26, 10], bas({ color: 0xffa02a, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false }));
  u.flame.rotation.z = Math.PI / 2;
  u.flame.position.set(-39, 11, 0);
  u.beam = mesh(['cone', 95, 320, 14], bas({ color: 0xfff0b4, transparent: true, opacity: 0.07, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
  u.beam.rotation.z = -Math.PI / 2;
  u.beam.position.set(185, 14, 0);
  u.shield = mesh(['sph', 36, 18, 12], bas({ color: 0x78f0ff, transparent: true, opacity: 0.3, blending: THREE.AdditiveBlending, depthWrite: false }));
  u.shield.position.y = 16;
  u.warn = mesh(['ring', 32, 40], bas({ color: 0xff3232, transparent: true, opacity: 0.8, depthWrite: false }));
  u.warn.position.y = 2.4;
  u.mine = mesh(['ring', 38, 45], bas({ color: 0xffffff, transparent: true, opacity: 0.85, depthWrite: false }));
  u.mine.position.y = 2.6;
  u.spin = new THREE.Group();
  const starMat = bas({ color: 0xffe14d });
  for (let i = 0; i < 3; i++) {
    const s = mesh(['sph', 5, 8, 6], starMat);
    s.position.set(Math.cos((i * TAU) / 3) * 30, 0, Math.sin((i * TAU) / 3) * 30);
    u.spin.add(s);
  }
  u.spin.position.y = 44;
  for (const k of ['shadow', 'body', 'nose', 'stripe', 'cabin', 'glass', 'spoiler', 'flame', 'beam', 'shield', 'warn', 'mine', 'spin']) g.add(u[k]);
  g.userData = u;
  return g;
}

function updateCar(g, c, time, isMe) {
  const u = g.userData;
  g.position.set(c.x, 0, c.y);
  g.rotation.y = -c.a;
  g.visible = true;
  const flash = (c.f & F.FLASH) && Math.floor(time * 20) % 2 === 0;
  u.body.material.color.set(flash ? '#ffffff' : c.color.hex);
  u.spoiler.material.color.set(c.color.dark);
  const st = -c.steer * 0.5;
  u.wheels[0].rotation.y = st; u.wheels[1].rotation.y = st;
  u.brakeMat.color.set(c.f & F.BRAKE ? '#ff2a2a' : '#5a1010');
  const turbo = !!(c.f & F.TURBO);
  u.flame.visible = turbo;
  if (turbo) {
    const k = 0.8 + Math.random() * 0.5;
    u.flame.scale.set(k, 1 + Math.random() * 0.4, k);
  }
  u.beam.visible = night;
  const sh = !!(c.f & F.SHIELD);
  u.shield.visible = sh;
  if (sh) {
    const a = c.f & F.SHIELD_LOW ? 0.16 + 0.18 * Math.sin(time * 30) : 0.3;
    u.shield.material.opacity = a;
    const k = 1 + Math.sin(time * 8) * 0.04;
    u.shield.scale.set(k, k, k);
  }
  u.warn.visible = !!(c.f & F.WARN);
  if (u.warn.visible) u.warn.material.opacity = 0.45 + 0.45 * Math.sin(time * 18);
  u.spin.visible = !!(c.f & F.SPIN);
  if (u.spin.visible) u.spin.rotation.y = time * 6;
  u.mine.visible = isMe;
  if (isMe) {
    const k = 1 + Math.sin(time * 5) * 0.05;
    u.mine.scale.set(k, 1, k);
  }
}

function makeCrate() {
  const g = new THREE.Group();
  const box = mesh(['box', 32, 32, 32], lam({ map: crateTex }));
  box.position.y = 26;
  const glow = mesh(['circ', 34], bas({ color: 0xffc828, transparent: true, opacity: 0.25, depthWrite: false, blending: THREE.AdditiveBlending }));
  glow.position.y = 1.2;
  g.add(box, glow);
  g.userData = { box };
  return g;
}

function makeMine() {
  const g = new THREE.Group();
  const ball = mesh(['sph', 13, 12, 8], lam({ color: 0x3a3a40 }));
  ball.position.y = 10;
  const spikeMat = lam({ color: 0x2a2a2e });
  for (let i = 0; i < 6; i++) {
    const s = mesh(['cyl', 2, 3, 16, 5], spikeMat);
    const a = (i / 6) * TAU;
    s.position.set(Math.cos(a) * 14, 10, Math.sin(a) * 14);
    s.rotation.z = Math.PI / 2;
    s.rotation.y = -a;
    g.add(s);
  }
  const led = mesh(['sph', 5, 10, 7], bas({ color: 0xff3030 }));
  led.position.y = 24;
  g.add(ball, led);
  g.userData = { led };
  return g;
}

function makeOil() {
  const m = mesh(['circ', 1, 20], bas({ color: 0x0d0d10, transparent: true, opacity: 0.9, depthWrite: false }));
  m.position.y = 0.8;
  return m;
}

function makeMissile() {
  const g = new THREE.Group();
  const body = mesh(['cyl', 5, 5, 26, 10], lam({ color: 0xeeeeee }));
  body.rotation.z = Math.PI / 2;
  const tip = mesh(['cone', 5, 12, 10], lam({ color: 0xe8383d }));
  tip.rotation.z = -Math.PI / 2;
  tip.position.x = 18;
  const fire = mesh(['cone', 5, 20, 8], bas({ color: 0xffa02a, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false }));
  fire.rotation.z = Math.PI / 2;
  fire.position.x = -22;
  g.add(body, tip, fire);
  g.position.y = 14;
  g.userData = { fire };
  return g;
}

function makeWave() {
  const m = mesh(['ring', 0.88, 1, 64], bas({ color: 0xa0dcff, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
  m.position.y = 10;
  return m;
}

// ------------------------------------------------------------------ partículas
const P_MAX = 1600;
function makePoints(blending) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(P_MAX * 3), 3));
  g.setAttribute('pcolor', new THREE.BufferAttribute(new Float32Array(P_MAX * 3), 3));
  g.setAttribute('psize', new THREE.BufferAttribute(new Float32Array(P_MAX), 1));
  g.setAttribute('palpha', new THREE.BufferAttribute(new Float32Array(P_MAX), 1));
  g.setDrawRange(0, 0);
  const m = new THREE.ShaderMaterial({
    uniforms: { uScale: { value: 600 } },
    vertexShader: [
      'attribute vec3 pcolor;',
      'attribute float psize;',
      'attribute float palpha;',
      'uniform float uScale;',
      'varying vec3 vC;',
      'varying float vA;',
      'void main() {',
      '  vC = pcolor; vA = palpha;',
      '  vec4 mv = modelViewMatrix * vec4(position, 1.0);',
      '  gl_PointSize = clamp(psize * uScale / max(1.0, -mv.z), 1.0, 500.0);',
      '  gl_Position = projectionMatrix * mv;',
      '}',
    ].join('\n'),
    fragmentShader: [
      'varying vec3 vC;',
      'varying float vA;',
      'void main() {',
      '  vec2 d = gl_PointCoord - vec2(0.5);',
      '  float r = length(d);',
      '  if (r > 0.5) discard;',
      '  gl_FragColor = vec4(vC, vA * smoothstep(0.5, 0.18, r));',
      '}',
    ].join('\n'),
    transparent: true, depthWrite: false, blending,
  });
  const p = new THREE.Points(g, m);
  p.frustumCulled = false;
  return p;
}

const tmpCol = new THREE.Color();
function updateParticles(S) {
  const sets = [
    { p: pFire, n: 0, kinds: { fire: 1, spark: 1, ring: 1 } },
    { p: pSmoke, n: 0, kinds: { smoke: 1, debris: 1, confetti: 1 } },
  ];
  for (const s of sets) { s.pos = s.p.geometry.attributes.position.array; s.col = s.p.geometry.attributes.pcolor.array; s.sz = s.p.geometry.attributes.psize.array; s.al = s.p.geometry.attributes.palpha.array; }
  for (const q of S.parts) {
    const set = sets[0].kinds[q.k] ? sets[0] : sets[1].kinds[q.k] ? sets[1] : null;
    if (!set || set.n >= P_MAX) continue;
    const a = clamp(q.life / q.max, 0, 1);
    let size = q.size * 2, alpha = a, h = 14;
    if (q.k === 'fire') { const t = 1 - a; tmpCol.set(t < 0.3 ? '#fff5b4' : t < 0.6 ? '#ffa028' : '#c83c14'); size = q.size * (1 + a); h = 18; }
    else if (q.k === 'spark') { tmpCol.set(q.color || '#ffd75a'); size = Math.max(5, q.size * 2.5); h = 16; }
    else if (q.k === 'ring') { tmpCol.set('#ffe6a0'); size = (q.size * (1 - a) + 10) * 2; alpha = a * 0.7; h = 12; }
    else if (q.k === 'smoke') { tmpCol.set(q.dust || (q.light ? '#dcdcdc' : '#3c3c3c')); alpha = a * (q.dust ? 0.55 : q.light ? 0.35 : 0.5); h = 20; }
    else { tmpCol.set(q.color || '#ffffff'); alpha = Math.min(1, a * 2); h = q.k === 'confetti' ? 60 : 16; }
    const i = set.n++;
    set.pos[i * 3] = q.x; set.pos[i * 3 + 1] = h; set.pos[i * 3 + 2] = q.y;
    set.col[i * 3] = tmpCol.r; set.col[i * 3 + 1] = tmpCol.g; set.col[i * 3 + 2] = tmpCol.b;
    set.sz[i] = size; set.al[i] = alpha;
  }
  for (const s of sets) {
    s.p.geometry.setDrawRange(0, s.n);
    s.p.geometry.attributes.position.needsUpdate = true;
    s.p.geometry.attributes.pcolor.needsUpdate = true;
    s.p.geometry.attributes.psize.needsUpdate = true;
    s.p.geometry.attributes.palpha.needsUpdate = true;
  }
}

// ------------------------------------------------------------------ marcas de goma
const SKID_MAX = 1000;
function makeSkids() {
  skidGeo = new THREE.BufferGeometry();
  skidGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(SKID_MAX * 4 * 3), 3));
  const nrm = new Float32Array(SKID_MAX * 4 * 3);
  for (let i = 1; i < nrm.length; i += 3) nrm[i] = 1;
  skidGeo.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  const idx = new Uint16Array(SKID_MAX * 6);
  for (let i = 0; i < SKID_MAX; i++) {
    const b = i * 4;
    idx.set([b, b + 1, b + 2, b, b + 2, b + 3], i * 6);
  }
  skidGeo.setIndex(new THREE.BufferAttribute(idx, 1));
  skidGeo.setDrawRange(0, 0);
  skidMesh = new THREE.Mesh(skidGeo, bas({ color: 0x14121a, transparent: true, opacity: 0.32, depthWrite: false, side: THREE.DoubleSide }));
  skidMesh.frustumCulled = false;
  return skidMesh;
}

function updateSkids(S) {
  const arr = S.skids, pos = skidGeo.attributes.position.array;
  const n = Math.min(arr.length, SKID_MAX);
  const w = 4;
  for (let i = 0; i < n; i++) {
    const s = arr[arr.length - n + i];
    const dx = s[2] - s[0], dy = s[3] - s[1];
    const l = Math.hypot(dx, dy) || 1;
    const nx = (-dy / l) * w, ny = (dx / l) * w;
    const b = i * 12;
    pos[b] = s[0] + nx; pos[b + 1] = 1.2; pos[b + 2] = s[1] + ny;
    pos[b + 3] = s[0] - nx; pos[b + 4] = 1.2; pos[b + 5] = s[1] - ny;
    pos[b + 6] = s[2] - nx; pos[b + 7] = 1.2; pos[b + 8] = s[3] - ny;
    pos[b + 9] = s[2] + nx; pos[b + 10] = 1.2; pos[b + 11] = s[3] + ny;
  }
  skidGeo.attributes.position.needsUpdate = true;
  skidGeo.setDrawRange(0, n * 6);
  skidMesh.material.color.set(night ? 0x2a0a26 : 0x14121a);
}

// ------------------------------------------------------------------ zona de eliminación
function makeZone() {
  const g = new THREE.Group();
  const dark = bas({ color: 0x0a0814, transparent: true, opacity: 0.5, depthWrite: false, side: THREE.DoubleSide });
  for (let i = 0; i < 4; i++) {
    const m = mesh(['plane'], dark);
    m.position.y = 3;
    m.renderOrder = 2;
    g.add(m);
  }
  const line = bas({ color: 0xff3c3c, transparent: true, opacity: 0.9, depthWrite: false, side: THREE.DoubleSide });
  for (let i = 0; i < 4; i++) {
    const m = mesh(['plane'], line);
    m.position.y = 4;
    m.renderOrder = 3;
    g.add(m);
  }
  g.userData = { dark, line };
  return g;
}

function updateZone(S, time) {
  const W = S.world;
  const on = !!(W && !W.arena && W.camX != null);
  zoneGroup.visible = on;
  if (!on) return;
  const sk = W.phase === 'race' ? W.shrink : 1;
  const hw = (VIEW_W / 2) * sk, hh = (VIEW_H / 2) * sk;
  const E = 12000, cx = W.camX, cz = W.camY;
  const u = zoneGroup.userData;
  u.dark.color.set(sk < 1 ? 0x2a0006 : 0x0a0814);
  u.dark.opacity = sk < 1 ? 0.58 : 0.5;
  const rect = [
    [cx, cz - hh - E / 2, (hw + E) * 2, E],
    [cx, cz + hh + E / 2, (hw + E) * 2, E],
    [cx - hw - E / 2, cz, E, hh * 2],
    [cx + hw + E / 2, cz, E, hh * 2],
  ];
  for (let i = 0; i < 4; i++) {
    const m = zoneGroup.children[i], r = rect[i];
    m.position.x = r[0]; m.position.z = r[1];
    m.scale.set(r[2], 1, r[3]);
  }
  const t = sk < 1 ? 14 : 7;
  u.line.color.set(sk < 1 ? 0xff3c3c : 0xffffff);
  u.line.opacity = sk < 1 ? 0.55 + 0.4 * Math.sin(time * 10) : 0.22;
  const borders = [
    [cx, cz - hh, hw * 2, t],
    [cx, cz + hh, hw * 2, t],
    [cx - hw, cz, t, hh * 2],
    [cx + hw, cz, t, hh * 2],
  ];
  for (let i = 0; i < 4; i++) {
    const m = zoneGroup.children[4 + i], r = borders[i];
    m.position.x = r[0]; m.position.z = r[1];
    m.scale.set(r[2], 1, r[3]);
  }
}

function updateSafe(S, time) {
  const W = S.world;
  const on = !!(W && W.arena && W.sdOn && W.safeR > 0 && W.safeR < 2600);
  safeRing.visible = on;
  if (!on) return;
  safeRing.position.set(W.map.w / 2, 3.2, W.map.h / 2);
  safeRing.scale.set(W.safeR, 1, W.safeR);
  safeRing.material.opacity = 0.2 + 0.08 * Math.sin(time * 6);
}

// ------------------------------------------------------------------ cámara
function fitDistance(hw, hh) {
  const c = camera.clone();
  c.aspect = camera.aspect;
  let lo = 200, hi = 80000;
  for (let i = 0; i < 34; i++) {
    const d = (lo + hi) / 2;
    c.position.set(0, d * Math.sin(TILT), d * Math.cos(TILT));
    c.lookAt(0, 0, 0);
    c.updateMatrixWorld(true);
    c.updateProjectionMatrix();
    let ok = true;
    for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      pv.set(sx * hw, 0, sz * hh).project(c);
      if (Math.abs(pv.x) > 0.985 || Math.abs(pv.y) > 0.985) { ok = false; break; }
    }
    if (ok) hi = d; else lo = d;
  }
  return hi;
}

// ------------------------------------------------------------------ API
const R3D = {
  ready: false,

  init(canvas) {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: (window.devicePixelRatio || 1) < 1.6, powerPreference: 'high-performance' });
    renderer.setClearColor(fogC);
    scene = new THREE.Scene();
    scene.fog = new THREE.Fog(fogC.getHex(), 2000, 9000);
    camera = new THREE.PerspectiveCamera(FOV, 1, 40, 60000);
    hemi = new THREE.HemisphereLight(0xffffff, 0x4f9b40, 2.1);
    sun = new THREE.DirectionalLight(0xfff3df, 1.7);
    sun.position.set(-700, 1500, -500);
    scene.add(hemi, sun);
    dyn = new THREE.Group();
    scene.add(dyn);
    crateTex = crateTexture();
    carsGroup = new THREE.Group();
    dyn.add(carsGroup);
    pools.crate = Pool(makeCrate);
    pools.mine = Pool(makeMine);
    pools.oil = Pool(makeOil);
    pools.missile = Pool(makeMissile);
    pools.wave = Pool(makeWave);
    pFire = makePoints(THREE.AdditiveBlending);
    pSmoke = makePoints(THREE.NormalBlending);
    dyn.add(pFire, pSmoke);
    dyn.add(makeSkids());
    zoneGroup = makeZone();
    dyn.add(zoneGroup);
    safeRing = mesh(['ring', 1, 42, 72], bas({ color: 0xff2a2a, transparent: true, opacity: 0.24, depthWrite: false, side: THREE.DoubleSide }));
    safeRing.visible = false;
    dyn.add(safeRing);
    this.ready = true;
  },

  resize(w, h, ratio) {
    cssW = Math.max(1, w); cssH = Math.max(1, h); dpr = ratio;
    renderer.setPixelRatio(ratio);
    renderer.setSize(cssW, cssH, false);
    camera.aspect = cssW / cssH;
    camera.updateProjectionMatrix();
    const base = Math.min(cssW / VIEW_W, cssH / VIEW_H);
    dRef = fitDistance((cssW / base) / 2, (cssH / base) / 2);
    const uScale = (cssH * ratio) / (2 * Math.tan((FOV * Math.PI) / 360));
    pFire.material.uniforms.uScale.value = uScale;
    pSmoke.material.uniforms.uScale.value = uScale;
  },

  // desc: { key, kind:'track'|'arena', map, decor }
  setScene(desc) {
    if (worldRoot) { scene.remove(worldRoot); disposeTree(worldRoot); worldRoot = null; }
    for (const g of carObjs.values()) { carsGroup.remove(g); disposeTree(g); }
    carObjs.clear();
    if (!desc) return;
    applyTheme(desc.map.theme);
    worldRoot = desc.kind === 'arena' ? buildArenaScene(desc.map) : buildTrackScene(desc.map, desc.decor);
    scene.add(worldRoot);
  },

  frame(S, time) {
    const zoom = (S.cam && S.cam.zoom) || 1;
    const d = dRef * zoom;
    const sh = S.shake * 14;
    const cx = S.cam.x + (Math.random() - 0.5) * sh, cz = S.cam.y + (Math.random() - 0.5) * sh;
    camera.position.set(cx, d * Math.sin(TILT), cz + d * Math.cos(TILT));
    camera.lookAt(cx, 0, cz);
    scene.fog.near = d * 1.05;
    scene.fog.far = d * 3.0;

    // autos
    const seen = new Set();
    for (const c of S.cars.values()) {
      if (!c.alive) continue;
      seen.add(c.id);
      let g = carObjs.get(c.id);
      if (!g) { g = makeCar(); carObjs.set(c.id, g); carsGroup.add(g); }
      updateCar(g, c, time, c.id === S.me.id);
    }
    for (const [id, g] of carObjs) if (!seen.has(id)) g.visible = false;

    const W = S.world;
    for (const k in pools) pools[k].begin();
    if (W) {
      for (const b of W.boxes) {
        if (!b.active) continue;
        const o = pools.crate.get();
        o.position.set(b.x, 0, b.y);
        const bob = Math.sin(time * 4 + b.ph);
        o.userData.box.position.y = 28 + bob * 6;
        o.userData.box.rotation.y = time * 1.4 + b.ph;
        o.userData.box.rotation.x = 0.3;
      }
      for (const m of S.mines) {
        const o = pools.mine.get();
        o.position.set(m.x, 0, m.y);
        o.userData.led.material.color.set(Math.sin(time * (m.fast ? 20 : 8) + m.id) > 0 ? '#ff3030' : '#661010');
      }
      for (const o2 of S.oils) {
        const o = pools.oil.get();
        o.position.set(o2.x, 0.8, o2.y);
        o.scale.set(o2.r, 1, o2.r);
        o.material.opacity = Math.min(1, o2.life) * 0.9;
      }
      for (const m of S.missiles) {
        const o = pools.missile.get();
        o.position.set(m.x, 14, m.y);
        o.rotation.y = -m.a;
        const k = 0.7 + Math.random() * 0.6;
        o.userData.fire.scale.set(k, k, k);
      }
      for (const w of S.waves) {
        const o = pools.wave.get();
        o.position.set(w.x, 10, w.y);
        o.scale.set(w.r, 1, w.r);
        o.material.opacity = clamp(w.life / 0.45, 0, 1) * 0.8;
      }
    }
    for (const k in pools) pools[k].end();

    updateParticles(S);
    updateSkids(S);
    updateZone(S, time);
    updateSafe(S, time);
    renderer.render(scene, camera);
  },

  // mundo 2D -> pantalla (px CSS). Devuelve [x, y, visible]
  project(x, y, h) {
    pv.set(x, h || 0, y).project(camera);
    return [(pv.x * 0.5 + 0.5) * cssW, (-pv.y * 0.5 + 0.5) * cssH, pv.z < 1];
  },

  // px CSS por unidad de mundo cerca de ese punto
  scaleAt(x, y) {
    const a = this.project(x, y, 0), b = this.project(x, y, 120);
    return Math.abs(a[1] - b[1]) / 120;
  },
};

window.R3D = R3D;
window.dispatchEvent(new Event('r3d-ready'));
