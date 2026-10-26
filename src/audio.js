// Audio procedural: música ambiental y efectos de cada elemento.

export class SoundEngine {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.musicGain = null;
    this.sfxGain = null;
    this.volume = 0.65;
    this.muted = false;
    this.musicTimer = null;
    this.mode = 'menu';
    this.step = 0;
    this.noiseBuffer = null;
    this.stormGain = null;
    this.stormSource = null;
    this.stepTimer = 0;
  }

  ensure() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return true;
    }
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return false;
      this.ctx = new AudioCtx();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.muted ? 0 : this.volume;
      this.master.connect(this.ctx.destination);

      const compressor = this.ctx.createDynamicsCompressor();
      compressor.threshold.value = -18;
      compressor.ratio.value = 4;
      compressor.connect(this.master);

      this.musicGain = this.ctx.createGain();
      this.musicGain.gain.value = 0.5;
      this.musicGain.connect(compressor);

      this.sfxGain = this.ctx.createGain();
      this.sfxGain.gain.value = 1;
      this.sfxGain.connect(compressor);

      // Buffer de ruido compartido para impactos y viento.
      const length = this.ctx.sampleRate * 2;
      const buffer = this.ctx.createBuffer(1, length, this.ctx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
      this.noiseBuffer = buffer;

      // Zumbido de tormenta (siempre presente, silenciado si no hay peligro).
      this.stormGain = this.ctx.createGain();
      this.stormGain.gain.value = 0;
      const stormFilter = this.ctx.createBiquadFilter();
      stormFilter.type = 'lowpass';
      stormFilter.frequency.value = 220;
      this.stormGain.connect(stormFilter);
      stormFilter.connect(this.master);
      const stormSource = this.ctx.createBufferSource();
      stormSource.buffer = buffer;
      stormSource.loop = true;
      stormSource.connect(this.stormGain);
      stormSource.start();
      this.stormSource = stormSource;
      return true;
    } catch {
      return false;
    }
  }

  unlock() {
    return this.ensure();
  }

  setVolume(value) {
    this.volume = Math.max(0, Math.min(1, value));
    if (this.master) this.master.gain.value = this.muted ? 0 : this.volume;
  }

  setMuted(muted) {
    this.muted = muted;
    if (this.master) this.master.gain.value = muted ? 0 : this.volume;
  }

  setStormIntensity(value) {
    if (!this.ensure()) return;
    const target = Math.max(0, Math.min(1, value)) * 0.22;
    this.stormGain.gain.setTargetAtTime(target, this.ctx.currentTime, 0.35);
  }

  setMusicMode(mode) {
    if (this.mode === mode && this.musicTimer) return;
    this.mode = mode;
    if (this.musicTimer) {
      this.stopMusic();
      this.startMusic();
    }
  }

  startMusic() {
    if (!this.ensure()) return;
    if (this.musicTimer) return;
    this.step = 0;
    this.playMusicStep();
    this.musicTimer = setInterval(() => this.playMusicStep(), this.mode === 'battle' ? 460 : 620);
  }

  stopMusic() {
    if (this.musicTimer) clearInterval(this.musicTimer);
    this.musicTimer = null;
  }

  playMusicStep() {
    if (!this.ctx || this.muted) return;
    const battle = this.mode === 'battle';
    const scale = battle ? [220, 261.63, 293.66, 329.63, 392, 440] : [174.61, 220, 261.63, 329.63, 349.23, 440];
    const step = this.step++;
    const root = scale[0];
    const note = scale[(step * 3) % scale.length];
    const octave = step % 8 < 4 ? 1 : 2;
    // Campana suave.
    this.tone(note * octave, battle ? 0.34 : 0.7, 'sine', battle ? 0.035 : 0.028, 0, 0.02);
    if (step % 4 === 0) {
      this.tone(root / 2, battle ? 1.4 : 2.4, 'triangle', 0.03, 0, 0.4);
      this.tone(root * 0.75, battle ? 1.4 : 2.4, 'sine', 0.022, 0.05, 0.5);
    }
    if (battle && step % 2 === 0) {
      this.tone(root / 4, 0.9, 'triangle', 0.045, 0, 0.03);
    }
    if (step % 16 === 0) {
      const chord = [root, root * 1.2, root * 1.5];
      for (const freq of chord) this.tone(freq, 3.2, 'sine', 0.012, 0.1, 1.0);
    }
  }

  tone(freq, duration, type = 'sine', gain = 0.08, delay = 0, attack = 0.01, sweepTo = null, destination = null) {
    if (!this.ensure() || this.muted) return;
    const now = this.ctx.currentTime + delay;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(Math.max(20, freq), now);
    if (sweepTo) osc.frequency.exponentialRampToValueAtTime(Math.max(20, sweepTo), now + duration);
    g.gain.setValueAtTime(0.0001, now);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain), now + Math.max(0.005, attack));
    g.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    osc.connect(g);
    g.connect(destination || this.sfxGain);
    osc.start(now);
    osc.stop(now + duration + 0.05);
  }

  noise(duration, gain, filterFreq, type = 'lowpass', delay = 0, sweepTo = null) {
    if (!this.ensure() || this.muted) return;
    const now = this.ctx.currentTime + delay;
    const source = this.ctx.createBufferSource();
    source.buffer = this.noiseBuffer;
    const filter = this.ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.setValueAtTime(filterFreq, now);
    if (sweepTo) filter.frequency.exponentialRampToValueAtTime(Math.max(30, sweepTo), now + duration);
    filter.Q.value = 0.8;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(Math.max(0.0002, gain), now);
    g.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    source.connect(filter);
    filter.connect(g);
    g.connect(this.sfxGain);
    source.start(now);
    source.stop(now + duration + 0.03);
  }

  uiClick() {
    this.tone(520, 0.07, 'triangle', 0.035, 0, 0.005, 660);
  }

  jump() {
    this.noise(0.16, 0.05, 900, 'highpass', 0, 300);
  }

  footstep() {
    this.noise(0.06, 0.025, 420, 'lowpass');
  }

  cast(element) {
    if (!this.ensure()) return;
    switch (element) {
      case 'fire':
        this.noise(0.4, 0.12, 1800, 'bandpass', 0, 300);
        this.tone(180, 0.32, 'sawtooth', 0.05, 0, 0.01, 80);
        this.tone(520, 0.18, 'sine', 0.03, 0.04, 0.01, 260);
        break;
      case 'water':
        this.noise(0.35, 0.09, 900, 'bandpass', 0, 2200);
        this.tone(360, 0.28, 'sine', 0.06, 0, 0.01, 700);
        this.tone(720, 0.2, 'sine', 0.025, 0.05, 0.01, 980);
        break;
      case 'wind':
        this.noise(0.45, 0.1, 500, 'highpass', 0, 3200);
        this.tone(300, 0.4, 'triangle', 0.03, 0, 0.05, 520);
        break;
      case 'earth':
        this.tone(90, 0.42, 'sawtooth', 0.08, 0, 0.01, 45);
        this.noise(0.35, 0.1, 350, 'lowpass', 0, 120);
        break;
      default:
        this.tone(440, 0.2, 'sine', 0.05);
    }
  }

  impact(element) {
    switch (element) {
      case 'fire':
        this.tone(120, 0.3, 'sawtooth', 0.08, 0, 0.005, 50);
        this.noise(0.35, 0.12, 900, 'lowpass', 0, 180);
        break;
      case 'water':
        this.noise(0.3, 0.08, 1400, 'bandpass', 0, 500);
        break;
      case 'wind':
        this.noise(0.25, 0.07, 2200, 'highpass', 0, 1200);
        break;
      case 'earth':
        this.tone(70, 0.35, 'sine', 0.1, 0, 0.01, 38);
        this.noise(0.3, 0.09, 300, 'lowpass');
        break;
      default:
        this.noise(0.2, 0.06, 1000, 'lowpass');
    }
  }

  hit() {
    this.tone(150, 0.1, 'square', 0.04, 0, 0.005, 90);
    this.noise(0.1, 0.05, 700, 'bandpass');
  }

  pickup(rarity = 'common') {
    const order = ['common', 'uncommon', 'rare', 'epic', 'legendary'];
    const notes = [523.25, 659.25, 783.99, 1046.5];
    const count = Math.max(1, order.indexOf(rarity) + 1);
    for (let i = 0; i < count; i++) {
      this.tone(notes[i % notes.length] * (1 + Math.floor(i / 4)), 0.24, 'triangle', 0.05, i * 0.055, 0.005);
    }
  }

  heal() {
    [523.25, 659.25, 783.99].forEach((f, i) => this.tone(f, 0.5, 'sine', 0.045, i * 0.06, 0.02));
  }

  death() {
    this.tone(300, 1.0, 'sawtooth', 0.07, 0, 0.01, 70);
    this.tone(150, 1.2, 'triangle', 0.06, 0.05, 0.02, 50);
    this.noise(0.6, 0.1, 600, 'lowpass', 0, 80);
  }

  victory() {
    const notes = [392, 523.25, 659.25, 783.99, 1046.5];
    notes.forEach((f, i) => this.tone(f, 0.9, 'triangle', 0.07, i * 0.16, 0.02));
    notes.forEach((f, i) => this.tone(f / 2, 1.1, 'sine', 0.03, i * 0.16, 0.02));
  }

  defeat() {
    const notes = [392, 349.23, 293.66, 220];
    notes.forEach((f, i) => this.tone(f, 1.1, 'sine', 0.06, i * 0.2, 0.02));
  }

  combo() {
    [261.63, 329.63, 392, 523.25].forEach((f, i) => this.tone(f, 0.7, 'sine', 0.055, i * 0.04, 0.01));
    this.noise(0.5, 0.08, 1600, 'bandpass', 0, 400);
  }
}
