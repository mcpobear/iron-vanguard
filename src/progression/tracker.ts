import type { CommanderMissionStats, CrewOutcome, MissionResult, VehicleOutcome } from '../campaign/types';

export const XP = {
  KILL_LIGHT: 100,
  KILL_MEDIUM: 150,
  DAMAGE_HIT: 15,
  POSITION: 60,
  INFANTRY: 6,
  OBJECTIVE: 50,
  PROTECT: 12,
  SMOKE: 60,
  COORDINATED: 25,
};

/**
 * Records battle events per commander (by stable commander id, never callsign) and turns them
 * into a MissionResult. Contains no rendering code, so XP attribution is unit-tested.
 */
export class MissionTracker {
  readonly stats = new Map<string, CommanderMissionStats>();
  readonly order: string[] = [];
  objectivesCompleted: string[] = [];
  enemyTanksDestroyed = 0;
  enemyTanksDrivenOff = 0;
  positionsNeutralised = 0;
  formationTime = 0;
  formationGood = 0;
  ordersIssued = 0;
  ordersCompleted = 0;

  constructor(public missionId: string, public missionName: string) {}

  addCommander(commanderId: string, callsign: string, tankId: string) {
    this.order.push(commanderId);
    this.stats.set(commanderId, {
      commanderId,
      callsign,
      tankId,
      xp: 0,
      tankKills: 0,
      lightKills: 0,
      mediumKills: 0,
      damagingHits: 0,
      positions: 0,
      infantry: 0,
      protectionScore: 0,
      killsWhileDamaged: 0,
      smokeEffective: 0,
      coordinatedKills: 0,
      objectivesAsCommander: 0,
      shotsFired: 0,
      hits: 0,
      timeAsPlayer: 0,
      vehicle: 'operational',
      crew: 'unhurt',
      hpLeft: 100,
      causeOfLoss: null,
      xpLog: [],
    });
  }

  private give(id: string | null | undefined, xp: number, reason: string) {
    if (!id) return;
    const s = this.stats.get(id);
    if (!s) return;
    s.xp += xp;
    const last = s.xpLog.find((l) => l.reason === reason);
    if (last) last.xp += xp;
    else s.xpLog.push({ reason, xp });
  }

  get(id: string) {
    return this.stats.get(id);
  }

  tankKilled(killerId: string | null, cls: 'light' | 'medium', opts: { killerDamaged?: boolean; protecting?: boolean; coordinated?: boolean; designatorId?: string | null } = {}) {
    this.enemyTanksDestroyed++;
    const s = killerId ? this.stats.get(killerId) : undefined;
    if (!s) return;
    s.tankKills++;
    if (cls === 'light') s.lightKills++;
    else s.mediumKills++;
    s.hits++;
    this.give(killerId, cls === 'light' ? XP.KILL_LIGHT : XP.KILL_MEDIUM, cls === 'light' ? 'Light tanks destroyed' : 'Medium tanks destroyed');
    if (opts.killerDamaged) s.killsWhileDamaged++;
    if (opts.protecting) {
      s.protectionScore += 2;
      this.give(killerId, XP.PROTECT, 'Protecting friendly forces');
    }
    if (opts.coordinated && opts.designatorId && opts.designatorId !== killerId) {
      s.coordinatedKills++;
      this.give(killerId, XP.COORDINATED, 'Coordinated platoon fire');
      this.give(opts.designatorId, XP.COORDINATED, 'Coordinated platoon fire');
    }
  }

  damagingHit(shooterId: string | null) {
    const s = shooterId ? this.stats.get(shooterId) : undefined;
    if (!s) return;
    s.damagingHits++;
    s.hits++;
    this.give(shooterId, XP.DAMAGE_HIT, 'Damaging hits on enemy armour');
  }

  shotFired(id: string | null) {
    const s = id ? this.stats.get(id) : undefined;
    if (s) s.shotsFired++;
  }

  positionDestroyed(id: string | null, nearInfantry: boolean) {
    this.positionsNeutralised++;
    const s = id ? this.stats.get(id) : undefined;
    if (!s) return;
    s.positions++;
    this.give(id, XP.POSITION, 'Defensive positions neutralised');
    if (nearInfantry) {
      s.protectionScore += 3;
      this.give(id, XP.PROTECT, 'Protecting friendly forces');
    }
  }

  infantryKilled(id: string | null, nearAllies: boolean) {
    const s = id ? this.stats.get(id) : undefined;
    if (!s) return;
    s.infantry++;
    this.give(id, XP.INFANTRY, 'Enemy infantry suppressed');
    if (nearAllies) {
      s.protectionScore += 1;
      this.give(id, 4, 'Protecting friendly forces');
    }
  }

  smokeEffective(id: string | null) {
    const s = id ? this.stats.get(id) : undefined;
    if (!s) return;
    s.smokeEffective++;
    s.protectionScore += 3;
    this.give(id, XP.SMOKE, 'Effective smoke screen');
  }

  objectiveComplete(name: string, currentCommanderId: string | null) {
    if (this.objectivesCompleted.includes(name)) return;
    this.objectivesCompleted.push(name);
    const s = currentCommanderId ? this.stats.get(currentCommanderId) : undefined;
    if (s) s.objectivesAsCommander++;
    this.give(currentCommanderId, XP.OBJECTIVE, 'Objectives as acting commander');
  }

  setVehicle(id: string, v: VehicleOutcome, hp: number) {
    const s = this.stats.get(id);
    if (!s) return;
    const rank = { operational: 0, damaged: 1, disabled: 2, destroyed: 3 };
    if (rank[v] >= rank[s.vehicle]) s.vehicle = v;
    s.hpLeft = hp;
  }

  setCrew(id: string, c: CrewOutcome, cause: string | null) {
    const s = this.stats.get(id);
    if (!s) return;
    s.crew = c;
    s.causeOfLoss = cause;
  }

  result(success: boolean, durationSec: number, objectivesTotal: number, finalPCId: string | null): MissionResult {
    return {
      resultId: `${this.missionId}-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`,
      missionId: this.missionId,
      missionName: this.missionName,
      success,
      durationSec,
      objectivesCompleted: [...this.objectivesCompleted],
      objectivesTotal,
      enemyTanksDestroyed: this.enemyTanksDestroyed,
      enemyTanksDrivenOff: this.enemyTanksDrivenOff,
      positionsNeutralised: this.positionsNeutralised,
      formationScore: this.formationTime > 0 ? this.formationGood / this.formationTime : 0,
      ordersIssued: this.ordersIssued,
      ordersCompleted: this.ordersCompleted,
      commanders: this.order.map((id) => JSON.parse(JSON.stringify(this.stats.get(id)))),
      finalPlatoonCommanderId: finalPCId,
    };
  }
}
