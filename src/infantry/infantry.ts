import * as THREE from 'three';
import { soldierGeometry, mgNestGeometry } from '../rendering/models';
import type { Game } from '../game/game';
import type { Side, Tank } from '../vehicles/tank';

export interface XZ {
  x: number;
  z: number;
}

export type Stance = 'standing' | 'kneeling' | 'prone';
export type Role = 'rifle' | 'at' | 'mg';

const geoCache: Partial<Record<Side, THREE.BufferGeometry>> = {};
let soldierMat: THREE.MeshLambertMaterial | null = null;

const dist2 = (a: { x: number; z: number }, b: { x: number; z: number }) => (a.x - b.x) ** 2 + (a.z - b.z) ** 2;

export class Soldier {
  pos = new THREE.Vector3();
  heading = 0;
  alive = true;
  wounded = false;
  state: 'idle' | 'move' | 'pinned' | 'down' = 'idle';
  stance: Stance = 'standing';
  role: Role = 'rifle';
  offset: XZ;
  fireCd = Math.random() * 2;
  deathT = 0;
  mesh: THREE.Mesh;
  /** Seconds of remaining suppression (incoming fire landing close). */
  pinnedT = 0;
  /** Bounding-rush timer: a soldier only moves during his team's turn. */
  rushT = 0;
  bob = 0;
  recoil = 0;
  /** Where he is heading right now (his slot, or a cover point he picked). */
  target: XZ | null = null;
  coverSearchT = 0;
  atCooldown = 0;
  lastShotAt = -99;

  constructor(public side: Side, public squad: Squad, public idx: number) {
    if (!geoCache[side]) geoCache[side] = soldierGeometry(side);
    if (!soldierMat) soldierMat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
    this.mesh = new THREE.Mesh(geoCache[side]!, soldierMat);
    const row = Math.floor(idx / 4), col = idx % 4;
    this.offset = { x: (col - 1.5) * 3.4 + (Math.random() - 0.5) * 1.5, z: -row * 3.6 + (Math.random() - 0.5) * 1.5 };
  }

  get active() {
    return this.alive && !this.wounded;
  }

  /** Eye/muzzle height for the current stance. */
  eyeY() {
    return this.stance === 'prone' ? 0.45 : this.stance === 'kneeling' ? 1.0 : 1.45;
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
  /** Alternating bounds: team 0 moves while team 1 gives covering fire. */
  bound = 0;
  boundT = 0;
  /** Enemy squads defending a position dig in rather than advance. */
  defend = false;

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
  /** Arc the gun can cover, in radians either side of `heading`. */
  arc = 1.5;
  range = 150;
  constructor(public name: string, x: number, z: number, heading: number, g: Game) {
    this.mesh = new THREE.Mesh(mgNestGeometry(), new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }));
    this.pos.set(x, g.world.h(x, z), z);
    this.heading = heading;
    this.mesh.position.copy(this.pos);
    this.mesh.rotation.y = heading;
    g.scene.add(this.mesh);
  }
  canSee(p: { x: number; z: number }) {
    const a = Math.atan2(p.x - this.pos.x, p.z - this.pos.z) - this.heading;
    const d = Math.atan2(Math.sin(a), Math.cos(a));
    return Math.abs(d) < this.arc;
  }
}

export class Infantry {
  squads: Squad[] = [];
  soldiers: Soldier[] = [];
  nests: MGNest[] = [];
  constructor(private g: Game) {}

  spawnSquad(side: Side, name: string, x: number, z: number, count: number, heading = 0, opts: { defend?: boolean; at?: number } = {}): Squad {
    const sq = new Squad(side, name, x, z);
    sq.heading = heading;
    sq.defend = !!opts.defend;
    const atCount = opts.at ?? (side === 'ally' ? Math.max(1, Math.floor(count / 6)) : count >= 5 ? 1 : 0);
    for (let i = 0; i < count; i++) {
      const s = new Soldier(side, sq, i);
      s.role = i < atCount ? 'at' : 'rifle';
      const o = this.rot(s.offset, heading);
      s.pos.set(x + o.x, 0, z + o.z);
      s.pos.y = this.g.world.h(s.pos.x, s.pos.z);
      s.heading = heading;
      if (sq.defend) s.stance = Math.random() < 0.6 ? 'prone' : 'kneeling';
      sq.soldiers.push(s);
      this.soldiers.push(s);
      this.g.scene.add(s.mesh);
    }
    this.squads.push(sq);
    return sq;
  }

  addNest(name: string, x: number, z: number, heading: number, opts: { arc?: number; range?: number } = {}) {
    const n = new MGNest(name, x, z, heading, this.g);
    if (opts.arc !== undefined) n.arc = opts.arc;
    if (opts.range !== undefined) n.range = opts.range;
    this.nests.push(n);
    return n;
  }

  order(sq: Squad, path: XZ[], sprint = false) {
    sq.path = path;
    sq.pathIdx = 0;
    sq.sprint = sprint;
    sq.arrived = false;
    sq.defend = false;
    for (const s of sq.soldiers) s.target = null;
    if (path.length) sq.goal = path[0];
  }

  private rot(o: XZ, h: number): XZ {
    const c = Math.cos(h), s = Math.sin(h);
    return { x: o.x * c + o.z * s, z: -o.x * s + o.z * c };
  }

  alliesNear(x: number, z: number, r: number) {
    return this.soldiers.some((s) => s.side === 'ally' && s.active && dist2(s.pos, { x, z }) < r * r);
  }

  /** Walking wounded return to the fight between phases so the company doesn't melt away. */
  recoverWounded(sq: Squad, fraction = 0.5) {
    const hurt = sq.soldiers.filter((s) => s.alive && s.wounded);
    const back = Math.round(hurt.length * fraction);
    const c = sq.centre();
    for (let i = 0; i < back; i++) {
      const s = hurt[i];
      s.wounded = false;
      s.state = 'idle';
      s.deathT = 0;
      s.stance = 'kneeling';
      s.mesh.visible = true;
      s.pos.set(c.x + (Math.random() - 0.5) * 6, 0, c.z - 6 + (Math.random() - 0.5) * 4);
      s.pos.y = this.g.world.h(s.pos.x, s.pos.z);
    }
    return back;
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

  /** Something landed near this soldier: make him go to ground. */
  suppress(s: Soldier, seconds: number) {
    s.pinnedT = Math.max(s.pinnedT, seconds);
  }

  suppressArea(x: number, z: number, r: number, side: Side | null, seconds: number) {
    for (const s of this.soldiers) {
      if (!s.active || (side && s.side !== side)) continue;
      if (dist2(s.pos, { x, z }) < r * r) this.suppress(s, seconds);
    }
  }

  // ---------------------------------------------------------------- cover

  /** A spot near `from` that breaks line of sight to `threat`, preferring forward progress. */
  private findCover(s: Soldier, threat: XZ, toward: XZ | null): XZ | null {
    const g = this.g;
    let best: XZ | null = null;
    let bestScore = -1e9;
    for (let i = 0; i < 10; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = 4 + Math.random() * 11;
      const p = { x: s.pos.x + Math.cos(a) * r, z: s.pos.z + Math.sin(a) * r };
      if (g.world.col.pointBlocked(p.x, p.z, 0.8)) continue;
      const y = g.world.h(p.x, p.z);
      const hidden = !g.world.col.lineOfSight(threat.x, g.world.h(threat.x, threat.z) + 1.2, threat.z, p.x, y + 0.5, p.z, 0.5);
      let score = hidden ? 100 : 0;
      if (toward) score -= Math.sqrt(dist2(p, toward)) * 0.5;
      score -= Math.sqrt(dist2(p, threat)) < 25 ? 60 : 0;
      if (score > bestScore) {
        bestScore = score;
        best = p;
      }
    }
    return bestScore > 0 ? best : null;
  }

  /** The nearest thing currently shooting at this soldier's side. */
  private nearestThreat(s: Soldier): XZ | null {
    const g = this.g;
    let best: XZ | null = null;
    let bd = 1e9;
    if (s.side === 'ally') {
      for (const n of this.nests) {
        if (!n.alive || !n.active || n.suppressed > 0) continue;
        const d = dist2(n.pos, s.pos);
        if (d < bd && d < n.range * n.range) {
          bd = d;
          best = { x: n.pos.x, z: n.pos.z };
        }
      }
    }
    for (const o of this.soldiers) {
      if (!o.active || o.side === s.side) continue;
      const d = dist2(o.pos, s.pos);
      if (d < bd && d < 150 * 150) {
        bd = d;
        best = { x: o.pos.x, z: o.pos.z };
      }
    }
    for (const t of g.tanks) {
      if (!t.alive || !t.active || t.gone || t.side === s.side) continue;
      const d = dist2(t.pos, s.pos);
      if (d < bd && d < 120 * 120) {
        bd = d;
        best = { x: t.pos.x, z: t.pos.z };
      }
    }
    return best;
  }

  private underFire(s: Soldier): boolean {
    const g = this.g;
    for (const n of this.nests) {
      if (!n.alive || !n.active || n.suppressed > 0) continue;
      if (dist2(s.pos, n.pos) > n.range * n.range) continue;
      if (!n.canSee(s.pos)) continue;
      if (g.world.col.lineOfSight(n.pos.x, n.pos.y + 1, n.pos.z, s.pos.x, s.pos.y + 1, s.pos.z, 0.5)) return true;
    }
    return false;
  }

  // ---------------------------------------------------------------- update

  update(dt: number) {
    const g = this.g;
    for (const sq of this.squads) {
      if (!sq.active) continue;
      sq.boundT -= dt;
      if (sq.boundT <= 0) {
        sq.boundT = 2.6 + Math.random() * 1.4;
        sq.bound ^= 1;
      }
      if (!sq.arrived && sq.path.length) {
        const c = sq.centre();
        const wp = sq.path[sq.pathIdx];
        if (Math.hypot(c.x - wp.x, c.z - wp.z) < 6) {
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

    this.updateNests(dt);

    for (const s of this.soldiers) {
      if (s.state === 'down') {
        s.deathT += dt;
        const k = Math.min(1, s.deathT * 3);
        s.mesh.rotation.set(-k * 1.45, s.heading, 0, 'YXZ');
        s.mesh.position.set(s.pos.x, s.pos.y + 0.15 * k, s.pos.z);
        if (s.side === 'enemy' && s.deathT > 25) s.mesh.visible = false;
        continue;
      }
      this.updateSoldier(s, dt);
    }
  }

  private updateSoldier(s: Soldier, dt: number) {
    const g = this.g;
    const sq = s.squad;
    if (s.pinnedT > 0) s.pinnedT -= dt;
    if (s.recoil > 0) s.recoil = Math.max(0, s.recoil - dt * 4);
    if (s.atCooldown > 0) s.atCooldown -= dt;
    const threat = this.nearestThreat(s);
    if (this.underFire(s)) this.suppress(s, 1.4);

    // ---- stance ----
    const pinned = s.pinnedT > 0 && !sq.sprint && !sq.fleeing;
    const near = threat ? Math.sqrt(dist2(s.pos, threat)) : 1e9;
    let stance: Stance = 'standing';
    if (pinned) stance = 'prone';
    else if (sq.defend) stance = s.idx % 3 === 0 ? 'kneeling' : 'prone';
    else if (near < 90 && !sq.sprint) stance = 'kneeling';
    s.stance = stance;
    s.state = pinned ? 'pinned' : 'idle';

    // ---- movement ----
    let moving = false;
    if (sq.active && !sq.defend) {
      // Choose a destination: cover when under fire, otherwise the formation slot.
      const o = this.rot(s.offset, sq.heading);
      const slot = { x: sq.goal.x + o.x, z: sq.goal.z + o.z };
      const myTurn = sq.sprint || sq.fleeing || s.idx % 2 === sq.bound;
      if (pinned && threat) {
        s.coverSearchT -= dt;
        if (!s.target && s.coverSearchT <= 0) {
          s.coverSearchT = 1.5;
          s.target = this.findCover(s, threat, sq.arrived ? null : slot);
        }
      } else if (myTurn) {
        s.target = slot;
      }
      const tgt = s.target;
      if (tgt && (myTurn || pinned)) {
        const dx = tgt.x - s.pos.x, dz = tgt.z - s.pos.z;
        const d = Math.hypot(dx, dz);
        if (d > 1.2) {
          const speed = (sq.sprint ? 5.4 : sq.fleeing ? 4.8 : pinned ? 4.2 : 3.1) * dt;
          const p = { x: s.pos.x + (dx / d) * Math.min(speed, d), z: s.pos.z + (dz / d) * Math.min(speed, d) };
          g.world.col.resolveCircle(p, 0.45);
          s.pos.x = p.x;
          s.pos.z = p.z;
          s.heading = Math.atan2(dx, dz);
          moving = true;
          s.stance = pinned && d > 3 ? 'kneeling' : s.stance; // crouch-run between bounds
        } else if (tgt !== null && pinned) s.target = null;
      }
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

    // ---- shooting ----
    s.fireCd -= dt;
    if (s.fireCd <= 0 && !sq.holdFire && !sq.fleeing) {
      const fired = this.shoot(s, moving);
      s.fireCd = fired ? (s.role === 'at' ? 5 + Math.random() * 3 : 0.9 + Math.random() * 1.4) : 0.5 + Math.random() * 0.6;
    }

    // ---- pose ----
    s.bob = moving ? s.bob + dt * 9 : 0;
    const bobY = moving ? Math.abs(Math.sin(s.bob)) * 0.12 : 0;
    const prone = s.stance === 'prone';
    const kneel = s.stance === 'kneeling';
    s.mesh.position.set(s.pos.x, s.pos.y + bobY - (kneel ? 0.42 : 0) + (prone ? 0.22 : 0), s.pos.z);
    s.mesh.rotation.set(prone ? -1.42 : moving ? -0.14 : -s.recoil * 0.25, s.heading, 0, 'YXZ');
    s.mesh.scale.y = kneel ? 0.78 : 1;
  }

  private updateNests(dt: number) {
    const g = this.g;
    for (const n of this.nests) {
      if (!n.alive) continue;
      if (n.suppressed > 0) n.suppressed -= dt;
      if (!n.active || n.suppressed > 0) continue;
      n.fireCd -= dt;
      if (n.fireCd <= 0) {
        const targets = this.soldiers.filter((s) => s.side === 'ally' && s.active && dist2(s.pos, n.pos) < n.range * n.range && n.canSee(s.pos));
        n.target =
          targets.find((t) => g.world.col.lineOfSight(n.pos.x, n.pos.y + 1, n.pos.z, t.pos.x, t.pos.y + t.eyeY(), t.pos.z, 0.5)) ?? null;
        n.burst = 9 + Math.floor(Math.random() * 7);
        n.fireCd = 1.8 + Math.random() * 1.4;
      }
      if (n.burst > 0 && Math.random() < dt * 14) {
        n.burst--;
        let tp: THREE.Vector3 | null = null;
        if (n.target && n.target.active) {
          tp = n.target.pos.clone().add(new THREE.Vector3((Math.random() - 0.5) * 4, 1, (Math.random() - 0.5) * 4));
          this.suppressArea(n.target.pos.x, n.target.pos.z, 9, 'ally', 1.6);
        } else {
          const tk = g.tanks.find((t) => t.side === 'ally' && t.alive && dist2(t.pos, n.pos) < 160 * 160 && n.canSee(t.pos));
          if (tk) tp = tk.centre().add(new THREE.Vector3((Math.random() - 0.5) * 3, Math.random(), (Math.random() - 0.5) * 3));
        }
        if (tp) {
          const o = n.pos.clone().add(new THREE.Vector3(0, 1, 0));
          g.effects.tracers.add(o.x, o.y, o.z, tp.x, tp.y, tp.z, 260, 4, [1, 0.45, 0.2]);
          g.effects.muzzleFlash(o, tp.clone().sub(o).normalize(), false);
          g.audio.mg(o, 0.5);
          if (n.target && n.target.active && Math.random() < 0.03) this.killSoldier(n.target, null);
          n.mesh.rotation.y = Math.atan2(tp.x - o.x, tp.z - o.z);
        }
      }
    }
  }

  // ---------------------------------------------------------------- weapons

  private shoot(s: Soldier, moving: boolean): boolean {
    const g = this.g;
    const eye = new THREE.Vector3(s.pos.x, s.pos.y + s.eyeY(), s.pos.z);

    // Anti-tank men take on armour first.
    if (s.role === 'at' && s.atCooldown <= 0) {
      let tank: Tank | null = null;
      let bd = 110 * 110;
      for (const t of g.tanks) {
        if (t.side === s.side || !t.alive || !t.active || t.gone) continue;
        const d = dist2(t.pos, s.pos);
        if (d < bd) {
          const c = t.centre();
          if (g.world.col.lineOfSight(eye.x, eye.y, eye.z, c.x, c.y, c.z, 0.5)) {
            bd = d;
            tank = t;
          }
        }
      }
      if (tank) {
        this.fireAT(s, tank, eye);
        return true;
      }
    }

    let best: { p: THREE.Vector3; d: number; soldier?: Soldier; nest?: MGNest } | null = null;
    for (const t of this.soldiers) {
      if (t.side === s.side || !t.active) continue;
      const d = dist2(t.pos, s.pos);
      if (d > 150 * 150 || (best && d > best.d)) continue;
      best = { p: t.pos.clone().setY(t.pos.y + t.eyeY()), d, soldier: t };
    }
    if (s.side === 'ally')
      for (const n of this.nests) {
        if (!n.alive || !n.active) continue;
        const d = dist2(n.pos, s.pos);
        if (d < 150 * 150 && (!best || d < best.d)) best = { p: n.pos.clone().setY(n.pos.y + 1), d, nest: n };
      }
    // enemy riflemen also plink at tank commanders / crew to look busy and force buttoning up
    if (!best && s.side === 'enemy') {
      for (const t of g.tanks) {
        if (t.side === 'enemy' || !t.alive || t.gone) continue;
        const d = dist2(t.pos, s.pos);
        if (d < 90 * 90 && (!best || d < best.d)) best = { p: t.centre(), d };
      }
    }
    if (!best) return false;
    if (!g.world.col.lineOfSight(eye.x, eye.y, eye.z, best.p.x, best.p.y, best.p.z, 0.5)) return false;
    s.heading = Math.atan2(best.p.x - s.pos.x, best.p.z - s.pos.z);
    s.recoil = 1;
    s.lastShotAt = g.time;
    const spread = (moving ? 2.4 : s.stance === 'prone' ? 0.8 : 1.4) * 1.6;
    const end = best.p.clone().add(new THREE.Vector3((Math.random() - 0.5) * spread, (Math.random() - 0.5) * 0.7, (Math.random() - 0.5) * spread));
    g.effects.muzzleFlash(eye, end.clone().sub(eye).normalize(), false);
    if (Math.random() < 0.55) g.effects.tracers.add(eye.x, eye.y, eye.z, end.x, end.y, end.z, 240, 2.5, s.side === 'ally' ? [1, 0.9, 0.5] : [1, 0.5, 0.3]);
    g.audio.rifle(eye);

    const dRange = Math.sqrt(best.d);
    const pinnedPenalty = s.state === 'pinned' ? 0.4 : moving ? 0.5 : 1;
    const stanceBonus = s.stance === 'prone' ? 1.25 : 1;
    if (best.soldier) {
      const t = best.soldier;
      this.suppress(t, 1.1);
      const tCover = t.stance === 'prone' ? 0.4 : t.stance === 'kneeling' ? 0.7 : 1;
      const base = s.side === 'ally' ? 0.1 : 0.05;
      if (Math.random() < base * tCover * pinnedPenalty * stanceBonus * Math.max(0.25, 1 - dRange / 180)) this.killSoldier(t, null);
    } else if (best.nest && Math.random() < 0.15) {
      best.nest.suppressed = Math.max(best.nest.suppressed, 0.7);
    }
    return true;
  }

  /** Shoulder-fired AT rocket: slow, visible, and only dangerous from the side or rear. */
  private fireAT(s: Soldier, tank: Tank, eye: THREE.Vector3) {
    const g = this.g;
    s.atCooldown = 9 + Math.random() * 5;
    s.recoil = 1;
    s.heading = Math.atan2(tank.pos.x - s.pos.x, tank.pos.z - s.pos.z);
    const c = tank.centre();
    const dir = c.clone().sub(eye).normalize();
    g.effects.muzzleFlash(eye, dir, true);
    g.audio.impact(eye, false);
    const dist = eye.distanceTo(c);
    const flight = dist / 90;
    g.effects.tracers.add(eye.x, eye.y, eye.z, c.x, c.y, c.z, 90, 8, [1, 0.75, 0.35]);
    g.after(flight, () => {
      if (!tank.alive) return;
      const lead = tank.centre();
      const miss = Math.random() < 0.45 + Math.min(0.3, dist / 400);
      const p = miss ? lead.clone().add(new THREE.Vector3((Math.random() - 0.5) * 7, 0, (Math.random() - 0.5) * 7)) : lead;
      g.effects.explosion(p, 0.8);
      g.audio.explosion(p, 0.7);
      if (miss) return;
      // side/rear only: the Sentinel's frontal armour shrugs these off
      const to = lead.clone().sub(eye).setY(0).normalize();
      const fwd = tank.forward();
      const frontal = to.dot(fwd) < -0.55;
      const dmg = frontal ? 2 : 10 + Math.random() * 8;
      tank.hp -= dmg;
      tank.lastHitBy = null;
      tank.stress = Math.min(1, tank.stress + 0.5);
      if (tank.isPlayer) {
        g.hud.damageFlash(frontal ? 0.3 : 0.7);
        g.cameraShake(frontal ? 0.4 : 0.9);
        g.hud.radio('Crew', frontal ? 'Infantry AT rocket — bounced off the front plate!' : `AT rocket hit! Hull ${Math.round(tank.hpFraction() * 100)}%. Watch our flanks!`);
      }
      if (!frontal && Math.random() < 0.25) tank.tracksBroken = Math.max(tank.tracksBroken, 8);
      tank.refreshStatus();
      if (tank.hp <= 0)
        g.weapons.knockOut(tank, null, { severity: 0.5, penetrated: true, ammoDetonation: false, crewCompartmentHit: false, fire: Math.random() < 0.3, kind: 'destroyed' }, 'Infantry anti-tank rocket');
    });
  }
}
