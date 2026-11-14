import * as THREE from 'three';
import type { Game } from '../game/game';
import type { Marker, MissionInfo, MissionScript } from './mission';
import { BELLWICK, POINTS } from './bellwickMap';
import type { Tank } from '../vehicles/tank';
import type { MGNest, Squad, Soldier } from '../infantry/infantry';
import { strongpointGeometry } from '../rendering/models';

export const BELLWICK_INFO: MissionInfo = {
  id: 'bellwick',
  name: 'The Battle of Bellwick',
  campaign: 'Operation Dawn Spear',
  location: 'Bellwick, eastern Alderland',
  time: '0630 hours',
  weather: 'Light morning mist',
  difficulty: 'Easy',
  duration: '15–20 minutes',
  briefing: [
    'Vanguard, this is Regiment Headquarters.',
    'Elements of the 9th Airborne Battalion landed outside Bellwick before dawn.',
    'Our paratroopers have secured the western orchards but are pinned down by enemy armour covering the southern approaches.',
    'Your orders are to advance into Bellwick, eliminate enemy armoured resistance and support the airborne company in securing the town square.',
    'Intelligence reports light and medium enemy tanks in the area.',
    'Your Sentinels have the advantage in firepower. Use it wisely.',
    'Remember, Vanguard — tanks can be replaced. Experienced crews cannot.',
    'Good hunting.',
  ],
  objectives: [
    'Reach the southern crossroads',
    'Destroy the enemy tank at the farmhouse',
    'Rendezvous with the airborne company',
    'Neutralise the enemy defences in the orchard',
    'Cover the airborne advance with smoke',
    'Clear the town square: enemy armour and the machine-gun post',
    'Secure Bellwick town square',
  ],
  map: BELLWICK,
  fog: { color: 0xcfd8dc, near: 90, far: 520 },
  order: 1,
  victoryTitle: 'BELLWICK LIBERATED',
  // the introductory mission stays gentler than the rest of the campaign
  enemySkill: 0.85,
  forces: {
    friendly: '4 × A-44 Sentinel, Able Company 9th Airborne',
    enemy: 'V-32 Boar light tanks, V-41 Ox medium tanks, infantry, machine-gun positions',
  },
  mapLabels: [
    { text: 'BELLWICK', x: 0, z: 205 },
    { text: 'Hollow Wood', x: POINTS.strongpoint.x, z: 100 },
    { text: 'Orchards', x: POINTS.orchardTroops.x, z: 22 },
  ],
};

const v3 = (p: { x: number; z: number }, g: Game, dy = 2) => new THREE.Vector3(p.x, g.world.h(p.x, p.z) + dy, p.z);
const HALE = 'Able Six (Capt. Hale)';
const HQ = 'Regiment HQ';

export class BellwickMission implements MissionScript {
  info = BELLWICK_INFO;
  playerStart = POINTS.playerStart;
  victoryFocus = POINTS.squareCentre;
  objectiveText = '';
  markers: Marker[] = [];
  phaseIndex = 0;
  private t = 0;
  private phaseT = 0;
  private flags = new Set<string>();
  private boar1!: Tank;
  private boar2!: Tank;
  private ox1!: Tank;
  private ox2!: Tank;
  private boar3: Tank | null = null;
  private nest!: MGNest;
  private townNest!: MGNest;
  private orchardEnemy!: Squad;
  private squareEnemy!: Squad;
  private able1!: Squad;
  private able2!: Squad;
  private pathfinders!: Squad;
  private smokeCover = 0;
  private smokeOwner: string | null = null;
  private noSmokeT = 0;
  private strongFire = 0;
  private crossing = false;
  private victoryT = -1;
  private startDist = 0;

  buildScenery(g: Game) {
    // Hollow Wood strongpoint — the anti-tank gun that covers the open crossing.
    const sp = new THREE.Mesh(strongpointGeometry(), new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }));
    sp.position.set(POINTS.strongpoint.x, g.world.h(POINTS.strongpoint.x, POINTS.strongpoint.z), POINTS.strongpoint.z);
    sp.rotation.y = Math.PI / 2 + 0.2;
    g.scene.add(sp);
  }

  start(g: Game) {
    const P = POINTS;
    // Enemy forces are placed now but stay dormant until their phase (no unfair long-range sniping).
    this.boar1 = g.spawnEnemy('V-32', P.farmBoar.x, P.farmBoar.z, P.farmBoar.heading, { aggression: 0.3, retreatTo: { x: -160, z: -40 } });
    this.boar2 = g.spawnEnemy('V-32', P.boar2.x, P.boar2.z, P.boar2.heading, { aggression: 0.6, retreatTo: { x: 40, z: 120 }, patrol: [P.boarPatrolA, P.boarPatrolB], preferredRange: 80 });
    this.ox1 = g.spawnEnemy('V-41', P.ox1.x, P.ox1.z, P.ox1.heading, { aggression: 0.2, retreatTo: P.enemyRetreat, patrol: [P.oxPatrolA, P.oxPatrolB], preferredRange: 90 });
    this.ox2 = g.spawnEnemy('V-41', P.ox2.x, P.ox2.z, P.ox2.heading, { aggression: 0.2, retreatTo: P.enemyRetreat });
    this.nest = g.infantry.addNest('Orchard MG nest', P.mgNest.x, P.mgNest.z, Math.PI, { arc: 1.5, range: 150 });
    // Fixed MG in the town, firing down the high street at the airborne's approach.
    this.townNest = g.infantry.addNest('Town square MG post', P.townMg.x, P.townMg.z, (P.townMg as { heading: number }).heading, { arc: 1.3, range: 170 });
    this.orchardEnemy = g.infantry.spawnSquad('enemy', 'Varkovian rifle section', 96, 38, 6, Math.PI, { defend: true });
    this.orchardEnemy.holdFire = true;
    this.squareEnemy = g.infantry.spawnSquad('enemy', 'Square defenders', 6, 158, 6, Math.PI, { defend: true, at: 2 });
    this.squareEnemy.holdFire = true;
    // friendly airborne
    this.pathfinders = g.infantry.spawnSquad('ally', 'Pathfinders', P.pathfinders.x, P.pathfinders.z, 4, 0);
    this.able1 = g.infantry.spawnSquad('ally', 'Able Company, 1 Platoon', P.orchardTroops.x, P.orchardTroops.z, 8, 0.3);
    this.able2 = g.infantry.spawnSquad('ally', 'Able Company, 2 Platoon', P.orchardTroops.x + 14, P.orchardTroops.z - 14, 8, 0.3);
    g.infantry.order(this.able1, [{ x: 124, z: -14 }]);
    g.infantry.order(this.able2, [{ x: 140, z: -26 }]);
    this.enterPhase(g, 0);
  }

  private marker(id: string, label: string, kind: Marker['kind'], pos: () => THREE.Vector3 | null, radius?: number): Marker {
    return { id, label, kind, pos, radius };
  }

  private tankMarker(t: Tank, label: string): Marker {
    return this.marker(`t${t.id}`, label, 'enemy', () => (t.alive && !t.gone ? t.centre().add(new THREE.Vector3(0, 3, 0)) : null));
  }

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
    g.audio.radio();
  }

  private enterPhase(g: Game, i: number) {
    this.phaseIndex = i;
    this.phaseT = 0;
    const P = POINTS;
    const O = this.info.objectives;
    switch (i) {
      case 0:
        this.objectiveText = O[0];
        this.markers = [this.marker('xroads', 'Crossroads', 'objective', () => v3(P.crossroads, g, 3))];
        g.after(1.5, () => g.radio(HQ, 'Vanguard, Regiment. Advance north up the Bellwick road to the southern crossroads. Pathfinders from the 9th will meet you there.'));
        break;
      case 1:
        this.objectiveText = O[1];
        this.markers = [this.tankMarker(this.boar1, 'V-32 Boar')];
        g.radio('Pathfinders', 'Vanguard! Enemy light tank by the farmhouse, east of the crossroads. It\'s been shooting up the road all morning.');
        g.activateEnemy(this.boar1, g.time + 7);
        g.aiHoldFireUntil = g.time + 30;
        g.after(4, () => g.radio('Vanguard 1-2', 'One-One, we have him. He\'s yours — we\'ll hold fire unless he gets lucky.'));
        g.after(3, () => this.hint(g, 'aim', 'Tap AIM for the gunner\'s sight. Drag the right side of the screen to lay the gun.', 'Right-click (or E) for the gunner\'s sight. Move the mouse to lay the gun.'));
        g.after(9, () => this.hint(g, 'ap', 'AP is loaded. Put the reticle on the Boar and tap FIRE. Side armour is thinner than the front.', 'AP (1) is loaded. Put the reticle on the Boar and left-click to fire. Side armour is thinner than the front.'));
        break;
      case 2:
        this.objectiveText = O[2];
        this.markers = [this.marker('rv', 'Airborne company', 'objective', () => v3(P.rendezvous, g, 3))];
        g.infantry.order(this.pathfinders, [{ x: 40, z: -120 }, { x: 96, z: -52 }]);
        g.after(2, () => g.radio(HALE, 'Vanguard, this is Able Six. Good shooting. We\'re in the orchards west of the road — come to us, we have work for you.'));
        break;
      case 3:
        this.objectiveText = O[3];
        this.markers = [this.marker('nest', 'MG nest', 'enemy', () => (this.nest.alive ? this.nest.pos.clone().add(new THREE.Vector3(0, 4, 0)) : null)), this.tankMarker(this.boar2, 'V-32 Boar')];
        this.nest.active = true;
        this.orchardEnemy.holdFire = false;
        g.activateEnemy(this.boar2, g.time + 5);
        g.infantry.order(this.able1, [{ x: 118, z: -2 }, { x: 110, z: 14 }]);
        g.infantry.order(this.able2, [{ x: 128, z: -6 }, { x: 122, z: 10 }]);
        g.infantry.order(this.pathfinders, [{ x: 104, z: -20 }]);
        g.radio(HALE, 'A machine-gun nest at the top of the orchard lane has us pinned, and there\'s a light tank behind it. Knock them out and we\'ll push up the lane.');
        g.after(4, () => this.hint(g, 'he', 'Tap AMMO → HE. High explosive wrecks gun nests and infantry. Hold MG to suppress riflemen.', 'Press 2 for HE — high explosive wrecks gun nests and infantry. Hold SPACE for the machine gun.'));
        break;
      case 4:
        this.objectiveText = O[4];
        this.markers = [this.marker('smoke', 'Smoke here', 'zone', () => v3(P.smokeZone, g, 2), P.smokeZone.r)];
        g.infantry.order(this.able1, [{ x: 112, z: 30 }, { x: P.crossingStart.x, z: P.crossingStart.z }]);
        g.infantry.order(this.able2, [{ x: 120, z: 24 }, { x: P.crossingStart.x + 8, z: P.crossingStart.z - 6 }]);
        g.infantry.order(this.pathfinders, [{ x: 114, z: 26 }, { x: P.crossingStart.x - 4, z: P.crossingStart.z - 8 }]);
        g.radio(HALE, 'Lane\'s clear — thank you. The next stretch runs across open ground covered by an anti-tank gun in Hollow Wood, to the east. We can\'t cross that in daylight. Give us smoke!');
        g.after(5, () => this.hint(g, 'smoke', 'Tap AMMO → SMOKE and fire into the marked area, between the paratroopers and Hollow Wood.', 'Press 3 for SMOKE and fire into the marked area, between the paratroopers and Hollow Wood.'));
        break;
      case 5:
        this.objectiveText = O[5];
        this.markers = [
          this.tankMarker(this.ox1, 'V-41 Ox'),
          this.tankMarker(this.ox2, 'V-41 Ox'),
          this.marker('townmg', 'MG post', 'enemy', () => (this.townNest.alive ? this.townNest.pos.clone().add(new THREE.Vector3(0, 4, 0)) : null)),
        ];
        this.townNest.active = true;
        g.activateEnemy(this.ox1, g.time + 4);
        g.activateEnemy(this.ox2, g.time + 4);
        this.squareEnemy.holdFire = false;
        for (const sq of [this.able1, this.able2]) g.infantry.recoverWounded(sq, 0.4);
        g.infantry.order(this.able1, [{ x: 70, z: 108 }, P.westStreetStaging]);
        g.infantry.order(this.able2, [{ x: 76, z: 102 }, { x: 52, z: 122 }]);
        g.infantry.order(this.pathfinders, [{ x: 66, z: 112 }, { x: 48, z: 132 }]);
        g.radio(HQ, 'Vanguard, Regiment. Two Varkovian Ox medium tanks are holding Bellwick square. Thicker armour and bigger guns than the Boars — use cover and go for their flanks.');
        g.after(6, () => g.radio(HALE, 'We\'re moving to the west end of the high street. There\'s a machine-gun post in the square cutting the street in half — we can\'t get in until that and the armour are dealt with.'));
        g.after(10, () => this.hint(g, 'attack', 'Aim at an Ox, then ORDERS → ATTACK MY TARGET to focus the whole platoon on it.', 'Aim at an Ox, then Q → ATTACK MY TARGET to focus the whole platoon on it.'));
        break;
      case 6:
        this.objectiveText = O[6];
        for (const sq of [this.able1, this.able2]) g.infantry.recoverWounded(sq, 0.5);
        this.markers = [this.marker('square', 'Town square', 'objective', () => v3(P.squareCentre, g, 3), 20)];
        g.radio(HALE, 'Enemy armour is finished! Able Company, into the square — go, go!');
        for (const [sq, path] of [
          [this.able1, [{ x: 30, z: 136 }, { x: 6, z: 144 }]],
          [this.able2, [{ x: 32, z: 128 }, { x: -8, z: 132 }]],
          [this.pathfinders, [{ x: 30, z: 140 }, { x: 2, z: 128 }]],
        ] as [Squad, { x: number; z: number }[]][])
          g.infantry.order(sq, path, true);
        if (this.squareEnemy.alive().length) {
          this.squareEnemy.fleeing = true;
          g.infantry.order(this.squareEnemy, [{ x: 0, z: 200 }, { x: 0, z: 300 }], true);
        }
        break;
      case 7:
        this.objectiveText = 'Bellwick liberated';
        this.markers = [];
        this.victoryT = 0;
        g.beginVictory();
        g.radio(HALE, 'Square secure. Raise the colours, lads. Vanguard — Bellwick is ours. Thank you.');
        for (const sq of [this.able1, this.able2, this.pathfinders]) g.infantry.order(sq, [{ x: (Math.random() - 0.5) * 16, z: 140 + (Math.random() - 0.5) * 16 }]);
        break;
    }
  }

  pinsInfantry(s: Soldier): boolean {
    // During the smoke phase the airborne will not cross until the strongpoint's view is blocked.
    void s;
    return false;
  }

  private strongpointFire(dt: number, g: Game) {
    const sp = POINTS.strongpoint;
    const o = v3(sp, g, 1.5);
    this.strongFire -= dt;
    if (this.strongFire > 0) return;
    this.strongFire = 0.5 + Math.random() * 1.2;
    const tgt = v3({ x: POINTS.crossingStart.x - 20 - Math.random() * 20, z: POINTS.crossingStart.z + 15 + Math.random() * 25 }, g, 0.6);
    if (!g.world.col.lineOfSight(o.x, o.y, o.z, tgt.x, tgt.y, tgt.z, 0.5)) return;
    if (Math.random() < 0.25) {
      // anti-tank gun round slamming into the open ground
      g.effects.tracers.add(o.x, o.y, o.z, tgt.x, tgt.y, tgt.z, 380, 6, [1, 0.8, 0.4]);
      g.after(tgt.distanceTo(o) / 380, () => {
        g.effects.explosion(tgt, 0.8);
        g.audio.explosion(tgt, 0.6);
      });
      g.audio.cannon(o, 50);
    } else {
      for (let i = 0; i < 6; i++)
        g.after(i * 0.08, () => {
          const e = tgt.clone().add(new THREE.Vector3((Math.random() - 0.5) * 10, 0, (Math.random() - 0.5) * 10));
          g.effects.tracers.add(o.x, o.y, o.z, e.x, e.y, e.z, 280, 4, [1, 0.45, 0.2]);
          g.audio.mg(o, 0.5);
        });
    }
  }

  /**
   * Is the crossing screened? Generous on purpose: one round anywhere in (or near) the marked
   * zone counts, and so does any smoke that actually blocks the strongpoint's view of the
   * paratroopers' route. The player should never have to empty the smoke locker.
   */
  private crossingScreened(g: Game): { ok: boolean; owner: string | null } {
    const z = POINTS.smokeZone;
    let best: { d: number; owner: string | null } | null = null;
    for (const c of g.world.col.smoke) {
      if (c.life < 3) continue;
      const d = Math.hypot(c.x - z.x, c.z - z.z) - c.r;
      if (d < z.r + 6 && (!best || d < best.d)) best = { d, owner: c.ownerId };
    }
    if (best) return { ok: true, owner: best.owner };
    // otherwise: does any smoke genuinely cut the line from the gun to the crossing?
    const o = v3(POINTS.strongpoint, g, 1.8);
    const a = POINTS.crossingStart, b = POINTS.crossingEnd;
    for (const t of [0.2, 0.5, 0.8]) {
      const p = v3({ x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t }, g, 1.2);
      const occ = g.world.col.smokeOcclusion(o.x, o.y, o.z, p.x, p.y, p.z);
      if (occ.amount >= 0.35) return { ok: true, owner: occ.cloud?.ownerId ?? null };
    }
    return { ok: false, owner: null };
  }

  private enemyArmourGone(list: (Tank | null)[]) {
    return list.every((t) => !t || !t.alive || t.gone);
  }

  update(dt: number, g: Game) {
    this.t += dt;
    this.phaseT += dt;
    const pl = g.playerTank;
    const P = POINTS;
    switch (this.phaseIndex) {
      case 0: {
        if (!pl) break;
        if (this.phaseT < 0.1) this.startDist = pl.movedDist;
        this.hint(g, 'drive', 'Touch and drag anywhere on the LEFT of the screen to drive. Your finger can wander — the stick follows it.', 'Drive with W / A / S / D. Click the screen to capture the mouse.');
        if (pl.movedDist - this.startDist > 25) this.hint(g, 'cam', 'Drag on the RIGHT side of the screen to look around. The turret follows your view.', 'Move the mouse to look around — the turret follows your view. Scroll to zoom.');
        if (pl.movedDist - this.startDist > 110 || this.phaseT > 45) this.hint(g, 'form', 'Tap ORDERS to command the platoon. Try the WEDGE formation once you leave the road.', 'Press Q for platoon orders, F to cycle formation (Column, Line, Wedge).');
        if (pl.pos.distanceTo(v3(P.crossroads, g, 0)) < 22) {
          this.complete(g, this.info.objectives[0]);
          this.enterPhase(g, 1);
        }
        break;
      }
      case 1:
        if (!this.boar1.alive || this.boar1.gone) {
          this.complete(g, this.info.objectives[1]);
          g.radio('Pathfinders', this.boar1.gone ? 'It\'s running! Good enough — the road is open.' : 'Got him! Nice work, Vanguard.');
          this.enterPhase(g, 2);
        }
        break;
      case 2:
        if (pl && pl.pos.distanceTo(v3(P.rendezvous, g, 0)) < 30) {
          this.complete(g, this.info.objectives[2]);
          this.enterPhase(g, 3);
        }
        break;
      case 3: {
        const infLeft = this.orchardEnemy.alive().length;
        if (!this.nest.alive && this.enemyArmourGone([this.boar2]) && infLeft > 0 && !this.orchardEnemy.fleeing) {
          this.orchardEnemy.fleeing = true;
          g.infantry.order(this.orchardEnemy, [{ x: 60, z: 90 }, { x: 20, z: 200 }], true);
          g.radio(HALE, 'They\'re breaking! Let them run.');
        }
        if (this.orchardEnemy.fleeing && this.once('fleeT')) this.flags.add('fleeStart:' + this.t);
        const fled = this.orchardEnemy.fleeing && [...this.flags].some((f) => f.startsWith('fleeStart:') && this.t - parseFloat(f.split(':')[1]) > 6);
        if (!this.nest.alive && this.enemyArmourGone([this.boar2]) && (infLeft === 0 || fled)) {
          for (const s of this.orchardEnemy.soldiers) if (s.active) s.mesh.visible = false, (s.alive = false);
          this.orchardEnemy.active = false;
          this.complete(g, this.info.objectives[3]);
          this.enterPhase(g, 4);
        }
        break;
      }
      case 4: {
        if (!this.crossing) {
          this.strongpointFire(dt, g);
          const sc = this.crossingScreened(g);
          if (sc.ok) {
            this.smokeCover += dt;
            this.smokeOwner = sc.owner ?? this.smokeOwner;
            this.noSmokeT = 0;
          } else {
            this.smokeCover = Math.max(0, this.smokeCover - dt * 0.5);
            this.noSmokeT += dt;
          }
          if (this.smokeCover > 1.5) {
            this.crossing = true;
            if (this.smokeOwner) g.tracker.smokeEffective(this.smokeOwner);
            g.radio(HALE, 'That\'s a beautiful screen! Able Company — across, now! Move!');
            if (this.smokeOwner && pl?.commanderId === this.smokeOwner) g.hud.hitMarker('SMOKE SCREEN EFFECTIVE', 'good');
            for (const [sq, dx] of [[this.able1, 0], [this.able2, -6], [this.pathfinders, 6]] as [Squad, number][])
              g.infantry.order(sq, [{ x: 96 + dx, z: 70 }, { x: P.crossingEnd.x + dx, z: P.crossingEnd.z }], true);
          }
          // fallback: platoon out of smoke rounds → regimental mortars help out
          const smokeLeft = g.tanks.filter((t) => t.side === 'ally' && t.alive).reduce((s, t) => s + t.ammo.SMOKE, 0);
          if ((pl?.ammo.SMOKE ?? 0) === 0 && this.noSmokeT > 20 && this.once('mortar')) {
            g.radio(HQ, `Vanguard, mortar section will lay smoke on the crossing.${smokeLeft ? '' : ' Your platoon is out of smoke rounds.'}`);
            for (let i = 0; i < 4; i++)
              g.after(3 + i * 0.6, () => {
                const p = v3({ x: P.smokeZone.x + (i - 1.5) * 9, z: P.smokeZone.z + (i - 1.5) * 6 }, g, 0);
                g.world.col.smoke.push({ x: p.x, y: p.y + 2.5, z: p.z, r: 9, life: 40, maxLife: 40, ownerId: null });
                g.effects.smokeScreen(p);
              });
          }
          if (this.phaseT > 70 && this.once('remind-smoke')) g.radio(HALE, 'Vanguard, we\'re still waiting on that smoke! Between us and the wood, please!');
        } else {
          const done = [this.able1, this.able2].every((sq) => sq.alive().length === 0 || Math.hypot(sq.centre().x - P.crossingEnd.x, sq.centre().z - P.crossingEnd.z) < 16);
          if (done || this.phaseT > 200) {
            this.complete(g, this.info.objectives[4]);
            g.radio(HALE, 'We\'re across! The Hollow Wood gun crews are pulling back toward the town.');
            this.enterPhase(g, 5);
          }
        }
        break;
      }
      case 5: {
        // limited reinforcement: only after the first Ox falls, with fair warning
        const oxDown = [this.ox1, this.ox2].filter((t) => !t.alive || t.gone).length;
        if (oxDown >= 1 && !this.boar3 && this.once('reinf')) {
          g.after(10, () => g.radio('Vanguard 1-2', 'Heads up — engine noise on the north road. Something\'s coming down from the north!'));
          g.after(16, () => {
            const R = P.reinforcementStart;
            this.boar3 = g.spawnEnemy('V-32', R.x, R.z, R.heading, { aggression: 0.5, retreatTo: P.enemyRetreat, advanceTo: P.reinforcementGoal });
            g.activateEnemy(this.boar3, g.time + 3);
            this.markers.push(this.tankMarker(this.boar3, 'V-32 Boar'));
            g.radio(HQ, 'Vanguard, an enemy light tank is entering Bellwick from the north road.');
          });
        }
        if (!this.townNest.alive && this.once('mg-down')) g.radio(HALE, 'That\'s the machine-gun post silenced — the street is open!');
        const reinfPending = this.flags.has('reinf') && !this.boar3;
        if (this.enemyArmourGone([this.ox1, this.ox2, this.boar3]) && !this.townNest.alive && !reinfPending) {
          this.complete(g, this.info.objectives[5]);
          this.enterPhase(g, 6);
        }
        break;
      }
      case 6:
        if (pl && Math.hypot(pl.pos.x - P.squareCentre.x, pl.pos.z - P.squareCentre.z) < 24) {
          this.complete(g, this.info.objectives[6]);
          this.enterPhase(g, 7);
        } else if (this.phaseT > 4) this.hint(g, 'enter', 'Drive into the town square to secure it.', 'Drive into the town square to secure it.');
        break;
      case 7:
        this.victoryT += dt;
        g.world.updateFlag(Math.min(1, Math.max(0, (this.victoryT - 2) / 7)), g.time);
        if (this.victoryT > 9.5 && this.once('victory-ui')) g.showVictory();
        break;
    }
    if (this.phaseIndex !== 7) g.world.updateFlag(0, g.time);
  }
}
