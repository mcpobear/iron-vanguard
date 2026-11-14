import { type MapDef, mirrorDef } from './mapTypes';

/**
 * Ardenne Farm: a walled farm on a low knoll beside a crossroads, with three ways in.
 *  - North: the main road across open wheat — long fields of fire, and the enemy's best tank country.
 *  - East: a track that comes out of a gap between two woods, about 130 m from the farm.
 *  - West: a lane through hedged meadows and an orchard — the closest covered approach.
 * The road south is the lifeline the relief column comes up.
 */
const RAW: MapDef = {
  half: 300,
  grass: 0x7a9c4c,
  sky: 0xbfcbd6,
  shape: (x, z, base) => {
    // the farm sits on a gentle rise; the ground falls away on every side
    const r2 = (x + 20) * (x + 20) + (z + 14) * (z + 14);
    return base * 0.45 + 5.5 * Math.exp(-r2 / (2 * 105 * 105));
  },
  roads: [
    { pts: [[4, -300], [0, -200], [-3, -100], [0, -40], [0, 40], [5, 120], [0, 210], [-6, 300]], width: 7, main: true },
    { pts: [[-300, 6], [-200, 0], [-100, 4], [0, 0], [100, -4], [200, 2], [300, -4]], width: 6 },
    // farm drive into the yard
    { pts: [[0, -26], [-22, -30], [-40, -32]], width: 5 },
  ],
  fields: [
    { minX: -20, maxX: 250, minZ: 62, maxZ: 270, kind: 'wheat' },
    { minX: -250, maxX: -24, minZ: 110, maxZ: 270, kind: 'plough' },
    { minX: 60, maxX: 260, minZ: -150, maxZ: -12, kind: 'pasture' },
    { minX: 60, maxX: 260, minZ: 10, maxZ: 58, kind: 'meadow' },
    { minX: -260, maxX: -64, minZ: 12, maxZ: 46, kind: 'meadow' },
    { minX: -260, maxX: -64, minZ: -150, maxZ: -8, kind: 'pasture' },
    { minX: -200, maxX: 200, minZ: -270, maxZ: -160, kind: 'scrub' },
  ],
  woods: [
    { x: 176, z: 74, r: 50, n: 42 },
    { x: 184, z: -84, r: 48, n: 40 },
    { x: -226, z: -78, r: 48, n: 38 },
    { x: -232, z: 150, r: 44, n: 34 },
    { x: -128, z: -196, r: 44, n: 34 },
    { x: 132, z: -204, r: 46, n: 36 },
    { x: 110, z: 236, r: 34, n: 26 },
  ],
  // Hedges are solid to tanks, so they run alongside the three approaches rather than across
  // them: they give each attack a covered edge without ever blocking the way in.
  hedges: [
    [[-200, 62], [-78, 62]],
    [[78, 62], [200, 62]],
    [[-190, 152], [-92, 152]],
    [[92, 152], [190, 152]],
    [[-76, 74], [-76, 140]],
    [[76, 74], [76, 140]],
    [[72, 46], [124, 46]],
    [[72, -48], [132, -48]],
    [[-152, 48], [-80, 48]],
    [[-164, -46], [-72, -46]],
    [[-112, -150], [-42, -150]],
    [[42, -150], [112, -150]],
  ],
  // the farmyard walls
  walls: [
    [[-60, -4], [-10, -4]],
    [[-60, -4], [-60, -50]],
    [[-60, -50], [-34, -50]],
  ],
  rubble: [[14, 16], [-70, 20], [22, -18]],
  barricades: [],
  farmhouses: [
    { x: -26, z: -18, rot: 0, barn: true }, // Ardenne Farm
    { x: 150, z: 112, rot: 0.6, ruined: true },
    { x: -196, z: -138, rot: -0.4 },
  ],
  villageHouses: [],
  orchards: [{ minX: -146, maxX: -80, minZ: 54, maxZ: 104, spacing: 9 }],
  noBuild: [],
};

type XZ = { x: number; z: number };
export type SectorId = 'north' | 'east' | 'west';
export interface Sector {
  id: SectorId;
  label: string;
  /** Fighting position for a tank platoon covering this approach. */
  post: XZ;
  /** Two anti-tank gun pits. */
  guns: [XZ, XZ];
  /** Centre of the minefield, astride the road. */
  mines: XZ;
  /** Where the enemy enters the map on this approach. */
  lane: XZ;
  /** Where the attack shakes out and closes with the farm. */
  push: XZ;
}

const RAW_SECTORS: Record<SectorId, Sector> = {
  north: { id: 'north', label: 'North Road', post: { x: 2, z: 48 }, guns: [{ x: -34, z: 40 }, { x: 32, z: 42 }], mines: { x: 3, z: 128 }, lane: { x: -2, z: 248 }, push: { x: 2, z: 78 } },
  east: { id: 'east', label: 'East Track', post: { x: 64, z: -8 }, guns: [{ x: 56, z: 24 }, { x: 60, z: -34 }], mines: { x: 134, z: -2 }, lane: { x: 248, z: -2 }, push: { x: 84, z: -4 } },
  west: { id: 'west', label: 'West Lane', post: { x: -90, z: -6 }, guns: [{ x: -76, z: 26 }, { x: -78, z: -36 }], mines: { x: -150, z: 3 }, lane: { x: -248, z: 4 }, push: { x: -104, z: 2 } },
};

const RAW_POINTS = {
  playerStart: { x: 3, z: -66 },
  farm: { x: -30, z: -24 },
  crossroads: { x: 0, z: 0 },
  truckA: { x: -46, z: -38 },
  truckB: { x: -30, z: -42 },
  garrison: { x: -34, z: -8 },
  relief: { x: 2, z: -236 },
  reliefPost: { x: 0, z: -30 },
};

const mx = <T extends XZ>(p: T): T => ({ ...p, x: -p.x });

export const ARDENNE: MapDef = mirrorDef(RAW);
export const APOINTS = Object.fromEntries(Object.entries(RAW_POINTS).map(([k, v]) => [k, mx(v)])) as typeof RAW_POINTS;
export const SECTORS = Object.fromEntries(
  Object.entries(RAW_SECTORS).map(([k, s]) => [k, { ...s, post: mx(s.post), guns: [mx(s.guns[0]), mx(s.guns[1])], mines: mx(s.mines), lane: mx(s.lane), push: mx(s.push) }]),
) as Record<SectorId, Sector>;
export const SECTOR_IDS: SectorId[] = ['north', 'east', 'west'];
