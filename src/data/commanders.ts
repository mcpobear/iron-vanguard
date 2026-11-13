import type { AbilityId, BehaviourProfile, PortraitSpec } from '../campaign/types';

export interface CommanderTemplate {
  key: string;
  firstName: string;
  lastName: string;
  rankIndex: number;
  age: number;
  callsign: string;
  turretNumber: string;
  appointment: string;
  bio: string;
  personality: string[];
  ability: AbilityId;
  abilityName: string;
  abilityText: string[];
  portrait: PortraitSpec;
  behaviour: BehaviourProfile;
}

export const ORIGINAL_COMMANDERS: CommanderTemplate[] = [
  {
    key: 'mercer',
    firstName: 'Daniel',
    lastName: 'Mercer',
    rankIndex: 2,
    age: 32,
    callsign: 'Vanguard 1-1',
    turretNumber: '101',
    appointment: 'Platoon Commander',
    bio: 'A career soldier who joined the Alderland Army before the war. Mercer fought during the disastrous retreat of 1942 and earned a reputation for keeping his men alive under difficult circumstances.',
    personality: ['Calm', 'Disciplined', 'Protective of his subordinates', 'Occasionally overly cautious'],
    ability: 'VETERAN_LEADERSHIP',
    abilityName: 'Veteran Leadership',
    abilityText: ['AI tanks respond slightly faster to orders', 'Formation cohesion improves', 'Friendly crews gain a small situational-awareness bonus'],
    portrait: { skin: '#e2b48f', hair: '#4a3324', hairStyle: 'short', face: 'square', brow: 'heavy', moustache: true, scar: false, eyes: '#4a6a8a', headgear: 'beret' },
    behaviour: { orderDelay: 0.7, acquireTime: 2.2, accuracy: 1.0, aggression: 0.35, discipline: 0.95, stressPenalty: 0.2 },
  },
  {
    key: 'vale',
    firstName: 'Thomas',
    lastName: 'Vale',
    rankIndex: 1,
    age: 27,
    callsign: 'Vanguard 1-2',
    turretNumber: '102',
    appointment: 'Deputy Platoon Commander',
    bio: 'Formerly an armoured reconnaissance specialist, Vale is known for aggressive manoeuvres and an instinct for spotting enemy weaknesses.',
    personality: ['Confident', 'Impatient', 'Courageous', 'Competitive'],
    ability: 'HUNTERS_INSTINCT',
    abilityName: "Hunter's Instinct",
    abilityText: ['Slightly faster enemy target acquisition', 'Improved target tracking while moving', 'Small accuracy bonus against exposed enemy armour'],
    portrait: { skin: '#d9a47c', hair: '#c9a24a', hairStyle: 'swept', face: 'long', brow: 'arched', moustache: false, scar: true, eyes: '#5a7a4a', headgear: 'headset' },
    behaviour: { orderDelay: 0.9, acquireTime: 1.6, accuracy: 1.05, aggression: 0.8, discipline: 0.65, stressPenalty: 0.15 },
  },
  {
    key: 'bennett',
    firstName: 'Arthur',
    lastName: 'Bennett',
    rankIndex: 0,
    age: 24,
    callsign: 'Vanguard 1-3',
    turretNumber: '103',
    appointment: 'Tank Commander',
    bio: 'A technically gifted former mechanic who understands the Sentinel tank better than most of his peers. Particularly valuable during prolonged engagements.',
    personality: ['Methodical', 'Quiet', 'Reliable', 'Technically minded'],
    ability: 'MECHANICAL_EXPERTISE',
    abilityName: 'Mechanical Expertise',
    abilityText: ['Reduced probability of certain mechanical failures', 'Faster recovery from track or turret malfunctions', 'Improved ability to assess vehicle damage'],
    portrait: { skin: '#b9825c', hair: '#2a1d16', hairStyle: 'crop', face: 'round', brow: 'thin', moustache: false, scar: false, eyes: '#3a2a1a', headgear: 'cap' },
    behaviour: { orderDelay: 1.0, acquireTime: 2.4, accuracy: 0.95, aggression: 0.3, discipline: 0.85, stressPenalty: 0.2 },
  },
  {
    key: 'ward',
    firstName: 'Elias',
    lastName: 'Ward',
    rankIndex: 0,
    age: 22,
    callsign: 'Vanguard 1-4',
    turretNumber: '104',
    appointment: 'Tank Commander',
    bio: 'The youngest commander in the platoon. Recently promoted after demonstrating exceptional gunnery skills during training. Ward has significant potential for future development.',
    personality: ['Enthusiastic', 'Inexperienced', 'Loyal', 'Occasionally nervous under fire'],
    ability: 'NATURAL_GUNNER',
    abilityName: 'Natural Gunner',
    abilityText: ['Improved aiming accuracy when stationary', 'Faster gun laying against stationary targets', 'Small bonus to long-range shooting'],
    portrait: { skin: '#f0c9a8', hair: '#8a4a26', hairStyle: 'side', face: 'round', brow: 'thin', moustache: false, scar: false, eyes: '#4a7aa0', headgear: 'beret' },
    behaviour: { orderDelay: 1.2, acquireTime: 2.6, accuracy: 0.8, aggression: 0.45, discipline: 0.75, stressPenalty: 0.9 },
  },
];

// Pools for replacement personnel — combined procedurally, never cloned from the originals.
export const REPLACEMENT_FIRST = ['Harold', 'Simon', 'Peter', 'Owen', 'Frederick', 'Victor', 'Leonard', 'Hugh', 'Martin', 'Calvin', 'Rupert', 'Graham', 'Ivor', 'Stanley', 'Wilfred', 'Ronald'];
export const REPLACEMENT_LAST = ['Ashby', 'Calloway', 'Pryce', 'Hollis', 'Draycott', 'Fenwick', 'Marlow', 'Thorne', 'Kettering', 'Lyle', 'Ostler', 'Brannock', 'Whitlow', 'Corran', 'Ferris', 'Haldane'];
export const REPLACEMENT_ORIGINS = [
  'a farming district in the Alder valley',
  'the port city of Saltmere',
  'the industrial suburbs of Kessing',
  'a mining town in the northern hills',
  'the capital, Aldenmoor',
  'a fishing village on the western coast',
];
export const REPLACEMENT_PREV = [
  'served as a driver in the 5th Armoured Regiment',
  'completed the accelerated commanders\' course at Fort Harrow',
  'was a loader with an independent tank company',
  'transferred from the armoured car squadrons',
  'was an instructor at the Royal Gunnery School',
];
export const REPLACEMENT_TRAITS = [
  ['Steady', 'Reserved', 'Cautious'],
  ['Eager', 'Talkative', 'Bold'],
  ['Stubborn', 'Brave', 'Blunt'],
  ['Thoughtful', 'Precise', 'Slow to trust'],
  ['Cheerful', 'Resilient', 'Impulsive'],
];
