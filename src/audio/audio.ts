import * as THREE from 'three';
import { Music } from './music';

/** Fully synthesised WebAudio sound — no audio files required. */
export class Audio {
  ctx: AudioContext | null = null;
  private master!: GainNode;
  private noise!: AudioBuffer;
  private engineOsc: OscillatorNode[] = [];
  private engineGain!: GainNode;
  private engineFilter!: BiquadFilterNode;
  private trackGain!: GainNode;
  private ambientGain!: GainNode;
  private reverb!: ConvolverNode;
  private reverbGain!: GainNode;
  private listener = new THREE.Vector3();
  private listenerYaw = 0;
  private recent = 0;
  private recentT = 0;
  volume = 0.8;
  musicVolume = 0.55;
  muted = false;
  music = new Music();

  unlock() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || (window as any).webkitAudioContext;
    if (!AC) return;
    const ctx: AudioContext = new AC();
    this.ctx = ctx;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 4;
    this.master = ctx.createGain();
    this.master.gain.value = this.volume;
    this.master.connect(comp).connect(ctx.destination);
    // Outdoor ambience: a short synthesised impulse response gives gunfire its "crack … roll"
    // across the fields instead of a dry click.
    this.reverb = ctx.createConvolver();
    this.reverb.buffer = this.makeIR(ctx, 1.9, 3.2);
    this.reverbGain = ctx.createGain();
    this.reverbGain.gain.value = 0.5;
    this.reverb.connect(this.reverbGain).connect(this.master);

    this.music.attach(ctx, comp);
    this.music.setVolume(this.musicVolume);
    const len = ctx.sampleRate * 2;
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;

    // engine
    this.engineFilter = ctx.createBiquadFilter();
    this.engineFilter.type = 'lowpass';
    this.engineFilter.frequency.value = 400;
    this.engineGain = ctx.createGain();
    this.engineGain.gain.value = 0;
    this.engineFilter.connect(this.engineGain).connect(this.master);
    for (const [type, mul] of [['sawtooth', 1], ['square', 0.5], ['sawtooth', 2.01]] as [OscillatorType, number][]) {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.value = 40 * mul;
      const g = ctx.createGain();
      g.gain.value = mul === 0.5 ? 0.5 : 0.3;
      o.connect(g).connect(this.engineFilter);
      o.start();
      (o as any)._mul = mul;
      this.engineOsc.push(o);
    }
    // track clatter
    const tn = ctx.createBufferSource();
    tn.buffer = this.noise;
    tn.loop = true;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 700;
    bp.Q.value = 1.5;
    this.trackGain = ctx.createGain();
    this.trackGain.gain.value = 0;
    tn.connect(bp).connect(this.trackGain).connect(this.master);
    tn.start();
    // ambient battlefield rumble
    const an = ctx.createBufferSource();
    an.buffer = this.noise;
    an.loop = true;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 180;
    this.ambientGain = ctx.createGain();
    this.ambientGain.gain.value = 0;
    an.connect(lp).connect(this.ambientGain).connect(this.master);
    an.start();
  }

  /** Decaying-noise impulse response — a cheap stand-in for open countryside. */
  private makeIR(ctx: AudioContext, seconds: number, decay: number): AudioBuffer {
    const n = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(2, n, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = buf.getChannelData(c);
      for (let i = 0; i < n; i++) {
        const t = i / n;
        // sparse early reflections then a smooth tail
        const sparse = i < ctx.sampleRate * 0.12 ? (Math.random() < 0.08 ? 1 : 0.12) : 1;
        d[i] = (Math.random() * 2 - 1) * Math.pow(1 - t, decay) * sparse;
      }
    }
    return buf;
  }

  setVolume(v: number) {
    this.volume = v;
    if (this.master) this.master.gain.value = this.muted ? 0 : v;
  }

  setMusicVolume(v: number) {
    this.musicVolume = v;
    this.music.setVolume(v);
  }

  /** Score for the menus/briefing (intensity 1) or a quieter underscore (0.6). */
  playMusic(intensity = 1) {
    this.unlock();
    if (this.musicVolume <= 0) return;
    this.music.play(intensity);
  }

  stopMusic(fade = 1.2) {
    this.music.stop(fade);
  }

  setListener(p: THREE.Vector3, yaw: number) {
    this.listener.copy(p);
    this.listenerYaw = yaw;
  }

  setAmbient(on: boolean) {
    if (!this.ctx) return;
    this.ambientGain.gain.setTargetAtTime(on ? 0.12 : 0, this.ctx.currentTime, 0.5);
    if (!on) {
      this.engineGain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.2);
      this.trackGain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.2);
    }
  }

  /** rpm 0..1, load 0..1, speed 0..1 */
  engine(rpm: number, load: number, speed: number) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const f = 34 + rpm * 46;
    for (const o of this.engineOsc) o.frequency.setTargetAtTime(f * (o as any)._mul, t, 0.12);
    this.engineFilter.frequency.setTargetAtTime(260 + load * 700 + rpm * 300, t, 0.15);
    this.engineGain.gain.setTargetAtTime(0.1 + load * 0.08 + rpm * 0.06, t, 0.2);
    this.trackGain.gain.setTargetAtTime(speed * 0.16, t, 0.15);
  }

  private spatial(p: THREE.Vector3 | null, falloff = 35): { gain: number; pan: number } {
    if (!p) return { gain: 1, pan: 0 };
    const dx = p.x - this.listener.x, dz = p.z - this.listener.z;
    const d = Math.hypot(dx, dz, p.y - this.listener.y);
    const ang = Math.atan2(dx, dz) - this.listenerYaw;
    return { gain: 1 / (1 + d / falloff), pan: Math.max(-1, Math.min(1, -Math.sin(ang) * 0.8)) };
  }

  private out(p: THREE.Vector3 | null, falloff?: number, wet = 0): AudioNode | null {
    if (!this.ctx) return null;
    const { gain, pan } = this.spatial(p, falloff);
    if (gain < 0.02) return null;
    const g = this.ctx.createGain();
    g.gain.value = gain;
    if (this.ctx.createStereoPanner) {
      const sp = this.ctx.createStereoPanner();
      sp.pan.value = pan;
      g.connect(sp).connect(this.master);
    } else g.connect(this.master);
    if (wet > 0 && this.reverb) {
      const w = this.ctx.createGain();
      w.gain.value = gain * wet;
      g.connect(w).connect(this.reverb);
    }
    return g;
  }

  private throttle(): boolean {
    if (!this.ctx) return false;
    const now = this.ctx.currentTime;
    if (now - this.recentT > 0.05) {
      this.recentT = now;
      this.recent = 0;
    }
    return ++this.recent <= 8;
  }

  private noiseBurst(dest: AudioNode, dur: number, type: BiquadFilterType, f0: number, f1: number, vol: number, delay = 0) {
    const ctx = this.ctx!;
    const t = ctx.currentTime + delay;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.playbackRate.value = 0.8 + Math.random() * 0.4;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.setValueAtTime(f0, t);
    f.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(f).connect(g).connect(dest);
    src.start(t, Math.random() * 1.5, dur + 0.05);
  }

  private thump(dest: AudioNode, f0: number, f1: number, dur: number, vol: number, type: OscillatorType = 'sine') {
    const ctx = this.ctx!;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(f1, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g).connect(dest);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  cannon(p: THREE.Vector3, calibre: number) {
    const o = this.out(p, 60, 0.6);
    if (!o) return;
    const big = calibre / 75;
    // sharp muzzle crack, then the body of the blast, then a rolling tail across the fields
    this.noiseBurst(o, 0.05, 'highpass', 5000, 2200, 1.1);
    this.noiseBurst(o, 0.9 * big, 'lowpass', 2400, 120, 1.0);
    this.thump(o, 90 * (1.2 - big * 0.3), 30, 0.5, 1.1);
    this.noiseBurst(o, 1.8, 'lowpass', 400, 60, 0.35, 0.08);
    this.noiseBurst(o, 1.4, 'lowpass', 260, 50, 0.22, 0.22);
  }

  /**
   * Coaxial machine gun. Each round is a layered crack: a high transient, a mid "bark", a low
   * thump, a faint mechanical action click, and a delayed slap-back off the countryside.
   */
  mg(p: THREE.Vector3, vol = 1) {
    if (!this.throttle()) return;
    const o = this.out(p, 34, 0.42);
    if (!o) return;
    const ctx = this.ctx!;
    const jitter = 0.92 + Math.random() * 0.16; // no two rounds identical
    this.noiseBurst(o, 0.022, 'highpass', 6000 * jitter, 2600, 0.85 * vol);
    this.noiseBurst(o, 0.075, 'bandpass', 2100 * jitter, 700, 0.6 * vol);
    this.noiseBurst(o, 0.16, 'lowpass', 700, 160, 0.3 * vol, 0.012);
    this.thump(o, 165 * jitter, 55, 0.08, 0.4 * vol, 'square');
    // bolt / feed mechanism
    const t = ctx.currentTime;
    const m = ctx.createOscillator();
    m.type = 'square';
    m.frequency.setValueAtTime(3200 * jitter, t + 0.018);
    const mg = ctx.createGain();
    mg.gain.setValueAtTime(0.05 * vol, t + 0.018);
    mg.gain.exponentialRampToValueAtTime(0.0001, t + 0.045);
    m.connect(mg).connect(o);
    m.start(t + 0.018);
    m.stop(t + 0.05);
    // slap-back echo gives the open-field feel
    this.noiseBurst(o, 0.12, 'lowpass', 1400, 300, 0.16 * vol, 0.09 + Math.random() * 0.04);
  }

  rifle(p: THREE.Vector3) {
    if (!this.throttle()) return;
    const o = this.out(p, 28, 0.45);
    if (!o) return;
    const j = 0.9 + Math.random() * 0.2;
    this.noiseBurst(o, 0.025, 'highpass', 5200 * j, 2000, 0.6);
    this.noiseBurst(o, 0.1, 'bandpass', 1700 * j, 520, 0.32);
    this.thump(o, 140 * j, 50, 0.07, 0.2, 'square');
    this.noiseBurst(o, 0.26, 'lowpass', 900, 180, 0.14, 0.07);
  }

  explosion(p: THREE.Vector3, size: number) {
    const o = this.out(p, 70, 0.7);
    if (!o) return;
    this.noiseBurst(o, 1.6 * size, 'lowpass', 900, 50, 1.1);
    this.thump(o, 70, 25, 0.9, 1.2 * Math.min(1.5, size));
  }

  impact(p: THREE.Vector3, ricochet: boolean, pen = false) {
    const o = this.out(p, 45, 0.5);
    if (!o) return;
    if (ricochet) {
      this.thump(o, 2400, 700, 0.35, 0.35, 'triangle');
      this.noiseBurst(o, 0.15, 'bandpass', 3000, 1500, 0.4);
    } else if (pen) {
      this.noiseBurst(o, 0.5, 'lowpass', 1400, 200, 0.9);
      this.thump(o, 300, 60, 0.3, 0.6, 'square');
    } else {
      this.noiseBurst(o, 0.6, 'lowpass', 1100, 90, 0.8);
      this.thump(o, 80, 30, 0.4, 0.7);
    }
  }

  crunch() {
    const o = this.out(null);
    if (o) this.noiseBurst(o, 0.4, 'bandpass', 400, 150, 0.4);
  }

  radio() {
    const o = this.out(null);
    if (!o) return;
    this.noiseBurst(o, 0.18, 'bandpass', 2600, 1800, 0.12);
    const ctx = this.ctx!;
    for (const [f, d] of [[1250, 0], [900, 0.09]]) {
      const osc = ctx.createOscillator();
      osc.frequency.value = f;
      const g = ctx.createGain();
      const t = ctx.currentTime + d;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.08, t + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.07);
      osc.connect(g).connect(o);
      osc.start(t);
      osc.stop(t + 0.08);
    }
  }

  /** Occasional distant guns to keep the battlefield alive. */
  ambientTick(dt: number) {
    if (!this.ctx || Math.random() > dt * 0.12) return;
    const a = Math.random() * Math.PI * 2;
    const p = this.listener.clone().add(new THREE.Vector3(Math.cos(a) * 600, 0, Math.sin(a) * 600));
    const o = this.out(p, 300, 0.9);
    if (!o) return;
    this.noiseBurst(o, 2.2, 'lowpass', 300, 40, 0.8);
  }
}
