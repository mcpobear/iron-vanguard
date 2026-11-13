import type { Rng } from '../core/rng';
import type { CrewOutcome } from '../campaign/types';

/** What happened to a tank when it was knocked out. Collected by the damage model. */
export interface KnockoutEvent {
  /** Damage of the final hit as a fraction of max HP (0..1+). */
  severity: number;
  penetrated: boolean;
  ammoDetonation: boolean;
  crewCompartmentHit: boolean;
  fire: boolean;
  /** 'disabled' = immobile/unable to fight, 'destroyed' = total loss. */
  kind: 'disabled' | 'destroyed';
}

export interface CasualtyTuning {
  /** Scales the chance of death. Tutorial mission uses < 1. */
  lethality: number;
}

export const TUTORIAL_TUNING: CasualtyTuning = { lethality: 0.55 };

/** Probability the commander is killed. Pure function so it can be tested and tuned. */
export function deathChance(e: KnockoutEvent, t: CasualtyTuning): number {
  let p = e.kind === 'destroyed' ? 0.12 : 0.03;
  if (e.penetrated) p += 0.06;
  if (e.crewCompartmentHit) p += 0.14;
  if (e.fire) p += 0.08;
  if (e.ammoDetonation) p += 0.35;
  p += Math.max(0, Math.min(1, e.severity) - 0.3) * 0.15;
  return Math.max(0, Math.min(0.85, p * t.lethality));
}

export function resolveCasualty(e: KnockoutEvent, rng: Rng, t: CasualtyTuning = TUTORIAL_TUNING): CrewOutcome {
  const pDeath = deathChance(e, t);
  const r = rng();
  if (r < pDeath) return 'killed';
  // Of survivors: incapacitated (out of the fight, recovers), wounded, or unhurt.
  const rest = (r - pDeath) / Math.max(1e-6, 1 - pDeath);
  const pInj = Math.min(0.8, 0.2 + (e.crewCompartmentHit ? 0.25 : 0) + (e.fire ? 0.15 : 0) + (e.kind === 'destroyed' ? 0.15 : 0));
  if (rest < pInj * 0.4) return 'incapacitated';
  if (rest < pInj) return 'wounded';
  return 'unhurt';
}

export const OUTCOME_TEXT: Record<CrewOutcome, string> = {
  unhurt: 'Commander unhurt — crew bailed out',
  wounded: 'Commander wounded — evacuated',
  incapacitated: 'Commander incapacitated — evacuated',
  killed: 'Commander killed in action',
};
