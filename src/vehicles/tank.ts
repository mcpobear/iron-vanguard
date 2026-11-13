import * as THREE from 'three';
import type { AmmoType, TankDef } from '../data/tanks';
import { buildTankModel, type TankView } from '../rendering/models';
import type { VehicleOutcome, CrewOutcome, AbilityId, BehaviourProfile } from '../campaign/types';
import type { KnockoutEvent } from '../progression/casualty';
import type { Game } from '../game/game';

export type Side = 'ally' | 'enemy';

const wrap = (a: number) => {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
};
export { wrap };

let nextId = 1;

export class Tank {
  id = nextId++;
  view: TankView;
  pos = new THREE.Vector3();
  heading = 0;
  speed = 0;
  yawRate = 0;
  turretYaw = 0; // relative to hull
  gunPitch = 0;
  aimPoint: THREE.Vector3 | null = null;
  throttle = 0;
  steer = 0;
  hp: number;
  status: VehicleOutcome = 'operational';
  crew: CrewOutcome = 'unhurt';
  reload = 0;
  ammo: Record<AmmoType, number>;
  ammoSel: AmmoType = 'AP';
  mgAmmo: number;
  mgBelts: number;
  mgReload = 0;
  mgCooldown = 0;
  tracksBroken = 0;
  turretJam = 0;
  engineDamage = 0; // 0..1
  fireTimer = 0;
  wreckTimer = 0;
  recoil = 0;
  lastHitBy: Tank | null = null;
  lastHitTime = -99;
  lastFireTime = -99;
  knockout: KnockoutEvent | null = null;
  causeOfLoss: string | null = null;
  bodyPitch = 0;
  bodyRoll = 0;
  private prevSpeed = 0;
  /** Campaign links (allies only). */
  commanderId: string | null = null;
  commanderName = '';
  rankAbbr = '';
  callsign = '';
  slotIndex = -1;
  ability: AbilityId = 'NONE';
  behaviour: BehaviourProfile | null = null;
  isPlayer = false;
  label = '';
  active = true; // enemies stay dormant until their mission phase
  stress = 0;
  stationaryTime = 0;
  movedDist = 0;
  driveOffTriggered = false;
  gone = false;

  constructor(public def: TankDef, public side: Side, number: string, castShadow: boolean) {
    this.view = buildTankModel(def, number, castShadow);
    this.hp = def.hp;
    this.ammo = { ...def.ammo };
    this.mgAmmo = def.mgBeltSize;
    this.mgBelts = def.mgBelts - 1;
    this.label = def.name;
  }

  get alive() {
    return this.status !== 'destroyed' && this.status !== 'disabled';
  }
  get canMove() {
    return this.alive && this.tracksBroken <= 0;
  }
  forward(out = new THREE.Vector3()) {
    return out.set(Math.sin(this.heading), 0, Math.cos(this.heading));
  }

  place(x: number, z: number, heading: number, g: Game) {
    this.pos.set(x, g.world.h(x, z), z);
    this.heading = heading;
    this.syncView(0, g);
  }

  /** Physics + turret drive. */
  update(dt: number, g: Game) {
    const d = this.def;
    if (!this.alive) {
      this.speed *= Math.max(0, 1 - dt * 3);
      this.updateWreck(dt, g);
      this.syncView(dt, g);
      return;
    }
    if (this.tracksBroken > 0) {
      const rate = this.ability === 'MECHANICAL_EXPERTISE' ? 1.6 : 1;
      this.tracksBroken -= dt * rate;
      if (this.tracksBroken <= 0 && this.side === 'ally') g.radioFrom(this, 'Track repaired, we\'re mobile again.');
    }
    if (this.turretJam > 0) this.turretJam -= dt * (this.ability === 'MECHANICAL_EXPERTISE' ? 1.6 : 1);
    if (this.fireTimer > 0) {
      this.fireTimer -= dt;
      this.hp -= dt * 1.4;
      g.effects.fire(new THREE.Vector3(this.pos.x, this.pos.y + 1.6, this.pos.z - 0), 0.7);
      if (this.fireTimer <= 0 && this.side === 'ally') g.radioFrom(this, 'Fire\'s out.');
      if (this.hp <= 0) g.weapons.knockOut(this, this.lastHitBy, { severity: 0.4, penetrated: false, ammoDetonation: false, crewCompartmentHit: false, fire: true, kind: 'destroyed' }, 'Vehicle fire');
    }

    // --- drive ---
    const surf = g.world.terrain.surface(this.pos.x, this.pos.z);
    const surfFactor = surf === 1 ? 1 : surf === 2 ? 0.45 : 0.72;
    const limitF = d.maxSpeed * surfFactor * (1 - this.engineDamage * 0.5) * (1 - Math.abs(this.steer) * 0.3);
    const limitR = d.maxReverse * (1 - this.engineDamage * 0.4);
    let thr = this.canMove ? this.throttle : 0;
    const target = thr >= 0 ? thr * limitF : thr * limitR;
    const braking = Math.sign(target) !== Math.sign(this.speed) && Math.abs(this.speed) > 0.2;
    const rate = braking ? d.accel * 2.4 : Math.abs(target) < Math.abs(this.speed) ? d.accel * 1.5 : d.accel * (surf === 1 ? 1 : 0.85);
    const ds = target - this.speed;
    this.speed += Math.sign(ds) * Math.min(Math.abs(ds), rate * dt);
    // steering: pivots slowly at rest, best at low/medium speed; car-like when reversing
    const sp = Math.abs(this.speed) / d.maxSpeed;
    const steerInput = this.canMove ? this.steer * (this.speed < -0.3 ? -1 : 1) : 0;
    const targetYaw = steerInput * d.turnRate * (0.65 + 0.35 * (1 - sp)) * (surf === 2 ? 0.6 : 1);
    this.yawRate += (targetYaw - this.yawRate) * Math.min(1, dt * 4);
    this.heading = wrap(this.heading + this.yawRate * dt);
    const fx = Math.sin(this.heading), fz = Math.cos(this.heading);
    const p = { x: this.pos.x + fx * this.speed * dt, z: this.pos.z + fz * this.speed * dt };
    const hit = g.world.col.resolveCircle(p, d.radius);
    // tank-tank separation
    for (const o of g.tanks) {
      if (o === this || o.gone) continue;
      const dx = p.x - o.pos.x, dz = p.z - o.pos.z;
      const rr = d.radius + o.def.radius - 0.4;
      const d2 = dx * dx + dz * dz;
      if (d2 < rr * rr && d2 > 1e-4) {
        const dd = Math.sqrt(d2);
        const push = (rr - dd) * (o.alive ? 0.5 : 1);
        p.x += (dx / dd) * push;
        p.z += (dz / dd) * push;
        if (o.alive && o.canMove) {
          o.pos.x -= (dx / dd) * push;
          o.pos.z -= (dz / dd) * push;
        }
        this.speed *= 0.96;
      }
    }
    if (hit) this.speed *= 0.9;
    const moved = Math.hypot(p.x - this.pos.x, p.z - this.pos.z);
    this.movedDist += moved;
    this.stationaryTime = moved < 0.02 ? this.stationaryTime + dt : 0;
    this.pos.x = p.x;
    this.pos.z = p.z;
    this.pos.y = g.world.h(p.x, p.z);
    const felled = g.world.crushTrees(p.x + fx * 2.5, p.z + fz * 2.5, d.radius * 0.8, fx, fz);
    if (felled) {
      this.speed *= 0.7;
      if (this.isPlayer) g.audio.crunch();
    }

    // --- turret & gun (stabilised toward aim point) ---
    if (this.aimPoint) {
      const local = this.view.body.worldToLocal(this.aimPoint.clone());
      const tp = this.view.turret.position;
      const lx = local.x - tp.x, lz = local.z - tp.z;
      const desiredYaw = Math.atan2(lx, lz);
      const dist = Math.hypot(lx, lz);
      const ly = local.y - (tp.y + this.view.gunPivot.position.y);
      const v = d.gun.velocity[this.ammoSel];
      const drop = Math.min(0.2, (9.81 * dist) / (2 * v * v)); // fire-control superelevation
      const desiredPitch = Math.atan2(ly, dist) + drop;
      const tr = d.turretTraverse * (this.turretJam > 0 ? 0 : 1) * dt;
      const dy = wrap(desiredYaw - this.turretYaw);
      this.turretYaw = wrap(this.turretYaw + Math.sign(dy) * Math.min(Math.abs(dy), tr));
      const dp = Math.max(d.gunElevMin, Math.min(d.gunElevMax, desiredPitch)) - this.gunPitch;
      this.gunPitch += Math.sign(dp) * Math.min(Math.abs(dp), 0.5 * dt);
    }

    if (this.reload > 0) this.reload -= dt;
    if (this.mgCooldown > 0) this.mgCooldown -= dt;
    if (this.mgReload > 0) {
      this.mgReload -= dt;
      if (this.mgReload <= 0 && this.mgBelts > 0) {
        this.mgBelts--;
        this.mgAmmo = d.mgBeltSize;
      }
    }
    this.stress = Math.max(0, this.stress - dt * 0.12);

    // dust & track scroll
    const absS = Math.abs(this.speed);
    if (absS > 1.5 && surf !== 2) {
      const back = new THREE.Vector3(this.pos.x - fx * d.hull.length * 0.5, this.pos.y, this.pos.z - fz * d.hull.length * 0.5);
      g.effects.dust(back, (absS / d.maxSpeed) * (surf === 1 ? 0.5 : 0.9));
    }
    this.syncView(dt, g);
  }

  private updateWreck(dt: number, g: Game) {
    this.wreckTimer += dt;
    const p = new THREE.Vector3(this.pos.x, this.pos.y + 1.5, this.pos.z);
    if (this.status === 'destroyed') g.effects.fire(p, this.wreckTimer < 25 ? 0.8 : 0.25);
    else g.effects.fire(p, this.wreckTimer < 8 ? 0.3 : 0.08);
  }

  syncView(dt: number, g: Game) {
    const v = this.view;
    const d = this.def;
    v.root.position.copy(this.pos);
    v.root.rotation.y = this.heading;
    // suspension: tilt from terrain samples + acceleration pitch
    const fx = Math.sin(this.heading), fz = Math.cos(this.heading);
    const L = d.hull.length * 0.45, W = d.hull.width * 0.45;
    const hF = g.world.h(this.pos.x + fx * L, this.pos.z + fz * L), hB = g.world.h(this.pos.x - fx * L, this.pos.z - fz * L);
    const hR = g.world.h(this.pos.x + fz * W, this.pos.z - fx * W), hL = g.world.h(this.pos.x - fz * W, this.pos.z + fx * W);
    const acc = dt > 0 ? (this.speed - this.prevSpeed) / dt : 0;
    this.prevSpeed = this.speed;
    const targetPitch = -Math.atan2(hF - hB, L * 2) - acc * 0.012;
    const targetRoll = Math.atan2(hR - hL, W * 2) + this.yawRate * Math.abs(this.speed) * 0.006;
    const k = Math.min(1, dt * 7);
    this.bodyPitch += (targetPitch - this.bodyPitch) * k;
    this.bodyRoll += (targetRoll - this.bodyRoll) * k;
    v.body.rotation.set(this.bodyPitch, 0, this.bodyRoll, 'YXZ');
    const mid = Math.max((hF + hB) / 2, (hL + hR) / 2) - this.pos.y;
    v.body.position.y = mid + (this.alive ? Math.sin(g.time * 18 + this.id) * 0.012 * Math.min(1, Math.abs(this.speed) / 4) : 0);
    v.turret.rotation.y = this.turretYaw;
    v.gunPivot.rotation.x = -this.gunPitch;
    this.recoil = Math.max(0, this.recoil - dt * 2.2);
    v.barrel.position.z = -Math.pow(this.recoil, 0.6) * 0.65;
    // track texture scroll with differential steering
    const turn = this.yawRate * d.hull.width * 0.5;
    v.tracks[0].tex.offset.y -= ((this.speed - turn) * dt) / 1.1;
    v.tracks[1].tex.offset.y -= ((this.speed + turn) * dt) / 1.1;
    v.shadow.visible = !g.shadowsOn;
  }

  /** World-space muzzle position and barrel direction (the shell always follows the real barrel). */
  muzzle(outPos: THREE.Vector3, outDir: THREE.Vector3) {
    this.view.root.updateMatrixWorld(true);
    this.view.muzzle.getWorldPosition(outPos);
    const base = new THREE.Vector3();
    this.view.gunPivot.getWorldPosition(base);
    outDir.copy(outPos).sub(base).normalize();
  }

  coaxPos(out: THREE.Vector3) {
    this.view.coax.getWorldPosition(out);
    return out;
  }

  centre(out = new THREE.Vector3()) {
    return out.set(this.pos.x, this.pos.y + this.def.hull.height * 0.8, this.pos.z);
  }

  eye(out = new THREE.Vector3()) {
    return out.set(this.pos.x, this.pos.y + this.view.turretHeight + 0.6, this.pos.z);
  }

  hpFraction() {
    return Math.max(0, this.hp / this.def.hp);
  }

  refreshStatus() {
    if (!this.alive) return;
    const f = this.hpFraction();
    this.status = f < 0.7 || this.tracksBroken > 0 || this.engineDamage > 0 || this.turretJam > 0 ? 'damaged' : 'operational';
  }

  /** Darken the model when knocked out. */
  markWreck(destroyed: boolean) {
    for (const m of this.view.materials) m.color.setScalar(destroyed ? 0.32 : 0.6);
    this.view.commander.visible = false;
    if (destroyed && this.knockout?.ammoDetonation) {
      this.view.turret.position.y += 0.5;
      this.view.turret.rotation.z = 0.35;
      this.view.turret.rotation.x = 0.2;
    }
  }
}
