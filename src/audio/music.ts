/**
 * Original score, synthesised in WebAudio — no audio files.
 * A slow anthemic march in D minor / F major: brass melody over strings, timpani and snare.
 * Written as note data so sections can be recombined per screen (menu / briefing / victory).
 */

type Note = [step: number, semitone: number, beats: number, vel?: number];

// Semitones relative to D3 (146.83 Hz).
const D3 = 146.83;
const hz = (semi: number) => D3 * Math.pow(2, semi / 12);

// Scale degrees used: D minor natural (D E F G A Bb C) with a major-lift at the chorus.
const A = {
  D: 0, E: 2, F: 3, G: 5, A: 7, Bb: 8, C: 10,
  D2: 12, E2: 14, F2: 15, G2: 17, A2: 19, Bb2: 20, C2: 22, D3u: 24, F3u: 27, A3u: 31,
};

/** 16-bar main theme: a rising call, an answering phrase, then a broad hymn-like lift. */
const MELODY: Note[] = [
  // call
  [0, A.A, 1], [1, A.D2, 2], [3, A.C2, 1],
  [4, A.Bb2 - 12 + 12, 1.5], [5.5, A.A, 0.5], [6, A.D2, 2],
  [8, A.F2, 1], [9, A.A2, 2], [11, A.G2, 1],
  [12, A.F2, 2], [14, A.E2, 2],
  // answer
  [16, A.D2, 1], [17, A.F2, 1], [18, A.A2, 2],
  [20, A.G2, 1.5], [21.5, A.F2, 0.5], [22, A.E2, 2],
  [24, A.F2, 1], [25, A.G2, 1], [26, A.A2, 1], [27, A.Bb2, 1],
  [28, A.A2, 3], [31, A.A2, 1],
  // lift (the anthem)
  [32, A.D3u, 2], [34, A.C2, 2],
  [36, A.Bb2, 2], [38, A.A2, 2],
  [40, A.Bb2, 1], [41, A.C2, 1], [42, A.D3u, 2],
  [44, A.A2, 2], [46, A.G2, 1], [47, A.F2, 1],
  [48, A.E2, 2], [50, A.G2, 2],
  [52, A.F2, 2], [54, A.E2, 1], [55, A.D2, 1],
  [56, A.D2, 4],
  [60, A.A, 2], [62, A.D2, 2],
];

/** Chord roots per bar (4 beats each): Dm Dm Bb F / Gm Dm A Dm ... */
const CHORDS: number[][] = [
  [A.D, A.F, A.A], [A.D, A.F, A.A], [A.Bb - 12, A.D, A.F], [A.F, A.A, A.C],
  [A.G, A.Bb, A.D2], [A.D, A.F, A.A], [A.A, A.C + 1, A.E2], [A.D, A.F, A.A],
  [A.Bb - 12, A.D, A.F], [A.F, A.A, A.C], [A.G, A.Bb, A.D2], [A.A, A.C + 1, A.E2],
  [A.D, A.F, A.A], [A.Bb - 12, A.D, A.F], [A.G, A.Bb, A.D2], [A.A, A.C + 1, A.E2],
];

const BPM = 76;
const BEAT = 60 / BPM;
const BARS = 16;
const LOOP = BARS * 4 * BEAT;

export class Music {
  private ctx: AudioContext | null = null;
  private bus!: GainNode;
  private noise!: AudioBuffer;
  private timer: number | null = null;
  private nextTime = 0;
  private step = 0;
  private playing = false;
  private intensity = 1; // 1 = full march, 0.55 = quieter underscore for menus
  volume = 0.55;

  attach(ctx: AudioContext, destination: AudioNode) {
    if (this.ctx) return;
    this.ctx = ctx;
    this.bus = ctx.createGain();
    this.bus.gain.value = 0;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -18;
    comp.ratio.value = 3;
    this.bus.connect(comp).connect(destination);
    const len = Math.floor(ctx.sampleRate * 1.5);
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  }

  setVolume(v: number) {
    this.volume = v;
    if (this.ctx && this.playing) this.bus.gain.setTargetAtTime(v * this.intensity, this.ctx.currentTime, 0.4);
  }

  /** Start (or re-level) the score. `intensity` lets quieter screens underscore rather than march. */
  play(intensity = 1) {
    if (!this.ctx) return;
    this.intensity = intensity;
    if (this.ctx.state === 'suspended') this.ctx.resume();
    this.bus.gain.cancelScheduledValues(this.ctx.currentTime);
    this.bus.gain.setTargetAtTime(this.volume * intensity, this.ctx.currentTime, 0.8);
    if (this.playing) return;
    this.playing = true;
    this.nextTime = this.ctx.currentTime + 0.15;
    this.step = 0;
    this.tick();
    this.timer = window.setInterval(() => this.tick(), 120);
  }

  stop(fade = 1.2) {
    if (!this.ctx || !this.playing) return;
    this.playing = false;
    this.bus.gain.setTargetAtTime(0, this.ctx.currentTime, fade / 3);
    if (this.timer !== null) window.clearInterval(this.timer);
    this.timer = null;
  }

  get isPlaying() {
    return this.playing;
  }

  // ---------------------------------------------------------------- voices

  private env(dest: AudioNode, t: number, a: number, d: number, s: number, r: number, peak: number, sustain: number) {
    const g = this.ctx!.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(peak, t + a);
    g.gain.linearRampToValueAtTime(peak * sustain, t + a + d);
    g.gain.setValueAtTime(peak * sustain, t + Math.max(a + d, s));
    g.gain.exponentialRampToValueAtTime(0.0001, t + Math.max(a + d, s) + r);
    g.connect(dest);
    return g;
  }

  /** Brass: stacked saw/square with a filter swell — the melody voice. */
  private brass(t: number, f: number, dur: number, vel: number) {
    const ctx = this.ctx!;
    const filt = ctx.createBiquadFilter();
    filt.type = 'lowpass';
    filt.Q.value = 1.1;
    filt.frequency.setValueAtTime(f * 1.6, t);
    filt.frequency.linearRampToValueAtTime(f * 5.5, t + 0.12);
    filt.frequency.linearRampToValueAtTime(f * 3, t + dur);
    const g = this.env(filt, t, 0.07, 0.12, dur, 0.25, 0.3 * vel, 0.72);
    filt.connect(this.bus);
    for (const [type, det, lvl] of [['sawtooth', 0, 1], ['sawtooth', 7, 0.5], ['square', -5, 0.35]] as [OscillatorType, number, number][]) {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.value = f;
      o.detune.value = det;
      const vg = ctx.createGain();
      vg.gain.value = lvl;
      o.connect(vg).connect(g);
      o.start(t);
      o.stop(t + dur + 0.4);
    }
  }

  /** Strings: soft triangle pad with slow vibrato. */
  private strings(t: number, f: number, dur: number, vel: number) {
    const ctx = this.ctx!;
    const g = this.env(this.bus, t, 0.45, 0.3, dur, 0.9, 0.075 * vel, 0.85);
    for (const det of [-6, 6]) {
      const o = ctx.createOscillator();
      o.type = 'triangle';
      o.frequency.value = f;
      o.detune.value = det;
      const lfo = ctx.createOscillator();
      lfo.frequency.value = 4.6;
      const lg = ctx.createGain();
      lg.gain.value = 3.5;
      lfo.connect(lg).connect(o.detune);
      lfo.start(t);
      lfo.stop(t + dur + 1);
      o.connect(g);
      o.start(t);
      o.stop(t + dur + 1);
    }
  }

  /** Low brass / contrabass root. */
  private bass(t: number, f: number, dur: number) {
    const ctx = this.ctx!;
    const g = this.env(this.bus, t, 0.05, 0.15, dur, 0.3, 0.17, 0.7);
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.value = f;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 320;
    o.connect(lp).connect(g);
    o.start(t);
    o.stop(t + dur + 0.4);
  }

  private timpani(t: number, f: number, vel: number) {
    const ctx = this.ctx!;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.55 * vel, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.9);
    g.connect(this.bus);
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(f * 1.8, t);
    o.frequency.exponentialRampToValueAtTime(f, t + 0.12);
    o.connect(g);
    o.start(t);
    o.stop(t + 1);
    const n = ctx.createBufferSource();
    n.buffer = this.noise;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = f * 3;
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(0.1 * vel, t);
    ng.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
    n.connect(bp).connect(ng).connect(this.bus);
    n.start(t);
    n.stop(t + 0.25);
  }

  private snare(t: number, vel: number) {
    const ctx = this.ctx!;
    const n = ctx.createBufferSource();
    n.buffer = this.noise;
    n.playbackRate.value = 1.4;
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 1400;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.14 * vel, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.11);
    n.connect(hp).connect(g).connect(this.bus);
    n.start(t);
    n.stop(t + 0.15);
  }

  // ---------------------------------------------------------------- scheduler

  private tick() {
    const ctx = this.ctx;
    if (!ctx || !this.playing) return;
    const ahead = ctx.currentTime + 0.6;
    // schedule in eighth-note steps
    while (this.nextTime < ahead) {
      const t = this.nextTime;
      const step = this.step; // eighths since loop start
      const beat = step / 2;
      const bar = Math.floor(beat / 4) % BARS;
      const inBar = beat % 4;
      const chord = CHORDS[bar];
      const lift = bar >= 8; // second half opens up

      // melody
      for (const [s, semi, beats, vel = 1] of MELODY) {
        if (Math.abs(s - beat) < 1e-6) this.brass(t, hz(semi), beats * BEAT * 0.92, vel * (lift ? 1 : 0.85));
      }
      // strings pad on each bar
      if (inBar === 0) for (const c of chord) this.strings(t, hz(c + (lift ? 12 : 0)), 4 * BEAT * 0.98, lift ? 1 : 0.8);
      // bass on 1 and 3
      if (inBar === 0 || inBar === 2) this.bass(t, hz(chord[0] - 12), 1.8 * BEAT);
      // timpani: heartbeat on 1, answer on 3 in the lift
      if (inBar === 0) this.timpani(t, hz(chord[0] - 24), 1);
      if (lift && inBar === 2) this.timpani(t, hz(chord[0] - 24), 0.7);
      // snare: military roll figure
      if (this.intensity > 0.8) {
        if (inBar === 1 || inBar === 3) this.snare(t, 0.9);
        if (lift && (inBar === 1.5 || inBar === 3.5)) this.snare(t, 0.5);
        if (inBar === 3.5 && bar % 4 === 3) {
          this.snare(t, 0.6);
          this.snare(t + BEAT * 0.25, 0.7);
        }
      }

      this.nextTime += BEAT / 2;
      this.step = (step + 1) % (BARS * 8);
      if (this.step === 0) this.nextTime = Math.max(this.nextTime, t + BEAT / 2);
    }
  }
}

export const MUSIC_LOOP_SECONDS = LOOP;
