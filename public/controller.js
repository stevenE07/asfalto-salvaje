// Asfalto Salvaje — control en el celular.
(() => {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const ITEMS = { turbo: ['⚡', 'Turbo'], missile: ['🚀', 'Misil'], mine: ['💣', 'Mina'], oil: ['🛢️', 'Aceite'], shield: ['🛡️', 'Escudo'], wave: ['💥', 'Onda'] };
  const ITEM_KEYS = Object.keys(ITEMS);
  const MODES = { knockout: '🏁 Eliminación', pure: '🏎️ Carrera Pura', arena: '💣 Batalla' };
  const TARGETS = [5, 10, 15];

  let ws = null, st = null, joined = false, wantJoin = false, retry = 0;
  let session = {};
  try { session = JSON.parse(localStorage.getItem('as_ctrl') || '{}') || {}; } catch {}
  const save = () => { try { localStorage.setItem('as_ctrl', JSON.stringify(session)); } catch {} };

  const params = new URLSearchParams(location.search);
  const urlCode = (params.get('r') || '').toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4);
  $('codeIn').value = urlCode || session.code || '';
  $('nameIn').value = session.name || '';

  // ------------------------------------------------------------ red
  function connect() {
    ws = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/ws');
    ws.onopen = () => { retry = 0; if (wantJoin) sendJoin(); };
    ws.onmessage = (e) => { let m; try { m = JSON.parse(e.data); } catch { return; } handle(m); };
    ws.onclose = () => {
      if (joined) toast('Reconectando…');
      setTimeout(connect, Math.min(4000, 500 + retry++ * 500));
    };
  }
  function send(m) { if (ws && ws.readyState === 1) ws.send(JSON.stringify(m)); }
  function sendJoin() {
    send({ t: 'join', code: session.code, name: session.name, token: session.tokenCode === session.code ? session.token : null });
  }

  function handle(m) {
    switch (m.t) {
      case 'joined':
        joined = true;
        session.token = m.token; session.tokenCode = m.code; save();
        $('join').classList.add('hidden'); $('pad').classList.remove('hidden');
        if (m.hostOnline) hideToast(); else toast('Esperando la pantalla principal…');
        requestWakeLock();
        break;
      case 'error':
        joined = false; wantJoin = false;
        session.token = null; save();
        showJoin(m.msg);
        break;
      case 'closed':
        joined = false; wantJoin = false; st = null;
        session.token = null; save();
        showJoin(m.reason || 'La sala se cerró');
        break;
      case 'hostgone': toast('La pantalla principal se desconectó. Esperando…'); break;
      case 'hostback': hideToast(); break;
      case 'st': st = m; render(); break;
      case 'vib': if (navigator.vibrate) try { navigator.vibrate(m.p); } catch {} break;
    }
  }

  function showJoin(err) {
    $('pad').classList.add('hidden'); $('sheet').classList.add('hidden'); $('banner').classList.add('hidden');
    $('join').classList.remove('hidden');
    $('joinErr').textContent = err || '';
    $('joinBtn').disabled = false;
    hideToast();
  }

  $('joinForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const code = $('codeIn').value.trim().toUpperCase();
    const name = $('nameIn').value.trim() || 'Piloto';
    if (!/^[A-Z]{4}$/.test(code)) { $('joinErr').textContent = 'El código tiene 4 letras'; return; }
    session.code = code; session.name = name; save();
    wantJoin = true;
    $('joinErr').textContent = 'Conectando…';
    $('joinBtn').disabled = true;
    setTimeout(() => { $('joinBtn').disabled = false; }, 2500);
    try { document.documentElement.requestFullscreen?.().catch(() => {}); } catch {}
    if (ws && ws.readyState === 1) sendJoin();
  });
  $('codeIn').addEventListener('input', (e) => { e.target.value = e.target.value.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4); });

  // ------------------------------------------------------------ entradas
  const pad = $('pad');
  const zones = new Map();
  let cur = { l: false, r: false };
  function zoneAt(x, y) {
    const el = document.elementFromPoint(x, y);
    const z = el && el.closest && el.closest('[data-zone]');
    return z ? z.dataset.zone : null;
  }
  function fire() {
    send({ t: 'fire' });
    if (navigator.vibrate) try { navigator.vibrate(20); } catch {}
  }
  function updateInput() {
    let l = false, r = false, f = false;
    for (const z of zones.values()) { if (z === 'l') l = true; else if (z === 'r') r = true; else if (z === 'f') f = true; }
    $('left').classList.toggle('on', l); $('right').classList.toggle('on', r); $('act').classList.toggle('on', f);
    if (l !== cur.l || r !== cur.r) {
      cur = { l, r };
      send({ t: 'in', l, r });
      if ((l || r) && navigator.vibrate) try { navigator.vibrate(6); } catch {}
    }
  }
  pad.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    const z = zoneAt(e.clientX, e.clientY);
    zones.set(e.pointerId, z);
    if (z === 'f') fire();
    updateInput();
  });
  pad.addEventListener('pointermove', (e) => {
    if (!zones.has(e.pointerId)) return;
    const prev = zones.get(e.pointerId), z = zoneAt(e.clientX, e.clientY);
    const nz = z === 'f' && prev !== 'f' ? null : z; // deslizar hacia el botón no dispara
    if (nz !== prev) { zones.set(e.pointerId, nz); updateInput(); }
  });
  const release = (e) => { zones.delete(e.pointerId); updateInput(); };
  pad.addEventListener('pointerup', release);
  pad.addEventListener('pointercancel', release);
  pad.addEventListener('lostpointercapture', release);
  pad.addEventListener('contextmenu', (e) => e.preventDefault());
  setInterval(() => { if (joined) send({ t: 'in', l: cur.l, r: cur.r }); }, 500);

  // Teclado (por si se juega desde una compu)
  const kd = new Set();
  addEventListener('keydown', (e) => {
    if (!joined || e.repeat) return;
    kd.add(e.code);
    if (e.code === 'Space' || e.code === 'ArrowUp') fire();
    const l = kd.has('ArrowLeft'), r = kd.has('ArrowRight');
    if (l !== cur.l || r !== cur.r) { cur = { l, r }; send({ t: 'in', l, r }); }
  });
  addEventListener('keyup', (e) => {
    kd.delete(e.code);
    const l = kd.has('ArrowLeft'), r = kd.has('ArrowRight');
    if (joined && (l !== cur.l || r !== cur.r)) { cur = { l, r }; send({ t: 'in', l, r }); }
  });

  // ------------------------------------------------------------ pantalla
  let wakeLock = null;
  async function requestWakeLock() {
    try { if ('wakeLock' in navigator && !wakeLock) { wakeLock = await navigator.wakeLock.request('screen'); wakeLock.addEventListener('release', () => { wakeLock = null; }); } } catch {}
  }
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') { if (joined) requestWakeLock(); }
    else { zones.clear(); updateInput(); }
  });

  let toastTimer = null;
  function toast(msg, ms) {
    const t = $('toast'); t.textContent = msg; t.classList.remove('hidden');
    clearTimeout(toastTimer);
    if (ms) toastTimer = setTimeout(hideToast, ms);
  }
  function hideToast() { $('toast').classList.add('hidden'); }

  let rollTimer = null, lastItem = null;
  function setItem(item) {
    const act = $('act');
    if (item === lastItem) return;
    clearInterval(rollTimer); rollTimer = null;
    if (!item) {
      act.classList.remove('has'); $('actIcon').textContent = '·'; $('actLabel').textContent = 'sin power-up';
    } else if (item === 'roll') {
      act.classList.add('has'); $('actLabel').textContent = '…';
      let i = 0;
      rollTimer = setInterval(() => { $('actIcon').textContent = ITEMS[ITEM_KEYS[i++ % ITEM_KEYS.length]][0]; }, 80);
    } else {
      act.classList.add('has'); $('actIcon').textContent = ITEMS[item][0]; $('actLabel').textContent = ITEMS[item][1];
      if (lastItem === 'roll' && navigator.vibrate) try { navigator.vibrate(30); } catch {}
    }
    lastItem = item;
  }

  let sheetHTML = '', bannerHTML = '';
  function sheet(html) {
    if (html === null) { $('sheet').classList.add('hidden'); sheetHTML = ''; return; }
    $('sheet').classList.remove('hidden');
    if (html !== sheetHTML) { $('sheetBody').innerHTML = html; sheetHTML = html; }
  }
  function banner(title, sub) {
    const html = title ? `${title}${sub ? `<small>${sub}</small>` : ''}` : '';
    if (!html) { $('banner').classList.add('hidden'); bannerHTML = ''; return; }
    $('banner').classList.remove('hidden');
    if (html !== bannerHTML) { $('banner').innerHTML = html; bannerHTML = html; }
  }

  function lobbySheet() {
    const left = `<div class="col">
        <h1>¡Estás adentro!</h1>
        <p><span class="swatch"></span>Manejás el auto <b style="color:${st.color}">${esc(st.colorName)}</b></p>
        <div class="row"><button class="ghost" data-cmd="color">🎨 Cambiar color</button></div>
        ${st.vip ? '' : `<p>Esperando que <b>${esc(st.vipName)}</b> 👑 arranque la carrera…</p>`}
        <p class="hint" style="font-size:14px">Tip: apretá ◀ y ▶ juntos para frenar</p>
      </div>`;
    const right = !st.vip ? '' : `<div class="col">
        <div class="sub">👑 Sos el anfitrión · Modo</div>
        <div class="chips">${Object.entries(MODES).map(([k, v]) => `<button class="chip ${st.mode === k ? 'sel' : ''}" data-cmd="mode" data-v="${k}">${v}</button>`).join('')}</div>
        <div class="sub">Puntos para ganar</div>
        <div class="chips">${TARGETS.map((t) => `<button class="chip ${st.target === t ? 'sel' : ''}" data-cmd="target" data-v="${t}">${t}</button>`).join('')}</div>
        <div class="sub">Bots (${st.bots})</div>
        <div class="row"><button class="ghost" data-cmd="addbot">＋ Bot</button><button class="ghost" data-cmd="rmbot" ${st.bots ? '' : 'disabled'}>− Bot</button></div>
        <button class="big" data-cmd="start" ${st.count < 2 ? 'disabled' : ''}>¡EMPEZAR!</button>
        <p style="font-size:14px">${st.count < 2 ? 'Se necesitan 2 pilotos: sumá un bot o esperá a alguien más' : `${st.count} pilotos listos`}</p>
      </div>`;
    return `<div class="lob ${st.vip ? 'two' : ''}">${left}${right}</div>`;
  }

  function render() {
    if (!st) return;
    document.documentElement.style.setProperty('--c', st.color);
    $('meName').textContent = st.name;
    $('meScore').innerHTML = `${st.score}<small>/${st.target}</small>`;
    $('hearts').textContent = st.hp != null && st.alive ? '❤️'.repeat(Math.max(0, st.hp)) + '🖤'.repeat(Math.max(0, 3 - st.hp)) : '';
    setItem(st.alive ? st.item : null);
    switch (st.phase) {
      case 'lobby':
        banner(null); sheet(lobbySheet()); break;
      case 'intro':
        sheet(null);
        if (st.inRound) banner('¡Preparate!', 'Mirá la pantalla grande'); else banner('Entrás en la próxima ronda', 'Mirá la pantalla 👀');
        break;
      case 'race':
        sheet(null);
        if (!st.inRound) banner('Entrás en la próxima ronda', 'Mirá la pantalla 👀');
        else if (!st.alive) banner('💥 Eliminado', 'Esperá la próxima ronda');
        else banner(null);
        break;
      case 'roundover': {
        banner(null);
        const me = st.roundWinner && st.roundWinner === st.name;
        sheet(`<h1>${me ? '¡Ganaste la ronda! 🏆' : st.roundWinner ? `Ganó ${esc(st.roundWinner)}` : 'Ronda terminada'}</h1>
          <p>${st.lastGain ? `+${st.lastGain} punto${st.lastGain > 1 ? 's' : ''} · ` : ''}tenés <b>${st.score}</b> de ${st.target}</p>
          ${st.vip ? '<button class="big" data-cmd="next">SIGUIENTE ▶</button>' : ''}`);
        break;
      }
      case 'matchover':
        banner(null);
        sheet(`<h1>${st.isChampion ? '🏆 ¡Sos el campeón!' : `🏆 ${esc(st.champion || '')} ganó la copa`}</h1>
          <p>Terminaste con <b>${st.score}</b> puntos</p>
          ${st.vip ? '<button class="big" data-cmd="again">REVANCHA</button><button class="ghost" data-cmd="lobby">Volver al lobby</button>' : '<p>Esperando al anfitrión 👑…</p>'}`);
        break;
    }
  }

  $('sheet').addEventListener('click', (e) => {
    const b = e.target.closest('[data-cmd]');
    if (!b || b.disabled) return;
    send({ t: 'cmd', a: b.dataset.cmd, v: b.dataset.v });
    if (navigator.vibrate) try { navigator.vibrate(15); } catch {}
  });

  // ------------------------------------------------------------ arranque
  if (session.token && session.tokenCode && (!urlCode || urlCode === session.tokenCode) && session.code === session.tokenCode) {
    wantJoin = true;
    $('joinErr').textContent = 'Reconectando…';
  }
  connect();
})();
