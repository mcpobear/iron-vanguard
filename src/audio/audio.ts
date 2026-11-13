import * as THREE from 'three';

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
  private listener = new THREE.Vector3();
  private listenerYaw = 0;
  private recent = 0;
  private recentT = 0;
  volume = 0.8;
  muted = false;

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

  setVolume(v: number) {
    this.volume = v;
    if (this.master) this.master.gain.value = this.muted ? 0 : v;
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

  private out(p: THREE.Vector3 | null, falloff?: number): AudioNode | null {
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
    return g;
  }

  private throttle(): boolean {
    if (!this.ctx) return false;
    const now = this.ctx.currentTime;
    if (now - this.recentT > 0.05) {
      this.recentT = now;
      this.recent = 0;
    }
    return ++this.recent <= 6;
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
    const o = this.out(p, 60);
    if (!o) return;
    const big = calibre / 75;
    this.noiseBurst(o, 0.9 * big, 'lowpass', 2400, 120, 1.0);
    this.thump(o, 90 * (1.2 - big * 0.3), 30, 0.5, 1.1);
    this.noiseBurst(o, 1.8, 'lowpass', 400, 60, 0.35, 0.08);
  }

  mg(p: THREE.Vector3, vol = 1) {
    if (!this.throttle()) return;
    const o = this.out(p, 30);
    if (!o) return;
    this.noiseBurst(o, 0.06, 'bandpass', 1800, 900, 0.5 * vol);
    this.thump(o, 180, 80, 0.05, 0.25 * vol, 'square');
  }

  rifle(p: THREE.Vector3) {
    if (!this.throttle()) return;
    const o = this.out(p, 25);
    if (!o) return;
    this.noiseBurst(o, 0.08, 'highpass', 2200, 800, 0.35);
  }

  explosion(p: THREE.Vector3, size: number) {
    const o = this.out(p, 70);
    if (!o) return;
    this.noiseBurst(o, 1.6 * size, 'lowpass', 900, 50, 1.1);
    this.thump(o, 70, 25, 0.9, 1.2 * Math.min(1.5, size));
  }

  impact(p: THREE.Vector3, ricochet: boolean, pen = false) {
    const o = this.out(p, 45);
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
    const o = this.out(p, 300);
    if (!o) return;
    this.noiseBurst(o, 2.2, 'lowpass', 300, 40, 0.8);
  }
}
