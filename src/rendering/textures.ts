import * as THREE from 'three';

// All emblems are fictional and drawn procedurally.

export function drawAlderlandRoundel(ctx: CanvasRenderingContext2D, x: number, y: number, r: number) {
  ctx.save();
  ctx.translate(x, y);
  ctx.fillStyle = '#f4f1e4';
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#1f4f8f';
  ctx.beginPath();
  ctx.arc(0, 0, r * 0.82, 0, Math.PI * 2);
  ctx.fill();
  // gold four-point "dawn star"
  ctx.fillStyle = '#e8b93a';
  ctx.beginPath();
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 - Math.PI / 2;
    const rr = i % 2 === 0 ? r * 0.66 : r * 0.2;
    ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
  }
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

export function drawVarkovianMark(ctx: CanvasRenderingContext2D, x: number, y: number, r: number) {
  ctx.save();
  ctx.translate(x, y);
  ctx.fillStyle = '#1e1e1e';
  ctx.beginPath();
  for (let i = 0; i < 6; i++) ctx.lineTo(Math.cos((i / 6) * Math.PI * 2) * r, Math.sin((i / 6) * Math.PI * 2) * r);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#d9772b';
  ctx.fillRect(-r * 0.7, -r * 0.18, r * 1.4, r * 0.36);
  ctx.restore();
}

function canvas(w: number, h: number) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

export function flagTexture(nation: 'alderland'): THREE.Texture {
  const c = canvas(128, 80);
  const g = c.getContext('2d')!;
  g.fillStyle = '#1f4f8f';
  g.fillRect(0, 0, 128, 80);
  g.fillStyle = '#f4f1e4';
  g.fillRect(0, 30, 128, 20);
  g.fillStyle = '#2f7a3a';
  g.fillRect(0, 34, 128, 12);
  drawAlderlandRoundel(g, 34, 40, 22);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  void nation;
  return t;
}

/** Turret-side decal: roundel + white turret number (or enemy marking). */
export function tankDecal(nation: 'alderland' | 'varkovia', number: string): THREE.Texture {
  const c = canvas(256, 96);
  const g = c.getContext('2d')!;
  g.clearRect(0, 0, 256, 96);
  if (nation === 'alderland') {
    drawAlderlandRoundel(g, 48, 48, 34);
    g.font = 'bold 64px "Arial Black", Arial, sans-serif';
    g.fillStyle = '#f4f1e4';
    g.strokeStyle = '#1c2a16';
    g.lineWidth = 5;
    g.textBaseline = 'middle';
    g.strokeText(number, 100, 52);
    g.fillText(number, 100, 52);
  } else {
    drawVarkovianMark(g, 48, 48, 32);
    g.font = 'bold 52px Arial, sans-serif';
    g.fillStyle = '#e9e1cf';
    g.textBaseline = 'middle';
    g.fillText(number, 100, 52);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

let trackTex: THREE.CanvasTexture | null = null;
export function trackTexture(): THREE.Texture {
  if (!trackTex) {
    const c = canvas(32, 64);
    const g = c.getContext('2d')!;
    g.fillStyle = '#2b2a27';
    g.fillRect(0, 0, 32, 64);
    for (let i = 0; i < 4; i++) {
      g.fillStyle = '#4a4740';
      g.fillRect(0, i * 16, 32, 9);
      g.fillStyle = '#5b574e';
      g.fillRect(4, i * 16 + 2, 24, 3);
    }
    trackTex = new THREE.CanvasTexture(c);
    trackTex.wrapS = trackTex.wrapT = THREE.RepeatWrapping;
    trackTex.colorSpace = THREE.SRGBColorSpace;
  }
  const t = trackTex.clone();
  t.needsUpdate = true;
  return t;
}

let soft: THREE.Texture | null = null;
export function softParticle(): THREE.Texture {
  if (soft) return soft;
  const c = canvas(64, 64);
  const g = c.getContext('2d')!;
  const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, 'rgba(255,255,255,1)');
  gr.addColorStop(0.45, 'rgba(255,255,255,0.75)');
  gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr;
  g.fillRect(0, 0, 64, 64);
  soft = new THREE.CanvasTexture(c);
  return soft;
}

let puff: THREE.Texture | null = null;
/** Lumpy cloud texture for smoke (Roblox-style chunky puffs). */
export function puffParticle(): THREE.Texture {
  if (puff) return puff;
  const c = canvas(64, 64);
  const g = c.getContext('2d')!;
  for (const [x, y, r] of [[32, 34, 20], [22, 28, 13], [42, 26, 14], [26, 42, 12], [42, 42, 12]] as [number, number, number][]) {
    const gr = g.createRadialGradient(x, y, 0, x, y, r);
    gr.addColorStop(0, 'rgba(255,255,255,0.95)');
    gr.addColorStop(0.7, 'rgba(255,255,255,0.7)');
    gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr;
    g.beginPath();
    g.arc(x, y, r, 0, Math.PI * 2);
    g.fill();
  }
  puff = new THREE.CanvasTexture(c);
  return puff;
}

let shadowTex: THREE.Texture | null = null;
export function blobShadow(): THREE.Texture {
  if (shadowTex) return shadowTex;
  const c = canvas(64, 64);
  const g = c.getContext('2d')!;
  const gr = g.createRadialGradient(32, 32, 4, 32, 32, 32);
  gr.addColorStop(0, 'rgba(0,0,0,0.55)');
  gr.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = gr;
  g.fillRect(0, 0, 64, 64);
  shadowTex = new THREE.CanvasTexture(c);
  return shadowTex;
}
