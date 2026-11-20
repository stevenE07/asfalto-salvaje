// Asfalto Salvaje — pantalla principal: simulación, render, lobby y red.
(() => {
  'use strict';
  const { ROAD, CURB, WALL, TRACK_DEFS, ARENA_DEFS, buildTrack, buildArena, project, projectGlobal, pointAt } = window.Tracks;

  // ------------------------------------------------------------------ util
  const TAU = Math.PI * 2;
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const rand = (a, b) => a + Math.random() * (b - a);
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
  const angNorm = (a) => { while (a > Math.PI) a -= TAU; while (a < -Math.PI) a += TAU; return a; };
  const shuffle = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  function seeded(seed) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }

  // ------------------------------------------------------------- constantes
  const COLORS = [
    { name: 'Rojo', hex: '#ec3b40', dark: '#9b1d22' },
    { name: 'Azul', hex: '#2f7cf6', dark: '#18469c' },
    { name: 'Amarillo', hex: '#f6c512', dark: '#a07f05' },
    { name: 'Verde', hex: '#27bf57', dark: '#157434' },
    { name: 'Naranja', hex: '#ff8a1f', dark: '#ad560a' },
    { name: 'Violeta', hex: '#9a5cf6', dark: '#5b31a6' },
    { name: 'Celeste', hex: '#22d0de', dark: '#0f838c' },
    { name: 'Rosa', hex: '#ff5ca7', dark: '#b02f6d' },
  ];
  const ITEMS = {
    turbo: { icon: '⚡', name: 'Turbo' },
    missile: { icon: '🚀', name: 'Misil' },
    mine: { icon: '💣', name: 'Mina' },
    oil: { icon: '🛢️', name: 'Aceite' },
    shield: { icon: '🛡️', name: 'Escudo' },
    wave: { icon: '💥', name: 'Onda' },
  };
  const MODES = {
    knockout: { name: 'Eliminación', icon: '🏁', desc: 'La cámara sigue al que va primero. Si te quedás fuera de la pantalla, quedás eliminado.', items: true, arena: false },
    pure: { name: 'Carrera Pura', icon: '🏎️', desc: 'Igual que Eliminación pero sin power-ups: solo manejo.', items: false, arena: false },
    arena: { name: 'Batalla', icon: '💣', desc: 'Arena cerrada con 3 vidas por auto. El último que queda en pie gana.', items: true, arena: true },
  };
  const TARGETS = [5, 10, 15];
  const MAX_PLAYERS = 8;
  const VIEW_W = 1750, VIEW_H = 1000;
  const CAR_R = 19;
  const MAX_SPEED = 540, ACCEL = 560, TURN = 3.15;
  const DT = 1 / 60;
  const KO_SD_START = 40, KO_SD_LEN = 35, KO_SD_MIN = 0.18;
  const AR_SD_START = 45, AR_SD_LEN = 30;
  const KB_SETS = {
    k1: { l: 'ArrowLeft', r: 'ArrowRight', f: 'ArrowUp', b: 'ArrowDown', label: '← → (↑ power-up, ↓ freno)' },
    k2: { l: 'KeyA', r: 'KeyD', f: 'KeyW', b: 'KeyS', label: 'A D (W power-up, S freno)' },
  };
  const BOT_NAMES = ['Turbina', 'Chispa', 'Bujía', 'Pistón', 'Rayo', 'Tuerca', 'Llanta', 'Escape'];

  const TRACKS = TRACK_DEFS.map(buildTrack);
  const ARENAS = ARENA_DEFS.map(buildArena);

  // ------------------------------------------------------------------ estado
  const G = {
    phase: 'lobby', mode: 'knockout', target: 10,
    players: [], world: null, phaseT: 0, round: 0,
    trackQueue: [], arenaIdx: 0, champion: null, roundWinner: null, lastResults: null,
    baseScale: 1, viewW: VIEW_W, viewH: VIEW_H, cssW: 0, cssH: 0, dpr: 1,
    code: null, joinUrl: '', botSeq: 0,
  };

  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  const $ = (id) => document.getElementById(id);

  // ------------------------------------------------------------- jugadores
  function freeColor() {
    for (let i = 0; i < COLORS.length; i++) if (!G.players.some((p) => p.color === i)) return i;
    return 0;
  }
  function newPlayer(kind, key, name) {
    return { key, kind, name, color: freeColor(), score: 0, input: { l: false, r: false, b: false, fire: false }, connected: true, lastSent: '', joinedAt: performance.now() };
  }
  function addPhone(id, name) {
    let p = G.players.find((x) => x.key === 'p' + id);
    if (p) { p.connected = true; p.name = name || p.name; refreshLobby(); return; }
    p = newPlayer('phone', 'p' + id, name);
    p.phoneId = id;
    G.players.push(p);
    enforceCap(p);
    SFX.join();
    toastGlobal(`${p.name} se unió`, COLORS[p.color].hex);
    refreshLobby();
  }
  function addBot() {
    if (G.players.length >= MAX_PLAYERS) return;
    const used = new Set(G.players.map((p) => p.name));
    const name = BOT_NAMES.find((n) => !used.has(n)) || 'Bot ' + (++G.botSeq);
    const p = newPlayer('bot', 'b' + (++G.botSeq), name);
    G.players.push(p);
    refreshLobby();
  }
  function addKeyboard() {
    if (G.players.length >= MAX_PLAYERS) return;
    const set = ['k1', 'k2'].find((k) => !G.players.some((p) => p.key === k));
    if (!set) return;
    const p = newPlayer('kb', set, set === 'k1' ? 'Teclado 1' : 'Teclado 2');
    p.kb = KB_SETS[set];
    G.players.push(p);
    refreshLobby();
  }
  function removePlayer(p) {
    G.players = G.players.filter((x) => x !== p);
    if (p.kind === 'phone') net.send({ t: 'drop', id: p.phoneId });
    refreshLobby();
  }
  // Si entra un celular y no hay lugar, se va un bot (o un teclado)
  function enforceCap(keep) {
    while (G.players.length > MAX_PLAYERS) {
      const victim = [...G.players].reverse().find((p) => p.kind === 'bot' && p !== keep) || [...G.players].reverse().find((p) => p.kind === 'kb' && p !== keep);
      if (!victim) break;
      G.players = G.players.filter((x) => x !== victim);
    }
  }
  function vipPlayer() {
    return G.players.find((p) => p.kind === 'phone' && p.connected) || null;
  }

  // --------------------------------------------------------------- mundo
  const decorCache = new Map();
  function genDecor(T, idx) {
    if (decorCache.has(T)) return decorCache.get(T);
    const rnd = seeded(1234 + idx * 977);
    const list = [];
    const b = T.bounds, types = T.theme.decor, cell = 140;
    for (let x = b.minX; x < b.maxX; x += cell) {
      for (let y = b.minY; y < b.maxY; y += cell) {
        if (rnd() < 0.4) continue;
        const px = x + rnd() * cell, py = y + rnd() * cell;
        const type = types[Math.floor(rnd() * types.length)];
        const s = 0.7 + rnd() * 0.6;
        const clear = WALL + (type === 'building' ? 110 * s : 45 * s) + 20;
        let md = Infinity;
        for (let i = 0; i < T.N; i += 2) { const d = (px - T.xs[i]) ** 2 + (py - T.ys[i]) ** 2; if (d < md) md = d; }
        if (Math.sqrt(md) < clear) continue;
        list.push({ x: px, y: py, type, s, r: rnd() * TAU, v: rnd(), c: Math.floor(rnd() * 3) });
      }
    }
    decorCache.set(T, list);
    return list;
  }

  function makeCar(p, x, y, a, W) {
    const c = {
      p, color: COLORS[p.color], name: p.name, x, y, a, vx: 0, vy: 0, steer: 0, alive: true,
      item: null, roll: 0, rollItem: null, turbo: 0, shield: 0, spin: 0, spinDir: 1, invuln: 0, oilImm: 0,
      hp: 3, hitFlash: 0, sdT: 0, seg: 0, s: 0, prog: 0, offroad: false, warn: 0, heldT: 0,
      speedMul: p.kind === 'bot' ? 0.95 : 1, rear: null, deadT: 0,
      bot: p.kind === 'bot' ? { lane: rand(-60, 60), laneT: rand(1, 3), itemT: 1, skill: rand(0.8, 1), stuckT: 0 } : null,
    };
    if (!W.arena) {
      const pr = projectGlobal(W.map, x, y);
      c.seg = pr.seg; c.s = pr.s;
      let d = pr.s - W.s0; if (d > W.map.L / 2) d -= W.map.L; if (d < -W.map.L / 2) d += W.map.L;
      c.prog = d;
    }
    return c;
  }

  function makeWorld(map, participants, demo) {
    const arena = map.kind === 'arena';
    const W = {
      map, arena, demo, items: demo ? true : MODES[G.mode].items,
      cars: [], mines: [], oils: [], missiles: [], boxes: [], parts: [], skids: [], waves: [], toasts: [],
      time: 0, elimOrder: [], ending: 0, over: false, winner: null, shake: 0,
      cam: { x: 0, y: 0, zoom: 1 }, shrink: 1, safeR: Infinity, sdOn: false, leader: null,
      grip: map.theme.grip,
    };
    // reversa de la tabla: el que va ganando larga último
    const order = [...participants].sort((a, b) => a.score - b.score || Math.random() - 0.5);
    if (!arena) {
      const T = map;
      W.s0 = T.cum[T.startIdx];
      W.decor = genDecor(T, TRACKS.indexOf(T));
      const lanes = [-84, -28, 28, 84];
      order.forEach((p, k) => {
        const row = Math.floor(k / 4), col = k % 4;
        const pt = pointAt(T, W.s0 - 70 - row * 95 - (col % 2) * 30);
        W.cars.push(makeCar(p, pt.x + pt.nx * lanes[col], pt.y + pt.ny * lanes[col], Math.atan2(pt.uy, pt.ux), W));
      });
      if (W.items) {
        for (let s = W.s0 + 900; s < W.s0 + T.L - 600; s += 1400) {
          for (const lane of [-80, 0, 80]) {
            const pt = pointAt(T, s);
            W.boxes.push({ x: pt.x + pt.nx * lane, y: pt.y + pt.ny * lane, active: true, t: 0, ph: Math.random() * TAU });
          }
        }
      }
      const first = pointAt(T, W.s0);
      W.cam.x = first.x; W.cam.y = first.y;
    } else {
      const A = map, n = Math.max(order.length, 2);
      order.forEach((p, k) => {
        const ang = ((k + 0.5) / n) * TAU;
        const x = A.w / 2 + Math.cos(ang) * A.w * 0.25, y = A.h / 2 + Math.sin(ang) * A.h * 0.25;
        W.cars.push(makeCar(p, x, y, ang + Math.PI / 2, W));
      });
      const spots = [[300, 300], [2500, 300], [300, 1500], [2500, 1500], [1000, 900], [1800, 900], [1400, 600], [1400, 1200], [1050, 450], [1750, 450], [1050, 1350], [1750, 1350]];
      for (const [x, y] of spots) W.boxes.push({ x, y, active: true, t: 0, ph: Math.random() * TAU });
      W.cam.x = A.w / 2; W.cam.y = A.h / 2;
      W.cam.zoom = fitZoom(A);
    }
    return W;
  }

  function fitZoom(A) { return Math.max((A.w + 200) / G.viewW, (A.h + 380) / G.viewH); }

  function makeDemoWorld() {
    const T = pick(TRACKS);
    const fake = [0, 1, 2, 3, 4].map((i) => ({ key: 'demo' + i, kind: 'bot', name: '', color: (i * 3) % 8, score: 0, input: {} }));
    const W = makeWorld(T, fake, true);
    W.cars.forEach((c) => { c.speedMul = 0.85 + Math.random() * 0.1; c.demo = true; });
    return W;
  }

  // ----------------------------------------------------------- partículas
  function part(W, o) { if (W.parts.length < 1500) W.parts.push(o); }
  function explosion(W, x, y, color, big) {
    const n = big ? 34 : 18;
    for (let i = 0; i < n; i++) {
      const a = Math.random() * TAU, sp = rand(60, big ? 520 : 340);
      part(W, { k: 'fire', x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: rand(0.35, 0.8), max: 0.8, size: rand(14, big ? 34 : 24), drag: 3 });
    }
    for (let i = 0; i < n * 0.7; i++) {
      const a = Math.random() * TAU, sp = rand(30, 180);
      part(W, { k: 'smoke', x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: rand(0.8, 1.6), max: 1.6, size: rand(18, 38), drag: 1.5, grow: 30 });
    }
    if (big) {
      for (let i = 0; i < 14; i++) {
        const a = Math.random() * TAU, sp = rand(150, 520);
        part(W, { k: 'debris', x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: rand(0.7, 1.3), max: 1.3, size: rand(6, 12), drag: 2, color, rot: Math.random() * TAU, vr: rand(-12, 12) });
      }
    }
    part(W, { k: 'ring', x, y, vx: 0, vy: 0, life: 0.45, max: 0.45, size: big ? 170 : 110, drag: 0 });
  }
  function sparks(W, x, y, n, color) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * TAU, sp = rand(120, 420);
      part(W, { k: 'spark', x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: rand(0.15, 0.4), max: 0.4, size: 3, drag: 4, color: color || '#ffd75a' });
    }
  }
  function toast(W, text, color) { W.toasts.push({ text, color, t: 2.6 }); if (W.toasts.length > 4) W.toasts.shift(); }
  const globalToasts = [];
  function toastGlobal(text, color) { globalToasts.push({ text, color, t: 3 }); if (globalToasts.length > 4) globalToasts.shift(); }

  // ------------------------------------------------------------- combate
  function hit(c, kind, sx, sy, W) {
    if (!c.alive || c.invuln > 0) return false;
    if (kind === 'oil' && c.oilImm > 0) return false;
    if (c.shield > 0) {
      c.shield = 0; c.invuln = 0.35;
      SFX.block();
      sparks(W, c.x, c.y, 16, '#7ff3ff');
      return false;
    }
    if (kind === 'oil') {
      c.spin = 0.85; c.oilImm = 1.4; c.invuln = 0.2;
      SFX.slip();
      vibrate(c.p, 120);
    } else {
      c.spin = kind === 'wave' ? 0.5 : 0.85; c.invuln = 0.9; c.hitFlash = 0.5;
      const dx = c.x - sx, dy = c.y - sy, d = Math.hypot(dx, dy) || 1;
      c.vx = c.vx * 0.25 + (dx / d) * 280; c.vy = c.vy * 0.25 + (dy / d) * 280;
      vibrate(c.p, [90, 40, 180]);
      if (W.arena) damage(c, W, 1);
    }
    c.spinDir = Math.random() < 0.5 ? -1 : 1;
    return true;
  }
  function damage(c, W, n) {
    c.hp -= n; c.hitFlash = 0.5;
    if (c.hp <= 0) eliminate(c, W, 'destroyed');
  }
  function eliminate(c, W, why) {
    if (!c.alive || W.demo || W.over) return;
    const alive = W.cars.filter((x) => x.alive).length;
    if (alive <= 1) { c.hp = Math.max(c.hp, 1); return; } // el último nunca muere
    c.alive = false; c.deadT = 0; c.item = null; c.roll = 0;
    W.elimOrder.push(c);
    (W.log || (W.log = [])).push({ name: c.name, bot: !!c.bot, t: +(W.time - (W.raceStart || 0)).toFixed(1), why });
    explosion(W, c.x, c.y, c.color.hex, true);
    SFX.bigBoom(); SFX.elim();
    W.shake = Math.max(W.shake, 0.6);
    toast(W, why === 'camera' ? `${c.name} quedó atrás` : `${c.name} explotó`, c.color.hex);
    vibrate(c.p, [220, 80, 320]);
  }

  function rollItem(c, W) {
    let w;
    if (W.arena) w = { missile: 4, mine: 3, oil: 2, shield: 2, wave: 3, turbo: 2 };
    else {
      const alive = W.cars.filter((x) => x.alive).sort((a, b) => b.prog - a.prog);
      const rank = alive.indexOf(c), n = alive.length;
      if (rank === 0) w = { mine: 4, oil: 4, shield: 3, wave: 1, turbo: 1, missile: 1 };
      else if (rank < n / 2) w = { turbo: 3, missile: 3, mine: 2, oil: 2, shield: 1, wave: 2 };
      else w = { turbo: 6, missile: 4, wave: 2, shield: 1 };
    }
    const total = Object.values(w).reduce((a, b) => a + b, 0);
    let r = Math.random() * total;
    for (const [k, v] of Object.entries(w)) { r -= v; if (r <= 0) return k; }
    return 'turbo';
  }

  function chooseMissileTarget(c, W) {
    let best = null, bestScore = Infinity;
    const fx = Math.cos(c.a), fy = Math.sin(c.a);
    for (const o of W.cars) {
      if (o === c || !o.alive) continue;
      const dx = o.x - c.x, dy = o.y - c.y, d = Math.hypot(dx, dy);
      if (d > 1500) continue;
      const cos = (dx * fx + dy * fy) / (d || 1);
      let score;
      if (!W.arena) {
        const ahead = o.prog - c.prog;
        if (ahead <= 0 && cos < 0.5) continue;
        score = ahead > 0 ? ahead : d + 800;
      } else {
        if (cos < 0.2) continue;
        score = d * (1.6 - cos);
      }
      if (score < bestScore) { bestScore = score; best = o; }
    }
    return best;
  }

  function useItem(c, W) {
    const it = c.item;
    if (!it || !c.alive || c.spin > 0) return;
    c.item = null; c.heldT = 0;
    const fx = Math.cos(c.a), fy = Math.sin(c.a);
    switch (it) {
      case 'turbo':
        c.turbo = 1.7; SFX.turbo(); break;
      case 'missile': {
        const sp = Math.max(980, Math.hypot(c.vx, c.vy) + 520);
        W.missiles.push({ x: c.x + fx * 34, y: c.y + fy * 34, a: c.a, v: sp, owner: c, target: chooseMissileTarget(c, W), life: 2.8, age: 0, seg: c.seg });
        SFX.missile(); break;
      }
      case 'mine':
        W.mines.push({ x: c.x - fx * 38, y: c.y - fy * 38, owner: c, arm: 0.2, ownArm: 0.9, life: W.arena ? 22 : 30, ph: Math.random() * TAU });
        SFX.drop(); break;
      case 'oil': {
        const pts = [];
        for (let i = 0; i < 9; i++) pts.push(rand(0.75, 1.15));
        W.oils.push({ x: c.x - fx * 46, y: c.y - fy * 46, r: 48, life: 16, owner: c, ownT: 0.8, pts, rot: Math.random() * TAU });
        SFX.drop(); break;
      }
      case 'shield':
        c.shield = 6; SFX.shield(); break;
      case 'wave': {
        W.waves.push({ x: c.x, y: c.y, r: 20, max: 340, life: 0.45 });
        SFX.wave();
        for (const o of W.cars) {
          if (o === c || !o.alive) continue;
          const dx = o.x - c.x, dy = o.y - c.y, d = Math.hypot(dx, dy) || 1;
          if (d > 340) continue;
          const f = 280 + 520 * (1 - d / 340);
          if (o.shield > 0 && d < 200) { hit(o, 'wave', c.x, c.y, W); continue; }
          o.vx += (dx / d) * f; o.vy += (dy / d) * f;
          if (d < 200) hit(o, 'wave', c.x, c.y, W);
        }
        W.shake = Math.max(W.shake, 0.35);
        break;
      }
    }
  }

  // ------------------------------------------------------------- física
  function stepCar(c, W, dt) {
    const inp = c.p.input || {};
    let L = !!inp.l, R = !!inp.r, brake = !!inp.b;
    if (L && R) { brake = true; L = R = false; }
    if (c.spin > 0) { L = R = brake = false; }
    const tgt = (R ? 1 : 0) - (L ? 1 : 0);
    c.steer += clamp(tgt - c.steer, -dt * 10, dt * 10);

    let fx = Math.cos(c.a), fy = Math.sin(c.a);
    let fwd = c.vx * fx + c.vy * fy;
    const speedK = clamp(Math.abs(fwd) / 200, 0.3, 1);
    if (c.spin > 0) {
      c.a += c.spinDir * 11 * dt * clamp(c.spin, 0.35, 1);
      c.spin -= dt;
    } else {
      c.a += c.steer * TURN * dt * speedK;
    }
    fx = Math.cos(c.a); fy = Math.sin(c.a);
    const rx = -fy, ry = fx;
    fwd = c.vx * fx + c.vy * fy;
    let lat = c.vx * rx + c.vy * ry;
    let max = MAX_SPEED * c.speedMul;
    if (W.arena) max *= 0.78;
    if (c.offroad) max *= 0.55;
    if (c.turbo > 0) { max *= 1.55; c.turbo -= dt; }
    if (brake) max *= 0.3;
    if (Math.abs(c.steer) > 0.6) max *= 0.95;
    if (c.spin > 0) fwd *= Math.exp(-1.7 * dt);
    else if (fwd < max) fwd = Math.min(max, fwd + ACCEL * (c.turbo > 0 ? 2.4 : 1) * dt);
    else fwd = Math.max(max, fwd - (brake ? 1100 : 420) * dt);
    const grip = c.spin > 0 ? 1.4 : W.grip * (c.offroad ? 0.85 : 1);
    lat *= Math.exp(-grip * dt);
    c.vx = fx * fwd + rx * lat; c.vy = fy * fwd + ry * lat;
    c.x += c.vx * dt; c.y += c.vy * dt;

    // marcas de frenada
    const rxp = c.x - fx * 17, ryp = c.y - fy * 17;
    const wl = { x: rxp + rx * 11, y: ryp + ry * 11 }, wr = { x: rxp - rx * 11, y: ryp - ry * 11 };
    if ((Math.abs(lat) > 120 || (brake && fwd > 220) || c.spin > 0) && c.rear) {
      W.skids.push([c.rear[0].x, c.rear[0].y, wl.x, wl.y], [c.rear[1].x, c.rear[1].y, wr.x, wr.y]);
      if (W.skids.length > 900) W.skids.splice(0, W.skids.length - 900);
      if (Math.random() < 0.3) part(W, { k: 'smoke', x: rxp, y: ryp, vx: rand(-20, 20), vy: rand(-20, 20), life: 0.6, max: 0.6, size: 10, grow: 26, drag: 1, light: true });
    }
    c.rear = [wl, wr];

    if (c.turbo > 0) {
      for (let i = 0; i < 2; i++) part(W, { k: 'fire', x: c.x - fx * 26 + rand(-5, 5), y: c.y - fy * 26 + rand(-5, 5), vx: -fx * 220 + rand(-40, 40), vy: -fy * 220 + rand(-40, 40), life: 0.25, max: 0.3, size: rand(8, 14), drag: 2 });
    }
    if (c.offroad && Math.abs(fwd) > 150 && Math.random() < 0.25) {
      part(W, { k: 'smoke', x: rxp, y: ryp, vx: -fx * 40, vy: -fy * 40, life: 0.5, max: 0.5, size: 8, grow: 20, drag: 1, dust: W.map.theme.runoff });
    }
    c.shield = Math.max(0, c.shield - dt);
    c.invuln = Math.max(0, c.invuln - dt);
    c.oilImm = Math.max(0, c.oilImm - dt);
    c.hitFlash = Math.max(0, c.hitFlash - dt);
    if (c.item) c.heldT += dt;
    if (c.roll > 0) { c.roll -= dt; if (c.roll <= 0) { c.item = c.rollItem; c.rollItem = null; vibrate(c.p, 40); } }
  }

  function trackConstrain(c, W) {
    const T = W.map;
    const pr = project(T, c.x, c.y, c.seg, 8);
    let ds = pr.s - c.s;
    if (ds > T.L / 2) ds -= T.L; else if (ds < -T.L / 2) ds += T.L;
    c.prog += ds; c.s = pr.s; c.seg = pr.seg;
    const ad = Math.abs(pr.lat);
    c.offroad = ad > ROAD + CURB * 0.6;
    const lim = WALL - CAR_R * 0.8;
    if (ad > lim) {
      const sg = Math.sign(pr.lat), nx = pr.nx * sg, ny = pr.ny * sg;
      c.x -= nx * (ad - lim); c.y -= ny * (ad - lim);
      const vn = c.vx * nx + c.vy * ny;
      if (vn > 0) {
        c.vx -= nx * vn * 1.35; c.vy -= ny * vn * 1.35;
        c.vx *= 0.97; c.vy *= 0.97;
        if (vn > 140) {
          sparks(W, c.x + nx * CAR_R, c.y + ny * CAR_R, Math.min(14, vn / 40));
          SFX.thud(vn);
          if (vn > 300) W.shake = Math.max(W.shake, vn / 3000);
        }
      }
    }
  }

  // Devuelve la velocidad de impacto (0 si no chocó)
  function arenaConstrain(o, A, r, bounce) {
    let impact = 0;
    const wall = (nx, ny) => {
      const vn = o.vx * nx + o.vy * ny;
      if (vn < 0) { o.vx -= (1 + bounce) * vn * nx; o.vy -= (1 + bounce) * vn * ny; impact = Math.max(impact, -vn); }
    };
    if (o.x < r) { o.x = r; wall(1, 0); }
    if (o.x > A.w - r) { o.x = A.w - r; wall(-1, 0); }
    if (o.y < r) { o.y = r; wall(0, 1); }
    if (o.y > A.h - r) { o.y = A.h - r; wall(0, -1); }
    for (const k of A.circles) {
      const dx = o.x - k.x, dy = o.y - k.y, d = Math.hypot(dx, dy), m = k.r + r;
      if (d < m && d > 0) { const nx = dx / d, ny = dy / d; o.x = k.x + nx * m; o.y = k.y + ny * m; wall(nx, ny); }
    }
    for (const q of A.rects) {
      const cx = clamp(o.x, q.x, q.x + q.w), cy = clamp(o.y, q.y, q.y + q.h);
      const dx = o.x - cx, dy = o.y - cy, d2 = dx * dx + dy * dy;
      if (d2 < r * r) {
        let nx, ny, d;
        if (d2 > 1e-6) { d = Math.sqrt(d2); nx = dx / d; ny = dy / d; o.x = cx + nx * r; o.y = cy + ny * r; }
        else {
          const opts = [[o.x - q.x, -1, 0], [q.x + q.w - o.x, 1, 0], [o.y - q.y, 0, -1], [q.y + q.h - o.y, 0, 1]].sort((a, b) => a[0] - b[0]);
          nx = opts[0][1]; ny = opts[0][2];
          o.x += nx * (opts[0][0] + r); o.y += ny * (opts[0][0] + r);
        }
        wall(nx, ny);
      }
    }
    return impact;
  }

  function carCollisions(W) {
    const cs = W.cars;
    for (let i = 0; i < cs.length; i++) {
      const a = cs[i]; if (!a.alive) continue;
      for (let j = i + 1; j < cs.length; j++) {
        const b = cs[j]; if (!b.alive) continue;
        const dx = b.x - a.x, dy = b.y - a.y, d2 = dx * dx + dy * dy, m = CAR_R * 2;
        if (d2 >= m * m || d2 === 0) continue;
        const d = Math.sqrt(d2), nx = dx / d, ny = dy / d, ov = (m - d) / 2;
        a.x -= nx * ov; a.y -= ny * ov; b.x += nx * ov; b.y += ny * ov;
        const rv = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
        if (rv < 0) {
          const jImp = (-(1 + 0.55) * rv) / 2;
          const ka = b.shield > 0 ? 1.9 : 1, kb = a.shield > 0 ? 1.9 : 1;
          a.vx -= jImp * nx * ka; a.vy -= jImp * ny * ka;
          b.vx += jImp * nx * kb; b.vy += jImp * ny * kb;
          if (-rv > 120) SFX.bump(-rv);
          if (-rv > 260) sparks(W, a.x + nx * CAR_R, a.y + ny * CAR_R, 6);
        }
      }
    }
  }

  // ------------------------------------------------------------- bots
  function botThink(c, W, dt) {
    const b = c.bot, inp = c.p.input;
    const speed = Math.hypot(c.vx, c.vy);
    b.laneT -= dt;
    if (b.laneT <= 0) { b.laneT = rand(1.5, 4); b.lane = rand(-70, 70); }
    let tx, ty, brake = false;
    if (!W.arena) {
      const T = W.map;
      const look = 9 + Math.floor(speed / 45);
      const i = (c.seg + look) % T.N;
      let lane = b.lane;
      // esquiva minas y aceite cercanos
      for (const m of W.mines.concat(W.oils)) {
        const dx = m.x - T.xs[i], dy = m.y - T.ys[i];
        if (dx * dx + dy * dy < 150 * 150) { const side = dx * -T.ty[i] + dy * T.tx[i]; lane = side > 0 ? -90 : 90; }
      }
      tx = T.xs[i] - T.ty[i] * lane; ty = T.ys[i] + T.tx[i] * lane;
      const j = (c.seg + look * 2) % T.N;
      const dot = T.tx[c.seg] * T.tx[j] + T.ty[c.seg] * T.ty[j];
      if (dot < 0.35 && speed > 330 + 80 * b.skill) brake = true;
    } else {
      const A = W.map;
      let target = null;
      if (!c.item && c.roll <= 0) {
        let bd = Infinity;
        for (const bx of W.boxes) if (bx.active) { const d = Math.hypot(bx.x - c.x, bx.y - c.y); if (d < bd) { bd = d; target = bx; } }
      }
      if (!target) {
        let bd = Infinity;
        for (const o of W.cars) if (o !== c && o.alive) { const d = Math.hypot(o.x - c.x, o.y - c.y); if (d < bd) { bd = d; target = o; } }
      }
      tx = target ? target.x + (target.vx || 0) * 0.3 : A.w / 2;
      ty = target ? target.y + (target.vy || 0) * 0.3 : A.h / 2;
      // evitar paredes y obstáculos
      const px = c.x + Math.cos(c.a) * 200, py = c.y + Math.sin(c.a) * 200;
      let danger = px < 120 || py < 120 || px > A.w - 120 || py > A.h - 120;
      for (const k of A.circles) if (Math.hypot(px - k.x, py - k.y) < k.r + 60) danger = true;
      for (const q of A.rects) if (px > q.x - 60 && px < q.x + q.w + 60 && py > q.y - 60 && py < q.y + q.h + 60) danger = true;
      if (W.sdOn && Math.hypot(c.x - A.w / 2, c.y - A.h / 2) > W.safeR - 220) danger = true;
      if (danger) { tx = A.w / 2 + Math.sin(W.time + c.p.color) * 300; ty = A.h / 2 + Math.cos(W.time * 0.7 + c.p.color) * 200; }
      if (speed < 60) { b.stuckT += dt; } else b.stuckT = 0;
      if (b.stuckT > 0.8) { inp.l = true; inp.r = false; inp.b = false; if (b.stuckT > 1.6) b.stuckT = 0; return; }
    }
    const diff = angNorm(Math.atan2(ty - c.y, tx - c.x) - c.a);
    inp.l = diff < -0.07; inp.r = diff > 0.07; inp.b = brake;
    if (c.item) {
      b.itemT -= dt;
      if (b.itemT <= 0 && botWantsItem(c, W)) { inp.fire = true; b.itemT = rand(0.5, 2); }
    }
  }

  function botWantsItem(c, W) {
    if (c.heldT > 7) return true;
    const fx = Math.cos(c.a), fy = Math.sin(c.a);
    let ahead = Infinity, behind = Infinity, near = Infinity;
    for (const o of W.cars) {
      if (o === c || !o.alive) continue;
      const dx = o.x - c.x, dy = o.y - c.y, d = Math.hypot(dx, dy), cos = (dx * fx + dy * fy) / (d || 1);
      if (cos > 0.75) ahead = Math.min(ahead, d);
      if (cos < -0.5) behind = Math.min(behind, d);
      near = Math.min(near, d);
    }
    switch (c.item) {
      case 'turbo':
        if (W.arena) return ahead < 700;
        { const T = W.map, j = (c.seg + 25) % T.N; return T.tx[c.seg] * T.tx[j] + T.ty[c.seg] * T.ty[j] > 0.9; }
      case 'missile': return ahead < 1100;
      case 'mine': case 'oil': return behind < 450;
      case 'wave': return near < 190;
      case 'shield': return W.missiles.some((m) => m.target === c) || Math.random() < 0.02;
    }
    return true;
  }

  // ---------------------------------------------------------- teclado
  const keysDown = new Set();
  addEventListener('keydown', (e) => {
    SFX.ensure();
    if (e.repeat) return;
    keysDown.add(e.code);
    for (const p of G.players) if (p.kind === 'kb' && p.kb.f === e.code) p.input.fire = true;
    if (e.code === 'Enter' && G.phase === 'lobby') startMatch();
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault();
  });
  addEventListener('keyup', (e) => keysDown.delete(e.code));
  addEventListener('blur', () => keysDown.clear());
  function readKeyboard(p) {
    p.input.l = keysDown.has(p.kb.l); p.input.r = keysDown.has(p.kb.r); p.input.b = keysDown.has(p.kb.b);
  }

  // -------------------------------------------------------- paso del mundo
  function stepWorld(W, dt) {
    W.time += dt;
    const live = W.demo || G.phase === 'race' || G.phase === 'roundover' || G.phase === 'matchover';
    for (const c of W.cars) {
      if (!c.alive) { c.deadT += dt; continue; }
      if (c.bot) botThink(c, W, dt);
      else if (c.p.kind === 'kb') readKeyboard(c.p);
      if (!live) { c.p.input.fire = false; continue; }
      if (c.p.input.fire) { c.p.input.fire = false; useItem(c, W); }
      stepCar(c, W, dt);
      if (W.arena) {
        const imp = arenaConstrain(c, W.map, CAR_R, 0.45);
        if (imp > 140) { sparks(W, c.x, c.y, Math.min(14, imp / 40)); SFX.thud(imp); }
      } else trackConstrain(c, W);
    }
    if (live) carCollisions(W);

    // cajas
    for (const b of W.boxes) {
      if (!b.active) { b.t -= dt; if (b.t <= 0) b.active = true; continue; }
      for (const c of W.cars) {
        if (!c.alive || c.item || c.roll > 0) continue;
        if ((c.x - b.x) ** 2 + (c.y - b.y) ** 2 < (CAR_R + 22) ** 2) {
          b.active = false; b.t = W.arena ? 2.5 : 3;
          c.roll = 0.7; c.rollItem = rollItem(c, W);
          SFX.pickup();
          for (let i = 0; i < 10; i++) part(W, { k: 'spark', x: b.x, y: b.y, vx: rand(-260, 260), vy: rand(-260, 260), life: 0.4, max: 0.4, size: 3, drag: 3, color: pick(['#ffd34d', '#ff7a1a', '#ffffff']) });
          break;
        }
      }
    }

    // misiles
    for (let i = W.missiles.length - 1; i >= 0; i--) {
      const m = W.missiles[i];
      m.age += dt; m.life -= dt;
      if (m.target && m.target.alive && m.age > 0.12) {
        const want = Math.atan2(m.target.y - m.y, m.target.x - m.x);
        m.a += clamp(angNorm(want - m.a), -3.6 * dt, 3.6 * dt);
      } else if (!W.arena && m.age > 0.12) {
        // sin objetivo: sigue la pista
        const T = W.map, k = (m.seg + 10) % T.N;
        m.a += clamp(angNorm(Math.atan2(T.ys[k] - m.y, T.xs[k] - m.x) - m.a), -3 * dt, 3 * dt);
      }
      m.x += Math.cos(m.a) * m.v * dt; m.y += Math.sin(m.a) * m.v * dt;
      if (Math.random() < 0.8) part(W, { k: 'smoke', x: m.x - Math.cos(m.a) * 14, y: m.y - Math.sin(m.a) * 14, vx: rand(-15, 15), vy: rand(-15, 15), life: 0.5, max: 0.5, size: 6, grow: 18, drag: 1, light: true });
      let boom = m.life <= 0;
      if (!W.arena) {
        const pr = project(W.map, m.x, m.y, m.seg, 10);
        m.seg = pr.seg;
        if (Math.abs(pr.lat) > WALL - 4) boom = true;
      } else {
        const o = { x: m.x, y: m.y, vx: 0, vy: 0 };
        arenaConstrain(o, W.map, 6, 0);
        if (Math.abs(o.x - m.x) > 0.01 || Math.abs(o.y - m.y) > 0.01) boom = true;
      }
      for (const c of W.cars) {
        if (!c.alive || (c === m.owner && m.age < 0.5)) continue;
        if ((c.x - m.x) ** 2 + (c.y - m.y) ** 2 < (CAR_R + 9) ** 2) { hit(c, 'missile', m.x - Math.cos(m.a) * 30, m.y - Math.sin(m.a) * 30, W); boom = true; break; }
      }
      if (boom) { explosion(W, m.x, m.y, null, false); SFX.boom(); W.shake = Math.max(W.shake, 0.25); W.missiles.splice(i, 1); }
    }

    // minas
    for (let i = W.mines.length - 1; i >= 0; i--) {
      const m = W.mines[i];
      m.arm -= dt; m.ownArm -= dt; m.life -= dt;
      let boom = false;
      for (const c of W.cars) {
        if (!c.alive) continue;
        if (c === m.owner ? m.ownArm > 0 : m.arm > 0) continue;
        if ((c.x - m.x) ** 2 + (c.y - m.y) ** 2 < (CAR_R + 13) ** 2) { hit(c, 'mine', m.x, m.y, W); boom = true; break; }
      }
      for (const o of W.missiles) if ((o.x - m.x) ** 2 + (o.y - m.y) ** 2 < 24 * 24) boom = true;
      if (boom) { explosion(W, m.x, m.y, null, false); SFX.boom(); W.shake = Math.max(W.shake, 0.3); W.mines.splice(i, 1); }
      else if (m.life <= 0) { sparks(W, m.x, m.y, 6, '#888'); W.mines.splice(i, 1); }
    }

    // aceite
    for (let i = W.oils.length - 1; i >= 0; i--) {
      const o = W.oils[i];
      o.life -= dt; o.ownT -= dt;
      if (o.life <= 0) { W.oils.splice(i, 1); continue; }
      for (const c of W.cars) {
        if (!c.alive || c.spin > 0 || (c === o.owner && o.ownT > 0)) continue;
        if ((c.x - o.x) ** 2 + (c.y - o.y) ** 2 < (o.r + 6) ** 2) hit(c, 'oil', o.x, o.y, W);
      }
    }

    for (let i = W.waves.length - 1; i >= 0; i--) { const w = W.waves[i]; w.life -= dt; w.r += (w.max / 0.45) * dt; if (w.life <= 0) W.waves.splice(i, 1); }
    for (let i = W.parts.length - 1; i >= 0; i--) {
      const p = W.parts[i];
      p.life -= dt;
      if (p.life <= 0) { W.parts.splice(i, 1); continue; }
      const k = Math.exp(-(p.drag || 0) * dt);
      p.vx *= k; p.vy *= k; p.x += p.vx * dt; p.y += p.vy * dt;
      if (p.grow) p.size += p.grow * dt;
      if (p.vr) p.rot += p.vr * dt;
    }
    for (let i = W.toasts.length - 1; i >= 0; i--) { W.toasts[i].t -= dt; if (W.toasts[i].t <= 0) W.toasts.splice(i, 1); }
    W.shake = Math.max(0, W.shake - dt * 1.6);

    updateCamera(W, dt, live);
    if (!W.demo && G.phase === 'race' && !W.over) rules(W, dt);
    if (W.ending > 0) { W.ending -= dt; if (W.ending <= 0) endRound(); }
  }

  function updateCamera(W, dt, live) {
    const alive = W.cars.filter((c) => c.alive);
    if (!alive.length) return;
    if (!W.arena) {
      let leader = alive[0];
      for (const c of alive) if (c.prog > leader.prog) leader = c;
      W.leader = leader;
      const look = 0.28 * W.shrink;
      const tx = leader.x + leader.vx * look, ty = leader.y + leader.vy * look;
      const k = live ? Math.min(1, dt * 5) : Math.min(1, dt * 3);
      W.cam.x += (tx - W.cam.x) * k; W.cam.y += (ty - W.cam.y) * k;
      W.cam.zoom = 1;
    } else {
      const A = W.map;
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const c of alive) { x0 = Math.min(x0, c.x); y0 = Math.min(y0, c.y); x1 = Math.max(x1, c.x); y1 = Math.max(y1, c.y); }
      const pad = 380;
      const z = clamp(Math.max((x1 - x0 + pad * 2) / G.viewW, (y1 - y0 + pad * 2) / G.viewH), 1, fitZoom(A));
      W.cam.zoom += (z - W.cam.zoom) * Math.min(1, dt * 2);
      const vw = G.viewW * W.cam.zoom, vh = G.viewH * W.cam.zoom;
      let cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
      cx = vw >= A.w + 200 ? A.w / 2 : clamp(cx, vw / 2 - 100, A.w + 100 - vw / 2);
      cy = vh >= A.h + 200 ? A.h / 2 : clamp(cy, vh / 2 - 100, A.h + 100 - vh / 2);
      W.cam.x += (cx - W.cam.x) * Math.min(1, dt * 3); W.cam.y += (cy - W.cam.y) * Math.min(1, dt * 3);
    }
  }

  function rules(W, dt) {
    if (!W.arena) {
      const t = W.time - (W.raceStart || 0);
      W.shrink = 1 - (1 - KO_SD_MIN) * clamp((t - KO_SD_START) / KO_SD_LEN, 0, 1);
      if (t > KO_SD_START && !W.sdOn) { W.sdOn = true; SFX.sudden(); toast(W, '¡MUERTE SÚBITA! La pantalla se achica', '#ff4d4d'); }
      const hw = (G.viewW / 2) * W.shrink, hh = (G.viewH / 2) * W.shrink;
      const out = [];
      for (const c of W.cars) {
        if (!c.alive) continue;
        const ex = Math.abs(c.x - W.cam.x) - hw, ey = Math.abs(c.y - W.cam.y) - hh;
        c.warn = Math.max(ex, ey) > -150 ? 1 : 0;
        if (ex > 10 || ey > 10) out.push(c);
      }
      out.sort((a, b) => a.prog - b.prog).forEach((c) => eliminate(c, W, 'camera'));
    } else {
      const A = W.map, t = W.time - (W.raceStart || 0);
      if (t > AR_SD_START) {
        if (!W.sdOn) { W.sdOn = true; SFX.sudden(); toast(W, '¡MUERTE SÚBITA! El cerco se cierra', '#ff4d4d'); }
        W.safeR = 1900 - 1580 * clamp((t - AR_SD_START) / AR_SD_LEN, 0, 1);
        for (const c of W.cars) {
          if (!c.alive) continue;
          if (Math.hypot(c.x - A.w / 2, c.y - A.h / 2) > W.safeR) {
            c.sdT += dt;
            if (c.sdT > 0.9) { c.sdT = 0; damage(c, W, 1); sparks(W, c.x, c.y, 10, '#ff5050'); vibrate(c.p, 80); }
          } else c.sdT = Math.max(0, c.sdT - dt);
        }
      }
    }
    const alive = W.cars.filter((c) => c.alive);
    if (alive.length <= 1 && !W.ending) { W.ending = 1.6; W.winner = alive[0] || null; W.over = true; }
  }

  // --------------------------------------------------------- fases
  function participants() { return G.players.filter((p) => p.kind !== 'phone' || p.connected); }

  function startMatch() {
    if (G.phase !== 'lobby' && G.phase !== 'matchover') return;
    if (participants().length < 2) { flashLobbyHint(); return; }
    SFX.ensure();
    G.players = G.players.filter((p) => p.kind !== 'phone' || p.connected);
    for (const p of G.players) { p.score = 0; p.lastGain = 0; }
    G.round = 0; G.champion = null;
    G.trackQueue = shuffle([...TRACKS.keys()]);
    G.arenaIdx = Math.floor(Math.random() * ARENAS.length);
    $('lobby').classList.add('hidden');
    $('matchOver').classList.add('hidden');
    nextRound();
  }

  function nextMap() {
    if (MODES[G.mode].arena) { G.arenaIdx = (G.arenaIdx + 1) % ARENAS.length; return ARENAS[G.arenaIdx]; }
    if (!G.trackQueue.length) G.trackQueue = shuffle([...TRACKS.keys()]);
    return TRACKS[G.trackQueue.shift()];
  }
  function peekNextMapName() {
    if (MODES[G.mode].arena) return ARENAS[(G.arenaIdx + 1) % ARENAS.length].name;
    return G.trackQueue.length ? TRACKS[G.trackQueue[0]].name : 'Pista sorpresa';
  }

  function nextRound() {
    G.round++;
    const map = nextMap();
    G.world = makeWorld(map, participants(), false);
    G.phase = 'intro'; G.phaseT = 0; G.countShown = 4;
    $('roundOver').classList.add('hidden');
  }

  function endRound() {
    const W = G.world;
    const n = W.cars.length, podium = Math.min(3, n - 1);
    const order = [];
    if (W.winner) order.push(W.winner);
    for (let i = W.elimOrder.length - 1; i >= 0; i--) order.push(W.elimOrder[i]);
    for (const p of G.players) p.lastGain = 0;
    order.forEach((c, k) => {
      const pts = Math.max(0, podium - k);
      if (G.players.includes(c.p)) { c.p.score += pts; c.p.lastGain = pts; c.p.lastPlace = k + 1; }
    });
    G.roundWinner = W.winner ? W.winner.p : null;
    if (W.winner) { SFX.win(); vibrate(W.winner.p, [60, 60, 60, 60, 200]); }
    const top = Math.max(...G.players.map((p) => p.score));
    const leaders = G.players.filter((p) => p.score === top);
    G.champion = top >= G.target && leaders.length === 1 ? leaders[0] : null;
    G.phase = 'roundover'; G.phaseT = 0;
    showRoundOver();
  }

  function showRoundOver() {
    const W = G.world, wn = G.roundWinner;
    $('roTitle').innerHTML = wn ? `<span style="color:${COLORS[wn.color].hex}">${esc(wn.name)}</span> gana la ronda` : 'Ronda sin ganador';
    const list = [...G.players].sort((a, b) => b.score - a.score);
    $('roList').innerHTML = list.map((p) => `
      <div class="ro-row">
        <span class="ro-dot" style="background:${COLORS[p.color].hex}"></span>
        <span class="ro-name">${esc(p.name)}</span>
        <span class="ro-gain">${p.lastGain ? '+' + p.lastGain : ''}</span>
        <span class="ro-bar"><i style="width:${Math.min(100, ((p.score - p.lastGain) / G.target) * 100)}%;background:${COLORS[p.color].hex}" data-to="${Math.min(100, (p.score / G.target) * 100)}"></i></span>
        <span class="ro-score">${p.score}<small>/${G.target}</small></span>
      </div>`).join('');
    $('roNext').textContent = G.champion ? '¡Tenemos campeón!' : `Siguiente: ${peekNextMapName()}`;
    $('roundOver').classList.remove('hidden');
    setTimeout(() => document.querySelectorAll('#roList .ro-bar i').forEach((el) => { el.style.width = el.dataset.to + '%'; }), 350);
    void W;
  }

  function showMatchOver() {
    G.phase = 'matchover'; G.phaseT = 0;
    $('roundOver').classList.add('hidden');
    const ch = G.champion;
    $('moTitle').innerHTML = `<span style="color:${COLORS[ch.color].hex}">${esc(ch.name)}</span> gana la copa`;
    const list = [...G.players].sort((a, b) => b.score - a.score);
    $('moList').innerHTML = list.map((p, i) => `
      <div class="mo-row ${i === 0 ? 'first' : ''}">
        <span class="mo-pos">${['🥇', '🥈', '🥉'][i] || i + 1}</span>
        <span class="ro-dot" style="background:${COLORS[p.color].hex}"></span>
        <span class="ro-name">${esc(p.name)}</span>
        <span class="ro-score">${p.score}</span>
      </div>`).join('');
    $('matchOver').classList.remove('hidden');
    SFX.fanfare();
    vibrate(ch, [100, 50, 100, 50, 400]);
    const W = G.world;
    for (let i = 0; i < 160; i++) {
      part(W, { k: 'confetti', x: W.cam.x + rand(-G.viewW / 2, G.viewW / 2), y: W.cam.y - G.viewH / 2 - rand(0, 400), vx: rand(-60, 60), vy: rand(150, 380), life: rand(3, 5), max: 5, size: rand(6, 12), drag: 0.2, color: pick(COLORS).hex, rot: Math.random() * TAU, vr: rand(-8, 8) });
    }
  }

  function goLobby() {
    G.phase = 'lobby'; G.phaseT = 0; G.champion = null;
    G.players = G.players.filter((p) => {
      if (p.kind === 'phone' && !p.connected) { net.send({ t: 'drop', id: p.phoneId }); return false; }
      return true;
    });
    for (const p of G.players) { p.score = 0; p.lastGain = 0; }
    G.world = makeDemoWorld();
    $('roundOver').classList.add('hidden');
    $('matchOver').classList.add('hidden');
    $('lobby').classList.remove('hidden');
    refreshLobby();
  }

  function update(dt) {
    G.phaseT += dt;
    document.body.classList.toggle('ingame', G.phase !== 'lobby');
    const W = G.world;
    for (let i = globalToasts.length - 1; i >= 0; i--) { globalToasts[i].t -= dt; if (globalToasts[i].t <= 0) globalToasts.splice(i, 1); }
    if (G.phase === 'intro') {
      const n = 3 - Math.floor((G.phaseT - 0.6) / 0.8);
      if (G.phaseT > 0.6 && n !== G.countShown && n >= 0) { G.countShown = n; SFX.count(n); }
      if (G.phaseT >= 0.6 + 0.8 * 3) { G.phase = 'race'; W.raceStart = W.time; SFX.count(0); for (const p of G.players) p.input.fire = false; }
    } else if (G.phase === 'roundover') {
      if (G.phaseT > 6) { if (G.champion) showMatchOver(); else nextRound(); }
    } else if (G.phase === 'matchover') {
      if (G.phaseT > 45) goLobby();
    }
    if (W) stepWorld(W, dt);
  }

  // ------------------------------------------------------------- render
  const patternCache = new Map();
  function groundPattern(key, theme) {
    if (patternCache.has(key)) return patternCache.get(key);
    const cv = document.createElement('canvas');
    cv.width = cv.height = 256;
    const g = cv.getContext('2d');
    const rnd = seeded(key.length * 99 + 7);
    g.fillStyle = theme.ground; g.fillRect(0, 0, 256, 256);
    if (key === 'fabrica') {
      g.strokeStyle = 'rgba(0,0,0,0.25)'; g.lineWidth = 3;
      g.strokeRect(1.5, 1.5, 125, 125); g.strokeRect(129.5, 1.5, 125, 125); g.strokeRect(1.5, 129.5, 125, 125); g.strokeRect(129.5, 129.5, 125, 125);
      g.fillStyle = 'rgba(255,255,255,0.12)';
      for (const [x, y] of [[10, 10], [118, 10], [10, 118], [118, 118]]) for (const [ox, oy] of [[0, 0], [128, 0], [0, 128], [128, 128]]) { g.beginPath(); g.arc(x + ox, y + oy, 3, 0, TAU); g.fill(); }
      for (let i = 0; i < 40; i++) { g.fillStyle = `rgba(0,0,0,${rnd() * 0.08})`; g.fillRect(rnd() * 256, rnd() * 256, rnd() * 40, rnd() * 6); }
    } else {
      for (let i = 0; i < 260; i++) {
        g.fillStyle = theme.dots[Math.floor(rnd() * theme.dots.length)];
        const x = rnd() * 256, y = rnd() * 256, r = 2 + rnd() * 7;
        for (const [ox, oy] of [[0, 0], [256, 0], [-256, 0], [0, 256], [0, -256]]) { g.beginPath(); g.ellipse(x + ox, y + oy, r, r * (0.5 + rnd() * 0.5), rnd() * TAU, 0, TAU); g.fill(); }
      }
    }
    const pat = ctx.createPattern(cv, 'repeat');
    patternCache.set(key, pat);
    return pat;
  }

  function trackPaths(T) {
    if (T._paths) return T._paths;
    const mk = (d) => {
      const p = new Path2D();
      for (let i = 0; i < T.N; i++) {
        const x = T.xs[i] - T.ty[i] * d, y = T.ys[i] + T.tx[i] * d;
        if (i === 0) p.moveTo(x, y); else p.lineTo(x, y);
      }
      p.closePath();
      return p;
    };
    T._paths = { center: mk(0), wallL: mk(-(WALL + 8)), wallR: mk(WALL + 8), edgeL: mk(-(ROAD - 12)), edgeR: mk(ROAD - 12) };
    return T._paths;
  }

  function drawTrack(W, v) {
    const T = W.map, th = T.theme, P = trackPaths(T);
    ctx.fillStyle = groundPattern(T.themeKey, th);
    ctx.fillRect(v.x0, v.y0, v.x1 - v.x0, v.y1 - v.y0);
    ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    ctx.strokeStyle = th.runoff; ctx.lineWidth = WALL * 2; ctx.stroke(P.center);
    // muros
    if (th.night) {
      ctx.globalAlpha = 0.25; ctx.lineWidth = 46;
      ctx.strokeStyle = th.wallA; ctx.stroke(P.wallL); ctx.strokeStyle = th.wallB; ctx.stroke(P.wallR);
      ctx.globalAlpha = 1; ctx.lineWidth = 10;
      ctx.strokeStyle = th.wallA; ctx.stroke(P.wallL); ctx.strokeStyle = th.wallB; ctx.stroke(P.wallR);
    } else {
      ctx.lineWidth = 18; ctx.strokeStyle = 'rgba(0,0,0,0.25)';
      ctx.save(); ctx.translate(4, 6); ctx.stroke(P.wallL); ctx.stroke(P.wallR); ctx.restore();
      ctx.strokeStyle = th.wallA; ctx.stroke(P.wallL); ctx.stroke(P.wallR);
      ctx.setLineDash([36, 36]); ctx.strokeStyle = th.wallB; ctx.lineWidth = 16; ctx.stroke(P.wallL); ctx.stroke(P.wallR); ctx.setLineDash([]);
    }
    // cordones
    ctx.lineCap = 'butt';
    ctx.strokeStyle = th.curbA; ctx.lineWidth = (ROAD + CURB) * 2; ctx.stroke(P.center);
    ctx.setLineDash([28, 28]); ctx.strokeStyle = th.curbB; ctx.stroke(P.center); ctx.setLineDash([]);
    ctx.lineCap = 'round';
    ctx.strokeStyle = th.road; ctx.lineWidth = ROAD * 2; ctx.stroke(P.center);
    ctx.strokeStyle = th.edge; ctx.lineWidth = 4; ctx.stroke(P.edgeL); ctx.stroke(P.edgeR);
    ctx.setLineDash([50, 60]); ctx.strokeStyle = th.line; ctx.lineWidth = 6; ctx.stroke(P.center); ctx.setLineDash([]);
    // línea de largada
    const st = pointAt(T, W.s0);
    ctx.save();
    ctx.translate(st.x, st.y); ctx.rotate(Math.atan2(st.uy, st.ux));
    const sq = (ROAD * 2) / 12;
    for (let r = 0; r < 2; r++) for (let k = 0; k < 12; k++) {
      ctx.fillStyle = (r + k) % 2 ? '#111' : '#fafafa';
      ctx.fillRect(-sq + r * sq, -ROAD + k * sq, sq, sq);
    }
    ctx.restore();
    drawDecor(W, v);
  }

  function inView(v, x, y, m) { return x > v.x0 - m && x < v.x1 + m && y > v.y0 - m && y < v.y1 + m; }

  function drawDecor(W, v) {
    const night = W.map.theme.night;
    for (const d of W.decor) {
      if (!inView(v, d.x, d.y, 200)) continue;
      const s = d.s;
      ctx.save(); ctx.translate(d.x, d.y);
      switch (d.type) {
        case 'tree':
          ctx.fillStyle = 'rgba(0,0,0,0.22)'; ctx.beginPath(); ctx.arc(10 * s, 12 * s, 38 * s, 0, TAU); ctx.fill();
          ctx.fillStyle = ['#2d7a2a', '#357f2e', '#2a6e35'][d.c]; ctx.beginPath(); ctx.arc(0, 0, 38 * s, 0, TAU); ctx.fill();
          ctx.fillStyle = 'rgba(255,255,255,0.12)'; ctx.beginPath(); ctx.arc(-10 * s, -10 * s, 20 * s, 0, TAU); ctx.fill();
          break;
        case 'bush':
          ctx.fillStyle = '#3c8a33';
          for (let i = 0; i < 3; i++) { ctx.beginPath(); ctx.arc(Math.cos(d.r + i * 2) * 14 * s, Math.sin(d.r + i * 2) * 14 * s, 15 * s, 0, TAU); ctx.fill(); }
          break;
        case 'flowers':
          for (let i = 0; i < 6; i++) { ctx.fillStyle = ['#ffd23f', '#ff6b9a', '#ffffff'][(i + d.c) % 3]; ctx.beginPath(); ctx.arc(Math.cos(d.r + i) * 22 * s, Math.sin(d.r * 2 + i) * 22 * s, 5, 0, TAU); ctx.fill(); }
          break;
        case 'cactus':
          ctx.fillStyle = 'rgba(0,0,0,0.2)'; ctx.beginPath(); ctx.arc(6, 8, 24 * s, 0, TAU); ctx.fill();
          ctx.fillStyle = '#3f8f4a'; ctx.beginPath(); ctx.arc(0, 0, 22 * s, 0, TAU); ctx.fill();
          ctx.strokeStyle = '#2b6b34'; ctx.lineWidth = 3;
          for (let i = 0; i < 6; i++) { ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(Math.cos(i * 1.047 + d.r) * 20 * s, Math.sin(i * 1.047 + d.r) * 20 * s); ctx.stroke(); }
          ctx.fillStyle = '#ff6fa0'; ctx.beginPath(); ctx.arc(0, 0, 4, 0, TAU); ctx.fill();
          break;
        case 'rock':
        case 'ice': {
          const ice = d.type === 'ice';
          ctx.rotate(d.r);
          ctx.fillStyle = 'rgba(0,0,0,0.18)'; ctx.beginPath();
          for (let i = 0; i < 7; i++) { const a = (i / 7) * TAU, rr = (28 + ((i * 37 + d.c * 11) % 13)) * s; ctx.lineTo(Math.cos(a) * rr + 6, Math.sin(a) * rr + 8); }
          ctx.fill();
          ctx.fillStyle = ice ? '#a9d8f2' : ['#a0765a', '#8c6a52', '#b08466'][d.c]; ctx.beginPath();
          for (let i = 0; i < 7; i++) { const a = (i / 7) * TAU, rr = (28 + ((i * 37 + d.c * 11) % 13)) * s; ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr); }
          ctx.fill();
          ctx.fillStyle = ice ? 'rgba(255,255,255,0.6)' : 'rgba(255,255,255,0.15)'; ctx.beginPath(); ctx.arc(-8 * s, -8 * s, 10 * s, 0, TAU); ctx.fill();
          break;
        }
        case 'pine':
          ctx.fillStyle = 'rgba(0,0,0,0.15)'; ctx.beginPath(); ctx.arc(8, 10, 34 * s, 0, TAU); ctx.fill();
          for (const [rr, col] of [[34, '#2f5d46'], [22, '#3b7357'], [10, '#f4fbff']]) {
            ctx.fillStyle = col; ctx.beginPath();
            for (let i = 0; i < 16; i++) { const a = (i / 16) * TAU + d.r, q = i % 2 ? rr * 0.6 : rr; ctx.lineTo(Math.cos(a) * q * s, Math.sin(a) * q * s); }
            ctx.fill();
          }
          break;
        case 'snowman':
          ctx.fillStyle = 'rgba(0,0,0,0.12)'; ctx.beginPath(); ctx.arc(5, 6, 22 * s, 0, TAU); ctx.fill();
          ctx.fillStyle = '#ffffff'; ctx.beginPath(); ctx.arc(0, 0, 22 * s, 0, TAU); ctx.fill();
          ctx.fillStyle = '#eef4f8'; ctx.beginPath(); ctx.arc(0, 0, 13 * s, 0, TAU); ctx.fill();
          ctx.fillStyle = '#ff8a1f'; ctx.beginPath(); ctx.arc(Math.cos(d.r) * 9, Math.sin(d.r) * 9, 4, 0, TAU); ctx.fill();
          break;
        case 'building': {
          const w = 90 * s + 40, h = 80 * s + 50;
          const neon = ['#ff3fd2', '#3ff0ff', '#ffe14d'][d.c];
          ctx.fillStyle = '#0e0b1c'; ctx.fillRect(-w / 2, -h / 2, w, h);
          ctx.strokeStyle = neon; ctx.lineWidth = 3; ctx.globalAlpha = 0.85; ctx.strokeRect(-w / 2, -h / 2, w, h); ctx.globalAlpha = 1;
          for (let yy = -h / 2 + 12; yy < h / 2 - 12; yy += 18) for (let xx = -w / 2 + 12; xx < w / 2 - 12; xx += 18) {
            if (((xx * 7 + yy * 13 + d.c * 5) | 0) % 3 === 0) continue;
            ctx.fillStyle = ((xx + yy) | 0) % 5 === 0 ? neon : 'rgba(255,230,150,0.55)';
            ctx.fillRect(xx, yy, 8, 8);
          }
          break;
        }
        case 'lamp':
          ctx.globalCompositeOperation = 'lighter';
          ctx.fillStyle = 'rgba(255,220,120,0.12)'; ctx.beginPath(); ctx.arc(0, 0, 70, 0, TAU); ctx.fill();
          ctx.globalCompositeOperation = 'source-over';
          ctx.fillStyle = '#ffe9a8'; ctx.beginPath(); ctx.arc(0, 0, 7, 0, TAU); ctx.fill();
          break;
      }
      ctx.restore();
    }
    void night;
  }

  function drawArena(W, v) {
    const A = W.map, th = A.theme;
    ctx.fillStyle = '#26282c'; ctx.fillRect(v.x0, v.y0, v.x1 - v.x0, v.y1 - v.y0);
    ctx.fillStyle = groundPattern('fabrica', th); ctx.fillRect(0, 0, A.w, A.h);
    ctx.lineWidth = 44; ctx.strokeStyle = th.wallB; ctx.strokeRect(-22, -22, A.w + 44, A.h + 44);
    ctx.setLineDash([44, 44]); ctx.strokeStyle = th.wallA; ctx.strokeRect(-22, -22, A.w + 44, A.h + 44); ctx.setLineDash([]);
    for (const k of A.circles) {
      ctx.fillStyle = 'rgba(0,0,0,0.3)'; ctx.beginPath(); ctx.arc(k.x + 8, k.y + 12, k.r, 0, TAU); ctx.fill();
      ctx.fillStyle = '#1d1f23'; ctx.beginPath(); ctx.arc(k.x, k.y, k.r, 0, TAU); ctx.fill();
      ctx.strokeStyle = '#3a3d44'; ctx.lineWidth = 10;
      for (let rr = k.r - 12; rr > 16; rr -= 26) { ctx.beginPath(); ctx.arc(k.x, k.y, rr, 0, TAU); ctx.stroke(); }
      ctx.strokeStyle = th.wallA; ctx.lineWidth = 6; ctx.beginPath(); ctx.arc(k.x, k.y, k.r - 3, 0, TAU); ctx.stroke();
    }
    A.rects.forEach((q, i) => {
      ctx.fillStyle = 'rgba(0,0,0,0.3)'; ctx.fillRect(q.x + 8, q.y + 12, q.w, q.h);
      ctx.fillStyle = ['#b5452f', '#2f6db5', '#3f8f4a'][i % 3]; ctx.fillRect(q.x, q.y, q.w, q.h);
      ctx.strokeStyle = 'rgba(0,0,0,0.3)'; ctx.lineWidth = 3;
      const along = q.w > q.h;
      for (let t = 10; t < (along ? q.w : q.h); t += 14) { ctx.beginPath(); if (along) { ctx.moveTo(q.x + t, q.y + 4); ctx.lineTo(q.x + t, q.y + q.h - 4); } else { ctx.moveTo(q.x + 4, q.y + t); ctx.lineTo(q.x + q.w - 4, q.y + t); } ctx.stroke(); }
      ctx.strokeStyle = 'rgba(255,255,255,0.25)'; ctx.strokeRect(q.x + 1.5, q.y + 1.5, q.w - 3, q.h - 3);
    });
    if (W.sdOn && W.safeR < 2000) {
      ctx.save();
      ctx.beginPath(); ctx.rect(v.x0, v.y0, v.x1 - v.x0, v.y1 - v.y0); ctx.arc(A.w / 2, A.h / 2, W.safeR, 0, TAU, true);
      ctx.fillStyle = `rgba(255,40,40,${0.22 + 0.08 * Math.sin(W.time * 6)})`; ctx.fill('evenodd');
      ctx.strokeStyle = '#ff4040'; ctx.lineWidth = 8; ctx.setLineDash([30, 20]);
      ctx.beginPath(); ctx.arc(A.w / 2, A.h / 2, W.safeR, 0, TAU); ctx.stroke(); ctx.setLineDash([]);
      ctx.restore();
    }
  }

  function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
  }

  function drawCar(c, W, night) {
    ctx.save();
    ctx.translate(c.x, c.y); ctx.rotate(c.a);
    if (night) {
      ctx.globalCompositeOperation = 'lighter';
      const g = ctx.createLinearGradient(20, 0, 190, 0);
      g.addColorStop(0, 'rgba(255,240,180,0.35)'); g.addColorStop(1, 'rgba(255,240,180,0)');
      ctx.fillStyle = g; ctx.beginPath(); ctx.moveTo(20, -8); ctx.lineTo(190, -60); ctx.lineTo(190, 60); ctx.lineTo(20, 8); ctx.fill();
      ctx.globalCompositeOperation = 'source-over';
    }
    ctx.fillStyle = 'rgba(0,0,0,0.3)'; roundRect(-21, -10, 48, 28, 8); ctx.fill();
    // ruedas
    ctx.fillStyle = '#16171a';
    ctx.fillRect(-18, -16, 12, 6); ctx.fillRect(-18, 10, 12, 6);
    ctx.save(); ctx.translate(12, -13); ctx.rotate(c.steer * 0.45); ctx.fillRect(-6, -3, 12, 6); ctx.restore();
    ctx.save(); ctx.translate(12, 13); ctx.rotate(c.steer * 0.45); ctx.fillRect(-6, -3, 12, 6); ctx.restore();
    // carrocería
    const flash = c.hitFlash > 0 && Math.floor(c.hitFlash * 20) % 2 === 0;
    ctx.fillStyle = flash ? '#ffffff' : c.color.hex;
    roundRect(-24, -12.5, 48, 25, 8); ctx.fill();
    ctx.strokeStyle = c.color.dark; ctx.lineWidth = 2; ctx.stroke();
    ctx.fillStyle = c.color.dark; ctx.fillRect(-25, -12, 5, 24);
    ctx.fillStyle = 'rgba(255,255,255,0.85)'; ctx.fillRect(-19, -2.5, 36, 5);
    ctx.fillStyle = '#1c2633'; roundRect(-9, -9, 19, 18, 5); ctx.fill();
    ctx.fillStyle = 'rgba(160,210,255,0.55)'; roundRect(4, -8, 5, 16, 2); ctx.fill();
    ctx.fillStyle = '#fff6c4'; ctx.fillRect(21, -10, 3, 5); ctx.fillRect(21, 5, 3, 5);
    ctx.restore();
    if (c.shield > 0) {
      const a = c.shield < 1.5 ? 0.25 + 0.25 * Math.sin(W.time * 30) : 0.45;
      ctx.strokeStyle = `rgba(120,240,255,${a + 0.3})`; ctx.fillStyle = `rgba(120,240,255,${a * 0.4})`; ctx.lineWidth = 4;
      ctx.beginPath(); ctx.arc(c.x, c.y, 36 + Math.sin(W.time * 8) * 2, 0, TAU); ctx.fill(); ctx.stroke();
    }
    if (c.spin > 0) {
      ctx.fillStyle = '#ffe14d';
      for (let i = 0; i < 3; i++) { const a = W.time * 6 + (i * TAU) / 3; ctx.beginPath(); ctx.arc(c.x + Math.cos(a) * 30, c.y - 30 + Math.sin(a) * 8, 5, 0, TAU); ctx.fill(); }
    }
    if (c.warn && !W.over && G.phase === 'race') {
      ctx.strokeStyle = `rgba(255,50,50,${0.5 + 0.5 * Math.sin(W.time * 18)})`; ctx.lineWidth = 5;
      ctx.beginPath(); ctx.arc(c.x, c.y, 34, 0, TAU); ctx.stroke();
    }
  }

  function drawItemsWorld(W, v) {
    for (const o of W.oils) {
      if (!inView(v, o.x, o.y, 80)) continue;
      ctx.save(); ctx.translate(o.x, o.y); ctx.rotate(o.rot);
      ctx.globalAlpha = Math.min(1, o.life);
      ctx.fillStyle = '#0d0d10'; ctx.beginPath();
      o.pts.forEach((k, i) => { const a = (i / o.pts.length) * TAU; ctx.lineTo(Math.cos(a) * o.r * k, Math.sin(a) * o.r * k); });
      ctx.closePath(); ctx.fill();
      ctx.fillStyle = 'rgba(140,90,255,0.35)'; ctx.beginPath(); ctx.ellipse(-8, -8, o.r * 0.4, o.r * 0.18, 0.6, 0, TAU); ctx.fill();
      ctx.restore();
    }
    for (const b of W.boxes) {
      if (!b.active || !inView(v, b.x, b.y, 50)) continue;
      ctx.save(); ctx.translate(b.x, b.y);
      const bob = 1 + Math.sin(W.time * 4 + b.ph) * 0.08;
      ctx.fillStyle = 'rgba(255,200,40,0.25)'; ctx.beginPath(); ctx.arc(0, 0, 30 * bob, 0, TAU); ctx.fill();
      ctx.rotate(W.time * 1.4 + b.ph); ctx.scale(bob, bob);
      const g = ctx.createLinearGradient(-17, -17, 17, 17); g.addColorStop(0, '#ffe066'); g.addColorStop(1, '#ff7a1a');
      ctx.fillStyle = g; roundRect(-17, -17, 34, 34, 7); ctx.fill();
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 3; ctx.stroke();
      ctx.rotate(-(W.time * 1.4 + b.ph));
      ctx.fillStyle = '#fff'; ctx.font = 'bold 24px "Rubik", system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('?', 0, 1);
      ctx.restore();
    }
    for (const m of W.mines) {
      if (!inView(v, m.x, m.y, 40)) continue;
      ctx.fillStyle = 'rgba(0,0,0,0.3)'; ctx.beginPath(); ctx.arc(m.x + 3, m.y + 4, 14, 0, TAU); ctx.fill();
      ctx.strokeStyle = '#2a2a2e'; ctx.lineWidth = 4;
      for (let i = 0; i < 8; i++) { const a = (i / 8) * TAU + m.ph; ctx.beginPath(); ctx.moveTo(m.x, m.y); ctx.lineTo(m.x + Math.cos(a) * 18, m.y + Math.sin(a) * 18); ctx.stroke(); }
      ctx.fillStyle = '#3a3a40'; ctx.beginPath(); ctx.arc(m.x, m.y, 13, 0, TAU); ctx.fill();
      const blink = Math.sin(W.time * (m.life < 4 ? 20 : 8) + m.ph) > 0;
      ctx.fillStyle = blink ? '#ff3030' : '#661010'; ctx.beginPath(); ctx.arc(m.x, m.y, 5, 0, TAU); ctx.fill();
    }
  }

  function drawMissiles(W) {
    for (const m of W.missiles) {
      ctx.save(); ctx.translate(m.x, m.y); ctx.rotate(m.a);
      ctx.fillStyle = `rgba(255,${150 + Math.random() * 100},40,0.9)`; ctx.beginPath(); ctx.moveTo(-12, -5); ctx.lineTo(-26 - Math.random() * 10, 0); ctx.lineTo(-12, 5); ctx.fill();
      ctx.fillStyle = '#eeeeee'; roundRect(-14, -5, 26, 10, 4); ctx.fill();
      ctx.fillStyle = '#e8383d'; ctx.beginPath(); ctx.moveTo(12, -5); ctx.lineTo(20, 0); ctx.lineTo(12, 5); ctx.fill();
      ctx.fillRect(-14, -9, 6, 4); ctx.fillRect(-14, 5, 6, 4);
      ctx.restore();
    }
  }

  function drawParticles(W) {
    for (const p of W.parts) {
      const a = clamp(p.life / p.max, 0, 1);
      switch (p.k) {
        case 'smoke':
          ctx.fillStyle = p.dust ? p.dust : p.light ? `rgba(220,220,220,${a * 0.35})` : `rgba(60,60,60,${a * 0.5})`;
          if (p.dust) ctx.globalAlpha = a * 0.6;
          ctx.beginPath(); ctx.arc(p.x, p.y, p.size, 0, TAU); ctx.fill();
          ctx.globalAlpha = 1;
          break;
        case 'fire': {
          const t = 1 - a;
          ctx.fillStyle = t < 0.3 ? `rgba(255,245,180,${a})` : t < 0.6 ? `rgba(255,160,40,${a})` : `rgba(200,60,20,${a})`;
          ctx.beginPath(); ctx.arc(p.x, p.y, p.size * (0.5 + a * 0.5), 0, TAU); ctx.fill();
          break;
        }
        case 'spark':
          ctx.strokeStyle = p.color; ctx.globalAlpha = a; ctx.lineWidth = p.size;
          ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x - p.vx * 0.04, p.y - p.vy * 0.04); ctx.stroke();
          ctx.globalAlpha = 1;
          break;
        case 'debris':
        case 'confetti':
          ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot); ctx.globalAlpha = Math.min(1, a * 2);
          ctx.fillStyle = p.color; ctx.fillRect(-p.size / 2, -p.size / 3, p.size, p.size * (p.k === 'confetti' ? 0.5 : 0.66));
          ctx.restore();
          break;
        case 'ring':
          ctx.strokeStyle = `rgba(255,230,160,${a})`; ctx.lineWidth = 6 * a;
          ctx.beginPath(); ctx.arc(p.x, p.y, p.size * (1 - a) + 10, 0, TAU); ctx.stroke();
          break;
      }
    }
    for (const w of W.waves) {
      const a = clamp(w.life / 0.45, 0, 1);
      ctx.strokeStyle = `rgba(160,220,255,${a})`; ctx.lineWidth = 14 * a + 2;
      ctx.beginPath(); ctx.arc(w.x, w.y, w.r, 0, TAU); ctx.stroke();
    }
  }

  function drawTags(W) {
    const k = Math.max(1, W.cam.zoom * 0.85);
    ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
    ctx.font = `bold ${Math.round(20 * k)}px "Rubik", system-ui, sans-serif`;
    ctx.lineJoin = 'round';
    for (const c of W.cars) {
      if (!c.alive || c.demo) continue;
      ctx.lineWidth = 5 * k; ctx.strokeStyle = 'rgba(0,0,0,0.75)'; ctx.strokeText(c.name, c.x, c.y - 26 - 4 * k);
      ctx.fillStyle = c.color.hex; ctx.fillText(c.name, c.x, c.y - 26 - 4 * k);
      if (W.arena) {
        for (let i = 0; i < 3; i++) {
          ctx.fillStyle = i < c.hp ? '#ff4d5e' : 'rgba(0,0,0,0.45)';
          ctx.beginPath(); ctx.arc(c.x + (i - 1) * 16 * k, c.y + 28 + 6 * k, 6 * k, 0, TAU); ctx.fill();
        }
      }
    }
  }

  function render() {
    const W = G.world;
    const cw = canvas.width, ch = canvas.height;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    if (!W) { ctx.fillStyle = '#14121f'; ctx.fillRect(0, 0, cw, ch); return; }
    const scale = (G.baseScale / W.cam.zoom) * G.dpr;
    const sh = W.shake * 14;
    const cx = W.cam.x + (Math.random() - 0.5) * sh, cy = W.cam.y + (Math.random() - 0.5) * sh;
    ctx.setTransform(scale, 0, 0, scale, cw / 2 - cx * scale, ch / 2 - cy * scale);
    const v = { x0: cx - cw / 2 / scale, y0: cy - ch / 2 / scale, x1: cx + cw / 2 / scale, y1: cy + ch / 2 / scale };
    if (W.arena) drawArena(W, v); else drawTrack(W, v);
    // marcas
    ctx.strokeStyle = W.map.theme.night ? 'rgba(255,63,210,0.25)' : 'rgba(20,20,20,0.28)';
    ctx.lineWidth = 5; ctx.lineCap = 'round';
    ctx.beginPath();
    for (const s of W.skids) { ctx.moveTo(s[0], s[1]); ctx.lineTo(s[2], s[3]); }
    ctx.stroke();
    drawItemsWorld(W, v);
    const night = !!W.map.theme.night;
    for (const c of W.cars) if (c.alive) drawCar(c, W, night);
    drawMissiles(W);
    drawParticles(W);
    drawTags(W);
    // muerte súbita: oscurece lo que queda fuera
    if (!W.arena && W.shrink < 1 && !W.demo) {
      const hw = (G.viewW / 2) * W.shrink, hh = (G.viewH / 2) * W.shrink;
      ctx.save();
      ctx.beginPath(); ctx.rect(v.x0 - 10, v.y0 - 10, v.x1 - v.x0 + 20, v.y1 - v.y0 + 20);
      ctx.rect(W.cam.x - hw, W.cam.y - hh, hw * 2, hh * 2);
      ctx.fillStyle = 'rgba(30,0,0,0.55)'; ctx.fill('evenodd');
      ctx.strokeStyle = `rgba(255,60,60,${0.6 + 0.4 * Math.sin(W.time * 10)})`; ctx.lineWidth = 6 / (scale / G.dpr);
      ctx.strokeRect(W.cam.x - hw, W.cam.y - hh, hw * 2, hh * 2);
      ctx.restore();
    }
    ctx.setTransform(G.dpr, 0, 0, G.dpr, 0, 0);
    drawHUD(W);
  }

  function drawHUD(W) {
    const w = G.cssW, h = G.cssH;
    ctx.textBaseline = 'middle';
    if (!W.demo) {
      // barra de jugadores
      const ps = G.players;
      const pw = Math.min(210, (w - 40) / Math.max(1, ps.length) - 10), ph = 46;
      let x = (w - (pw + 10) * ps.length + 10) / 2;
      for (const p of ps) {
        const car = W.cars.find((c) => c.p === p);
        const dead = car ? !car.alive : true;
        ctx.globalAlpha = dead ? 0.45 : 1;
        ctx.fillStyle = 'rgba(10,8,20,0.78)'; roundRect(x, 12, pw, ph, 12); ctx.fill();
        ctx.fillStyle = COLORS[p.color].hex; roundRect(x, 12, 8, ph, 4); ctx.fill();
        ctx.fillStyle = '#fff'; ctx.font = '600 15px "Rubik", system-ui, sans-serif'; ctx.textAlign = 'left';
        let name = p.name;
        while (ctx.measureText(name).width > pw - 70 && name.length > 2) name = name.slice(0, -1);
        ctx.fillText(name, x + 16, 28);
        ctx.textAlign = 'right'; ctx.font = 'bold 18px "Rubik", system-ui, sans-serif';
        ctx.fillText(String(p.score), x + pw - 10, 28);
        ctx.fillStyle = 'rgba(255,255,255,0.15)'; ctx.fillRect(x + 16, 44, pw - 28, 6);
        ctx.fillStyle = COLORS[p.color].hex; ctx.fillRect(x + 16, 44, (pw - 28) * Math.min(1, p.score / G.target), 6);
        if (car && car.alive && (car.item || car.roll > 0)) {
          ctx.font = '18px system-ui, sans-serif'; ctx.textAlign = 'center';
          ctx.fillText(car.roll > 0 ? pick(Object.values(ITEMS)).icon : ITEMS[car.item].icon, x + pw - 42, 28);
        }
        if (dead && car) { ctx.globalAlpha = 1; ctx.fillStyle = '#ff4d4d'; ctx.font = 'bold 22px system-ui'; ctx.textAlign = 'center'; ctx.fillText('✖', x + pw / 2, 35); }
        ctx.globalAlpha = 1;
        x += pw + 10;
      }
      // cuenta regresiva
      if (G.phase === 'intro') {
        const t = G.phaseT;
        ctx.textAlign = 'center';
        if (t < 0.6 + 0.8 * 3) {
          ctx.fillStyle = 'rgba(10,8,20,0.6)'; roundRect(w / 2 - 260, h * 0.2 - 40, 520, 80, 20); ctx.fill();
          ctx.fillStyle = '#fff'; ctx.font = 'bold 34px "Rubik", system-ui';
          ctx.fillText(`Ronda ${G.round} · ${W.map.name}`, w / 2, h * 0.2);
        }
        if (t > 0.6) {
          const n = 3 - Math.floor((t - 0.6) / 0.8), f = ((t - 0.6) % 0.8) / 0.8;
          ctx.save(); ctx.translate(w / 2, h / 2); ctx.scale(1.6 - f * 0.5, 1.6 - f * 0.5);
          ctx.font = 'bold 140px "Bungee", "Rubik", system-ui'; ctx.lineWidth = 12; ctx.strokeStyle = '#1a1030'; ctx.fillStyle = '#ffd23f';
          ctx.strokeText(String(Math.max(1, n)), 0, 0); ctx.fillText(String(Math.max(1, n)), 0, 0);
          ctx.restore();
        }
      } else if (G.phase === 'race' && W.time - W.raceStart < 0.8) {
        const f = (W.time - W.raceStart) / 0.8;
        ctx.save(); ctx.globalAlpha = 1 - f; ctx.translate(w / 2, h / 2); ctx.scale(1 + f, 1 + f);
        ctx.textAlign = 'center'; ctx.font = 'bold 130px "Bungee", "Rubik", system-ui'; ctx.lineWidth = 12; ctx.strokeStyle = '#1a1030'; ctx.fillStyle = '#3ff07a';
        ctx.strokeText('¡YA!', 0, 0); ctx.fillText('¡YA!', 0, 0);
        ctx.restore();
      }
      if (W.sdOn && G.phase === 'race' && !W.over) {
        ctx.textAlign = 'center'; ctx.font = 'bold 22px "Bungee", "Rubik", system-ui';
        ctx.fillStyle = `rgba(255,70,70,${0.6 + 0.4 * Math.sin(W.time * 8)})`;
        ctx.fillText('MUERTE SÚBITA', w / 2, h - 34);
      }
      if (G.phase === 'race' || G.phase === 'intro') drawToasts(W.toasts, 80);
      // datos de la sala
      ctx.textAlign = 'right'; ctx.font = '600 14px "Rubik", system-ui'; ctx.fillStyle = 'rgba(255,255,255,0.75)';
      ctx.fillText(`Sala ${G.code || '----'}  ·  ${G.joinUrl.replace(/^https?:\/\//, '')}`, w - 16, h - 18);
      ctx.textAlign = 'left';
      ctx.fillText(`Ronda ${G.round} · ${MODES[G.mode].name} · a ${G.target} puntos`, 16, h - 18);
    }
    drawToasts(globalToasts, W.demo ? h - 120 : 140);
  }

  function drawToasts(list, y0) {
    ctx.textAlign = 'center'; ctx.font = 'bold 20px "Rubik", system-ui';
    list.forEach((t, i) => {
      const a = Math.min(1, t.t * 2);
      ctx.globalAlpha = a;
      const tw = ctx.measureText(t.text).width + 40, y = y0 + i * 44;
      ctx.fillStyle = 'rgba(10,8,20,0.8)'; roundRect(G.cssW / 2 - tw / 2, y - 18, tw, 36, 18); ctx.fill();
      ctx.fillStyle = t.color || '#fff'; ctx.fillText(t.text, G.cssW / 2, y);
      ctx.globalAlpha = 1;
    });
  }

  // ------------------------------------------------------------- lobby
  function carSVG(hex, dark) {
    return `<svg viewBox="0 0 60 34" class="mini-car"><rect x="4" y="2" width="12" height="6" rx="1.5" fill="#111"/><rect x="4" y="26" width="12" height="6" rx="1.5" fill="#111"/><rect x="40" y="2" width="12" height="6" rx="1.5" fill="#111"/><rect x="40" y="26" width="12" height="6" rx="1.5" fill="#111"/><rect x="3" y="5" width="54" height="24" rx="8" fill="${hex}" stroke="${dark}" stroke-width="2"/><rect x="8" y="14.5" width="40" height="5" fill="#fff" opacity=".85"/><rect x="21" y="8" width="18" height="18" rx="4" fill="#1c2633"/><rect x="52" y="8" width="3" height="5" fill="#fff6c4"/><rect x="52" y="21" width="3" height="5" fill="#fff6c4"/></svg>`;
  }

  function refreshLobby() {
    const slots = $('slots');
    if (!slots) return;
    let html = '';
    for (let i = 0; i < MAX_PLAYERS; i++) {
      const p = G.players[i];
      if (!p) { html += `<div class="slot empty"><div class="slot-wait">Esperando piloto…</div></div>`; continue; }
      const c = COLORS[p.color];
      const badge = p.kind === 'phone' ? '📱' : p.kind === 'bot' ? '🤖' : '⌨️';
      const vip = vipPlayer() === p ? '<span class="vip" title="Anfitrión">👑</span>' : '';
      const sub = p.kind === 'kb' ? `<div class="slot-sub">${esc(p.kb.label)}</div>` : p.kind === 'phone' && !p.connected ? '<div class="slot-sub">desconectado…</div>' : `<div class="slot-sub">${c.name}</div>`;
      const rm = p.kind !== 'phone' ? `<button class="slot-x" data-rm="${p.key}" title="Quitar">✕</button>` : '';
      html += `<div class="slot" style="--c:${c.hex}">${rm}${carSVG(c.hex, c.dark)}<div class="slot-name">${badge} ${esc(p.name)} ${vip}</div>${sub}</div>`;
    }
    slots.innerHTML = html;
    slots.querySelectorAll('[data-rm]').forEach((b) => b.addEventListener('click', () => {
      const p = G.players.find((x) => x.key === b.dataset.rm);
      if (p) removePlayer(p);
    }));
    document.querySelectorAll('.mode').forEach((el) => el.classList.toggle('sel', el.dataset.mode === G.mode));
    document.querySelectorAll('.target').forEach((el) => el.classList.toggle('sel', Number(el.dataset.t) === G.target));
    $('modeDesc').textContent = MODES[G.mode].desc;
    const n = participants().length;
    $('btnStart').disabled = n < 2;
    $('btnBot').disabled = G.players.length >= MAX_PLAYERS;
    $('btnKb').disabled = G.players.length >= MAX_PLAYERS || G.players.filter((p) => p.kind === 'kb').length >= 2;
    $('startHint').textContent = n < 2 ? 'Se necesitan al menos 2 pilotos (podés sumar bots)' : `${n} pilotos listos · el anfitrión 👑 también puede empezar desde su celular`;
  }
  function flashLobbyHint() {
    const el = $('startHint');
    el.classList.remove('flash'); void el.offsetWidth; el.classList.add('flash');
  }

  function setMode(m) { if (MODES[m] && G.phase === 'lobby') { G.mode = m; SFX.click(); refreshLobby(); } }
  function setTarget(t) { if (TARGETS.includes(t) && G.phase === 'lobby') { G.target = t; SFX.click(); refreshLobby(); } }
  function cycleColor(p) {
    if (G.phase !== 'lobby') return;
    for (let k = 1; k <= COLORS.length; k++) {
      const c = (p.color + k) % COLORS.length;
      if (!G.players.some((x) => x !== p && x.color === c)) { p.color = c; break; }
    }
    refreshLobby();
  }

  function initLobbyUI() {
    $('modes').innerHTML = Object.entries(MODES).map(([k, m]) => `<button class="mode" data-mode="${k}"><span class="mode-icon">${m.icon}</span>${m.name}</button>`).join('');
    $('targets').innerHTML = TARGETS.map((t) => `<button class="target" data-t="${t}">${t}</button>`).join('');
    document.querySelectorAll('.mode').forEach((el) => el.addEventListener('click', () => setMode(el.dataset.mode)));
    document.querySelectorAll('.target').forEach((el) => el.addEventListener('click', () => setTarget(Number(el.dataset.t))));
    $('btnBot').addEventListener('click', () => { SFX.ensure(); addBot(); });
    $('btnKb').addEventListener('click', () => { SFX.ensure(); addKeyboard(); });
    $('btnStart').addEventListener('click', () => startMatch());
    $('btnAgain').addEventListener('click', () => { G.phase = 'lobby'; startMatch(); });
    $('btnLobby').addEventListener('click', () => goLobby());
    $('btnFull').addEventListener('click', () => {
      if (document.fullscreenElement) document.exitFullscreen(); else document.documentElement.requestFullscreen?.();
    });
    $('btnMute').addEventListener('click', () => { SFX.ensure(); $('btnMute').textContent = SFX.toggle() ? '🔊' : '🔇'; });
    addEventListener('pointerdown', () => SFX.ensure());
    refreshLobby();
  }

  // ------------------------------------------------------------- red
  const net = {
    ws: null, retry: 0,
    send(m) { if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify(m)); },
    connect() {
      const ws = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/ws');
      this.ws = ws;
      ws.onopen = () => {
        this.retry = 0;
        let code = null, key = null;
        try { code = sessionStorage.getItem('as_code'); key = sessionStorage.getItem('as_key'); } catch {}
        ws.send(JSON.stringify({ t: 'host', code, key }));
        $('netStatus').classList.add('hidden');
      };
      ws.onmessage = (e) => { let m; try { m = JSON.parse(e.data); } catch { return; } onNet(m); };
      ws.onclose = () => {
        $('netStatus').classList.remove('hidden');
        setTimeout(() => this.connect(), Math.min(5000, 800 + this.retry++ * 600));
      };
    },
  };

  function onNet(m) {
    switch (m.t) {
      case 'room': {
        G.code = m.code;
        try { sessionStorage.setItem('as_code', m.code); sessionStorage.setItem('as_key', m.key); } catch {}
        G.joinUrl = `${location.origin}/c`;
        $('roomCode').textContent = m.code;
        $('joinUrl').textContent = G.joinUrl.replace(/^https?:\/\//, '');
        $('qr').src = `/qr.svg?u=${encodeURIComponent(`${location.origin}/c?r=${m.code}`)}`;
        const ids = new Set(m.players.map((p) => 'p' + p.id));
        G.players = G.players.filter((p) => p.kind !== 'phone' || ids.has(p.key));
        for (const p of m.players) {
          const ex = G.players.find((x) => x.key === 'p' + p.id);
          if (ex) ex.connected = p.connected;
          else { const np = newPlayer('phone', 'p' + p.id, p.name); np.phoneId = p.id; np.connected = p.connected; G.players.push(np); }
        }
        enforceCap(null);
        for (const p of G.players) p.lastSent = '';
        refreshLobby();
        break;
      }
      case 'pjoin': addPhone(m.id, m.name); break;
      case 'preconnect': {
        const p = G.players.find((x) => x.key === 'p' + m.id);
        if (p) { p.connected = true; p.name = m.name || p.name; p.lastSent = ''; refreshLobby(); }
        else addPhone(m.id, m.name);
        break;
      }
      case 'pleave': {
        const p = G.players.find((x) => x.key === 'p' + m.id);
        if (!p) break;
        p.connected = false; p.leftAt = performance.now(); p.input = { l: false, r: false, b: false, fire: false };
        refreshLobby();
        break;
      }
      case 'c': onCtrl(m.id, m.d); break;
    }
  }

  function onCtrl(id, d) {
    const p = G.players.find((x) => x.key === 'p' + id);
    if (!p || !d) return;
    switch (d.t) {
      case 'in': p.input.l = !!d.l; p.input.r = !!d.r; p.input.b = !!d.b; break;
      case 'fire': p.input.fire = true; break;
      case 'name': p.name = String(d.v || '').slice(0, 12) || p.name; refreshLobby(); break;
      case 'cmd': {
        if (d.a === 'color') { cycleColor(p); break; }
        if (vipPlayer() !== p) break;
        if (d.a === 'mode') setMode(d.v);
        else if (d.a === 'target') setTarget(Number(d.v));
        else if (d.a === 'start' && G.phase === 'lobby') startMatch();
        else if (d.a === 'again' && G.phase === 'matchover') { G.phase = 'lobby'; startMatch(); }
        else if (d.a === 'lobby' && (G.phase === 'matchover' || G.phase === 'roundover')) goLobby();
        else if (d.a === 'next' && G.phase === 'roundover' && G.phaseT > 1.5) G.phaseT = 99;
        else if (d.a === 'addbot' && G.phase === 'lobby') addBot();
        else if (d.a === 'rmbot' && G.phase === 'lobby') { const b = [...G.players].reverse().find((x) => x.kind === 'bot'); if (b) removePlayer(b); }
        break;
      }
    }
  }

  function vibrate(p, pattern) { if (p && p.kind === 'phone') net.send({ t: 'to', id: p.phoneId, d: { t: 'vib', p: pattern } }); }

  function ctrlState(p) {
    const W = G.world;
    const car = W && !W.demo ? W.cars.find((c) => c.p === p) : null;
    const vip = vipPlayer();
    return {
      t: 'st', phase: G.phase, name: p.name, color: COLORS[p.color].hex, colorName: COLORS[p.color].name,
      vip: vip === p, vipName: vip ? vip.name : '', mode: G.mode, target: G.target, score: p.score,
      inRound: !!car, alive: car ? car.alive : null, hp: car && W.arena ? car.hp : null,
      item: car && car.alive ? (car.roll > 0 ? 'roll' : car.item) : null,
      count: participants().length, bots: G.players.filter((x) => x.kind === 'bot').length,
      roundWinner: G.phase === 'roundover' && G.roundWinner ? G.roundWinner.name : null,
      lastGain: p.lastGain || 0,
      champion: G.phase === 'matchover' && G.champion ? G.champion.name : null,
      isChampion: G.phase === 'matchover' && G.champion === p,
    };
  }
  // En el lobby, un celular desconectado tiene unos segundos para volver antes de liberar su lugar
  setInterval(() => {
    if (G.phase !== 'lobby') return;
    const now = performance.now();
    for (const p of [...G.players]) {
      if (p.kind === 'phone' && !p.connected && now - (p.leftAt || 0) > 10000) {
        G.players = G.players.filter((x) => x !== p);
        net.send({ t: 'drop', id: p.phoneId });
        toastGlobal(`${p.name} se fue`, '#aaa');
        refreshLobby();
      }
    }
  }, 1000);

  setInterval(() => {
    for (const p of G.players) {
      if (p.kind !== 'phone' || !p.connected) continue;
      const s = JSON.stringify(ctrlState(p));
      if (s !== p.lastSent) { p.lastSent = s; net.send({ t: 'to', id: p.phoneId, d: JSON.parse(s) }); }
    }
  }, 90);

  // ------------------------------------------------------------- loop
  function resize() {
    G.dpr = Math.min(window.devicePixelRatio || 1, 2);
    G.cssW = innerWidth; G.cssH = innerHeight;
    canvas.width = Math.round(G.cssW * G.dpr); canvas.height = Math.round(G.cssH * G.dpr);
    canvas.style.width = G.cssW + 'px'; canvas.style.height = G.cssH + 'px';
    G.baseScale = Math.min(G.cssW / VIEW_W, G.cssH / VIEW_H);
    G.viewW = G.cssW / G.baseScale; G.viewH = G.cssH / G.baseScale;
  }
  addEventListener('resize', resize);
  resize();

  let last = performance.now(), acc = 0;
  function frame(now) {
    acc += Math.min(0.1, (now - last) / 1000);
    last = now;
    while (acc >= DT) { update(DT); acc -= DT; }
    render();
    requestAnimationFrame(frame);
  }

  initLobbyUI();
  G.world = makeDemoWorld();
  net.connect();
  requestAnimationFrame(frame);

  // ganchos para pruebas
  window.__AS = { G, addBot, addKeyboard, startMatch, goLobby, setMode, setTarget, TRACKS, ARENAS, sim: (sec) => { for (let i = 0; i < sec * 60; i++) update(DT); } };
})();
