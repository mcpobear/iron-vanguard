declare const __APP_VERSION__: string;
/** Build version, injected by Vite from package.json. */
export const APP_VERSION = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : 'dev';

export type GraphicsPreset = 'low' | 'medium' | 'high';
export type DifficultyLevel = 'recruit' | 'veteran' | 'elite';

export interface Settings {
  graphics: GraphicsPreset;
  difficulty: DifficultyLevel;
  fpsCap: 30 | 60 | 0;
  uiScale: number;
  lookSensitivity: number;
  aimSensitivity: number;
  joystickSensitivity: number;
  steerSensitivity: number;
  invertY: boolean;
  aimAssist: boolean;
  slowOnOrders: boolean;
  volume: number;
  musicVolume: number;
  tutorialHints: boolean;
  controls: 'auto' | 'touch' | 'desktop';
}

export const DEFAULT_SETTINGS: Settings = {
  graphics: 'medium',
  difficulty: 'veteran',
  fpsCap: 60,
  uiScale: 1,
  lookSensitivity: 1,
  aimSensitivity: 1,
  joystickSensitivity: 1,
  steerSensitivity: 1,
  invertY: false,
  aimAssist: true,
  slowOnOrders: true,
  volume: 0.8,
  musicVolume: 0.55,
  tutorialHints: true,
  controls: 'auto',
};

export const isTouchDevice = () => matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window || navigator.maxTouchPoints > 0;

export function usesTouch(s: Settings) {
  return s.controls === 'touch' || (s.controls === 'auto' && isTouchDevice());
}

export interface DifficultyValues {
  /** Multiplier on damage enemy shells do to the player's tanks. */
  enemyDamage: number;
  /** Seconds of clear sight an enemy crew needs before it can engage (lower = quicker). */
  enemyAcquire: number;
  /** Multiplier on enemy gun dispersion (lower = more accurate). */
  enemySpread: number;
  /** Grace period before a newly alerted enemy takes its first shot. */
  firstShotDelay: number;
  label: string;
  blurb: string;
}

export const DIFFICULTY: Record<DifficultyLevel, DifficultyValues> = {
  recruit: {
    enemyDamage: 0.7,
    enemyAcquire: 3.6,
    enemySpread: 2.5,
    firstShotDelay: 3,
    label: 'Recruit',
    blurb: 'Forgiving. Enemy crews are slow to see you and shoot loosely.',
  },
  veteran: {
    enemyDamage: 1.05,
    enemyAcquire: 2.1,
    enemySpread: 1.5,
    firstShotDelay: 1.8,
    label: 'Veteran',
    blurb: 'The intended fight. Enemy crews aim properly and hurt.',
  },
  elite: {
    enemyDamage: 1.35,
    enemyAcquire: 1.4,
    enemySpread: 1.05,
    firstShotDelay: 1.1,
    label: 'Elite',
    blurb: 'Punishing. They spot fast, shoot straight, and a flank shot will kill you.',
  },
};

export function presetValues(p: GraphicsPreset) {
  const dpr = window.devicePixelRatio || 1;
  switch (p) {
    case 'low':
      return { pixelRatio: Math.min(dpr, 1) * 0.8, shadows: false, particleScale: 0.5, viewDist: 420, trees: 0.5, antialias: false };
    case 'high':
      return { pixelRatio: Math.min(dpr, 2), shadows: true, particleScale: 1, viewDist: 700, trees: 1, antialias: true };
    default:
      return { pixelRatio: Math.min(dpr, 1.5), shadows: false, particleScale: 0.8, viewDist: 560, trees: 0.8, antialias: true };
  }
}
