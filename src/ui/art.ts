import type { PortraitSpec } from '../campaign/types';
import type { MedalDef } from '../data/medals';
import { drawAlderlandRoundel } from '../rendering/textures';

/** Stylised blocky portrait (Roblox-like head on shoulders), drawn procedurally. */
export function portraitCanvas(p: PortraitSpec, rankIndex: number, kia = false, size = 160, ribbons: string[][] = []): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d')!;
  const s = size / 160;
  g.scale(s, s);
  // background
  const bg = g.createLinearGradient(0, 0, 0, 160);
  bg.addColorStop(0, '#7f9a6a');
  bg.addColorStop(1, '#3f5636');
  g.fillStyle = bg;
  g.fillRect(0, 0, 160, 160);
  g.fillStyle = 'rgba(255,255,255,0.07)';
  for (let i = 0; i < 6; i++) g.fillRect(i * 30 - 10, 0, 12, 160);
  // shoulders / tunic
  g.fillStyle = '#6b6a3a';
  rr(g, 18, 118, 124, 60, 18);
  g.fillStyle = '#5a5930';
  g.fillRect(70, 118, 20, 42);
  g.fillStyle = '#c9b98a';
  g.beginPath();
  g.moveTo(64, 118);
  g.lineTo(80, 136);
  g.lineTo(96, 118);
  g.fill();
  // rank tab on his right collar (viewer's left), ribbon bar on the left breast (viewer's right)
  drawRankInsignia(g, rankIndex, 26, 126, 30);
  drawRibbonBar(g, ribbons, 104, 126, 32);
  // neck
  g.fillStyle = shade(p.skin, -18);
  g.fillRect(66, 100, 28, 22);
  // head
  const hw = p.face === 'long' ? 58 : p.face === 'round' ? 66 : 64;
  const hh = p.face === 'long' ? 72 : p.face === 'round' ? 62 : 66;
  const hx = 80 - hw / 2, hy = 104 - hh;
  g.fillStyle = p.skin;
  rr(g, hx, hy, hw, hh, p.face === 'round' ? 22 : 12);
  // ears
  g.fillRect(hx - 5, hy + hh * 0.42, 7, 14);
  g.fillRect(hx + hw - 2, hy + hh * 0.42, 7, 14);
  // hair
  g.fillStyle = p.hair;
  if (p.hairStyle !== 'bald') {
    const top = p.hairStyle === 'crop' ? 10 : p.hairStyle === 'swept' ? 18 : 14;
    rr(g, hx - 1, hy - 4, hw + 2, top + 6, 10);
    if (p.hairStyle === 'side') g.fillRect(hx - 1, hy, 10, 24);
    if (p.hairStyle === 'swept') {
      g.beginPath();
      g.moveTo(hx + 4, hy + 12);
      g.lineTo(hx + hw, hy - 8);
      g.lineTo(hx + hw, hy + 14);
      g.fill();
    }
  }
  // eyes
  const ey = hy + hh * 0.48;
  for (const ex of [80 - hw * 0.2, 80 + hw * 0.2]) {
    g.fillStyle = '#fff';
    g.fillRect(ex - 6, ey - 4, 12, 8);
    g.fillStyle = p.eyes;
    g.fillRect(ex - 3, ey - 3, 6, 6);
    g.fillStyle = '#111';
    g.fillRect(ex - 1.5, ey - 1.5, 3, 3);
  }
  // brows
  g.fillStyle = p.hair === '#c9a24a' ? '#8a6a2a' : shade(p.hair, -10);
  const bt = p.brow === 'heavy' ? 5 : 3;
  for (const ex of [80 - hw * 0.2, 80 + hw * 0.2]) {
    g.save();
    g.translate(ex, ey - 10);
    if (p.brow === 'arched') g.rotate(ex < 80 ? -0.15 : 0.15);
    g.fillRect(-8, 0, 16, bt);
    g.restore();
  }
  // nose & mouth
  g.fillStyle = shade(p.skin, -25);
  g.fillRect(77, ey + 4, 6, 12);
  if (p.moustache) {
    g.fillStyle = p.hair;
    rr(g, 68, ey + 18, 24, 6, 3);
  }
  g.fillStyle = '#7a3f34';
  g.fillRect(72, ey + 26, 16, 3);
  if (p.scar) {
    g.strokeStyle = shade(p.skin, -40);
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(80 + hw * 0.32, ey - 2);
    g.lineTo(80 + hw * 0.22, ey + 14);
    g.stroke();
  }
  // headgear
  if (p.headgear === 'beret') {
    g.fillStyle = '#7a1f2b';
    g.beginPath();
    g.ellipse(80 + 6, hy + 2, hw * 0.62, 14, -0.12, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#5a1620';
    g.fillRect(hx - 2, hy + 6, hw + 4, 6);
    drawAlderlandRoundel(g, hx + 14, hy + 4, 6);
  } else if (p.headgear === 'cap') {
    g.fillStyle = '#5d6a3a';
    rr(g, hx - 3, hy - 10, hw + 6, 22, 8);
    g.fillStyle = '#3c4628';
    g.fillRect(hx - 6, hy + 8, hw + 12, 5);
  } else {
    g.fillStyle = '#3a3226';
    rr(g, hx - 4, hy - 6, hw + 8, 14, 7);
    g.fillStyle = '#2a2a2a';
    rr(g, hx - 9, hy + hh * 0.36, 10, 20, 4);
    rr(g, hx + hw - 1, hy + hh * 0.36, 10, 20, 4);
  }
  if (kia) {
    const d = g.getImageData(0, 0, 160, 160);
    for (let i = 0; i < d.data.length; i += 4) {
      const l = d.data[i] * 0.3 + d.data[i + 1] * 0.59 + d.data[i + 2] * 0.11;
      d.data[i] = d.data[i + 1] = d.data[i + 2] = l * 0.85;
    }
    g.putImageData(d, 0, 0);
    g.fillStyle = '#111';
    g.beginPath();
    g.moveTo(120, 0);
    g.lineTo(160, 0);
    g.lineTo(160, 40);
    g.fill();
  }
  return c;
}

function rr(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.fill();
}

function shade(hex: string, amt: number) {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.max(0, Math.min(255, (n >> 16) + amt)), gg = Math.max(0, Math.min(255, ((n >> 8) & 255) + amt)), b = Math.max(0, Math.min(255, (n & 255) + amt));
  return `rgb(${r},${gg},${b})`;
}

/**
 * Original Alderland insignia: sergeants wear gold chevrons (1–3) with rockers for SSG/MSG;
 * warrant officers wear a shield crest with one to three stars.
 */
export function drawRankInsignia(g: CanvasRenderingContext2D, rank: number, x: number, y: number, w: number) {
  g.save();
  g.translate(x, y);
  const s = w / 30;
  g.scale(s, s);
  g.fillStyle = '#2b3a22';
  rr(g, 0, 0, 30, 26, 4);
  g.fillStyle = '#e8b93a';
  g.strokeStyle = '#e8b93a';
  if (rank <= 4) {
    const chev = rank === 0 ? 1 : rank === 1 ? 2 : 3;
    g.lineWidth = 2.6;
    for (let i = 0; i < chev; i++) {
      g.beginPath();
      g.moveTo(5, 9 + i * 4.5);
      g.lineTo(15, 3 + i * 4.5);
      g.lineTo(25, 9 + i * 4.5);
      g.stroke();
    }
    const rockers = rank === 2 ? 1 : rank >= 3 ? 2 : 0;
    for (let i = 0; i < rockers; i++) {
      g.beginPath();
      g.moveTo(5, 18 + i * 3.5);
      g.quadraticCurveTo(15, 23 + i * 3.5, 25, 18 + i * 3.5);
      g.stroke();
    }
    if (rank === 4) star(g, 15, 14, 3);
  } else {
    // warrant officer crest
    g.beginPath();
    g.moveTo(6, 4);
    g.lineTo(24, 4);
    g.lineTo(24, 14);
    g.quadraticCurveTo(15, 24, 6, 14);
    g.closePath();
    g.fill();
    g.fillStyle = '#2b3a22';
    const stars = rank - 4;
    for (let i = 0; i < stars; i++) star(g, 15 + (i - (stars - 1) / 2) * 5.5, 11, 2.4);
  }
  g.restore();
}

function star(g: CanvasRenderingContext2D, x: number, y: number, r: number) {
  g.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2 - Math.PI / 2;
    const rr2 = i % 2 ? r * 0.45 : r;
    g.lineTo(x + Math.cos(a) * rr2, y + Math.sin(a) * rr2);
  }
  g.closePath();
  g.fill();
}

/** Stacked campaign/decoration ribbon bar, worn above the breast pocket. */
export function drawRibbonBar(g: CanvasRenderingContext2D, ribbons: string[][], x: number, y: number, w: number) {
  if (!ribbons.length) return;
  const rows = Math.min(3, ribbons.length);
  const perRow = ribbons.length > 4 ? 2 : 1;
  const bw = perRow > 1 ? (w - 2) / 2 : w;
  const bh = 7;
  let i = 0;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < perRow && i < ribbons.length; c++, i++) {
      const bx = x + c * (bw + 2);
      const by = y + r * (bh + 2);
      const stripes = ribbons[i];
      for (let k = 0; k < stripes.length; k++) {
        g.fillStyle = stripes[k];
        g.fillRect(bx + (k * bw) / stripes.length, by, bw / stripes.length + 0.6, bh);
      }
      g.strokeStyle = 'rgba(0,0,0,0.5)';
      g.lineWidth = 1;
      g.strokeRect(bx + 0.5, by + 0.5, bw - 1, bh - 1);
      // gold edge so it reads as a mounted bar
      g.strokeStyle = 'rgba(232,185,58,0.7)';
      g.strokeRect(bx - 0.5, by - 0.5, bw + 1, bh + 1);
    }
  }
}

export function ribbonCanvas(ribbons: string[][], w = 36): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = Math.max(9, Math.min(3, ribbons.length) * 9);
  drawRibbonBar(c.getContext('2d')!, ribbons, 0, 0, w);
  return c;
}

export function rankCanvas(rank: number, w = 44): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = Math.round((w * 26) / 30);
  drawRankInsignia(c.getContext('2d')!, rank, 0, 0, w);
  return c;
}

export function medalCanvas(m: MedalDef, size = 64): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = size;
  c.height = m.kind === 'ribbon' ? Math.round(size * 0.4) : Math.round(size * 1.35);
  const g = c.getContext('2d')!;
  const s = size / 64;
  g.scale(s, s);
  // ribbon
  const rh = m.kind === 'ribbon' ? 26 : 26;
  const n = m.ribbon.length;
  for (let i = 0; i < n; i++) {
    g.fillStyle = m.ribbon[i];
    g.fillRect((i * 64) / n, 0, 64 / n + 0.5, rh);
  }
  g.strokeStyle = 'rgba(0,0,0,0.35)';
  g.strokeRect(0.5, 0.5, 63, rh - 1);
  if (m.kind === 'ribbon') return c;
  g.fillStyle = '#c9a54a';
  g.fillRect(28, rh, 8, 8);
  const cx = 32, cy = rh + 30;
  const grad = g.createRadialGradient(cx - 6, cy - 6, 2, cx, cy, 24);
  grad.addColorStop(0, '#fff3c4');
  grad.addColorStop(1, m.shape === 'shield' ? '#8a8f96' : '#c9962e');
  g.fillStyle = grad;
  g.strokeStyle = '#5a4316';
  g.lineWidth = 1.5;
  g.beginPath();
  if (m.shape === 'star') {
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2 - Math.PI / 2;
      const r = i % 2 ? 9 : 22;
      g.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
    }
  } else if (m.shape === 'cross') {
    const a = 20, b = 7;
    g.moveTo(cx - b, cy - a);
    g.lineTo(cx + b, cy - a);
    g.lineTo(cx + b, cy - b);
    g.lineTo(cx + a, cy - b);
    g.lineTo(cx + a, cy + b);
    g.lineTo(cx + b, cy + b);
    g.lineTo(cx + b, cy + a);
    g.lineTo(cx - b, cy + a);
    g.lineTo(cx - b, cy + b);
    g.lineTo(cx - a, cy + b);
    g.lineTo(cx - a, cy - b);
    g.lineTo(cx - b, cy - b);
  } else {
    g.moveTo(cx - 18, cy - 18);
    g.lineTo(cx + 18, cy - 18);
    g.lineTo(cx + 18, cy + 2);
    g.quadraticCurveTo(cx, cy + 26, cx - 18, cy + 2);
  }
  g.closePath();
  g.fill();
  g.stroke();
  drawAlderlandRoundel(g, cx, cy - (m.shape === 'shield' ? 3 : 0), 7);
  return c;
}
