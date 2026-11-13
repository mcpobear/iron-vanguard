import { type MapDef, mirrorDef, mirrorPoints } from './mapTypes';

/**
 * Kessler Ridge: a low east–west ridge with an open wheat plain to the north (the Varkovian
 * approach), a reverse slope behind the crest, and the Alderland gun line further south.
 * The crest dips and rises along its length, giving natural hull-down fighting positions.
 */
const crestZ = (x: number) => 5 * Math.sin(x * 0.0065) + 2.5 * Math.sin(x * 0.017);
const smoothstep = (t: number) => {
  const u = Math.max(0, Math.min(1, t));
  return u * u * (3 - 2 * u);
};

/** Height of the crest line at a given x — spurs and saddles along the ridge. */
export const crestHeight = (x: number) => 11.5 + 2.6 * Math.sin(x * 0.021) + 1.6 * Math.cos(x * 0.009 + 1.3);

const RAW: MapDef = {
  half: 340,
  grass: 0x7fa34e,
  sky: 0xc8d6e0,
  shape: (x, z, base) => {
    const d = z - crestZ(x);
    const top = crestHeight(x);
    let h: number;
    if (d >= 0) {
      // forward (northern) slope falling away to the plain
      const t = smoothstep(d / 100);
      h = top * (1 - t) + -3 * t;
    } else {
      // reverse slope down to the gun line shelf
      const t = smoothstep(-d / 72);
      h = top * (1 - t) + 0.5 * t;
    }
    return h + base * 0.3;
  },
  roads: [
    // lateral track behind the crest — the platoons' lifeline
    { pts: [[-320, -56], [-180, -60], [-60, -52], [40, -58], [160, -54], [320, -62]], width: 7, main: true },
    // farm track up over the saddle to the crest
    { pts: [[-40, -56], [-36, -20], [-30, 6], [-26, 40], [-20, 110]], width: 5 },
    { pts: [[120, -58], [126, -14], [130, 18]], width: 5 },
    // road back to the gun line and the rear
    { pts: [[-4, -56], [0, -100], [-6, -150], [0, -250], [-4, -340]], width: 7 },
    // the enemy's approach road across the plain
    { pts: [[60, 340], [40, 250], [20, 170], [-20, 110]], width: 7 },
  ],
  fields: [
    { minX: -320, maxX: 320, minZ: 110, maxZ: 320, kind: 'wheat' },
    { minX: -300, maxX: -60, minZ: 60, maxZ: 110, kind: 'plough' },
    { minX: 60, maxX: 300, minZ: 60, maxZ: 110, kind: 'wheat' },
    { minX: -200, maxX: 200, minZ: -20, maxZ: 45, kind: 'scrub' },
    { minX: -300, maxX: 300, minZ: -150, maxZ: -80, kind: 'pasture' },
    { minX: -280, maxX: -120, minZ: -300, maxZ: -170, kind: 'meadow' },
  ],
  woods: [
    { x: -250, z: 200, r: 58, n: 46 },
    { x: 230, z: 170, r: 52, n: 42 },
    { x: 95, z: 240, r: 40, n: 32 },
    { x: -140, z: 96, r: 26, n: 22 },
    { x: 180, z: -150, r: 48, n: 38 },
    { x: -200, z: -200, r: 50, n: 40 },
    { x: 280, z: -40, r: 44, n: 34 },
    { x: -290, z: -30, r: 44, n: 34 },
  ],
  hedges: [
    [[-300, 112], [-150, 112]],
    [[-120, 112], [10, 112]],
    [[40, 112], [200, 112]],
    [[-210, 60], [-210, 112]],
    [[150, 56], [150, 112]],
    [[-160, -86], [-40, -86]],
    [[30, -86], [150, -86]],
    [[-250, -140], [-120, -140]],
  ],
  // dry-stone walls along the crest: the ridge-top cover both sides fight over
  walls: [
    [[-150, 10], [-96, 6]],
    [[-70, 2], [-14, 0]],
    [[20, -2], [78, 2]],
    [[110, 6], [168, 10]],
    [[-210, 14], [-178, 12]],
  ],
  rubble: [[-6, 12], [10, 16], [-30, 4], [62, -6], [-118, 2]],
  barricades: [
    { x: -36, z: -34, len: 12, rot: 0.1 },
    { x: 96, z: -30, len: 10, rot: -0.2 },
  ],
  farmhouses: [
    { x: -34, z: 22, rot: 0.15, barn: true, ruined: true }, // Kessler Farm, on the crest
    { x: 148, z: -92, rot: -0.4, barn: true },
    { x: -220, z: -96, rot: 0.5 },
  ],
  villageHouses: [],
  orchards: [{ minX: -70, maxX: -6, minZ: 34, maxZ: 62, spacing: 9 }],
  noBuild: [],
  gunPits: [
    { x: -60, z: -128, rot: 0 },
    { x: -20, z: -134, rot: 0.1 },
    { x: 24, z: -130, rot: -0.1 },
    { x: 64, z: -126, rot: 0.15 },
  ],
};

const RAW_POINTS = {
  playerStart: { x: -22, z: -78, heading: 0 },
  /** Hull-down fighting positions along the crest, west to east. */
  postWest: { x: -150, z: 4 },
  postCentre: { x: -44, z: -2 },
  postEast: { x: 86, z: 4 },
  /** Where each platoon forms up before moving to the crest. */
  formWest: { x: -140, z: -40 },
  formCentre: { x: -40, z: -44 },
  formEast: { x: 90, z: -40 },
  /** The reverse-slope line the brigade falls back to. */
  fallWest: { x: -130, z: -52 },
  fallCentre: { x: -26, z: -56 },
  fallEast: { x: 100, z: -50 },
  /** The anti-tank gun line, the final position. */
  gunLine: { x: 0, z: -124 },
  gunLineWest: { x: -62, z: -118 },
  gunLineEast: { x: 62, z: -118 },
  farm: { x: -34, z: 22 },
  saddle: { x: -26, z: 10 },
  /** Enemy approach lanes across the plain. */
  laneWest: { x: -170, z: 300 },
  laneCentre: { x: -10, z: 310 },
  laneEast: { x: 150, z: 300 },
  pushWest: { x: -150, z: 70 },
  pushCentre: { x: -16, z: 66 },
  pushEast: { x: 120, z: 70 },
  /** Registered artillery targets suggested in the briefing. */
  targetCrossroads: { x: -20, z: 140 },
  targetPlain: { x: 60, z: 190 },
  enemyRetreat: { x: 0, z: 340 },
};

export const KESSLER: MapDef = mirrorDef(RAW);
export const KPOINTS = mirrorPoints(RAW_POINTS);
/** Crest height at a mirrored world x (the shape function is mirrored with the map). */
export const kesslerCrestHeight = (x: number) => crestHeight(-x);
export const kesslerCrestZ = (x: number) => crestZ(-x);
