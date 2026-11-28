// Asfalto Salvaje — servidor: salas, simulación autoritativa y red.
// Cada jugador ve la carrera en su propio dispositivo; el servidor corre la
// simulación a 60 Hz y manda instantáneas a ~30 Hz.
const express = require('express');
const http = require('http');
const path = require('path');
const crypto = require('crypto');
const { performance } = require('perf_hooks');
const { WebSocketServer } = require('ws');
const QRCode = require('qrcode');
const Sim = require('./game/sim');

const PORT = process.env.PORT || 3000;
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const ROOM_IDLE_MS = 3 * 60_000; // sala vacía se borra a los 3 minutos
const SNAP_MS = 33;
const META_MS = 100;
const MAX_TV = 6;

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 8 * 1024 });

app.get('/healthz', (_req, res) => res.send('ok'));
app.get('/qr.svg', async (req, res) => {
  const url = String(req.query.u || '');
  if (!url || url.length > 300) return res.status(400).send('bad url');
  try {
    const svg = await QRCode.toString(url, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' });
    res.set('Cache-Control', 'public, max-age=3600').type('image/svg+xml').send(svg);
  } catch {
    res.status(500).send('qr error');
  }
});
// Links viejos (/c?r=CODE) siguen funcionando
app.get('/c', (req, res) => res.redirect(302, '/' + (req.query.r ? `?r=${encodeURIComponent(String(req.query.r).slice(0, 4))}` : '')));
app.use('/shared', express.static(path.join(__dirname, 'shared')));
// Three.js (render 3D) servido desde node_modules
let threeDir = path.join(__dirname, 'node_modules', 'three', 'build');
try { threeDir = path.dirname(require.resolve('three/build/three.module.js')); } catch {}
app.use('/vendor/three', express.static(threeDir, { maxAge: '7d', immutable: true }));
app.use(express.static(path.join(__dirname, 'public'), { extensions: ['html'] }));

/** code -> { code, game, clients:Set<ws>, emptySince, lastSnap, lastMeta, metaStr, wid } */
const rooms = new Map();

function newCode() {
  for (;;) {
    let c = '';
    for (let i = 0; i < 4; i++) c += CODE_CHARS[crypto.randomInt(CODE_CHARS.length)];
    if (!rooms.has(c)) return c;
  }
}
function send(ws, msg) { if (ws && ws.readyState === 1) ws.send(typeof msg === 'string' ? msg : JSON.stringify(msg)); }
function broadcast(room, str) { for (const ws of room.clients) send(ws, str); }

function makeRoom() {
  const room = { code: newCode(), game: Sim.createGame(), clients: new Set(), emptySince: null, lastSnap: 0, lastMeta: 0, metaStr: '', wid: 0 };
  rooms.set(room.code, room);
  return room;
}

function flushMeta(room, force) {
  const str = JSON.stringify(Sim.meta(room.game));
  if (force || str !== room.metaStr) { room.metaStr = str; broadcast(room, str); }
}

function attach(ws, room, msg) {
  const g = room.game;
  if (ws.room) detach(ws);
  let p = null;
  if (msg.tv) {
    if ([...room.clients].filter((c) => c.tv).length >= MAX_TV) return send(ws, { t: 'error', msg: 'Hay demasiadas pantallas conectadas a esta sala' });
  } else {
    p = msg.token ? g.players.find((x) => x.kind === 'human' && x.token === msg.token) : null;
    if (p) {
      if (p.ws && p.ws !== ws) { send(p.ws, { t: 'closed', reason: 'Te conectaste desde otra pestaña' }); p.ws.room = null; p.ws.close(); }
    } else {
      p = Sim.addHuman(g, msg.name);
      if (!p) return send(ws, { t: 'error', msg: 'La sala está llena (máximo 8 jugadores)' });
      p.token = crypto.randomBytes(12).toString('hex');
    }
    p.ws = ws;
    Sim.setConnected(g, p, true, Date.now());
  }
  ws.room = room; ws.tv = !!msg.tv; ws.pid = p ? p.id : null;
  room.clients.add(ws);
  room.emptySince = null;
  send(ws, { t: 'joined', code: room.code, id: ws.pid, token: p ? p.token : null, tv: ws.tv });
  send(ws, room.metaStr || JSON.stringify(Sim.meta(g)));
  flushMeta(room, false);
}

function detach(ws) {
  const room = ws.room;
  if (!room) return;
  room.clients.delete(ws);
  if (ws.pid) {
    const p = room.game.players.find((x) => x.id === ws.pid);
    if (p && p.ws === ws) { p.ws = null; Sim.setConnected(room.game, p, false, Date.now()); }
  }
  ws.room = null;
  if (!room.clients.size) room.emptySince = Date.now();
}

wss.on('connection', (ws) => {
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });
  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }
    if (!msg || typeof msg.t !== 'string') return;
    switch (msg.t) {
      case 'create': {
        const room = makeRoom();
        attach(ws, room, msg);
        return;
      }
      case 'join': {
        const room = rooms.get(String(msg.code || '').toUpperCase().trim());
        if (!room) return send(ws, { t: 'error', msg: 'No existe una sala con ese código', bad: true });
        attach(ws, room, msg);
        return;
      }
      case 'leave': {
        const room = ws.room;
        if (!room) return;
        const p = ws.pid && room.game.players.find((x) => x.id === ws.pid);
        detach(ws);
        if (p && room.game.phase === 'lobby') Sim.removePlayer(room.game, p);
        return;
      }
      case 'ping': send(ws, { t: 'pong', c: msg.c }); return;
    }
    const room = ws.room;
    if (!room) return;
    const g = room.game;
    const p = ws.pid ? g.players.find((x) => x.id === ws.pid) : null;
    if (p && p.ws !== ws) return;
    switch (msg.t) {
      case 'in': if (p) Sim.input(g, p, msg); break;
      case 'fire': if (p) Sim.fire(g, p); break;
      case 'fire2': if (p) Sim.fireAnti(g, p); break;
      case 'cmd': Sim.command(g, p, ws.tv, String(msg.a || ''), msg.v); flushMeta(room, false); break;
    }
  });
  ws.on('close', () => detach(ws));
});

// Bucle principal: simula todas las salas activas
let last = performance.now(), acc = 0;
setInterval(() => {
  const now = performance.now();
  acc += Math.min(0.25, (now - last) / 1000);
  last = now;
  const wall = Date.now();
  let steps = 0;
  while (acc >= Sim.DT && steps < 10) {
    for (const room of rooms.values()) if (room.clients.size) Sim.update(room.game, Sim.DT, wall);
    acc -= Sim.DT; steps++;
  }
  if (steps === 10) acc = 0;
  for (const room of rooms.values()) {
    if (!room.clients.size) {
      if (room.emptySince && wall - room.emptySince > ROOM_IDLE_MS) rooms.delete(room.code);
      continue;
    }
    const g = room.game;
    const wid = g.world ? g.world.id : 0;
    if (wid !== room.wid || now - room.lastMeta >= META_MS) {
      flushMeta(room, false);
      room.lastMeta = now; room.wid = wid;
    }
    if (g.world && now - room.lastSnap >= SNAP_MS) {
      room.lastSnap = now;
      broadcast(room, JSON.stringify(Sim.snapshot(g)));
    } else if (!g.world && g.events.length) {
      broadcast(room, JSON.stringify({ t: 'ev', e: g.events }));
      g.events = [];
    }
  }
}, 1000 / 60);

// Mantiene vivas las conexiones detrás del proxy de Render
const heartbeat = setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.isAlive) { ws.terminate(); continue; }
    ws.isAlive = false;
    ws.ping();
  }
}, 20_000);
wss.on('close', () => clearInterval(heartbeat));

server.listen(PORT, () => console.log(`Asfalto Salvaje escuchando en http://localhost:${PORT}`));
