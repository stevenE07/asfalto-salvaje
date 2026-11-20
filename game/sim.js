// Simulación autoritativa de una sala (corre en el servidor).
'use strict';
const Tracks = require('../shared/tracks.js');
const Common = require('../shared/common.js');

const { ROAD, CURB, WALL, project, projectGlobal, pointAt } = Tracks;
const { COLORS, MODES, TARGETS, MAX_PLAYERS, VIEW_W, VIEW_H, CAR_R, ITEM_LIST, PHASES, F, INTRO_TIME } = Common;

const TRACKS = Tracks.TRACK_DEFS.map(Tracks.buildTrack);
const ARENAS = Tracks.ARENA_DEFS.map(Tracks.buildArena);

const TAU = Math.PI * 2;
const DT = 1 / 60;
const MAX_SPEED = 540, ACCEL = 560, TURN = 3.15;
const KO_SD_START = 40, KO_SD_LEN = 35, KO_SD_MIN = 0.18;
const AR_SD_START = 45, AR_SD_LEN = 30;
const LOBBY_DROP_MS = 15000;
const BOT_NAMES = ['Turbina', 'Chispa', 'Bujía', 'Pistón', 'Rayo', 'Tuerca', 'Llanta', 'Escape'];

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const rand = (a, b) => a + Math.random() * (b - a);
const angNorm = (a) => { while (a > Math.PI) a -= TAU; while (a < -Math.PI) a += TAU; return a; };
const shuffle = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const r1 = (v) => Math.round(v);
const r2 = (v) => Math.round(v * 100) / 100;
const r3 = (v) => Math.round(v * 1000) / 1000;

// ------------------------------------------------------------------ partida
function createGame() {
  return {
    phase: 'lobby', mode: 'knockout', target: 10,
    players: [], world: null, phaseT: 0, round: 0,
    trackQueue: [], arenaIdx: 0, champion: null, roundWinner: null,
    events: [], nextId: 1, joinSeq: 0, clock: 0, countShown: 4, wid: 0, oid: 0,
  };
}
function ev(g, o) { g.events.push(o); }

function freeColor(g) {
  for (let i = 0; i < COLORS.length; i++) if (!g.players.some((p) => p.color === i)) return i;
  return 0;
}
function newPlayer(g, kind, name) {
  return { id: g.nextId++, kind, name, color: freeColor(g), score: 0, lastGain: 0, lastPlace: 0, input: { l: false, r: false, b: false, fire: false }, connected: true, join: g.joinSeq++, leftAt: 0 };
}
function cleanName(n) {
  const s = String(n || '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 12);
  return s || 'Piloto';
}
function humans(g) { return g.players.filter((p) => p.kind === 'human'); }
function addHuman(g, name) {
  if (humans(g).length >= MAX_PLAYERS) return null;
  const p = newPlayer(g, 'human', cleanName(name));
  g.players.push(p);
  enforceCap(g, p);
  ev(g, { e: 'toast', text: `${p.name} se unió`, c: COLORS[p.color].hex });
  return p;
}
function addBot(g) {
  if (g.players.length >= MAX_PLAYERS) return;
  const used = new Set(g.players.map((p) => p.name));
  const name = BOT_NAMES.find((n) => !used.has(n)) || 'Bot';
  g.players.push(newPlayer(g, 'bot', name));
}
function removePlayer(g, p) { g.players = g.players.filter((x) => x !== p); }
function enforceCap(g, keep) {
  while (g.players.length > MAX_PLAYERS) {
    const victim = [...g.players].reverse().find((p) => p.kind === 'bot' && p !== keep);
    if (!victim) break;
    removePlayer(g, victim);
  }
}
function vip(g) {
  let best = null;
  for (const p of g.players) if (p.kind === 'human' && p.connected && (!best || p.join < best.join)) best = p;
  return best;
}
function participants(g) { return g.players.filter((p) => p.kind === 'bot' || p.connected); }
function cycleColor(g, p) {
  if (g.phase !== 'lobby') return;
  for (let k = 1; k <= COLORS.length; k++) {
    const c = (p.color + k) % COLORS.length;
    if (!g.players.some((x) => x !== p && x.color === c)) { p.color = c; break; }
  }
}

// ------------------------------------------------------------------ mundo
function makeCar(W, p, x, y, a) {
  const c = {
    p, color: COLORS[p.color].hex, name: p.name, x, y, a, vx: 0, vy: 0, steer: 0, alive: true,
    item: null, roll: 0, rollItem: null, turbo: 0, shield: 0, spin: 0, spinDir: 1, invuln: 0, oilImm: 0,
    hp: 3, hitFlash: 0, sdT: 0, seg: 0, s: 0, prog: 0, offroad: false, warn: 0, heldT: 0, skid: false, brake: false,
    speedMul: p.kind === 'bot' ? 0.95 : 1, fxT: 0,
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

function makeWorld(g, kind, idx, parts) {
  const map = kind === 'arena' ? ARENAS[idx] : TRACKS[idx];
  const arena = kind === 'arena';
  const W = {
    id: ++g.wid, kind, idx, map, arena, items: MODES[g.mode].items,
    cars: [], mines: [], oils: [], missiles: [], boxes: [], waves: [],
    time: 0, raceStart: 0, elimOrder: [], ending: 0, over: false, winner: null,
    cam: { x: 0, y: 0 }, shrink: 1, safeR: Infinity, sdOn: false, leader: null, grip: map.theme.grip,
  };
  const order = [...parts].sort((a, b) => a.score - b.score || Math.random() - 0.5);
  if (!arena) {
    W.s0 = map.cum[map.startIdx];
    const lanes = [-84, -28, 28, 84];
    order.forEach((p, k) => {
      const row = Math.floor(k / 4), col = k % 4;
      const pt = pointAt(map, W.s0 - 70 - row * 95 - (col % 2) * 30);
      W.cars.push(makeCar(W, p, pt.x + pt.nx * lanes[col], pt.y + pt.ny * lanes[col], Math.atan2(pt.uy, pt.ux)));
    });
    if (W.items) {
      for (let s = W.s0 + 900; s < W.s0 + map.L - 600; s += 1400) {
        for (const lane of [-80, 0, 80]) {
          const pt = pointAt(map, s);
          W.boxes.push({ x: r1(pt.x + pt.nx * lane), y: r1(pt.y + pt.ny * lane), active: true, t: 0 });
        }
      }
    }
    const first = pointAt(map, W.s0);
    W.cam.x = first.x; W.cam.y = first.y;
  } else {
    const n = Math.max(order.length, 2);
    order.forEach((p, k) => {
      const ang = ((k + 0.5) / n) * TAU;
      W.cars.push(makeCar(W, p, map.w / 2 + Math.cos(ang) * map.w * 0.25, map.h / 2 + Math.sin(ang) * map.h * 0.25, ang + Math.PI / 2));
    });
    const spots = [[300, 300], [2500, 300], [300, 1500], [2500, 1500], [1000, 900], [1800, 900], [1400, 600], [1400, 1200], [1050, 450], [1750, 450], [1050, 1350], [1750, 1350]];
    for (const [x, y] of spots) W.boxes.push({ x, y, active: true, t: 0 });
  }
  return W;
}

// ------------------------------------------------------------------ combate
function vibrate(g, p, pattern) { if (p && p.kind === 'human') ev(g, { e: 'vib', id: p.id, p: pattern }); }

function hit(g, W, c, kind, sx, sy) {
  if (!c.alive || c.invuln > 0) return false;
  if (kind === 'oil' && c.oilImm > 0) return false;
  if (c.shield > 0) {
    c.shield = 0; c.invuln = 0.35;
    ev(g, { e: 'block', x: r1(c.x), y: r1(c.y) });
    return false;
  }
  if (kind === 'oil') {
    c.spin = 0.85; c.oilImm = 1.4; c.invuln = 0.2;
    ev(g, { e: 'sfx', s: 'slip' });
    vibrate(g, c.p, 120);
  } else {
    c.spin = kind === 'wave' ? 0.5 : 0.85; c.invuln = 0.9; c.hitFlash = 0.5;
    const dx = c.x - sx, dy = c.y - sy, d = Math.hypot(dx, dy) || 1;
    c.vx = c.vx * 0.25 + (dx / d) * 280; c.vy = c.vy * 0.25 + (dy / d) * 280;
    vibrate(g, c.p, [90, 40, 180]);
    if (W.arena) damage(g, W, c, 1);
  }
  c.spinDir = Math.random() < 0.5 ? -1 : 1;
  return true;
}
function damage(g, W, c, n) {
  c.hp -= n; c.hitFlash = 0.5;
  if (c.hp <= 0) eliminate(g, W, c, 'destroyed');
}
function eliminate(g, W, c, why) {
  if (!c.alive || W.over) return;
  if (W.cars.filter((x) => x.alive).length <= 1) { c.hp = Math.max(c.hp, 1); return; } // el último nunca muere
  c.alive = false; c.item = null; c.roll = 0;
  W.elimOrder.push(c);
  ev(g, { e: 'elim', id: c.p.id, x: r1(c.x), y: r1(c.y), c: c.color });
  ev(g, { e: 'toast', text: why === 'camera' ? `${c.name} quedó atrás` : `${c.name} explotó`, c: c.color });
  vibrate(g, c.p, [220, 80, 320]);
}

function rollItem(W, c) {
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

function chooseMissileTarget(W, c) {
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

function useItem(g, W, c) {
  const it = c.item;
  if (!it || !c.alive || c.spin > 0) return;
  c.item = null; c.heldT = 0;
  const fx = Math.cos(c.a), fy = Math.sin(c.a);
  switch (it) {
    case 'turbo':
      c.turbo = 1.7; ev(g, { e: 'sfx', s: 'turbo' }); break;
    case 'missile': {
      const sp = Math.max(980, Math.hypot(c.vx, c.vy) + 520);
      W.missiles.push({ id: ++g.oid, x: c.x + fx * 34, y: c.y + fy * 34, a: c.a, v: sp, owner: c, target: chooseMissileTarget(W, c), life: 2.8, age: 0, seg: c.seg });
      ev(g, { e: 'sfx', s: 'missile' }); break;
    }
    case 'mine':
      W.mines.push({ id: ++g.oid, x: c.x - fx * 38, y: c.y - fy * 38, owner: c, arm: 0.2, ownArm: 0.9, life: W.arena ? 22 : 30 });
      ev(g, { e: 'sfx', s: 'drop' }); break;
    case 'oil':
      W.oils.push({ id: ++g.oid, x: c.x - fx * 46, y: c.y - fy * 46, r: 48, life: 16, owner: c, ownT: 0.8 });
      ev(g, { e: 'sfx', s: 'drop' }); break;
    case 'shield':
      c.shield = 6; ev(g, { e: 'sfx', s: 'shield' }); break;
    case 'wave': {
      W.waves.push({ x: c.x, y: c.y });
      ev(g, { e: 'wave', x: r1(c.x), y: r1(c.y) });
      for (const o of W.cars) {
        if (o === c || !o.alive) continue;
        const dx = o.x - c.x, dy = o.y - c.y, d = Math.hypot(dx, dy) || 1;
        if (d > 340) continue;
        const f = 280 + 520 * (1 - d / 340);
        if (o.shield > 0 && d < 200) { hit(g, W, o, 'wave', c.x, c.y); continue; }
        o.vx += (dx / d) * f; o.vy += (dy / d) * f;
        if (d < 200) hit(g, W, o, 'wave', c.x, c.y);
      }
      break;
    }
  }
}

// ------------------------------------------------------------------ física
function stepCar(g, W, c, dt) {
  const inp = c.p.input;
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
  c.a = angNorm(c.a);
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
  c.skid = Math.abs(lat) > 120 || (brake && fwd > 220) || c.spin > 0;
  c.brake = brake;

  c.shield = Math.max(0, c.shield - dt);
  c.invuln = Math.max(0, c.invuln - dt);
  c.oilImm = Math.max(0, c.oilImm - dt);
  c.hitFlash = Math.max(0, c.hitFlash - dt);
  c.fxT = Math.max(0, c.fxT - dt);
  if (c.item) c.heldT += dt;
  if (c.roll > 0) { c.roll -= dt; if (c.roll <= 0) { c.item = c.rollItem; c.rollItem = null; vibrate(g, c.p, 40); } }
}

function wallFx(g, c, x, y, vn) {
  if (vn < 140 || c.fxT > 0) return;
  c.fxT = 0.12;
  ev(g, { e: 'spk', x: r1(x), y: r1(y), n: Math.min(14, Math.round(vn / 40)) });
  ev(g, { e: 'thud', v: r1(vn) });
}

function trackConstrain(g, W, c) {
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
      wallFx(g, c, c.x + nx * CAR_R, c.y + ny * CAR_R, vn);
    }
  }
}

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
      let nx, ny;
      if (d2 > 1e-6) { const d = Math.sqrt(d2); nx = dx / d; ny = dy / d; o.x = cx + nx * r; o.y = cy + ny * r; }
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

function carCollisions(g, W) {
  const cs = W.cars;
  let bumpV = 0;
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
        if (-rv > 260 && a.fxT <= 0) { a.fxT = 0.12; ev(g, { e: 'spk', x: r1(a.x + nx * CAR_R), y: r1(a.y + ny * CAR_R), n: 6 }); }
        bumpV = Math.max(bumpV, -rv);
      }
    }
  }
  if (bumpV > 120 && (!W.bumpT || W.time - W.bumpT > 0.08)) { W.bumpT = W.time; ev(g, { e: 'bump', v: r1(bumpV) }); }
}

// ------------------------------------------------------------------ bots
function botThink(W, c, dt) {
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
    const px = c.x + Math.cos(c.a) * 200, py = c.y + Math.sin(c.a) * 200;
    let danger = px < 120 || py < 120 || px > A.w - 120 || py > A.h - 120;
    for (const k of A.circles) if (Math.hypot(px - k.x, py - k.y) < k.r + 60) danger = true;
    for (const q of A.rects) if (px > q.x - 60 && px < q.x + q.w + 60 && py > q.y - 60 && py < q.y + q.h + 60) danger = true;
    if (W.sdOn && Math.hypot(c.x - A.w / 2, c.y - A.h / 2) > W.safeR - 220) danger = true;
    if (danger) { tx = A.w / 2 + Math.sin(W.time + c.p.color) * 300; ty = A.h / 2 + Math.cos(W.time * 0.7 + c.p.color) * 200; }
    if (speed < 60) b.stuckT += dt; else b.stuckT = 0;
    if (b.stuckT > 0.8) { inp.l = true; inp.r = false; inp.b = false; if (b.stuckT > 1.6) b.stuckT = 0; return; }
  }
  const diff = angNorm(Math.atan2(ty - c.y, tx - c.x) - c.a);
  inp.l = diff < -0.07; inp.r = diff > 0.07; inp.b = brake;
  if (c.item) {
    b.itemT -= dt;
    if (b.itemT <= 0 && botWantsItem(W, c)) { inp.fire = true; b.itemT = rand(0.5, 2); }
  }
}

function botWantsItem(W, c) {
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

// ------------------------------------------------------------------ paso del mundo
function stepWorld(g, W, dt) {
  W.time += dt;
  const live = g.phase === 'race' || g.phase === 'roundover' || g.phase === 'matchover';
  for (const c of W.cars) {
    if (!c.alive) continue;
    if (c.bot) botThink(W, c, dt);
    if (!live) { c.p.input.fire = false; continue; }
    if (c.p.input.fire) { c.p.input.fire = false; useItem(g, W, c); }
    stepCar(g, W, c, dt);
    if (W.arena) {
      const imp = arenaConstrain(c, W.map, CAR_R, 0.45);
      if (imp > 0) wallFx(g, c, c.x, c.y, imp);
    } else trackConstrain(g, W, c);
  }
  if (live) carCollisions(g, W);

  // cajas
  for (const b of W.boxes) {
    if (!b.active) { b.t -= dt; if (b.t <= 0) b.active = true; continue; }
    for (const c of W.cars) {
      if (!c.alive || c.item || c.roll > 0) continue;
      if ((c.x - b.x) ** 2 + (c.y - b.y) ** 2 < (CAR_R + 22) ** 2) {
        b.active = false; b.t = W.arena ? 2.5 : 3;
        c.roll = 0.7; c.rollItem = rollItem(W, c);
        ev(g, { e: 'pick', x: b.x, y: b.y });
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
      const T = W.map, k = (m.seg + 10) % T.N;
      m.a += clamp(angNorm(Math.atan2(T.ys[k] - m.y, T.xs[k] - m.x) - m.a), -3 * dt, 3 * dt);
    }
    m.a = angNorm(m.a);
    m.x += Math.cos(m.a) * m.v * dt; m.y += Math.sin(m.a) * m.v * dt;
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
      if ((c.x - m.x) ** 2 + (c.y - m.y) ** 2 < (CAR_R + 9) ** 2) { hit(g, W, c, 'missile', m.x - Math.cos(m.a) * 30, m.y - Math.sin(m.a) * 30); boom = true; break; }
    }
    if (boom) { ev(g, { e: 'boom', x: r1(m.x), y: r1(m.y) }); W.missiles.splice(i, 1); }
  }

  // minas
  for (let i = W.mines.length - 1; i >= 0; i--) {
    const m = W.mines[i];
    m.arm -= dt; m.ownArm -= dt; m.life -= dt;
    let boom = false;
    for (const c of W.cars) {
      if (!c.alive) continue;
      if (c === m.owner ? m.ownArm > 0 : m.arm > 0) continue;
      if ((c.x - m.x) ** 2 + (c.y - m.y) ** 2 < (CAR_R + 13) ** 2) { hit(g, W, c, 'mine', m.x, m.y); boom = true; break; }
    }
    for (const o of W.missiles) if ((o.x - m.x) ** 2 + (o.y - m.y) ** 2 < 24 * 24) boom = true;
    if (boom) { ev(g, { e: 'boom', x: r1(m.x), y: r1(m.y) }); W.mines.splice(i, 1); }
    else if (m.life <= 0) { ev(g, { e: 'spk', x: r1(m.x), y: r1(m.y), n: 6, c: '#888888' }); W.mines.splice(i, 1); }
  }

  // aceite
  for (let i = W.oils.length - 1; i >= 0; i--) {
    const o = W.oils[i];
    o.life -= dt; o.ownT -= dt;
    if (o.life <= 0) { W.oils.splice(i, 1); continue; }
    for (const c of W.cars) {
      if (!c.alive || c.spin > 0 || (c === o.owner && o.ownT > 0)) continue;
      if ((c.x - o.x) ** 2 + (c.y - o.y) ** 2 < (o.r + 6) ** 2) hit(g, W, c, 'oil', o.x, o.y);
    }
  }

  if (!W.arena) updateCamera(W, dt, live);
  if (g.phase === 'race' && !W.over) rules(g, W, dt);
  if (W.ending > 0) { W.ending -= dt; if (W.ending <= 0) endRound(g); }
}

function updateCamera(W, dt, live) {
  let leader = null;
  for (const c of W.cars) if (c.alive && (!leader || c.prog > leader.prog)) leader = c;
  if (!leader) return;
  W.leader = leader;
  const look = 0.28 * W.shrink;
  const tx = leader.x + leader.vx * look, ty = leader.y + leader.vy * look;
  const k = live ? Math.min(1, dt * 5) : Math.min(1, dt * 3);
  W.cam.x += (tx - W.cam.x) * k; W.cam.y += (ty - W.cam.y) * k;
}

function rules(g, W, dt) {
  const t = W.time - W.raceStart;
  if (!W.arena) {
    W.shrink = 1 - (1 - KO_SD_MIN) * clamp((t - KO_SD_START) / KO_SD_LEN, 0, 1);
    if (t > KO_SD_START && !W.sdOn) { W.sdOn = true; ev(g, { e: 'sfx', s: 'sudden' }); ev(g, { e: 'toast', text: '¡MUERTE SÚBITA! La pantalla se achica', c: '#ff4d4d' }); }
    const hw = (VIEW_W / 2) * W.shrink, hh = (VIEW_H / 2) * W.shrink;
    const out = [];
    for (const c of W.cars) {
      if (!c.alive) continue;
      const ex = Math.abs(c.x - W.cam.x) - hw, ey = Math.abs(c.y - W.cam.y) - hh;
      c.warn = Math.max(ex, ey) > -130 ? 1 : 0;
      if (ex > 10 || ey > 10) out.push(c);
    }
    out.sort((a, b) => a.prog - b.prog).forEach((c) => eliminate(g, W, c, 'camera'));
  } else if (t > AR_SD_START) {
    const A = W.map;
    if (!W.sdOn) { W.sdOn = true; ev(g, { e: 'sfx', s: 'sudden' }); ev(g, { e: 'toast', text: '¡MUERTE SÚBITA! El cerco se cierra', c: '#ff4d4d' }); }
    W.safeR = 1900 - 1580 * clamp((t - AR_SD_START) / AR_SD_LEN, 0, 1);
    for (const c of W.cars) {
      if (!c.alive) continue;
      if (Math.hypot(c.x - A.w / 2, c.y - A.h / 2) > W.safeR) {
        c.sdT += dt;
        if (c.sdT > 0.9) { c.sdT = 0; damage(g, W, c, 1); ev(g, { e: 'spk', x: r1(c.x), y: r1(c.y), n: 10, c: '#ff5050' }); vibrate(g, c.p, 80); }
      } else c.sdT = Math.max(0, c.sdT - dt);
    }
  }
  const alive = W.cars.filter((c) => c.alive);
  if (alive.length <= 1 && !W.ending) { W.ending = 1.6; W.winner = alive[0] || null; W.over = true; }
}

// ------------------------------------------------------------------ fases
function startMatch(g) {
  if (g.phase !== 'lobby' && g.phase !== 'matchover') return false;
  if (participants(g).length < 2) return false;
  g.players = g.players.filter((p) => p.kind === 'bot' || p.connected);
  for (const p of g.players) { p.score = 0; p.lastGain = 0; p.lastPlace = 0; }
  g.round = 0; g.champion = null; g.roundWinner = null;
  g.trackQueue = shuffle([...TRACKS.keys()]);
  g.arenaIdx = Math.floor(Math.random() * ARENAS.length);
  nextRound(g);
  return true;
}
function nextMap(g) {
  if (MODES[g.mode].arena) { g.arenaIdx = (g.arenaIdx + 1) % ARENAS.length; return ['arena', g.arenaIdx]; }
  if (!g.trackQueue.length) g.trackQueue = shuffle([...TRACKS.keys()]);
  return ['track', g.trackQueue.shift()];
}
function peekNextMapName(g) {
  if (MODES[g.mode].arena) return ARENAS[(g.arenaIdx + 1) % ARENAS.length].name;
  return g.trackQueue.length ? TRACKS[g.trackQueue[0]].name : 'Pista sorpresa';
}
function nextRound(g) {
  g.round++;
  const [kind, idx] = nextMap(g);
  g.world = makeWorld(g, kind, idx, participants(g));
  g.phase = 'intro'; g.phaseT = 0; g.countShown = 4;
}
function endRound(g) {
  const W = g.world;
  const podium = Math.min(3, W.cars.length - 1);
  const order = [];
  if (W.winner) order.push(W.winner);
  for (let i = W.elimOrder.length - 1; i >= 0; i--) order.push(W.elimOrder[i]);
  for (const p of g.players) { p.lastGain = 0; p.lastPlace = 0; }
  order.forEach((c, k) => {
    if (!g.players.includes(c.p)) return;
    const pts = Math.max(0, podium - k);
    c.p.score += pts; c.p.lastGain = pts; c.p.lastPlace = k + 1;
  });
  g.roundWinner = W.winner ? W.winner.p : null;
  if (W.winner) { ev(g, { e: 'sfx', s: 'win' }); vibrate(g, W.winner.p, [60, 60, 60, 60, 200]); }
  const top = Math.max(0, ...g.players.map((p) => p.score));
  const leaders = g.players.filter((p) => p.score === top);
  g.champion = top >= g.target && leaders.length === 1 ? leaders[0] : null;
  g.phase = 'roundover'; g.phaseT = 0;
}
function matchOver(g) {
  g.phase = 'matchover'; g.phaseT = 0;
  ev(g, { e: 'sfx', s: 'fanfare' });
  ev(g, { e: 'confetti' });
  vibrate(g, g.champion, [100, 50, 100, 50, 400]);
}
function goLobby(g) {
  g.phase = 'lobby'; g.phaseT = 0; g.champion = null; g.roundWinner = null; g.world = null;
  g.players = g.players.filter((p) => p.kind === 'bot' || p.connected);
  for (const p of g.players) { p.score = 0; p.lastGain = 0; p.lastPlace = 0; }
}

function update(g, dt, now) {
  g.clock += dt;
  g.phaseT += dt;
  const W = g.world;
  if (g.phase === 'lobby') {
    // libera lugares de celulares que no volvieron
    for (const p of [...g.players]) {
      if (p.kind === 'human' && !p.connected && now - p.leftAt > LOBBY_DROP_MS) {
        removePlayer(g, p);
        ev(g, { e: 'toast', text: `${p.name} se fue`, c: '#aaaaaa' });
      }
    }
    return;
  }
  if (g.phase === 'intro') {
    const n = 3 - Math.floor((g.phaseT - 0.6) / 0.8);
    if (g.phaseT > 0.6 && n !== g.countShown && n >= 1) { g.countShown = n; ev(g, { e: 'count', n }); }
    if (g.phaseT >= INTRO_TIME) {
      g.phase = 'race'; W.raceStart = W.time;
      ev(g, { e: 'count', n: 0 });
      for (const p of g.players) p.input.fire = false;
    }
  } else if (g.phase === 'roundover') {
    if (g.phaseT > 6) { if (g.champion) matchOver(g); else nextRound(g); }
  } else if (g.phase === 'matchover') {
    if (g.phaseT > 60) goLobby(g);
  }
  if (g.world) stepWorld(g, g.world, dt);
}

// ------------------------------------------------------------------ comandos
function input(g, p, d) { p.input.l = !!d.l; p.input.r = !!d.r; p.input.b = !!d.b; }
function fire(g, p) { p.input.fire = true; }
function command(g, p, isTv, a, v) {
  if (a === 'color' && p) { cycleColor(g, p); return; }
  if (!isTv && vip(g) !== p) return;
  switch (a) {
    case 'mode': if (MODES[v] && g.phase === 'lobby') g.mode = v; break;
    case 'target': if (TARGETS.includes(Number(v)) && g.phase === 'lobby') g.target = Number(v); break;
    case 'start': if (g.phase === 'lobby') startMatch(g); break;
    case 'again': if (g.phase === 'matchover') startMatch(g); break;
    case 'lobby': if (g.phase === 'matchover' || g.phase === 'roundover') goLobby(g); break;
    case 'next': if (g.phase === 'roundover' && g.phaseT > 1.5) g.phaseT = 99; break;
    case 'addbot': if (g.phase === 'lobby') addBot(g); break;
    case 'rmbot': if (g.phase === 'lobby') { const b = [...g.players].reverse().find((x) => x.kind === 'bot'); if (b) removePlayer(g, b); } break;
  }
}
function setConnected(g, p, on, now) {
  p.connected = on;
  if (!on) { p.leftAt = now; p.input = { l: false, r: false, b: false, fire: false }; }
}

// ------------------------------------------------------------------ red
function meta(g) {
  const W = g.world, v = vip(g);
  return {
    t: 'st', phase: g.phase, mode: g.mode, target: g.target, round: g.round, vip: v ? v.id : null,
    players: g.players.map((p) => ({ id: p.id, name: p.name, color: p.color, kind: p.kind, on: p.connected, score: p.score, gain: p.lastGain, place: p.lastPlace })),
    roundWinner: g.roundWinner ? g.roundWinner.id : null,
    champion: g.champion ? g.champion.id : null,
    nextMap: g.phase === 'roundover' && !g.champion ? peekNextMapName(g) : null,
    world: W ? { id: W.id, kind: W.kind, idx: W.idx, boxes: W.boxes.map((b) => [b.x, b.y]), cars: W.cars.map((c) => c.p.id) } : null,
  };
}

function snapshot(g) {
  const W = g.world;
  const s = {
    t: 's', w: W.id, k: r3(g.clock), ph: PHASES.indexOf(g.phase), pt: r2(g.phaseT),
    rt: g.phase === 'intro' ? 0 : r2(W.time - W.raceStart),
    cam: W.arena ? null : [r1(W.cam.x), r1(W.cam.y)],
    sh: r3(W.shrink), sr: W.safeR === Infinity ? 0 : r1(W.safeR), sd: W.sdOn ? 1 : 0, ov: W.over ? 1 : 0,
    c: W.cars.map((c) => {
      let f = 0;
      if (c.alive) f |= F.ALIVE;
      if (c.spin > 0) f |= F.SPIN;
      if (c.shield > 0) f |= F.SHIELD;
      if (c.shield > 0 && c.shield < 1.5) f |= F.SHIELD_LOW;
      if (c.turbo > 0) f |= F.TURBO;
      if (c.offroad) f |= F.OFFROAD;
      if (c.skid) f |= F.SKID;
      if (c.warn && c.alive) f |= F.WARN;
      if (c.hitFlash > 0) f |= F.FLASH;
      if (c.brake) f |= F.BRAKE;
      return [c.p.id, r1(c.x), r1(c.y), r3(c.a), r2(c.steer), f, c.hp, ITEM_LIST.indexOf(c.roll > 0 ? 'roll' : c.item || '')];
    }),
    m: W.missiles.map((m) => [m.id, r1(m.x), r1(m.y), r2(m.a)]),
    n: W.mines.map((m) => [m.id, r1(m.x), r1(m.y), m.life < 4 ? 1 : 0]),
    o: W.oils.map((o) => [o.id, r1(o.x), r1(o.y), r2(o.life)]),
    b: W.boxes.map((b) => (b.active ? 1 : 0)).join(''),
    e: g.events,
  };
  g.events = [];
  return s;
}

module.exports = {
  DT, TRACKS, ARENAS, createGame, addHuman, addBot, removePlayer, humans, vip, participants,
  update, input, fire, command, setConnected, meta, snapshot, startMatch, goLobby,
};
