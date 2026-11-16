// VERDIGRIS TERMINAL - audio.js: the whole soundscape is synthesized with Web Audio.
// Per-gun reports (noise transient + pitched body + hall tail), reload clicks,
// surface footsteps (silent on Shift-walk), headshot dink, smoke hiss, flash ring,
// frag boom, plant beep. No audio files, no network.
export function createAudio() {
  let ctx = null;
  let master = null;
  let noiseBuf = null;

  function unlock() {
    if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return; }
    try {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
      master = ctx.createGain();
      master.gain.value = 0.5;
      master.connect(ctx.destination);
      noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 1, ctx.sampleRate);
      const d = noiseBuf.getChannelData(0);
      for (let i = 0; i < d.length; i += 1) d[i] = Math.random() * 2 - 1;
    } catch { ctx = null; }
  }

  function noise(dur, filterFreq, type, gainVal, at = 0) {
    if (!ctx) return;
    const t = ctx.currentTime + at;
    const src = ctx.createBufferSource();
    src.buffer = noiseBuf;
    const f = ctx.createBiquadFilter();
    f.type = type || 'lowpass'; f.frequency.value = filterFreq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(gainVal, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(f); f.connect(g); g.connect(master);
    src.start(t); src.stop(t + dur + 0.05);
  }
  function tone(freq, dur, type, gainVal, slideTo = 0, at = 0) {
    if (!ctx) return;
    const t = ctx.currentTime + at;
    const o = ctx.createOscillator();
    o.type = type || 'sine'; o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(gainVal, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g); g.connect(master);
    o.start(t); o.stop(t + dur + 0.05);
  }

  const REPORTS = {
    vesper: { freq: 1400, body: 220, dur: 0.14, gain: 0.5 },
    kestrel: { freq: 1800, body: 300, dur: 0.11, gain: 0.42 },
    sovereign: { freq: 1100, body: 160, dur: 0.18, gain: 0.55 },
    longbow: { freq: 900, body: 110, dur: 0.3, gain: 0.7 },
    karambit: { freq: 3000, body: 0, dur: 0.08, gain: 0.25 },
  };

  return {
    unlock,
    shot(kind) {
      const r = REPORTS[kind] || REPORTS.sovereign;
      noise(0.06, r.freq, 'highpass', r.gain);
      if (r.body) tone(r.body, r.dur, 'triangle', r.gain * 0.7, r.body * 0.4);
      noise(0.35, 700, 'lowpass', r.gain * 0.25, 0.02); // hall tail
    },
    distantShot() { noise(0.12, 500, 'lowpass', 0.12); tone(120, 0.15, 'triangle', 0.08, 60); },
    dryClick() { tone(1800, 0.03, 'square', 0.15); },
    reload() { tone(900, 0.04, 'square', 0.18); tone(600, 0.05, 'square', 0.18, 0, 0.18); tone(1200, 0.04, 'square', 0.2, 0, 0.42); },
    hit() { tone(1400, 0.05, 'sine', 0.25); },
    kill() { tone(1400, 0.05, 'sine', 0.25); tone(1800, 0.07, 'sine', 0.25, 0, 0.06); },
    headshotDink() { tone(2600, 0.12, 'sine', 0.35, 1800); },
    footstep(walk) { if (walk) return; noise(0.05, 400, 'lowpass', 0.07); },
    grenadeThrow() { noise(0.15, 900, 'bandpass', 0.15); },
    smokeHiss() { noise(1.4, 2500, 'highpass', 0.22); },
    flashRing() { tone(3200, 1.2, 'sine', 0.3, 2400); noise(0.4, 800, 'lowpass', 0.2); },
    explosion() { tone(70, 0.9, 'sine', 0.9, 28); noise(0.7, 300, 'lowpass', 0.8); },
    plantBeep(final) { tone(1100, 0.08, 'square', 0.25); if (final) tone(1500, 0.2, 'square', 0.3, 0, 0.12); },
    defuseBeep() { tone(1300, 0.08, 'square', 0.25); tone(1300, 0.08, 'square', 0.25, 0, 0.15); },
    buy() { tone(880, 0.07, 'sine', 0.25); tone(1320, 0.1, 'sine', 0.25, 0, 0.08); },
    denied() { tone(220, 0.15, 'square', 0.2); },
    roundWin() { [523, 659, 784].forEach((f, i) => tone(f, 0.18, 'triangle', 0.25, 0, i * 0.12)); },
    roundLose() { [392, 330, 262].forEach((f, i) => tone(f, 0.2, 'triangle', 0.22, 0, i * 0.13)); },
    hurt() { noise(0.12, 300, 'lowpass', 0.3); },
  };
}
