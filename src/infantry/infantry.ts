import * as THREE from 'three';
import { soldierGeometry, mgNestGeometry } from '../rendering/models';
import type { Game } from '../game/game';
import type { Side } from '../vehicles/tank';

export interface XZ {
  x: number;
  z: number;
}

const geoCache: Partial<Record<Side, THREE.BufferGeometry>> = {};
let soldierMat: THREE.MeshLambertMaterial | null = null;

export class Soldier {
  pos = new THREE.Vector3();
  heading = 0;
  alive = true;
  wounded = false;
  state: 'idle' | 'move' | 'pinned' | 'down' = 'idle';
  offset: XZ;
  fireCd = Math.random() * 2;
  deathT = 0;
  mesh: THREE.Mesh;
  pinnedT = 0;
  constructor(public side: Side, public squad: Squad, idx: number) {
    if (!geoCache[side]) geoCache[side] = soldierGeometry(side);
    if (!soldierMat) soldierMat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
    this.mesh = new THREE.Mesh(geoCache[side]!, soldierMat);
    const row = Math.floor(idx / 4), col = idx % 4;
    this.offset = { x: (col - 1.5) * 3.2 + (Math.random() - 0.5), z: -row * 3.5 + (Math.random() - 0.5) };
  }
  get active() {
    return this.alive && !this.wounded;
  }
}

export class Squad {
  soldiers: Soldier[] = [];
  path: XZ[] = [];
  pathIdx = 0;
  goal: XZ;
  heading = 0;
  sprint = false;
  holdFire = false;
  fleeing = false;
  arrived = true;
  active = true;
  constructor(public side: Side, public name: string, x: number, z: number) {
    this.goal = { x, z };
  }
  alive() {
    return this.soldiers.filter((s) => s.active);
  }
  centre(): XZ {
    const a = this.alive();
    if (!a.length) return this.goal;
    return { x: a.reduce((s, v) => s + v.pos.x, 0) / a.length, z: a.reduce((s, v) => s + v.pos.z, 0) / a.length };
  }
  pinnedFraction() {
    const a = this.alive();
    return a.length ? a.filter((s) => s.state === 'pinned').length / a.length : 0;
  }
}

export class MGNest {
  pos = new THREE.Vector3();
  hp = 100;
  alive = true;
  suppressed = 0;
  fireCd = 0;
  burst = 0;
  active = false;
  mesh: THREE.Mesh;
  heading: number;
  target: Soldier | null = null;
  constructor(public name: string, x: number, z: number, heading: number, g: Game) {
    this.mesh = new THREE.Mesh(mgNestGeometry(), new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }));
    this.pos.set(x, g.world.h(x, z), z);
    this.heading = heading;
    this.mesh.position.copy(this.pos);
    this.mesh.rotation.y = heading;
    g.scene.add(this.mesh);
  }
}

export class Infantry {
  squads: Squad[] = [];
  soldiers: Soldier[] = [];
  nests: MGNest[] = [];
  constructor(private g: Game) {}

  spawnSquad(side: Side, name: string, x: number, z: number, count: number, heading = 0): Squad {
    const sq = new Squad(side, name, x, z);
    sq.heading = heading;
    for (let i = 0; i < count; i++) {
      const s = new Soldier(side, sq, i);
      const o = this.rot(s.offset, heading);
      s.pos.set(x + o.x, 0, z + o.z);
      s.pos.y = this.g.world.h(s.pos.x, s.pos.z);
      s.heading = heading;
      sq.soldiers.push(s);
      this.soldiers.push(s);
      this.g.scene.add(s.mesh);
    }
    this.squads.push(sq);
    return sq;
  }

  addNest(name: string, x: number, z: number, heading: number) {
    const n = new MGNest(name, x, z, heading, this.g);
    this.nests.push(n);
    return n;
  }

  order(sq: Squad, path: XZ[], sprint = false) {
    sq.path = path;
    sq.pathIdx = 0;
    sq.sprint = sprint;
    sq.arrived = false;
    if (path.length) sq.goal = path[0];
  }

  private rot(o: XZ, h: number): XZ {
    const c = Math.cos(h), s = Math.sin(h);
    return { x: o.x * c + o.z * s, z: -o.x * s + o.z * c };
  }

  alliesNear(x: number, z: number, r: number) {
    return this.soldiers.some((s) => s.side === 'ally' && s.active && (s.pos.x - x) ** 2 + (s.pos.z - z) ** 2 < r * r);
  }

  /** Is this soldier currently under effective fire from an MG nest or the scripted strongpoint? */
  private underFire(s: Soldier): boolean {
    const g = this.g;
    for (const n of this.nests) {
      if (!n.alive || !n.active || n.suppressed > 0) continue;
      if (s.pos.distanceTo(n.pos) > 135) continue;
      if (g.world.col.lineOfSight(n.pos.x, n.pos.y + 1, n.pos.z, s.pos.x, s.pos.y + 1, s.pos.z, 0.5)) return true;
    }
    return g.mission?.pinsInfantry(s) ?? false;
  }

  killSoldier(s: Soldier, killerCmdr: string | null) {
    if (!s.active) return;
    if (s.side === 'ally') {
      s.wounded = true; // airborne casualties are evacuated by medics
    } else {
      s.alive = false;
      const near = this.alliesNear(s.pos.x, s.pos.z, 45);
      this.g.tracker.infantryKilled(killerCmdr, near);
    }
    s.state = 'down';
    s.deathT = 0;
  }

  update(dt: number) {
    const g = this.g;
    for (const sq of this.squads) {
      if (!sq.active) continue;
      // advance along path when the squad's alive members reach the waypoint
      if (!sq.arrived && sq.path.length) {
        const c = sq.centre();
        const wp = sq.path[sq.pathIdx];
        if (Math.hypot(c.x - wp.x, c.z - wp.z) < 5) {
          if (sq.pathIdx < sq.path.length - 1) {
            sq.pathIdx++;
            const nwp = sq.path[sq.pathIdx];
            sq.heading = Math.atan2(nwp.x - wp.x, nwp.z - wp.z);
          } else sq.arrived = true;
        }
        sq.goal = sq.path[sq.pathIdx];
        if (sq.pathIdx === 0) sq.heading = Math.atan2(wp.x - c.x, wp.z - c.z);
      }
    }
    for (const n of this.nests) {
      if (!n.alive) continue;
      if (n.suppressed > 0) n.suppressed -= dt;
      if (!n.active || n.suppressed > 0) continue;
      n.fireCd -= dt;
      if (n.fireCd <= 0) {
        // pick a visible airborne soldier, or spray the nearest tank
        const targets = this.soldiers.filter((s) => s.side === 'ally' && s.active && s.pos.distanceTo(n.pos) < 140);
        n.target = targets.find((t) => g.world.col.lineOfSight(n.pos.x, n.pos.y + 1, n.pos.z, t.pos.x, t.pos.y + 1, t.pos.z, 0.5)) ?? null;
        n.burst = 8 + Math.floor(Math.random() * 6);
        n.fireCd = 2 + Math.random() * 1.5;
      }
      if (n.burst > 0 && Math.random() < dt * 12) {
        n.burst--;
        let tp: THREE.Vector3 | null = null;
        if (n.target && n.target.active) tp = n.target.pos.clone().add(new THREE.Vector3((Math.random() - 0.5) * 4, 1, (Math.random() - 0.5) * 4));
        else {
          const tk = g.tanks.find((t) => t.side === 'ally' && t.alive && t.pos.distanceTo(n.pos) < 160);
          if (tk) tp = tk.centre().add(new THREE.Vector3((Math.random() - 0.5) * 3, Math.random(), (Math.random() - 0.5) * 3));
        }
        if (tp) {
          const o = n.pos.clone().add(new THREE.Vector3(0, 1, 0));
          g.effects.tracers.add(o.x, o.y, o.z, tp.x, tp.y, tp.z, 260, 4, [1, 0.45, 0.2]);
          g.audio.mg(o, 0.5);
          if (n.target && n.target.active && Math.random() < 0.035) this.killSoldier(n.target, null);
          n.mesh.rotation.y = Math.atan2(tp.x - o.x, tp.z - o.z);
        }
      }
    }

    for (const s of this.soldiers) {
      if (s.state === 'down') {
        s.deathT += dt;
        const k = Math.min(1, s.deathT * 3);
        s.mesh.rotation.set(-k * 1.45, s.heading, 0, 'YXZ');
        s.mesh.position.set(s.pos.x, s.pos.y + 0.15 * k, s.pos.z);
        if (s.side === 'enemy' && s.deathT > 25) s.mesh.visible = false;
        continue;
      }
      const sq = s.squad;
      // movement toward goal + personal offset
      const o = this.rot(s.offset, sq.heading);
      const tx = sq.goal.x + o.x, tz = sq.goal.z + o.z;
      const pinned = s.side === 'ally' && this.underFire(s);
      if (pinned) {
        s.pinnedT = 1.2;
      } else if (s.pinnedT > 0) s.pinnedT -= dt;
      s.state = s.pinnedT > 0 && !sq.sprint ? 'pinned' : 'idle';
      const dx = tx - s.pos.x, dz = tz - s.pos.z;
      const d = Math.hypot(dx, dz);
      let moving = false;
      if (s.state !== 'pinned' && d > 1.2 && sq.active) {
        const sp = (sq.sprint ? 5.2 : sq.fleeing ? 4.5 : 3.0) * dt;
        const p = { x: s.pos.x + (dx / d) * Math.min(sp, d), z: s.pos.z + (dz / d) * Math.min(sp, d) };
        g.world.col.resolveCircle(p, 0.45);
        s.pos.x = p.x;
        s.pos.z = p.z;
        s.heading = Math.atan2(dx, dz);
        moving = true;
      }
      // keep clear of tanks
      for (const t of g.tanks) {
        const ddx = s.pos.x - t.pos.x, ddz = s.pos.z - t.pos.z;
        const rr = t.def.radius + 0.6;
        const dd = ddx * ddx + ddz * ddz;
        if (dd < rr * rr && dd > 1e-4) {
          const q = Math.sqrt(dd);
          s.pos.x = t.pos.x + (ddx / q) * rr;
          s.pos.z = t.pos.z + (ddz / q) * rr;
        }
      }
      s.pos.y = g.world.h(s.pos.x, s.pos.z);
      // shooting
      s.fireCd -= dt;
      if (s.fireCd <= 0 && !sq.holdFire && !sq.fleeing) {
        s.fireCd = 1.6 + Math.random() * 2.2;
        this.shoot(s);
      }
      // pose
      const prone = s.state === 'pinned';
      const bob = moving ? Math.abs(Math.sin(g.time * 9 + s.offset.x)) * 0.12 : 0;
      s.mesh.position.set(s.pos.x, s.pos.y + bob + (prone ? 0.25 : 0), s.pos.z);
      s.mesh.rotation.set(prone ? -1.4 : moving ? -0.12 : 0, s.heading, 0, 'YXZ');
    }
  }

  private shoot(s: Soldier) {
    const g = this.g;
    const eye = new THREE.Vector3(s.pos.x, s.pos.y + 1.4, s.pos.z);
    let best: { p: THREE.Vector3; d: number; soldier?: Soldier; nest?: MGNest } | null = null;
    for (const t of this.soldiers) {
      if (t.side === s.side || !t.active) continue;
      const d = t.pos.distanceTo(s.pos);
      if (d > 150 || (best && d > best.d)) continue;
      best = { p: t.pos.clone().setY(t.pos.y + 1), d, soldier: t };
    }
    if (s.side === 'ally')
      for (const n of this.nests) {
        if (!n.alive || !n.active) continue;
        const d = n.pos.distanceTo(s.pos);
        if (d < 150 && (!best || d < best.d)) best = { p: n.pos.clone().setY(n.pos.y + 1), d, nest: n };
      }
    if (!best) return;
    if (!g.world.col.lineOfSight(eye.x, eye.y, eye.z, best.p.x, best.p.y, best.p.z, 0.5)) return;
    if (best.soldier) s.heading = Math.atan2(best.p.x - s.pos.x, best.p.z - s.pos.z);
    if (Math.random() < 0.5) g.effects.tracers.add(eye.x, eye.y, eye.z, best.p.x + (Math.random() - 0.5) * 2, best.p.y, best.p.z + (Math.random() - 0.5) * 2, 220, 2.5, s.side === 'ally' ? [1, 0.9, 0.5] : [1, 0.5, 0.3]);
    g.audio.rifle(eye);
    const pinnedPenalty = s.state === 'pinned' ? 0.35 : 1;
    if (best.soldier) {
      const tProne = best.soldier.state === 'pinned' ? 0.45 : 1;
      const base = s.side === 'ally' ? 0.11 : 0.045; // airborne are veterans; tutorial balance
      if (Math.random() < base * tProne * pinnedPenalty * Math.max(0.25, 1 - best.d / 180)) this.killSoldier(best.soldier, null);
    } else if (best.nest && Math.random() < 0.15) {
      best.nest.suppressed = Math.max(best.nest.suppressed, 0.6);
    }
  }
}
