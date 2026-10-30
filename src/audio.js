// Procedural audio — no sample files. Crowd roar, protest drums, fire crackle,
// sirens and one-shots are synthesised with WebAudio so the build stays tiny.
(function () {
  const P = globalThis.PAVE;

  function Audio() { this.ctx = null; this.vol = 0.7; this.music = 0.5; }

  Audio.prototype.init = function () {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = globalThis.AudioContext || globalThis.webkitAudioContext;
    if (!AC) return;
    const ctx = (this.ctx = new AC());
    this.master = ctx.createGain(); this.master.gain.value = this.vol; this.master.connect(ctx.destination);
    // shared noise buffer
    const len = ctx.sampleRate * 2, buf = ctx.createBuffer(1, len, ctx.sampleRate), d = buf.getChannelData(0);
    let b0 = 0, b1 = 0, b2 = 0;
    for (let i = 0; i < len; i++) { // pinkish noise
      const w = Math.random() * 2 - 1;
      b0 = 0.99765 * b0 + w * 0.099; b1 = 0.963 * b1 + w * 0.2965; b2 = 0.57 * b2 + w * 1.0526;
      d[i] = (b0 + b1 + b2 + w * 0.1848) * 0.2;
    }
    this.noise = buf;
    const loop = (freq, q, gain) => {
      const src = ctx.createBufferSource(); src.buffer = buf; src.loop = true;
      src.playbackRate.value = 0.8 + Math.random() * 0.4;
      const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = freq; f.Q.value = q;
      const g = ctx.createGain(); g.gain.value = 0;
      src.connect(f); f.connect(g); g.connect(this.master); src.start();
      return { g, f };
    };
    this.crowdA = loop(420, 0.7); this.crowdB = loop(900, 1.2); this.fire = loop(2600, 0.5);
    this.windL = loop(180, 0.4);
    this.siren = ctx.createOscillator(); this.siren.type = 'triangle'; this.siren.frequency.value = 660;
    this.sirenG = ctx.createGain(); this.sirenG.gain.value = 0;
    this.siren.connect(this.sirenG); this.sirenG.connect(this.master); this.siren.start();
    this.drumT = 0; this.crackT = 0;
  };

  Audio.prototype.setVolume = function (v) { this.vol = v; if (this.master) this.master.gain.value = v; };
  Audio.prototype.setMusic = function (v) { this.music = v; if (this.musicBus) this.musicBus.gain.value = v * 0.55; };

  // ---------------------------------------------------------------- adaptive music
  // A minor loop in vertical layers (pad -> kick -> bass -> snare/hats -> arp) that fade in
  // and out with the action. Notes are scheduled ahead on the audio clock, never by timers
  // (Brain: setTimeout timing bunches and stutters under main-thread load).
  const BPM = 96, STEP = 60 / BPM / 4;                        // 16th notes
  const CHORDS = [[57, 60, 64], [53, 57, 60], [50, 53, 57], [52, 56, 59]]; // Am F Dm E (MIDI)
  const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);
  const LAYERS = [['pad', 0], ['kick', 0.25], ['bass', 0.42], ['snare', 0.55], ['hats', 0.62], ['arp', 0.78]];
  Audio.prototype.musicInit = function () {
    const ctx = this.ctx;
    this.musicBus = ctx.createGain(); this.musicBus.gain.value = this.music * 0.55; this.musicBus.connect(this.master);
    this.layer = {};
    for (const [name] of LAYERS) { const g = ctx.createGain(); g.gain.value = 0; g.connect(this.musicBus); this.layer[name] = g; }
    this.nextStep = ctx.currentTime + 0.1; this.step = 0; this.intensity = 0;
  };
  Audio.prototype.musicUpdate = function (s) {
    const ctx = this.ctx;
    if (!this.musicBus) this.musicInit();
    // smooth intensity; layers fade over ~0.6 s (short vertical fades close most of the lag)
    const target = s.paused ? 0.12 : Math.max(0.12, Math.min(1, s.intensity || 0));
    this.intensity += (target - this.intensity) * 0.02;
    for (const [name, th] of LAYERS) {
      const on = this.intensity >= th ? 1 : 0;
      this.layer[name].gain.setTargetAtTime(on * (name === 'pad' ? 0.5 : name === 'arp' ? 0.22 : 0.6), ctx.currentTime, 0.2);
    }
    // look-ahead scheduler: everything due in the next 150 ms
    while (this.nextStep < ctx.currentTime + 0.15) { this.playStep(this.step, this.nextStep); this.nextStep += STEP; this.step = (this.step + 1) % 64; }
  };
  Audio.prototype.note = function (bus, type, freq, t, dur, vol, cutoff) {
    const ctx = this.ctx, o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, t);
    let out = o;
    if (cutoff) { const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = cutoff; o.connect(f); out = f; }
    out.connect(g); g.connect(bus);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.start(t); o.stop(t + dur + 0.05);
  };
  Audio.prototype.hit = function (bus, t, freq, q, dur, vol, type) {
    const ctx = this.ctx, src = ctx.createBufferSource(); src.buffer = this.noise;
    const f = ctx.createBiquadFilter(); f.type = type || 'bandpass'; f.frequency.value = freq; f.Q.value = q;
    const g = ctx.createGain(); src.connect(f); f.connect(g); g.connect(bus);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.005); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.start(t); src.stop(t + dur + 0.05);
  };
  Audio.prototype.playStep = function (st, t) {
    const L = this.layer, bar = (st / 16) | 0, s16 = st % 16, chord = CHORDS[bar % 4];
    if (s16 === 0) for (const m of chord) { this.note(L.pad, 'sawtooth', mtof(m - 12), t, STEP * 16, 0.05, 900); this.note(L.pad, 'sawtooth', mtof(m - 12) * 1.004, t, STEP * 16, 0.04, 700); }
    if (s16 % 8 === 0 || s16 === 10) { // kick, with its pitch drop
      const o = this.ctx.createOscillator(), g = this.ctx.createGain(); o.connect(g); g.connect(L.kick);
      o.frequency.setValueAtTime(140, t); o.frequency.exponentialRampToValueAtTime(45, t + 0.18);
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.9, t + 0.005); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.3);
      o.start(t); o.stop(t + 0.35);
    }
    if (s16 % 2 === 0) this.note(L.bass, 'square', mtof(chord[0] - 24), t, STEP * 1.6, 0.18, 420);
    if (s16 === 4 || s16 === 12) this.hit(L.snare, t, 1800, 0.8, 0.18, 0.5);
    if (s16 % 2 === 1) this.hit(L.hats, t, 8000, 1.5, 0.04, 0.18, 'highpass');
    if (s16 % 2 === 0) { const m = chord[(s16 / 2) % 3] + 12 * (s16 >= 8 ? 1 : 0); this.note(L.arp, 'square', mtof(m), t, STEP * 1.5, 0.07, 2400); }
  };

  Audio.prototype.update = function (dt, s) {
    const ctx = this.ctx;
    if (!ctx) return;
    const now = ctx.currentTime;
    const crowd = Math.min(1, Math.log10(1 + s.nearCrowd) / 3.6);
    this.crowdA.g.gain.setTargetAtTime(crowd * 0.55 * (s.paused ? 0.2 : 1), now, 0.3);
    this.crowdB.g.gain.setTargetAtTime(crowd * 0.22 * (0.6 + 0.4 * Math.sin(now * 0.7)) * (s.paused ? 0.2 : 1), now, 0.3);
    this.crowdA.f.frequency.setTargetAtTime(380 + crowd * 120 + s.panic * 300, now, 0.5);
    this.fire.g.gain.setTargetAtTime(Math.min(0.35, s.nearFire * 0.06), now, 0.3);
    this.windL.g.gain.setTargetAtTime(0.06, now, 1);
    const sir = s.trucks > 0 && !s.paused ? 0.035 : 0;
    this.sirenG.gain.setTargetAtTime(sir, now, 0.2);
    if (sir) this.siren.frequency.setValueAtTime(((now * 1.2) | 0) % 2 ? 660 : 880, now);
    this.musicUpdate(s);
    if (!s.paused && s.nearFire > 0) {
      this.crackT -= dt;
      if (this.crackT <= 0) { this.crackT = 0.05 + Math.random() * 0.25 / Math.min(4, s.nearFire); this.click(1800 + Math.random() * 2000, 0.05 * Math.min(1, s.nearFire / 3), 0.02); }
    }
  };

  Audio.prototype.env = function (node, a, peak, dec) {
    const now = this.ctx.currentTime;
    node.gain.setValueAtTime(0.0001, now);
    node.gain.exponentialRampToValueAtTime(peak, now + a);
    node.gain.exponentialRampToValueAtTime(0.0001, now + a + dec);
  };
  Audio.prototype.noiseHit = function (freq, q, peak, dec, type) {
    if (!this.ctx) return;
    const ctx = this.ctx, src = ctx.createBufferSource(); src.buffer = this.noise;
    src.playbackRate.value = 0.7 + Math.random() * 0.6;
    const f = ctx.createBiquadFilter(); f.type = type || 'bandpass'; f.frequency.value = freq; f.Q.value = q;
    const g = ctx.createGain(); src.connect(f); f.connect(g); g.connect(this.master);
    this.env(g, 0.005, peak, dec); src.start(); src.stop(ctx.currentTime + dec + 0.1);
  };
  Audio.prototype.tone = function (f0, f1, peak, dec, type) {
    if (!this.ctx) return;
    const ctx = this.ctx, o = ctx.createOscillator(); o.type = type || 'sine';
    const now = ctx.currentTime;
    o.frequency.setValueAtTime(f0, now); o.frequency.exponentialRampToValueAtTime(f1, now + dec);
    const g = ctx.createGain(); o.connect(g); g.connect(this.master);
    this.env(g, 0.01, peak, dec); o.start(); o.stop(now + dec + 0.1);
  };
  Audio.prototype.click = function (f, peak, dec) { this.noiseHit(f, 3, peak, dec, 'highpass'); };
  Audio.prototype.drum = function (v) { this.tone(140, 50, 0.35 * v, 0.25); this.noiseHit(200, 1, 0.12 * v, 0.12); };

  Audio.prototype.play = function (name, dist) {
    if (!this.ctx) return;
    const v = dist == null ? 1 : Math.max(0.08, 1 - dist / 140);
    switch (name) {
      case 'ui': this.tone(900, 700, 0.08, 0.06, 'square'); break;
      case 'gas': this.noiseHit(500, 1, 0.4 * v, 0.15, 'lowpass'); this.noiseHit(3000, 0.8, 0.15 * v, 1.4, 'highpass'); break;
      case 'firework':
        this.tone(1800, 600, 0.06 * v, 1.0, 'sine');
        setTimeout(() => { this.noiseHit(300, 0.7, 0.7 * v, 0.6, 'lowpass'); for (let i = 0; i < 6; i++) setTimeout(() => this.click(3000, 0.12 * v, 0.03), 80 + i * 60 * Math.random()); }, 1000);
        break;
      case 'ignite': this.noiseHit(800, 0.6, 0.35 * v, 0.9, 'lowpass'); this.tone(90, 40, 0.3 * v, 0.6); break;
      case 'capture': this.tone(440, 660, 0.18, 0.4, 'square'); setTimeout(() => this.tone(660, 990, 0.18, 0.5, 'square'), 180); break;
      case 'lost': this.tone(440, 220, 0.2, 0.8, 'sawtooth'); break;
      case 'order': this.tone(300, 260, 0.07, 0.08, 'square'); break;
      case 'barricade': this.noiseHit(250, 1.5, 0.3 * v, 0.3, 'lowpass'); break;
      case 'win': [523, 659, 784, 1046].forEach((f, i) => setTimeout(() => this.tone(f, f, 0.18, 0.5, 'triangle'), i * 140)); break;
      case 'lose': [392, 330, 262].forEach((f, i) => setTimeout(() => this.tone(f, f * 0.98, 0.18, 0.6, 'sawtooth'), i * 220)); break;
      case 'chat': this.tone(1320, 1320, 0.05, 0.08, 'sine'); break;
    }
  };

  P.audio = new Audio();
})();
