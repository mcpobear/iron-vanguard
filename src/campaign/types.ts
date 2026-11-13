// Pure campaign data types. No rendering imports here so this layer is unit-testable.

export type AbilityId = 'VETERAN_LEADERSHIP' | 'HUNTERS_INSTINCT' | 'MECHANICAL_EXPERTISE' | 'NATURAL_GUNNER' | 'NONE';

export interface PortraitSpec {
  skin: string;
  hair: string;
  hairStyle: 'short' | 'side' | 'crop' | 'swept' | 'bald';
  face: 'square' | 'long' | 'round';
  brow: 'heavy' | 'thin' | 'arched';
  moustache: boolean;
  scar: boolean;
  eyes: string;
  headgear: 'beret' | 'cap' | 'headset';
}

export interface BehaviourProfile {
  /** Seconds before reacting to an order. */
  orderDelay: number;
  /** Seconds to acquire a spotted target. */
  acquireTime: number;
  /** Multiplier on gun spread (lower is better). */
  accuracy: number;
  /** 0..1 tendency to advance on enemies. */
  aggression: number;
  /** 0..1 how tightly the formation slot is held. */
  discipline: number;
  /** Extra reaction delay when under fire. */
  stressPenalty: number;
}

export interface MedalAward {
  medalId: string;
  missionId: string;
  date: string;
  posthumous: boolean;
  citation: string;
}

export interface PromotionRecord {
  rankIndex: number;
  date: string;
  missionId: string | null;
  note: string;
}

export interface MissionRecord {
  missionId: string;
  missionName: string;
  date: string;
  callsign: string;
  tankId: string;
  xp: number;
  tankKills: number;
  outcome: string; // e.g. "Survived", "Wounded", "Killed in action"
}

export type ServiceStatus = 'active' | 'wounded' | 'kia';

export interface Commander {
  id: string;
  serviceNumber: string;
  firstName: string;
  lastName: string;
  rankIndex: number;
  age: number;
  bio: string;
  personality: string[];
  ability: AbilityId;
  abilityName: string;
  abilityText: string[];
  portrait: PortraitSpec;
  behaviour: BehaviourProfile;
  original: boolean;
  xp: number;
  missionsCompleted: number;
  missionsSincePromotion: number;
  tankKills: number;
  lightTankKills: number;
  mediumTankKills: number;
  heavyTankKills: number;
  positionsDestroyed: number;
  infantryKills: number;
  achievements: string[];
  medals: MedalAward[];
  promotionHistory: PromotionRecord[];
  appointmentHistory: { appointment: string; date: string; missionId: string | null }[];
  missionHistory: MissionRecord[];
  status: ServiceStatus;
  woundedUntilMission: number; // campaign mission counter when available again
  promotionEligible: boolean;
  heldLeadership: boolean;
  kia: null | {
    missionId: string;
    missionName: string;
    date: string;
    rankAtDeath: number;
    tankId: string;
    callsign: string;
    cause: string;
  };
}

export interface TankRecord {
  id: string;
  serial: string;
  turretNumber: string;
  model: string;
  status: 'active' | 'destroyed';
  lostInMission: string | null;
  kills: number;
}

export type Appointment = 'Platoon Commander' | 'Deputy Platoon Commander' | 'Tank Commander' | 'Acting Platoon Commander';

export interface PlatoonSlot {
  callsign: string; // Vanguard 1-1 .. 1-4
  commanderId: string | null;
  tankId: string | null;
}

export interface CampaignState {
  schemaVersion: number;
  campaignId: string;
  createdAt: string;
  /** In-world date for records. */
  warDate: string;
  missionCounter: number;
  status: 'active' | 'over';
  completedMissions: string[];
  committedResultIds: string[];
  commanders: Record<string, Commander>;
  tanks: Record<string, TankRecord>;
  slots: PlatoonSlot[];
  platoonCommanderId: string | null;
  deputyId: string | null;
  cohesion: number;
  rollOfHonour: string[];
  missionStats: {
    missionId: string;
    resultId: string;
    date: string;
    durationSec: number;
    enemyTanksDestroyed: number;
    positionsNeutralised: number;
    friendlyTanksLost: number;
    commandersKilled: number;
  }[];
  nextServiceNo: number;
  nextTankSerial: number;
  replacementsIssued: { commanders: number; tanks: number };
  log: string[];
  /** A finished mission whose debrief has not yet been confirmed. Prevents dodging outcomes by reloading. */
  pendingResult: MissionResult | null;
}

/** Commander outcome when his tank is knocked out. */
export type CrewOutcome = 'unhurt' | 'wounded' | 'incapacitated' | 'killed';
export type VehicleOutcome = 'operational' | 'damaged' | 'disabled' | 'destroyed';

export interface CommanderMissionStats {
  commanderId: string;
  callsign: string;
  tankId: string;
  xp: number;
  tankKills: number;
  lightKills: number;
  mediumKills: number;
  heavyKills: number;
  damagingHits: number;
  positions: number;
  infantry: number;
  protectionScore: number;
  killsWhileDamaged: number;
  smokeEffective: number;
  coordinatedKills: number;
  objectivesAsCommander: number;
  shotsFired: number;
  hits: number;
  timeAsPlayer: number;
  vehicle: VehicleOutcome;
  crew: CrewOutcome;
  hpLeft: number;
  causeOfLoss: string | null;
  xpLog: { reason: string; xp: number }[];
}

export interface MissionResult {
  resultId: string;
  missionId: string;
  missionName: string;
  success: boolean;
  durationSec: number;
  objectivesCompleted: string[];
  objectivesTotal: number;
  enemyTanksDestroyed: number;
  enemyTanksDrivenOff: number;
  positionsNeutralised: number;
  formationScore: number; // 0..1 fraction of time AI held formation when ordered
  ordersIssued: number;
  ordersCompleted: number;
  commanders: CommanderMissionStats[];
  finalPlatoonCommanderId: string | null; // acting commander at end
}
