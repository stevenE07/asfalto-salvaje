// Asfalto Salvaje — servidor de salas.
// La pantalla grande (host) corre la simulación; los celulares (controles)
// mandan sus entradas y el servidor solo las reenvía.
const express = require('express');
const http = require('http');
const path = require('path');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');
const QRCode = require('qrcode');

const PORT = process.env.PORT || 3000;
const MAX_PLAYERS = 8;
const HOST_GRACE_MS = 45_000; // tiempo para que la pantalla recargue sin perder la sala
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 16 * 1024 });

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

app.use(express.static(path.join(__dirname, 'public'), { extensions: ['html'] }));

/** code -> { code, host, hostTimer, players: Map<id, player>, nextId } */
const rooms = new Map();

function newCode() {
  for (;;) {
    let c = '';
    for (let i = 0; i < 4; i++) c += CODE_CHARS[crypto.randomInt(CODE_CHARS.length)];
    if (!rooms.has(c)) return c;
  }
}

function send(ws, msg) {
  if (ws && ws.readyState === 1) ws.send(JSON.stringify(msg));
}

function playerList(room) {
  return [...room.players.values()].map((p) => ({ id: p.id, name: p.name, connected: !!p.ws }));
}

function closeRoom(room, reason) {
  for (const p of room.players.values()) {
    send(p.ws, { t: 'closed', reason });
    if (p.ws) p.ws.roomCode = null;
  }
  rooms.delete(room.code);
}

function cleanName(n) {
  const s = String(n || '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 12);
  return s || 'Piloto';
}

wss.on('connection', (ws) => {
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }
    if (!msg || typeof msg.t !== 'string') return;

    // ---------- Pantalla principal ----------
    if (msg.t === 'host') {
      let room = msg.code && rooms.get(String(msg.code).toUpperCase());
      if (room && room.hostKey === msg.key) {
        // La pantalla recargó: recupera la sala
        clearTimeout(room.hostTimer);
        if (room.host && room.host !== ws) { room.host.role = null; room.host.close(); }
      } else {
        room = { code: newCode(), host: null, hostTimer: null, players: new Map(), nextId: 1, hostKey: crypto.randomBytes(8).toString('hex') };
        rooms.set(room.code, room);
      }
      room.host = ws;
      ws.role = 'host';
      ws.roomCode = room.code;
      send(ws, { t: 'room', code: room.code, key: room.hostKey, players: playerList(room) });
      for (const p of room.players.values()) send(p.ws, { t: 'hostback' });
      return;
    }

    if (ws.role === 'host') {
      const room = rooms.get(ws.roomCode);
      if (!room || room.host !== ws) return;
      if (msg.t === 'to') {
        const p = room.players.get(msg.id);
        if (p) send(p.ws, msg.d);
      } else if (msg.t === 'all') {
        for (const p of room.players.values()) send(p.ws, msg.d);
      } else if (msg.t === 'drop') {
        const p = room.players.get(msg.id);
        if (p) {
          send(p.ws, { t: 'closed', reason: msg.reason || 'Fuiste removido de la sala' });
          if (p.ws) p.ws.roomCode = null;
          room.players.delete(msg.id);
        }
      }
      return;
    }

    // ---------- Controles (celulares) ----------
    if (msg.t === 'join') {
      const code = String(msg.code || '').toUpperCase().trim();
      const room = rooms.get(code);
      if (!room) return send(ws, { t: 'error', msg: 'No existe una sala con ese código' });
      let p = msg.token && [...room.players.values()].find((x) => x.token === msg.token);
      if (p) {
        if (p.ws && p.ws !== ws) { p.ws.roomCode = null; send(p.ws, { t: 'closed', reason: 'Te conectaste desde otra pestaña' }); p.ws.close(); }
        p.ws = ws;
        if (msg.name) p.name = cleanName(msg.name);
        send(room.host, { t: 'preconnect', id: p.id, name: p.name });
      } else {
        if (room.players.size >= MAX_PLAYERS) return send(ws, { t: 'error', msg: 'La sala está llena (máximo 8 jugadores)' });
        p = { id: room.nextId++, name: cleanName(msg.name), token: crypto.randomBytes(12).toString('hex'), ws };
        room.players.set(p.id, p);
        send(room.host, { t: 'pjoin', id: p.id, name: p.name });
      }
      ws.role = 'ctrl';
      ws.roomCode = code;
      ws.playerId = p.id;
      send(ws, { t: 'joined', id: p.id, token: p.token, code, hostOnline: !!room.host });
      return;
    }

    if (ws.role === 'ctrl') {
      const room = rooms.get(ws.roomCode);
      if (!room) return;
      const p = room.players.get(ws.playerId);
      if (!p || p.ws !== ws) return;
      send(room.host, { t: 'c', id: p.id, d: msg });
    }
  });

  ws.on('close', () => {
    const room = ws.roomCode && rooms.get(ws.roomCode);
    if (!room) return;
    if (ws.role === 'host' && room.host === ws) {
      room.host = null;
      for (const p of room.players.values()) send(p.ws, { t: 'hostgone' });
      room.hostTimer = setTimeout(() => {
        if (!room.host) closeRoom(room, 'La pantalla principal se desconectó');
      }, HOST_GRACE_MS);
    } else if (ws.role === 'ctrl') {
      const p = room.players.get(ws.playerId);
      if (p && p.ws === ws) {
        p.ws = null;
        send(room.host, { t: 'pleave', id: p.id });
      }
    }
  });
});

// Mantiene vivas las conexiones detrás del proxy de Render
const heartbeat = setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.isAlive) { ws.terminate(); continue; }
    ws.isAlive = false;
    ws.ping();
  }
}, 20_000);
wss.on('close', () => clearInterval(heartbeat));

server.listen(PORT, () => {
  console.log(`Asfalto Salvaje escuchando en http://localhost:${PORT}`);
});
