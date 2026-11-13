// Shared map description used by the terrain builder and the world builder.
// Everything except `half` is optional, so a map can be an open battlefield (Kessler Ridge)
// or a built-up town (Bellwick) without either carrying the other's baggage.

export type P = [number, number];

export interface FieldDef {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  kind: 'wheat' | 'pasture' | 'plough' | 'meadow' | 'scrub';
}

export interface MapDef {
  half: number;
  roads: { pts: P[]; width: number; main?: boolean }[];
  fields: FieldDef[];
  woods: { x: number; z: number; r: number; n: number }[];
  hedges: P[][];
  walls: P[][];
  rubble: P[];
  barricades: { x: number; z: number; len: number; rot: number }[];
  farmhouses: { x: number; z: number; rot: number; barn?: boolean; ruined?: boolean }[];
  villageHouses: { x: number; z: number; rot: number; ruined?: boolean }[];
  orchards: { minX: number; maxX: number; minZ: number; maxZ: number; spacing: number }[];
  noBuild: { x: number; z: number; r: number }[];

  /** Watercourse: z of the stream centre at a given x. Omit for a dry map. */
  streamZ?: (x: number) => number;
  bridge?: { x: number; z: number; len: number; width: number };
  /** Built-up area that gets levelled and paved. */
  town?: { x: number; z: number; r: number };
  square?: { minX: number; maxX: number; minZ: number; maxZ: number };
  townPlots?: { minX: number; maxX: number; minZ: number; maxZ: number };
  church?: { x: number; z: number };

  /**
   * Large-scale landform on top of the rolling base, e.g. a ridge line.
   * Receives the base height and returns the shaped height.
   */
  shape?: (x: number, z: number, base: number) => number;
  /** Base grass tint, for maps that aren't lush green farmland. */
  grass?: number;
  /** Sky and fog tint overrides. */
  sky?: number;
  /** Extra scenery emplacements rendered as sandbag gun pits. */
  gunPits?: { x: number; z: number; rot: number }[];
}

export const emptyMap = (half: number): MapDef => ({
  half,
  roads: [],
  fields: [],
  woods: [],
  hedges: [],
  walls: [],
  rubble: [],
  barricades: [],
  farmhouses: [],
  villageHouses: [],
  orchards: [],
  noBuild: [],
});

/**
 * Three.js is right-handed: looking north (+z), screen-right is -x. Layouts are drawn with
 * +x as east, so they are mirrored once before use; then east is on your right facing north
 * and the minimap, compass calls and 3D view all agree.
 */
export function mirrorDef(d: MapDef): MapDef {
  const mp = (p: P): P => [-p[0], p[1]];
  const box = <T extends { minX: number; maxX: number }>(b: T): T => ({ ...b, minX: -b.maxX, maxX: -b.minX });
  return {
    ...d,
    roads: d.roads.map((r) => ({ ...r, pts: r.pts.map(mp) })),
    streamZ: d.streamZ ? (x) => d.streamZ!(-x) : undefined,
    bridge: d.bridge ? { ...d.bridge, x: -d.bridge.x } : undefined,
    town: d.town ? { ...d.town, x: -d.town.x } : undefined,
    square: d.square ? box(d.square) : undefined,
    townPlots: d.townPlots ? box(d.townPlots) : undefined,
    church: d.church ? { x: -d.church.x, z: d.church.z } : undefined,
    shape: d.shape ? (x, z, base) => d.shape!(-x, z, base) : undefined,
    gunPits: d.gunPits?.map((g) => ({ ...g, x: -g.x, rot: -g.rot })),
    farmhouses: d.farmhouses.map((f) => ({ ...f, x: -f.x, rot: -f.rot })),
    villageHouses: d.villageHouses.map((f) => ({ ...f, x: -f.x, rot: -f.rot })),
    orchards: d.orchards.map(box),
    woods: d.woods.map((w) => ({ ...w, x: -w.x })),
    hedges: d.hedges.map((l) => l.map(mp)),
    walls: d.walls.map((l) => l.map(mp)),
    rubble: d.rubble.map(mp),
    barricades: d.barricades.map((b) => ({ ...b, x: -b.x, rot: -b.rot })),
    fields: d.fields.map(box),
    noBuild: d.noBuild.map((n) => ({ ...n, x: -n.x })),
  };
}

type Pt = { x: number; z: number; heading?: number; r?: number };
/** Mirror a table of named gameplay anchor points to match `mirrorDef`. */
export function mirrorPoints<T extends Record<string, Pt>>(pts: T): T {
  return Object.fromEntries(
    Object.entries(pts).map(([k, v]) => [k, { ...v, x: -v.x, ...(v.heading !== undefined ? { heading: -v.heading } : {}) }]),
  ) as T;
}
