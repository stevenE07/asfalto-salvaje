// Efectos de sonido sintetizados (sin archivos de audio).
const SFX = (() => {
  let ac = null, master = null, noiseBuf = null, muted = false;
  const last = {};

  function ensure() {
    if (!ac) {
      try {
        ac = new (window.AudioContext || window.webkitAudioContext)();
        master = ac.createGain();
        master.gain.value = 0.45;
        master.connect(ac.destination);
        noiseBuf = ac.createBuffer(1, ac.sampleRate, ac.sampleRate);
        const d = noiseBuf.getChannelData(0);
        for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      } catch { ac = null; }
    }
    if (ac && ac.state === 'suspended') ac.resume();
  }

  function ok(key, gap) {
    if (!ac || muted) return false;
    const now = ac.currentTime;
    if (key && last[key] && now - last[key] < gap) return false;
    if (key) last[key] = now;
    return true;
  }

  function tone(freq, dur, type = 'square', vol = 0.2, slideTo = 0, delay = 0) {
    const t = ac.currentTime + delay;
    const o = ac.createOscillator(), g = ac.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(Math.max(20, slideTo), t + dur);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g).connect(master);
    o.start(t); o.stop(t + dur + 0.02);
  }

  function noise(dur, vol, freq = 1200, q = 0.7, slideTo = 0, delay = 0) {
    const t = ac.currentTime + delay;
    const s = ac.createBufferSource(), f = ac.createBiquadFilter(), g = ac.createGain();
    s.buffer = noiseBuf;
    f.type = 'lowpass'; f.Q.value = q;
    f.frequency.setValueAtTime(freq, t);
    if (slideTo) f.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    s.connect(f).connect(g).connect(master);
    s.start(t); s.stop(t + dur + 0.02);
  }

  return {
    ensure,
    toggle() { muted = !muted; return !muted; },
    get muted() { return muted; },
    count(n) { if (ok()) tone(n > 0 ? 520 : 1040, n > 0 ? 0.18 : 0.45, 'square', 0.18); },
    pickup() { if (ok('pick', 0.05)) { tone(700, 0.07, 'square', 0.1); tone(1050, 0.1, 'square', 0.1, 0, 0.06); } },
    boom() { if (ok('boom', 0.06)) { noise(0.7, 0.7, 900, 0.8, 60); tone(90, 0.5, 'sine', 0.5, 30); } },
    bigBoom() { if (ok('bboom', 0.1)) { noise(1.1, 0.9, 1400, 0.6, 50); tone(70, 0.9, 'sine', 0.6, 25); } },
    missile() { if (ok('mis', 0.08)) noise(0.5, 0.25, 3000, 2, 400); },
    turbo() { if (ok('tur', 0.1)) { tone(180, 0.6, 'sawtooth', 0.12, 700); noise(0.5, 0.15, 2000, 1, 600); } },
    drop() { if (ok('drop', 0.08)) tone(300, 0.12, 'triangle', 0.25, 120); },
    // cada power-up con su propio sonido
    mine() { if (ok('mine', 0.08)) { tone(300, 0.12, 'triangle', 0.22, 120); noise(0.09, 0.3, 420, 1); tone(880, 0.07, 'square', 0.08, 0, 0.14); } },
    oil() { if (ok('oil', 0.08)) { noise(0.35, 0.4, 700, 0.8, 140); tone(180, 0.22, 'sine', 0.14, 70); } },
    grapple() { if (ok('grap', 0.1)) { noise(0.22, 0.2, 900, 3, 4200); tone(420, 0.26, 'square', 0.1, 1500); } },
    grappleMiss() { if (ok('grapm', 0.1)) { noise(0.3, 0.18, 3000, 2.5, 500); tone(700, 0.3, 'square', 0.09, 180); } },
    hookHit() { if (ok('hook', 0.1)) { tone(1400, 0.1, 'square', 0.14, 700); noise(0.12, 0.35, 2600, 4); tone(140, 0.4, 'sawtooth', 0.14, 520); } },
    // anti-poderes
    antiInvert() { if (ok('ainv', 0.15)) { tone(260, 0.5, 'sawtooth', 0.12, 980); tone(980, 0.5, 'sawtooth', 0.12, 260); tone(520, 0.2, 'square', 0.07, 0, 0.45); } },
    antiMud() { if (ok('amud', 0.15)) { noise(0.4, 0.55, 520, 1.4, 90); tone(120, 0.3, 'sine', 0.2, 50); } },
    antiChoke() { if (ok('acho', 0.15)) { [0, 0.11, 0.22, 0.34].forEach((d, i) => tone(300 - i * 50, 0.1, 'sawtooth', 0.16, 90 - i * 15, d)); noise(0.45, 0.2, 500, 1, 120); } },
    apick() { if (ok('apick', 0.05)) { tone(520, 0.08, 'sawtooth', 0.11); tone(340, 0.16, 'sawtooth', 0.11, 150, 0.07); } },
    shield() { if (ok('shi', 0.1)) { tone(400, 0.3, 'sine', 0.2, 1200); } },
    wave() { if (ok('wav', 0.1)) { tone(500, 0.5, 'sine', 0.3, 60); noise(0.4, 0.3, 600, 1, 100); } },
    block() { if (ok('blk', 0.08)) tone(1500, 0.15, 'triangle', 0.2, 800); },
    slip() { if (ok('slp', 0.15)) tone(900, 0.35, 'sine', 0.12, 200); },
    thud(v) { if (ok('thud', 0.09)) noise(0.12, Math.min(0.35, v / 1500), 500, 1); },
    bump(v) { if (ok('bump', 0.08)) { tone(110, 0.12, 'square', Math.min(0.15, v / 3000)); } },
    elim() { if (ok('elim', 0.2)) { tone(600, 0.5, 'sawtooth', 0.12, 80); } },
    sudden() { if (ok('sud', 1)) { tone(220, 0.25, 'square', 0.18); tone(220, 0.25, 'square', 0.18, 0, 0.35); tone(220, 0.4, 'square', 0.18, 0, 0.7); } },
    win() { if (ok('win', 0.5)) [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.3, 'square', 0.14, 0, i * 0.12)); },
    fanfare() { if (ok('fan', 1)) [392, 523, 659, 784, 659, 784, 1047].forEach((f, i) => tone(f, i === 6 ? 0.7 : 0.22, 'square', 0.14, 0, i * 0.14)); },
    join() { if (ok('join', 0.05)) { tone(880, 0.08, 'sine', 0.2); tone(1320, 0.12, 'sine', 0.2, 0, 0.08); } },
    click() { if (ok('clk', 0.03)) tone(1200, 0.04, 'square', 0.08); },
  };
})();
