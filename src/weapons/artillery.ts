import * as THREE from 'three';
import type { Game } from '../game/game';

export interface FireMission {
  id: number;
  x: number;
  z: number;
  /** Seconds until the first round lands. */
  eta: number;
  rounds: number;
  fired: number;
  nextRound: number;
  radius: number;
  callerId: string | null;
  warnedShort: boolean;
}

/**
 * Regimental artillery. The player marks a point on the tactical map; the guns are slow,
 * limited, and dangerous to friendly troops — a barrage dropped short will kill your own men.
 */
export class Artillery {
  missions: FireMission[] = [];
  /** Fire missions still available this battle. */
  available = 0;
  /** Seconds before another mission can be called. */
  cooldown = 0;
  readonly cooldownLength = 45;
  // Long enough that you must lead a moving target, short enough to stay in the fight.
  readonly flightTime = 22;
  readonly roundsPerMission = 18;
  readonly radius = 22;
  /** Set true once the battery is in action (phase-gated by the mission). */
  enabled = false;
  private nextId = 1;
  /** Last point the player marked, for the HUD. */
  lastTarget: THREE.Vector3 | null = null;

  constructor(private g: Game) {}

  get ready() {
    return this.enabled && this.available > 0 && this.cooldown <= 0;
  }

  /** Why a fire mission can't be called right now (for HUD feedback). */
  blockedReason(): string | null {
    if (!this.enabled) return 'ARTILLERY NOT YET IN ACTION';
    if (this.available <= 0) return 'NO FIRE MISSIONS REMAINING';
    if (this.cooldown > 0) return `BATTERY RELOADING — ${Math.ceil(this.cooldown)}s`;
    return null;
  }

  /** Returns true if the mission was accepted. */
  call(x: number, z: number, callerId: string | null): boolean {
    const g = this.g;
    if (!this.ready) {
      const r = this.blockedReason();
      if (r) g.hud.flash(r);
      return false;
    }
    this.available--;
    this.cooldown = this.cooldownLength;
    const m: FireMission = { id: this.nextId++, x, z, eta: this.flightTime, rounds: this.roundsPerMission, fired: 0, nextRound: 0, radius: this.radius, callerId, warnedShort: false };
    this.missions.push(m);
    this.lastTarget = new THREE.Vector3(x, g.world.h(x, z), z);
    const bearing = Math.round(Math.hypot(x - (g.playerTank?.pos.x ?? 0), z - (g.playerTank?.pos.z ?? 0)));
    g.radio('Hammer Battery', `Fire mission acknowledged, ${bearing} metres from your position. Rounds in ${this.flightTime} seconds — keep your heads down.`);
    g.hud.flash(`FIRE MISSION SENT — IMPACT IN ${this.flightTime}s`);
    g.audio.radio();
    // warn if friendly troops or tanks are inside the beaten zone
    if (this.dangerCount(x, z) > 0) {
      m.warnedShort = true;
      g.after(2.5, () => g.radio('Hammer Battery', 'Danger close! That target has friendlies on it — check your map!'));
    }
    return true;
  }

  /** How many friendly units are inside the beaten zone of a point. */
  dangerCount(x: number, z: number): number {
    const g = this.g;
    let n = 0;
    const r2 = (this.radius + 10) ** 2;
    for (const t of g.tanks) if (t.side === 'ally' && t.alive && (t.pos.x - x) ** 2 + (t.pos.z - z) ** 2 < r2) n++;
    for (const s of g.infantry.soldiers) if (s.side === 'ally' && s.active && (s.pos.x - x) ** 2 + (s.pos.z - z) ** 2 < r2) n++;
    return n;
  }

  update(dt: number) {
    const g = this.g;
    if (this.cooldown > 0) this.cooldown -= dt;
    for (let i = this.missions.length - 1; i >= 0; i--) {
      const m = this.missions[i];
      if (m.eta > 0) {
        m.eta -= dt;
        // whistle of incoming just before impact
        if (m.eta <= 3.5 && m.eta + dt > 3.5) {
          g.radio('Hammer Battery', 'Shot — out!');
          g.audio.incoming(new THREE.Vector3(m.x, g.world.h(m.x, m.z) + 20, m.z));
        }
        continue;
      }
      m.nextRound -= dt;
      if (m.nextRound <= 0 && m.fired < m.rounds) {
        m.nextRound = 0.35 + Math.random() * 0.5;
        m.fired++;
        this.land(m);
      }
      if (m.fired >= m.rounds) {
        this.missions.splice(i, 1);
        g.radio('Hammer Battery', 'Rounds complete. Battery out.');
      }
    }
  }

  private land(m: FireMission) {
    const g = this.g;
    const a = Math.random() * Math.PI * 2;
    const r = Math.sqrt(Math.random()) * m.radius;
    const x = m.x + Math.cos(a) * r;
    const z = m.z + Math.sin(a) * r;
    const y = g.world.h(x, z);
    const p = new THREE.Vector3(x, y, z);
    g.effects.explosion(p, 2.1, false);
    g.audio.explosion(p, 1.5);
    g.cameraShakeAt(p, 1.6);
    g.world.crushTrees(x, z, 7, 0, 1);

    // Generous blast: a concentration caught in the open must be decisive, otherwise the
    // 40-second delay and the three-mission limit buy the player nothing.
    const blast = 18;
    // infantry: lethal in the open, survivable prone
    for (const s of g.infantry.soldiers) {
      if (!s.active) continue;
      const d = Math.hypot(s.pos.x - x, s.pos.z - z);
      if (d > blast) {
        if (d < blast * 2.2) g.infantry.suppress(s, 2.5);
        continue;
      }
      const cover = s.stance === 'prone' ? 0.45 : 1;
      if (Math.random() < (1 - d / blast) * cover) g.infantry.killSoldier(s, s.side === 'enemy' ? m.callerId : null);
      else g.infantry.suppress(s, 3);
    }
    for (const n of g.infantry.nests) {
      if (!n.alive) continue;
      const d = Math.hypot(n.pos.x - x, n.pos.z - z);
      if (d < blast) g.weapons.damageNest(n, 60 * (1 - d / blast), null);
    }
    // tanks: shell splinters and the occasional direct hit
    for (const t of g.tanks) {
      if (!t.alive || t.gone) continue;
      const d = Math.hypot(t.pos.x - x, t.pos.z - z);
      if (d > blast) continue;
      const close = 1 - d / blast;
      const direct = d < t.def.radius + 2.2;
      // a heavy shell can break tracks and, on a direct hit, kill even a Bastion
      const dmg = direct ? 60 + Math.random() * 50 : close * 32;
      t.hp -= dmg;
      t.stress = Math.min(1, t.stress + 0.7);
      if (close > 0.4 && Math.random() < 0.4) t.tracksBroken = Math.max(t.tracksBroken, 9);
      if (t.isPlayer) {
        g.hud.damageFlash(Math.min(0.9, close));
        g.cameraShake(1.4);
        if (direct) g.hud.radio('Crew', 'Direct hit from our own guns! Get us out of here!');
      }
      t.refreshStatus();
      if (t.hp <= 0) {
        // credit the commander who called the fire mission, not whoever happens to be nearby
        const by = t.side === 'enemy' ? g.tanks.find((k) => k.side === 'ally' && k.commanderId === m.callerId) ?? null : null;
        g.weapons.knockOut(t, by, { severity: 1, penetrated: true, ammoDetonation: Math.random() < 0.25, crewCompartmentHit: direct, fire: Math.random() < 0.4, kind: 'destroyed' }, 'Artillery fire');
        if (t.side === 'enemy' && m.callerId && !by) g.tracker.enemyTanksDestroyed++;
      }
    }
  }
}
