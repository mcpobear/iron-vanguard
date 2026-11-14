import * as THREE from 'three';
import type { Game } from '../game/game';
import type { Marker, MissionInfo, MissionScript } from './mission';
import { ARDENNE, APOINTS, SECTORS, SECTOR_IDS, type Sector, type SectorId } from './ardenneMap';
import type { Tank } from '../vehicles/tank';
import type { Soldier } from '../infantry/infantry';
import { AlliedPlatoon } from '../ai/alliedPlatoon';
import { strongpointGeometry, truckGeometry } from '../rendering/models';
import { GeoBuilder } from '../rendering/geo';

export const ARDENNE_INFO: MissionInfo = {
  id: 'ardenne',
  name: 'Last Stand at Ardenne Farm',
  campaign: 'Operation Dawn Spear',
  location: 'Ardenne crossroads, south of Kessler Ridge',
  time: '1640 hours',
  weather: 'Overcast, light failing',
  difficulty: 'Hard',
  duration: '8–12 minutes',
  briefing: [
    'Vanguard, Regiment. Bad news. While we held Kessler Ridge, the Varkovians broke through the division on our right. Their armour is loose behind us.',
    'Everything the regiment eats, burns and fires comes up one road, and that road runs through the crossroads at Ardenne Farm. If the farm goes, the ridge goes with it.',
    'You will hold Ardenne Farm. No withdrawal this time, Vanguard — there is nowhere to withdraw to.',
    'There are three ways in. The North Road crosses open wheat: good tank country, long shots. The East Track comes out of a gap in the woods. The West Lane runs through hedges and an orchard, and gets closest under cover.',
    'You have three things to plug them with: Vanguard 2 — three tanks — a section of two anti-tank guns, and enough mines to close one road. You cannot be strong everywhere. Decide where each goes before the first shot; once they are dug in, they stay.',
    'Two supply lorries are parked in the farmyard. Halt beside one between attacks and the crews will rearm you and patch what they can. Lose the lorries and you fight with what is in your racks.',
    'Hammer Battery can spare you two fire missions once it has finished shooting for the ridge.',
    'A relief column from 7th Armoured is on the road south. Nine minutes, perhaps less. Expect their heaviest push last — they know the clock as well as we do.',
    'Remember, Vanguard — tanks can be replaced. Experienced crews cannot. Hold the farm.',
  ],
  objectives: [
    'Deploy your defences around Ardenne Farm',
    'Beat off the probing attack',
    'Hold both flanks',
    'Hold the farm against the general assault',
    'Blunt the armoured push until the relief column arrives',
  ],
  map: ARDENNE,
  fog: { color: 0xb9c2c8, near: 110, far: 520 },
  order: 3,
  enemySkill: 1.15,
  victoryTitle: 'ARDENNE FARM HELD',
  forces: {
    friendly: 'Vanguard 1, Vanguard 2 (3 tanks), anti-tank section (2 guns), one minefield, farm garrison, 2 supply lorries; Hammer Battery later',
    enemy: 'Varkovian battlegroup attacking from three directions — Boar and Ox tanks, infantry, and V-58 Bastion heavy tanks in the final push',
  },
  mapLabels: [
    { text: 'ARDENNE FARM', x: APOINTS.farm.x, z: APOINTS.farm.z - 22 },
    { text: 'North Road', x: SECTORS.north.mines.x, z: SECTORS.north.mines.z + 44 },
    { text: 'East Track', x: SECTORS.east.mines.x - 34, z: SECTORS.east.mines.z + 22 },
    { text: 'West Lane', x: SECTORS.west.mines.x + 34, z: SECTORS.west.mines.z + 22 },
    { text: 'Relief route', x: 0, z: -190 },
  ],
};

const HQ = 'Regiment HQ';
const BTY = 'Hammer Battery';
const GUNS = 'Anti-tank section';
const QM = 'Quartermaster';

const v3 = (p: { x: number; z: number }, g: Game, dy = 2) => new THREE.Vector3(p.x, g.world.h(p.x, p.z) + dy, p.z);
const mmss = (s: number) => `${Math.floor(Math.max(0, s) / 60)}:${String(Math.floor(Math.max(0, s) % 60)).padStart(2, '0')}`;

interface Spawn {
  def: 'V-32' | 'V-41' | 'V-58';
  sector: SectorId;
  /** Offset across the line of advance, metres. */
  lat: number;
  delay: number;
  /** Breakthrough tank: drives for the farmyard itself rather than stopping to shoot. */
  deep?: boolean;
}
interface Wave {
  at: number;
  spawns: Spawn[];
  infantry: SectorId[];
}

/** Seconds of battle before the relief column arrives. */
const RELIEF_AT = 545;
const PREP_TIME = 45;

const WAVES: Wave[] = [
  {
    at: 0,
    infantry: ['north'],
    spawns: [
      { def: 'V-32', sector: 'north', lat: -42, delay: 0 },
      { def: 'V-32', sector: 'north', lat: 14, delay: 4, deep: true },
      { def: 'V-32', sector: 'north', lat: 44, delay: 9 },
      { def: 'V-32', sector: 'north', lat: -14, delay: 15 },
    ],
  },
  {
    at: 125,
    infantry: [],
    spawns: [
      { def: 'V-41', sector: 'east', lat: -14, delay: 0 },
      { def: 'V-32', sector: 'east', lat: 16, delay: 6, deep: true },
      { def: 'V-41', sector: 'east', lat: 0, delay: 16 },
      { def: 'V-41', sector: 'west', lat: 18, delay: 3 },
      { def: 'V-32', sector: 'west', lat: -20, delay: 10, deep: true },
    ],
  },
  {
    at: 265,
    infantry: ['east', 'west'],
    spawns: [
      { def: 'V-41', sector: 'north', lat: -30, delay: 0 },
      { def: 'V-41', sector: 'north', lat: 30, delay: 5 },
      { def: 'V-41', sector: 'east', lat: -12, delay: 8, deep: true },
      { def: 'V-32', sector: 'east', lat: 16, delay: 14 },
      { def: 'V-41', sector: 'west', lat: 16, delay: 10 },
      { def: 'V-32', sector: 'west', lat: -18, delay: 18, deep: true },
    ],
  },
  {
    at: 400,
    infantry: ['north'],
    spawns: [
      { def: 'V-58', sector: 'north', lat: -22, delay: 0 },
      { def: 'V-58', sector: 'north', lat: 24, delay: 8 },
      { def: 'V-41', sector: 'north', lat: -52, delay: 4, deep: true },
      { def: 'V-41', sector: 'east', lat: 0, delay: 20, deep: true },
      { def: 'V-41', sector: 'west', lat: 14, delay: 24 },
      { def: 'V-32', sector: 'west', lat: -18, delay: 30, deep: true },
    ],
  },
];

interface Gun {
  pos: THREE.Vector3;
  mesh: THREE.Mesh;
  hp: number;
  cd: number;
  n: number;
}
interface Truck {
  pos: THREE.Vector3;
  mesh: THREE.Mesh;
  hp: number;
  fireT: number;
}

export class ArdenneMission implements MissionScript {
  info = ARDENNE_INFO;
  playerStart = { ...APOINTS.playerStart, heading: 0 };
  victoryFocus = APOINTS.farm;
  objectiveText = '';
  markers: Marker[] = [];
  phaseIndex = 0;

  private flags = new Set<string>();
  private planned = false;
  private prep = PREP_TIME;
  /** Battle clock: seconds since first contact. */
  private clock = 0;
  private plan: Record<'v2' | 'guns' | 'mines', SectorId> = { v2: 'north', guns: 'east', mines: 'west' };
  private v2!: AlliedPlatoon;
  private guns: Gun[] = [];
  private mineCentre: THREE.Vector3 | null = null;
  private minesLeft = 6;
  private mineChecked = new Set<number>();
  private trucks: Truck[] = [];
  private spawned: Tank[] = [];
  private pending = 0;
  private rearmT = 0;
  private rearmCd = 0;
  private overrunT = 0;
  private tick = 0;
  private victoryAt = -1;
  private supportUntil = 0;

  // ---------------------------------------------------------------- setup

  start(g: Game) {
    const P = APOINTS;
    // The farm garrison: riflemen and a couple of anti-tank teams dug in round the yard.
    g.infantry.spawnSquad('ally', 'Ardenne garrison', P.garrison.x, P.garrison.z, 8, 0, { defend: true, at: 2 });

    for (const [i, p] of [P.truckA, P.truckB].entries()) {
      const mesh = new THREE.Mesh(truckGeometry(), new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }));
      const y = g.world.h(p.x, p.z);
      mesh.position.set(p.x, y, p.z);
      mesh.rotation.y = i ? 0.25 : -0.2;
      mesh.castShadow = g.shadowsOn;
      g.scene.add(mesh);
      g.world.col.addBox({ minX: p.x - 2, maxX: p.x + 2, minZ: p.z - 3.4, maxZ: p.z + 3.4, y0: y - 2, y1: y + 3.2, blocksLOS: false, solid: true, kind: 'truck' });
      this.trucks.push({ pos: new THREE.Vector3(p.x, y, p.z), mesh, hp: 100, fireT: 0 });
    }

    // Vanguard 2 waits at the crossroads until the player decides where it fights.
    this.v2 = new AlliedPlatoon('Vanguard 2', 'Vanguard 2 Platoon', P.crossroads, g, 4402);
    this.v2.deploy({ x: P.crossroads.x, z: P.crossroads.z + 16 }, 0, 3);
    g.alliedPlatoons.push(this.v2);

    g.artillery.available = 2;
    g.artillery.enabled = false;

    this.objectiveText = this.info.objectives[0];
    g.hold = true;
    g.hud.showPlan({
      title: 'DEFENCE PLAN',
      intro: 'Three roads lead to the farm. Place each asset on one of them — you may double up. Your own platoon goes wherever you drive it.',
      assets: [
        { id: 'v2', label: 'VANGUARD 2', desc: 'Three Sentinel tanks. Flexible and hard-hitting.' },
        { id: 'guns', label: 'ANTI-TANK GUNS', desc: 'Two dug-in guns. Deadly at range, helpless if overrun.' },
        { id: 'mines', label: 'MINEFIELD', desc: 'Six mines across one road. Cripples the first tanks through.' },
      ],
      sectors: SECTOR_IDS.map((id) => ({ id, label: SECTORS[id].label, x: SECTORS[id].mines.x, z: SECTORS[id].mines.z })),
      defaults: this.plan,
      confirm: 'DIG IN',
      onConfirm: (c) => {
        this.plan = c as typeof this.plan;
        this.applyPlan(g);
        g.hold = false;
      },
    });
  }

  private facing(s: Sector) {
    return Math.atan2(s.lane.x - s.post.x, s.lane.z - s.post.z);
  }

  private applyPlan(g: Game) {
    const sv = SECTORS[this.plan.v2], sg = SECTORS[this.plan.guns], sm = SECTORS[this.plan.mines];
    this.v2.setSector(sv.post, 'hold', this.facing(sv));

    sg.guns.forEach((p, i) => {
      const mesh = new THREE.Mesh(strongpointGeometry(), new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }));
      const y = g.world.h(p.x, p.z);
      mesh.position.set(p.x, y, p.z);
      // the model's barrel lies along local -x; turn it onto the enemy's approach
      mesh.rotation.y = Math.atan2(sg.lane.z - p.z, -(sg.lane.x - p.x));
      g.scene.add(mesh);
      this.guns.push({ pos: new THREE.Vector3(p.x, y + 1.2, p.z), mesh, hp: 100, cd: 3 + i * 3, n: i + 1 });
    });

    // Minefield: warning stakes round the edge so the player can see where it lies.
    this.mineCentre = new THREE.Vector3(sm.mines.x, 0, sm.mines.z);
    const gb = new GeoBuilder();
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2;
      const x = sm.mines.x + Math.sin(a) * 27, z = sm.mines.z + Math.cos(a) * 27;
      if (g.world.col.pointBlocked(x, z, 1)) continue;
      const y = g.world.h(x, z);
      gb.box(x, y + 0.6, z, 0.12, 1.2, 0.12, 0x6b5a3a);
      gb.box(x, y + 1.15, z, 0.6, 0.4, 0.06, 0xc23b2a, a);
    }
    g.scene.add(new THREE.Mesh(gb.build(), new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true })));

    this.planned = true;
    this.enterPhase(g, 0);
  }

  // ---------------------------------------------------------------- helpers

  private once(id: string): boolean {
    if (this.flags.has(id)) return false;
    this.flags.add(id);
    return true;
  }

  private hint(g: Game, id: string, touch: string, desktop = touch) {
    if (this.once('hint-' + id)) g.hud.hint(g.touch ? touch : desktop);
  }

  private complete(g: Game, name: string) {
    g.tracker.objectiveComplete(name, g.playerTank?.commanderId ?? null);
    g.hud.objectiveComplete(name);
  }

  private liveEnemies(g: Game) {
    return g.tanks.filter((t) => t.side === 'enemy' && t.alive && !t.gone);
  }

  private liveTrucks() {
    return this.trucks.filter((t) => t.hp > 0);
  }

  pinsInfantry(_s: Soldier) {
    return false;
  }

  private baseMarkers(g: Game): Marker[] {
    const m: Marker[] = [];
    const lt = this.liveTrucks();
    if (lt.length) m.push({ id: 'supply', label: 'Supply point', kind: 'zone', pos: () => (this.liveTrucks()[0] ? this.liveTrucks()[0].pos.clone().setY(this.liveTrucks()[0].pos.y + 4) : null), radius: 14 });
    if (this.mineCentre && this.minesLeft > 0) m.push({ id: 'mines', label: 'Minefield', kind: 'zone', pos: () => (this.minesLeft > 0 ? v3(this.mineCentre!, g, 3) : null), radius: 26 });
    return m;
  }

  private attackMarkers(g: Game, sectors: SectorId[]): Marker[] {
    return sectors.map((id) => ({ id: 'atk-' + id, label: `Enemy — ${SECTORS[id].label}`, kind: 'enemy' as const, pos: () => v3(SECTORS[id].push, g, 6), radius: 40 }));
  }

  // ---------------------------------------------------------------- waves

  private launchWave(g: Game, i: number) {
    const w = WAVES[i];
    const farm = APOINTS.farm;
    this.pending += w.spawns.length;
    for (const s of w.spawns) {
      g.after(s.delay, () => {
        this.pending--;
        if (g.finishedMission || this.phaseIndex >= 5) return;
        const sec = SECTORS[s.sector];
        const dx = farm.x - sec.lane.x, dz = farm.z - sec.lane.z;
        const L = Math.hypot(dx, dz);
        const ux = dx / L, uz = dz / L;
        const px = uz, pz = -ux;
        const x = sec.lane.x + px * s.lat, z = sec.lane.z + pz * s.lat;
        const advanceTo = s.deep
          ? { x: farm.x - ux * 38 + px * s.lat * 0.3, z: farm.z - uz * 38 + pz * s.lat * 0.3 }
          : { x: sec.push.x + px * s.lat * 0.8, z: sec.push.z + pz * s.lat * 0.8 };
        const t = g.spawnEnemy(s.def, x, z, Math.atan2(ux, uz), {
          aggression: s.def === 'V-32' ? 0.85 : s.def === 'V-41' ? 0.55 : 0.4,
          retreatTo: sec.lane,
          advanceTo,
          preferredRange: s.def === 'V-32' ? 40 : s.def === 'V-41' ? 70 : 120,
        });
        g.activateEnemy(t, g.time + 2);
        this.spawned.push(t);
      });
    }
    for (const id of w.infantry) {
      const sec = SECTORS[id];
      // the infantry start from the last cover before the farm, not from the map edge
      const sx = sec.lane.x + (sec.push.x - sec.lane.x) * 0.5, sz = sec.lane.z + (sec.push.z - sec.lane.z) * 0.5;
      const h = Math.atan2(farm.x - sx, farm.z - sz);
      const sq = g.infantry.spawnSquad('enemy', 'Varkovian assault section', sx + 14, sz + 10, 6, h);
      g.infantry.order(sq, [sec.push, { x: farm.x + (sec.push.x - farm.x) * 0.45, z: farm.z + (sec.push.z - farm.z) * 0.45 }]);
    }
  }

  // ---------------------------------------------------------------- phases

  private enterPhase(g: Game, i: number) {
    this.phaseIndex = i;
    const O = this.info.objectives;
    const lbl = (id: SectorId) => SECTORS[id].label;
    switch (i) {
      case 0:
        this.markers = [
          ...this.baseMarkers(g),
          { id: 'v2', label: 'Vanguard 2', kind: 'zone', pos: () => v3(SECTORS[this.plan.v2].post, g, 3) },
          { id: 'guns', label: 'AT guns', kind: 'zone', pos: () => v3(SECTORS[this.plan.guns].guns[0], g, 3) },
        ];
        g.radio(HQ, `Understood, Vanguard. Vanguard 2 to the ${lbl(this.plan.v2)}, guns on the ${lbl(this.plan.guns)}, mines across the ${lbl(this.plan.mines)}. Get your own tanks where you want them — you have under a minute.`);
        g.after(7, () => this.hint(g, 'cover', 'Pick the approach your other assets do not cover. Use Orders → Hold to keep your platoon in place while you move.', 'Pick the approach your other assets do not cover. Q → Hold keeps your platoon in place while you move.'));
        g.after(20, () => this.hint(g, 'supply', 'The lorries in the farmyard are your ammunition. Stop beside one for five seconds to rearm and repair.'));
        break;
      case 1:
        this.markers = [...this.baseMarkers(g), ...this.attackMarkers(g, ['north'])];
        g.radio(HQ, 'Vanguard, movement on the North Road. Light tanks and infantry — they are feeling for your line. Do not show them all of it.');
        this.launchWave(g, 0);
        break;
      case 2:
        this.markers = [...this.baseMarkers(g), ...this.attackMarkers(g, ['east', 'west'])];
        g.radio(HQ, 'They have found the front door shut. Armour now moving on both flanks — East Track and West Lane together!');
        this.launchWave(g, 1);
        break;
      case 3:
        this.markers = [...this.baseMarkers(g), ...this.attackMarkers(g, ['north', 'east', 'west'])];
        g.artillery.enabled = true;
        g.radio(HQ, 'General assault, Vanguard — they are coming in on all three roads. Hammer Battery is yours.');
        g.after(5, () => g.radio(BTY, 'Vanguard, Hammer Battery. Two fire missions, that is all we have. Mark your targets.'));
        g.after(9, () => this.hint(g, 'arty', 'Tap ARTY, then tap the map. 22 seconds to impact — put it on the road ahead of them.', 'Press R, then click the map. 22 seconds to impact — put it on the road ahead of them.'));
        this.launchWave(g, 2);
        break;
      case 4:
        this.markers = [...this.baseMarkers(g), ...this.attackMarkers(g, ['north', 'east', 'west'])];
        g.radio(HQ, 'This is the big one. Heavy tanks on the North Road, Bastions leading, and they are pushing the flanks to pin you. Relief column is close. Hold them, Vanguard!');
        g.after(12, () => this.hint(g, 'bastion', 'The V-58 Bastion shrugs off frontal hits. Let it come on and take it in the side, or drop artillery on it.'));
        this.launchWave(g, 3);
        break;
      case 5: {
        this.objectiveText = 'Ardenne Farm held';
        this.markers = [];
        const relief = new AlliedPlatoon('Sabre 1', '7th Armoured relief column', APOINTS.reliefPost, g, 7701);
        relief.deploy(APOINTS.relief, 0, 4);
        relief.setSector({ x: APOINTS.crossroads.x, z: APOINTS.crossroads.z + 46 }, 'counter', 0);
        g.alliedPlatoons.push(relief);
        g.routEnemies();
        g.radio('Sabre 1', 'Vanguard, Sabre 1. We have you in sight — coming up the south road now. Save some for us!');
        g.after(4, () => g.radio(HQ, 'They are breaking off! Ardenne Farm is held, and the road is open. Magnificent, Vanguard.'));
        this.victoryAt = g.time + 8;
        break;
      }
    }
  }

  // ---------------------------------------------------------------- update

  update(dt: number, g: Game) {
    if (!this.planned) return;
    const O = this.info.objectives;

    if (this.phaseIndex === 5) {
      if (this.victoryAt > 0 && g.time >= this.victoryAt) {
        this.victoryAt = -1;
        g.beginVictory();
      }
      if (g.victoryTime > 9) g.showVictory();
      return;
    }

    if (this.phaseIndex === 0) {
      this.prep -= dt;
      this.objectiveText = `${O[0]} · contact in ${mmss(this.prep)}`;
      if (this.prep <= 0) {
        this.complete(g, O[0]);
        this.enterPhase(g, 1);
      }
      this.updateResupply(dt, g);
      return;
    }

    // ---- battle clock ----
    this.clock += dt;
    const nextAt = this.phaseIndex < 4 ? WAVES[this.phaseIndex].at : RELIEF_AT;
    // A beaten-off attack shortens the wait: the enemy regroups faster than the timetable.
    const live = this.liveEnemies(g).length;
    if (live === 0 && this.pending === 0 && this.spawned.length > 0) {
      const lull = this.phaseIndex < 4 ? 55 : 12;
      if (nextAt - this.clock > lull) {
        this.clock = nextAt - lull;
        if (this.phaseIndex < 4) {
          g.radio(HQ, 'They are pulling back to regroup. Rearm at the lorries while you can — they will be back.');
        } else g.radio('Sabre 1', 'Vanguard, Sabre 1 — nearly with you. Hold on.');
      }
    }
    this.objectiveText = `${O[this.phaseIndex]} · relief in ${mmss(RELIEF_AT - this.clock)}`;
    if (this.clock >= nextAt) {
      this.complete(g, O[this.phaseIndex]);
      this.enterPhase(g, this.phaseIndex + 1);
      return;
    }

    this.updateGuns(dt, g);
    this.updateMines(g);
    this.updateTrucks(dt, g);
    this.updateResupply(dt, g);
    this.updateOverrun(dt, g);

    // "Attack my target" also brings Vanguard 2 across; they return to their road afterwards.
    if (g.platoon.order === 'attack' && g.platoon.designated && this.once('brigade-attack')) {
      this.v2.support(g.platoon.designated.pos.clone());
      this.supportUntil = g.time + 40;
      g.after(25, () => this.flags.delete('brigade-attack'));
    }
    if (this.supportUntil > 0 && g.time > this.supportUntil) {
      this.supportUntil = 0;
      const s = SECTORS[this.plan.v2];
      this.v2.setSector(s.post, 'hold', this.facing(s));
    }
  }

  /** The anti-tank section: slow, accurate, and finished the moment a tank gets in among them. */
  private updateGuns(dt: number, g: Game) {
    for (const gun of this.guns) {
      if (gun.hp <= 0) continue;
      const o = gun.pos;
      let target: Tank | null = null;
      let best = 240;
      for (const t of this.liveEnemies(g)) {
        if (!t.active) continue;
        const d = t.pos.distanceTo(o);
        if (d < 10) {
          this.gunLost(g, gun, 'overrun');
          break;
        }
        if (d >= best) continue;
        const c = t.centre();
        if (!g.world.col.lineOfSight(o.x, o.y, o.z, c.x, c.y, c.z, 0.6)) continue;
        best = d;
        target = t;
      }
      if (gun.hp <= 0 || !target) continue;
      // tanks that can see the gun shoot back
      if (best < 170 && Math.random() < dt * 0.04) {
        const from = target;
        const mp = new THREE.Vector3(), md = new THREE.Vector3();
        from.muzzle(mp, md);
        g.effects.muzzleFlash(mp, o.clone().sub(mp).normalize(), true);
        g.audio.cannon(mp, from.def.gun.calibre ?? 75);
        g.effects.tracers.add(mp.x, mp.y, mp.z, o.x, o.y, o.z, 400, 7, [1, 0.6, 0.4]);
        g.after(best / 400, () => {
          if (gun.hp <= 0) return;
          g.effects.explosion(o, 1.2);
          g.audio.explosion(o, 1.2);
          gun.hp -= 50;
          if (gun.hp <= 0) this.gunLost(g, gun, 'hit');
          else if (this.once('gun-hit' + gun.n)) g.radio(GUNS, `Number ${gun.n} gun taking fire — still in action!`);
        });
      }
      gun.cd -= dt;
      if (gun.cd > 0) continue;
      gun.cd = 6.5 + Math.random() * 2.5;
      const tgt = target;
      const c = tgt.centre();
      g.enemySpotted.add(tgt.id);
      g.effects.muzzleFlash(o, c.clone().sub(o).normalize(), true);
      g.audio.cannon(o, 76);
      g.effects.tracers.add(o.x, o.y, o.z, c.x, c.y, c.z, 420, 7, [1, 0.85, 0.45]);
      const hit = Math.random() < (Math.abs(tgt.speed) > 3 ? 0.42 : 0.6);
      g.after(best / 420, () => {
        if (!tgt.alive) return;
        if (!hit) {
          g.effects.explosion(c.clone().add(new THREE.Vector3((Math.random() - 0.5) * 9, 0, (Math.random() - 0.5) * 9)), 0.9);
          return;
        }
        g.effects.impactSparks(c, false);
        tgt.hp -= (30 + Math.random() * 24) * (tgt.def.cls === 'heavy' ? 0.4 : 1);
        tgt.lastHitTime = g.time;
        tgt.refreshStatus();
        if (tgt.hp <= 0) {
          g.weapons.knockOut(tgt, null, { severity: 1, penetrated: true, ammoDetonation: Math.random() < 0.2, crewCompartmentHit: true, fire: Math.random() < 0.3, kind: 'destroyed' }, 'Anti-tank gun fire');
          if (this.once('gun-kill')) g.radio(GUNS, 'Target! That one is burning.');
        }
      });
    }
  }

  private gunLost(g: Game, gun: Gun, how: 'overrun' | 'hit') {
    gun.hp = 0;
    g.effects.explosion(gun.pos, 1.6, true);
    g.audio.explosion(gun.pos, 1.5);
    (gun.mesh.material as THREE.MeshLambertMaterial).color.set(0x3a3632);
    const left = this.guns.filter((x) => x.hp > 0).length;
    g.radio(GUNS, how === 'overrun' ? `They are on top of us — number ${gun.n} gun is overrun!` : `Number ${gun.n} gun is knocked out!${left ? '' : ' The section is finished.'}`);
  }

  private updateMines(g: Game) {
    const c = this.mineCentre;
    if (!c || this.minesLeft <= 0) return;
    for (const t of this.liveEnemies(g)) {
      if (this.mineChecked.has(t.id) || Math.abs(t.speed) < 0.5) continue;
      if (Math.hypot(t.pos.x - c.x, t.pos.z - c.z) > 25) continue;
      this.mineChecked.add(t.id);
      if (Math.random() > 0.85) continue; // lucky: found the gap
      this.minesLeft--;
      g.effects.explosion(t.pos.clone().setY(t.pos.y + 0.4), 1.5, true);
      g.audio.explosion(t.pos, 1.6);
      g.cameraShakeAt(t.pos, 0.5);
      g.enemySpotted.add(t.id);
      t.hp -= 34 + Math.random() * 22;
      t.tracksBroken = Math.max(t.tracksBroken, 35);
      t.lastHitTime = g.time;
      t.refreshStatus();
      if (t.hp <= 0) g.weapons.knockOut(t, null, { severity: 1, penetrated: true, ammoDetonation: false, crewCompartmentHit: false, fire: Math.random() < 0.4, kind: 'destroyed' }, 'Mine');
      if (this.once('mine-first')) g.radio(HQ, `Mine strike on the ${SECTORS[this.plan.mines].label}! ${t.alive ? 'Enemy tank has lost a track — it is a sitting target.' : 'Enemy tank destroyed.'}`);
      if (this.minesLeft === 0) {
        g.radio(HQ, `The ${SECTORS[this.plan.mines].label} minefield is spent. That road is open again.`);
        this.markers = this.markers.filter((m) => m.id !== 'mines');
      }
    }
  }

  /** Enemy tanks that get a clear look into the farmyard shoot up the lorries. */
  private updateTrucks(dt: number, g: Game) {
    for (const tr of this.trucks) {
      if (tr.hp <= 0 && tr.fireT > 0) {
        tr.fireT -= dt;
        if (Math.random() < dt * 5) g.effects.fire(tr.pos.clone().setY(tr.pos.y + 1.6), 0.8);
      }
    }
    this.tick -= dt;
    if (this.tick > 0) return;
    this.tick = 1;
    for (const tr of this.liveTrucks()) {
      const aim = tr.pos.clone().setY(tr.pos.y + 1.8);
      for (const t of this.liveEnemies(g)) {
        if (!t.active || t.pos.distanceTo(tr.pos) > 115 || Math.random() > 0.05) continue;
        const eye = t.eye();
        if (!g.world.col.lineOfSight(eye.x, eye.y, eye.z, aim.x, aim.y, aim.z, 0.6)) continue;
        const mp = new THREE.Vector3(), md = new THREE.Vector3();
        t.muzzle(mp, md);
        g.effects.muzzleFlash(mp, aim.clone().sub(mp).normalize(), true);
        g.audio.cannon(mp, 75);
        g.effects.tracers.add(mp.x, mp.y, mp.z, aim.x, aim.y, aim.z, 400, 7, [1, 0.6, 0.4]);
        g.after(mp.distanceTo(aim) / 400, () => this.truckHit(g, tr));
        break;
      }
    }
  }

  private truckHit(g: Game, tr: Truck) {
    if (tr.hp <= 0) return;
    g.effects.explosion(tr.pos.clone().setY(tr.pos.y + 1.5), 1.2);
    g.audio.explosion(tr.pos, 1.2);
    tr.hp -= 40;
    if (tr.hp > 0) {
      g.radio(QM, 'They are shelling the lorries! Keep them off the yard!');
      return;
    }
    tr.mesh.geometry.dispose();
    tr.mesh.geometry = truckGeometry(true);
    tr.fireT = 45;
    g.effects.explosion(tr.pos.clone().setY(tr.pos.y + 2), 2.2, true);
    g.cameraShakeAt(tr.pos, 0.8);
    const left = this.liveTrucks().length;
    g.radio(QM, left ? 'A lorry has gone up! One left, Vanguard — look after it.' : 'Both lorries are burning. There is no more ammunition, Vanguard. Make every round count.');
    if (!left) this.markers = this.markers.filter((m) => m.id !== 'supply');
  }

  /** Halt beside a lorry to rearm; platoon tanks close by are topped up at the same time. */
  private updateResupply(dt: number, g: Game) {
    this.rearmCd = Math.max(0, this.rearmCd - dt);
    const p = g.playerTank;
    if (!p || !p.alive) return;
    const near = this.liveTrucks().some((t) => Math.hypot(t.pos.x - p.pos.x, t.pos.z - p.pos.z) < 17);
    // nothing worth stopping for: racks full and no damage the fitters could do anything about
    const full = (t: Tank) => t.ammo.AP >= t.def.ammo.AP && t.ammo.HE >= t.def.ammo.HE && t.ammo.SMOKE >= t.def.ammo.SMOKE && t.hp >= t.def.hp * 0.6;
    if (!near || Math.abs(p.speed) > 0.8 || this.rearmCd > 0 || full(p)) {
      if (near && this.rearmCd > 0 && Math.abs(p.speed) < 0.8 && !full(p) && this.once('rearm-wait' + Math.floor(g.time / 8))) g.hud.flash(`LORRY CREWS RESTOCKING — ${Math.ceil(this.rearmCd)}s`);
      this.rearmT = 0;
      return;
    }
    const before = Math.ceil(5 - this.rearmT);
    this.rearmT += dt;
    const now = Math.ceil(5 - this.rearmT);
    if (now !== before && now > 0) g.hud.flash(`REARMING — HOLD STILL ${now}`);
    if (this.rearmT < 5) return;
    this.rearmT = 0;
    this.rearmCd = 45;
    const own = g.tanks.filter((t) => t.side === 'ally' && !t.allied && t.alive && t.pos.distanceTo(p.pos) < 70);
    for (const t of own) {
      t.ammo = { ...t.def.ammo };
      t.mgBelts = t.def.mgBelts - 1;
      t.mgAmmo = t.def.mgBeltSize;
      t.hp = Math.max(t.hp, Math.min(t.def.hp * 0.85, t.hp + t.def.hp * 0.3));
      t.tracksBroken = 0;
      t.refreshStatus();
    }
    g.hud.flash('REARMED AND PATCHED UP');
    g.radio(QM, own.length > 1 ? `That is ${own.length} tanks bombed up and patched. Off you go, Vanguard.` : 'Racks full, and we have patched what we can. Off you go.');
  }

  /** The farm falls if enemy armour sits in the yard unchallenged. */
  private updateOverrun(dt: number, g: Game) {
    const f = APOINTS.farm;
    const inside = this.liveEnemies(g).filter((t) => t.active && Math.hypot(t.pos.x - f.x, t.pos.z - f.z) < 44).length;
    if (inside > 0) {
      this.overrunT += dt * Math.min(2, inside);
      if (this.once('yard' + Math.floor(g.time / 30))) g.radio('Ardenne garrison', 'Enemy tanks in the farmyard! We cannot hold them with rifles — get back here!');
      if (this.overrunT > 26 && this.once('yard-last')) g.hud.flash('THE FARM IS BEING OVERRUN — CLEAR THE YARD');
      if (this.overrunT > 40) g.fail('Ardenne Farm has been overrun and the supply road is cut.');
    } else this.overrunT = Math.max(0, this.overrunT - dt * 0.7);
  }
}
