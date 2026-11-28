// Pistas y arenas originales de Asfalto Salvaje.
(function (root) {
  'use strict';

  const ROAD = 160;   // medio ancho del asfalto
  const CURB = 14;    // ancho del cordón
  const WALL = 255;   // distancia del centro al muro
  const STEP = 20;    // separación entre muestras de la línea central

  // Obstáculos de pista
  const RAMP_LEN = 120;       // la rampa que precede al agua
  const JUMP_H = 92;          // altura del salto
  const FORK_TAPER = 130;     // cuánto tardan en abrirse las puntas de la isla
  const BRIDGE_FUNNEL = 150;  // embudo de barandas al entrar y salir del puente

  const THEMES = {
    valle: {
      ground: '#4f9b40', dots: ['#5aa84b', '#468f38', '#63b153'], runoff: '#86b85a',
      wallA: '#f2f2f2', wallB: '#d93a3a', curbA: '#d8333a', curbB: '#f5f5f5',
      road: '#4b4e57', line: 'rgba(255,255,255,0.45)', edge: 'rgba(255,255,255,0.8)',
      decor: ['tree', 'tree', 'tree', 'bush', 'flowers'], grip: 1.0,   // agarre del asfalto (1 = seco)
    },
    duna: {
      ground: '#d9a35b', dots: ['#e5b16c', '#cc9450', '#efc184'], runoff: '#ecc88f',
      wallA: '#8a5a3a', wallB: '#f1dcb5', curbA: '#b8432c', curbB: '#f7e8ca',
      road: '#5d524a', line: 'rgba(255,240,210,0.45)', edge: 'rgba(255,240,210,0.75)',
      decor: ['cactus', 'rock', 'rock', 'cactus', 'skull'], grip: 0.93,  // arena suelta
    },
    hielo: {
      ground: '#e6eff6', dots: ['#ffffff', '#d4e2ee', '#f1f7fb'], runoff: '#cddfeb',
      wallA: '#2f6fb3', wallB: '#ffffff', curbA: '#2f6fb3', curbB: '#ffffff',
      road: '#5a6571', line: 'rgba(255,255,255,0.5)', edge: 'rgba(255,255,255,0.85)',
      decor: ['pine', 'pine', 'pine', 'ice', 'snowman'], grip: 0.76,  // hielo
    },
    neon: {
      ground: '#1b1730', dots: ['#241e40', '#16122a', '#2c2550'], runoff: '#2a2347',
      wallA: '#ff3fd2', wallB: '#3ff0ff', curbA: '#ff3fd2', curbB: '#221c3c',
      road: '#2c2e3c', line: 'rgba(63,240,255,0.55)', edge: 'rgba(255,63,210,0.8)',
      decor: ['building', 'building', 'lamp', 'building'], grip: 0.97, night: true,
    },
    hardcore: {
      ground: '#2e2024', dots: ['#3a282c', '#26191d', '#44312f'], runoff: '#4a3430',
      wallA: '#f2c230', wallB: '#1d1517', curbA: '#e05a1f', curbB: '#241a1c',
      road: '#35303a', line: 'rgba(255,190,80,0.5)', edge: 'rgba(255,190,80,0.75)',
      decor: ['rock', 'rock', 'skull', 'cactus', 'rock'], grip: 0.9,
    },
    lago: {
      ground: '#bcd9e8', dots: ['#d6e9f3', '#a9cadd', '#e8f4fa'], runoff: '#9fc3d8',
      wallA: '#1f4f7a', wallB: '#dff1fb', curbA: '#1f4f7a', curbB: '#dff1fb',
      road: '#8fb6cc', line: 'rgba(255,255,255,0.6)', edge: 'rgba(255,255,255,0.9)',
      decor: ['pine', 'ice', 'ice', 'snowman', 'ice'], grip: 0.55,  // hielo pulido: casi no agarra
    },
    fabrica: {
      ground: '#5b6068', dots: ['#646a73', '#525760', '#6c727b'], runoff: '#5b6068',
      wallA: '#f2c230', wallB: '#26282c', road: '#5b6068', grip: 0.95,
    },
  };

  const TRACK_DEFS = [
    {
      name: 'Valle Verde', theme: 'valle',
      points: [[0, 0], [1800, -200], [3000, 0], [3600, 700], [3300, 1500], [2400, 1600], [1800, 1100], [1100, 1500], [300, 1700], [-500, 1200], [-600, 400]],
      features: [
        { t: 'water', at: 0.17, len: 240 },
        { t: 'hole', at: 0.55, lat: -78, r: 62 },
        { t: 'hole', at: 0.57, lat: 82, r: 62 },
      ],
    },
    {
      name: 'Duna Roja', theme: 'duna',
      points: [[0, 0], [2400, -100], [3000, 400], [2700, 1000], [1800, 900], [1400, 1400], [2000, 2000], [3200, 2100], [3500, 2700], [2800, 3100], [800, 3000], [-200, 2400], [-400, 1200]],
      features: [
        { t: 'hole', at: 0.18, lat: 0, r: 72 },
        { t: 'fork', at: 0.45, len: 760, w: 56 },
        { t: 'water', at: 0.66, len: 230 },
      ],
    },
    {
      name: 'Puerto Helado', theme: 'hielo',
      points: [[0, 0], [1500, -300], [2800, 0], [3400, 800], [2900, 1500], [3300, 2200], [2700, 2900], [1600, 2850], [1150, 2200], [600, 2000], [100, 2500], [-600, 2200], [-500, 1000]],
      features: [
        { t: 'bridge', at: 0.30, len: 420, w: 78 },
        { t: 'hole', at: 0.66, lat: -72, r: 60 },
      ],
    },
    {
      name: 'Neón Nocturno', theme: 'neon',
      points: [[0, 0], [2000, 0], [2400, 300], [2400, 1200], [2800, 1600], [3600, 1600], [3900, 2000], [3700, 2700], [2000, 2800], [1600, 2400], [1500, 1600], [1000, 1300], [300, 1500], [-300, 1000], [-300, 300]],
      features: [
        { t: 'fork', at: 0.26, len: 700, w: 54 },
        { t: 'water', at: 0.54, len: 240 },
        { t: 'hole', at: 0.84, lat: 74, r: 58 },
      ],
    },
    {
      // La pista brava: tiene de todo y casi no deja respirar.
      name: 'Infierno Oxidado', theme: 'hardcore',
      points: [[0, 0], [1600, 0], [2600, 300], [3200, 1000], [3000, 1800], [2200, 2300], [1200, 2200], [600, 2600], [-400, 2400], [-800, 1600], [-600, 700]],
      features: [
        { t: 'water', at: 0.09, len: 250 },
        { t: 'hole', at: 0.26, lat: -84, r: 64 },
        { t: 'hole', at: 0.28, lat: 88, r: 64 },
        { t: 'bridge', at: 0.36, len: 460, w: 72 },
        { t: 'water', at: 0.53, len: 240 },
        { t: 'fork', at: 0.62, len: 820, w: 60 },
        { t: 'hole', at: 0.80, lat: 0, r: 72 },
      ],
    },
    {
      // Hielo pulido: el tema 'lago' agarra la mitad que el asfalto seco.
      name: 'Lago Congelado', theme: 'lago',
      points: [[0, 0], [1400, -200], [2600, 100], [3200, 800], [2900, 1600], [2000, 1900], [1000, 1700], [200, 2000], [-600, 1500], [-700, 600]],
      features: [
        { t: 'fork', at: 0.33, len: 680, w: 55 },
        { t: 'hole', at: 0.50, lat: -74, r: 60 },
        { t: 'water', at: 0.67, len: 230 },
      ],
    },
  ];

  const ARENA_DEFS = [
    {
      name: 'Fosa de Chatarra', theme: 'fabrica', w: 2800, h: 1800,
      circles: [[700, 500, 90], [2100, 500, 90], [700, 1300, 90], [2100, 1300, 90], [1400, 900, 150]],
      rects: [],
    },
    {
      name: 'Plaza de Hierro', theme: 'fabrica', w: 2800, h: 1800,
      circles: [[1400, 900, 110]],
      rects: [[560, 380, 320, 70], [1920, 380, 320, 70], [560, 1350, 320, 70], [1920, 1350, 320, 70], [1365, 180, 70, 260], [1365, 1360, 70, 260]],
    },
  ];

  // Catmull-Rom centrípeta
  function crPoint(p0, p1, p2, p3, t) {
    const d = (a, b) => Math.max(1e-6, Math.pow(Math.hypot(b[0] - a[0], b[1] - a[1]), 0.5));
    const t0 = 0, t1 = t0 + d(p0, p1), t2 = t1 + d(p1, p2), t3 = t2 + d(p2, p3);
    const tt = t1 + (t2 - t1) * t;
    const lerp = (a, b, ta, tb) => [
      ((tb - tt) / (tb - ta)) * a[0] + ((tt - ta) / (tb - ta)) * b[0],
      ((tb - tt) / (tb - ta)) * a[1] + ((tt - ta) / (tb - ta)) * b[1],
    ];
    const A1 = lerp(p0, p1, t0, t1), A2 = lerp(p1, p2, t1, t2), A3 = lerp(p2, p3, t2, t3);
    const B1 = lerp(A1, A2, t0, t2), B2 = lerp(A2, A3, t1, t3);
    return lerp(B1, B2, t1, t2);
  }

  function resample(pts, spacing) {
    const n = pts.length;
    const cum = [0];
    for (let i = 1; i <= n; i++) {
      const a = pts[i - 1], b = pts[i % n];
      cum.push(cum[i - 1] + Math.hypot(b[0] - a[0], b[1] - a[1]));
    }
    const L = cum[n];
    const N = Math.max(8, Math.round(L / spacing));
    const out = [];
    let j = 0;
    for (let k = 0; k < N; k++) {
      const s = (k / N) * L;
      while (cum[j + 1] < s) j++;
      const a = pts[j], b = pts[(j + 1) % n];
      const t = (s - cum[j]) / Math.max(1e-6, cum[j + 1] - cum[j]);
      out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
    }
    return out;
  }

  function buildTrack(def) {
    const P = def.points, n = P.length;
    let dense = [];
    for (let i = 0; i < n; i++) {
      const p0 = P[(i - 1 + n) % n], p1 = P[i], p2 = P[(i + 1) % n], p3 = P[(i + 2) % n];
      for (let k = 0; k < 40; k++) dense.push(crPoint(p0, p1, p2, p3, k / 40));
    }
    let pts = resample(dense, STEP);
    // Suavizado para curvas más amplias
    for (let it = 0; it < 80; it++) {
      const m = pts.length;
      pts = pts.map((p, i) => {
        const a = pts[(i - 1 + m) % m], b = pts[(i + 1) % m];
        return [(a[0] + 2 * p[0] + b[0]) / 4, (a[1] + 2 * p[1] + b[1]) / 4];
      });
    }
    pts = resample(pts, STEP);
    const N = pts.length;
    const xs = new Float32Array(N), ys = new Float32Array(N), tx = new Float32Array(N), ty = new Float32Array(N);
    const cum = new Float32Array(N + 1);
    for (let i = 0; i < N; i++) { xs[i] = pts[i][0]; ys[i] = pts[i][1]; }
    for (let i = 0; i < N; i++) {
      const a = (i - 1 + N) % N, b = (i + 1) % N;
      const dx = xs[b] - xs[a], dy = ys[b] - ys[a], l = Math.hypot(dx, dy) || 1;
      tx[i] = dx / l; ty[i] = dy / l;
      const nx = xs[b] - xs[i], ny = ys[b] - ys[i];
      cum[i + 1] = cum[i] + Math.hypot(nx, ny);
    }
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (let i = 0; i < N; i++) {
      minX = Math.min(minX, xs[i]); maxX = Math.max(maxX, xs[i]);
      minY = Math.min(minY, ys[i]); maxY = Math.max(maxY, ys[i]);
    }
    // Línea de largada: el tramo más recto cerca del inicio
    let startIdx = 0, best = -1;
    for (let i = 0; i < N; i++) {
      let straight = 0;
      for (let k = -14; k <= 24; k++) {
        const j = (i + k + N) % N;
        straight += tx[i] * tx[j] + ty[i] * ty[j];
      }
      if (straight > best + 0.5) { best = straight; startIdx = i; }
    }
    const T = {
      kind: 'track', name: def.name, theme: THEMES[def.theme], themeKey: def.theme,
      N, L: cum[N], cum, xs, ys, tx, ty, startIdx, feats: [],
      bounds: { minX: minX - 700, minY: minY - 700, maxX: maxX + 700, maxY: maxY + 700 },
    };
    T.feats = buildFeats(T, def.features || []);
    return T;
  }

  // ------------------------------------------------------------- obstáculos
  // `at` es la fracción de vuelta contada DESDE LA LARGADA, así que una pista
  // siempre tiene sus obstáculos donde el que la diseñó los puso.
  function buildFeats(T, list) {
    const base = T.cum[T.startIdx];
    const wrap = (s) => ((s % T.L) + T.L) % T.L;
    return list.map((f) => {
      const s0 = wrap(base + f.at * T.L);
      if (f.t === 'hole') {
        const p = pointAt(T, s0), lat = f.lat || 0;
        return { t: 'hole', s: s0, lat, r: f.r || 64, x: p.x + p.nx * lat, y: p.y + p.ny * lat };
      }
      if (f.t === 'water') {
        const len = f.len || 240;
        return { t: 'water', s0, len, ramp: { t: 'ramp', s0: wrap(s0 - RAMP_LEN), len: RAMP_LEN } };
      }
      return { t: f.t, s0, len: f.len || 400, w: f.w || 72 };
    });
  }

  // Cuánto llevás recorrido dentro del tramo, o -1 si el punto quedó afuera.
  function spanAt(T, s, f) {
    let d = s - f.s0;
    if (d < 0) d += T.L;
    if (d >= T.L) d -= T.L;
    return d < f.len ? d : -1;
  }
  const smooth01 = (t) => { t = t < 0 ? 0 : t > 1 ? 1 : t; return t * t * (3 - 2 * t); };
  // La isla de la bifurcación nace y muere en punta para que no te clave de golpe.
  const forkHalf = (f, d) => f.w * smooth01(Math.min(d, f.len - d) / FORK_TAPER);
  // Distancia al centro de un pozo a lo largo de la pista (con la vuelta cerrada)
  function holeGap(T, s, f) {
    let d = s - f.s;
    if (d > T.L / 2) d -= T.L;
    if (d < -T.L / 2) d += T.L;
    return d;
  }

  // ¿Ese punto de la pista es peligroso? Sirve para no tirar cajas al agua.
  function hazardAt(T, s, lat) {
    for (const f of T.feats || []) {
      if (f.t === 'hole') {
        if (Math.abs(holeGap(T, s, f)) < f.r + 70 && Math.abs(lat - f.lat) < f.r + 70) return true;
        continue;
      }
      if (f.t === 'water') {
        if (spanAt(T, s, f) >= 0 || spanAt(T, s, f.ramp) >= 0) return true;
        continue;
      }
      const d = spanAt(T, s, f);
      if (d < 0) continue;
      if (f.t === 'bridge' && Math.abs(lat) > f.w - 34) return true;
      if (f.t === 'fork' && Math.abs(lat) < f.w + 76) return true;
    }
    return false;
  }

  // Proyecta un punto sobre la pista buscando cerca del segmento "hint".
  function project(T, x, y, hint, range) {
    const N = T.N, R = range || 10;
    let best = Infinity, bi = hint, bt = 0, bpx = 0, bpy = 0;
    for (let k = -R; k <= R; k++) {
      const i = (((hint + k) % N) + N) % N, j = (i + 1) % N;
      const ax = T.xs[i], ay = T.ys[i], dx = T.xs[j] - ax, dy = T.ys[j] - ay;
      const l2 = dx * dx + dy * dy || 1;
      let t = ((x - ax) * dx + (y - ay) * dy) / l2;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const px = ax + dx * t, py = ay + dy * t;
      const d2 = (x - px) * (x - px) + (y - py) * (y - py);
      if (d2 < best) { best = d2; bi = i; bt = t; bpx = px; bpy = py; }
    }
    const j = (bi + 1) % N;
    const dx = T.xs[j] - T.xs[bi], dy = T.ys[j] - T.ys[bi], l = Math.hypot(dx, dy) || 1;
    const ux = dx / l, uy = dy / l;
    // normal derecha (en pantalla, y hacia abajo)
    const nx = -uy, ny = ux;
    const lat = (x - bpx) * nx + (y - bpy) * ny;
    return { seg: bi, t: bt, px: bpx, py: bpy, lat, nx, ny, ux, uy, s: T.cum[bi] + bt * l };
  }

  // Búsqueda global (más lenta) para inicializar
  function projectGlobal(T, x, y) {
    let best = Infinity, bi = 0;
    for (let i = 0; i < T.N; i++) {
      const d = (x - T.xs[i]) ** 2 + (y - T.ys[i]) ** 2;
      if (d < best) { best = d; bi = i; }
    }
    return project(T, x, y, bi, 3);
  }

  function pointAt(T, s) {
    s = ((s % T.L) + T.L) % T.L;
    let lo = 0, hi = T.N - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (T.cum[mid] <= s) lo = mid; else hi = mid - 1;
    }
    const i = lo, j = (i + 1) % T.N;
    const segL = T.cum[i + 1] - T.cum[i] || 1;
    const t = (s - T.cum[i]) / segL;
    const x = T.xs[i] + (T.xs[j] - T.xs[i]) * t, y = T.ys[i] + (T.ys[j] - T.ys[i]) * t;
    const dx = T.xs[j] - T.xs[i], dy = T.ys[j] - T.ys[i], l = Math.hypot(dx, dy) || 1;
    return { x, y, ux: dx / l, uy: dy / l, nx: -dy / l, ny: dx / l, seg: i };
  }

  function buildArena(def) {
    return {
      kind: 'arena', name: def.name, theme: THEMES[def.theme], themeKey: def.theme,
      w: def.w, h: def.h,
      circles: def.circles.map(([x, y, r]) => ({ x, y, r })),
      rects: def.rects.map(([x, y, w, h]) => ({ x, y, w, h })),
      bounds: { minX: -300, minY: -300, maxX: def.w + 300, maxY: def.h + 300 },
    };
  }

  const api = {
    ROAD, CURB, WALL, STEP, RAMP_LEN, JUMP_H, FORK_TAPER, BRIDGE_FUNNEL,
    THEMES, TRACK_DEFS, ARENA_DEFS, buildTrack, buildArena,
    project, projectGlobal, pointAt, spanAt, forkHalf, holeGap, hazardAt, smooth01,
  };
  root.Tracks = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
