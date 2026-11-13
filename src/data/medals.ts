// Fictional Alderland decorations. Award logic lives in progression/awards.ts
// and is driven by tracked mission events, never by chance.

export interface MedalDef {
  id: string;
  name: string;
  kind: 'decoration' | 'ribbon';
  tier: number; // higher = more prestigious
  description: string;
  criteria: string;
  ribbon: string[]; // stripe colours
  shape: 'star' | 'cross' | 'shield' | 'bar';
}

export const MEDALS: Record<string, MedalDef> = {
  STAR_OF_VALOUR: {
    id: 'STAR_OF_VALOUR',
    name: 'Star of Valour',
    kind: 'decoration',
    tier: 3,
    description: 'The Republic\'s highest award for bravery in the face of the enemy.',
    criteria: 'Destroyed two or more enemy tanks while his own vehicle was badly damaged, AND earned a protection score of 8 or more shielding allied troops in the same mission.',
    ribbon: ['#7a0f1d', '#e8c25a', '#7a0f1d'],
    shape: 'star',
  },
  ARMOURED_SERVICE_CROSS: {
    id: 'ARMOURED_SERVICE_CROSS',
    name: 'Armoured Service Cross',
    kind: 'decoration',
    tier: 2,
    description: 'Awarded for outstanding achievement in armoured combat.',
    criteria: 'Destroyed three or more enemy tanks in a single mission, or destroyed two medium tanks in a single mission.',
    ribbon: ['#1d3b6e', '#d8d8d8', '#1d3b6e'],
    shape: 'cross',
  },
  IRON_SHIELD: {
    id: 'IRON_SHIELD',
    name: 'Iron Shield Medal',
    kind: 'decoration',
    tier: 1,
    description: 'Awarded for exceptional protection of allied soldiers or fellow platoon members.',
    criteria: 'Earned a protection score of 6 or more in a single mission (enemy positions destroyed near friendly infantry, smoke screens that covered an advance, enemies destroyed while engaging a friendly tank).',
    ribbon: ['#3d4a3a', '#a0a0a0', '#3d4a3a', '#a0a0a0'],
    shape: 'shield',
  },
  BELLWICK_RIBBON: {
    id: 'BELLWICK_RIBBON',
    name: 'Bellwick Campaign Ribbon',
    kind: 'ribbon',
    tier: 0,
    description: 'For service in the liberation of Bellwick.',
    criteria: 'Took part in a successful Battle of Bellwick (awarded posthumously where applicable).',
    ribbon: ['#2f6b3a', '#f0e6c8', '#c23b2a', '#f0e6c8', '#2f6b3a'],
    shape: 'bar',
  },
  DAWN_SPEAR_RIBBON: {
    id: 'DAWN_SPEAR_RIBBON',
    name: 'Dawn Spear Service Ribbon',
    kind: 'ribbon',
    tier: 0,
    description: 'For participation in Operation Dawn Spear.',
    criteria: 'Took part in any completed Operation Dawn Spear mission.',
    ribbon: ['#e3a531', '#1d3b6e', '#e3a531'],
    shape: 'bar',
  },
};
