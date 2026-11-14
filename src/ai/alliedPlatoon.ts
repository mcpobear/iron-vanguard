import * as THREE from 'three';
import { Tank, wrap } from '../vehicles/tank';
import { driveTo, lineOfFireClear, newDrive, visiblePoint, type DriveState } from './tankAI';
import type { Game } from '../game/game';
import { TANKS } from '../data/tanks';
import { makeRng, pick, type Rng } from '../core/rng';
import { rankAbbr } from '../data/ranks';

export type SectorOrder = 'hold' | 'support' | 'counter' | 'fallback';

export interface AlliedMember {
  tank: Tank;
  ds: DriveState;
  target: Tank | null;
  acquire: number;
  /** Assigned fighting position; recomputed when the platoon is given a new sector. */
  post: THREE.Vector3;
  stopT: number;
  reportedT: number;
  skill: number;
  seenAt?: THREE.Vector3;
}

const FIRST = ['Marcus', 'Roland', 'Edwin', 'Tobias', 'Albert', 'Clement', 'Nathaniel', 'Reginald', 'Percy', 'Aubrey', 'Desmond', 'Gilbert'];
const LAST = ['Hartwell', 'Standish', 'Ellery', 'Vance', 'Royce', 'Merrick', 'Quill', 'Dunmore', 'Ashcroft', 'Barrow', 'Keel', 'Farrow'];

/**
 * A second-line Alderland platoon: four tanks that hold a sector of the line on their own,
 * take casualties, report on the radio, and obey the brigade orders the player can issue.
 * They are deliberately simpler than the player's own platoon — no formation slots, just
 * fighting positions and a sector to defend.
 */
export class AlliedPlatoon {
  members: AlliedMember[] = [];
  order: SectorOrder = 'hold';
  sector: THREE.Vector3;
  private rng: Rng;
  private lastRadio = -99;
  private announced = new Set<number>();
  /** Set while the platoon has been told to support the player. */
  supportTarget: THREE.Vector3 | null = null;
  destroyedCount = 0;
  /** Heading the platoon faces when holding (0 = north). Posts are spread across it. */
  facing = 0;

  constructor(public callsign: string, public name: string, sector: { x: number; z: number }, private g: Game, seed: number) {
    this.sector = new THREE.Vector3(sector.x, 0, sector.z);
    this.rng = makeRng(seed);
  }

  /** Spawn the platoon's tanks around its forming-up point. */
  deploy(at: { x: number; z: number }, heading: number, count = 4) {
    const g = this.g;
    this.facing = heading;
    const used = new Set(Object.values(g.campaign.commanders).map((c) => c.lastName));
    for (let i = 0; i < count; i++) {
      const t = new Tank(TANKS['A-44'], 'ally', String(201 + i + this.members.length * 10), g.shadowsOn);
      let first = pick(this.rng, FIRST), last = pick(this.rng, LAST);
      for (let k = 0; k < 20 && used.has(last); k++) last = pick(this.rng, LAST);
      used.add(last);
      const rank = i === 0 ? 2 : i === 1 ? 1 : 0;
      t.commanderName = `${first} ${last}`;
      t.rankAbbr = rankAbbr(rank);
      t.callsign = `${this.callsign}-${i + 1}`;
      t.label = `${t.callsign} (${t.commanderName})`;
      t.slotIndex = 100 + i; // keeps them out of the player's succession order
      t.allied = true;
      const spread = (i - (count - 1) / 2) * 13;
      const x = at.x + Math.cos(heading) * spread;
      const z = at.z - Math.sin(heading) * spread;
      t.place(x, z, heading, g);
      g.scene.add(t.view.root);
      g.tanks.push(t);
      this.members.push({ tank: t, ds: newDrive(), target: null, acquire: 0, post: new THREE.Vector3(x, 0, z), stopT: 0, reportedT: -99, skill: 0.9 + this.rng() * 0.5 });
    }
  }

  get alive() {
    return this.members.filter((m) => m.tank.alive);
  }

  /** Send the platoon to a new sector; posts are spread along the crest around it. */
  setSector(p: { x: number; z: number }, order: SectorOrder = 'hold', facing = this.facing) {
    this.sector.set(p.x, 0, p.z);
    this.order = order;
    this.facing = facing;
    this.supportTarget = null;
    const live = this.alive;
    // line abreast, at right angles to the direction the platoon faces
    const ax = Math.cos(facing), az = -Math.sin(facing);
    const fx = Math.sin(facing), fz = Math.cos(facing);
    live.forEach((m, i) => {
      const spread = (i - (live.length - 1) / 2) * 15;
      const depth = (this.rng() - 0.5) * 8;
      m.post.set(p.x + ax * spread + fx * depth, 0, p.z + az * spread + fz * depth);
    });
  }

  /** Brigade order from the player: come and help at a point. */
  support(p: THREE.Vector3) {
    this.order = 'support';
    this.supportTarget = p.clone();
    this.radio(`Moving to support, out.`);
  }

  radio(text: string, force = false) {
    const g = this.g;
    if (!force && g.time - this.lastRadio < 6) return;
    this.lastRadio = g.time;
    const lead = this.alive[0]?.tank;
    g.radio(lead ? `${lead.callsign} (${lead.rankAbbr} ${lead.commanderName.split(' ').pop()})` : this.callsign, text);
  }

  update(dt: number) {
    const g = this.g;
    for (const m of this.members) {
      const t = m.tank;
      if (!t.alive) {
        if (!this.announced.has(t.id)) {
          this.announced.add(t.id);
          this.destroyedCount++;
          g.radio(this.callsign, `${t.callsign} is hit — ${t.status === 'destroyed' ? 'brewing up' : 'knocked out'}!`);
        }
        continue;
      }
      this.updateMember(m, dt);
    }
  }

  private updateMember(m: AlliedMember, dt: number) {
    const g = this.g;
    const t = m.tank;

    // ---- target selection ----
    const eye = t.eye();
    let best: Tank | null = null;
    let bestScore = 1e9;
    for (const e of g.tanks) {
      if (e.side !== 'enemy' || !e.alive || !e.active || e.gone) continue;
      const c = e.centre();
      const d = c.distanceTo(eye);
      if (d > t.def.spotRange) continue;
      const seen = visiblePoint(t, e, g);
      if (!seen) continue;
      m.seenAt = seen;
      let score = d;
      if (e.def.cls === 'heavy') score -= 60;
      if (e === m.target) score -= 40;
      if (score < bestScore) {
        bestScore = score;
        best = e;
      }
    }
    if (best !== m.target) {
      m.acquire = 0;
      m.target = best;
      if (best && !g.enemySpotted.has(best.id)) {
        g.enemySpotted.add(best.id);
        this.radio(`Contact — enemy ${best.def.cls} tank to our front!`);
      }
    }

    let holdStill = false;
    if (m.target) {
      m.acquire += dt / (2.6 * m.skill);
      if (m.acquire >= 1) {
        const tgt = m.target;
        const c = (m.seenAt ?? tgt.centre()).clone();
        const flight = c.distanceTo(t.centre()) / t.def.gun.velocity.AP;
        const lead = c.add(tgt.forward().multiplyScalar(tgt.speed * flight));
        t.ammoSel = 'AP';
        t.aimPoint = lead;
        const dir = new THREE.Vector3();
        const pos = new THREE.Vector3();
        t.muzzle(pos, dir);
        const to = lead.clone().sub(pos).normalize();
        if (to.angleTo(dir) < 0.022 && t.reload <= 0 && lineOfFireClear(t, lead, g)) {
          if (Math.abs(t.speed) > 1) holdStill = true;
          else g.weapons.fireMain(t, 2.6 * m.skill);
        } else if (t.reload <= 0.8) holdStill = true;
      }
    } else {
      // watch the enemy approach
      t.aimPoint = t.centre().add(new THREE.Vector3(Math.sin(this.facing) * 70, 0.5, Math.cos(this.facing) * 70));
    }

    // ---- movement ----
    let goal: THREE.Vector3 | null = null;
    let speed = 0.8;
    switch (this.order) {
      case 'hold':
        goal = m.post;
        break;
      case 'support':
        goal = this.supportTarget ?? m.post;
        speed = 1;
        break;
      case 'counter':
        // push forward onto the nearest enemy
        goal = m.target ? m.target.pos.clone().lerp(t.pos, 0.35) : m.post;
        speed = 1;
        break;
      case 'fallback':
        goal = m.post;
        speed = 1;
        break;
    }
    if (holdStill && this.order !== 'fallback') {
      m.stopT = Math.min(1.8, m.stopT + dt * 2);
    } else m.stopT = Math.max(0, m.stopT - dt);

    if (m.stopT > 0.3) {
      t.throttle = 0;
      t.steer = 0;
      // turn the thick front toward the threat
      if (m.target) {
        const dh = wrap(Math.atan2(m.target.pos.x - t.pos.x, m.target.pos.z - t.pos.z) - t.heading);
        t.steer = Math.abs(dh) > 0.35 ? Math.sign(dh) * 0.5 : 0;
      }
    } else if (goal) {
      const arrived = driveTo(t, goal.x, goal.z, g, m.ds, dt, speed, 6);
      if (arrived && this.order === 'hold') {
        const dh = wrap(this.facing - t.heading); // face the enemy's approach
        t.steer = Math.abs(dh) > 0.3 ? Math.sign(dh) * 0.5 : 0;
        t.throttle = Math.abs(dh) > 0.3 ? 0.1 : 0;
      }
    }
  }
}
