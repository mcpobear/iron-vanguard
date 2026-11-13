// Rank ladder inspired by the SAF Warrant Officer & Specialist Corps.
// Thresholds increase progressively; promotions are decided after missions only.

export interface RankDef {
  index: number;
  abbr: string;
  name: string;
  /** Cumulative XP required to be considered. */
  xp: number;
  /** Completed missions required. */
  missions: number;
  /** Minimum missions served since the previous promotion. */
  missionsSinceLast: number;
  /** Requires having held a platoon command/deputy appointment. */
  needsLeadership: boolean;
}

export const RANKS: RankDef[] = [
  { index: 0, abbr: '3SG', name: 'Third Sergeant', xp: 0, missions: 0, missionsSinceLast: 0, needsLeadership: false },
  { index: 1, abbr: '2SG', name: 'Second Sergeant', xp: 900, missions: 2, missionsSinceLast: 2, needsLeadership: false },
  { index: 2, abbr: '1SG', name: 'First Sergeant', xp: 2200, missions: 4, missionsSinceLast: 2, needsLeadership: false },
  { index: 3, abbr: 'SSG', name: 'Staff Sergeant', xp: 4200, missions: 7, missionsSinceLast: 3, needsLeadership: false },
  { index: 4, abbr: 'MSG', name: 'Master Sergeant', xp: 7000, missions: 10, missionsSinceLast: 3, needsLeadership: true },
  { index: 5, abbr: '3WO', name: 'Third Warrant Officer', xp: 11000, missions: 14, missionsSinceLast: 4, needsLeadership: true },
  { index: 6, abbr: '2WO', name: 'Second Warrant Officer', xp: 16000, missions: 18, missionsSinceLast: 4, needsLeadership: true },
  { index: 7, abbr: '1WO', name: 'First Warrant Officer', xp: 22000, missions: 23, missionsSinceLast: 5, needsLeadership: true },
];

export const rankAbbr = (i: number) => RANKS[Math.max(0, Math.min(RANKS.length - 1, i))].abbr;
export const rankName = (i: number) => RANKS[Math.max(0, Math.min(RANKS.length - 1, i))].name;
