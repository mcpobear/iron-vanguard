import * as THREE from 'three';
import { softParticle, puffParticle } from './textures';

export interface ParticleOpts {
  x: number; y: number; z: number;
  vx?: number; vy?: number; vz?: number;
  size: number; grow?: number;
  life: number;
  r: number; g: number; b: number; a: number;
  drag?: number; grav?: number;
  rot?: number; spin?: number;
}

/**
 * GPU billboard particles: one instanced draw call per system, no point-size limits
 * (needed for big smoke screens on mobile GPUs).
 */
export class ParticleSystem {
  mesh: THREE.Mesh;
  private max: number;
  private off: Float32Array;
  private col: Float32Array;
  private size: Float32Array;
  private rot: Float32Array;
  private vel: Float32Array;
  private life: Float32Array;
  private maxLife: Float32Array;
  private grow: Float32Array;
  private drag: Float32Array;
  private grav: Float32Array;
  private spin: Float32Array;
  private baseA: Float32Array;
  private cursor = 0;
  private geo: THREE.InstancedBufferGeometry;

  constructor(max: number, additive: boolean, tex: THREE.Texture, fogColor: THREE.Color) {
    this.max = max;
    const base = new THREE.PlaneGeometry(1, 1);
    const g = new THREE.InstancedBufferGeometry();
    g.index = base.index;
    g.setAttribute('position', base.getAttribute('position'));
    g.setAttribute('uv', base.getAttribute('uv'));
    this.off = new Float32Array(max * 3);
    this.col = new Float32Array(max * 4);
    this.size = new Float32Array(max);
    this.rot = new Float32Array(max);
    this.vel = new Float32Array(max * 3);
    this.life = new Float32Array(max);
    this.maxLife = new Float32Array(max).fill(1);
    this.grow = new Float32Array(max);
    this.drag = new Float32Array(max);
    this.grav = new Float32Array(max);
    this.spin = new Float32Array(max);
    this.baseA = new Float32Array(max);
    g.setAttribute('offset', new THREE.InstancedBufferAttribute(this.off, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('col', new THREE.InstancedBufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('psize', new THREE.InstancedBufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('prot', new THREE.InstancedBufferAttribute(this.rot, 1).setUsage(THREE.DynamicDrawUsage));
    g.instanceCount = max;
    this.geo = g;
    const mat = new THREE.ShaderMaterial({
      uniforms: { map: { value: tex }, fogColor: { value: fogColor }, fogNear: { value: 150 }, fogFar: { value: 600 } },
      vertexShader: `
        attribute vec3 offset; attribute vec4 col; attribute float psize; attribute float prot;
        varying vec2 vUv; varying vec4 vCol; varying float vDepth;
        void main(){
          vUv = uv; vCol = col;
          vec4 mv = modelViewMatrix * vec4(offset, 1.0);
          float c = cos(prot), s = sin(prot);
          vec2 p = vec2(c*position.x - s*position.y, s*position.x + c*position.y);
          mv.xy += p * psize;
          vDepth = -mv.z;
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: `
        uniform sampler2D map; uniform vec3 fogColor; uniform float fogNear; uniform float fogFar;
        varying vec2 vUv; varying vec4 vCol; varying float vDepth;
        void main(){
          vec4 t = texture2D(map, vUv);
          float a = t.a * vCol.a;
          if (a < 0.01) discard;
          float f = smoothstep(fogNear, fogFar, vDepth);
          gl_FragColor = vec4(mix(vCol.rgb * t.rgb, fogColor, f * ${additive ? '0.0' : '0.8'}), a * (1.0 - f * ${additive ? '0.9' : '0.2'}));
        }`,
      transparent: true,
      depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.mesh = new THREE.Mesh(g, mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = additive ? 3 : 2;
  }

  setFog(near: number, far: number) {
    const u = (this.mesh.material as THREE.ShaderMaterial).uniforms;
    u.fogNear.value = near;
    u.fogFar.value = far;
  }

  spawn(o: ParticleOpts) {
    const i = this.cursor;
    this.cursor = (this.cursor + 1) % this.max;
    this.off[i * 3] = o.x;
    this.off[i * 3 + 1] = o.y;
    this.off[i * 3 + 2] = o.z;
    this.vel[i * 3] = o.vx ?? 0;
    this.vel[i * 3 + 1] = o.vy ?? 0;
    this.vel[i * 3 + 2] = o.vz ?? 0;
    this.size[i] = o.size;
    this.grow[i] = o.grow ?? 0;
    this.life[i] = o.life;
    this.maxLife[i] = o.life;
    this.col[i * 4] = o.r;
    this.col[i * 4 + 1] = o.g;
    this.col[i * 4 + 2] = o.b;
    this.baseA[i] = o.a;
    this.col[i * 4 + 3] = o.a;
    this.drag[i] = o.drag ?? 0;
    this.grav[i] = o.grav ?? 0;
    this.rot[i] = o.rot ?? Math.random() * 6.28;
    this.spin[i] = o.spin ?? (Math.random() - 0.5) * 0.6;
  }

  update(dt: number) {
    for (let i = 0; i < this.max; i++) {
      if (this.life[i] <= 0) {
        if (this.size[i] !== 0) this.size[i] = 0;
        continue;
      }
      this.life[i] -= dt;
      const k = Math.max(0, 1 - this.drag[i] * dt);
      this.vel[i * 3] *= k;
      this.vel[i * 3 + 1] = this.vel[i * 3 + 1] * k - this.grav[i] * dt;
      this.vel[i * 3 + 2] *= k;
      this.off[i * 3] += this.vel[i * 3] * dt;
      this.off[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
      this.off[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      this.size[i] += this.grow[i] * dt;
      this.rot[i] += this.spin[i] * dt;
      const t = this.life[i] / this.maxLife[i]; // 1 → 0
      const fadeIn = Math.min(1, (1 - t) * 8);
      this.col[i * 4 + 3] = this.baseA[i] * Math.min(fadeIn, t * 1.6);
      if (this.life[i] <= 0) this.size[i] = 0;
    }
    for (const n of ['offset', 'col', 'psize', 'prot']) (this.geo.getAttribute(n) as THREE.BufferAttribute).needsUpdate = true;
  }
}

/** Short bright line segments for tracers and shells. */
export class Tracers {
  lines: THREE.LineSegments;
  private max: number;
  private pos: Float32Array;
  private col: Float32Array;
  private items: { ax: number; ay: number; az: number; vx: number; vy: number; vz: number; len: number; life: number; r: number; g: number; b: number }[] = [];
  constructor(max = 160) {
    this.max = max;
    this.pos = new Float32Array(max * 6);
    this.col = new Float32Array(max * 6);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('color', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    this.lines = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    this.lines.frustumCulled = false;
  }
  /** A tracer travelling from a toward b at speed. */
  add(ax: number, ay: number, az: number, bx: number, by: number, bz: number, speed: number, len: number, color: [number, number, number]) {
    if (this.items.length >= this.max) this.items.shift();
    const dx = bx - ax, dy = by - ay, dz = bz - az;
    const L = Math.hypot(dx, dy, dz) || 1;
    this.items.push({ ax, ay, az, vx: (dx / L) * speed, vy: (dy / L) * speed, vz: (dz / L) * speed, len, life: L / speed, r: color[0], g: color[1], b: color[2] });
  }
  update(dt: number) {
    let n = 0;
    this.items = this.items.filter((t) => (t.life -= dt) > -0.02);
    for (const t of this.items) {
      t.ax += t.vx * dt;
      t.ay += t.vy * dt;
      t.az += t.vz * dt;
      const sp = Math.hypot(t.vx, t.vy, t.vz) || 1;
      const k = t.len / sp;
      this.pos.set([t.ax, t.ay, t.az, t.ax - t.vx * k, t.ay - t.vy * k, t.az - t.vz * k], n * 6);
      this.col.set([t.r, t.g, t.b, t.r * 0.3, t.g * 0.2, t.b * 0.1], n * 6);
      n++;
    }
    this.lines.geometry.setDrawRange(0, n * 2);
    this.lines.geometry.getAttribute('position').needsUpdate = true;
    this.lines.geometry.getAttribute('color').needsUpdate = true;
  }
}

export class Effects {
  glow: ParticleSystem;
  smoke: ParticleSystem;
  tracers = new Tracers();
  group = new THREE.Group();
  constructor(public scale: number, fog: THREE.Color) {
    this.glow = new ParticleSystem(Math.floor(500 * scale) + 100, true, softParticle(), fog);
    this.smoke = new ParticleSystem(Math.floor(900 * scale) + 150, false, puffParticle(), fog);
    this.group.add(this.smoke.mesh, this.glow.mesh, this.tracers.lines);
  }
  update(dt: number) {
    this.glow.update(dt);
    this.smoke.update(dt);
    this.tracers.update(dt);
  }

  muzzleFlash(p: THREE.Vector3, dir: THREE.Vector3, big: boolean) {
    const s = big ? 1 : 0.4;
    for (let i = 0; i < (big ? 8 : 2); i++) {
      const v = 6 + Math.random() * 14;
      this.glow.spawn({ x: p.x, y: p.y, z: p.z, vx: dir.x * v + (Math.random() - 0.5) * 3, vy: dir.y * v + (Math.random() - 0.5) * 3, vz: dir.z * v + (Math.random() - 0.5) * 3, size: (1.4 + Math.random()) * s, grow: 2 * s, life: 0.12 + Math.random() * 0.08, r: 1, g: 0.75, b: 0.3, a: 1, drag: 6 });
    }
    if (big)
      for (let i = 0; i < Math.ceil(10 * this.scale); i++) {
        const v = 2 + Math.random() * 8;
        this.smoke.spawn({ x: p.x, y: p.y, z: p.z, vx: dir.x * v + (Math.random() - 0.5) * 2, vy: dir.y * v + Math.random() * 1.5, vz: dir.z * v + (Math.random() - 0.5) * 2, size: 1.2 + Math.random(), grow: 2.2, life: 1.6 + Math.random(), r: 0.82, g: 0.8, b: 0.76, a: 0.55, drag: 2 });
      }
  }

  explosion(p: THREE.Vector3, size: number, dark = false) {
    for (let i = 0; i < 14 * size; i++) {
      const a = Math.random() * 6.28, u = Math.random() * 0.8 + 0.2;
      const v = (4 + Math.random() * 9) * size;
      this.glow.spawn({ x: p.x, y: p.y + 0.5, z: p.z, vx: Math.cos(a) * v * (1 - u), vy: v * u, vz: Math.sin(a) * v * (1 - u), size: (1.2 + Math.random() * 1.5) * size, grow: 3 * size, life: 0.25 + Math.random() * 0.25, r: 1, g: 0.6 + Math.random() * 0.2, b: 0.2, a: 1, drag: 3 });
    }
    for (let i = 0; i < Math.ceil(16 * size * this.scale); i++) {
      const a = Math.random() * 6.28;
      const v = (1 + Math.random() * 5) * size;
      const c = dark ? 0.25 : 0.55 + Math.random() * 0.15;
      this.smoke.spawn({ x: p.x + (Math.random() - 0.5) * size, y: p.y + 0.5, z: p.z + (Math.random() - 0.5) * size, vx: Math.cos(a) * v, vy: 1.5 + Math.random() * 3 * size, vz: Math.sin(a) * v, size: (1.2 + Math.random()) * size, grow: 2.2 * size, life: 2.4 + Math.random() * 2, r: c, g: c * 0.95, b: c * 0.88, a: 0.75, drag: 1.4 });
    }
    // dirt debris
    for (let i = 0; i < 8 * size; i++) {
      const a = Math.random() * 6.28;
      this.smoke.spawn({ x: p.x, y: p.y + 0.3, z: p.z, vx: Math.cos(a) * 5 * size, vy: 6 + Math.random() * 8, vz: Math.sin(a) * 5 * size, size: 0.35 + Math.random() * 0.3, life: 1.1, r: 0.35, g: 0.28, b: 0.2, a: 1, grav: 18, spin: 4 });
    }
  }

  impactSparks(p: THREE.Vector3, ricochet: boolean) {
    for (let i = 0; i < (ricochet ? 12 : 6); i++) {
      this.glow.spawn({ x: p.x, y: p.y, z: p.z, vx: (Math.random() - 0.5) * 16, vy: Math.random() * 10, vz: (Math.random() - 0.5) * 16, size: 0.25 + Math.random() * 0.3, life: 0.25 + Math.random() * 0.25, r: 1, g: 0.85, b: 0.5, a: 1, grav: 14 });
    }
    this.smoke.spawn({ x: p.x, y: p.y, z: p.z, vy: 1, size: 1, grow: 2, life: 1, r: 0.6, g: 0.6, b: 0.6, a: 0.5 });
  }

  dirtPuff(p: THREE.Vector3, small = true) {
    const n = small ? 2 : 6;
    for (let i = 0; i < n; i++) this.smoke.spawn({ x: p.x, y: p.y + 0.2, z: p.z, vx: (Math.random() - 0.5) * 3, vy: 2 + Math.random() * 3, vz: (Math.random() - 0.5) * 3, size: small ? 0.4 : 1.2, grow: small ? 1 : 2, life: small ? 0.6 : 1.5, r: 0.55, g: 0.45, b: 0.32, a: 0.8, grav: small ? 4 : 1 });
  }

  dust(p: THREE.Vector3, amount: number) {
    if (Math.random() > amount * this.scale) return;
    this.smoke.spawn({ x: p.x + (Math.random() - 0.5) * 2, y: p.y + 0.4, z: p.z + (Math.random() - 0.5) * 2, vx: (Math.random() - 0.5) * 1.5, vy: 0.6 + Math.random(), vz: (Math.random() - 0.5) * 1.5, size: 1 + Math.random() * 0.8, grow: 2.2, life: 1.8 + Math.random(), r: 0.78, g: 0.68, b: 0.52, a: 0.45, drag: 0.8 });
  }

  /** One frame of a burning / smoking wreck. */
  fire(p: THREE.Vector3, intensity: number) {
    if (Math.random() < intensity) this.glow.spawn({ x: p.x + (Math.random() - 0.5) * 1.5, y: p.y, z: p.z + (Math.random() - 0.5) * 1.5, vy: 2 + Math.random() * 2, size: 0.8 + Math.random() * 0.8, grow: -0.6, life: 0.6 + Math.random() * 0.3, r: 1, g: 0.45 + Math.random() * 0.2, b: 0.1, a: 0.9 });
    if (Math.random() < intensity * 0.7 * this.scale) this.smoke.spawn({ x: p.x, y: p.y + 1, z: p.z, vx: 0.6, vy: 2.2 + Math.random(), vz: 0.2, size: 1.2, grow: 1.8, life: 4 + Math.random() * 2, r: 0.18, g: 0.17, b: 0.16, a: 0.6, drag: 0.2 });
  }

  /** Thick white smoke-screen puffs. Returns nothing; the gameplay cloud lives in CollisionWorld. */
  smokeScreen(p: THREE.Vector3) {
    for (let i = 0; i < Math.ceil(26 * Math.max(0.6, this.scale)); i++) {
      const a = Math.random() * 6.28, r = Math.random() * 4;
      this.smoke.spawn({ x: p.x + Math.cos(a) * r, y: p.y + 0.5 + Math.random() * 2, z: p.z + Math.sin(a) * r, vx: Math.cos(a) * (1 + Math.random() * 2.5) + 0.4, vy: 0.4 + Math.random() * 1.2, vz: Math.sin(a) * (1 + Math.random() * 2.5), size: 3 + Math.random() * 2, grow: 1.6, life: 22 + Math.random() * 8, r: 0.92, g: 0.92, b: 0.9, a: 0.9, drag: 0.35, spin: 0.15 });
    }
  }
  /** Keeps a smoke screen thick while it lasts. */
  smokeTick(x: number, y: number, z: number, r: number, strength: number) {
    if (Math.random() > strength * 0.5 * Math.max(0.6, this.scale)) return;
    const a = Math.random() * 6.28, d = Math.random() * r * 0.8;
    this.smoke.spawn({ x: x + Math.cos(a) * d, y: y + Math.random() * 3, z: z + Math.sin(a) * d, vx: 0.5, vy: 0.3, size: 4 + Math.random() * 2, grow: 1, life: 8, r: 0.93, g: 0.93, b: 0.91, a: 0.75 * strength, drag: 0.3, spin: 0.1 });
  }
}
