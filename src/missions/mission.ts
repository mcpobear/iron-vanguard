import type * as THREE from 'three';
import type { Game } from '../game/game';
import type { Soldier } from '../infantry/infantry';
import type { MapDef } from './mapTypes';

export interface Marker {
  id: string;
  label: string;
  pos: () => THREE.Vector3 | null;
  kind: 'objective' | 'enemy' | 'zone';
  radius?: number;
}

export interface MissionInfo {
  id: string;
  name: string;
  campaign: string;
  location: string;
  time: string;
  weather: string;
  difficulty: string;
  duration: string;
  briefing: string[];
  objectives: string[];
  map: MapDef;
  fog: { color: number; near: number; far: number };
  /** Place names drawn on the tactical map. */
  mapLabels?: { text: string; x: number; z: number }[];
  /** Shown on the mission card in the staging area. */
  order: number;
  /** Multiplier on enemy crew quality for this mission (1 = baseline). */
  enemySkill?: number;
  forces?: { friendly: string; enemy: string };
  /** Headline on the mission-complete panel, e.g. 'BELLWICK LIBERATED'. */
  victoryTitle: string;
}

export interface MissionScript {
  info: MissionInfo;
  /** Where the platoon deploys, and which way it faces. */
  playerStart: { x: number; z: number; heading: number };
  /** Point the end-of-mission camera orbits. Defaults to the player's tank. */
  victoryFocus?: { x: number; z: number };
  /** Optional per-mission scenery (gun lines, wrecks) added once at load. */
  buildScenery?(g: Game): void;
  objectiveText: string;
  markers: Marker[];
  phaseIndex: number;
  start(g: Game): void;
  update(dt: number, g: Game): void;
  pinsInfantry(s: Soldier): boolean;
}
