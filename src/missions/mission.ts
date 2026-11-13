import type * as THREE from 'three';
import type { Game } from '../game/game';
import type { Soldier } from '../infantry/infantry';
import type { MapDef } from './bellwickMap';

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
}

export interface MissionScript {
  info: MissionInfo;
  objectiveText: string;
  markers: Marker[];
  phaseIndex: number;
  start(g: Game): void;
  update(dt: number, g: Game): void;
  pinsInfantry(s: Soldier): boolean;
}
