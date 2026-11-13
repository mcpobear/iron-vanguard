import * as THREE from 'three';
import { World } from '../world/world';
import { Effects } from '../rendering/effects';
import { Audio } from '../audio/audio';
import { Tank } from '../vehicles/tank';
import { TANKS, type AmmoType } from '../data/tanks';
import { Infantry, type MGNest } from '../infantry/infantry';
import { Weapons } from '../weapons/weapons';
import { Platoon } from '../platoon/platoon';
import { EnemyAI, type EnemyOpts } from '../ai/tankAI';
import { MissionTracker } from '../progression/tracker';
import type { CampaignState, MissionResult } from '../campaign/types';
import { Input } from '../core/input';
import { presetValues, usesTouch, type Settings } from '../core/settings';
import { makeRng, type Rng } from '../core/rng';
import { Hud } from '../ui/hud';
import type { MissionScript } from '../missions/mission';
import { rankAbbr } from '../data/ranks';
import { successionOrder, nextCommandIndex } from '../campaign/campaign';
import { strongpointGeometry } from '../rendering/models';
import { POINTS } from '../missions/bellwickMap';
import { hitTankSegment } from '../weapons/weapons';

export interface GameCallbacks {
  onComplete(result: MissionResult): void;
  onFailed(): void;
  onQuit(): void;
  onRestart(): void;
}

export class Game {
  renderer: THREE.WebGLRenderer;
  scene = new THREE.Scene();
  camera: THREE.PerspectiveCamera;
  world: World;
  effects: Effects;
  tanks: Tank[] = [];
  infantry: Infantry;
  weapons: Weapons;
  platoon: Platoon;
  tracker: MissionTracker;
  input: Input;
  hud: Hud;
  rng: Rng;
  time = 0;
  realTime = 0;
  timeScale = 1;
  /** Debug/test only: multiplies simulation speed. */
  timeWarp = 1;
  paused = false;
  shadowsOn: boolean;
  touch: boolean;
  playerTank: Tank | null = null;
  enemySpotted = new Set<number>();
  /** Tutorial: AI tanks hold fire on enemy armour until this time (cancelled if a friendly is hit). */
  aiHoldFireUntil = 0;
  difficulty = { enemyDamage: 0.7, enemyAcquire: 3.6, enemySpread: 2.5, firstShotDelay: 3 };
  private enemyAIs: EnemyAI[] = [];
  private scheduled: { at: number; fn: () => void }[] = [];
  private raf = 0;
  private last = 0;
  private acc = 0;
  private disposed = false;
  private aimMode = false;
  camYaw = 0;
  camPitch = 0.2;
  camDist = 14;
  aimYaw = 0;
  aimPitch = 0;
  private camTarget = new THREE.Vector3();
  private shake = 0;
  private transfer: null | { t: number; from: Tank; to: Tank | null; camFrom: THREE.Vector3; switched: boolean } = null;
  private victory = false;
  private victoryT = 0;
  private finished = false;
  aimHit: { point: THREE.Vector3; tank: Tank | null } | null = null;
  barrelHit = new THREE.Vector3();
  targetTank: Tank | null = null;
  ordersOpen = false;
  mapOpen = false;
  private sun: THREE.DirectionalLight;
  private hidePlayer = false;

  constructor(
    public container: HTMLElement,
    public settings: Settings,
    public campaign: CampaignState,
    public mission: MissionScript,
    public audio: Audio,
    private cb: GameCallbacks,
  ) {
    const pv = presetValues(settings.graphics);
    this.shadowsOn = pv.shadows;
    this.touch = usesTouch(settings);
    this.rng = makeRng(Date.now() & 0xffffffff);
    this.renderer = new THREE.WebGLRenderer({ antialias: pv.antialias, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(pv.pixelRatio);
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.shadowMap.enabled = pv.shadows;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    container.appendChild(this.renderer.domElement);
    this.renderer.domElement.className = 'game-canvas';

    const fog = mission.info.fog;
    const fogColor = new THREE.Color(fog.color);
    this.scene.background = new THREE.Color(0xbcd4e6);
    this.scene.fog = new THREE.Fog(fogColor, fog.near, Math.min(fog.far, pv.viewDist));
    this.camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.3, pv.viewDist + 50);

    const hemi = new THREE.HemisphereLight(0xdfefff, 0x6a7a4a, 1.25);
    this.scene.add(hemi);
    this.sun = new THREE.DirectionalLight(0xfff1d6, 1.6);
    this.sun.position.set(-120, 160, -80);
    if (pv.shadows) {
      this.sun.castShadow = true;
      this.sun.shadow.mapSize.set(1024, 1024);
      const c = this.sun.shadow.camera;
      c.left = c.bottom = -60;
      c.right = c.top = 60;
      c.near = 10;
      c.far = 400;
      this.sun.shadow.bias = -0.0008;
    }
    this.scene.add(this.sun, this.sun.target);

    this.world = new World(mission.info.map, pv.trees);
    this.scene.add(this.world.group);
    this.effects = new Effects(pv.particleScale, fogColor);
    this.effects.glow.setFog(fog.near, Math.min(fog.far, pv.viewDist));
    this.effects.smoke.setFog(fog.near, Math.min(fog.far, pv.viewDist));
    this.scene.add(this.effects.group);
    // Hollow Wood strongpoint (scenery for the smoke phase)
    const sp = new THREE.Mesh(strongpointGeometry(), new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }));
    sp.position.set(POINTS.strongpoint.x, this.world.h(POINTS.strongpoint.x, POINTS.strongpoint.z), POINTS.strongpoint.z);
    sp.rotation.y = Math.PI / 2 + 0.2;
    this.scene.add(sp);

    this.infantry = new Infantry(this);
    this.weapons = new Weapons(this);
    this.platoon = new Platoon(this);
    this.tracker = new MissionTracker(mission.info.id, mission.info.name);

    this.hud = new Hud(this);
    this.input = new Input(this.hud.touchLayer, this.renderer.domElement, () => this.settings);
    this.input.setVisible(this.touch);

    this.spawnPlatoon();
    mission.start(this);
    const pl = this.playerTank!;
    this.camYaw = pl.heading;
    this.camTarget.copy(pl.pos);
    window.addEventListener('resize', this.onResize);
    this.audio.setAmbient(true);
    this.hud.mount();
  }

  // ---------------------------------------------------------------- setup

  private spawnPlatoon() {
    const s = this.campaign;
    const start = POINTS.playerStart;
    const order = successionOrder(s);
    order.forEach((slot, i) => {
      const c = s.commanders[slot.commanderId!];
      const tk = s.tanks[slot.tankId!];
      const t = new Tank(TANKS['A-44'], 'ally', tk.turretNumber, this.shadowsOn);
      t.commanderId = c.id;
      t.commanderName = `${c.firstName} ${c.lastName}`;
      t.rankAbbr = rankAbbr(c.rankIndex);
      t.callsign = slot.callsign;
      t.slotIndex = i;
      t.ability = c.ability;
      t.behaviour = c.behaviour;
      t.label = `${slot.callsign} (${tk.turretNumber})`;
      // column on the road, leader in front
      t.place(start.x + (i % 2 ? 1.5 : -1.5) * (i ? 1 : 0), start.z - i * 17, start.heading, this);
      this.scene.add(t.view.root);
      this.tanks.push(t);
      this.tracker.addCommander(c.id, slot.callsign, tk.id);
    });
    this.setPlayer(this.tanks[0]);
    this.platoon.rebuild(this.tanks);
  }

  spawnEnemy(defId: string, x: number, z: number, heading: number, o: Omit<EnemyOpts, 'guard'>): Tank {
    const t = new Tank(TANKS[defId], 'enemy', String(200 + this.tanks.length * 7), this.shadowsOn);
    t.place(x, z, heading, this);
    t.active = false;
    t.turretYaw = 0;
    this.scene.add(t.view.root);
    this.tanks.push(t);
    this.enemyAIs.push(new EnemyAI(t, { ...o, guard: { x, z, heading } }));
    return t;
  }

  activateEnemy(t: Tank, holdFireUntil?: number) {
    t.active = true;
    const ai = this.enemyAIs.find((a) => a.tank === t);
    if (ai && holdFireUntil !== undefined) ai.o.holdFireUntil = holdFireUntil;
  }

  private setPlayer(t: Tank) {
    for (const k of this.tanks) k.isPlayer = false;
    t.isPlayer = true;
    this.playerTank = t;
    this.platoon.rebuild(this.tanks);
  }

  // ---------------------------------------------------------------- helpers used by systems

  after(sec: number, fn: () => void) {
    this.scheduled.push({ at: this.time + Math.max(0, sec), fn });
  }

  radio(from: string, text: string) {
    this.hud.radio(from, text);
  }

  radioFrom(t: Tank, text: string, quiet = false) {
    if (t.side !== 'ally') return;
    this.hud.radio(`${t.callsign} (${t.rankAbbr} ${t.commanderName.split(' ').pop()})`, text, quiet);
  }

  playerCallsign() {
    const p = this.playerTank;
    return p ? `${p.callsign} (${p.rankAbbr} ${p.commanderName.split(' ').pop()})` : 'Vanguard';
  }

  experienceOf(cmdrId: string | null): number {
    return cmdrId ? this.campaign.commanders[cmdrId]?.missionsCompleted ?? 0 : 0;
  }

  /** Mercer's Veteran Leadership applies while he commands the platoon. */
  mercerLeading() {
    return this.playerTank?.ability === 'VETERAN_LEADERSHIP';
  }

  cameraShake(a: number) {
    this.shake = Math.min(1.5, this.shake + a);
  }
  cameraShakeAt(p: THREE.Vector3, a: number) {
    const d = p.distanceTo(this.camera.position);
    if (d < 120) this.cameraShake(a * (1 - d / 120));
  }

  enemyDrivenOff(t: Tank) {
    if (t.gone) return;
    t.gone = true;
    t.view.root.visible = false;
    this.tracker.enemyTanksDrivenOff++;
    this.radio('Vanguard 1-2', `Enemy ${t.def.name} has fled the area.`);
  }

  onAllyHit(t: Tank, shooter: Tank, penetrated: boolean, ricochet: boolean, crits: string[]) {
    if (shooter.side === 'enemy') this.aiHoldFireUntil = 0;
    if (shooter.side === 'ally') {
      if (t.alive && this.time - (t as any)._ffT > 5) {
        (t as any)._ffT = this.time;
        this.radioFrom(t, 'Check fire! Check fire! You\'re hitting friendly armour!');
      }
      return;
    }
    if (t.isPlayer) {
      this.hud.damageFlash(penetrated ? 1 : 0.4);
      this.cameraShake(penetrated ? 1 : 0.4);
      const hull = Math.round(t.hpFraction() * 100);
      const msg = ricochet ? 'Ricochet! That bounced off.' : penetrated ? `We're hit! Hull ${hull}%.${crits.length ? ' ' + crits.map((c) => ({ TRACKS: 'Track broken!', ENGINE: 'Engine damaged!', FIRE: 'FIRE! Extinguishers!', TURRET: 'Turret ring jammed!' } as any)[c]).join(' ') : ''}` : 'Hit, no penetration — armour held!';
      if (t.alive) this.hud.radio('Crew', msg, false);
    } else if (t.alive && penetrated && this.time - ((t as any)._repT ?? -99) > 6) {
      (t as any)._repT = this.time;
      this.radioFrom(t, `We're hit! ${crits.includes('TRACKS') ? 'Track\'s gone, we\'re immobile.' : `Hull ${Math.round(t.hpFraction() * 100)}%.`}${t.ability === 'MECHANICAL_EXPERTISE' ? ' Damage assessed, still in the fight.' : ''}`);
    }
  }

  onAllyKnockedOut(t: Tank, outcomeText: string) {
    const what = t.status === 'destroyed' ? 'destroyed' : 'knocked out';
    this.radio(t.isPlayer ? 'Crew' : 'Vanguard', `${t.callsign} ${what}! ${outcomeText}.`);
    if (t.crew === 'killed') this.hud.casualtyNotice(t);
    if (t.isPlayer) this.beginTransfer(t);
    else if (!this.tanks.some((k) => k.side === 'ally' && k.alive)) this.fail();
  }

  onEnemyKnockedOut(t: Tank, killer: Tank | null) {
    if (killer?.isPlayer) this.hud.hitMarker(t.status === 'destroyed' ? 'TARGET DESTROYED' : 'TARGET KNOCKED OUT', 'good');
    else if (killer) this.radioFrom(killer, `Target destroyed! ${t.def.name} is burning.`);
    t.throttle = 0;
  }

  onPositionDestroyed(n: MGNest, by: Tank | null) {
    if (by && !by.isPlayer) this.radioFrom(by, `${n.name} destroyed.`);
  }

  // ---------------------------------------------------------------- command succession

  private beginTransfer(from: Tank) {
    const order = this.tanks.filter((t) => t.side === 'ally').map((t) => t.slotIndex);
    const idx = nextCommandIndex(order, from.slotIndex, (i) => this.tanks.find((t) => t.side === 'ally' && t.slotIndex === i)?.alive ?? false);
    const to = idx >= 0 ? this.tanks.find((t) => t.side === 'ally' && t.slotIndex === idx)! : null;
    this.input.resetAll();
    this.input.enabled = false;
    this.input.exitPointerLock();
    this.setAim(false);
    this.closeOverlays();
    this.transfer = { t: 0, from, to, camFrom: this.camera.position.clone(), switched: false };
    this.hud.showTransfer(from, to);
    if (!to) this.after(0.1, () => {});
  }

  private updateTransfer(realDt: number) {
    const tr = this.transfer!;
    tr.t += realDt;
    this.timeScale = tr.t < 2.8 ? 0.18 : 1;
    if (!tr.to) {
      if (tr.t > 3) {
        this.transfer = null;
        this.fail();
      }
      return;
    }
    if (!tr.switched && tr.t > 2.8) {
      tr.switched = true;
      this.setPlayer(tr.to);
      this.platoon.onCommandTransfer();
      this.camYaw = tr.to.heading;
      this.camPitch = 0.2;
      tr.camFrom = this.camera.position.clone();
      this.radio(this.playerCallsign(), `This is ${tr.to.callsign}. I have command. All Vanguard call-signs, on me.`);
    }
    if (tr.t > 4.2) {
      this.transfer = null;
      this.hud.hideTransfer();
      this.input.resetAll();
      this.input.enabled = true;
      this.timeScale = 1;
    }
  }

  // ---------------------------------------------------------------- mission end

  fail() {
    if (this.finished) return;
    this.finished = true;
    this.input.enabled = false;
    this.input.exitPointerLock();
    this.hud.showFailed();
  }

  beginVictory() {
    this.victory = true;
    this.input.resetAll();
    this.input.enabled = false;
    this.input.exitPointerLock();
    this.setAim(false);
    this.closeOverlays();
    this.hud.setControlsVisible(false);
    this.hud.root.classList.add('cinematic');
    for (const t of this.tanks) if (t.side === 'ally') t.throttle = t.steer = 0;
  }

  showVictory() {
    this.finished = true;
    this.audio.playMusic(1);
    this.hud.showVictory();
  }

  missionResult(success: boolean): MissionResult {
    // survivors' final vehicle state
    for (const t of this.tanks) {
      if (t.side !== 'ally' || !t.commanderId) continue;
      if (t.alive) this.tracker.setVehicle(t.commanderId, t.status, Math.round(t.hp));
    }
    return this.tracker.result(success, Math.round(this.time), this.mission.info.objectives.length, this.playerTank?.commanderId ?? null);
  }

  completeToDebrief() {
    this.cb.onComplete(this.missionResult(true));
  }
  restart() {
    this.cb.onRestart();
  }
  quit() {
    this.cb.onQuit();
  }

  // ---------------------------------------------------------------- player control

  setAim(on: boolean) {
    if (on === this.aimMode) return;
    this.aimMode = on;
    if (on) {
      this.aimYaw = this.camYaw;
      const p = this.playerTank;
      this.aimPitch = p ? p.gunPitch : 0;
    } else {
      this.camYaw = this.aimYaw;
    }
    this.hud.setAimMode(on);
  }
  get aiming() {
    return this.aimMode;
  }

  selectAmmo(a: AmmoType) {
    const p = this.playerTank;
    if (!p || !p.alive || p.ammoSel === a) return;
    if (p.ammo[a] <= 0) {
      this.hud.flash(`NO ${a === 'SMOKE' ? 'SMOKE' : a} ROUNDS LEFT`);
      return;
    }
    p.ammoSel = a;
    p.reload = Math.max(p.reload, p.def.gun.reload * 0.5); // unload & reload drill
    this.hud.flash(`${a === 'AP' ? 'ARMOUR-PIERCING' : a === 'HE' ? 'HIGH-EXPLOSIVE' : 'SMOKE'} LOADING`);
  }

  firePlayer() {
    const p = this.playerTank;
    if (!p || !p.alive) return;
    if (p.reload > 0) return;
    if (p.ammo[p.ammoSel] <= 0) {
      this.hud.flash('OUT OF AMMUNITION — SELECT ANOTHER TYPE');
      return;
    }
    const moving = Math.abs(p.speed) > 1;
    let spread = moving ? (p.ability === 'HUNTERS_INSTINCT' ? 1.5 : 1.9) : 1;
    if (p.ability === 'NATURAL_GUNNER' && !moving) spread *= 0.75;
    if (this.weapons.fireMain(p, spread) && p.commanderId) {
      /* tracked in weapons */
    }
  }

  /** Look input forwarded from a dragged HUD button (fire / MG). */
  look(dx: number, dy: number) {
    this.input.addLook(dx, dy);
  }

  recenterCamera() {
    const p = this.playerTank;
    if (p) {
      this.camYaw = p.heading;
      this.camPitch = 0.2;
    }
  }

  openOrders(open: boolean) {
    this.ordersOpen = open;
    this.hud.showOrders(open);
  }
  openMap(open: boolean, forMove = false) {
    this.mapOpen = open;
    this.hud.showMap(open, forMove);
  }
  closeOverlays() {
    if (this.ordersOpen) this.openOrders(false);
    if (this.mapOpen) this.openMap(false);
  }

  togglePause(p?: boolean) {
    if (this.finished || this.transfer || this.victory) return;
    this.paused = p ?? !this.paused;
    if (this.paused) {
      this.input.resetAll();
      this.input.exitPointerLock();
    }
    this.hud.showPause(this.paused);
  }

  private handleInput(dt: number) {
    const inp = this.input;
    inp.update(dt);
    const p = this.playerTank;
    if (inp.consume('pause') || inp.consume('pointerUnlocked')) {
      if (this.mapOpen || this.ordersOpen) this.closeOverlays();
      else if (!this.touch) this.togglePause(true);
    }
    if (!p || !p.alive || this.transfer || this.victory || this.finished) {
      if (p) p.throttle = p.steer = 0;
      return;
    }
    p.throttle = inp.move.y;
    // physics yaw is +x-ward, which is screen-left when looking along +z: negate so stick-right turns right
    p.steer = -inp.move.x;
    const look = inp.takeLook();
    const s = this.settings;
    const inv = s.invertY ? -1 : 1;
    if (this.aimMode) {
      let sens = 0.0016 * s.aimSensitivity * (this.camera.fov / 20);
      // subtle aim assist: friction near enemy tanks
      if (s.aimAssist && this.targetTank && this.aimHit) {
        const c = this.targetTank.centre();
        const dir = c.clone().sub(this.camera.position).normalize();
        const yawTo = Math.atan2(dir.x, dir.z);
        const dy = Math.atan2(Math.sin(yawTo - this.aimYaw), Math.cos(yawTo - this.aimYaw));
        if (Math.abs(dy) < 0.04) {
          sens *= 0.6;
          this.aimYaw += dy * Math.min(1, dt * 0.8);
        }
      }
      this.aimYaw -= look.x * sens;
      this.aimPitch = Math.max(-0.14, Math.min(0.33, this.aimPitch - look.y * sens * inv));
    } else {
      const sens = 0.005 * s.lookSensitivity;
      this.camYaw -= look.x * sens;
      this.camPitch = Math.max(-0.12, Math.min(0.95, this.camPitch + look.y * 0.004 * s.lookSensitivity * inv));
    }
    const z = inp.takeZoom();
    if (z) {
      if (this.aimMode) this.camera.fov = Math.max(10, Math.min(28, this.camera.fov + z * 3));
      else this.camDist = Math.max(8, Math.min(30, this.camDist + z * 2));
    }
    if (inp.consume('aim')) this.setAim(!this.aimMode);
    if (inp.consume('fire')) this.firePlayer();
    if (inp.mgHeld) this.weapons.fireMG(p);
    const ammo = inp.consumePrefix('ammo:');
    if (ammo) this.selectAmmo(ammo as AmmoType);
    if (inp.consume('orders')) this.openOrders(!this.ordersOpen);
    if (inp.consume('map')) this.openMap(!this.mapOpen);
    if (inp.consume('formation')) this.platoon.cycleFormation();
  }

  // ---------------------------------------------------------------- raycast & aiming

  raycast(o: THREE.Vector3, dir: THREE.Vector3, max: number, ignore: Tank | null): { point: THREE.Vector3; tank: Tank | null } {
    const end = o.clone().addScaledVector(dir, max);
    let best = 1;
    let tank: Tank | null = null;
    const tb = this.world.col.segmentBoxes(o.x, o.y, o.z, end.x, end.y, end.z);
    if (tb >= 0) best = tb;
    const tt = this.world.col.segmentTerrain(o.x, o.y, o.z, end.x, end.y, end.z, 4);
    if (tt >= 0 && tt < best) best = tt;
    for (const t of this.tanks) {
      if (t === ignore || t.gone) continue;
      const h = hitTankSegment(t, o, end);
      if (h && h.t < best) {
        best = h.t;
        tank = t;
      }
    }
    return { point: o.clone().addScaledVector(dir, best * max), tank };
  }

  private updateAiming() {
    const p = this.playerTank;
    if (!p || !p.alive) return;
    const cam = this.camera;
    let o: THREE.Vector3, dir: THREE.Vector3;
    if (this.aimMode) {
      o = cam.position.clone();
      dir = new THREE.Vector3(Math.sin(this.aimYaw) * Math.cos(this.aimPitch), Math.sin(this.aimPitch), Math.cos(this.aimYaw) * Math.cos(this.aimPitch));
    } else {
      // crosshair sits above screen centre (like most tank games)
      const ndc = new THREE.Vector3(0, 0.24, 0.5).unproject(cam);
      o = cam.position.clone();
      dir = ndc.sub(o).normalize();
    }
    const hit = this.raycast(o, dir, 900, p);
    this.aimHit = hit;
    p.aimPoint = hit.point;
    // target designation: direct hit or nearest enemy within a small cone
    let tgt: Tank | null = hit.tank && hit.tank.side === 'enemy' && hit.tank.alive ? hit.tank : null;
    if (!tgt) {
      let bestA = 0.05;
      for (const t of this.tanks) {
        if (t.side !== 'enemy' || !t.alive || t.gone) continue;
        const to = t.centre().sub(o).normalize();
        const a = to.angleTo(dir);
        if (a < bestA && this.world.col.lineOfSight(o.x, o.y, o.z, t.centre().x, t.centre().y, t.centre().z, 0.8)) {
          bestA = a;
          tgt = t;
        }
      }
    }
    this.targetTank = tgt;
    // where the barrel actually points
    const mp = new THREE.Vector3(), md = new THREE.Vector3();
    p.muzzle(mp, md);
    this.barrelHit.copy(this.raycast(mp, md, 900, p).point);
  }

  // ---------------------------------------------------------------- camera

  private updateCamera(dt: number) {
    const p = this.playerTank;
    if (!p) return;
    const cam = this.camera;
    if (this.victory) {
      this.victoryT += dt;
      const c = new THREE.Vector3(0, this.world.h(0, 140), 140);
      const a = this.victoryT * 0.12 + 2.4;
      cam.position.lerp(new THREE.Vector3(c.x + Math.sin(a) * 34, c.y + 13, c.z + Math.cos(a) * 34), Math.min(1, dt * 1.5));
      cam.lookAt(c.x, c.y + 6, c.z);
      if (cam.fov !== 55) {
        cam.fov = 55;
        cam.updateProjectionMatrix();
      }
      return;
    }
    this.shake = Math.max(0, this.shake - dt * 2.5);
    const sh = this.shake * this.shake * 0.25;
    if (this.aimMode && p.alive) {
      if (cam.fov > 30) cam.fov = 20;
      p.view.root.updateMatrixWorld(true);
      const sp = new THREE.Vector3();
      p.view.sight.getWorldPosition(sp);
      cam.position.copy(sp).add(new THREE.Vector3(0, 0.15, 0));
      const dir = new THREE.Vector3(Math.sin(this.aimYaw) * Math.cos(this.aimPitch), Math.sin(this.aimPitch), Math.cos(this.aimYaw) * Math.cos(this.aimPitch));
      cam.lookAt(cam.position.clone().add(dir));
      cam.rotation.z += (Math.random() - 0.5) * sh * 0.05 + p.bodyRoll * 0.3;
      if (!this.hidePlayer) {
        this.hidePlayer = true;
        p.view.root.visible = false;
      }
    } else {
      if (cam.fov !== 60) cam.fov = 60;
      if (this.hidePlayer) {
        this.hidePlayer = false;
        for (const t of this.tanks) if (!t.gone) t.view.root.visible = true;
      }
      const target = p.pos.clone().add(new THREE.Vector3(0, 3.0, 0));
      const tr = this.transfer;
      const follow = tr && tr.switched ? Math.min(1, dt * 2.2) : Math.min(1, dt * 9);
      this.camTarget.lerp(target, follow);
      const cp = Math.cos(this.camPitch);
      const off = new THREE.Vector3(-Math.sin(this.camYaw) * cp, Math.sin(this.camPitch), -Math.cos(this.camYaw) * cp).multiplyScalar(this.camDist);
      let desired = this.camTarget.clone().add(off);
      // collision avoidance: pull in front of walls / hills
      const t = this.world.col.segmentBoxes(this.camTarget.x, this.camTarget.y, this.camTarget.z, desired.x, desired.y, desired.z, true);
      if (t >= 0) desired = this.camTarget.clone().addScaledVector(off, Math.max(0.15, t * 0.9));
      let gh = this.world.h(desired.x, desired.z) + 1.2;
      // don't put the camera inside a neighbouring tank (common in column formation)
      for (const o of this.tanks) {
        if (o === p || o.gone) continue;
        const d = Math.hypot(o.pos.x - desired.x, o.pos.z - desired.z);
        if (d < o.def.radius + 2.5) gh = Math.max(gh, o.pos.y + o.view.turretHeight + 2.2 * (1 - d / (o.def.radius + 2.5)) + 0.8);
      }
      if (desired.y < gh) desired.y += (gh - desired.y) * 0.6 + 0.01;
      cam.position.copy(desired);
      cam.position.x += (Math.random() - 0.5) * sh;
      cam.position.y += (Math.random() - 0.5) * sh;
      // engine vibration
      cam.position.y += Math.sin(this.time * 40) * 0.008 * Math.min(1, Math.abs(p.speed) / 3);
      cam.lookAt(this.camTarget);
    }
    cam.updateProjectionMatrix();
    this.audio.setListener(cam.position, Math.atan2(cam.getWorldDirection(new THREE.Vector3()).x, cam.getWorldDirection(new THREE.Vector3()).z));
    // keep the sun shadow box around the player
    this.sun.position.set(p.pos.x - 120, p.pos.y + 160, p.pos.z - 80);
    this.sun.target.position.copy(p.pos);
  }

  // ---------------------------------------------------------------- main loop

  start() {
    this.last = performance.now();
    const loop = (now: number) => {
      if (this.disposed) return;
      this.raf = requestAnimationFrame(loop);
      const cap = this.settings.fpsCap;
      const elapsed = (now - this.last) / 1000;
      if (cap && elapsed < 1 / cap - 0.002) return;
      this.last = now;
      this.frame(Math.min(0.05, elapsed));
    };
    this.raf = requestAnimationFrame(loop);
  }

  private frame(realDt: number) {
    this.realTime += realDt;
    if (this.transfer) this.updateTransfer(realDt * this.timeWarp);
    else if (!this.victory) this.timeScale = this.ordersOpen && this.settings.slowOnOrders ? 0.25 : this.mapOpen && this.settings.slowOnOrders ? 0.25 : 1;
    const dt = this.paused ? 0 : realDt * this.timeScale * this.timeWarp;
    if (!this.paused) {
      this.handleInput(realDt);
      this.update(dt);
    }
    this.updateCamera(realDt);
    if (!this.paused) this.updateAiming();
    this.hud.update(realDt);
    this.renderer.render(this.scene, this.camera);
  }

  private update(dt: number) {
    if (dt <= 0) return;
    this.time += dt;
    for (let i = this.scheduled.length - 1; i >= 0; i--) {
      if (this.scheduled[i].at <= this.time) {
        const s = this.scheduled.splice(i, 1)[0];
        s.fn();
      }
    }
    for (const t of this.tanks) if (t.side === 'enemy' && !t.active && t.lastHitTime > 0) t.active = true;
    this.platoon.update(dt);
    for (const ai of this.enemyAIs) ai.update(dt, this);
    for (const t of this.tanks) if (!t.gone) t.update(dt, this);
    this.weapons.update(dt);
    this.infantry.update(dt);
    this.world.col.updateSmoke(dt);
    for (const s of this.world.col.smoke) this.effects.smokeTick(s.x, s.y - 2, s.z, s.r, Math.min(1, s.life / 10));
    this.effects.update(dt);
    this.mission.update(dt, this);
    const p = this.playerTank;
    if (p?.commanderId) {
      const st = this.tracker.get(p.commanderId);
      if (st) st.timeAsPlayer += dt;
    }
    if (p && p.alive) this.audio.engine(Math.min(1, Math.abs(p.speed) / p.def.maxSpeed * 0.8 + Math.abs(p.throttle) * 0.25), Math.abs(p.throttle), Math.min(1, Math.abs(p.speed) / p.def.maxSpeed));
    else this.audio.engine(0, 0, 0);
    this.audio.ambientTick(dt);
  }

  private onResize = () => {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  };

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    window.removeEventListener('resize', this.onResize);
    this.input.exitPointerLock();
    this.input.dispose();
    this.audio.setAmbient(false);
    this.hud.unmount();
    this.renderer.dispose();
    this.renderer.domElement.remove();
    this.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.geometry) m.geometry.dispose();
    });
  }
}
