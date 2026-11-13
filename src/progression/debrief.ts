import type { CampaignState, Commander, CommanderMissionStats, MissionResult, MedalAward } from '../campaign/types';
import { RANKS, rankAbbr } from '../data/ranks';
import { MEDALS } from '../data/medals';
import { fullName, reorganisePlatoon, isAvailable } from '../campaign/campaign';
import { makeRng } from '../core/rng';

export const MISSION_COMPLETION_XP = 120;

export interface CommanderReport {
  commanderId: string;
  name: string;
  rankBefore: number;
  rankAfter: number;
  xpGained: number;
  xpLog: { reason: string; xp: number }[];
  outcome: string;
  killed: boolean;
  newMedals: MedalAward[];
  promotionEligible: boolean;
  promoted: boolean;
  promotionNote: string;
}

export interface DebriefReport {
  resultId: string;
  commanders: CommanderReport[];
  cohesionBefore: number;
  cohesionAfter: number;
  cohesionNotes: string[];
  personnelNotes: string[];
  newPlatoonCommanderId: string | null;
  platoonCommanderKilled: boolean;
  tanksLost: number;
}

export function deepClone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v));
}

function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

export function outcomeText(st: CommanderMissionStats): string {
  if (st.crew === 'killed') return 'Killed in action';
  if (st.crew === 'incapacitated') return 'Seriously wounded';
  if (st.crew === 'wounded') return 'Wounded';
  if (st.vehicle === 'destroyed') return 'Survived — tank destroyed';
  if (st.vehicle === 'disabled') return 'Survived — tank disabled';
  return 'Survived';
}

/** Event-driven award conditions. Returns medal ids earned this mission. */
export function evaluateAwards(st: CommanderMissionStats, missionId: string, success: boolean): string[] {
  const out: string[] = [];
  if (st.killsWhileDamaged >= 2 && st.protectionScore >= 8) out.push('STAR_OF_VALOUR');
  if (st.tankKills >= 3 || st.mediumKills >= 2 || st.heavyKills >= 1) out.push('ARMOURED_SERVICE_CROSS');
  if (st.protectionScore >= 6) out.push('IRON_SHIELD');
  if (st.heavyKills >= 1) out.push('GUNNERS_LAUREL');
  if (success && missionId === 'bellwick') out.push('BELLWICK_RIBBON');
  if (success && missionId === 'kessler') out.push('KESSLER_RIBBON');
  if (success) out.push('DAWN_SPEAR_RIBBON');
  return out;
}

function citationFor(medalId: string, c: Commander, st: CommanderMissionStats, missionName: string): string {
  const n = `${rankAbbr(c.rankIndex)} ${fullName(c)}`;
  switch (medalId) {
    case 'STAR_OF_VALOUR':
      return `At ${missionName}, ${n} remained in action in a badly damaged tank, destroying ${st.killsWhileDamaged} enemy tanks while shielding allied troops at great personal risk.`;
    case 'ARMOURED_SERVICE_CROSS':
      return `At ${missionName}, ${n} destroyed ${st.tankKills} enemy tanks (${st.mediumKills} medium, ${st.heavyKills} heavy) in a single engagement.`;
    case 'GUNNERS_LAUREL':
      return `At ${missionName}, ${n} knocked out ${st.heavyKills > 1 ? `${st.heavyKills} enemy heavy tanks` : 'an enemy heavy tank'} in open battle.`;
    case 'IRON_SHIELD':
      return `At ${missionName}, ${n} repeatedly protected allied soldiers and fellow crews (protection score ${st.protectionScore}).`;
    default:
      return `Service in ${missionName}.`;
  }
}

/** Mission performance rating 0..3 used by the promotion board. */
export function performanceRating(st: CommanderMissionStats): number {
  const combat = st.xp;
  if (combat >= 450) return 3;
  if (combat >= 250) return 2;
  if (combat >= 100) return 1;
  return 0;
}

export function isPromotionEligible(c: Commander): boolean {
  const next = RANKS[c.rankIndex + 1];
  if (!next) return false;
  return c.xp >= next.xp && c.missionsCompleted >= next.missions && c.missionsSincePromotion >= next.missionsSinceLast && (!next.needsLeadership || c.heldLeadership);
}

/**
 * Applies a finished mission to a campaign state. Mutates `s`. Idempotent: a result id that was
 * already committed is ignored, so re-opening a debrief can never award XP or medals twice.
 */
export function commitResult(s: CampaignState, r: MissionResult): DebriefReport {
  const report: DebriefReport = {
    resultId: r.resultId,
    commanders: [],
    cohesionBefore: s.cohesion,
    cohesionAfter: s.cohesion,
    cohesionNotes: [],
    personnelNotes: [],
    newPlatoonCommanderId: s.platoonCommanderId,
    platoonCommanderKilled: false,
    tanksLost: 0,
  };
  if (s.committedResultIds.includes(r.resultId)) return report;
  const rng = makeRng(hashString(r.resultId));
  const date = s.warDate;

  let kiaCount = 0;
  let veteranKia = 0;
  for (const st of r.commanders) {
    const c = s.commanders[st.commanderId];
    if (!c) continue;
    const rankBefore = c.rankIndex;
    const log = [...st.xpLog];
    let xp = st.xp;
    if (r.success) {
      log.push({ reason: 'Mission completion', xp: MISSION_COMPLETION_XP });
      xp += MISSION_COMPLETION_XP;
    }
    c.xp += xp;
    c.tankKills += st.tankKills;
    c.lightTankKills += st.lightKills;
    c.mediumTankKills += st.mediumKills;
    c.heavyTankKills += st.heavyKills;
    c.positionsDestroyed += st.positions;
    c.infantryKills += st.infantry;
    if (r.success) {
      c.missionsCompleted += 1;
      c.missionsSincePromotion += 1;
    }
    const tank = s.tanks[st.tankId];
    if (tank) tank.kills += st.tankKills;
    if (st.vehicle === 'destroyed' && tank && tank.status === 'active') {
      tank.status = 'destroyed';
      tank.lostInMission = r.missionId;
      report.tanksLost++;
    }

    // Achievements (persisted, descriptive).
    if (st.tankKills > 0 && !c.achievements.includes('First Blood')) c.achievements.push('First Blood');
    if (st.smokeEffective > 0 && !c.achievements.includes('Smoke Screen')) c.achievements.push('Smoke Screen');
    if (st.positions > 0 && !c.achievements.includes('Bunker Buster')) c.achievements.push('Bunker Buster');
    if (st.heavyKills > 0 && !c.achievements.includes('Bastion Breaker')) c.achievements.push('Bastion Breaker');
    if (st.timeAsPlayer > 0 && st.commanderId !== r.commanders[0]?.commanderId && !c.achievements.includes('Took Command Under Fire')) c.achievements.push('Took Command Under Fire');

    const killed = st.crew === 'killed';
    const medals: MedalAward[] = [];
    for (const id of evaluateAwards(st, r.missionId, r.success)) {
      const isRibbon = MEDALS[id].kind === 'ribbon';
      if (isRibbon && c.medals.some((m) => m.medalId === id)) continue;
      const m: MedalAward = { medalId: id, missionId: r.missionId, date, posthumous: killed, citation: citationFor(id, c, st, r.missionName) };
      c.medals.push(m);
      medals.push(m);
    }

    c.missionHistory.push({ missionId: r.missionId, missionName: r.missionName, date, callsign: st.callsign, tankId: st.tankId, xp, tankKills: st.tankKills, outcome: outcomeText(st) });

    let promoted = false;
    let promotionNote = '';
    if (killed) {
      kiaCount++;
      if (c.original || c.missionsCompleted >= 2) veteranKia++;
      c.status = 'kia';
      c.kia = { missionId: r.missionId, missionName: r.missionName, date, rankAtDeath: c.rankIndex, tankId: st.tankId, callsign: st.callsign, cause: st.causeOfLoss ?? 'Enemy action' };
      if (!s.rollOfHonour.includes(c.id)) s.rollOfHonour.push(c.id);
      if (s.platoonCommanderId === c.id) report.platoonCommanderKilled = true;
      c.promotionEligible = false;
      s.log.push(`${date} — ${rankAbbr(c.rankIndex)} ${fullName(c)} killed in action at ${r.missionName}.`);
    } else {
      if (st.crew === 'incapacitated') {
        c.status = 'wounded';
        c.woundedUntilMission = s.missionCounter + 2;
      } else if (st.crew === 'wounded') {
        c.status = 'wounded';
        c.woundedUntilMission = s.missionCounter + 1;
      }
      // Promotion board: eligibility is necessary but not sufficient.
      const wasEligible = c.promotionEligible;
      const eligible = isPromotionEligible(c);
      if (eligible && (performanceRating(st) >= 2 || wasEligible)) {
        c.rankIndex += 1;
        c.missionsSincePromotion = 0;
        c.promotionHistory.push({ rankIndex: c.rankIndex, date, missionId: r.missionId, note: `Promoted following ${r.missionName}` });
        promoted = true;
        promotionNote = `Promoted to ${RANKS[c.rankIndex].name}`;
        c.promotionEligible = isPromotionEligible(c);
      } else {
        c.promotionEligible = eligible;
        const next = RANKS[c.rankIndex + 1];
        promotionNote = eligible ? 'Eligible — recommended for the next promotion board' : next ? `Not yet eligible for ${next.abbr} (${c.xp}/${next.xp} XP, ${c.missionsCompleted}/${next.missions} missions)` : 'Highest rank';
      }
    }
    report.commanders.push({
      commanderId: c.id,
      name: fullName(c),
      rankBefore,
      rankAfter: c.rankIndex,
      xpGained: xp,
      xpLog: log,
      outcome: outcomeText(st),
      killed,
      newMedals: medals,
      promotionEligible: c.promotionEligible,
      promoted,
      promotionNote,
    });
  }

  // Cohesion.
  let d = 0;
  if (r.success) {
    d += 4;
    report.cohesionNotes.push('+4 mission completed together');
  }
  const fs = Math.round(r.formationScore * 4);
  if (fs) {
    d += fs;
    report.cohesionNotes.push(`+${fs} formation discipline`);
  }
  const oc = Math.min(3, Math.round(r.ordersCompleted * 0.4));
  if (oc) {
    d += oc;
    report.cohesionNotes.push(`+${oc} orders executed`);
  }
  if (veteranKia) {
    d -= veteranKia * 9;
    report.cohesionNotes.push(`−${veteranKia * 9} loss of experienced commander${veteranKia > 1 ? 's' : ''}`);
  }
  if (kiaCount - veteranKia > 0) {
    d -= (kiaCount - veteranKia) * 5;
    report.cohesionNotes.push(`−${(kiaCount - veteranKia) * 5} commander losses`);
  }
  if (report.tanksLost) {
    d -= report.tanksLost * 2;
    report.cohesionNotes.push(`−${report.tanksLost * 2} vehicles lost`);
  }

  s.missionStats.push({
    missionId: r.missionId,
    resultId: r.resultId,
    date,
    durationSec: r.durationSec,
    enemyTanksDestroyed: r.enemyTanksDestroyed,
    positionsNeutralised: r.positionsNeutralised,
    friendlyTanksLost: report.tanksLost,
    commandersKilled: kiaCount,
  });
  if (r.success && !s.completedMissions.includes(r.missionId)) s.completedMissions.push(r.missionId);
  s.missionCounter += 1;
  s.committedResultIds.push(r.resultId);
  s.pendingResult = null;

  // Command appointments and replacements.
  const before = new Set(Object.keys(s.commanders));
  report.personnelNotes = reorganisePlatoon(s, rng);
  const newcomers = Object.keys(s.commanders).filter((id) => !before.has(id)).length;
  if (newcomers) {
    d -= newcomers * 2;
    report.cohesionNotes.push(`−${newcomers * 2} new replacement personnel`);
  }
  s.cohesion = Math.max(0, Math.min(100, s.cohesion + d));
  report.cohesionAfter = s.cohesion;
  report.newPlatoonCommanderId = s.platoonCommanderId;
  if (!s.slots.some((sl) => sl.commanderId && isAvailable(s, s.commanders[sl.commanderId]))) s.status = 'over';
  s.warDate = advanceDate(s.warDate, 3);
  s.log.push(`${date} — ${r.missionName}: ${r.success ? 'mission complete' : 'mission failed'}.`);
  return report;
}

export function advanceDate(d: string, days: number): string {
  const t = new Date(d + 'T00:00:00Z');
  t.setUTCDate(t.getUTCDate() + days);
  return t.toISOString().slice(0, 10);
}

/** Preview the debrief without touching the real campaign. */
export function previewResult(s: CampaignState, r: MissionResult): { report: DebriefReport; after: CampaignState } {
  const clone = deepClone(s);
  const report = commitResult(clone, r);
  return { report, after: clone };
}
