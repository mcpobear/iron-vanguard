import type { MissionInfo, MissionScript } from './mission';
import { BELLWICK_INFO, BellwickMission } from './bellwick';
import { KESSLER_INFO, KesslerMission } from './kessler';

export interface MissionEntry {
  info: MissionInfo;
  create: () => MissionScript;
  /** Mission ids that must be completed before this one unlocks. */
  requires: string[];
}

export const MISSIONS: MissionEntry[] = [
  { info: BELLWICK_INFO, create: () => new BellwickMission(), requires: [] },
  { info: KESSLER_INFO, create: () => new KesslerMission(), requires: ['bellwick'] },
];

export const missionById = (id: string) => MISSIONS.find((m) => m.info.id === id);

/** The next mission the player can deploy on, or null if the campaign is finished. */
export function nextMission(completed: string[]): MissionEntry | null {
  return MISSIONS.find((m) => !completed.includes(m.info.id) && m.requires.every((r) => completed.includes(r))) ?? null;
}

export const isUnlocked = (m: MissionEntry, completed: string[]) => m.requires.every((r) => completed.includes(r));
