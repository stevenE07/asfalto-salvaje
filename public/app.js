// Asfalto Salvaje — cliente: cada jugador ve la carrera en su pantalla.
// El servidor simula; acá se interpolan las instantáneas, se dibuja y se mandan los controles.
(() => {
  'use strict';
  const { COLORS, ITEMS, ITEM_LIST, ANTIS, ANTI_LIST, SPEEDS, GRIPS, MODES, PHASES, F, TARGETS, MAX_PLAYERS,
    VIEW_W, VIEW_H, VIEW_R, WAVE_R, INTRO_TIME } = window.Common;
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
    cars: new Map(), missiles: [], mines: [], oils: [], hooks: [], snap: null,
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
    ['lobby', 'roundOver', 'matchOver', 'controls', 'statusPill', 'rotateHint', 'btnQuit'].forEach((id) => $(id).classList.add('hidden'));
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
      abox: (w.abox || []).map(([x, y], i) => ({ x, y, active: true, ph: i * 1.3 })),
      time: 0,
    };
    S.snaps = S.snaps.filter((s) => s.w === w.id);
    S.cars.clear(); S.parts = []; S.skids = []; S.waves = []; S.missiles = []; S.mines = []; S.oils = []; S.hooks = [];
    S.camInit = false;
  }

  function updateScreens(prev) {
    const m = S.meta;
    const inGame = m.phase !== 'lobby';
    document.body.classList.toggle('ingame', inGame);
    $('btnQuit').classList.toggle('hidden', !inGame);
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
    $('speeds').innerHTML = SPEEDS.map((sp) => `<button class="ghost ${m.speed === sp.v ? 'sel' : ''}" data-cmd="speed" data-v="${sp.v}" ${cmd ? '' : 'disabled'}>${sp.icon} ${sp.name}</button>`).join('');
    $('grips').innerHTML = GRIPS.map((gp) => `<button class="ghost ${m.grip === gp.v ? 'sel' : ''}" data-cmd="grip" data-v="${gp.v}" ${cmd ? '' : 'disabled'}>${gp.icon} ${gp.name}</button>`).join('');
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
  function salirDeLaSala() {
    net.send({ t: 'leave' });
    sess.code = null; sess.token = null; saveSess();
    leaveToHome('');
  }
  $('btnLeave').addEventListener('click', salirDeLaSala);
  // En carrera hay que tocarlo dos veces: que no te eche un dedazo sin querer.
  let quitArmado = null;
  function desarmarQuit() {
    clearTimeout(quitArmado); quitArmado = null;
    $('btnQuit').classList.remove('armado');
    $('btnQuit').textContent = '🚪';
  }
  $('btnQuit').addEventListener('click', () => {
    SFX.click();
    if (quitArmado) { desarmarQuit(); salirDeLaSala(); return; }
    $('btnQuit').classList.add('armado');
    $('btnQuit').textContent = '🚪 ¿Seguro?';
    quitArmado = setTimeout(desarmarQuit, 3000);
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
  function fireAnti() { net.send({ t: 'fire2' }); if (navigator.vibrate) try { navigator.vibrate(18); } catch {} }
  const zones = new Map();
  const zoneAt = (x, y) => { const el = document.elementFromPoint(x, y); const z = el && el.closest && el.closest('[data-zone]'); return z ? z.dataset.zone : null; };
  function updateTouch() {
    let l = false, r = false, f = false, gg = false;
    for (const z of zones.values()) { if (z === 'l') l = true; else if (z === 'r') r = true; else if (z === 'f') f = true; else if (z === 'g') gg = true; }
    $('zL').classList.toggle('on', l); $('zR').classList.toggle('on', r);
    $('zF').classList.toggle('on', f); $('zG').classList.toggle('on', gg);
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
    else if (z === 'g') fireAnti();
    updateTouch();
  });
  ctl.addEventListener('pointermove', (e) => {
    if (!zones.has(e.pointerId)) return;
    const prev = zones.get(e.pointerId), z = zoneAt(e.clientX, e.clientY);
    const nz = (z === 'f' || z === 'g') && prev !== z ? null : z;   // no se dispara arrastrando el dedo
    if (nz !== prev) { zones.set(e.pointerId, nz); updateTouch(); }
  });
  const release = (e) => { zones.delete(e.pointerId); updateTouch(); };
  ['pointerup', 'pointercancel', 'lostpointercapture'].forEach((t) => ctl.addEventListener(t, release));
  ctl.addEventListener('contextmenu', (e) => e.preventDefault());

  // --- teclado: cada jugador elige sus propias teclas, en su propia compu
  const DEF_KEYS = {
    l: ['ArrowLeft', 'KeyA'], r: ['ArrowRight', 'KeyD'], b: ['ArrowDown', 'KeyS'],
    f: ['ArrowUp', 'KeyW', 'Space'], g: ['KeyE', 'ShiftRight'],
  };
  const ACTS = ['l', 'r', 'b', 'f', 'g'];
  const KEY_ACTS = [
    { id: 'l', ico: '◀', name: 'Doblar a la izquierda' },
    { id: 'r', ico: '▶', name: 'Doblar a la derecha' },
    { id: 'b', ico: '🛑', name: 'Frenar' },
    { id: 'f', ico: '💥', name: 'Usar el power-up' },
    { id: 'g', ico: '🔄', name: 'Tirar el anti-poder' },
  ];
  const defBinds = () => ({ l: [...DEF_KEYS.l], r: [...DEF_KEYS.r], b: [...DEF_KEYS.b], f: [...DEF_KEYS.f], g: [...DEF_KEYS.g] });
  let binds = defBinds();
  try {
    const raw = JSON.parse(localStorage.getItem('as_keys') || 'null');
    if (raw) for (const a of ACTS) if (Array.isArray(raw[a])) binds[a] = raw[a].slice(0, 3).map(String);
  } catch {}
  const saveBinds = () => { try { localStorage.setItem('as_keys', JSON.stringify(binds)); } catch {} };
  const isBound = (code) => ACTS.some((a) => binds[a].includes(code));
  const KEY_NAMES = {
    ArrowLeft: '◀', ArrowRight: '▶', ArrowUp: '▲', ArrowDown: '▼', Space: 'Espacio', Enter: 'Enter', Tab: 'Tab',
    ShiftLeft: 'Shift izq', ShiftRight: 'Shift der', ControlLeft: 'Ctrl izq', ControlRight: 'Ctrl der',
    AltLeft: 'Alt', AltRight: 'Alt Gr', Comma: ',', Period: '.', Slash: '/', Semicolon: ';', Quote: "'",
    BracketLeft: '[', BracketRight: ']', Backslash: '\\', Minus: '-', Equal: '=', Backquote: '`',
  };
  const keyLabel = (c) => KEY_NAMES[c] || String(c).replace(/^Key/, '').replace(/^Digit/, '').replace(/^Numpad/, 'Num ');

  const keys = new Set();
  function keyInput() {
    const has = (a) => binds[a].some((k) => keys.has(k));
    const l = has('l'), r = has('r'), b = has('b');
    if (l !== S.input.l || r !== S.input.r || b !== S.input.b) { S.input.l = l; S.input.r = r; S.input.b = b; sendInput(); }
  }

  let bindWait = null;
  function renderKeys() {
    $('keyRows').innerHTML = KEY_ACTS.map((a) => {
      const caps = bindWait === a.id
        ? '<span class="kbd">apretá una tecla…</span>'
        : binds[a.id].length
          ? binds[a.id].map((c) => `<span class="kbd">${esc(keyLabel(c))}</span>`).join('')
          : '<span class="kbd">sin tecla</span>';
      return `<div class="key-row${bindWait === a.id ? ' wait' : ''}"><div class="kr-ico">${a.ico}</div>`
        + `<div><div class="kr-name">${a.name}</div><div class="kr-caps">${caps}</div></div>`
        + `<button class="ghost" data-bind="${a.id}">Cambiar</button></div>`;
    }).join('');
  }
  function openKeys() { bindWait = null; renderKeys(); $('keys').classList.remove('hidden'); }
  function closeKeys() { bindWait = null; $('keys').classList.add('hidden'); }
  $('btnKeys').addEventListener('click', openKeys);
  $('btnKeys2').addEventListener('click', openKeys);
  $('btnKeysClose').addEventListener('click', closeKeys);
  $('btnKeysReset').addEventListener('click', () => { binds = defBinds(); saveBinds(); bindWait = null; renderKeys(); toast('Teclas de fábrica'); });
  $('keyRows').addEventListener('click', (e) => {
    const b = e.target.closest('[data-bind]');
    if (!b) return;
    bindWait = b.dataset.bind;
    renderKeys();
  });

  addEventListener('keydown', (e) => {
    if (bindWait) {
      e.preventDefault();
      if (e.repeat || !e.code) return;
      if (e.code === 'Escape') { bindWait = null; renderKeys(); return; }
      for (const a of ACTS) binds[a] = binds[a].filter((c) => c !== e.code);
      binds[bindWait] = [e.code];
      saveBinds();
      bindWait = null; renderKeys();
      keys.clear(); keyInput();
      return;
    }
    if (e.target.tagName === 'INPUT') return;
    if (!$('keys').classList.contains('hidden')) { if (e.code === 'Escape') closeKeys(); return; }
    if (!S.meta || S.meta.phase === 'lobby') return;
    if (isBound(e.code)) e.preventDefault();
    if (e.repeat) return;
    keys.add(e.code);
    if (binds.f.includes(e.code)) fire();
    if (binds.g.includes(e.code)) fireAnti();
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
      v.f = src[5]; v.hp = src[6]; v.item = ITEM_LIST[cb[7]] || null; v.anti = ANTI_LIST[cb[8]] || null;
      v.z = lerp(ca[9] || 0, cb[9] || 0, t);
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
    for (let k = 0; k < W.abox.length; k++) W.abox[k].active = (cur.ab || '')[k] === '1';
    // la soga va de auto a auto: los busco ya interpolados para que no tiemble
    S.hooks = (cur.h || []).map(([id, a2, b2]) => ({ id, a: S.cars.get(a2), b: S.cars.get(b2) })).filter((o) => o.a && o.b);
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
      case 'wave': S.waves.push({ x: e.x, y: e.y, r: 20, max: WAVE_R, life: 0.45 }); SFX.wave(); S.shake = Math.max(S.shake, 0.35); break;
      case 'block': sparks(e.x, e.y, 16, '#7ff3ff'); SFX.block(); break;
      case 'jump': SFX.jump(); break;
      case 'land':
        SFX.land();
        for (let i = 0; i < 9; i++) part({ k: 'smoke', x: e.x + rand(-16, 16), y: e.y + rand(-16, 16), vx: rand(-90, 90), vy: rand(-90, 90), life: 0.45, max: 0.45, size: 9, grow: 26, drag: 2, light: true });
        break;
      case 'splash':
        SFX[e.k ? 'splash' : 'fall']();
        S.shake = Math.max(S.shake, 0.3);
        for (let i = 0; i < 22; i++) {
          const an = Math.random() * TAU, sp = rand(40, 260);
          part({ k: e.k ? 'spark' : 'smoke', x: e.x, y: e.y, vx: Math.cos(an) * sp, vy: Math.sin(an) * sp, life: rand(0.3, 0.8), max: 0.8, size: e.k ? 4 : 14, grow: e.k ? 0 : 20, drag: 2, color: e.k ? '#8fd7ff' : '#3a3242' });
        }
        break;
      case 'apick':
        SFX.apick();
        for (let i = 0; i < 10; i++) part({ k: 'spark', x: e.x, y: e.y, vx: rand(-260, 260), vy: rand(-260, 260), life: 0.4, max: 0.4, size: 3, drag: 3, color: pick(['#b98cff', '#6f3bd6', '#ffffff']) });
        break;
      case 'anti':
        sparks(e.x, e.y, 18, '#b98cff');
        if (e.id === S.me.id) S.shake = Math.max(S.shake, 0.3);
        break;
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
      if (!S.attract) {
        const idx = Math.floor(Math.random() * TRACKS.length);
        S.attract = { T: TRACKS[idx], idx, s: Math.random() * 5000, decor: genDecor(TRACKS[idx], idx) };
      }
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

  function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
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

  // El mundo se dibuja en 3D (render3d.js); acá queda sólo el HUD en 2D.
  let R = null, r3dFail = false, sceneKey = null;
  function use3D() {
    if (R) return R;
    if (r3dFail || !window.R3D) return null;
    try {
      window.R3D.init($('scene'));
      R = window.R3D;
      R.resize(S.cssW, S.cssH, S.dpr3);
    } catch (err) {
      console.error('3D no disponible', err);
      r3dFail = true;
      return null;
    }
    return R;
  }

  function render(time) {
    const W = S.world;
    const R3 = use3D();
    if (R3) {
      const key = W ? 'w' + W.id : S.attract ? 'a' + S.attract.idx : null;
      if (key !== sceneKey) {
        sceneKey = key;
        if (!key) R3.setScene(null);
        else if (W) R3.setScene({ kind: W.kind, map: W.map, decor: W.decor });
        else R3.setScene({ kind: 'track', map: S.attract.T, decor: S.attract.decor });
      }
      R3.frame(S, time);
    }
    // HUD 2D sobre la escena
    ctx.setTransform(S.dpr, 0, 0, S.dpr, 0, 0);
    ctx.clearRect(0, 0, S.cssW, S.cssH);
    if (!W) return;
    if (R3) drawTags(W, time);
    if (W.arena) drawMinimap(W);
    drawHUD(W, time);
  }

  function drawTags(W, time) {
    ctx.textAlign = 'center'; ctx.textBaseline = 'bottom'; ctx.lineJoin = 'round';
    for (const c of S.cars.values()) {
      if (!c.alive) continue;
      const p = R.project(c.x, c.y, 44 + (c.z || 0));
      if (!p[2]) continue;
      const k = R.scaleAt(c.x, c.y);
      const fs = clamp(Math.round(26 * k), 11, 19);
      const sx = p[0], sy = p[1];
      const me = c.id === S.me.id;
      const label = me ? `▼ ${c.name}` : c.name;
      ctx.font = `${me ? 800 : 700} ${fs}px "Rubik", system-ui, sans-serif`;
      const y = sy - 6 - (me ? Math.sin(time * 5) * 2 : 0);
      ctx.lineWidth = 4; ctx.strokeStyle = 'rgba(0,0,0,0.8)'; ctx.strokeText(label, sx, y);
      ctx.fillStyle = me ? '#ffffff' : c.color.hex; ctx.fillText(label, sx, y);
      if (W.arena) {
        const g = R.project(c.x, c.y, 0);
        const r = clamp(7 * k, 3, 6);
        for (let i = 0; i < 3; i++) {
          ctx.fillStyle = i < c.hp ? '#ff4d5e' : 'rgba(0,0,0,0.5)';
          ctx.beginPath(); ctx.arc(g[0] + (i - 1) * r * 2.6, g[1] + r * 2.4, r, 0, TAU); ctx.fill();
        }
      }
    }
    drawFueraDeCuadro(W);
  }

  // La zona de eliminación es un círculo más grande que la pantalla, así que
  // podés estar vivo y no verte: una flecha en el borde dice para dónde quedaste.
  function drawFueraDeCuadro(W) {
    if (W.arena || W.camX == null) return;
    const me = S.cars.get(S.me.id);
    if (!me || !me.alive) return;
    const p = R.project(me.x, me.y, 30);
    const w = S.cssW, h = S.cssH, m = 54;
    if (p[2] && p[0] > m && p[0] < w - m && p[1] > m && p[1] < h - m) return;
    let dx = p[0] - w / 2, dy = p[1] - h / 2;
    if (!p[2]) { dx = -dx; dy = -dy; }
    const l = Math.hypot(dx, dy) || 1;
    dx /= l; dy /= l;
    const k = Math.min((w / 2 - m) / Math.max(1e-3, Math.abs(dx)), (h / 2 - m) / Math.max(1e-3, Math.abs(dy)));
    const sx = w / 2 + dx * k, sy = h / 2 + dy * k;
    const falta = Math.round(VIEW_R * (W.shrink || 1) - Math.hypot(me.x - W.camX, me.y - W.camY));
    const urgente = falta < 220;
    ctx.save();
    ctx.translate(sx, sy);
    ctx.rotate(Math.atan2(dy, dx));
    ctx.fillStyle = urgente ? '#ff4d4d' : me.color.hex;
    ctx.strokeStyle = 'rgba(0,0,0,0.8)'; ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(20, 0); ctx.lineTo(-13, -14); ctx.lineTo(-6, 0); ctx.lineTo(-13, 14);
    ctx.closePath(); ctx.stroke(); ctx.fill();
    ctx.restore();
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.font = '800 13px "Rubik", system-ui';
    const txt = urgente ? '¡VOLVÉ!' : `VOS · ${Math.max(0, falta)}`;
    const tx = sx - dx * 26, ty = sy - dy * 26;
    ctx.lineWidth = 4; ctx.strokeStyle = 'rgba(0,0,0,0.8)'; ctx.strokeText(txt, tx, ty);
    ctx.fillStyle = urgente ? '#ff8f8f' : '#ffffff'; ctx.fillText(txt, tx, ty);
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

  // Manchas fijas: el barro no parpadea, se queda pegado hasta que se va el efecto.
  const MUD = (() => {
    const r = seeded(20260127), a = [];
    for (let i = 0; i < 16; i++) a.push([r(), r(), 0.028 + r() * 0.045, r() * TAU, 0.55 + r() * 0.8, r()]);
    return a;
  })();
  function drawMud(w, h) {
    ctx.save();
    for (const [bx, by, br, rot, sq, tn] of MUD) {
      ctx.fillStyle = `rgba(${46 + Math.round(tn * 26)},${30 + Math.round(tn * 18)},16,0.82)`;
      ctx.beginPath();
      ctx.ellipse(bx * w, by * h, br * w, br * w * sq, rot, 0, TAU);
      ctx.fill();
      ctx.beginPath();
      ctx.ellipse(bx * w + br * w * 0.9, by * h + br * w * 0.6, br * w * 0.38, br * w * 0.3, rot, 0, TAU);
      ctx.fill();
    }
    ctx.fillStyle = 'rgba(40,26,14,0.18)';
    ctx.fillRect(0, 0, w, h);
    ctx.restore();
  }

  function drawHUD(W, time) {
    const w = S.cssW, h = S.cssH, m = S.meta;
    if (!m) return;
    const mineCar = S.cars.get(S.me.id);
    if (mineCar && mineCar.alive && (mineCar.f & F.MUD)) drawMud(w, h);
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
        if (car && car.alive && car.anti) {
          ctx.font = '14px system-ui'; ctx.textAlign = 'center';
          ctx.fillText(ANTIS[car.anti].icon, x + pw - 58, 23);
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
  let lastAnti = null;
  function setAntiButton(anti) {
    if (anti === lastAnti) return;
    const b = $('zG');
    if (!anti) { b.classList.remove('has'); $('zGi').textContent = '·'; $('zGl').textContent = ''; }
    else { b.classList.add('has'); $('zGi').textContent = ANTIS[anti].icon; $('zGl').textContent = ANTIS[anti].name; }
    lastAnti = anti;
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
        setAntiButton(mine.alive ? mine.anti : null);
        if (!mine.alive && (W.phase === 'race')) pill = '💥 Quedaste eliminado · mirá cómo termina';
        else if (mine.alive && (mine.f & F.INV)) pill = '🔄 ¡Controles al revés!';
        else if (mine.alive && (mine.f & F.MUD)) pill = '🪣 Te embarraron el parabrisas';
        else if (mine.alive && (mine.f & F.CHOKE)) pill = '🐌 Motor ahogado';
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
    S.dpr3 = Math.min(window.devicePixelRatio || 1, isTouch ? 1.5 : 1.75);
    S.cssW = innerWidth; S.cssH = innerHeight;
    canvas.width = Math.round(S.cssW * S.dpr); canvas.height = Math.round(S.cssH * S.dpr);
    canvas.style.width = S.cssW + 'px'; canvas.style.height = S.cssH + 'px';
    S.baseScale = Math.min(S.cssW / VIEW_W, S.cssH / VIEW_H);
    if (R) R.resize(S.cssW, S.cssH, S.dpr3);
  }
  addEventListener('resize', resize);
  resize();
  addEventListener('orientationchange', () => setTimeout(resize, 150));

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
