import * as THREE from 'three';
import type { AmmoType } from '../data/tanks';
import type { Tank } from '../vehicles/tank';
import type { Game } from '../game/game';
import { resolveCasualty, TUTORIAL_TUNING, OUTCOME_TEXT, type KnockoutEvent } from '../progression/casualty';
import type { Soldier, MGNest } from '../infantry/infantry';

interface Shell {
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  ammo: AmmoType;
  shooter: Tank;
  age: number;
}

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();

/** Segment vs a tank's hull/turret box in tank-local space. */
export function hitTankSegment(t: Tank, a: THREE.Vector3, b: THREE.Vector3): null | { t: number; local: THREE.Vector3; dirLocal: THREE.Vector3; axis: number; sign: number } {
  const c = Math.cos(-t.heading), s = Math.sin(-t.heading);
  const toLocal = (p: THREE.Vector3) => {
    const x = p.x - t.pos.x, z = p.z - t.pos.z;
    return new THREE.Vector3(x * c + z * s, p.y - t.pos.y, -x * s + z * c);
  };
  const la = toLocal(a), lb = toLocal(b);
  const { length: L, width: W } = t.def.hull;
  const mn = [-W / 2 - 0.1, 0.25, -L / 2], mx = [W / 2 + 0.1, t.view.turretHeight, L / 2];
  const o = [la.x, la.y, la.z], d = [lb.x - la.x, lb.y - la.y, lb.z - la.z];
  let t0 = 0, t1 = 1, axis = 0, sign = 1;
  for (let i = 0; i < 3; i++) {
    if (Math.abs(d[i]) < 1e-9) {
      if (o[i] < mn[i] || o[i] > mx[i]) return null;
      continue;
    }
    let ta = (mn[i] - o[i]) / d[i], tb = (mx[i] - o[i]) / d[i];
    let sg = -1;
    if (ta > tb) {
      [ta, tb] = [tb, ta];
      sg = 1;
    }
    if (ta > t0) {
      t0 = ta;
      axis = i;
      sign = sg;
    }
    t1 = Math.min(t1, tb);
    if (t0 > t1) return null;
  }
  const local = new THREE.Vector3(o[0] + d[0] * t0, o[1] + d[1] * t0, o[2] + d[2] * t0);
  const dirLocal = new THREE.Vector3(d[0], d[1], d[2]).normalize();
  return { t: t0, local, dirLocal, axis, sign };
}

export class Weapons {
  shells: Shell[] = [];
  constructor(private g: Game) {}

  fireMain(t: Tank, spreadMul = 1): boolean {
    const g = this.g;
    if (t.reload > 0 || !t.alive || t.ammo[t.ammoSel] <= 0) return false;
    const pos = new THREE.Vector3(), dir = new THREE.Vector3();
    t.muzzle(pos, dir);
    const spread = t.def.gun.baseSpread * spreadMul;
    // random cone deviation
    const up = Math.abs(dir.y) < 0.99 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
    const right = new THREE.Vector3().crossVectors(dir, up).normalize();
    const up2 = new THREE.Vector3().crossVectors(right, dir).normalize();
    const r = Math.sqrt(Math.random()) * spread, a = Math.random() * Math.PI * 2;
    dir.addScaledVector(right, Math.cos(a) * r).addScaledVector(up2, Math.sin(a) * r).normalize();
    const v = t.def.gun.velocity[t.ammoSel];
    this.shells.push({ pos: pos.clone(), vel: dir.clone().multiplyScalar(v), ammo: t.ammoSel, shooter: t, age: 0 });
    t.ammo[t.ammoSel]--;
    t.reload = t.def.gun.reload;
    t.recoil = 1;
    t.lastFireTime = g.time;
    g.effects.muzzleFlash(pos, dir, true);
    g.audio.cannon(pos, t.def.gun.calibre);
    if (t.commanderId) g.tracker.shotFired(t.commanderId);
    if (t.isPlayer) g.cameraShake(0.5);
    else if (t.pos.distanceTo(g.camera.position) < 40) g.cameraShake(0.15);
    // muzzle blast kicks up dust
    g.effects.dust(new THREE.Vector3(pos.x, g.world.h(pos.x, pos.z), pos.z), 1);
    return true;
  }

  fireMG(t: Tank): boolean {
    const g = this.g;
    if (!t.alive || t.mgCooldown > 0 || t.mgReload > 0) return false;
    if (t.mgAmmo <= 0) {
      if (t.mgBelts > 0) {
        t.mgReload = 3.5;
        if (t.isPlayer) g.hud.flash('RELOADING MG BELT');
      }
      return false;
    }
    t.mgAmmo--;
    if (t.mgAmmo <= 0 && t.mgBelts > 0) t.mgReload = 3.5;
    t.mgCooldown = 0.095;
    const o = t.coaxPos(new THREE.Vector3());
    const dir = new THREE.Vector3();
    t.muzzle(new THREE.Vector3(), dir);
    dir.x += (Math.random() - 0.5) * 0.028;
    dir.y += (Math.random() - 0.5) * 0.02;
    dir.z += (Math.random() - 0.5) * 0.028;
    dir.normalize();
    const range = 320;
    const end = o.clone().addScaledVector(dir, range);
    // world & terrain
    let tmin = 1;
    const tb = g.world.col.segmentBoxes(o.x, o.y, o.z, end.x, end.y, end.z);
    if (tb >= 0) tmin = Math.min(tmin, tb);
    const tt = g.world.col.segmentTerrain(o.x, o.y, o.z, end.x, end.y, end.z, 4);
    if (tt >= 0) tmin = Math.min(tmin, tt);
    let hitSoldier: Soldier | null = null;
    let hitNest: MGNest | null = null;
    let hitTankT: Tank | null = null;
    for (const s of g.infantry.soldiers) {
      if (!s.active || s.side === t.side) continue;
      const c = new THREE.Vector3(s.pos.x, s.pos.y + (s.state === 'pinned' ? 0.4 : 1.0), s.pos.z);
      const tc = c.clone().sub(o).dot(dir) / range;
      if (tc < 0 || tc > tmin) continue;
      const closest = o.clone().addScaledVector(dir, tc * range);
      if (closest.distanceTo(c) < 0.95) {
        tmin = tc;
        hitSoldier = s;
        hitNest = null;
      }
    }
    for (const n of g.infantry.nests) {
      if (!n.alive) continue;
      const c = n.pos.clone().setY(n.pos.y + 0.8);
      const tc = c.clone().sub(o).dot(dir) / range;
      if (tc < 0 || tc > tmin) continue;
      if (o.clone().addScaledVector(dir, tc * range).distanceTo(c) < 2.4) {
        tmin = tc;
        hitNest = n;
        hitSoldier = null;
      }
    }
    for (const k of g.tanks) {
      if (k === t || k.gone) continue;
      const h = hitTankSegment(k, o, end);
      if (h && h.t < tmin) {
        tmin = h.t;
        hitTankT = k;
        hitSoldier = null;
        hitNest = null;
      }
    }
    const hp = o.clone().addScaledVector(dir, tmin * range);
    if (t.mgAmmo % 3 === 0) g.effects.tracers.add(o.x, o.y, o.z, hp.x, hp.y, hp.z, 300, 5, t.side === 'ally' ? [1, 0.85, 0.35] : [1, 0.4, 0.2]);
    g.audio.mg(o, t.isPlayer ? 1 : 0.6);
    if (hitSoldier) {
      if (Math.random() < (hitSoldier.state === 'pinned' ? 0.3 : 0.5)) g.infantry.killSoldier(hitSoldier, t.commanderId);
    } else if (hitNest) {
      hitNest.suppressed = Math.max(hitNest.suppressed, 1.5);
      this.damageNest(hitNest, 0.9, t);
      g.effects.dirtPuff(hp);
    } else if (hitTankT) {
      if (Math.random() < 0.3) g.effects.impactSparks(hp, false);
      hitTankT.hp -= 0.02;
    } else if (tmin < 1) g.effects.dirtPuff(hp);
    if (t.isPlayer) g.cameraShake(0.05);
    return true;
  }

  damageNest(n: MGNest, dmg: number, by: Tank | null) {
    if (!n.alive) return;
    n.hp -= dmg;
    if (n.hp <= 0) {
      n.alive = false;
      this.g.effects.explosion(n.pos.clone().setY(n.pos.y + 0.5), 1.2);
      this.g.audio.explosion(n.pos, 1);
      (n.mesh.material as THREE.MeshLambertMaterial).color.setScalar(0.35);
      n.mesh.rotation.z = 0.15;
      const near = this.g.infantry.alliesNear(n.pos.x, n.pos.z, 120);
      this.g.tracker.positionDestroyed(by?.commanderId ?? null, near);
      this.g.onPositionDestroyed(n, by);
      if (by?.isPlayer) this.g.hud.hitMarker('POSITION DESTROYED', 'good');
    }
  }

  update(dt: number) {
    const g = this.g;
    const grav = 9.81;
    for (let i = this.shells.length - 1; i >= 0; i--) {
      const s = this.shells[i];
      s.age += dt;
      const steps = Math.max(1, Math.ceil((s.vel.length() * dt) / 3));
      const h = dt / steps;
      let done = false;
      for (let k = 0; k < steps && !done; k++) {
        _a.copy(s.pos);
        s.vel.y -= grav * h * (s.ammo === 'SMOKE' ? 1.4 : 1);
        _b.copy(s.pos).addScaledVector(s.vel, h);
        done = this.collide(s, _a, _b);
        s.pos.copy(_b);
      }
      // glowing shell trail
      if (!done) g.effects.glow.spawn({ x: s.pos.x, y: s.pos.y, z: s.pos.z, size: s.ammo === 'SMOKE' ? 0.3 : 0.45, life: 0.08, r: 1, g: 0.8, b: 0.4, a: 0.9 });
      if (done || s.age > 4 || s.pos.y < -20) this.shells.splice(i, 1);
    }
  }

  private collide(s: Shell, a: THREE.Vector3, b: THREE.Vector3): boolean {
    const g = this.g;
    let best = 1;
    let kind: 'none' | 'tank' | 'world' | 'terrain' | 'nest' = 'none';
    let tankHit: ReturnType<typeof hitTankSegment> = null;
    let tank: Tank | null = null;
    let nest: MGNest | null = null;
    for (const t of g.tanks) {
      if (t.gone || (t === s.shooter && s.age < 0.25)) continue;
      const h = hitTankSegment(t, a, b);
      if (h && h.t < best) {
        best = h.t;
        kind = 'tank';
        tankHit = h;
        tank = t;
      }
    }
    const tb = g.world.col.segmentBoxes(a.x, a.y, a.z, b.x, b.y, b.z);
    if (tb >= 0 && tb < best) {
      best = tb;
      kind = 'world';
    }
    const tt = g.world.col.segmentTerrain(a.x, a.y, a.z, b.x, b.y, b.z, 1.5);
    if (tt >= 0 && tt < best) {
      best = tt;
      kind = 'terrain';
    }
    for (const n of g.infantry.nests) {
      if (!n.alive) continue;
      const c = n.pos.clone().setY(n.pos.y + 0.7);
      const d = b.clone().sub(a);
      const tc = Math.max(0, Math.min(1, c.clone().sub(a).dot(d) / d.lengthSq()));
      if (a.clone().addScaledVector(d, tc).distanceTo(c) < 2.6 && tc < best) {
        best = tc;
        kind = 'nest';
        nest = n;
      }
    }
    if (kind === 'none') return false;
    const p = a.clone().lerp(b, best);
    if (s.ammo === 'SMOKE') {
      this.smokeBurst(p, s.shooter);
      return true;
    }
    if (kind === 'tank' && tank && tankHit) {
      this.shellHitsTank(s, tank, tankHit, p);
    } else if (kind === 'nest' && nest) {
      g.effects.explosion(p, s.ammo === 'HE' ? 1 : 0.6);
      g.audio.explosion(p, 0.7);
      this.damageNest(nest, s.ammo === 'HE' ? 75 : 30, s.shooter);
    } else {
      g.effects.explosion(p, s.ammo === 'HE' ? 1 : 0.45, false);
      g.audio.impact(p, false);
    }
    if (s.ammo === 'HE') this.splash(p, s.shooter, tank);
    return true;
  }

  private smokeBurst(p: THREE.Vector3, shooter: Tank) {
    const g = this.g;
    const y = Math.max(p.y, g.world.h(p.x, p.z));
    const c = { x: p.x, y: y + 2.5, z: p.z, r: 7, life: 45, maxLife: 45, ownerId: shooter.commanderId };
    g.world.col.smoke.push(c);
    g.effects.smokeScreen(new THREE.Vector3(p.x, y, p.z));
    g.audio.impact(p, false);
  }

  private splash(p: THREE.Vector3, shooter: Tank, direct: Tank | null) {
    const g = this.g;
    const r = shooter.def.gun.splash.HE;
    for (const s of g.infantry.soldiers) {
      if (!s.active) continue;
      const d = s.pos.distanceTo(p);
      if (d < r) {
        const chance = (1 - d / r) * (s.state === 'pinned' ? 0.75 : 1) + 0.25;
        if (Math.random() < chance) g.infantry.killSoldier(s, s.side === shooter.side ? null : shooter.commanderId);
      }
    }
    for (const n of g.infantry.nests) {
      const d = n.pos.distanceTo(p);
      if (n.alive && d < r + 2.5) this.damageNest(n, 55 * (1 - d / (r + 2.5)) + 10, shooter);
    }
    for (const t of g.tanks) {
      if (t === direct || !t.alive) continue;
      if (t.pos.distanceTo(p) < t.def.radius + 1.5) t.hp -= 2;
    }
    g.cameraShakeAt(p, 0.6);
  }

  private shellHitsTank(s: Shell, t: Tank, h: NonNullable<ReturnType<typeof hitTankSegment>>, p: THREE.Vector3) {
    const g = this.g;
    const shooter = s.shooter;
    const d = t.def;
    const turret = h.local.y > d.hull.height + 0.05;
    let facing: 'front' | 'side' | 'rear' | 'top' = 'side';
    if (h.axis === 2) facing = h.sign > 0 ? 'front' : 'rear';
    else if (h.axis === 1) facing = 'top';
    const normal = new THREE.Vector3(h.axis === 0 ? h.sign : 0, h.axis === 1 ? h.sign : 0, h.axis === 2 ? h.sign : 0);
    const cos = Math.abs(h.dirLocal.dot(normal));
    let armour = turret ? (facing === 'front' ? d.armour.turret : facing === 'rear' ? d.armour.turret * 0.55 : d.armour.turret * 0.7) : facing === 'top' ? d.armour.rear * 0.6 : d.armour[facing === 'front' ? 'front' : facing === 'rear' ? 'rear' : 'side'];
    // Hunter's Instinct: small bonus against exposed (side/rear) armour
    let penMul = 1;
    if (shooter.ability === 'HUNTERS_INSTINCT' && (facing === 'side' || facing === 'rear')) penMul = 1.08;
    const eff = armour / Math.max(0.22, cos);
    const pen = shooter.def.gun.pen[s.ammo] * penMul * (0.88 + Math.random() * 0.24);
    const friendly = shooter.side === t.side;
    let dmgMul = 1;
    if (t.side === 'ally' && shooter.side === 'enemy') dmgMul = g.difficulty.enemyDamage;
    if (friendly) dmgMul = 0.5;
    let dmg = 0;
    let penetrated = false;
    let ricochet = false;
    if (s.ammo === 'AP' && cos < 0.26) ricochet = true;
    else if (pen > eff) {
      penetrated = true;
      dmg = shooter.def.gun.damage[s.ammo] * (0.85 + Math.random() * 0.3) * dmgMul;
    } else dmg = shooter.def.gun.damage[s.ammo] * (s.ammo === 'HE' ? 0.22 : 0.06) * dmgMul;

    // feedback
    if (penetrated) {
      g.effects.explosion(p, s.ammo === 'HE' ? 0.9 : 0.55);
      g.effects.impactSparks(p, false);
      g.audio.impact(p, false, true);
    } else {
      g.effects.impactSparks(p, true);
      g.audio.impact(p, true);
      if (ricochet) {
        const rv = s.vel.clone().reflect(normal.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), t.heading)).normalize();
        g.effects.tracers.add(p.x, p.y, p.z, p.x + rv.x * 60, p.y + rv.y * 60 + 5, p.z + rv.z * 60, 200, 3, [1, 0.8, 0.4]);
      }
    }

    // critical effects on penetration
    let crew = false, detonation = false;
    const bennett = t.ability === 'MECHANICAL_EXPERTISE';
    const crits: string[] = [];
    if (penetrated) {
      if (facing === 'side' && h.local.y < 1.1 && Math.random() < (bennett ? 0.3 : 0.45)) {
        t.tracksBroken = 11;
        crits.push('TRACKS');
      }
      if (facing === 'rear') {
        t.engineDamage = Math.min(1, t.engineDamage + 0.5);
        crits.push('ENGINE');
        if (Math.random() < (bennett ? 0.1 : 0.18)) {
          t.fireTimer = 9;
          crits.push('FIRE');
        }
      }
      if (turret) {
        if (Math.random() < 0.25) {
          t.turretJam = 7;
          crits.push('TURRET');
        }
        if (Math.random() < 0.5) crew = true;
      } else if (Math.random() < 0.25) crew = true;
      if (!turret && facing === 'side' && h.local.y > 0.9 && Math.random() < 0.06) detonation = true;
    } else if (!ricochet && facing === 'side' && h.local.y < 0.9 && Math.random() < 0.12 && !bennett) {
      t.tracksBroken = 7;
      crits.push('TRACKS');
    }

    t.hp = t.alive ? t.hp - dmg : Math.max(0, t.hp - dmg);
    t.lastHitBy = shooter;
    t.lastHitTime = g.time;
    t.stress = Math.min(1, t.stress + 0.6);
    if (t.side === 'ally' && penetrated) t.crewHits = (t.crewHits ?? 0) + (crew ? 1 : 0);

    // scoring feedback for the shooter
    if (shooter.isPlayer) {
      const label = ricochet ? 'RICOCHET' : penetrated ? (crits.length ? `PENETRATION · ${crits.join(' · ')}` : 'PENETRATION') : 'NO PENETRATION';
      g.hud.hitMarker(label, penetrated ? 'good' : 'bad');
    }
    if (t.side === 'ally') g.onAllyHit(t, shooter, penetrated, ricochet, crits);

    if (t.side !== shooter.side && penetrated && shooter.commanderId && t.alive) {
      const ko = detonation || t.hp <= 0 || t.hp <= d.hp * 0.15;
      if (!ko) g.tracker.damagingHit(shooter.commanderId);
    }

    const ev: KnockoutEvent = { severity: dmg / d.hp, penetrated, ammoDetonation: detonation, crewCompartmentHit: crew || (t.crewHits ?? 0) >= 2, fire: t.fireTimer > 0, kind: 'destroyed' };
    if (detonation) this.knockOut(t, shooter, ev, 'Ammunition detonation');
    else if (t.hp <= 0) this.knockOut(t, shooter, ev, penetrated ? `Penetrating hit to the ${turret ? 'turret' : facing === 'front' ? 'hull front' : facing + ' armour'}` : 'Accumulated damage');
    else if (penetrated && t.hp <= d.hp * 0.15) this.knockOut(t, shooter, { ...ev, kind: 'disabled' }, 'Disabled by penetrating hit');
    else t.refreshStatus();
  }

  knockOut(t: Tank, by: Tank | null, ev: KnockoutEvent, cause: string) {
    const g = this.g;
    if (!t.alive) return;
    t.status = ev.kind;
    t.knockout = ev;
    t.causeOfLoss = cause;
    t.hp = Math.max(0, t.hp);
    t.throttle = 0;
    const c = t.centre();
    if (ev.kind === 'destroyed') {
      g.effects.explosion(c, ev.ammoDetonation ? 2.4 : 1.6, true);
      g.audio.explosion(c, ev.ammoDetonation ? 1.6 : 1.1);
      g.cameraShakeAt(c, ev.ammoDetonation ? 2 : 1.2);
    } else {
      g.effects.explosion(c, 0.7, true);
    }
    t.markWreck(ev.kind === 'destroyed');
    if (t.side === 'ally') {
      const rng = g.rng;
      t.crew = resolveCasualty(ev, rng, TUTORIAL_TUNING);
      if (t.commanderId) {
        g.tracker.setVehicle(t.commanderId, ev.kind, Math.round(t.hp));
        g.tracker.setCrew(t.commanderId, t.crew, cause);
      }
      g.onAllyKnockedOut(t, OUTCOME_TEXT[t.crew]);
    } else {
      const killer = by && by.side === 'ally' ? by : null;
      if (killer?.commanderId) {
        const protecting = g.time - t.lastFireTime < 10 || g.infantry.alliesNear(t.pos.x, t.pos.z, 120);
        const coordinated = !killer.isPlayer && g.platoon.isAttackingDesignated(killer, t);
        g.tracker.tankKilled(killer.commanderId, t.def.cls, { killerDamaged: killer.hpFraction() < 0.5, protecting, coordinated, designatorId: g.playerTank?.commanderId ?? null });
      } else g.tracker.enemyTanksDestroyed++;
      g.onEnemyKnockedOut(t, killer);
    }
  }
}

declare module '../vehicles/tank' {
  interface Tank {
    crewHits?: number;
  }
}
