export type GraphicsPreset = 'low' | 'medium' | 'high';

export interface Settings {
  graphics: GraphicsPreset;
  fpsCap: 30 | 60 | 0;
  uiScale: number;
  lookSensitivity: number;
  aimSensitivity: number;
  joystickSensitivity: number;
  invertY: boolean;
  aimAssist: boolean;
  slowOnOrders: boolean;
  volume: number;
  tutorialHints: boolean;
  controls: 'auto' | 'touch' | 'desktop';
}

export const DEFAULT_SETTINGS: Settings = {
  graphics: 'medium',
  fpsCap: 60,
  uiScale: 1,
  lookSensitivity: 1,
  aimSensitivity: 1,
  joystickSensitivity: 1,
  invertY: false,
  aimAssist: true,
  slowOnOrders: true,
  volume: 0.8,
  tutorialHints: true,
  controls: 'auto',
};

export const isTouchDevice = () => matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window || navigator.maxTouchPoints > 0;

export function usesTouch(s: Settings) {
  return s.controls === 'touch' || (s.controls === 'auto' && isTouchDevice());
}

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
