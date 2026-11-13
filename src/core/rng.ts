// Small seeded PRNG (mulberry32) so outcomes are reproducible in tests.
export type Rng = () => number;

export function makeRng(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const pick = <T>(rng: Rng, arr: T[]): T => arr[Math.floor(rng() * arr.length) % arr.length];

export function uid(prefix: string, rng: Rng = Math.random): string {
  return `${prefix}-${Math.floor(rng() * 0xffffffff).toString(36)}${Date.now().toString(36).slice(-4)}`;
}
