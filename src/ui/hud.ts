import * as THREE from 'three';
import type { Game } from '../game/game';
import type { Tank } from '../vehicles/tank';
import { ORDER_LABEL, FORMATION_LABEL, type Order, type Formation } from '../platoon/platoon';
import { rankCanvas, portraitCanvas } from './art';
import { OUTCOME_TEXT } from '../progression/casualty';
import type { AmmoType } from '../data/tanks';

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', html = ''): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html) e.innerHTML = html;
  return e;
};

/** Press-and-hold / tap binding that works with multi-touch and releases safely. */
function bindPress(b: HTMLElement, down: () => void, up?: () => void) {
  let id: number | null = null;
  b.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (id !== null) return;
    id = e.pointerId;
    try {
      b.setPointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    b.classList.add('pressed');
    down();
  });
  const release = (e: PointerEvent) => {
    if (e.pointerId !== id) return;
    id = null;
    b.classList.remove('pressed');
    up?.();
  };
  b.addEventListener('pointerup', release);
  b.addEventListener('pointercancel', release);
  b.addEventListener('lostpointercapture', release);
  document.addEventListener('iv-release-buttons', () => {
    if (id !== null) {
      id = null;
      b.classList.remove('pressed');
      up?.();
    }
  });
  b.addEventListener('contextmenu', (e) => e.preventDefault());
}

const STATUS_CLASS: Record<string, string> = { operational: 'ok', damaged: 'dmg', disabled: 'dis', destroyed: 'dead' };
const STATUS_TEXT: Record<string, string> = { operational: 'Operational', damaged: 'Damaged', disabled: 'Disabled', destroyed: 'Destroyed' };

export class Hud {
  root = el('div', 'hud');
  touchLayer = el('div', 'touch-layer');
  private cmdCard = el('div', 'panel cmd-card');
  private objective = el('div', 'panel objective');
  private hintBox = el('div', 'hint');
  private toast = el('div', 'toast');
  private radioBox = el('div', 'radio');
  private platoonPanel = el('div', 'panel platoon');
  private crosshair = el('div', 'crosshair');
  private gunMarker = el('div', 'gun-marker');
  private targetInfo = el('div', 'target-info');
  private hitText = el('div', 'hit-text');
  private dmgFlash = el('div', 'dmg-flash');
  private sight = el('div', 'sight');
  private markersLayer = el('div', 'markers');
  private controls = el('div', 'controls');
  private fireBtn = el('button', 'btn fire');
  private mgBtn = el('button', 'btn mg', 'MG');
  private aimBtn = el('button', 'btn aim', 'AIM');
  private ammoBtn = el('button', 'btn ammo');
  private ordersBtn = el('button', 'btn orders', 'ORDERS');
  private ammoMenu = el('div', 'ammo-menu');
  private minimap = el('canvas', 'minimap') as HTMLCanvasElement;
  private overlay = el('div', 'overlay');
  private ordersPanel = el('div', 'orders-panel');
  private mapPanel = el('div', 'map-panel');
  private mapCanvas = el('canvas', 'tactical') as HTMLCanvasElement;
  private keyLegend = el('div', 'key-legend');
  private markerEls = new Map<string, HTMLElement>();
  private radioMsgs: { el: HTMLElement; t: number }[] = [];
  private textT = 0;
  private mapT = 0;
  private staticMap: HTMLCanvasElement | null = null;
  private hitT = 0;
  private hintT = 0;
  private toastT = 0;
  private flashT = 0;
  private moveMode = false;
  private platoonCollapsed = false;
  private lastPlayerId = -1;

  constructor(private g: Game) {}

  mount() {
    const g = this.g;
    document.body.classList.toggle('touch', g.touch);
    document.body.classList.toggle('desktop', !g.touch);
    document.body.classList.add('in-game');
    const r = this.root;
    r.style.setProperty('--ui', String(g.settings.uiScale));
    r.append(this.touchLayer, this.markersLayer, this.sight, this.crosshair, this.gunMarker, this.targetInfo, this.hitText, this.dmgFlash, this.cmdCard, this.objective, this.hintBox, this.toast, this.radioBox, this.platoonPanel, this.minimap, this.controls, this.keyLegend, this.ordersPanel, this.mapPanel, this.overlay);
    this.sight.innerHTML = `
      <svg viewBox="-100 -100 200 200" preserveAspectRatio="xMidYMid meet">
        <defs><radialGradient id="vig"><stop offset="0.62" stop-color="black" stop-opacity="0"/><stop offset="0.72" stop-color="black" stop-opacity="0.95"/></radialGradient></defs>
        <rect x="-300" y="-300" width="600" height="600" fill="url(#vig)"/>
        <g class="reticle" stroke="#1d1d1d" stroke-width="0.9" fill="none">
          <path d="M0 0 L-6 9 M0 0 L6 9" stroke-width="1.4"/>
          <path d="M-14 9 L-10 9 M-22 9 L-18 9 M-30 9 L-26 9 M10 9 L14 9 M18 9 L22 9 M26 9 L30 9"/>
          <path d="M-60 0 L-24 0 M24 0 L60 0" stroke-width="1.2"/>
          <path d="M0 14 L0 60" stroke-width="1"/>
          <path d="M-3 22 L3 22 M-3 30 L3 30 M-3 38 L3 38 M-3 46 L3 46"/>
          <text x="6" y="24" font-size="5" fill="#1d1d1d" stroke="none">4</text><text x="6" y="32" font-size="5" fill="#1d1d1d" stroke="none">8</text><text x="6" y="40" font-size="5" fill="#1d1d1d" stroke="none">12</text>
        </g>
      </svg>
      <div class="sight-info"><span class="s-ammo"></span><span class="s-reload"></span><span class="s-range"></span></div>`;
    this.crosshair.innerHTML = '<div></div>';
    this.fireBtn.innerHTML = '<span class="ring"></span><span class="lbl">FIRE</span>';
    const recentre = el('button', 'btn small recentre', '⟲');
    const pauseBtn = el('button', 'btn small pause', 'II');
    const mapBtn = el('button', 'btn small mapbtn', 'MAP');
    this.controls.append(this.fireBtn, this.mgBtn, this.aimBtn, this.ammoBtn, this.ordersBtn, recentre, pauseBtn, mapBtn, this.ammoMenu);
    bindPress(this.fireBtn, () => g.firePlayer());
    bindPress(this.mgBtn, () => (g.input.mgHeld = true), () => (g.input.mgHeld = false));
    bindPress(this.aimBtn, () => g.setAim(!g.aiming));
    bindPress(this.ammoBtn, () => this.ammoMenu.classList.toggle('open'));
    bindPress(this.ordersBtn, () => g.openOrders(!g.ordersOpen));
    bindPress(recentre, () => g.recenterCamera());
    bindPress(pauseBtn, () => g.togglePause(true));
    bindPress(mapBtn, () => g.openMap(!g.mapOpen));
    bindPress(this.minimap, () => g.openMap(true));
    for (const a of ['AP', 'HE', 'SMOKE'] as AmmoType[]) {
      const b = el('button', 'btn ammo-opt');
      b.dataset.ammo = a;
      bindPress(b, () => {
        g.selectAmmo(a);
        this.ammoMenu.classList.remove('open');
      });
      this.ammoMenu.appendChild(b);
    }
    this.keyLegend.innerHTML = 'WASD drive · Mouse look · LMB fire · RMB/E aim · SPACE MG · 1/2/3 ammo · Q orders · F formation · M map · Esc pause';
    this.platoonPanel.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      this.platoonCollapsed = !this.platoonCollapsed;
      this.platoonPanel.classList.toggle('collapsed', this.platoonCollapsed);
    });
    this.buildOrders();
    this.mapPanel.append(this.mapCanvas);
    const mapClose = el('button', 'btn map-close', 'CLOSE');
    bindPress(mapClose, () => g.openMap(false));
    this.mapPanel.append(mapClose, el('div', 'map-hint'));
    this.mapCanvas.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      if (!this.moveMode) return;
      const rect = this.mapCanvas.getBoundingClientRect();
      const half = g.world.def.half;
      const x = ((e.clientX - rect.left) / rect.width) * 2 * half - half;
      const z = half - ((e.clientY - rect.top) / rect.height) * 2 * half;
      g.platoon.issue('move', { point: new THREE.Vector3(x, 0, z) });
      g.openMap(false);
    });
    this.g.container.appendChild(r);
    this.minimap.width = this.minimap.height = 160;
  }

  unmount() {
    this.root.remove();
    document.body.classList.remove('in-game');
  }

  setControlsVisible(v: boolean) {
    this.controls.style.display = v ? '' : 'none';
    this.g.input.setVisible(v && this.g.touch);
  }

  private buildOrders() {
    const g = this.g;
    const p = this.ordersPanel;
    p.innerHTML = '<div class="op-title">PLATOON ORDERS</div>';
    const grid = el('div', 'op-grid');
    for (const o of ['follow', 'hold', 'move', 'attack', 'formup'] as Order[]) {
      const b = el('button', 'btn op', ORDER_LABEL[o].toUpperCase());
      bindPress(b, () => {
        if (o === 'move') {
          g.openOrders(false);
          g.openMap(true, true);
          return;
        }
        g.platoon.issue(o, { target: g.targetTank });
        g.openOrders(false);
      });
      grid.appendChild(b);
    }
    p.appendChild(grid);
    p.appendChild(el('div', 'op-title', 'FORMATION'));
    const fg = el('div', 'op-grid three');
    for (const f of ['column', 'line', 'wedge'] as Formation[]) {
      const b = el('button', 'btn op form', FORMATION_LABEL[f].toUpperCase());
      b.dataset.f = f;
      bindPress(b, () => {
        g.platoon.setFormation(f);
        g.openOrders(false);
      });
      fg.appendChild(b);
    }
    p.appendChild(fg);
    const close = el('button', 'btn op close', 'CLOSE');
    bindPress(close, () => g.openOrders(false));
    p.appendChild(close);
  }

  showOrders(open: boolean) {
    this.ordersPanel.classList.toggle('open', open);
    if (open) {
      for (const b of this.ordersPanel.querySelectorAll<HTMLElement>('.form')) b.classList.toggle('active', b.dataset.f === this.g.platoon.formation);
      const at = this.ordersPanel.querySelectorAll<HTMLElement>('.op')[3];
      if (at) at.classList.toggle('disabled', !this.g.targetTank);
    }
  }

  showMap(open: boolean, forMove = false) {
    this.moveMode = open && forMove;
    this.mapPanel.classList.toggle('open', open);
    (this.mapPanel.querySelector('.map-hint') as HTMLElement).textContent = this.moveMode ? 'TAP A DESTINATION FOR THE PLATOON' : 'TACTICAL MAP';
    if (open) {
      const s = Math.min(window.innerHeight * 0.82, window.innerWidth * 0.62);
      this.mapCanvas.width = this.mapCanvas.height = Math.round(s * Math.min(2, window.devicePixelRatio || 1));
      this.mapCanvas.style.width = this.mapCanvas.style.height = `${s}px`;
      this.drawTactical();
    }
  }

  // ---------------------------------------------------------------- messages

  radio(from: string, text: string, quiet = false) {
    const m = el('div', 'radio-msg' + (quiet ? ' quiet' : ''), `<b>${from}:</b> ${text}`);
    this.radioBox.appendChild(m);
    this.radioMsgs.push({ el: m, t: quiet ? 3.5 : 8 });
    while (this.radioMsgs.length > 3) this.radioMsgs.shift()!.el.remove();
    if (!quiet) this.g.audio.radio();
  }

  hint(text: string) {
    if (!this.g.settings.tutorialHints) return;
    this.hintBox.innerHTML = `<span class="hint-tag">TRAINING</span> ${text}`;
    this.hintBox.classList.add('show');
    this.hintT = 11;
  }

  objectiveComplete(name: string) {
    this.toast.innerHTML = `<small>OBJECTIVE COMPLETE</small>${name}`;
    this.toast.classList.add('show');
    this.toastT = 4;
  }

  flash(text: string) {
    this.hitMarker(text, 'info');
  }

  hitMarker(text: string, kind: 'good' | 'bad' | 'info') {
    this.hitText.textContent = text;
    this.hitText.className = `hit-text show ${kind}`;
    this.hitT = 1.6;
  }

  damageFlash(a: number) {
    this.dmgFlash.style.opacity = String(Math.min(0.8, a));
    this.flashT = 0.6;
  }

  casualtyNotice(t: Tank) {
    const n = el('div', 'casualty-note', `<b>${t.rankAbbr} ${t.commanderName}</b> (${t.callsign}) has been killed in action.`);
    this.root.appendChild(n);
    setTimeout(() => n.remove(), 7000);
  }

  setAimMode(on: boolean) {
    this.sight.classList.toggle('show', on);
    this.root.classList.toggle('aiming', on);
    this.crosshair.style.display = on ? 'none' : '';
    this.aimBtn.classList.toggle('active', on);
  }

  // ---------------------------------------------------------------- overlays

  showTransfer(from: Tank, to: Tank | null) {
    const o = this.overlay;
    o.className = 'overlay show transfer';
    const veh = STATUS_TEXT[from.status] ?? from.status;
    o.innerHTML = `
      <div class="ov-box">
        <div class="ov-sub">${from.callsign} — ${veh.toUpperCase()}</div>
        <div class="ov-small">${from.rankAbbr} ${from.commanderName}: ${OUTCOME_TEXT[from.crew]}</div>
        ${to ? `<h1>COMMAND TRANSFERRED</h1><div class="ov-new"><span class="rank-slot"></span><div><b>${to.rankAbbr} ${to.commanderName}</b><br>${to.callsign} · Acting Platoon Commander</div></div>` : '<h1 class="red">PLATOON LOST</h1>'}
      </div>`;
    if (to) {
      const c = this.g.campaign.commanders[to.commanderId!];
      if (c) o.querySelector('.rank-slot')!.appendChild(rankCanvas(c.rankIndex, 46));
    }
  }
  hideTransfer() {
    this.overlay.className = 'overlay';
    this.overlay.innerHTML = '';
  }

  showPause(on: boolean) {
    const g = this.g;
    const o = this.overlay;
    if (!on) {
      o.className = 'overlay';
      o.innerHTML = '';
      return;
    }
    o.className = 'overlay show pause';
    o.innerHTML = `<div class="ov-box menu"><h1>PAUSED</h1>
      <div class="ov-small">${g.mission.info.name} · ${g.mission.objectiveText}</div>
      <button class="btn big" data-a="resume">RESUME</button>
      <button class="btn big" data-a="restart">RESTART MISSION</button>
      <button class="btn big" data-a="quit">ABANDON TO MAIN MENU</button>
      <div class="ov-small">Restarting or abandoning returns the campaign to its pre-mission state.</div></div>`;
    o.querySelectorAll<HTMLElement>('button').forEach((b) =>
      b.addEventListener('click', () => {
        const a = b.dataset.a;
        if (a === 'resume') g.togglePause(false);
        if (a === 'restart') g.restart();
        if (a === 'quit') g.quit();
      }),
    );
  }

  showFailed() {
    const g = this.g;
    const o = this.overlay;
    this.setControlsVisible(false);
    o.className = 'overlay show failed';
    o.innerHTML = `<div class="ov-box menu"><h1 class="red">MISSION FAILED</h1>
      <div class="ov-small">All Vanguard tanks have been knocked out. The campaign will be restored to its state before deployment.</div>
      <button class="btn big" data-a="restart">RESTART MISSION</button>
      <button class="btn big" data-a="quit">MAIN MENU</button></div>`;
    o.querySelectorAll<HTMLElement>('button').forEach((b) => b.addEventListener('click', () => (b.dataset.a === 'restart' ? g.restart() : g.quit())));
  }

  showVictory() {
    const g = this.g;
    const o = this.overlay;
    o.className = 'overlay show victory';
    o.innerHTML = `<div class="ov-box"><h1>MISSION COMPLETE</h1><h2>BELLWICK LIBERATED</h2>
      <button class="btn big" data-a="debrief">PROCEED TO DEBRIEF</button></div>`;
    o.querySelector('button')!.addEventListener('click', () => g.completeToDebrief());
  }

  // ---------------------------------------------------------------- per-frame

  update(dt: number) {
    const g = this.g;
    const p = g.playerTank;
    this.textT -= dt;
    this.hitT -= dt;
    if (this.hitT <= 0) this.hitText.classList.remove('show');
    this.hintT -= dt;
    if (this.hintT <= 0) this.hintBox.classList.remove('show');
    this.toastT -= dt;
    if (this.toastT <= 0) this.toast.classList.remove('show');
    if (this.flashT > 0) {
      this.flashT -= dt;
      this.dmgFlash.style.opacity = String(Math.max(0, this.flashT));
    }
    for (const m of this.radioMsgs) {
      m.t -= dt;
      m.el.style.opacity = String(Math.max(0, Math.min(1, m.t)));
    }
    this.radioMsgs = this.radioMsgs.filter((m) => (m.t > 0 ? true : (m.el.remove(), false)));
    if (!p) return;
    this.updateReticles(p);
    this.updateMarkers();
    if (this.textT <= 0) {
      this.textT = 0.12;
      this.updateText(p);
    }
    this.mapT -= dt;
    if (this.mapT <= 0) {
      this.mapT = 0.2;
      this.drawMinimap();
      if (g.mapOpen) this.drawTactical();
    }
    // reload ring
    const frac = p.reload > 0 ? 1 - p.reload / p.def.gun.reload : 1;
    (this.fireBtn.querySelector('.ring') as HTMLElement).style.background = `conic-gradient(${frac >= 1 ? '#f5c542' : '#9aa38a'} ${frac * 360}deg, rgba(0,0,0,0.25) 0deg)`;
    this.fireBtn.classList.toggle('ready', frac >= 1 && p.alive);
  }

  private project(v: THREE.Vector3): { x: number; y: number; behind: boolean } {
    const c = v.clone().project(this.g.camera);
    return { x: ((c.x + 1) / 2) * window.innerWidth, y: ((1 - c.y) / 2) * window.innerHeight, behind: c.z > 1 };
  }

  private updateReticles(p: Tank) {
    const g = this.g;
    const gm = this.project(g.barrelHit);
    const show = p.alive && !gm.behind;
    this.gunMarker.style.display = show ? '' : 'none';
    if (show) this.gunMarker.style.transform = `translate(${gm.x}px, ${gm.y}px)`;
    const conv = g.aimHit ? g.barrelHit.distanceTo(g.aimHit.point) < Math.max(1.2, g.aimHit.point.distanceTo(p.pos) * 0.012) : false;
    this.gunMarker.classList.toggle('on', conv);
    this.gunMarker.classList.toggle('aim', g.aiming);
    if (g.targetTank && g.aimHit) {
      const tt = g.targetTank;
      const d = Math.round(tt.pos.distanceTo(p.pos));
      this.targetInfo.style.display = '';
      this.targetInfo.innerHTML = `<b>${tt.def.name}</b> · ${d} m${tt.status === 'damaged' ? ' · damaged' : ''}`;
    } else this.targetInfo.style.display = 'none';
  }

  private updateMarkers() {
    const g = this.g;
    const seen = new Set<string>();
    const pl = g.playerTank;
    const list = [...g.mission.markers];
    if (g.platoon.order === 'move' && g.platoon.movePoint) {
      const mp = g.platoon.movePoint;
      list.push({ id: 'waypoint', label: 'Move', kind: 'objective', pos: () => new THREE.Vector3(mp.x, g.world.h(mp.x, mp.z) + 2, mp.z) });
    }
    for (const m of list) {
      const pos = m.pos();
      if (!pos) continue;
      seen.add(m.id);
      let e = this.markerEls.get(m.id);
      if (!e) {
        e = el('div', `marker ${m.kind}`, `<i></i><span></span>`);
        this.markersLayer.appendChild(e);
        this.markerEls.set(m.id, e);
      }
      const s = this.project(pos);
      const W = window.innerWidth, H = window.innerHeight;
      let { x, y } = s;
      const off = s.behind || x < 30 || x > W - 30 || y < 60 || y > H - 30;
      if (s.behind) {
        x = W - x;
        y = H - 40;
      }
      x = Math.max(36, Math.min(W - 36, x));
      y = Math.max(70, Math.min(H - 40, y));
      e.style.transform = `translate(${x}px, ${y}px)`;
      e.classList.toggle('off', off);
      const d = pl ? Math.round(pos.distanceTo(pl.pos)) : 0;
      (e.querySelector('span') as HTMLElement).textContent = `${m.label} ${d}m`;
    }
    for (const [id, e] of this.markerEls)
      if (!seen.has(id)) {
        e.remove();
        this.markerEls.delete(id);
      }
  }

  private updateText(p: Tank) {
    const g = this.g;
    if (p.id !== this.lastPlayerId) {
      this.lastPlayerId = p.id;
      const c = g.campaign.commanders[p.commanderId!];
      this.cmdCard.innerHTML = `<div class="cc-port"></div><div class="cc-body"><div class="cc-name"><span class="cc-rank"></span><b>${p.rankAbbr} ${p.commanderName}</b></div>
        <div class="cc-call">${p.callsign} · ${c && g.campaign.platoonCommanderId === c.id ? 'Platoon Commander' : 'Acting Platoon Commander'}</div>
        <div class="bar"><div class="bar-fill"></div></div><div class="cc-status"></div></div>`;
      if (c) {
        this.cmdCard.querySelector('.cc-rank')!.appendChild(rankCanvas(c.rankIndex, 26));
        this.cmdCard.querySelector('.cc-port')!.appendChild(portraitCanvas(c.portrait, c.rankIndex, false, 56));
      }
    }
    const hp = Math.round(p.hpFraction() * 100);
    const fill = this.cmdCard.querySelector('.bar-fill') as HTMLElement;
    fill.style.width = `${hp}%`;
    fill.style.background = hp > 60 ? '#7bc96f' : hp > 30 ? '#e8b93a' : '#d9534f';
    const chips: string[] = [`<span class="chip ${STATUS_CLASS[p.status]}">${STATUS_TEXT[p.status]} · ${hp}%</span>`];
    if (p.tracksBroken > 0) chips.push(`<span class="chip dmg">TRACK ${Math.ceil(p.tracksBroken)}s</span>`);
    if (p.turretJam > 0) chips.push(`<span class="chip dmg">TURRET ${Math.ceil(p.turretJam)}s</span>`);
    if (p.engineDamage > 0) chips.push('<span class="chip dmg">ENGINE</span>');
    if (p.fireTimer > 0) chips.push('<span class="chip dead">FIRE</span>');
    (this.cmdCard.querySelector('.cc-status') as HTMLElement).innerHTML = chips.join('');

    this.objective.innerHTML = `<small>OBJECTIVE</small>${g.mission.objectiveText}`;

    // ammo
    const names: Record<AmmoType, string> = { AP: 'AP', HE: 'HE', SMOKE: 'SMK' };
    this.ammoBtn.innerHTML = `<b>${names[p.ammoSel]}</b><small>${p.ammo[p.ammoSel]}</small>`;
    this.ammoBtn.dataset.ammo = p.ammoSel;
    for (const b of this.ammoMenu.querySelectorAll<HTMLElement>('.ammo-opt')) {
      const a = b.dataset.ammo as AmmoType;
      b.innerHTML = `<b>${a === 'SMOKE' ? 'SMOKE' : a}</b><small>${p.ammo[a]}</small>`;
      b.classList.toggle('active', a === p.ammoSel);
      b.classList.toggle('disabled', p.ammo[a] <= 0);
    }
    const reloadTxt = p.reload > 0 ? `RELOADING ${p.reload.toFixed(1)}s` : 'READY';
    (this.fireBtn.querySelector('.lbl') as HTMLElement).innerHTML = p.reload > 0 ? `${p.reload.toFixed(1)}` : 'FIRE';
    this.mgBtn.innerHTML = `MG<small>${p.mgReload > 0 ? 'RELOAD' : `${p.mgAmmo}/${p.mgBelts}`}</small>`;
    // sight readouts
    const rng = g.aimHit ? Math.round(g.aimHit.point.distanceTo(p.pos) / 10) * 10 : 0;
    (this.sight.querySelector('.s-ammo') as HTMLElement).textContent = `${p.ammoSel} ×${p.ammo[p.ammoSel]}`;
    (this.sight.querySelector('.s-reload') as HTMLElement).textContent = reloadTxt;
    (this.sight.querySelector('.s-reload') as HTMLElement).className = `s-reload ${p.reload > 0 ? 'wait' : 'ok'}`;
    (this.sight.querySelector('.s-range') as HTMLElement).textContent = g.targetTank ? `RANGE ${rng} m · ${g.targetTank.def.name}` : rng && rng < 880 ? `RANGE ${rng} m` : 'RANGE —';

    // platoon panel
    const allies = g.tanks.filter((t) => t.side === 'ally').sort((a, b) => a.slotIndex - b.slotIndex);
    const orderOf = (t: Tank) => (t.isPlayer ? 'Player' : !t.alive ? '—' : ORDER_LABEL[g.platoon.effectiveOrder(g.platoon.ais.find((a) => a.tank === t)!)]);
    this.platoonPanel.innerHTML = `<div class="pp-title">VANGUARD 1 · ${FORMATION_LABEL[g.platoon.formation].toUpperCase()}<span>${this.platoonCollapsed ? '▸' : '▾'}</span></div>` +
      allies
        .map(
          (t) => `<div class="pp-slot ${STATUS_CLASS[t.status]} ${t.isPlayer ? 'me' : ''}">
        <div class="pp-call">${t.callsign.replace('Vanguard ', '')}</div>
        <div class="pp-info"><b>${t.rankAbbr} ${t.commanderName.split(' ').pop()}</b> <small>${t.alive ? (t.status === 'damaged' ? 'Damaged · ' : '') + orderOf(t) : `${STATUS_TEXT[t.status]}${t.crew === 'killed' ? ' · KIA' : t.crew !== 'unhurt' ? ' · ' + t.crew : ''}`}</small></div>
        <div class="pp-hp"><i style="width:${Math.round(t.hpFraction() * 100)}%"></i></div></div>`,
        )
        .join('');
    this.platoonPanel.classList.toggle('collapsed', this.platoonCollapsed);
  }

  // ---------------------------------------------------------------- maps

  private buildStaticMap(size: number): HTMLCanvasElement {
    const g = this.g;
    const c = document.createElement('canvas');
    c.width = c.height = size;
    const x = c.getContext('2d')!;
    const half = g.world.def.half;
    const k = size / (half * 2);
    const X = (wx: number) => (wx + half) * k, Z = (wz: number) => (half - wz) * k;
    x.fillStyle = '#5f8a46';
    x.fillRect(0, 0, size, size);
    for (const f of g.world.def.fields) {
      x.fillStyle = { wheat: '#b9a64e', pasture: '#6fa84a', plough: '#7d6646', meadow: '#7db355' }[f.kind];
      x.fillRect(X(f.minX), Z(f.maxZ), (f.maxX - f.minX) * k, (f.maxZ - f.minZ) * k);
    }
    // stream
    x.strokeStyle = '#4f86b8';
    x.lineWidth = Math.max(2, 4 * k);
    x.beginPath();
    for (let wx = -half; wx <= half; wx += 8) x.lineTo(X(wx), Z(g.world.def.streamZ(wx)));
    x.stroke();
    // roads
    x.strokeStyle = '#d9c7a0';
    x.lineCap = 'round';
    for (const r of g.world.def.roads) {
      x.lineWidth = Math.max(2, r.width * k);
      x.beginPath();
      r.pts.forEach(([a, b], i) => (i ? x.lineTo(X(a), Z(b)) : x.moveTo(X(a), Z(b))));
      x.stroke();
    }
    for (const b of g.world.col.boxes) {
      x.fillStyle = b.kind === 'hedge' ? '#2f5e28' : b.kind === 'wall' || b.kind === 'rubble' || b.kind === 'barricade' ? '#8a877c' : b.kind === 'church' ? '#e8e2d0' : '#c8b8a0';
      x.fillRect(X(b.minX), Z(b.maxZ), Math.max(1, (b.maxX - b.minX) * k), Math.max(1, (b.maxZ - b.minZ) * k));
    }
    x.fillStyle = 'rgba(40,70,30,0.55)';
    for (const w of g.world.def.woods) {
      x.beginPath();
      x.arc(X(w.x), Z(w.z), w.r * k, 0, Math.PI * 2);
      x.fill();
    }
    return c;
  }

  private drawUnits(ctx: CanvasRenderingContext2D, X: (x: number) => number, Z: (z: number) => number, scale: number) {
    const g = this.g;
    for (const s of g.infantry.soldiers) {
      if (!s.active) continue;
      if (s.side === 'enemy' && !g.world.col.lineOfSight(g.playerTank!.pos.x, g.playerTank!.pos.y + 3, g.playerTank!.pos.z, s.pos.x, s.pos.y + 1, s.pos.z)) continue;
      ctx.fillStyle = s.side === 'ally' ? '#9fd3ff' : '#ff9a7a';
      ctx.fillRect(X(s.pos.x) - 1.5 * scale, Z(s.pos.z) - 1.5 * scale, 3 * scale, 3 * scale);
    }
    for (const n of g.infantry.nests) {
      if (!n.alive || !n.active) continue;
      ctx.strokeStyle = '#ff6040';
      ctx.lineWidth = 2 * scale;
      ctx.strokeRect(X(n.pos.x) - 4 * scale, Z(n.pos.z) - 4 * scale, 8 * scale, 8 * scale);
    }
    for (const t of g.tanks) {
      if (t.gone) continue;
      if (t.side === 'enemy' && (!g.enemySpotted.has(t.id) || !t.active)) continue;
      const x = X(t.pos.x), y = Z(t.pos.z);
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(t.heading);
      ctx.fillStyle = !t.alive ? '#555' : t.side === 'ally' ? (t.isPlayer ? '#ffe066' : '#5fb0ff') : '#ff4a3a';
      ctx.beginPath();
      ctx.moveTo(0, -6 * scale);
      ctx.lineTo(4.5 * scale, 5 * scale);
      ctx.lineTo(-4.5 * scale, 5 * scale);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
    for (const m of g.mission.markers) {
      const p = m.pos();
      if (!p || m.kind === 'enemy') continue;
      ctx.strokeStyle = m.kind === 'zone' ? '#ffffff' : '#ffd23f';
      ctx.lineWidth = 2 * scale;
      ctx.beginPath();
      ctx.arc(X(p.x), Z(p.z), Math.max(6 * scale, (m.radius ?? 0) * scale * 0.5), 0, Math.PI * 2);
      ctx.stroke();
    }
    const mp = g.platoon.order === 'move' ? g.platoon.movePoint : null;
    if (mp) {
      ctx.fillStyle = '#5fb0ff';
      ctx.beginPath();
      ctx.arc(X(mp.x), Z(mp.z), 4 * scale, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  private drawMinimap() {
    const g = this.g;
    const p = g.playerTank;
    if (!p) return;
    if (!this.staticMap) this.staticMap = this.buildStaticMap(1280);
    const c = this.minimap;
    const ctx = c.getContext('2d')!;
    const half = g.world.def.half;
    const view = 140; // metres radius
    const k = c.width / (view * 2);
    const sm = this.staticMap;
    const smk = sm.width / (half * 2);
    ctx.clearRect(0, 0, c.width, c.height);
    ctx.save();
    ctx.beginPath();
    ctx.arc(c.width / 2, c.height / 2, c.width / 2 - 2, 0, Math.PI * 2);
    ctx.clip();
    ctx.drawImage(sm, (p.pos.x - view + half) * smk, (half - p.pos.z - view) * smk, view * 2 * smk, view * 2 * smk, 0, 0, c.width, c.height);
    const X = (x: number) => (x - p.pos.x + view) * k, Z = (z: number) => (p.pos.z - z + view) * k;
    this.drawUnits(ctx, X, Z, 1);
    // camera view cone
    const yaw = g.aiming ? g.aimYaw : g.camYaw;
    ctx.fillStyle = 'rgba(255,255,255,0.15)';
    ctx.beginPath();
    ctx.moveTo(c.width / 2, c.height / 2);
    ctx.arc(c.width / 2, c.height / 2, 60, -Math.PI / 2 + yaw - 0.5, -Math.PI / 2 + yaw + 0.5);
    ctx.fill();
    ctx.restore();
    ctx.strokeStyle = 'rgba(255,255,255,0.7)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(c.width / 2, c.height / 2, c.width / 2 - 2, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 13px sans-serif';
    ctx.fillText('N', c.width / 2 - 5, 16);
  }

  private drawTactical() {
    const g = this.g;
    const c = this.mapCanvas;
    if (!this.staticMap) this.staticMap = this.buildStaticMap(1280);
    const ctx = c.getContext('2d')!;
    ctx.drawImage(this.staticMap, 0, 0, c.width, c.height);
    const half = g.world.def.half;
    const k = c.width / (half * 2);
    const s = c.width / 600;
    this.drawUnits(ctx, (x) => (x + half) * k, (z) => (half - z) * k, s);
    ctx.fillStyle = '#fff';
    ctx.font = `bold ${14 * s}px sans-serif`;
    ctx.fillText('BELLWICK', ((0 + half) * k) - 34 * s, (half - 205) * k);
    ctx.fillText('Hollow Wood', (30 + half) * k - 30 * s, (half - 100) * k);
    ctx.fillText('Orchards', (-150 + half) * k, (half + 2) * k);
  }
}
