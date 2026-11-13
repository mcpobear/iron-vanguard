import { ORIGINAL_COMMANDERS, REPLACEMENT_FIRST, REPLACEMENT_LAST, REPLACEMENT_ORIGINS, REPLACEMENT_PREV, REPLACEMENT_TRAITS } from '../data/commanders';
import { pick, makeRng, type Rng } from '../core/rng';
import type { CampaignState, Commander, PortraitSpec, TankRecord, PlatoonSlot } from './types';

export const SCHEMA_VERSION = 2;
export const CALLSIGNS = ['Vanguard 1-1', 'Vanguard 1-2', 'Vanguard 1-3', 'Vanguard 1-4'];
export const START_DATE = '1944-06-17';

function blankCommander(id: string, serviceNumber: string): Omit<Commander, 'firstName' | 'lastName' | 'rankIndex' | 'age' | 'bio' | 'personality' | 'ability' | 'abilityName' | 'abilityText' | 'portrait' | 'behaviour' | 'original'> {
  return {
    id,
    serviceNumber,
    xp: 0,
    missionsCompleted: 0,
    missionsSincePromotion: 0,
    tankKills: 0,
    lightTankKills: 0,
    mediumTankKills: 0,
    positionsDestroyed: 0,
    infantryKills: 0,
    achievements: [],
    medals: [],
    promotionHistory: [],
    appointmentHistory: [],
    missionHistory: [],
    status: 'active',
    woundedUntilMission: 0,
    promotionEligible: false,
    heldLeadership: false,
    kia: null,
  };
}

export function createTank(state: { nextTankSerial: number }, turretNumber: string): TankRecord {
  const serial = `T-${44000 + state.nextTankSerial}`;
  state.nextTankSerial++;
  return { id: `tank-${serial}`, serial, turretNumber, model: 'A-44', status: 'active', lostInMission: null, kills: 0 };
}

export function newCampaign(seed = Date.now()): CampaignState {
  const rng = makeRng(seed);
  const s: CampaignState = {
    schemaVersion: SCHEMA_VERSION,
    campaignId: `camp-${Math.floor(rng() * 1e9).toString(36)}`,
    createdAt: new Date().toISOString(),
    warDate: START_DATE,
    missionCounter: 0,
    status: 'active',
    completedMissions: [],
    committedResultIds: [],
    commanders: {},
    tanks: {},
    slots: [],
    platoonCommanderId: null,
    deputyId: null,
    cohesion: 55,
    rollOfHonour: [],
    missionStats: [],
    nextServiceNo: 1,
    nextTankSerial: 1,
    replacementsIssued: { commanders: 0, tanks: 0 },
    log: ['1944-06-17 — Vanguard 1 Platoon formed up at the regimental staging area, 3rd Armoured Regiment.'],
    pendingResult: null,
  };
  ORIGINAL_COMMANDERS.forEach((t, i) => {
    const sn = `AL-${(3170000 + [4182, 5527, 6094, 7731][i]).toString()}`;
    const id = `cmdr-${t.key}`;
    const c: Commander = {
      ...blankCommander(id, sn),
      firstName: t.firstName,
      lastName: t.lastName,
      rankIndex: t.rankIndex,
      age: t.age,
      bio: t.bio,
      personality: [...t.personality],
      ability: t.ability,
      abilityName: t.abilityName,
      abilityText: [...t.abilityText],
      portrait: { ...t.portrait },
      behaviour: { ...t.behaviour },
      original: true,
    };
    c.promotionHistory.push({ rankIndex: t.rankIndex, date: i === 3 ? '1944-04-02' : '1943-11-20', missionId: null, note: 'Rank held on joining Vanguard 1 Platoon' });
    c.appointmentHistory.push({ appointment: t.appointment, date: START_DATE, missionId: null });
    if (i <= 1) c.heldLeadership = true;
    s.commanders[id] = c;
    const tank = createTank(s, t.turretNumber);
    s.tanks[tank.id] = tank;
    s.slots.push({ callsign: t.callsign, commanderId: id, tankId: tank.id });
  });
  s.platoonCommanderId = 'cmdr-mercer';
  s.deputyId = 'cmdr-vale';
  return s;
}

export const fullName = (c: Commander) => `${c.firstName} ${c.lastName}`;

export function appointmentOf(s: CampaignState, id: string): string {
  if (s.platoonCommanderId === id) return 'Platoon Commander';
  if (s.deputyId === id) return 'Deputy Platoon Commander';
  const c = s.commanders[id];
  if (!c) return '';
  if (c.status === 'kia') return 'Killed in action';
  if (s.slots.some((sl) => sl.commanderId === id)) return 'Tank Commander';
  return c.status === 'wounded' ? 'Hospitalised' : 'Reserve';
}

/** Slots in command-succession order (the order in which the player takes over tanks). */
export function successionOrder(s: CampaignState): PlatoonSlot[] {
  return [...s.slots].filter((sl) => sl.commanderId && sl.tankId);
}

/**
 * During a mission: given the slot indices in succession order and a predicate telling
 * which tanks can still fight, return the index of the next tank the player should control.
 */
export function nextCommandIndex(order: number[], current: number, operational: (i: number) => boolean): number {
  const pos = order.indexOf(current);
  for (let k = 1; k <= order.length; k++) {
    const idx = order[(pos + k) % order.length];
    // Succession only moves "down" the chain first, then wraps to anyone left.
    if (operational(idx)) return idx;
  }
  return -1;
}

export const isAvailable = (s: CampaignState, c: Commander) => c.status === 'active' || (c.status === 'wounded' && c.woundedUntilMission <= s.missionCounter);

/** Seniority: rank, then missions, then xp. */
export function senioritySort(list: Commander[]): Commander[] {
  return [...list].sort((a, b) => b.rankIndex - a.rankIndex || b.missionsCompleted - a.missionsCompleted || b.xp - a.xp);
}

function randomPortrait(rng: Rng): PortraitSpec {
  return {
    skin: pick(rng, ['#f0c9a8', '#e2b48f', '#d9a47c', '#b9825c', '#8d5a3b', '#f3d2b5']),
    hair: pick(rng, ['#2a1d16', '#4a3324', '#8a4a26', '#c9a24a', '#5c5c5c', '#1a1a1a']),
    hairStyle: pick(rng, ['short', 'side', 'crop', 'swept', 'bald'] as const),
    face: pick(rng, ['square', 'long', 'round'] as const),
    brow: pick(rng, ['heavy', 'thin', 'arched'] as const),
    moustache: rng() < 0.3,
    scar: rng() < 0.15,
    eyes: pick(rng, ['#4a6a8a', '#3a2a1a', '#5a7a4a', '#6a5a3a']),
    headgear: pick(rng, ['beret', 'cap', 'headset'] as const),
  };
}

export function createReplacementCommander(s: CampaignState, rng: Rng = Math.random): Commander {
  const used = new Set(Object.values(s.commanders).map((c) => `${c.firstName} ${c.lastName}`));
  let first = pick(rng, REPLACEMENT_FIRST);
  let last = pick(rng, REPLACEMENT_LAST);
  for (let i = 0; i < 20 && used.has(`${first} ${last}`); i++) {
    first = pick(rng, REPLACEMENT_FIRST);
    last = pick(rng, REPLACEMENT_LAST);
  }
  const n = s.nextServiceNo++;
  const id = `cmdr-r${n}-${Math.floor(rng() * 1e6).toString(36)}`;
  const sn = `AL-${3290000 + n * 37 + Math.floor(rng() * 30)}`;
  const traits = pick(rng, REPLACEMENT_TRAITS);
  const age = 20 + Math.floor(rng() * 9);
  const c: Commander = {
    ...blankCommander(id, sn),
    firstName: first,
    lastName: last,
    rankIndex: 0,
    age,
    bio: `${first} ${last} comes from ${pick(rng, REPLACEMENT_ORIGINS)}. He ${pick(rng, REPLACEMENT_PREV)} before being posted to the 3rd Armoured Regiment as a replacement tank commander.`,
    personality: [...traits],
    ability: 'NONE',
    abilityName: 'None yet',
    abilityText: ['A new commander. Experience will shape his strengths.'],
    portrait: randomPortrait(rng),
    behaviour: {
      orderDelay: 1.3 + rng() * 0.3,
      acquireTime: 2.8 + rng() * 0.5,
      accuracy: 1.15 + rng() * 0.15,
      aggression: 0.3 + rng() * 0.4,
      discipline: 0.6 + rng() * 0.2,
      stressPenalty: 0.5 + rng() * 0.4,
    },
    original: false,
  };
  c.promotionHistory.push({ rankIndex: 0, date: s.warDate, missionId: null, note: 'Posted to Vanguard 1 Platoon as a replacement' });
  s.commanders[id] = c;
  s.replacementsIssued.commanders++;
  return c;
}

/**
 * Re-forms the platoon between missions: resolves command appointments, reassigns callsigns
 * by appointment and seniority, issues replacement tanks and replacement commanders.
 */
export function reorganisePlatoon(s: CampaignState, rng: Rng = Math.random): string[] {
  const notes: string[] = [];
  const pool = Object.values(s.commanders);
  const available = pool.filter((c) => isAvailable(s, c));

  // Appointments: platoon commander → deputy → seniority.
  const prevPC = s.platoonCommanderId;
  const pcAlive = prevPC && s.commanders[prevPC] && isAvailable(s, s.commanders[prevPC]);
  if (!pcAlive) {
    const deputy = s.deputyId && s.commanders[s.deputyId] && isAvailable(s, s.commanders[s.deputyId]) ? s.commanders[s.deputyId] : null;
    const next = deputy ?? senioritySort(available.filter((c) => c.id !== prevPC))[0] ?? null;
    if (prevPC && s.commanders[prevPC]?.status === 'kia' && next) {
      notes.push(`${rankText(next)} ${fullName(next)} appointed Platoon Commander following the death of ${fullName(s.commanders[prevPC])}.`);
    } else if (next && prevPC !== next.id) {
      notes.push(`${rankText(next)} ${fullName(next)} appointed Platoon Commander.`);
    }
    s.platoonCommanderId = next ? next.id : null;
    if (next) {
      next.heldLeadership = true;
      next.appointmentHistory.push({ appointment: 'Platoon Commander', date: s.warDate, missionId: null });
    }
    if (s.deputyId === s.platoonCommanderId) s.deputyId = null;
  }
  const depOk = s.deputyId && s.commanders[s.deputyId] && isAvailable(s, s.commanders[s.deputyId]) && s.deputyId !== s.platoonCommanderId;
  if (!depOk) {
    const nextDep = senioritySort(available.filter((c) => c.id !== s.platoonCommanderId))[0] ?? null;
    if (nextDep) {
      if (s.deputyId !== nextDep.id) {
        notes.push(`${rankText(nextDep)} ${fullName(nextDep)} appointed Deputy Platoon Commander.`);
        nextDep.appointmentHistory.push({ appointment: 'Deputy Platoon Commander', date: s.warDate, missionId: null });
      }
      nextDep.heldLeadership = true;
    }
    s.deputyId = nextDep ? nextDep.id : null;
  }

  // Keep existing slot members where possible (callsign follows appointment for 1-1 / 1-2).
  const currentMembers = s.slots.map((sl) => sl.commanderId).filter((id): id is string => !!id && isAvailable(s, s.commanders[id]));
  const members: string[] = [];
  if (s.platoonCommanderId) members.push(s.platoonCommanderId);
  if (s.deputyId) members.push(s.deputyId);
  for (const id of currentMembers) if (!members.includes(id)) members.push(id);
  // Fill gaps from reserve (recovered wounded), then replacements.
  for (const c of senioritySort(available)) if (members.length < 4 && !members.includes(c.id)) members.push(c.id);
  while (members.length < 4) {
    const r = createReplacementCommander(s, rng);
    members.push(r.id);
    notes.push(`Replacement commander ${rankText(r)} ${fullName(r)} (${r.serviceNumber}) posted to the platoon.`);
  }

  // Tanks: keep each commander's surviving tank, otherwise issue a replacement Sentinel.
  const prevTankOf = new Map<string, string | null>();
  s.slots.forEach((sl) => sl.commanderId && prevTankOf.set(sl.commanderId, sl.tankId));
  const usedTanks = new Set<string>();
  const newSlots: PlatoonSlot[] = members.slice(0, 4).map((id, i) => {
    let tankId = prevTankOf.get(id) ?? null;
    if (!tankId || s.tanks[tankId]?.status !== 'active' || usedTanks.has(tankId)) {
      // Reuse an orphaned surviving tank before issuing a new one.
      const orphan = Object.values(s.tanks).find((t) => t.status === 'active' && !usedTanks.has(t.id) && ![...prevTankOf.values()].includes(t.id));
      const fromDead = s.slots.find((sl) => sl.tankId && s.tanks[sl.tankId]?.status === 'active' && !usedTanks.has(sl.tankId) && !members.includes(sl.commanderId ?? ''));
      if (fromDead?.tankId) tankId = fromDead.tankId;
      else if (orphan) tankId = orphan.id;
      else {
        const t = createTank(s, String(101 + i));
        s.tanks[t.id] = t;
        s.replacementsIssued.tanks++;
        tankId = t.id;
        notes.push(`Replacement A-44 Sentinel ${t.serial} (turret ${t.turretNumber}) issued to ${fullName(s.commanders[id])}.`);
      }
    }
    usedTanks.add(tankId);
    return { callsign: CALLSIGNS[i], commanderId: id, tankId };
  });
  s.slots = newSlots;
  return notes;
}

import { rankAbbr } from '../data/ranks';
export const rankText = (c: Commander) => rankAbbr(c.rankIndex);
