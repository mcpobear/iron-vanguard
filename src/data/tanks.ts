// Data-driven vehicle definitions. Armour values are in "arcade mm".

export type AmmoType = 'AP' | 'HE' | 'SMOKE';

export interface GunDef {
  calibre: number;
  reload: number; // seconds
  /** Penetration per ammo type (AP is the anti-tank round). */
  pen: Record<AmmoType, number>;
  damage: Record<AmmoType, number>;
  velocity: Record<AmmoType, number>; // m/s (arcade-scaled)
  splash: Record<AmmoType, number>; // metres
  baseSpread: number; // radians at rest
}

export interface TankDef {
  id: string;
  name: string;
  nation: 'alderland' | 'varkovia';
  cls: 'light' | 'medium';
  hp: number;
  armour: { front: number; side: number; rear: number; turret: number };
  maxSpeed: number; // m/s forward on road
  maxReverse: number;
  accel: number;
  turnRate: number; // rad/s
  turretTraverse: number; // rad/s
  gunElevMin: number;
  gunElevMax: number;
  gun: GunDef;
  ammo: Record<AmmoType, number>;
  mgBelts: number;
  mgBeltSize: number;
  hull: { length: number; width: number; height: number };
  radius: number;
  colour: number;
  spotRange: number;
  xpValue: number;
}

export const TANKS: Record<string, TankDef> = {
  'A-44': {
    id: 'A-44',
    name: 'A-44 Sentinel',
    nation: 'alderland',
    cls: 'medium',
    hp: 100,
    armour: { front: 95, side: 50, rear: 35, turret: 85 },
    maxSpeed: 11,
    maxReverse: 4,
    accel: 2.6,
    turnRate: 0.75,
    turretTraverse: 0.9,
    gunElevMin: -0.14,
    gunElevMax: 0.33,
    gun: {
      calibre: 75,
      reload: 4.2,
      pen: { AP: 120, HE: 40, SMOKE: 0 },
      damage: { AP: 42, HE: 30, SMOKE: 0 },
      velocity: { AP: 420, HE: 320, SMOKE: 260 },
      splash: { AP: 0, HE: 6, SMOKE: 0 },
      baseSpread: 0.0035,
    },
    ammo: { AP: 40, HE: 24, SMOKE: 10 },
    mgBelts: 8,
    mgBeltSize: 150,
    hull: { length: 6.4, width: 3.1, height: 1.6 },
    radius: 3.3,
    colour: 0x5d7a3a,
    spotRange: 340,
    xpValue: 0,
  },
  'V-32': {
    id: 'V-32',
    name: 'V-32 Boar',
    nation: 'varkovia',
    cls: 'light',
    hp: 60,
    armour: { front: 40, side: 25, rear: 18, turret: 35 },
    maxSpeed: 13,
    maxReverse: 5,
    accel: 3.4,
    turnRate: 1.0,
    turretTraverse: 0.65,
    gunElevMin: -0.12,
    gunElevMax: 0.3,
    gun: {
      calibre: 45,
      reload: 3.6,
      pen: { AP: 60, HE: 25, SMOKE: 0 },
      damage: { AP: 18, HE: 14, SMOKE: 0 },
      velocity: { AP: 330, HE: 280, SMOKE: 240 },
      splash: { AP: 0, HE: 4, SMOKE: 0 },
      baseSpread: 0.012,
    },
    ammo: { AP: 60, HE: 30, SMOKE: 0 },
    mgBelts: 6,
    mgBeltSize: 150,
    hull: { length: 4.8, width: 2.5, height: 1.3 },
    radius: 2.6,
    colour: 0x6f6e64,
    spotRange: 240,
    xpValue: 100,
  },
  'V-41': {
    id: 'V-41',
    name: 'V-41 Ox',
    nation: 'varkovia',
    cls: 'medium',
    hp: 95,
    armour: { front: 70, side: 40, rear: 28, turret: 65 },
    maxSpeed: 8,
    maxReverse: 3.2,
    accel: 1.9,
    turnRate: 0.55,
    turretTraverse: 0.45,
    gunElevMin: -0.12,
    gunElevMax: 0.3,
    gun: {
      calibre: 76,
      reload: 5.6,
      pen: { AP: 100, HE: 38, SMOKE: 0 },
      damage: { AP: 30, HE: 22, SMOKE: 0 },
      velocity: { AP: 360, HE: 300, SMOKE: 240 },
      splash: { AP: 0, HE: 5, SMOKE: 0 },
      baseSpread: 0.01,
    },
    ammo: { AP: 50, HE: 30, SMOKE: 0 },
    mgBelts: 6,
    mgBeltSize: 150,
    hull: { length: 6.2, width: 3.2, height: 1.7 },
    radius: 3.3,
    colour: 0x7a6a52,
    spotRange: 260,
    xpValue: 150,
  },
};
