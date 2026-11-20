// Asfalto Salvaje — cliente: cada jugador ve la carrera en su pantalla.
// El servidor simula; acá se interpolan las instantáneas, se dibuja y se mandan los controles.
(() => {
  'use strict';
  const { COLORS, ITEMS, ITEM_LIST, MODES, PHASES, F, TARGETS, MAX_PLAYERS, VIEW_W, VIEW_H, INTRO_TIME } = window.Common;
  const { ROAD, CURB, WALL, pointAt } = window.Tracks;
  const TRACKS = window.Tracks.TRACK_DEFS.map(window.Tracks.buildTrack);
  const ARENAS = window.Tracks.ARENA_DEFS.map(window.Tracks.buildArena);

  // ------------------------------------------------------------------ util
  const TAU = Math.PI * 2;
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const rand = (a, b) => a + Math.random() * (b - a);
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
  const lerp = (a, b, t) => a + (b - a) * t;
  const angNorm = (a) => { while (a > Math.PI) a -= TAU; while (a < -Math.PI) a += TAU; return a; };
  const angLerp = (a, b, t) => a + angNorm(b - a) * t;
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  function seeded(seed) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }
  const $ = (id) => document.getElementById(id);
  const canvas = $('game');
  const ctx = canvas.getContext('2d');
  const isTouch = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
  if (isTouch) document.body.classList.add('touch');

  const INTERP = 0.1; // segundos de colchón para interpolar

  // ------------------------------------------------------------------ estado
  const S = {
    me: { id: null, tv: false, code: null },
    meta: null, world: null, snaps: [], off: null,
    cars: new Map(), missiles: [], mines: [], oils: [], snap: null,
    parts: [], skids: [], waves: [], toasts: [], shake: 0,
    cam: { x: 0, y: 0, zoom: 1 }, camInit: false,
    ping: 0, dpr: 1, cssW: 0, cssH: 0, baseScale: 1,
    attract: null, input: { l: false, r: false, b: false },
  };
  let sess = {};
  try { sess = JSON.parse(localStorage.getItem('as_sess') || '{}') || {}; } catch {}
  const saveSess = () => { try { localStorage.setItem('as_sess', JSON.stringify(sess)); } catch {} };

  // ------------------------------------------------------------------ red
  const net = {
    ws: null, retry: 0, queue: [],
    send(m) {
      if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify(m));
      else if (m.t === 'create' || m.t === 'join') this.queue = [m];
    },
    connect() {
      const ws = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/ws');
      this.ws = ws;
      ws.onopen = () => {
        this.retry = 0;
        $('netStatus').classList.add('hidden');
        if (S.me.code && sess.code === S.me.code) {
          this.send({ t: 'join', code: sess.code, token: sess.token, name: sess.name, tv: sess.tv });
        } else if (this.queue.length) {
          this.queue.forEach((m) => this.send(m)); this.queue = [];
        }
      };
      ws.onmessage = (e) => { let m; try { m = JSON.parse(e.data); } catch { return; } onNet(m); };
      ws.onclose = () => {
        if (S.me.code) { $('netStatus').textContent = 'Reconectando…'; $('netStatus').classList.remove('hidden'); }
        setTimeout(() => this.connect(), Math.min(4000, 400 + this.retry++ * 500));
      };
    },
  };
  setInterval(() => net.send({ t: 'ping', c: performance.now() }), 2000);

  function onNet(m) {
    switch (m.t) {
      case 'joined':
        S.me = { id: m.id, tv: m.tv, code: m.code };
        sess.code = m.code; sess.token = m.token; sess.tv = m.tv; saveSess();
        S.off = null; S.snaps = [];
        history.replaceState(null, '', `?r=${m.code}`);
        $('home').classList.add('hidden');
        $('homeErr').textContent = '';
        requestWakeLock();
        break;
      case 'error':
        if (m.bad) { sess.code = null; sess.token = null; saveSess(); }
        leaveToHome(m.msg);
        break;
      case 'closed':
        sess.code = null; sess.token = null; saveSess();
        leaveToHome(m.reason);
        break;
      case 'st': onMeta(m); break;
      case 's': onSnap(m); break;
      case 'ev': m.e.forEach(handleEvent); break;
      case 'pong': S.ping = Math.round(performance.now() - m.c); break;
    }
  }

  function leaveToHome(err) {
    S.me = { id: null, tv: false, code: null };
    S.meta = null; S.world = null; S.snaps = []; S.cars.clear();
    history.replaceState(null, '', location.pathname);
    ['lobby', 'roundOver', 'matchOver', 'controls', 'statusPill', 'rotateHint'].forEach((id) => $(id).classList.add('hidden'));
    $('home').classList.remove('hidden');
    $('homeErr').textContent = err || '';
    document.body.classList.remove('ingame');
  }

  // ------------------------------------------------------------------ meta
  function player(id) { return S.meta ? S.meta.players.find((p) => p.id === id) : null; }
  function canCmd() { return !!S.meta && (S.me.tv || S.meta.vip === S.me.id); }

  function onMeta(m) {
    const prev = S.meta;
    S.meta = m;
    if (m.world && (!S.world || S.world.id !== m.world.id)) buildWorld(m.world);
    if (!m.world) { S.world = null; S.snaps = []; S.cars.clear(); }
    if (prev && prev.players.length < m.players.length && m.phase === 'lobby') SFX.join();
    updateScreens(prev);
  }

  function buildWorld(w) {
    const map = w.kind === 'arena' ? ARENAS[w.idx] : TRACKS[w.idx];
    S.world = {
      id: w.id, kind: w.kind, idx: w.idx, map, arena: w.kind === 'arena',
      s0: w.kind === 'track' ? map.cum[map.startIdx] : 0,
      decor: w.kind === 'track' ? genDecor(map, w.idx) : null,
      boxes: w.boxes.map(([x, y], i) => ({ x, y, active: true, ph: i * 1.7 })),
      time: 0,
    };
    S.snaps = S.snaps.filter((s) => s.w === w.id);
    S.cars.clear(); S.parts = []; S.skids = []; S.waves = []; S.missiles = []; S.mines = []; S.oils = [];
    S.camInit = false;
  }

  function updateScreens(prev) {
    const m = S.meta;
    const inGame = m.phase !== 'lobby';
    document.body.classList.toggle('ingame', inGame);
    $('lobby').classList.toggle('hidden', inGame);
    if (!inGame) renderLobby();
    // resultados
    $('roundOver').classList.toggle('hidden', m.phase !== 'roundover');
    $('matchOver').classList.toggle('hidden', m.phase !== 'matchover');
    if (m.phase === 'roundover' && (!prev || prev.phase !== 'roundover' || prev.round !== m.round)) renderRoundOver();
    if (m.phase === 'roundover') $('roNext').textContent = m.champion ? '¡Tenemos campeón!' : m.nextMap ? `Siguiente: ${m.nextMap}` : '';
    $('btnNext').classList.toggle('hidden', !(m.phase === 'roundover' && canCmd()));
    if (m.phase === 'matchover' && (!prev || prev.phase !== 'matchover')) renderMatchOver();
    if (m.phase === 'matchover') { $('moBtns').classList.toggle('hidden', !canCmd()); $('moWait').classList.toggle('hidden', canCmd()); }
    const myCarIn = S.world && S.me.id && S.meta.world && S.meta.world.cars.includes(S.me.id);
    $('controls').classList.toggle('hidden', !(isTouch && inGame && myCarIn && m.phase !== 'roundover' && m.phase !== 'matchover'));
  }

  // ------------------------------------------------------------------ lobby
  function carSVG(hex, dark) {
    return `<svg viewBox="0 0 60 34" class="mini-car"><rect x="4" y="2" width="12" height="6" rx="1.5" fill="#111"/><rect x="4" y="26" width="12" height="6" rx="1.5" fill="#111"/><rect x="40" y="2" width="12" height="6" rx="1.5" fill="#111"/><rect x="40" y="26" width="12" height="6" rx="1.5" fill="#111"/><rect x="3" y="5" width="54" height="24" rx="8" fill="${hex}" stroke="${dark}" stroke-width="2"/><rect x="8" y="14.5" width="40" height="5" fill="#fff" opacity=".85"/><rect x="21" y="8" width="18" height="18" rx="4" fill="#1c2633"/><rect x="52" y="8" width="3" height="5" fill="#fff6c4"/><rect x="52" y="21" width="3" height="5" fill="#fff6c4"/></svg>`;
  }
  let qrFor = '';
  function renderLobby() {
    const m = S.meta;
    const link = `${location.origin}/?r=${S.me.code}`;
    $('roomCode').textContent = S.me.code || '····';
    $('joinUrl').textContent = link.replace(/^https?:\/\//, '');
    if (qrFor !== link) { qrFor = link; $('qr').src = `/qr.svg?u=${encodeURIComponent(link)}`; }
    const cmd = canCmd();
    let html = '';
    for (let i = 0; i < MAX_PLAYERS; i++) {
      const p = m.players[i];
      if (!p) { html += '<div class="slot empty">libre</div>'; continue; }
      const c = COLORS[p.color];
      const badge = p.kind === 'bot' ? '🤖' : m.vip === p.id ? '👑' : '';
      const sub = p.kind === 'bot' ? 'bot' : p.on ? c.name : 'desconectado…';
      html += `<div class="slot ${p.id === S.me.id ? 'me' : ''} ${p.kind === 'human' && !p.on ? 'off' : ''}" style="--c:${c.hex}">${p.id === S.me.id ? '<span class="you">VOS</span>' : ''}${carSVG(c.hex, c.dark)}<div class="slot-name">${badge} ${esc(p.name)}</div><div class="slot-sub">${sub}</div></div>`;
    }
    $('slots').innerHTML = html;
    $('modes').innerHTML = Object.entries(MODES).map(([k, v]) => `<button class="ghost ${m.mode === k ? 'sel' : ''}" data-cmd="mode" data-v="${k}" ${cmd ? '' : 'disabled'}>${v.icon} ${v.name}</button>`).join('');
    $('targets').innerHTML = TARGETS.map((t) => `<button class="ghost ${m.target === t ? 'sel' : ''}" data-cmd="target" data-v="${t}" ${cmd ? '' : 'disabled'} style="min-width:58px">${t}</button>`).join('');
    $('modeDesc').textContent = MODES[m.mode].desc;
    const n = m.players.filter((p) => p.kind === 'bot' || p.on).length;
    const bots = m.players.filter((p) => p.kind === 'bot').length;
    $('btnColor').classList.toggle('hidden', !S.me.id);
    $('btnBot').classList.toggle('hidden', !cmd); $('btnRmBot').classList.toggle('hidden', !cmd);
    $('btnBot').disabled = m.players.length >= MAX_PLAYERS; $('btnRmBot').disabled = !bots;
    $('btnStart').classList.toggle('hidden', !cmd);
    $('btnStart').disabled = n < 2;
    const vipP = player(m.vip);
    $('startHint').textContent = n < 2
      ? (cmd ? 'Se necesitan al menos 2 pilotos: invitá a alguien o sumá un bot' : 'Esperando más pilotos…')
      : cmd ? `${n} pilotos listos` : `Esperando que ${vipP ? vipP.name : 'el anfitrión'} 👑 empiece la carrera…`;
  }

  function renderRoundOver() {
    const m = S.meta, wn = player(m.roundWinner);
    $('roTitle').innerHTML = wn ? (wn.id === S.me.id ? '¡Ganaste la ronda! 🏆' : `<span style="color:${COLORS[wn.color].hex}">${esc(wn.name)}</span> gana la ronda`) : 'Ronda terminada';
    const list = [...m.players].sort((a, b) => b.score - a.score);
    $('roList').innerHTML = list.map((p, i) => `
      <div class="ro-row ${p.id === S.me.id ? 'me' : ''}">
        <span class="ro-pos">${i + 1}</span>
        <span class="ro-dot" style="background:${COLORS[p.color].hex}"></span>
        <span class="ro-name">${esc(p.name)}${p.id === S.me.id ? ' (vos)' : ''}</span>
        <span class="ro-gain">${p.gain ? '+' + p.gain : ''}</span>
        <span class="ro-bar"><i style="width:${Math.min(100, ((p.score - p.gain) / m.target) * 100)}%;background:${COLORS[p.color].hex}" data-to="${Math.min(100, (p.score / m.target) * 100)}"></i></span>
        <span class="ro-score">${p.score}<small>/${m.target}</small></span>
      </div>`).join('');
    setTimeout(() => document.querySelectorAll('#roList .ro-bar i').forEach((el) => { el.style.width = el.dataset.to + '%'; }), 350);
  }
  function renderMatchOver() {
    const m = S.meta, ch = player(m.champion);
    $('moTitle').innerHTML = ch ? (ch.id === S.me.id ? '🏆 ¡Sos el campeón!' : `🏆 <span style="color:${COLORS[ch.color].hex}">${esc(ch.name)}</span> gana la copa`) : 'Fin de la copa';
    const list = [...m.players].sort((a, b) => b.score - a.score);
    $('moList').innerHTML = list.map((p, i) => `
      <div class="ro-row ${p.id === S.me.id ? 'me' : ''}" style="grid-template-columns:36px 16px 1fr 58px">
        <span class="ro-pos">${['🥇', '🥈', '🥉'][i] || i + 1}</span>
        <span class="ro-dot" style="background:${COLORS[p.color].hex}"></span>
        <span class="ro-name">${esc(p.name)}${p.id === S.me.id ? ' (vos)' : ''}</span>
        <span class="ro-score">${p.score}</span>
      </div>`).join('');
  }

  // ------------------------------------------------------------------ UI
  $('nameIn').value = sess.name || '';
  const urlCode = (new URLSearchParams(location.search).get('r') || '').toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4);
  $('codeIn').value = urlCode;
  $('codeIn').addEventListener('input', (e) => { e.target.value = e.target.value.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4); });
  if (urlCode) setTimeout(() => $('nameIn').focus(), 50);

  function goFull() { if (isTouch) try { document.documentElement.requestFullscreen?.({ navigationUI: 'hide' }).catch(() => {}); } catch {} }
  function enter(msg) {
    SFX.ensure();
    sess.name = $('nameIn').value.trim() || 'Piloto'; saveSess();
    msg.name = sess.name;
    $('homeErr').textContent = 'Conectando…';
    goFull();
    net.send(msg);
  }
  $('btnCreate').addEventListener('click', () => enter({ t: 'create' }));
  $('btnJoin').addEventListener('click', () => {
    const code = $('codeIn').value.trim().toUpperCase();
    if (!/^[A-Z]{4}$/.test(code)) { $('homeErr').textContent = 'El código tiene 4 letras'; return; }
    enter({ t: 'join', code });
  });
  $('codeIn').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('btnJoin').click(); });
  $('nameIn').addEventListener('keydown', (e) => { if (e.key === 'Enter') (urlCode || $('codeIn').value.length === 4 ? $('btnJoin') : $('btnCreate')).click(); });
  $('btnTv').addEventListener('click', () => {
    const code = $('codeIn').value.trim().toUpperCase();
    SFX.ensure();
    net.send(/^[A-Z]{4}$/.test(code) ? { t: 'join', code, tv: true } : { t: 'create', tv: true });
  });
  $('btnLeave').addEventListener('click', () => {
    net.send({ t: 'leave' });
    sess.code = null; sess.token = null; saveSess();
    leaveToHome('');
  });
  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-cmd]');
    if (!b || b.disabled) return;
    SFX.click();
    net.send({ t: 'cmd', a: b.dataset.cmd, v: b.dataset.v });
  });
  $('btnColor').addEventListener('click', () => net.send({ t: 'cmd', a: 'color' }));
  $('btnBot').addEventListener('click', () => net.send({ t: 'cmd', a: 'addbot' }));
  $('btnRmBot').addEventListener('click', () => net.send({ t: 'cmd', a: 'rmbot' }));
  $('btnStart').addEventListener('click', () => { SFX.ensure(); net.send({ t: 'cmd', a: 'start' }); });
  $('btnNext').addEventListener('click', () => net.send({ t: 'cmd', a: 'next' }));
  $('btnAgain').addEventListener('click', () => net.send({ t: 'cmd', a: 'again' }));
  $('btnLobby').addEventListener('click', () => net.send({ t: 'cmd', a: 'lobby' }));
  const shareLink = () => `${location.origin}/?r=${S.me.code}`;
  $('btnCopy').addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(shareLink()); toast('Link copiado'); } catch { toast(shareLink()); }
  });
  $('btnShare').addEventListener('click', async () => {
    const data = { title: 'Asfalto Salvaje', text: `¡Vení a correr! Sala ${S.me.code}`, url: shareLink() };
    if (navigator.share) { try { await navigator.share(data); } catch {} }
    else { try { await navigator.clipboard.writeText(shareLink()); toast('Link copiado'); } catch { toast(shareLink()); } }
  });
  $('btnFull').addEventListener('click', () => {
    if (document.fullscreenElement) document.exitFullscreen(); else document.documentElement.requestFullscreen?.().catch(() => toast('Tu navegador no permite pantalla completa'));
  });
  try { if (localStorage.getItem('as_mute') === '1') { SFX.toggle(); $('btnMute').textContent = '🔇'; } } catch {}
  $('btnMute').addEventListener('click', () => {
    SFX.ensure();
    const on = SFX.toggle();
    $('btnMute').textContent = on ? '🔊' : '🔇';
    try { localStorage.setItem('as_mute', on ? '0' : '1'); } catch {}
  });
  addEventListener('pointerdown', () => SFX.ensure());

  let toastTimer = null;
  function toast(msg) {
    $('toast').textContent = msg; $('toast').classList.remove('hidden');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => $('toast').classList.add('hidden'), 2200);
  }

  let wakeLock = null;
  async function requestWakeLock() {
    try { if ('wakeLock' in navigator && !wakeLock) { wakeLock = await navigator.wakeLock.request('screen'); wakeLock.addEventListener('release', () => { wakeLock = null; }); } } catch {}
  }

  // ------------------------------------------------------------------ controles
  function sendInput() { net.send({ t: 'in', l: S.input.l, r: S.input.r, b: S.input.b }); }
  function fire() { net.send({ t: 'fire' }); if (navigator.vibrate) try { navigator.vibrate(18); } catch {} }
  const zones = new Map();
  const zoneAt = (x, y) => { const el = document.elementFromPoint(x, y); const z = el && el.closest && el.closest('[data-zone]'); return z ? z.dataset.zone : null; };
  function updateTouch() {
    let l = false, r = false, f = false;
    for (const z of zones.values()) { if (z === 'l') l = true; else if (z === 'r') r = true; else if (z === 'f') f = true; }
    $('zL').classList.toggle('on', l); $('zR').classList.toggle('on', r); $('zF').classList.toggle('on', f);
    if (l !== S.input.l || r !== S.input.r) {
      S.input.l = l; S.input.r = r; sendInput();
      if ((l || r) && navigator.vibrate) try { navigator.vibrate(6); } catch {}
    }
  }
  const ctl = $('controls');
  ctl.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    const z = zoneAt(e.clientX, e.clientY);
    zones.set(e.pointerId, z);
    if (z === 'f') fire();
    updateTouch();
  });
  ctl.addEventListener('pointermove', (e) => {
    if (!zones.has(e.pointerId)) return;
    const prev = zones.get(e.pointerId), z = zoneAt(e.clientX, e.clientY);
    const nz = z === 'f' && prev !== 'f' ? null : z;
    if (nz !== prev) { zones.set(e.pointerId, nz); updateTouch(); }
  });
  const release = (e) => { zones.delete(e.pointerId); updateTouch(); };
  ['pointerup', 'pointercancel', 'lostpointercapture'].forEach((t) => ctl.addEventListener(t, release));
  ctl.addEventListener('contextmenu', (e) => e.preventDefault());

  const keys = new Set();
  const KEY_L = ['ArrowLeft', 'KeyA'], KEY_R = ['ArrowRight', 'KeyD'], KEY_B = ['ArrowDown', 'KeyS'], KEY_F = ['ArrowUp', 'KeyW', 'Space'];
  function keyInput() {
    const l = KEY_L.some((k) => keys.has(k)), r = KEY_R.some((k) => keys.has(k)), b = KEY_B.some((k) => keys.has(k));
    if (l !== S.input.l || r !== S.input.r || b !== S.input.b) { S.input.l = l; S.input.r = r; S.input.b = b; sendInput(); }
  }
  addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT') return;
    if (!S.meta || S.meta.phase === 'lobby') return;
    if ([...KEY_L, ...KEY_R, ...KEY_B, ...KEY_F].includes(e.code)) e.preventDefault();
    if (e.repeat) return;
    keys.add(e.code);
    if (KEY_F.includes(e.code)) fire();
    keyInput();
  });
  addEventListener('keyup', (e) => { keys.delete(e.code); keyInput(); });
  addEventListener('blur', () => { keys.clear(); zones.clear(); keyInput(); updateTouch(); });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') { if (S.me.code) requestWakeLock(); }
    else { keys.clear(); zones.clear(); keyInput(); updateTouch(); }
  });
  setInterval(() => { if (S.me.id && S.meta && S.meta.phase !== 'lobby') sendInput(); }, 1000);

  // ------------------------------------------------------------------ instantáneas
  function onSnap(s) {
    s.recv = performance.now() / 1000;
    const off = s.recv - s.k;
    if (S.off == null || off < S.off) S.off = off; else S.off += (off - S.off) * 0.003;
    S.snaps.push(s);
    if (S.snaps.length > 90) S.snaps.splice(0, S.snaps.length - 90);
  }

  // Interpola el estado del mundo para el instante de render
  function sampleWorld(now) {
    const W = S.world;
    if (!W) return;
    const arr = S.snaps.filter((s) => s.w === W.id);
    if (!arr.length) return;
    const rk = now / 1000 - S.off - INTERP;
    let i = arr.length - 1;
    while (i > 0 && arr[i].k > rk) i--;
    const a = arr[i], b = arr[Math.min(i + 1, arr.length - 1)];
    const t = b === a ? 0 : clamp((rk - a.k) / (b.k - a.k), 0, 1);
    // eventos de todo lo que ya pasó
    for (const s of arr) { if (s.k > rk && s !== arr[0]) break; if (!s.done) { s.done = true; s.e.forEach(handleEvent); } }
    // descarta lo viejo
    const keepFrom = S.snaps.indexOf(a);
    if (keepFrom > 2) S.snaps.splice(0, keepFrom - 1);
    S.snap = t > 0.5 ? b : a;
    const cur = S.snap;
    W.phase = PHASES[cur.ph]; W.pt = lerp(a.pt, b.pt, t); W.rt = lerp(a.rt, b.rt, t);
    W.shrink = lerp(a.sh, b.sh, t); W.safeR = lerp(a.sr || b.sr, b.sr, t); W.sdOn = !!cur.sd; W.over = !!cur.ov;
    W.time = rk;
    if (a.cam && b.cam) { W.camX = lerp(a.cam[0], b.cam[0], t); W.camY = lerp(a.cam[1], b.cam[1], t); }
    // autos
    const bMap = new Map(b.c.map((c) => [c[0], c]));
    const seen = new Set();
    for (const ca of a.c) {
      const cb = bMap.get(ca[0]) || ca;
      const id = ca[0];
      seen.add(id);
      let v = S.cars.get(id);
      const p = player(id);
      if (!v) { v = { id, rear: null, px: ca[1], py: ca[2], speed: 0 }; S.cars.set(id, v); }
      v.x = lerp(ca[1], cb[1], t); v.y = lerp(ca[2], cb[2], t);
      v.a = angLerp(ca[3], cb[3], t); v.steer = lerp(ca[4], cb[4], t);
      const src = t > 0.5 ? cb : ca;
      v.f = src[5]; v.hp = src[6]; v.item = ITEM_LIST[cb[7]] || null;
      v.alive = !!(v.f & F.ALIVE);
      v.color = p ? COLORS[p.color] : COLORS[0];
      v.name = p ? p.name : '?';
      v.isBot = p ? p.kind === 'bot' : false;
    }
    for (const id of [...S.cars.keys()]) if (!seen.has(id)) S.cars.delete(id);
    // misiles
    const mb = new Map(b.m.map((m) => [m[0], m]));
    S.missiles = a.m.map((ma) => { const m2 = mb.get(ma[0]) || ma; return { id: ma[0], x: lerp(ma[1], m2[1], t), y: lerp(ma[2], m2[2], t), a: angLerp(ma[3], m2[3], t) }; });
    S.mines = cur.n.map(([id, x, y, fast]) => ({ id, x, y, fast }));
    S.oils = cur.o.map(([id, x, y, life]) => ({ id, x, y, life, r: 48 }));
    for (let k = 0; k < W.boxes.length; k++) W.boxes[k].active = cur.b[k] === '1';
  }

  // ------------------------------------------------------------------ efectos
  function part(o) { if (S.parts.length < 1400) S.parts.push(o); }
  function explosion(x, y, color, big) {
    const n = big ? 34 : 18;
    for (let i = 0; i < n; i++) {
      const a = Math.random() * TAU, sp = rand(60, big ? 520 : 340);
      part({ k: 'fire', x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: rand(0.35, 0.8), max: 0.8, size: rand(14, big ? 34 : 24), drag: 3 });
    }
    for (let i = 0; i < n * 0.7; i++) {
      const a = Math.random() * TAU, sp = rand(30, 180);
      part({ k: 'smoke', x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: rand(0.8, 1.6), max: 1.6, size: rand(18, 38), drag: 1.5, grow: 30 });
    }
    if (big) for (let i = 0; i < 14; i++) {
      const a = Math.random() * TAU, sp = rand(150, 520);
      part({ k: 'debris', x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: rand(0.7, 1.3), max: 1.3, size: rand(6, 12), drag: 2, color, rot: Math.random() * TAU, vr: rand(-12, 12) });
    }
    part({ k: 'ring', x, y, vx: 0, vy: 0, life: 0.45, max: 0.45, size: big ? 170 : 110, drag: 0 });
  }
  function sparks(x, y, n, color) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * TAU, sp = rand(120, 420);
      part({ k: 'spark', x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: rand(0.15, 0.4), max: 0.4, size: 3, drag: 4, color: color || '#ffd75a' });
    }
  }
  function addToast(text, color) { S.toasts.push({ text, color, t: 2.8 }); if (S.toasts.length > 4) S.toasts.shift(); }

  function handleEvent(e) {
    switch (e.e) {
      case 'boom': explosion(e.x, e.y, null, false); SFX.boom(); S.shake = Math.max(S.shake, 0.25); break;
      case 'elim':
        explosion(e.x, e.y, e.c, true); SFX.bigBoom(); SFX.elim(); S.shake = Math.max(S.shake, 0.6);
        break;
      case 'spk': sparks(e.x, e.y, e.n, e.c); break;
      case 'thud': SFX.thud(e.v); if (e.v > 300) S.shake = Math.max(S.shake, e.v / 3000); break;
      case 'bump': SFX.bump(e.v); break;
      case 'pick':
        SFX.pickup();
        for (let i = 0; i < 10; i++) part({ k: 'spark', x: e.x, y: e.y, vx: rand(-260, 260), vy: rand(-260, 260), life: 0.4, max: 0.4, size: 3, drag: 3, color: pick(['#ffd34d', '#ff7a1a', '#ffffff']) });
        break;
      case 'wave': S.waves.push({ x: e.x, y: e.y, r: 20, max: 340, life: 0.45 }); SFX.wave(); S.shake = Math.max(S.shake, 0.35); break;
      case 'block': sparks(e.x, e.y, 16, '#7ff3ff'); SFX.block(); break;
      case 'sfx': if (typeof SFX[e.s] === 'function') SFX[e.s](); break;
      case 'count': SFX.count(e.n); break;
      case 'toast': addToast(e.text, e.c); break;
      case 'vib': if (e.id === S.me.id && navigator.vibrate) try { navigator.vibrate(e.p); } catch {} break;
      case 'confetti':
        for (let i = 0; i < 160; i++) {
          const vw = VIEW_W * S.cam.zoom, vh = VIEW_H * S.cam.zoom;
          part({ k: 'confetti', x: S.cam.x + rand(-vw / 2, vw / 2), y: S.cam.y - vh / 2 - rand(0, 400), vx: rand(-60, 60), vy: rand(150, 380), life: rand(3, 5), max: 5, size: rand(6, 12), drag: 0.2, color: pick(COLORS).hex, rot: Math.random() * TAU, vr: rand(-8, 8) });
        }
        break;
    }
  }

  // efectos continuos generados a partir del estado interpolado
  function localEffects(dt) {
    const W = S.world;
    for (const v of S.cars.values()) {
      if (!v.alive) { v.rear = null; continue; }
      const fx = Math.cos(v.a), fy = Math.sin(v.a), rx = -fy, ry = fx;
      const dx = v.x - v.px, dy = v.y - v.py;
      v.speed = dt > 0 ? Math.hypot(dx, dy) / dt : 0;
      v.px = v.x; v.py = v.y;
      const rxp = v.x - fx * 17, ryp = v.y - fy * 17;
      const wl = { x: rxp + rx * 11, y: ryp + ry * 11 }, wr = { x: rxp - rx * 11, y: ryp - ry * 11 };
      if (v.f & F.SKID && v.rear && v.speed > 30) {
        S.skids.push([v.rear[0].x, v.rear[0].y, wl.x, wl.y], [v.rear[1].x, v.rear[1].y, wr.x, wr.y]);
        if (Math.random() < 0.3) part({ k: 'smoke', x: rxp, y: ryp, vx: rand(-20, 20), vy: rand(-20, 20), life: 0.6, max: 0.6, size: 10, grow: 26, drag: 1, light: true });
      }
      v.rear = [wl, wr];
      if (v.f & F.TURBO) for (let i = 0; i < 2; i++) part({ k: 'fire', x: v.x - fx * 26 + rand(-5, 5), y: v.y - fy * 26 + rand(-5, 5), vx: -fx * 220 + rand(-40, 40), vy: -fy * 220 + rand(-40, 40), life: 0.25, max: 0.3, size: rand(8, 14), drag: 2 });
      if (v.f & F.OFFROAD && v.speed > 150 && Math.random() < 0.25 && W && !W.arena) part({ k: 'smoke', x: rxp, y: ryp, vx: -fx * 40, vy: -fy * 40, life: 0.5, max: 0.5, size: 8, grow: 20, drag: 1, dust: W.map.theme.runoff });
    }
    if (S.skids.length > 900) S.skids.splice(0, S.skids.length - 900);
    for (const m of S.missiles) if (Math.random() < 0.8) part({ k: 'smoke', x: m.x - Math.cos(m.a) * 14, y: m.y - Math.sin(m.a) * 14, vx: rand(-15, 15), vy: rand(-15, 15), life: 0.5, max: 0.5, size: 6, grow: 18, drag: 1, light: true });
    for (let i = S.parts.length - 1; i >= 0; i--) {
      const p = S.parts[i];
      p.life -= dt;
      if (p.life <= 0) { S.parts.splice(i, 1); continue; }
      const k = Math.exp(-(p.drag || 0) * dt);
      p.vx *= k; p.vy *= k; p.x += p.vx * dt; p.y += p.vy * dt;
      if (p.grow) p.size += p.grow * dt;
      if (p.vr) p.rot += p.vr * dt;
    }
    for (let i = S.waves.length - 1; i >= 0; i--) { const w = S.waves[i]; w.life -= dt; w.r += (w.max / 0.45) * dt; if (w.life <= 0) S.waves.splice(i, 1); }
    for (let i = S.toasts.length - 1; i >= 0; i--) { S.toasts[i].t -= dt; if (S.toasts[i].t <= 0) S.toasts.splice(i, 1); }
    S.shake = Math.max(0, S.shake - dt * 1.6);
  }

  // ------------------------------------------------------------------ cámara
  function fitZoom(A) { return Math.max((A.w + 200) / VIEW_W, (A.h + 300) / VIEW_H); }
  function updateCamera(dt) {
    const W = S.world;
    if (!W) {
      // lobby / inicio: recorre una pista de fondo
      if (!S.attract) { const idx = Math.floor(Math.random() * TRACKS.length); S.attract = { T: TRACKS[idx], idx, s: Math.random() * 5000, decor: null }; }
      const A = S.attract;
      A.s += 260 * dt;
      const pt = pointAt(A.T, A.s);
      S.cam.x = pt.x; S.cam.y = pt.y; S.cam.zoom = 1;
      return;
    }
    if (!W.arena) {
      if (W.camX != null) {
        if (!S.camInit) { S.cam.x = W.camX; S.cam.y = W.camY; S.camInit = true; }
        S.cam.x = W.camX; S.cam.y = W.camY;
      }
      S.cam.zoom = 1;
      return;
    }
    const A = W.map;
    const mine = S.cars.get(S.me.id);
    let tx, ty, tz;
    if (mine && mine.alive && !S.me.tv) {
      tx = mine.x; ty = mine.y; tz = 1.05;
    } else {
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity, n = 0;
      for (const c of S.cars.values()) if (c.alive) { n++; x0 = Math.min(x0, c.x); y0 = Math.min(y0, c.y); x1 = Math.max(x1, c.x); y1 = Math.max(y1, c.y); }
      if (!n) { x0 = 0; y0 = 0; x1 = A.w; y1 = A.h; }
      const pad = 380;
      tz = clamp(Math.max((x1 - x0 + pad * 2) / VIEW_W, (y1 - y0 + pad * 2) / VIEW_H), 1, fitZoom(A));
      tx = (x0 + x1) / 2; ty = (y0 + y1) / 2;
    }
    const vw = (S.cssW / S.baseScale) * tz, vh = (S.cssH / S.baseScale) * tz;
    tx = vw >= A.w + 200 ? A.w / 2 : clamp(tx, vw / 2 - 100, A.w + 100 - vw / 2);
    ty = vh >= A.h + 200 ? A.h / 2 : clamp(ty, vh / 2 - 100, A.h + 100 - vh / 2);
    if (!S.camInit) { S.cam.x = tx; S.cam.y = ty; S.cam.zoom = tz; S.camInit = true; }
    const k = Math.min(1, dt * 6);
    S.cam.x += (tx - S.cam.x) * k; S.cam.y += (ty - S.cam.y) * k;
    S.cam.zoom += (tz - S.cam.zoom) * Math.min(1, dt * 2.5);
  }

  // ------------------------------------------------------------------ render: mapa
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
        list.push({ x: px, y: py, type, s, r: rnd() * TAU, c: Math.floor(rnd() * 3) });
      }
    }
    decorCache.set(T, list);
    return list;
  }

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

  function drawTrack(T, s0, decor, v) {
    const th = T.theme, P = trackPaths(T);
    ctx.fillStyle = groundPattern(T.themeKey, th);
    ctx.fillRect(v.x0, v.y0, v.x1 - v.x0, v.y1 - v.y0);
    ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    ctx.strokeStyle = th.runoff; ctx.lineWidth = WALL * 2; ctx.stroke(P.center);
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
    ctx.lineCap = 'butt';
    ctx.strokeStyle = th.curbA; ctx.lineWidth = (ROAD + CURB) * 2; ctx.stroke(P.center);
    ctx.setLineDash([28, 28]); ctx.strokeStyle = th.curbB; ctx.stroke(P.center); ctx.setLineDash([]);
    ctx.lineCap = 'round';
    ctx.strokeStyle = th.road; ctx.lineWidth = ROAD * 2; ctx.stroke(P.center);
    ctx.strokeStyle = th.edge; ctx.lineWidth = 4; ctx.stroke(P.edgeL); ctx.stroke(P.edgeR);
    ctx.setLineDash([50, 60]); ctx.strokeStyle = th.line; ctx.lineWidth = 6; ctx.stroke(P.center); ctx.setLineDash([]);
    const st = pointAt(T, s0);
    ctx.save();
    ctx.translate(st.x, st.y); ctx.rotate(Math.atan2(st.uy, st.ux));
    const sq = (ROAD * 2) / 12;
    for (let r = 0; r < 2; r++) for (let k = 0; k < 12; k++) {
      ctx.fillStyle = (r + k) % 2 ? '#111' : '#fafafa';
      ctx.fillRect(-sq + r * sq, -ROAD + k * sq, sq, sq);
    }
    ctx.restore();
    drawDecor(decor, v);
  }

  const inView = (v, x, y, m) => x > v.x0 - m && x < v.x1 + m && y > v.y0 - m && y < v.y1 + m;

  function drawDecor(list, v) {
    for (const d of list) {
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
          const pts = [];
          for (let i = 0; i < 7; i++) { const a = (i / 7) * TAU, rr = (28 + ((i * 37 + d.c * 11) % 13)) * s; pts.push([Math.cos(a) * rr, Math.sin(a) * rr]); }
          ctx.fillStyle = 'rgba(0,0,0,0.18)'; ctx.beginPath(); pts.forEach(([x, y]) => ctx.lineTo(x + 6, y + 8)); ctx.fill();
          ctx.fillStyle = ice ? '#a9d8f2' : ['#a0765a', '#8c6a52', '#b08466'][d.c]; ctx.beginPath(); pts.forEach(([x, y]) => ctx.lineTo(x, y)); ctx.fill();
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
    if (W.sdOn && W.safeR > 0 && W.safeR < 2000) {
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

  // ------------------------------------------------------------------ render: objetos
  function drawCar(c, time, night, isMe) {
    if (isMe) {
      ctx.fillStyle = 'rgba(255,255,255,0.18)'; ctx.strokeStyle = 'rgba(255,255,255,0.9)'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(c.x, c.y, 40 + Math.sin(time * 5) * 2, 0, TAU); ctx.fill(); ctx.stroke();
    }
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
    ctx.fillStyle = '#16171a';
    ctx.fillRect(-18, -16, 12, 6); ctx.fillRect(-18, 10, 12, 6);
    ctx.save(); ctx.translate(12, -13); ctx.rotate(c.steer * 0.45); ctx.fillRect(-6, -3, 12, 6); ctx.restore();
    ctx.save(); ctx.translate(12, 13); ctx.rotate(c.steer * 0.45); ctx.fillRect(-6, -3, 12, 6); ctx.restore();
    const flash = c.f & F.FLASH && Math.floor(time * 20) % 2 === 0;
    ctx.fillStyle = flash ? '#ffffff' : c.color.hex;
    roundRect(-24, -12.5, 48, 25, 8); ctx.fill();
    ctx.strokeStyle = c.color.dark; ctx.lineWidth = 2; ctx.stroke();
    ctx.fillStyle = c.color.dark; ctx.fillRect(-25, -12, 5, 24);
    ctx.fillStyle = 'rgba(255,255,255,0.85)'; ctx.fillRect(-19, -2.5, 36, 5);
    ctx.fillStyle = '#1c2633'; roundRect(-9, -9, 19, 18, 5); ctx.fill();
    ctx.fillStyle = 'rgba(160,210,255,0.55)'; roundRect(4, -8, 5, 16, 2); ctx.fill();
    ctx.fillStyle = '#fff6c4'; ctx.fillRect(21, -10, 3, 5); ctx.fillRect(21, 5, 3, 5);
    if (c.f & F.BRAKE) { ctx.fillStyle = '#ff2a2a'; ctx.fillRect(-25, -11, 3, 5); ctx.fillRect(-25, 6, 3, 5); }
    ctx.restore();
    if (c.f & F.SHIELD) {
      const a = c.f & F.SHIELD_LOW ? 0.25 + 0.25 * Math.sin(time * 30) : 0.45;
      ctx.strokeStyle = `rgba(120,240,255,${a + 0.3})`; ctx.fillStyle = `rgba(120,240,255,${a * 0.4})`; ctx.lineWidth = 4;
      ctx.beginPath(); ctx.arc(c.x, c.y, 36 + Math.sin(time * 8) * 2, 0, TAU); ctx.fill(); ctx.stroke();
    }
    if (c.f & F.SPIN) {
      ctx.fillStyle = '#ffe14d';
      for (let i = 0; i < 3; i++) { const a = time * 6 + (i * TAU) / 3; ctx.beginPath(); ctx.arc(c.x + Math.cos(a) * 30, c.y - 30 + Math.sin(a) * 8, 5, 0, TAU); ctx.fill(); }
    }
    if (c.f & F.WARN) {
      ctx.strokeStyle = `rgba(255,50,50,${0.5 + 0.5 * Math.sin(time * 18)})`; ctx.lineWidth = 5;
      ctx.beginPath(); ctx.arc(c.x, c.y, 34, 0, TAU); ctx.stroke();
    }
  }

  function drawItems(W, v, time) {
    for (const o of S.oils) {
      if (!inView(v, o.x, o.y, 80)) continue;
      const rnd = seeded(o.id * 31 + 5);
      ctx.save(); ctx.translate(o.x, o.y); ctx.rotate(rnd() * TAU);
      ctx.globalAlpha = Math.min(1, o.life);
      ctx.fillStyle = '#0d0d10'; ctx.beginPath();
      for (let i = 0; i < 9; i++) { const a = (i / 9) * TAU, k = 0.75 + rnd() * 0.4; ctx.lineTo(Math.cos(a) * o.r * k, Math.sin(a) * o.r * k); }
      ctx.closePath(); ctx.fill();
      ctx.fillStyle = 'rgba(140,90,255,0.35)'; ctx.beginPath(); ctx.ellipse(-8, -8, o.r * 0.4, o.r * 0.18, 0.6, 0, TAU); ctx.fill();
      ctx.restore();
    }
    for (const b of W.boxes) {
      if (!b.active || !inView(v, b.x, b.y, 50)) continue;
      ctx.save(); ctx.translate(b.x, b.y);
      const bob = 1 + Math.sin(time * 4 + b.ph) * 0.08;
      ctx.fillStyle = 'rgba(255,200,40,0.25)'; ctx.beginPath(); ctx.arc(0, 0, 30 * bob, 0, TAU); ctx.fill();
      ctx.rotate(time * 1.4 + b.ph); ctx.scale(bob, bob);
      const g = ctx.createLinearGradient(-17, -17, 17, 17); g.addColorStop(0, '#ffe066'); g.addColorStop(1, '#ff7a1a');
      ctx.fillStyle = g; roundRect(-17, -17, 34, 34, 7); ctx.fill();
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 3; ctx.stroke();
      ctx.rotate(-(time * 1.4 + b.ph));
      ctx.fillStyle = '#fff'; ctx.font = 'bold 24px "Rubik", system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('?', 0, 1);
      ctx.restore();
    }
    for (const m of S.mines) {
      if (!inView(v, m.x, m.y, 40)) continue;
      ctx.fillStyle = 'rgba(0,0,0,0.3)'; ctx.beginPath(); ctx.arc(m.x + 3, m.y + 4, 14, 0, TAU); ctx.fill();
      ctx.strokeStyle = '#2a2a2e'; ctx.lineWidth = 4;
      for (let i = 0; i < 8; i++) { const a = (i / 8) * TAU + m.id; ctx.beginPath(); ctx.moveTo(m.x, m.y); ctx.lineTo(m.x + Math.cos(a) * 18, m.y + Math.sin(a) * 18); ctx.stroke(); }
      ctx.fillStyle = '#3a3a40'; ctx.beginPath(); ctx.arc(m.x, m.y, 13, 0, TAU); ctx.fill();
      const blink = Math.sin(time * (m.fast ? 20 : 8) + m.id) > 0;
      ctx.fillStyle = blink ? '#ff3030' : '#661010'; ctx.beginPath(); ctx.arc(m.x, m.y, 5, 0, TAU); ctx.fill();
    }
  }

  function drawMissiles() {
    for (const m of S.missiles) {
      ctx.save(); ctx.translate(m.x, m.y); ctx.rotate(m.a);
      ctx.fillStyle = `rgba(255,${150 + Math.random() * 100},40,0.9)`; ctx.beginPath(); ctx.moveTo(-12, -5); ctx.lineTo(-26 - Math.random() * 10, 0); ctx.lineTo(-12, 5); ctx.fill();
      ctx.fillStyle = '#eeeeee'; roundRect(-14, -5, 26, 10, 4); ctx.fill();
      ctx.fillStyle = '#e8383d'; ctx.beginPath(); ctx.moveTo(12, -5); ctx.lineTo(20, 0); ctx.lineTo(12, 5); ctx.fill();
      ctx.fillRect(-14, -9, 6, 4); ctx.fillRect(-14, 5, 6, 4);
      ctx.restore();
    }
  }

  function drawParticles() {
    for (const p of S.parts) {
      const a = clamp(p.life / p.max, 0, 1);
      switch (p.k) {
        case 'smoke':
          if (p.dust) { ctx.globalAlpha = a * 0.6; ctx.fillStyle = p.dust; }
          else ctx.fillStyle = p.light ? `rgba(220,220,220,${a * 0.35})` : `rgba(60,60,60,${a * 0.5})`;
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
    for (const w of S.waves) {
      const a = clamp(w.life / 0.45, 0, 1);
      ctx.strokeStyle = `rgba(160,220,255,${a})`; ctx.lineWidth = 14 * a + 2;
      ctx.beginPath(); ctx.arc(w.x, w.y, w.r, 0, TAU); ctx.stroke();
    }
  }

  // ------------------------------------------------------------------ render principal
  let lastFrame = performance.now();
  function frame(now) {
    const dt = Math.min(0.1, (now - lastFrame) / 1000);
    lastFrame = now;
    sampleWorld(now);
    updateCamera(dt);
    localEffects(dt);
    render(now / 1000);
    updateDomHud();
    requestAnimationFrame(frame);
  }

  function render(time) {
    const cw = canvas.width, ch = canvas.height;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    const W = S.world;
    const scale = (S.baseScale / S.cam.zoom) * S.dpr;
    const sh = S.shake * 14;
    const cx = S.cam.x + (Math.random() - 0.5) * sh, cy = S.cam.y + (Math.random() - 0.5) * sh;
    ctx.setTransform(scale, 0, 0, scale, cw / 2 - cx * scale, ch / 2 - cy * scale);
    const v = { x0: cx - cw / 2 / scale, y0: cy - ch / 2 / scale, x1: cx + cw / 2 / scale, y1: cy + ch / 2 / scale };
    if (!W) {
      const A = S.attract;
      if (A) { if (!A.decor) A.decor = genDecor(A.T, A.idx); drawTrack(A.T, A.T.cum[A.T.startIdx], A.decor, v); }
      return;
    }
    if (W.arena) drawArena(W, v); else drawTrack(W.map, W.s0, W.decor, v);
    ctx.strokeStyle = W.map.theme.night ? 'rgba(255,63,210,0.25)' : 'rgba(20,20,20,0.28)';
    ctx.lineWidth = 5; ctx.lineCap = 'round';
    ctx.beginPath();
    for (const s of S.skids) { ctx.moveTo(s[0], s[1]); ctx.lineTo(s[2], s[3]); }
    ctx.stroke();
    drawItems(W, v, time);
    const night = !!W.map.theme.night;
    for (const c of S.cars.values()) if (c.alive && c.id !== S.me.id) drawCar(c, time, night, false);
    const mine = S.cars.get(S.me.id);
    if (mine && mine.alive) drawCar(mine, time, night, true);
    drawMissiles();
    drawParticles();
    // zona de eliminación (pista): oscurece lo que queda afuera
    if (!W.arena && W.camX != null) {
      const sk = W.phase === 'race' ? W.shrink : 1;
      const hw = (VIEW_W / 2) * sk, hh = (VIEW_H / 2) * sk;
      ctx.save();
      ctx.beginPath(); ctx.rect(v.x0 - 10, v.y0 - 10, v.x1 - v.x0 + 20, v.y1 - v.y0 + 20);
      ctx.rect(W.camX - hw, W.camY - hh, hw * 2, hh * 2);
      ctx.fillStyle = sk < 1 ? 'rgba(40,0,0,0.6)' : 'rgba(10,8,20,0.55)'; ctx.fill('evenodd');
      if (sk < 1) {
        ctx.strokeStyle = `rgba(255,60,60,${0.6 + 0.4 * Math.sin(time * 10)})`; ctx.lineWidth = 6 / (scale / S.dpr);
        ctx.strokeRect(W.camX - hw, W.camY - hh, hw * 2, hh * 2);
      }
      ctx.restore();
    }
    // HUD en coordenadas de pantalla
    ctx.setTransform(S.dpr, 0, 0, S.dpr, 0, 0);
    const toScreen = (x, y) => [(x - cx) * (scale / S.dpr) + S.cssW / 2, (y - cy) * (scale / S.dpr) + S.cssH / 2];
    drawTags(W, toScreen, scale / S.dpr, time);
    if (W.arena) drawMinimap(W);
    drawHUD(W, time);
  }

  function drawTags(W, toScreen, k, time) {
    ctx.textAlign = 'center'; ctx.textBaseline = 'bottom'; ctx.lineJoin = 'round';
    const fs = clamp(Math.round(20 * k), 11, 18);
    for (const c of S.cars.values()) {
      if (!c.alive) continue;
      const [sx, sy] = toScreen(c.x, c.y);
      const me = c.id === S.me.id;
      const label = me ? `▼ ${c.name}` : c.name;
      ctx.font = `${me ? 800 : 700} ${fs}px "Rubik", system-ui, sans-serif`;
      const y = sy - Math.max(18, 30 * k) - (me ? Math.sin(time * 5) * 2 : 0);
      ctx.lineWidth = 4; ctx.strokeStyle = 'rgba(0,0,0,0.8)'; ctx.strokeText(label, sx, y);
      ctx.fillStyle = me ? '#ffffff' : c.color.hex; ctx.fillText(label, sx, y);
      if (W.arena) {
        const r = clamp(6 * k, 3, 6);
        for (let i = 0; i < 3; i++) {
          ctx.fillStyle = i < c.hp ? '#ff4d5e' : 'rgba(0,0,0,0.5)';
          ctx.beginPath(); ctx.arc(sx + (i - 1) * r * 2.6, sy + Math.max(16, 30 * k), r, 0, TAU); ctx.fill();
        }
      }
    }
  }

  function drawMinimap(W) {
    const A = W.map;
    const mw = Math.min(isTouch ? 140 : 170, S.cssW * 0.2), mh = (mw * A.h) / A.w;
    const x0 = S.cssW - mw - 12, y0 = isTouch ? 110 : 72;
    ctx.fillStyle = 'rgba(10,8,20,0.6)'; roundRect(x0 - 4, y0 - 4, mw + 8, mh + 8, 8); ctx.fill();
    const sx = mw / A.w, sy = mh / A.h;
    ctx.fillStyle = 'rgba(255,255,255,0.18)';
    for (const k of A.circles) { ctx.beginPath(); ctx.arc(x0 + k.x * sx, y0 + k.y * sy, k.r * sx, 0, TAU); ctx.fill(); }
    for (const q of A.rects) ctx.fillRect(x0 + q.x * sx, y0 + q.y * sy, q.w * sx, q.h * sy);
    if (W.sdOn && W.safeR > 0) { ctx.strokeStyle = '#ff4040'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(x0 + (A.w / 2) * sx, y0 + (A.h / 2) * sy, W.safeR * sx, 0, TAU); ctx.stroke(); }
    for (const c of S.cars.values()) {
      if (!c.alive) continue;
      ctx.fillStyle = c.color.hex;
      ctx.beginPath(); ctx.arc(x0 + c.x * sx, y0 + c.y * sy, c.id === S.me.id ? 5 : 3.5, 0, TAU); ctx.fill();
      if (c.id === S.me.id) { ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5; ctx.stroke(); }
    }
  }

  function drawToasts(y0) {
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.font = `bold ${S.cssW < 600 ? 15 : 19}px "Rubik", system-ui`;
    S.toasts.forEach((t, i) => {
      ctx.globalAlpha = Math.min(1, t.t * 2);
      const tw = ctx.measureText(t.text).width + 36, y = y0 + i * 38;
      ctx.fillStyle = 'rgba(10,8,20,0.82)'; roundRect(S.cssW / 2 - tw / 2, y - 16, tw, 32, 16); ctx.fill();
      ctx.fillStyle = t.color || '#fff'; ctx.fillText(t.text, S.cssW / 2, y);
      ctx.globalAlpha = 1;
    });
  }

  function drawHUD(W, time) {
    const w = S.cssW, h = S.cssH, m = S.meta;
    if (!m) return;
    ctx.textBaseline = 'middle';
    const ps = m.players;
    const gap = 6;
    const pw = Math.min(200, (w - 16) / Math.max(1, ps.length) - gap), ph = pw < 92 ? 34 : 44;
    const compact = pw < 92;
    let x = (w - (pw + gap) * ps.length + gap) / 2;
    for (const p of ps) {
      const car = S.cars.get(p.id);
      const dead = !car || !car.alive;
      const col = COLORS[p.color].hex;
      ctx.globalAlpha = dead ? 0.45 : 1;
      ctx.fillStyle = p.id === S.me.id ? 'rgba(40,34,70,0.92)' : 'rgba(10,8,20,0.78)'; roundRect(x, 8, pw, ph, 10); ctx.fill();
      if (p.id === S.me.id) { ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.stroke(); }
      ctx.fillStyle = col; roundRect(x, 8, 6, ph, 3); ctx.fill();
      ctx.fillStyle = '#fff';
      if (compact) {
        ctx.textAlign = 'center'; ctx.font = 'bold 15px "Rubik", system-ui';
        ctx.fillText(String(p.score), x + pw / 2 + 3, 8 + ph / 2 - 3);
        ctx.fillStyle = 'rgba(255,255,255,0.15)'; ctx.fillRect(x + 10, 8 + ph - 7, pw - 16, 4);
        ctx.fillStyle = col; ctx.fillRect(x + 10, 8 + ph - 7, (pw - 16) * Math.min(1, p.score / m.target), 4);
      } else {
        ctx.font = '600 14px "Rubik", system-ui'; ctx.textAlign = 'left';
        let name = p.name;
        while (ctx.measureText(name).width > pw - 66 && name.length > 2) name = name.slice(0, -1);
        ctx.fillText(name, x + 14, 23);
        ctx.textAlign = 'right'; ctx.font = 'bold 17px "Rubik", system-ui';
        ctx.fillText(String(p.score), x + pw - 9, 23);
        ctx.fillStyle = 'rgba(255,255,255,0.15)'; ctx.fillRect(x + 14, 38, pw - 24, 5);
        ctx.fillStyle = col; ctx.fillRect(x + 14, 38, (pw - 24) * Math.min(1, p.score / m.target), 5);
        if (car && car.alive && car.item) {
          ctx.font = '16px system-ui'; ctx.textAlign = 'center';
          ctx.fillText(car.item === 'roll' ? pick(Object.values(ITEMS)).icon : ITEMS[car.item].icon, x + pw - 38, 23);
        }
      }
      if (dead && car) { ctx.globalAlpha = 1; ctx.fillStyle = '#ff4d4d'; ctx.font = 'bold 18px system-ui'; ctx.textAlign = 'center'; ctx.fillText('✖', x + pw / 2, 8 + ph / 2); }
      ctx.globalAlpha = 1;
      x += pw + gap;
    }
    const big = Math.min(w, h * 1.6);
    if (W.phase === 'intro') {
      const t = W.pt;
      ctx.textAlign = 'center';
      if (t < INTRO_TIME) {
        const fs = clamp(big / 34, 18, 34);
        ctx.font = `bold ${fs}px "Rubik", system-ui`;
        const label = `Ronda ${m.round} · ${W.map.name}`;
        const tw = ctx.measureText(label).width + 40;
        ctx.fillStyle = 'rgba(10,8,20,0.65)'; roundRect(w / 2 - tw / 2, h * 0.24 - fs, tw, fs * 2, 16); ctx.fill();
        ctx.fillStyle = '#fff'; ctx.fillText(label, w / 2, h * 0.24);
      }
      if (t > 0.6) {
        const n = 3 - Math.floor((t - 0.6) / 0.8), f = ((t - 0.6) % 0.8) / 0.8;
        ctx.save(); ctx.translate(w / 2, h / 2); ctx.scale(1.6 - f * 0.5, 1.6 - f * 0.5);
        ctx.font = `${clamp(big / 9, 60, 140)}px "Bungee", "Rubik", system-ui`; ctx.lineWidth = 10; ctx.strokeStyle = '#1a1030'; ctx.fillStyle = '#ffd23f';
        ctx.strokeText(String(clamp(n, 1, 3)), 0, 0); ctx.fillText(String(clamp(n, 1, 3)), 0, 0);
        ctx.restore();
      }
    } else if (W.phase === 'race' && W.rt < 0.8) {
      const f = W.rt / 0.8;
      ctx.save(); ctx.globalAlpha = 1 - f; ctx.translate(w / 2, h / 2); ctx.scale(1 + f, 1 + f);
      ctx.textAlign = 'center'; ctx.font = `${clamp(big / 10, 56, 130)}px "Bungee", "Rubik", system-ui`; ctx.lineWidth = 10; ctx.strokeStyle = '#1a1030'; ctx.fillStyle = '#3ff07a';
      ctx.strokeText('¡YA!', 0, 0); ctx.fillText('¡YA!', 0, 0);
      ctx.restore();
    }
    if (W.sdOn && W.phase === 'race' && !W.over) {
      ctx.textAlign = 'center'; ctx.font = `${w < 600 ? 15 : 20}px "Bungee", "Rubik", system-ui`;
      ctx.fillStyle = `rgba(255,70,70,${0.6 + 0.4 * Math.sin(time * 8)})`;
      ctx.fillText('MUERTE SÚBITA', w / 2, h - (isTouch ? 24 : 40));
    }
    if (W.phase === 'race' || W.phase === 'intro') drawToasts(ph + 40);
    if (!isTouch || S.me.tv) {
      ctx.textAlign = 'left'; ctx.font = '600 13px "Rubik", system-ui'; ctx.fillStyle = 'rgba(255,255,255,0.7)';
      ctx.fillText(`Ronda ${m.round} · ${MODES[m.mode].name} · a ${m.target} · ${S.ping} ms`, 14, h - 16);
      ctx.textAlign = 'right';
      ctx.fillText(`Sala ${S.me.code} · ${location.host}`, w - 14, h - 16);
    }
  }

  // HUD en DOM: botón de power-up y avisos
  let lastItem = null, rollTimer = null;
  const ITEM_KEYS = Object.keys(ITEMS);
  function setItemButton(item) {
    if (item === lastItem) return;
    clearInterval(rollTimer); rollTimer = null;
    const b = $('zF');
    if (!item) { b.classList.remove('has'); $('zFi').textContent = '·'; $('zFl').textContent = ''; }
    else if (item === 'roll') {
      b.classList.add('has'); $('zFl').textContent = '';
      let i = 0;
      rollTimer = setInterval(() => { $('zFi').textContent = ITEMS[ITEM_KEYS[i++ % ITEM_KEYS.length]].icon; }, 80);
    } else { b.classList.add('has'); $('zFi').textContent = ITEMS[item].icon; $('zFl').textContent = ITEMS[item].name; }
    lastItem = item;
  }
  let pillText = '';
  function updateDomHud() {
    const m = S.meta, W = S.world;
    let pill = '';
    let rotate = false;
    if (m && W && m.phase !== 'lobby') {
      const mine = S.cars.get(S.me.id);
      if (mine) {
        document.documentElement.style.setProperty('--c', mine.color.hex);
        setItemButton(mine.alive ? mine.item : null);
        if (!mine.alive && (W.phase === 'race')) pill = '💥 Quedaste eliminado · mirá cómo termina';
      } else if (S.me.id && (m.phase === 'intro' || m.phase === 'race')) pill = 'Entrás en la próxima ronda · mirá la carrera 👀';
      rotate = isTouch && S.cssH > S.cssW && (m.phase === 'intro' || m.phase === 'race');
    }
    if (pill !== pillText) { pillText = pill; $('statusPill').textContent = pill; $('statusPill').classList.toggle('hidden', !pill); }
    $('rotateHint').classList.toggle('hidden', !rotate);
    $('statusPill').style.top = (S.cssW < 600 ? 50 : 62) + 'px';
  }

  // ------------------------------------------------------------------ arranque
  function resize() {
    S.dpr = Math.min(window.devicePixelRatio || 1, 2);
    S.cssW = innerWidth; S.cssH = innerHeight;
    canvas.width = Math.round(S.cssW * S.dpr); canvas.height = Math.round(S.cssH * S.dpr);
    canvas.style.width = S.cssW + 'px'; canvas.style.height = S.cssH + 'px';
    S.baseScale = Math.min(S.cssW / VIEW_W, S.cssH / VIEW_H);
  }
  addEventListener('resize', resize);
  resize();

  // ¿Volvemos a una sala de la que estábamos participando?
  if (sess.code && sess.token && (!urlCode || urlCode === sess.code)) {
    S.me.code = sess.code;
    $('home').classList.add('hidden');
    $('netStatus').textContent = 'Volviendo a la sala…'; $('netStatus').classList.remove('hidden');
  } else if (sess.code && sess.tv && urlCode === sess.code) {
    S.me.code = sess.code;
  }
  net.connect();
  requestAnimationFrame(frame);

  window.__AS = { S };
})();
