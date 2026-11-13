// Simplified collision & visibility world: axis-aligned boxes, circles, a height field and smoke.

export interface Box {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  y0: number;
  y1: number;
  blocksLOS: boolean;
  solid: boolean;
  kind: string;
}

export interface Circle {
  x: number;
  z: number;
  r: number;
  h: number;
}

export interface SmokeCloud {
  x: number;
  y: number;
  z: number;
  r: number;
  life: number;
  maxLife: number;
  ownerId: string | null;
}

const CELL = 16;

export class CollisionWorld {
  boxes: Box[] = [];
  circles: Circle[] = [];
  smoke: SmokeCloud[] = [];
  private grid = new Map<number, number[]>();
  private cgrid = new Map<number, number[]>();

  constructor(public height: (x: number, z: number) => number, public half = 320) {}

  private key(cx: number, cz: number) {
    return (cx + 1000) * 4096 + (cz + 1000);
  }

  addBox(b: Box) {
    const i = this.boxes.push(b) - 1;
    for (let cx = Math.floor(b.minX / CELL); cx <= Math.floor(b.maxX / CELL); cx++)
      for (let cz = Math.floor(b.minZ / CELL); cz <= Math.floor(b.maxZ / CELL); cz++) {
        const k = this.key(cx, cz);
        let a = this.grid.get(k);
        if (!a) this.grid.set(k, (a = []));
        a.push(i);
      }
  }

  addCircle(c: Circle) {
    const i = this.circles.push(c) - 1;
    const k = this.key(Math.floor(c.x / CELL), Math.floor(c.z / CELL));
    let a = this.cgrid.get(k);
    if (!a) this.cgrid.set(k, (a = []));
    a.push(i);
  }

  boxesNear(x: number, z: number, r: number, out: Set<number> = new Set()): Set<number> {
    for (let cx = Math.floor((x - r) / CELL); cx <= Math.floor((x + r) / CELL); cx++)
      for (let cz = Math.floor((z - r) / CELL); cz <= Math.floor((z + r) / CELL); cz++) {
        const a = this.grid.get(this.key(cx, cz));
        if (a) for (const i of a) out.add(i);
      }
    return out;
  }

  circlesNear(x: number, z: number, r: number): Circle[] {
    const out: Circle[] = [];
    for (let cx = Math.floor((x - r) / CELL); cx <= Math.floor((x + r) / CELL); cx++)
      for (let cz = Math.floor((z - r) / CELL); cz <= Math.floor((z + r) / CELL); cz++) {
        const a = this.cgrid.get(this.key(cx, cz));
        if (a) for (const i of a) out.push(this.circles[i]);
      }
    return out;
  }

  /** Push a circle (tank footprint) out of solid obstacles. Returns true if it collided. */
  resolveCircle(p: { x: number; z: number }, r: number): boolean {
    let hit = false;
    for (const i of this.boxesNear(p.x, p.z, r + 2)) {
      const b = this.boxes[i];
      if (!b.solid) continue;
      const cx = Math.max(b.minX, Math.min(p.x, b.maxX));
      const cz = Math.max(b.minZ, Math.min(p.z, b.maxZ));
      const dx = p.x - cx;
      const dz = p.z - cz;
      const d2 = dx * dx + dz * dz;
      if (d2 < r * r) {
        hit = true;
        if (d2 > 1e-6) {
          const d = Math.sqrt(d2);
          p.x = cx + (dx / d) * r;
          p.z = cz + (dz / d) * r;
        } else {
          // centre inside the box: push out along the shortest axis
          const l = p.x - b.minX, rr = b.maxX - p.x, t = p.z - b.minZ, bb = b.maxZ - p.z;
          const m = Math.min(l, rr, t, bb);
          if (m === l) p.x = b.minX - r;
          else if (m === rr) p.x = b.maxX + r;
          else if (m === t) p.z = b.minZ - r;
          else p.z = b.maxZ + r;
        }
      }
    }
    for (const c of this.circlesNear(p.x, p.z, r + 2)) {
      const dx = p.x - c.x;
      const dz = p.z - c.z;
      const rr = r + c.r;
      const d2 = dx * dx + dz * dz;
      if (d2 < rr * rr && d2 > 1e-6) {
        const d = Math.sqrt(d2);
        p.x = c.x + (dx / d) * rr;
        p.z = c.z + (dz / d) * rr;
        hit = true;
      }
    }
    const lim = this.half - 8;
    if (Math.abs(p.x) > lim || Math.abs(p.z) > lim) {
      p.x = Math.max(-lim, Math.min(lim, p.x));
      p.z = Math.max(-lim, Math.min(lim, p.z));
      hit = true;
    }
    return hit;
  }

  pointBlocked(x: number, z: number, r = 0): boolean {
    for (const i of this.boxesNear(x, z, r + 1)) {
      const b = this.boxes[i];
      if (b.solid && x > b.minX - r && x < b.maxX + r && z > b.minZ - r && z < b.maxZ + r) return true;
    }
    for (const c of this.circlesNear(x, z, r + 2)) if ((x - c.x) ** 2 + (z - c.z) ** 2 < (c.r + r) ** 2) return true;
    return Math.abs(x) > this.half - 10 || Math.abs(z) > this.half - 10;
  }

  /**
   * Segment vs boxes (3D slab test). Returns the nearest hit fraction t in [0,1] or -1.
   * Optionally reports the box and the axis-aligned normal.
   */
  segmentBoxes(ax: number, ay: number, az: number, bx: number, by: number, bz: number, losOnly = false, out?: { box?: Box; nx: number; ny: number; nz: number }): number {
    const dx = bx - ax, dy = by - ay, dz = bz - az;
    const len = Math.hypot(dx, dz);
    const seen = new Set<number>();
    const steps = Math.max(1, Math.ceil(len / CELL));
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      this.boxesNear(ax + dx * t, az + dz * t, CELL * 0.75, seen);
    }
    let best = -1;
    for (const i of seen) {
      const b = this.boxes[i];
      if (losOnly ? !b.blocksLOS : !b.solid) continue;
      let t0 = 0, t1 = 1;
      let nAxis = 0, nSign = 0;
      const slabs: [number, number, number, number][] = [
        [ax, dx, b.minX, b.maxX],
        [ay, dy, b.y0, b.y1],
        [az, dz, b.minZ, b.maxZ],
      ];
      let ok = true;
      for (let a = 0; a < 3; a++) {
        const [o, d, mn, mx] = slabs[a];
        if (Math.abs(d) < 1e-9) {
          if (o < mn || o > mx) {
            ok = false;
            break;
          }
          continue;
        }
        let ta = (mn - o) / d, tb = (mx - o) / d;
        let sign = -1;
        if (ta > tb) {
          [ta, tb] = [tb, ta];
          sign = 1;
        }
        if (ta > t0) {
          t0 = ta;
          nAxis = a;
          nSign = sign;
        }
        t1 = Math.min(t1, tb);
        if (t0 > t1) {
          ok = false;
          break;
        }
      }
      if (ok && (best < 0 || t0 < best)) {
        best = t0;
        if (out) {
          out.box = b;
          out.nx = nAxis === 0 ? nSign : 0;
          out.ny = nAxis === 1 ? nSign : 0;
          out.nz = nAxis === 2 ? nSign : 0;
        }
      }
    }
    return best;
  }

  /** First t where the segment dips below the terrain, or -1. */
  segmentTerrain(ax: number, ay: number, az: number, bx: number, by: number, bz: number, step = 3): number {
    const len = Math.hypot(bx - ax, by - ay, bz - az);
    const n = Math.max(2, Math.ceil(len / step));
    let prevT = 0;
    for (let i = 1; i <= n; i++) {
      const t = i / n;
      const x = ax + (bx - ax) * t, y = ay + (by - ay) * t, z = az + (bz - az) * t;
      if (y < this.height(x, z)) {
        // refine
        let lo = prevT, hi = t;
        for (let k = 0; k < 6; k++) {
          const m = (lo + hi) / 2;
          const mx = ax + (bx - ax) * m, my = ay + (by - ay) * m, mz = az + (bz - az) * m;
          if (my < this.height(mx, mz)) hi = m;
          else lo = m;
        }
        return hi;
      }
      prevT = t;
    }
    return -1;
  }

  /** Fraction of the segment's path obscured by smoke (0 clear .. 1 fully blocked). */
  smokeOcclusion(ax: number, ay: number, az: number, bx: number, by: number, bz: number): { amount: number; cloud: SmokeCloud | null } {
    let amount = 0;
    let cloud: SmokeCloud | null = null;
    const dx = bx - ax, dy = by - ay, dz = bz - az;
    const L2 = dx * dx + dy * dy + dz * dz;
    for (const s of this.smoke) {
      const fade = Math.min(1, s.life / 6) * Math.min(1, (s.maxLife - s.life) / 2.5 + 0.2);
      if (fade <= 0.05) continue;
      let t = ((s.x - ax) * dx + (s.y - ay) * dy + (s.z - az) * dz) / (L2 || 1);
      t = Math.max(0, Math.min(1, t));
      const px = ax + dx * t - s.x, py = ay + dy * t - s.y, pz = az + dz * t - s.z;
      const d = Math.sqrt(px * px + py * py + pz * pz);
      if (d < s.r) {
        const thick = (1 - d / s.r) * 1.6 * fade;
        if (thick > amount) cloud = s;
        amount += thick;
      }
    }
    return { amount: Math.min(1, amount), cloud };
  }

  /** Line of sight between two eye points: blocked by buildings, hedges, terrain and dense smoke. */
  lineOfSight(ax: number, ay: number, az: number, bx: number, by: number, bz: number, smokeThreshold = 0.6): boolean {
    if (this.segmentBoxes(ax, ay, az, bx, by, bz, true) >= 0) return false;
    if (this.segmentTerrain(ax, ay, az, bx, by, bz, 8) >= 0) return false;
    if (this.smokeOcclusion(ax, ay, az, bx, by, bz).amount >= smokeThreshold) return false;
    return true;
  }

  updateSmoke(dt: number) {
    for (const s of this.smoke) {
      s.life -= dt;
      if (s.r < 13) s.r += dt * 2.2;
      s.x += dt * 0.5; // light breeze
    }
    this.smoke = this.smoke.filter((s) => s.life > 0);
  }
}
