/**
 * Fully synthesised sound (WebAudio) — no audio files to download.
 * Ambient wind + birdsong (crickets at night), rock impacts, knock-out and milestone chimes.
 */
export class Audio {
  constructor() {
    this.ctx = null;
    this.muted = false;
    try { this.muted = localStorage.getItem('mg-muted') === '1'; } catch (e) { /* storage unavailable */ }
    this.mode = 'day';
    this.nextChirp = 0;
  }

  /** Must be called from a user gesture. */
  unlock() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = new AC();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.9;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 3;
    this.master.connect(comp).connect(ctx.destination);

    // noise buffer
    const len = ctx.sampleRate * 2;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1;
      last = (last + 0.02 * w) / 1.02; // brown-ish noise
      d[i] = last * 3.5;
    }
    this.noise = buf;
    const white = ctx.createBuffer(1, len, ctx.sampleRate);
    const wd = white.getChannelData(0);
    for (let i = 0; i < len; i++) wd[i] = Math.random() * 2 - 1;
    this.white = white;

    // wind bed
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 480;
    this.windGain = ctx.createGain();
    this.windGain.gain.value = 0.0;
    src.connect(lp).connect(this.windGain).connect(this.master);
    src.start();
    this.windFilter = lp;
    this.windGain.gain.linearRampToValueAtTime(0.11, ctx.currentTime + 2.5);
    this.nextChirp = ctx.currentTime + 1.5;
  }

  setMuted(m) {
    this.muted = m;
    try { localStorage.setItem('mg-muted', m ? '1' : '0'); } catch (e) { /* ignore */ }
    if (this.master) this.master.gain.setTargetAtTime(m ? 0 : 0.9, this.ctx.currentTime, 0.08);
  }

  setMode(name) { this.mode = name; }

  /** Called every frame: gusts & schedules ambient sounds. */
  update(gust) {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return;
    const now = ctx.currentTime;
    this.windGain.gain.setTargetAtTime(0.06 + gust * 0.08, now, 0.6);
    this.windFilter.frequency.setTargetAtTime(320 + gust * 420, now, 0.6);
    if (now >= this.nextChirp) {
      if (this.mode === 'night') { this.crickets(now); this.nextChirp = now + 1.2 + Math.random() * 2.2; }
      else { this.birdPhrase(now); this.nextChirp = now + 2.5 + Math.random() * 6; }
    }
  }

  voice(pan = 0) {
    const g = this.ctx.createGain();
    if (this.ctx.createStereoPanner) {
      const p = this.ctx.createStereoPanner();
      p.pan.value = Math.max(-1, Math.min(1, pan));
      g.connect(p).connect(this.master);
    } else g.connect(this.master);
    return g;
  }

  birdPhrase(t) {
    const ctx = this.ctx;
    const pan = Math.random() * 1.6 - 0.8;
    const out = this.voice(pan);
    out.gain.value = 0.03 + Math.random() * 0.025;
    const notes = 2 + Math.floor(Math.random() * 5);
    const base = 2300 + Math.random() * 1600;
    const kind = Math.random();
    let tt = t;
    for (let i = 0; i < notes; i++) {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = 'sine';
      const dur = 0.05 + Math.random() * 0.09;
      const f0 = base * (0.85 + Math.random() * 0.3);
      const f1 = kind < 0.5 ? f0 * (1.25 + Math.random() * 0.4) : f0 * (0.65 + Math.random() * 0.2);
      o.frequency.setValueAtTime(f0, tt);
      o.frequency.exponentialRampToValueAtTime(f1, tt + dur);
      g.gain.setValueAtTime(0, tt);
      g.gain.linearRampToValueAtTime(1, tt + 0.012);
      g.gain.exponentialRampToValueAtTime(0.001, tt + dur);
      o.connect(g).connect(out);
      o.start(tt);
      o.stop(tt + dur + 0.02);
      tt += dur + 0.03 + Math.random() * 0.08;
    }
  }

  crickets(t) {
    const ctx = this.ctx;
    const out = this.voice(Math.random() * 1.6 - 0.8);
    out.gain.value = 0.012;
    const f = 4200 + Math.random() * 600;
    const pulses = 3 + Math.floor(Math.random() * 4);
    for (let i = 0; i < pulses; i++) {
      const tt = t + i * 0.075;
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = 'triangle';
      o.frequency.value = f;
      g.gain.setValueAtTime(0, tt);
      g.gain.linearRampToValueAtTime(1, tt + 0.008);
      g.gain.exponentialRampToValueAtTime(0.001, tt + 0.05);
      o.connect(g).connect(out);
      o.start(tt);
      o.stop(tt + 0.06);
    }
  }

  thud(size = 0.5, pan = 0, near = 0) {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return;
    const t = ctx.currentTime;
    const out = this.voice(pan * 0.8);
    out.gain.value = Math.min(0.55, 0.16 + size * 0.28 + near * 0.12);
    // body
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(110 - size * 30, t);
    o.frequency.exponentialRampToValueAtTime(38, t + 0.28);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(1, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.38);
    o.connect(g).connect(out);
    o.start(t);
    o.stop(t + 0.4);
    // gravel crunch
    const n = ctx.createBufferSource();
    n.buffer = this.white;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 900 + Math.random() * 500;
    bp.Q.value = 0.8;
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(0.0001, t);
    ng.gain.exponentialRampToValueAtTime(0.5, t + 0.006);
    ng.gain.exponentialRampToValueAtTime(0.001, t + 0.22);
    n.connect(bp).connect(ng).connect(out);
    n.start(t, Math.random());
    n.stop(t + 0.25);
  }

  hit() {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return;
    const t = ctx.currentTime;
    const out = this.voice(0);
    out.gain.value = 0.16;
    [660, 494, 370].forEach((f, i) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = 'triangle';
      const tt = t + 0.12 + i * 0.13;
      o.frequency.setValueAtTime(f, tt);
      o.frequency.exponentialRampToValueAtTime(f * 0.94, tt + 0.25);
      g.gain.setValueAtTime(0.0001, tt);
      g.gain.exponentialRampToValueAtTime(1, tt + 0.02);
      g.gain.exponentialRampToValueAtTime(0.001, tt + 0.35);
      o.connect(g).connect(out);
      o.start(tt);
      o.stop(tt + 0.4);
    });
  }

  chime() {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return;
    const t = ctx.currentTime;
    const out = this.voice(0);
    out.gain.value = 0.05;
    [1047, 1319, 1568].forEach((f, i) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = 'sine';
      const tt = t + i * 0.07;
      o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, tt);
      g.gain.exponentialRampToValueAtTime(1, tt + 0.01);
      g.gain.exponentialRampToValueAtTime(0.001, tt + 0.6);
      o.connect(g).connect(out);
      o.start(tt);
      o.stop(tt + 0.65);
    });
  }

  step() {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return;
    const t = ctx.currentTime;
    const out = this.voice(0);
    out.gain.value = 0.035;
    const n = ctx.createBufferSource();
    n.buffer = this.white;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 700;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(1, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.07);
    n.connect(lp).connect(g).connect(out);
    n.start(t, Math.random());
    n.stop(t + 0.08);
  }
}
