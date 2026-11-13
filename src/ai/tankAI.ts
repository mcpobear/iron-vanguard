import * as THREE from 'three';
import { Tank, wrap } from '../vehicles/tank';
import type { Game } from '../game/game';
import type { MGNest, Soldier } from '../infantry/infantry';

export interface DriveState {
  stuckT: number;
  reverseT: number;
  reverseSteer: number;
}

export const newDrive = (): DriveState => ({ stuckT: 0, reverseT: 0, reverseSteer: 0 });

/** Steering/throttle controller with simple probe-based obstacle avoidance and unsticking. */
export function driveTo(t: Tank, gx: number, gz: number, g: Game, ds: DriveState, dt: number, speed = 1, arrive = 4): boolean {
  const dx = gx - t.pos.x, dz = gz - t.pos.z;
  const dist = Math.hypot(dx, dz);
  if (ds.reverseT > 0) {
    ds.reverseT -= dt;
    t.throttle = -0.7;
    t.steer = ds.reverseSteer;
    return false;
  }
  if (dist < arrive) {
    t.throttle = 0;
    t.steer = 0;
    return true;
  }
  const desired = Math.atan2(dx, dz);
  let diff = wrap(desired - t.heading);
  // obstacle probes
  const probe = (ang: number, len: number) => {
    const a = t.heading + ang;
    const px = t.pos.x + Math.sin(a) * len, pz = t.pos.z + Math.cos(a) * len;
    if (g.world.col.pointBlocked(px, pz, 2.4)) return true;
    for (const o of g.tanks) if (o !== t && !o.gone && (o.pos.x - px) ** 2 + (o.pos.z - pz) ** 2 < (o.def.radius + 2) ** 2) return true;
    return false;
  };
  if (dist > 8 && probe(0, 8)) {
    const l = probe(-0.6, 8), r = probe(0.6, 8);
    if (!l && r) diff = -0.9;
    else if (!r && l) diff = 0.9;
    else if (!l && !r) diff = diff >= 0 ? 0.9 : -0.9;
    else diff = diff >= 0 ? 1.5 : -1.5;
  }
  t.steer = Math.max(-1, Math.min(1, diff * 1.8));
  const align = Math.cos(diff);
  t.throttle = Math.abs(diff) > 1.3 ? 0.18 : Math.min(1, dist / 18) * speed * Math.max(0.25, align);
  if (t.throttle > 0.35 && Math.abs(t.speed) < 0.35) ds.stuckT += dt;
  else ds.stuckT = Math.max(0, ds.stuckT - dt);
  if (ds.stuckT > 2) {
    ds.stuckT = 0;
    ds.reverseT = 1.6;
    ds.reverseSteer = -Math.sign(t.steer || 1);
  }
  return false;
}

/** Can `shooter` fire at `target` without a friendly tank in the way? */
export function lineOfFireClear(shooter: Tank, target: THREE.Vector3, g: Game): boolean {
  const a = shooter.centre();
  const ab = target.clone().sub(a);
  const L2 = ab.lengthSq();
  for (const o of g.tanks) {
    if (o === shooter || o.side !== shooter.side || o.gone) continue;
    const c = o.centre();
    const t = Math.max(0, Math.min(1, c.clone().sub(a).dot(ab) / L2));
    if (t > 0.02 && a.clone().addScaledVector(ab, t).distanceTo(c) < o.def.radius + 2) return false;
  }
  return true;
}

function leadPoint(shooter: Tank, target: Tank) {
  const c = target.centre();
  const dist = c.distanceTo(shooter.centre());
  const flight = dist / shooter.def.gun.velocity[shooter.ammoSel];
  const v = target.forward().multiplyScalar(target.speed * flight);
  return c.add(v);
}

function aimError(t: Tank, p: THREE.Vector3): number {
  const pos = new THREE.Vector3(), dir = new THREE.Vector3();
  t.muzzle(pos, dir);
  const to = p.clone().sub(pos).normalize();
  const yawErr = Math.abs(wrap(Math.atan2(to.x, to.z) - Math.atan2(dir.x, dir.z)));
  return yawErr + Math.abs(Math.asin(Math.max(-1, Math.min(1, to.y))) - Math.asin(Math.max(-1, Math.min(1, dir.y)))) * 0.3;
}

export const compass = (dx: number, dz: number) => {
  // east is -x (see bellwickMap mirror note)
  const a = (Math.atan2(-dx, dz) * 180) / Math.PI;
  const dirs = ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'];
  return dirs[Math.round(((a + 360) % 360) / 45) % 8];
};

// -------------------------------------------------------------------------------------------

export class FriendlyAI {
  ds = newDrive();
  target: Tank | null = null;
  softTarget: MGNest | Soldier | null = null;
  acquire = 0;
  announced = new Set<number>();
  scanT = 0;
  holdPoint: THREE.Vector3 | null = null;
  stopToFire = 0;
  lastDamageReport = -99;
  inFormation = false;
  sidestep: THREE.Vector3 | null = null;
  sidestepT = 0;

  constructor(public tank: Tank) {}

  private profile(g: Game) {
    const b = this.tank.behaviour ?? { orderDelay: 1.2, acquireTime: 2.8, accuracy: 1.1, aggression: 0.4, discipline: 0.7, stressPenalty: 0.5 };
    const exp = Math.min(10, g.experienceOf(this.tank.commanderId));
    const vet = 1 - exp * 0.025; // modest veteran improvement
    const leadership = g.mercerLeading() ? 0.85 : 1;
    return {
      ...b,
      acquireTime: 1.4 * b.acquireTime * vet * leadership * (this.tank.ability === 'HUNTERS_INSTINCT' ? 0.8 : 1) * (1 + this.tank.stress * b.stressPenalty),
      accuracy: b.accuracy * vet,
    };
  }

  update(dt: number, g: Game) {
    const t = this.tank;
    if (!t.alive || t.isPlayer) return;
    const pl = g.platoon;
    const p = this.profile(g);

    // ---- targeting ----
    this.scanT -= dt;
    if (this.scanT <= 0) {
      this.scanT = 0.4;
      this.pickTarget(g);
    }
    let aimed = false;
    let wantStop = false;
    if (this.target) {
      const tgt = this.target;
      this.acquire += dt / p.acquireTime;
      if (this.acquire >= 1) {
        t.ammoSel = 'AP';
        const lp = leadPoint(t, tgt);
        t.aimPoint = lp;
        const err = aimError(t, lp);
        const dist = lp.distanceTo(t.centre());
        aimed = err < 0.02;
        const clear = lineOfFireClear(t, lp, g);
        if (!clear && this.sidestepT <= 0) {
          // a friendly tank is in the way: shuffle sideways for a clear shot
          const to = lp.clone().sub(t.pos).setY(0).normalize();
          const side = new THREE.Vector3(to.z, 0, -to.x);
          const blocker = g.tanks.find((o) => o !== t && o.side === 'ally' && o.alive && o.pos.distanceTo(t.pos) < 60);
          const sgn = blocker && side.dot(blocker.pos.clone().sub(t.pos)) > 0 ? -1 : 1;
          this.sidestep = t.pos.clone().addScaledVector(side, 14 * sgn).addScaledVector(to, 4);
          this.sidestepT = 5;
        }
        if (aimed && t.reload <= 0 && dist < 460 && g.time >= g.aiHoldFireUntil && clear) {
          const moving = Math.abs(t.speed) > 1;
          // Natural Gunner and Hunter's Instinct are small, situational bonuses
          let spread = 2.4 * p.accuracy * (moving ? (t.ability === 'HUNTERS_INSTINCT' ? 1.7 : 2.2) : 1) * (1 + t.stress * 0.5);
          if (t.ability === 'NATURAL_GUNNER' && !moving) spread *= 0.75;
          if (t.ability === 'NATURAL_GUNNER' && dist > 250) spread *= 0.88;
          if (!moving || this.stopToFire > 0 || p.aggression > 0.7) {
            g.weapons.fireMain(t, spread);
            this.stopToFire = 0;
          } else wantStop = true;
        } else if (t.reload <= 0.6 && dist < 300 && p.discipline > 0.8) wantStop = true;
      }
    } else if (this.softTarget) {
      const s = this.softTarget;
      const pos = 'hp' in s ? s.pos.clone().setY(s.pos.y + 0.8) : s.pos.clone().setY(s.pos.y + 1);
      const dist = pos.distanceTo(t.centre());
      const isNest = 'hp' in s;
      t.ammoSel = isNest || dist > 150 ? 'HE' : t.ammo.HE > 4 ? 'HE' : 'AP';
      t.aimPoint = pos;
      if (aimError(t, pos) < 0.025 && lineOfFireClear(t, pos, g)) {
        if (t.reload <= 0 && (isNest || Math.random() < dt * 0.5)) g.weapons.fireMain(t, p.accuracy * 1.3);
        if (!isNest && dist < 220) g.weapons.fireMG(t);
      }
    } else {
      // watch the platoon's frontage
      const lead = g.playerTank;
      const f = lead ? lead.forward() : t.forward();
      t.aimPoint = t.centre().addScaledVector(f, 80).add(new THREE.Vector3(0, 1, 0));
      this.acquire = 0;
    }

    // ---- movement by order ----
    const order = pl.effectiveOrder(this);
    if (this.sidestepT > 0) this.sidestepT -= dt;
    const lead = g.playerTank;
    let goal: THREE.Vector3 | null = null;
    let speed = 1;
    if (order === 'hold') {
      if (!this.holdPoint) this.holdPoint = t.pos.clone();
      goal = this.holdPoint;
    } else {
      this.holdPoint = null;
      if (order === 'move' && pl.movePoint) goal = pl.slotPosition(this, pl.movePoint, pl.moveHeading);
      else if (order === 'attack' && pl.designated && pl.designated.alive) {
        const d = pl.designated;
        const dist = d.pos.distanceTo(t.pos);
        const seen = g.world.col.lineOfSight(t.eye().x, t.eye().y, t.eye().z, d.centre().x, d.centre().y, d.centre().z);
        if (dist > 220 || !seen) {
          const dir = t.pos.clone().sub(d.pos).normalize();
          goal = d.pos.clone().addScaledVector(dir, Math.min(dist - 10, 160));
        } else goal = t.pos.clone();
        speed = 0.9;
      } else if (lead) {
        goal = pl.slotPosition(this, lead.pos, pl.leaderHeading);
        // aggressive commanders edge toward a visible enemy
        if (this.target && p.aggression > 0.7) goal.lerp(this.target.pos, 0.08);
        const ld = lead.pos.distanceTo(t.pos);
        speed = order === 'formup' ? 1 : Math.min(1, 0.45 + Math.abs(lead.speed) / lead.def.maxSpeed + Math.max(0, ld - 25) / 40);
      }
    }
    if (wantStop && order !== 'formup') this.stopToFire = Math.min(2, this.stopToFire + dt * 2);
    else this.stopToFire = Math.max(0, this.stopToFire - dt);
    if (this.sidestepT > 0 && this.sidestep && order !== 'hold') {
      goal = this.sidestep;
      speed = 0.7;
    }
    if (goal) {
      const tol = 3 + (1 - p.discipline) * 6;
      const leaderStopped = lead && Math.abs(lead.speed) < 0.5 && order !== 'move';
      const arrived = this.stopToFire > 0.4 ? (driveTo(t, t.pos.x, t.pos.z, g, this.ds, dt, 0, 99), true) : driveTo(t, goal.x, goal.z, g, this.ds, dt, speed, leaderStopped ? tol + 3 : tol);
      if (arrived && (order === 'follow' || order === 'formup') && lead) {
        // match the leader's facing when settled
        const dh = wrap(pl.leaderHeading - t.heading);
        if (Math.abs(dh) > 0.25 && Math.abs(lead.speed) < 1) {
          t.steer = Math.sign(dh) * 0.6;
          t.throttle = 0.08;
        }
      }
      this.inFormation = goal.distanceTo(t.pos) < tol + 6;
      if (order === 'move' && pl.movePoint && arrived) pl.reportArrived(this);
      if (order === 'formup' && arrived) pl.reportArrived(this);
    }
  }

  private pickTarget(g: Game) {
    const t = this.tank;
    const eye = t.eye();
    const pl = g.platoon;
    let best: Tank | null = null;
    let bestScore = 1e9;
    for (const e of g.tanks) {
      if (e.side !== 'enemy' || !e.alive || !e.active || e.gone) continue;
      const c = e.centre();
      const d = c.distanceTo(eye);
      const range = t.def.spotRange * (g.mercerLeading() ? 1.08 : 1);
      if (d > range) continue;
      if (!g.world.col.lineOfSight(eye.x, eye.y, eye.z, c.x, c.y, c.z)) continue;
      if (g.world.foliageBetween(eye.x, eye.z, c.x, c.z) > 3 && d > 90) continue;
      let score = d;
      if (pl.order === 'attack' && pl.designated === e) score -= 1000;
      if (e === this.target) score -= 40;
      if (e.def.cls === 'medium') score -= 25;
      if (score < bestScore) {
        bestScore = score;
        best = e;
      }
    }
    if (best !== this.target) {
      if (best && this.target === null && this.acquire > 0.5) this.acquire = 0.5;
      else this.acquire = 0;
      this.target = best;
      if (best && !this.announced.has(best.id)) {
        this.announced.add(best.id);
        if (!g.enemySpotted.has(best.id)) {
          g.enemySpotted.add(best.id);
          g.radioFrom(t, `Contact! Enemy ${best.def.cls} tank, ${compass(best.pos.x - t.pos.x, best.pos.z - t.pos.z)}, ${Math.round(best.pos.distanceTo(t.pos) / 10) * 10} metres.`);
        }
      }
    }
    this.softTarget = null;
    if (!best) {
      let bd = 260;
      for (const n of g.infantry.nests) {
        if (!n.alive || !n.active) continue;
        const d = n.pos.distanceTo(t.pos);
        if (d < bd && g.world.col.lineOfSight(eye.x, eye.y, eye.z, n.pos.x, n.pos.y + 1, n.pos.z)) {
          bd = d;
          this.softTarget = n;
        }
      }
      if (!this.softTarget) {
        bd = 170;
        for (const s of g.infantry.soldiers) {
          if (s.side !== 'enemy' || !s.active || !s.squad.active) continue;
          const d = s.pos.distanceTo(t.pos);
          if (d < bd && g.world.col.lineOfSight(eye.x, eye.y, eye.z, s.pos.x, s.pos.y + 1.2, s.pos.z)) {
            bd = d;
            this.softTarget = s;
          }
        }
      }
    }
  }
}

// -------------------------------------------------------------------------------------------

export interface EnemyOpts {
  guard: { x: number; z: number; heading: number };
  advanceTo?: { x: number; z: number };
  retreatTo: { x: number; z: number };
  aggression: number;
  holdFireUntil?: number;
  /** Optional idle patrol loop — the tank shuffles between these while unalerted. */
  patrol?: { x: number; z: number }[];
}

export class EnemyAI {
  ds = newDrive();
  mode: 'guard' | 'engage' | 'flank' | 'reposition' | 'retreat' | 'advance' = 'guard';
  detection = new Map<number, number>();
  target: Tank | null = null;
  flankPoint: THREE.Vector3 | null = null;
  repositionPoint: THREE.Vector3 | null = null;
  retreatRolled = false;
  scanT = 0;
  stopT = 0;
  lastHp: number;
  firstShotDelay = 2.2;
  /** Last place an enemy was seen — the tank will go and look there. */
  lastKnown: THREE.Vector3 | null = null;
  huntT = 0;
  patrolIdx = 0;
  patrolWait = 0;
  shootAndScoot = 0;
  mgCd = 0;
  turretScanT = 0;
  scanDir = 1;
  /** Seconds with nothing to shoot at and nobody near — a straggler eventually withdraws. */
  idleT = 0;

  constructor(public tank: Tank, public o: EnemyOpts) {
    this.lastHp = tank.hp;
    if (o.advanceTo) this.mode = 'advance';
  }

  update(dt: number, g: Game) {
    const t = this.tank;
    if (!t.alive || !t.active || t.gone) return;
    const diff = g.difficulty;

    // react to damage
    if (t.hp < this.lastHp - 1) {
      if (!this.retreatRolled && t.hpFraction() < 0.4) {
        this.retreatRolled = true;
        if (Math.random() < 0.5) this.mode = 'retreat';
      }
      if (this.mode === 'guard' && t.def.cls === 'medium' && Math.random() < 0.5) {
        const back = t.forward().multiplyScalar(-12);
        this.repositionPoint = t.pos.clone().add(back);
        this.mode = 'reposition';
      }
      if (t.lastHitBy) this.detection.set(t.lastHitBy.id, 1); // now knows where the shooter is
    }
    this.lastHp = t.hp;

    // detection
    this.scanT -= dt;
    if (this.scanT <= 0) {
      const step = 0.3;
      this.scanT = step;
      const eye = t.eye();
      let best: Tank | null = null;
      let bestD = 1e9;
      for (const a of g.tanks) {
        if (a.side !== 'ally' || !a.alive) continue;
        const c = a.centre();
        const d = c.distanceTo(eye);
        let det = this.detection.get(a.id) ?? 0;
        const visible = d < t.def.spotRange && g.world.col.lineOfSight(eye.x, eye.y, eye.z, c.x, c.y, c.z, 0.45);
        if (visible) {
          const moving = Math.abs(a.speed) > 1 ? 1.3 : 1;
          const fired = g.time - a.lastFireTime < 4 ? 2 : 1;
          const foliage = g.world.foliageBetween(eye.x, eye.z, c.x, c.z) > 2 ? 0.4 : 1;
          det += (step / diff.enemyAcquire) * moving * fired * foliage * (1 - (d / t.def.spotRange) * 0.5);
        } else det -= step * 0.12;
        det = Math.max(0, Math.min(1.5, det));
        this.detection.set(a.id, det);
        if (det >= 1 && visible && d < bestD) {
          bestD = d;
          best = a;
        }
      }
      if (best && best !== this.target) {
        if (!this.target) {
          this.firstShotDelay = diff.firstShotDelay;
          if (!g.enemySpotted.has(t.id)) {
            g.enemySpotted.add(t.id);
            g.radio('Crew', `Enemy ${t.def.cls} tank has spotted us — ${compass(t.pos.x - (g.playerTank?.pos.x ?? 0), t.pos.z - (g.playerTank?.pos.z ?? 0))}!`);
          }
        }
        this.target = best;
      } else if (!best) this.target = null;
      if (this.target && (this.mode === 'guard' || this.mode === 'advance') && this.o.aggression > 0.5 && t.def.cls === 'light') this.mode = 'flank';
      else if (this.target && this.mode === 'guard') this.mode = 'engage';
      else if (!this.target && this.mode === 'engage') this.mode = 'guard';
    }

    // coaxial MG against exposed infantry when no tank target is pressing
    this.mgCd -= dt;
    if (!this.target && this.mgCd <= 0 && t.mgAmmo > 0) {
      let inf: { x: number; y: number; z: number } | null = null;
      let bd = 150 * 150;
      for (const s2 of g.infantry.soldiers) {
        if (s2.side !== 'ally' || !s2.active) continue;
        const d = (s2.pos.x - t.pos.x) ** 2 + (s2.pos.z - t.pos.z) ** 2;
        if (d < bd && g.world.col.lineOfSight(t.eye().x, t.eye().y, t.eye().z, s2.pos.x, s2.pos.y + 1, s2.pos.z, 0.5)) {
          bd = d;
          inf = { x: s2.pos.x, y: s2.pos.y + 1, z: s2.pos.z };
        }
      }
      if (inf) {
        t.aimPoint = new THREE.Vector3(inf.x, inf.y, inf.z);
        if (aimError(t, t.aimPoint) < 0.06) {
          g.weapons.fireMG(t);
          g.infantry.suppressArea(inf.x, inf.z, 10, 'ally', 1.3);
          if (Math.random() < 0.08) this.mgCd = 1.5 + Math.random() * 2;
        }
      }
    }

    // shooting
    if (this.target && this.target.alive) {
      const lp = leadPoint(t, this.target);
      // inferior fire control: aim point wanders
      lp.x += Math.sin(g.time * 1.3 + t.id) * 1.2;
      lp.y += Math.sin(g.time * 0.9 + t.id) * 0.6;
      t.aimPoint = lp;
      this.firstShotDelay -= dt;
      const hold = this.o.holdFireUntil !== undefined && g.time < this.o.holdFireUntil;
      if (!hold && this.firstShotDelay <= 0 && t.reload <= 0 && aimError(t, lp) < 0.03 && lineOfFireClear(t, lp, g)) {
        const moving = Math.abs(t.speed) > 1;
        if (moving && this.mode !== 'retreat') this.stopT = 1.4;
        else {
          g.weapons.fireMain(t, diff.enemySpread * (moving ? 2.4 : 1) * (1 + t.stress * 0.6));
          // after firing, a cautious crew shifts position rather than trading shots from one spot
          if (this.mode !== 'retreat' && Math.random() < (t.def.cls === 'light' ? 0.55 : 0.3)) this.shootAndScoot = 2.5 + Math.random() * 2;
        }
      }
      this.lastKnown = this.target.pos.clone();
      this.huntT = 14;
    } else if (!t.aimPoint || !this.mgCd || this.mgCd <= 0) {
      // nothing in sight: sweep the turret across the approach instead of staring ahead
      this.turretScanT -= dt;
      if (this.turretScanT <= 0) {
        this.turretScanT = 2.5 + Math.random() * 2;
        this.scanDir *= -1;
      }
      const gh = this.o.guard.heading + this.scanDir * 0.5 * Math.sin(g.time * 0.35);
      const look = this.lastKnown && this.huntT > 0 ? this.lastKnown.clone().setY(this.lastKnown.y + 1) : t.centre().add(new THREE.Vector3(Math.sin(gh) * 60, 0.5, Math.cos(gh) * 60));
      t.aimPoint = look;
    }
    if (this.huntT > 0) this.huntT -= dt;

    // A tank left behind with nothing to fight drifts out of the battle rather than
    // stalling the mission forever.
    if (!this.target && this.mode !== 'retreat' && this.mode !== 'advance') {
      const nearest = g.tanks.reduce((best, a) => (a.side === 'ally' && a.alive ? Math.min(best, a.pos.distanceTo(t.pos)) : best), 1e9);
      this.idleT = nearest > 150 ? this.idleT + dt : 0;
      if (this.idleT > 35) {
        this.idleT = 0;
        this.mode = 'retreat';
      }
    } else this.idleT = 0;

    // movement
    if (this.stopT > 0) {
      this.stopT -= dt;
      t.throttle = 0;
      t.steer = 0;
      return;
    }
    switch (this.mode) {
      case 'advance': {
        const a = this.o.advanceTo!;
        if (driveTo(t, a.x, a.z, g, this.ds, dt, 0.85, 6)) {
          this.o.guard = { x: a.x, z: a.z, heading: t.heading };
          this.mode = this.target ? 'engage' : 'guard';
        }
        break;
      }
      case 'guard':
      case 'engage': {
        const gp = this.o.guard;
        if (this.shootAndScoot > 0) {
          // sidestep a few metres so the next incoming round misses
          this.shootAndScoot -= dt;
          const side = new THREE.Vector3(Math.cos(t.heading), 0, -Math.sin(t.heading)).multiplyScalar(this.scanDir);
          const to = t.pos.clone().add(side.multiplyScalar(10));
          driveTo(t, to.x, to.z, g, this.ds, dt, 0.6, 3);
          break;
        }
        if (!this.target && this.huntT > 0 && this.lastKnown) {
          // push toward where the shot came from instead of sitting still
          const want = this.lastKnown.clone().lerp(t.pos, 0.45);
          if (driveTo(t, want.x, want.z, g, this.ds, dt, 0.55, 8)) this.huntT = 0;
          break;
        }
        if (!this.target && this.o.patrol && this.o.patrol.length > 1) {
          this.patrolWait -= dt;
          if (this.patrolWait <= 0) {
            const p = this.o.patrol[this.patrolIdx % this.o.patrol.length];
            if (driveTo(t, p.x, p.z, g, this.ds, dt, 0.45, 6)) {
              this.patrolIdx++;
              this.patrolWait = 3 + Math.random() * 4;
              this.o.guard = { x: t.pos.x, z: t.pos.z, heading: this.o.guard.heading };
            }
            break;
          }
        }
        if (Math.hypot(gp.x - t.pos.x, gp.z - t.pos.z) > 6) driveTo(t, gp.x, gp.z, g, this.ds, dt, 0.6, 4);
        else {
          t.throttle = 0;
          // keep the hull's thick front toward the threat
          const face = this.target ? Math.atan2(this.target.pos.x - t.pos.x, this.target.pos.z - t.pos.z) : gp.heading;
          const dh = wrap(face - t.heading);
          t.steer = Math.abs(dh) > 0.3 && t.def.cls === 'medium' ? Math.sign(dh) * 0.5 : 0;
        }
        break;
      }
      case 'flank': {
        if (!this.target) {
          this.mode = 'guard';
          break;
        }
        if (!this.flankPoint || this.flankPoint.distanceTo(t.pos) < 8) {
          const tp = this.target.pos;
          const away = t.pos.clone().sub(tp).normalize();
          const side = new THREE.Vector3(away.z, 0, -away.x).multiplyScalar(Math.random() < 0.5 ? 1 : -1);
          const cand = tp.clone().addScaledVector(away, 70).addScaledVector(side, 45);
          if (!g.world.col.pointBlocked(cand.x, cand.z, 4)) this.flankPoint = cand;
          else this.flankPoint = t.pos.clone().addScaledVector(side, 20);
        }
        driveTo(t, this.flankPoint.x, this.flankPoint.z, g, this.ds, dt, 0.8, 6);
        break;
      }
      case 'reposition': {
        const rp = this.repositionPoint!;
        t.throttle = -0.6;
        t.steer = 0;
        if (rp.distanceTo(t.pos) < 3 || t.stationaryTime > 2) {
          this.o.guard = { x: t.pos.x, z: t.pos.z, heading: this.o.guard.heading };
          this.mode = this.target ? 'engage' : 'guard';
        }
        break;
      }
      case 'retreat': {
        const r = this.o.retreatTo;
        if (!t.driveOffTriggered) {
          t.driveOffTriggered = true;
          g.radio('Crew', `Enemy ${t.def.cls} tank is withdrawing!`);
        }
        driveTo(t, r.x, r.z, g, this.ds, dt, 1, 10);
        // Leaves the battle once it reaches its rally point, or once it is clear of every
        // friendly platoon — not merely clear of the player, who may be on the far flank.
        const nearestAlly = g.tanks.reduce((best, a) => (a.side === 'ally' && a.alive ? Math.min(best, a.pos.distanceTo(t.pos)) : best), 1e9);
        if (Math.hypot(r.x - t.pos.x, r.z - t.pos.z) < 30 || nearestAlly > 300) g.enemyDrivenOff(t);
        break;
      }
    }
  }
}
