import * as THREE from 'three';
import { GeoBuilder, VC_MATERIAL } from '../rendering/geo';
import { CollisionWorld } from './collision';
import { Terrain, distToRoads } from './terrain';
import type { MapDef, P } from '../missions/bellwickMap';
import { makeRng } from '../core/rng';
import { flagTexture } from '../rendering/textures';

const WALLS = [0xefe6d2, 0xe8d6b0, 0xd9c49a, 0xc98f6a, 0xf2efe6, 0xd6b98c];
const ROOFS = [0xb5523a, 0xa4462f, 0x6b6f78, 0x8a4a33, 0xc0643f];

export interface Tree {
  x: number;
  z: number;
  r: number;
  scale: number;
  felled: boolean;
  index: number;
  big: boolean;
}

export class World {
  terrain: Terrain;
  col: CollisionWorld;
  group = new THREE.Group();
  trees: Tree[] = [];
  private treeGrid = new Map<number, Tree[]>();
  private trunks!: THREE.InstancedMesh;
  private canopies!: THREE.InstancedMesh;
  flag!: THREE.Mesh;
  flagHeight = 0;
  private rng = makeRng(1944);

  constructor(public def: MapDef, treeDensity = 1) {
    this.terrain = new Terrain(def);
    this.col = new CollisionWorld(this.terrain.height, def.half);
    this.group.add(this.terrain.buildMesh());
    this.group.add(this.terrain.buildRoads());
    const gb = new GeoBuilder();
    this.buildTown(gb);
    this.buildFarms(gb);
    this.buildLines(gb);
    this.buildBridge(gb);
    this.buildMisc(gb);
    const mesh = new THREE.Mesh(gb.build(), VC_MATERIAL());
    mesh.castShadow = false;
    mesh.receiveShadow = true;
    this.group.add(mesh);
    this.buildTrees(treeDensity);
    this.buildFlag();
    this.buildWater();
  }

  h = (x: number, z: number) => this.terrain.height(x, z);

  private nearRoad(x: number, z: number, pad: number) {
    const r = distToRoads(this.def, x, z);
    return r.d < r.width * 0.5 + pad;
  }

  addSolid(minX: number, maxX: number, minZ: number, maxZ: number, y0: number, y1: number, blocksLOS: boolean, kind: string) {
    this.col.addBox({ minX, maxX, minZ, maxZ, y0, y1, blocksLOS, solid: true, kind });
  }

  house(gb: GeoBuilder, x: number, z: number, w: number, d: number, h: number, rot: number, ruined = false) {
    const rng = this.rng;
    const base = Math.min(this.h(x - w / 2, z - d / 2), this.h(x + w / 2, z + d / 2), this.h(x, z)) - 0.5;
    const wall = WALLS[Math.floor(rng() * WALLS.length)];
    const roof = ROOFS[Math.floor(rng() * ROOFS.length)];
    const cos = Math.cos(rot), sin = Math.sin(rot);
    const L = (lx: number, lz: number): [number, number] => [x + lx * cos + lz * sin, z - lx * sin + lz * cos];
    const hh = ruined ? h * (0.45 + rng() * 0.25) : h;
    gb.box(x, base + hh / 2, z, w, hh + 0.5, d, wall, rot, 0.06);
    // foundation / trim
    gb.box(x, base + 0.4, z, w + 0.3, 0.8, d + 0.3, 0x8d8a80, rot);
    if (!ruined) {
      const ridgeAlongZ = d >= w;
      gb.roof(x, base + h + 0.25, z, (ridgeAlongZ ? w : d) + 0.9, Math.min(w, d) * 0.45, (ridgeAlongZ ? d : w) + 0.9, roof, rot + (ridgeAlongZ ? 0 : Math.PI / 2), 0.05);
      // chimney
      const [cx, cz] = L(w * 0.25, d * 0.2);
      gb.box(cx, base + h + Math.min(w, d) * 0.4, cz, 0.9, 2.2, 0.9, 0x8a5a4a, rot);
    } else {
      for (let i = 0; i < 6; i++) {
        const [rx, rz] = L((rng() - 0.5) * w, (rng() - 0.5) * d);
        gb.box(rx, base + 0.6 + rng() * 0.6, rz, 1 + rng() * 2, 0.8 + rng(), 1 + rng() * 2, rng() < 0.5 ? wall : 0x8d8a80, rng() * 3, 0.1);
      }
    }
    // windows & doors on the four faces
    const floors = Math.max(1, Math.floor(hh / 3.2));
    for (const [fx, fz, len, ang] of [
      [0, d / 2 + 0.03, w, 0],
      [0, -d / 2 - 0.03, w, 0],
      [w / 2 + 0.03, 0, d, Math.PI / 2],
      [-w / 2 - 0.03, 0, d, Math.PI / 2],
    ] as [number, number, number, number][]) {
      const nwin = Math.max(1, Math.floor(len / 3));
      for (let f = 0; f < floors; f++)
        for (let k = 0; k < nwin; k++) {
          const off = (k - (nwin - 1) / 2) * (len / nwin);
          const lx = ang === 0 ? off : fx, lz = ang === 0 ? fz : off;
          const [wx, wz] = L(lx, lz);
          const isDoor = f === 0 && k === Math.floor(nwin / 2) && fz > 0;
          gb.box(wx, base + 1.0 + f * 3 + (isDoor ? 0.45 : 1.1), wz, isDoor ? 1.3 : 1.1, isDoor ? 2.1 : 1.3, 0.12, isDoor ? 0x5a3a24 : 0x34495e, rot + ang);
          if (!isDoor && !ruined) gb.box(wx, base + 0.95 + f * 3 + 0.45, wz, 1.4, 0.15, 0.25, 0xf4f1ea, rot + ang);
        }
    }
    // collision AABB of rotated footprint
    const ex = Math.abs(cos) * w / 2 + Math.abs(sin) * d / 2;
    const ez = Math.abs(sin) * w / 2 + Math.abs(cos) * d / 2;
    this.addSolid(x - ex, x + ex, z - ez, z + ez, base - 2, base + hh + (ruined ? 0 : Math.min(w, d) * 0.45), true, ruined ? 'ruin' : 'building');
  }

  private buildTown(gb: GeoBuilder) {
    const { townPlots: tp, square: sq, church } = this.def;
    const rng = this.rng;
    // Church: nave, tower, spire.
    const cb = this.h(church.x, church.z) - 0.5;
    gb.box(church.x, cb + 5, church.z + 8, 12, 10, 22, 0xd8d0bc, 0, 0.03);
    gb.roof(church.x, cb + 10, church.z + 8, 12.8, 5.5, 23, 0x6b6f78);
    gb.box(church.x, cb + 9, church.z - 6, 6, 18, 6, 0xcfc6b0);
    gb.cone(church.x, cb + 22, church.z - 6, 4.4, 8, 0x5c6470, 4);
    gb.box(church.x, cb + 13, church.z - 9.05, 1.6, 2.6, 0.2, 0x2c3e50);
    gb.box(church.x, cb + 2.2, church.z - 9.05, 2.2, 4, 0.2, 0x5a3a24);
    for (let i = 0; i < 4; i++) gb.box(church.x + 6.05, cb + 5.5, church.z + i * 5, 0.2, 3.4, 1.2, 0x5a7ab0);
    this.addSolid(church.x - 6, church.x + 6, church.z - 3, church.z + 19, cb, cb + 15, true, 'church');
    this.addSolid(church.x - 3, church.x + 3, church.z - 9, church.z - 3, cb, cb + 30, true, 'church');

    // Plots: a loose grid of houses that respects streets, the square and key areas.
    for (let z = tp.minZ; z < tp.maxZ; z += 15) {
      for (let x = tp.minX; x < tp.maxX; x += 14) {
        const w = 8 + rng() * 4, d = 8 + rng() * 4;
        const cx = x + 7 + (rng() - 0.5) * 2, cz = z + 7 + (rng() - 0.5) * 2;
        const dtc = Math.hypot(cx - this.def.town.x, cz - this.def.town.z);
        if (dtc > this.def.town.r) continue;
        if (cx > sq.minX - 9 && cx < sq.maxX + 9 && cz > sq.minZ - 9 && cz < sq.maxZ + 9) continue;
        if (Math.abs(cx - church.x) < 15 && cz > church.z - 16 && cz < church.z + 26) continue;
        if (this.nearRoad(cx, cz, Math.max(w, d) * 0.72 + 2)) continue;
        if (this.def.noBuild.some((n) => Math.hypot(cx - n.x, cz - n.z) < n.r)) continue;
        if (rng() < 0.12) continue;
        this.house(gb, cx, cz, w, d, 5.5 + rng() * 4.5, 0, rng() < 0.18);
      }
    }
    for (const v of this.def.villageHouses) this.house(gb, v.x, v.z, 8, 9, 6, v.rot);
    // square paving border and fountain-less centre plinth
    const sh = this.h(0, 140);
    gb.box(0, sh + 0.25, 140, 6, 0.5, 6, 0x9a9384);
  }

  private buildFarms(gb: GeoBuilder) {
    for (const f of this.def.farmhouses) {
      this.house(gb, f.x, f.z, 10, 8, 6, f.rot);
      if (f.barn) {
        const bx = f.x - Math.cos(f.rot) * 14, bz = f.z + Math.sin(f.rot) * 14 + 6;
        const b = this.h(bx, bz) - 0.4;
        gb.box(bx, b + 3.2, bz, 9, 6.4, 13, 0x9a3b2a, f.rot, 0.05);
        gb.roof(bx, b + 6.4, bz, 9.8, 3.5, 13.6, 0x5a4a3a, f.rot);
        gb.box(bx + Math.sin(f.rot) * 0, b + 2, bz + 6.55, 4, 4, 0.2, 0x5a3a24, f.rot);
        this.addSolid(bx - 6.5, bx + 6.5, bz - 7.5, bz + 7.5, b, b + 9, true, 'barn');
        // haystacks
        for (let i = 0; i < 3; i++) {
          const hx = f.x + 10 + i * 4, hz = f.z - 10;
          gb.cylinder(hx, this.h(hx, hz) + 1.1, hz, 1.6, 2.2, 0xdcc260, 7);
        }
      }
    }
  }

  /** Hedgerows and stone walls, split automatically where roads cross them. */
  private lineObstacles(gb: GeoBuilder, lines: P[][], hedge: boolean) {
    for (const line of lines) {
      for (let s = 0; s < line.length - 1; s++) {
        const [ax, az] = line[s], [bx, bz] = line[s + 1];
        const L = Math.hypot(bx - ax, bz - az);
        const n = Math.ceil(L / 2);
        let runStart = -1;
        const flush = (i0: number, i1: number) => {
          if (i1 <= i0) return;
          const t0 = i0 / n, t1 = i1 / n;
          const x0 = ax + (bx - ax) * t0, z0 = az + (bz - az) * t0, x1 = ax + (bx - ax) * t1, z1 = az + (bz - az) * t1;
          const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
          const len = Math.hypot(x1 - x0, z1 - z0);
          const rot = Math.atan2(x1 - x0, z1 - z0);
          const hgt = hedge ? 2.6 : 1.15;
          const thick = hedge ? 1.8 : 0.7;
          // drape: split long runs in 6 m pieces so they follow the ground
          const pieces = Math.max(1, Math.ceil(len / 6));
          for (let p = 0; p < pieces; p++) {
            const tt = (p + 0.5) / pieces;
            const px = x0 + (x1 - x0) * tt, pz = z0 + (z1 - z0) * tt;
            const y = this.h(px, pz);
            if (hedge) {
              gb.box(px, y + hgt / 2, pz, thick, hgt, len / pieces + 0.4, 0x3f7f32, rot, 0.12);
              gb.sphere(px + (this.rng() - 0.5), y + hgt, pz + (this.rng() - 0.5), 1.1, 0x4a8c3a, 0, 0.6, 0.15);
            } else {
              gb.box(px, y + hgt / 2, pz, thick, hgt, len / pieces + 0.1, 0x9b978c, rot, 0.08);
            }
          }
          const ex = Math.abs(Math.cos(rot)) * thick / 2 + Math.abs(Math.sin(rot)) * len / 2;
          const ez = Math.abs(Math.sin(rot)) * thick / 2 + Math.abs(Math.cos(rot)) * len / 2;
          const y = this.h(cx, cz);
          this.col.addBox({ minX: cx - ex, maxX: cx + ex, minZ: cz - ez, maxZ: cz + ez, y0: y - 3, y1: y + hgt, blocksLOS: hedge, solid: true, kind: hedge ? 'hedge' : 'wall' });
        };
        for (let i = 0; i <= n; i++) {
          const t = i / n;
          const x = ax + (bx - ax) * t, z = az + (bz - az) * t;
          const blocked = this.nearRoad(x, z, 3.5);
          if (!blocked && runStart < 0) runStart = i;
          if ((blocked || i === n) && runStart >= 0) {
            flush(runStart, blocked ? i - 1 : i);
            runStart = -1;
          }
        }
      }
    }
  }

  private buildLines(gb: GeoBuilder) {
    this.lineObstacles(gb, this.def.hedges, true);
    this.lineObstacles(gb, this.def.walls, false);
  }

  private buildBridge(gb: GeoBuilder) {
    const b = this.def.bridge;
    const y = this.h(b.x, b.z);
    gb.box(b.x, y - 0.25, b.z, b.width, 0.6, b.len, 0x8f8a7e);
    for (const sx of [-1, 1]) {
      gb.box(b.x + sx * (b.width / 2 + 0.3), y + 0.55, b.z, 0.6, 1.0, b.len, 0x7d786c);
      // low railings are visual only: a tank must never get wedged on the bridge
    }
    gb.box(b.x, y - 1.6, b.z, b.width - 1, 2.2, 3, 0x7d786c);
    gb.box(b.x, y - 1.1, b.z - b.len / 2 - 1, b.width, 1.4, 2.4, 0x8f8a7e, 0, 0, 0.35);
    gb.box(b.x, y - 1.1, b.z + b.len / 2 + 1, b.width, 1.4, 2.4, 0x8f8a7e, 0, 0, -0.35);
  }

  private buildMisc(gb: GeoBuilder) {
    const rng = this.rng;
    for (const [x, z] of this.def.rubble) {
      for (let i = 0; i < 7; i++) {
        const rx = x + (rng() - 0.5) * 6, rz = z + (rng() - 0.5) * 6;
        gb.box(rx, this.h(rx, rz) + 0.3, rz, 0.8 + rng() * 1.6, 0.5 + rng() * 0.9, 0.8 + rng() * 1.6, rng() < 0.5 ? 0xc9bfa8 : 0x8d8a80, rng() * 3, 0.1, rng() * 0.4);
      }
      this.col.addBox({ minX: x - 2, maxX: x + 2, minZ: z - 2, maxZ: z + 2, y0: -10, y1: this.h(x, z) + 1, blocksLOS: false, solid: true, kind: 'rubble' });
    }
    for (const b of this.def.barricades) {
      const n = Math.ceil(b.len / 1.2);
      for (let i = 0; i < n; i++) {
        const t = (i / (n - 1) - 0.5) * b.len;
        const x = b.x + Math.cos(b.rot) * t, z = b.z - Math.sin(b.rot) * t;
        const y = this.h(x, z);
        gb.box(x, y + 0.35, z, 1.3, 0.7, 0.9, 0xb8a37a, b.rot, 0.1);
        gb.box(x + 0.3, y + 1.0, z, 1.2, 0.6, 0.8, 0xa8936a, b.rot, 0.1);
      }
      const ex = Math.abs(Math.cos(b.rot)) * b.len / 2 + 0.6, ez = Math.abs(Math.sin(b.rot)) * b.len / 2 + 0.6;
      const y = this.h(b.x, b.z);
      this.col.addBox({ minX: b.x - ex, maxX: b.x + ex, minZ: b.z - ez, maxZ: b.z + ez, y0: y - 2, y1: y + 1.3, blocksLOS: false, solid: true, kind: 'barricade' });
    }
    // telegraph poles along the main road
    for (let z = -280; z < 80; z += 34) {
      const x = 9, y = this.h(x, z);
      gb.box(x, y + 4, z, 0.3, 8, 0.3, 0x6b4f35);
      gb.box(x, y + 7.4, z, 2, 0.2, 0.2, 0x6b4f35);
    }
  }

  private buildTrees(density: number) {
    const rng = this.rng;
    const add = (x: number, z: number, big: boolean) => {
      if (this.nearRoad(x, z, 2.5) || this.col.pointBlocked(x, z, 1.5)) return;
      const t: Tree = { x, z, r: big ? 1 : 0.6, scale: (big ? 1.5 : 0.85) * (0.8 + rng() * 0.4), felled: false, index: this.trees.length, big };
      this.trees.push(t);
      const k = this.tkey(x, z);
      let a = this.treeGrid.get(k);
      if (!a) this.treeGrid.set(k, (a = []));
      a.push(t);
    };
    for (const o of this.def.orchards)
      for (let x = o.minX; x <= o.maxX; x += o.spacing)
        for (let z = o.minZ; z <= o.maxZ; z += o.spacing) if (rng() < 0.92 * Math.max(0.6, density)) add(x + (rng() - 0.5) * 1.5, z + (rng() - 0.5) * 1.5, false);
    for (const w of this.def.woods)
      for (let i = 0; i < w.n * density; i++) {
        const a = rng() * Math.PI * 2, r = Math.sqrt(rng()) * w.r;
        add(w.x + Math.cos(a) * r, w.z + Math.sin(a) * r, true);
      }
    // map-edge forest band hides the world boundary
    const H = this.def.half;
    for (let i = 0; i < 260 * density; i++) {
      const side = Math.floor(rng() * 4);
      const along = (rng() - 0.5) * 2 * H;
      const depth = H - 20 - rng() * 55;
      const [x, z] = side === 0 ? [along, depth] : side === 1 ? [along, -depth] : side === 2 ? [depth, along] : [-depth, along];
      add(x, z, true);
    }
    // scattered trees along hedges
    for (const line of this.def.hedges) {
      const [a, b] = line;
      for (let t = 0.1; t < 1; t += 0.22) if (rng() < 0.6 * density) add(a[0] + (b[0] - a[0]) * t + 2.5, a[1] + (b[1] - a[1]) * t + 2.5, true);
    }
    const n = this.trees.length;
    const trunkG = new THREE.CylinderGeometry(0.22, 0.32, 2.4, 5);
    trunkG.translate(0, 1.2, 0);
    const canG = new THREE.IcosahedronGeometry(1.7, 0);
    canG.translate(0, 3.6, 0);
    this.trunks = new THREE.InstancedMesh(trunkG, new THREE.MeshLambertMaterial({ color: 0x6b4a2f, flatShading: true }), n);
    this.canopies = new THREE.InstancedMesh(canG, new THREE.MeshLambertMaterial({ color: 0xffffff, flatShading: true }), n);
    const c = new THREE.Color();
    for (const t of this.trees) {
      this.setTreeMatrix(t, 0, 0);
      c.set(t.big ? [0x3f8a3a, 0x4c9a3c, 0x367a34][t.index % 3] : [0x5fae45, 0x6bbb4a, 0x58a440][t.index % 3]);
      this.canopies.setColorAt(t.index, c);
    }
    this.canopies.instanceColor!.needsUpdate = true;
    this.trunks.castShadow = this.canopies.castShadow = false;
    this.group.add(this.trunks, this.canopies);
  }

  private tkey(x: number, z: number) {
    return Math.floor(x / 12) * 10000 + Math.floor(z / 12);
  }

  private m4 = new THREE.Matrix4();
  private setTreeMatrix(t: Tree, tiltX: number, tiltZ: number) {
    const y = this.h(t.x, t.z) - 0.1;
    this.m4.makeRotationFromEuler(new THREE.Euler(tiltX, t.index * 1.3, tiltZ));
    this.m4.scale(new THREE.Vector3(t.scale, t.scale * (t.big ? 1.3 : 0.9), t.scale));
    this.m4.setPosition(t.x, y, t.z);
    this.trunks.setMatrixAt(t.index, this.m4);
    this.canopies.setMatrixAt(t.index, this.m4);
  }

  /** Tanks push through and flatten trees (no hard collision, avoids AI getting stuck). */
  crushTrees(x: number, z: number, r: number, hx: number, hz: number): number {
    let n = 0;
    for (let dx = -1; dx <= 1; dx++)
      for (let dz = -1; dz <= 1; dz++) {
        const a = this.treeGrid.get(this.tkey(x + dx * 12, z + dz * 12));
        if (!a) continue;
        for (const t of a) {
          if (t.felled) continue;
          if ((t.x - x) ** 2 + (t.z - z) ** 2 < (r + t.r) ** 2) {
            t.felled = true;
            this.setTreeMatrix(t, hz * 1.35, -hx * 1.35);
            n++;
          }
        }
      }
    if (n) {
      this.trunks.instanceMatrix.needsUpdate = true;
      this.canopies.instanceMatrix.needsUpdate = true;
    }
    return n;
  }

  /** How much foliage lies between two points (used to reduce spotting through orchards). */
  foliageBetween(ax: number, az: number, bx: number, bz: number): number {
    const L = Math.hypot(bx - ax, bz - az);
    const n = Math.ceil(L / 6);
    let c = 0;
    for (let i = 1; i < n; i++) {
      const x = ax + ((bx - ax) * i) / n, z = az + ((bz - az) * i) / n;
      const a = this.treeGrid.get(this.tkey(x, z));
      if (a) for (const t of a) if (!t.felled && (t.x - x) ** 2 + (t.z - z) ** 2 < 9) c++;
    }
    return c;
  }

  private buildFlag() {
    const { x, z } = { x: 0, z: 140 };
    const y = this.h(x, z);
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.12, 12, 6), new THREE.MeshLambertMaterial({ color: 0xdddddd }));
    pole.position.set(x, y + 6.5, z);
    this.group.add(pole);
    const g = new THREE.PlaneGeometry(3.2, 2, 8, 1);
    g.translate(1.6, 0, 0);
    this.flag = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ map: flagTexture('alderland'), side: THREE.DoubleSide }));
    this.flag.position.set(x + 0.1, y + 1.6, z);
    this.flag.visible = false;
    this.group.add(this.flag);
    this.flagBase = y;
  }
  flagBase = 0;

  /** Raise from 0..1; also animates the cloth. */
  updateFlag(t: number, time: number) {
    this.flag.visible = t > 0;
    this.flag.position.y = this.flagBase + 1.8 + t * 9.6;
    const p = this.flag.geometry.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i);
      p.setZ(i, Math.sin(x * 2 - time * 5) * 0.18 * (x / 3.2));
    }
    p.needsUpdate = true;
  }

  private buildWater() {
    const pos: number[] = [];
    for (let x = -this.def.half; x < this.def.half; x += 4) {
      const z0 = this.def.streamZ(x), z1 = this.def.streamZ(x + 4);
      const w = 2.4;
      if (Math.abs(x + 2 - this.def.bridge.x) < this.def.bridge.width / 2 + 2) continue;
      const y = -0.5 + Math.min(this.h(x, z0), this.h(x + 4, z1)) * 0 + Math.min(this.h(x, z0 + 4), this.h(x, z0 - 4)) - 0.55;
      pos.push(x, y, z0 - w, x, y, z0 + w, x + 4, y, z1 + w, x, y, z0 - w, x + 4, y, z1 + w, x + 4, y, z1 - w);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.computeVertexNormals();
    const m = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ color: 0x5fa0d0, transparent: true, opacity: 0.8, side: THREE.DoubleSide }));
    this.group.add(m);
  }
}
