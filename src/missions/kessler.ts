import * as THREE from 'three';
import type { Game } from '../game/game';
import type { Marker, MissionInfo, MissionScript } from './mission';
import { KESSLER, KPOINTS } from './kesslerMap';
import type { Tank } from '../vehicles/tank';
import type { Soldier, Squad } from '../infantry/infantry';
import { AlliedPlatoon } from '../ai/alliedPlatoon';
import { strongpointGeometry } from '../rendering/models';

export const KESSLER_INFO: MissionInfo = {
  id: 'kessler',
  name: 'The Kessler Ridge Gauntlet',
  campaign: 'Operation Dawn Spear',
  location: 'Kessler Ridge, east of Bellwick',
  time: '0510 hours',
  weather: 'Clear, haze rising off the wheat',
  difficulty: 'Moderate',
  duration: '20–30 minutes',
  briefing: [
    'Vanguard, Regiment. Bellwick opened the road east, and the Directorate wants it back.',
    'Reconnaissance has the Varkovian 4th Armoured Brigade forming up beyond the wheat plain north of Kessler Ridge. They will come at us in strength, and they will come soon.',
    'The ridge is the only ground worth holding between here and Bellwick. You will hold it.',
    'You will not be alone. Vanguard 2 and Vanguard 3 are under your command for this action — use them. Put them where you need them and they will fight.',
    'Hammer Battery is laying on behind the gun line. Tap ARTY, mark a target on your map, and they will drop a concentration on it. Twenty-two seconds from your call to the first round, and only three missions for the whole battle. Aim where the enemy will be, not where they are — and do not drop it on your own men.',
    'Fight from the crest. Keep your hull behind the ridge and only your turret in the open — that is what will keep you alive when the heavy tanks arrive.',
    'The anti-tank battery is on its way forward. Hold until the guns are in action.',
    'Remember, Vanguard — tanks can be replaced. Experienced crews cannot.',
    'Good hunting.',
  ],
  objectives: [
    'Occupy the fighting positions on Kessler Ridge',
    'Break up the Varkovian reconnaissance probe',
    'Hold the ridge against the main armoured assault',
    'Withdraw the brigade to the reverse slope',
    'Hold the gun line until the anti-tank battery is in action',
  ],
  map: KESSLER,
  fog: { color: 0xcdd9e2, near: 120, far: 620 },
  order: 2,
  victoryTitle: 'KESSLER RIDGE HELD',
  enemySkill: 1.15,
  forces: {
    friendly: '3 × tank platoon (Vanguard 1, 2 and 3), Hammer Battery in support, anti-tank battery moving up',
    enemy: 'Varkovian 4th Armoured Brigade — Boar and Ox tanks in strength, V-58 Bastion heavy tanks, infantry',
  },
  mapLabels: [
    { text: 'KESSLER RIDGE', x: 0, z: 26 },
    { text: 'Kessler Farm', x: KPOINTS.farm.x, z: KPOINTS.farm.z - 14 },
    { text: 'The Wheat Plain', x: 0, z: 180 },
    { text: 'Gun Line', x: 0, z: -150 },
  ],
};

const v3 = (p: { x: number; z: number }, g: Game, dy = 2) => new THREE.Vector3(p.x, g.world.h(p.x, p.z) + dy, p.z);
const HQ = 'Regiment HQ';
const BTY = 'Hammer Battery';

interface Wave {
  at: number;
  defId: string;
  lane: { x: number; z: number };
  push: { x: number; z: number };
  spread: number;
  aggression: number;
}

export class KesslerMission implements MissionScript {
  info = KESSLER_INFO;
  playerStart = { ...KPOINTS.playerStart };
  victoryFocus = KPOINTS.gunLine;
  objectiveText = '';
  markers: Marker[] = [];
  phaseIndex = 0;
  private t = 0;
  private phaseT = 0;
  private flags = new Set<string>();
  private v2!: AlliedPlatoon;
  private v3!: AlliedPlatoon;
  private waves: Wave[] = [];
  private spawned: Tank[] = [];
  private bastions: Tank[] = [];
  private gunners: Squad | null = null;
  private atGunsT = 0;
  private holdTimer = 0;
  private lastPressure = 0;

  // ---------------------------------------------------------------- setup

  buildScenery(g: Game) {
    // The anti-tank gun positions that arrive in the final phase, plus a dug-in observation post.
    for (const p of [KPOINTS.gunLineWest, KPOINTS.gunLine, KPOINTS.gunLineEast]) {
      const m = new THREE.Mesh(strongpointGeometry(), new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }));
      m.position.set(p.x, g.world.h(p.x, p.z), p.z);
      m.rotation.y = Math.PI / 2; // barrel north, up the reverse slope
      m.visible = false;
      m.name = 'atgun';
      g.scene.add(m);
    }
  }

  private atGuns(g: Game) {
    return g.scene.children.filter((o) => o.name === 'atgun');
  }

  start(g: Game) {
    const P = KPOINTS;
    // Two more Alderland platoons under the player's command.
    this.v2 = new AlliedPlatoon('Vanguard 2', 'Vanguard 2 Platoon', P.postWest, g, 2201);
    this.v3 = new AlliedPlatoon('Vanguard 3', 'Vanguard 3 Platoon', P.postEast, g, 3301);
    this.v2.deploy(P.formWest, 0);
    this.v3.deploy(P.formEast, 0);
    g.alliedPlatoons.push(this.v2, this.v3);

    // Gun crews waiting on the reverse slope; they man the guns in the last phase.
    this.gunners = g.infantry.spawnSquad('ally', 'Anti-tank battery crews', P.gunLine.x, P.gunLine.z - 16, 8, 0, { defend: true, at: 0 });
    this.gunners.holdFire = true;

    // Artillery is available from the start of the main assault, not before.
    g.artillery.available = 3;
    g.artillery.enabled = false;

    this.buildWaves();
    this.enterPhase(g, 0);
  }

  /**
   * Three waves across the plain. Lanes are staggered so the player always has a flank to
   * worry about, and heavies arrive only once the medium tanks have been fought.
   */
  private buildWaves() {
    const P = KPOINTS;
    const lanes = [
      { lane: P.laneWest, push: P.pushWest },
      { lane: P.laneCentre, push: P.pushCentre },
      { lane: P.laneEast, push: P.pushEast },
    ];
    const w: Wave[] = [];
    // Wave 1 — reconnaissance: five Boars probing, fast and poorly armoured.
    for (let i = 0; i < 5; i++) {
      const l = lanes[i % 3];
      w.push({ at: 4 + i * 5, defId: 'V-32', lane: l.lane, push: l.push, spread: (i - 2) * 40, aggression: 0.85 });
    }
    // Wave 2 — the main assault: massed Ox mediums with a few Boars on the flanks.
    for (let i = 0; i < 8; i++) {
      const l = lanes[i % 3];
      w.push({ at: 6 + i * 7, defId: i % 4 === 3 ? 'V-32' : 'V-41', lane: l.lane, push: l.push, spread: (i % 4 - 1.5) * 46, aggression: 0.55 });
    }
    // Wave 3 — the Bastions, with mediums screening them.
    for (let i = 0; i < 5; i++) {
      const l = lanes[i % 3];
      w.push({ at: 5 + i * 11, defId: i < 3 ? 'V-58' : 'V-41', lane: l.lane, push: l.push, spread: (i - 2) * 48, aggression: 0.4 });
    }
    this.waves = w;
  }

  private spawnWave(g: Game, waveIndex: number) {
    const ranges: [number, number][] = [[0, 5], [5, 13], [13, 18]];
    const [from, to] = ranges[waveIndex];
    for (let i = from; i < to; i++) {
      const w = this.waves[i];
      g.after(w.at, () => {
        if (g.finishedMission) return;
        const x = w.lane.x + w.spread;
        const t = g.spawnEnemy(w.defId, x, w.lane.z + (Math.random() - 0.5) * 20, Math.PI, {
          aggression: w.aggression,
          retreatTo: KPOINTS.enemyRetreat,
          advanceTo: { x: w.push.x + w.spread * 0.8, z: w.push.z },
          // lights rush in close, mediums fight at medium range, heavies stand off and snipe
          preferredRange: w.defId === 'V-32' ? 45 : w.defId === 'V-41' ? 75 : 135,
        });
        g.activateEnemy(t, g.time + 2);
        this.spawned.push(t);
        if (w.defId === 'V-58') this.bastions.push(t);
      });
    }
  }

  // ---------------------------------------------------------------- helpers

  private once(id: string): boolean {
    if (this.flags.has(id)) return false;
    this.flags.add(id);
    return true;
  }

  private hint(g: Game, id: string, touch: string, desktop: string) {
    if (this.once('hint-' + id)) g.hud.hint(g.touch ? touch : desktop);
  }

  private complete(g: Game, name: string) {
    g.tracker.objectiveComplete(name, g.playerTank?.commanderId ?? null);
    g.hud.objectiveComplete(name);
  }

  private marker(id: string, label: string, kind: Marker['kind'], pos: () => THREE.Vector3 | null, radius?: number): Marker {
    return { id, label, kind, pos, radius };
  }

  /** Enemy tanks still fighting on the near side of the plain. */
  private liveEnemies(g: Game) {
    return g.tanks.filter((t) => t.side === 'enemy' && t.alive && !t.gone);
  }

  private enemiesPast(z: number, g: Game) {
    return this.liveEnemies(g).filter((t) => t.pos.z < z).length;
  }

  pinsInfantry(_s: Soldier) {
    return false;
  }

  // ---------------------------------------------------------------- phases

  private enterPhase(g: Game, i: number) {
    this.phaseIndex = i;
    this.phaseT = 0;
    const P = KPOINTS;
    const O = this.info.objectives;
    switch (i) {
      case 0:
        this.objectiveText = O[0];
        this.markers = [
          this.marker('post', 'Your position', 'objective', () => v3(P.postCentre, g, 3), 18),
          this.marker('v2', 'Vanguard 2', 'zone', () => v3(P.postWest, g, 3)),
          this.marker('v3', 'Vanguard 3', 'zone', () => v3(P.postEast, g, 3)),
        ];
        this.v2.setSector(P.postWest);
        this.v3.setSector(P.postEast);
        g.after(2, () => g.radio(HQ, 'Vanguard, Regiment. Get your three platoons onto the crest. Centre position is yours — Vanguard 2 on the western spur, Vanguard 3 to the east.'));
        g.after(10, () => this.hint(g, 'hulldown', 'Stop just behind the crest so only your turret shows. Shells will hit the ridge instead of your hull.', 'Stop just behind the crest so only your turret shows. Shells will hit the ridge instead of your hull.'));
        break;
      case 1:
        this.objectiveText = O[1];
        this.markers = [this.marker('plain', 'Enemy approach', 'enemy', () => v3(P.pushCentre, g, 6), 40)];
        g.radio(HQ, 'Movement on the plain — light tanks, reconnaissance by fire. Let them come to you and break them up.');
        this.spawnWave(g, 0);
        g.after(14, () => this.hint(g, 'range', 'Long shots: the gunner\'s sight gives you range. Let them close before firing.', 'Long shots: the gunner\'s sight (right mouse / E) gives you range. Let them close before firing.'));
        break;
      case 2:
        this.objectiveText = O[2];
        this.markers = [this.marker('plain2', 'Main assault', 'enemy', () => v3(P.pushCentre, g, 6), 60)];
        g.artillery.enabled = true;
        g.radio(HQ, 'That was the probe. The main body is moving — massed armour across the whole frontage. Hammer Battery is now at your disposal.');
        g.after(6, () => g.radio(BTY, 'Vanguard, Hammer Battery ready. Three fire missions. Mark a target on your map and we will put a concentration on it.'));
        g.after(10, () => this.hint(g, 'arty', 'Tap ARTY, then tap the map where you want the shells. 22 seconds from call to impact — aim ahead of them.', 'Press R (or tap ARTY), then click the map. 22 seconds from call to impact — aim ahead of them.'));
        this.spawnWave(g, 1);
        break;
      case 3: {
        this.objectiveText = O[3];
        this.markers = [
          this.marker('fall', 'Reverse slope line', 'objective', () => v3(P.fallCentre, g, 3), 22),
        ];
        g.radio(HQ, 'Vanguard, break contact and pull the brigade back to the reverse slope. Let them come over the crest and shoot them in the belly as they do.');
        this.v2.setSector(P.fallWest, 'fallback');
        this.v3.setSector(P.fallEast, 'fallback');
        g.after(5, () => this.hint(g, 'reverse', 'Fall back behind the crest. Enemy tanks cresting the ridge show their thin belly armour — hit them as they tip over.', 'Fall back behind the crest. Enemy tanks cresting the ridge show their thin belly armour — hit them as they tip over.'));
        this.spawnWave(g, 2);
        break;
      }
      case 4:
        this.objectiveText = O[4];
        this.markers = [this.marker('guns', 'Gun line', 'objective', () => v3(P.gunLine, g, 3), 26)];
        this.v2.setSector(P.gunLineWest, 'hold');
        this.v3.setSector(P.gunLineEast, 'hold');
        this.atGunsT = 115;
        g.radio(HQ, 'Last bound, Vanguard — back to the gun line. The anti-tank battery is unlimbering now. Hold them off for two minutes and the guns will do the rest.');
        if (this.gunners) {
          this.gunners.holdFire = false;
          this.gunners.defend = true;
        }
        break;
      case 5:
        this.objectiveText = 'Kessler Ridge held';
        this.markers = [];
        for (const o of this.atGuns(g)) o.visible = true;
        g.beginVictory();
        g.radio(HQ, 'Guns are in action! Batteries firing over open sights — Vanguard, the ridge is yours. Outstanding work.');
        g.after(3.5, () => g.radio('Vanguard 2', 'They are turning back! The whole line is turning back!'));
        break;
    }
  }

  // ---------------------------------------------------------------- update

  update(dt: number, g: Game) {
    this.t += dt;
    this.phaseT += dt;
    const P = KPOINTS;
    const pl = g.playerTank;

    // the anti-tank battery firing over open sights once it is in action
    if (this.phaseIndex === 4 && this.atGunsT > 0) {
      this.atGunsT -= dt;
      if (this.atGunsT <= 0) {
        this.complete(g, this.info.objectives[4]);
        this.enterPhase(g, 5);
        return;
      }
      if (this.atGunsT < 95) this.gunLineFire(dt, g);
    }

    // End-of-mission camera: let it play, then show the victory panel. Without this the
    // cinematic runs forever and the player is stuck watching it.
    if (this.phaseIndex === 5) {
      this.gunLineFire(dt, g);
      if (g.victoryTime > 9) g.showVictory();
      return;
    }

    switch (this.phaseIndex) {
      case 0: {
        if (!pl) break;
        const onPost = Math.hypot(pl.pos.x - P.postCentre.x, pl.pos.z - P.postCentre.z) < 30;
        const v2Up = this.v2.alive.some((m) => Math.hypot(m.tank.pos.x - P.postWest.x, m.tank.pos.z - P.postWest.z) < 34);
        const v3Up = this.v3.alive.some((m) => Math.hypot(m.tank.pos.x - P.postEast.x, m.tank.pos.z - P.postEast.z) < 34);
        if (this.phaseT > 20 && this.once('brigade-up')) g.radio('Vanguard 2', 'Vanguard 2 in position on the western spur, over.');
        if (onPost && (v2Up || this.phaseT > 60) && (v3Up || this.phaseT > 60)) {
          this.complete(g, this.info.objectives[0]);
          this.enterPhase(g, 1);
        }
        break;
      }
      case 1: {
        // The probe is "broken up" when nothing of it is still pressing the ridge.
        const pressing = this.liveEnemies(g).filter((t) => t.pos.z < 190).length;
        if (this.spawned.length >= 5 && this.phaseT > 25 && (pressing === 0 || this.phaseT > 150)) {
          this.complete(g, this.info.objectives[1]);
          this.enterPhase(g, 2);
        }
        break;
      }
      case 2: {
        const pressing = this.liveEnemies(g).filter((t) => t.pos.z < 190).length;
        const spawnedAll = this.spawned.length >= 13;
        // once the second wave is spent, or has pushed too close, the brigade gives ground
        const overrun = this.enemiesPast(20, g) >= 3;
        if (spawnedAll && (pressing <= 1 || overrun || this.phaseT > 260)) {
          this.complete(g, this.info.objectives[2]);
          this.enterPhase(g, 3);
        }
        if (this.bastionWarning(g)) break;
        break;
      }
      case 3: {
        const backed = pl && pl.pos.z < P.fallCentre.z + 16;
        if (this.once('bastion-call') && this.phaseT > 12) {
          g.radio('Vanguard 3', 'Heavy tanks on the plain! Big ones — our shot is bouncing clean off the front!');
          this.hint(g, 'bastion', 'The V-58 Bastion is immune from the front. Flank it, or drop artillery on it.', 'The V-58 Bastion is immune from the front. Flank it, or drop artillery on it.');
        }
        const spawnedAll = this.spawned.length >= 18;
        if (backed && spawnedAll && this.phaseT > 60) {
          this.complete(g, this.info.objectives[3]);
          this.enterPhase(g, 4);
        } else if (this.phaseT > 220) {
          this.complete(g, this.info.objectives[3]);
          this.enterPhase(g, 4);
        }
        break;
      }
      case 4:
        if (this.phaseT > 6 && this.once('hold-on')) g.radio(HQ, `Hold on, Vanguard. Guns ready in ${Math.ceil(this.atGunsT)} seconds.`);
        break;
    }

    // Allied platoons answer the player's platoon order when it is "attack my target":
    // a brigade commander's job is to point them at what matters.
    if (g.platoon.order === 'attack' && g.platoon.designated && this.once('brigade-attack')) {
      for (const ap of [this.v2, this.v3]) ap.support(g.platoon.designated.pos.clone());
      g.after(25, () => this.flags.delete('brigade-attack'));
    }

    // ambient pressure: keep radio chatter alive as the battle swings
    const pressure = this.enemiesPast(60, g);
    if (pressure > this.lastPressure + 2 && this.once('press' + Math.floor(this.t / 25))) {
      g.radio('Vanguard 2', 'They are coming on fast — we are heavily engaged over here!');
    }
    this.lastPressure = pressure;
  }

  /** Warn once when the first Bastion comes into view. */
  private bastionWarning(g: Game): boolean {
    const b = this.bastions.find((t) => t.alive && t.active && g.enemySpotted.has(t.id));
    if (b && this.once('bastion-seen')) {
      g.radio(HQ, 'Heavy armour identified — V-58 Bastion. Frontal armour will stop your seventy-five. Flank them or call the guns down on them.');
      return true;
    }
    return false;
  }

  /** The anti-tank battery shooting over open sights in the final phase. */
  private gunLineFire(dt: number, g: Game) {
    if (Math.random() > dt * 0.55) return;
    const target = this.liveEnemies(g)
      .filter((t) => t.pos.z < 10)
      .sort((a, b) => a.pos.z - b.pos.z)[0];
    if (!target) return;
    const pits = [KPOINTS.gunLineWest, KPOINTS.gunLine, KPOINTS.gunLineEast];
    const pit = pits[Math.floor(Math.random() * pits.length)];
    const o = v3(pit, g, 1.2);
    const c = target.centre();
    if (!g.world.col.lineOfSight(o.x, o.y, o.z, c.x, c.y, c.z, 0.6)) return;
    g.effects.muzzleFlash(o, c.clone().sub(o).normalize(), true);
    g.audio.cannon(o, 76);
    g.effects.tracers.add(o.x, o.y, o.z, c.x, c.y, c.z, 420, 7, [1, 0.85, 0.45]);
    const hit = Math.random() < 0.45;
    g.after(c.distanceTo(o) / 420, () => {
      if (!target.alive) return;
      if (!hit) {
        const miss = c.clone().add(new THREE.Vector3((Math.random() - 0.5) * 9, 0, (Math.random() - 0.5) * 9));
        g.effects.explosion(miss, 0.9);
        return;
      }
      g.effects.impactSparks(c, false);
      target.hp -= 30 + Math.random() * 25;
      target.refreshStatus();
      if (target.hp <= 0)
        g.weapons.knockOut(target, null, { severity: 1, penetrated: true, ammoDetonation: Math.random() < 0.2, crewCompartmentHit: true, fire: Math.random() < 0.3, kind: 'destroyed' }, 'Anti-tank gun fire');
    });
  }
}
