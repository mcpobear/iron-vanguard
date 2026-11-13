import * as THREE from 'three';
import type { MapDef, P } from '../missions/bellwickMap';

const RES = 2; // metres per height sample

function segDist(px: number, pz: number, a: P, b: P) {
  const dx = b[0] - a[0], dz = b[1] - a[1];
  const l2 = dx * dx + dz * dz || 1;
  let t = ((px - a[0]) * dx + (pz - a[1]) * dz) / l2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (a[0] + dx * t), pz - (a[1] + dz * t));
}

export function distToRoads(def: MapDef, x: number, z: number): { d: number; width: number } {
  let best = 1e9, w = 6;
  for (const r of def.roads)
    for (let i = 0; i < r.pts.length - 1; i++) {
      const d = segDist(x, z, r.pts[i], r.pts[i + 1]);
      if (d < best) {
        best = d;
        w = r.width;
      }
    }
  return { d: best, width: w };
}

const smooth = (e0: number, e1: number, x: number) => {
  const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

export class Terrain {
  n: number;
  h: Float32Array;
  surf: Uint8Array; // 0 field, 1 road, 2 stream
  constructor(public def: MapDef) {
    this.n = Math.floor((def.half * 2) / RES) + 1;
    this.h = new Float32Array(this.n * this.n);
    this.surf = new Uint8Array(this.n * this.n);
    const { town, bridge } = def;
    const low = (x: number, z: number) => 3.2 * Math.sin(x * 0.011 + 0.4) * Math.cos(z * 0.009) + 2.2 * Math.sin((x + z) * 0.006);
    const townLevel = low(town.x, town.z);
    for (let j = 0; j < this.n; j++)
      for (let i = 0; i < this.n; i++) {
        const x = -def.half + i * RES, z = -def.half + j * RES;
        const hi = 1.1 * Math.sin(x * 0.045 + 1.3) * Math.sin(z * 0.038) + 0.5 * Math.sin(x * 0.11) * Math.cos(z * 0.09);
        const road = distToRoads(def, x, z);
        const wRoad = 1 - smooth(road.width * 0.5, road.width * 0.5 + 10, road.d);
        let h = low(x, z) + hi * (1 - wRoad);
        const dt = Math.hypot(x - town.x, z - town.z);
        const wTown = 1 - smooth(town.r * 0.6, town.r, dt);
        h = h * (1 - wTown) + townLevel * wTown;
        // stream dip, suppressed under the bridge
        const sd = Math.abs(z - def.streamZ(x));
        const underBridge = Math.abs(x - bridge.x) < bridge.width * 0.5 + 1;
        if (!underBridge) h -= 1.6 * Math.exp(-(sd * sd) / 22);
        // raised edges keep the player inside the map
        const e = Math.max(Math.abs(x), Math.abs(z)) - (def.half - 70);
        if (e > 0) h += e * e * 0.012;
        this.h[j * this.n + i] = h;
        this.surf[j * this.n + i] = road.d < road.width * 0.5 + 0.5 ? 1 : sd < 3.2 && !underBridge ? 2 : 0;
      }
  }

  height = (x: number, z: number): number => {
    const fx = (x + this.def.half) / RES, fz = (z + this.def.half) / RES;
    const i = Math.max(0, Math.min(this.n - 2, Math.floor(fx)));
    const j = Math.max(0, Math.min(this.n - 2, Math.floor(fz)));
    const tx = Math.max(0, Math.min(1, fx - i)), tz = Math.max(0, Math.min(1, fz - j));
    const a = this.h[j * this.n + i], b = this.h[j * this.n + i + 1], c = this.h[(j + 1) * this.n + i], d = this.h[(j + 1) * this.n + i + 1];
    return a + (b - a) * tx + (c - a) * tz + (a - b - c + d) * tx * tz;
  };

  surface(x: number, z: number): number {
    const i = Math.round((x + this.def.half) / RES), j = Math.round((z + this.def.half) / RES);
    if (i < 0 || j < 0 || i >= this.n || j >= this.n) return 0;
    return this.surf[j * this.n + i];
  }

  buildMesh(): THREE.Mesh {
    const segs = 160;
    const size = this.def.half * 2;
    const g = new THREE.PlaneGeometry(size, size, segs, segs);
    g.rotateX(-Math.PI / 2);
    const p = g.getAttribute('position');
    const colors = new Float32Array(p.count * 3);
    const c = new THREE.Color();
    const fieldCol: Record<string, number[]> = {
      wheat: [0xd8c25a, 0xc9b04a],
      pasture: [0x7fbf4f, 0x74b346],
      plough: [0x8a6a44, 0x7a5c3a],
      meadow: [0x8cc45a, 0x9acb63],
    };
    for (let k = 0; k < p.count; k++) {
      const x = p.getX(k), z = p.getZ(k);
      const y = this.height(x, z);
      p.setY(k, y);
      const s = this.surface(x, z);
      const noise = (Math.sin(x * 0.7) * Math.cos(z * 0.6) + Math.sin(x * 0.13 + z * 0.17)) * 0.03;
      c.set(0x6db04a);
      const dt = Math.hypot(x - this.def.town.x, z - this.def.town.z);
      for (const f of this.def.fields) {
        if (x > f.minX && x < f.maxX && z > f.minZ && z < f.maxZ) {
          const stripe = Math.floor((f.kind === 'plough' ? z : x) / 3) % 2 === 0 ? 0 : 1;
          c.set(fieldCol[f.kind][stripe]);
        }
      }
      if (dt < this.def.town.r * 0.75) c.lerp(new THREE.Color(0x9a9a86), 0.55);
      const sq = this.def.square;
      if (x > sq.minX && x < sq.maxX && z > sq.minZ && z < sq.maxZ) c.set(0xb8ad94);
      if (s === 2) {
        const sd = Math.abs(z - this.def.streamZ(x));
        c.set(sd < 2 ? 0x5b8fb8 : 0x6a8a5a);
      }
      const edge = Math.max(Math.abs(x), Math.abs(z)) - (this.def.half - 70);
      if (edge > 0) c.lerp(new THREE.Color(0x4f8a3c), Math.min(1, edge / 30));
      c.offsetHSL(0, 0, noise);
      colors[k * 3] = c.r;
      colors[k * 3 + 1] = c.g;
      colors[k * 3 + 2] = c.b;
    }
    g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    g.computeVertexNormals();
    const m = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ vertexColors: true }));
    m.receiveShadow = true;
    return m;
  }

  /** Flat ribbons for roads, sampled along each polyline and draped on the terrain. */
  buildRoads(): THREE.Mesh {
    const pos: number[] = [], col: number[] = [];
    const c = new THREE.Color();
    for (const r of this.def.roads) {
      const pts: { x: number; z: number }[] = [];
      for (let i = 0; i < r.pts.length - 1; i++) {
        const [ax, az] = r.pts[i], [bx, bz] = r.pts[i + 1];
        const L = Math.hypot(bx - ax, bz - az);
        const n = Math.max(1, Math.ceil(L / 3));
        for (let k = 0; k < n; k++) pts.push({ x: ax + ((bx - ax) * k) / n, z: az + ((bz - az) * k) / n });
      }
      const last = r.pts[r.pts.length - 1];
      pts.push({ x: last[0], z: last[1] });
      for (let i = 0; i < pts.length - 1; i++) {
        const a = pts[i], b = pts[i + 1];
        const dx = b.x - a.x, dz = b.z - a.z;
        const L = Math.hypot(dx, dz) || 1;
        const nx = (-dz / L) * r.width * 0.5, nz = (dx / L) * r.width * 0.5;
        const quad = [
          [a.x - nx, a.z - nz], [a.x + nx, a.z + nz], [b.x + nx, b.z + nz],
          [a.x - nx, a.z - nz], [b.x + nx, b.z + nz], [b.x - nx, b.z - nz],
        ];
        c.set(r.main ? 0xc2ab84 : 0xb89c72);
        c.offsetHSL(0, 0, (Math.sin(i * 1.7) * 0.5) * 0.02);
        for (const [x, z] of quad) {
          pos.push(x, this.height(x, z) + 0.14, z);
          col.push(c.r, c.g, c.b);
        }
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.computeVertexNormals();
    const mat = new THREE.MeshLambertMaterial({ vertexColors: true, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, side: THREE.DoubleSide });
    const m = new THREE.Mesh(g, mat);
    m.receiveShadow = true;
    return m;
  }
}
