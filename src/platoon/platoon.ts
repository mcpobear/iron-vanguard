import * as THREE from 'three';
import type { Game } from '../game/game';
import { FriendlyAI } from '../ai/tankAI';
import type { Tank } from '../vehicles/tank';
import { wrap } from '../vehicles/tank';

export type Order = 'follow' | 'hold' | 'move' | 'attack' | 'formup';
export type Formation = 'column' | 'line' | 'wedge';

export const ORDER_LABEL: Record<Order, string> = {
  follow: 'Follow Me',
  hold: 'Hold Position',
  move: 'Move To',
  attack: 'Attack My Target',
  formup: 'Form Up',
};
export const FORMATION_LABEL: Record<Formation, string> = { column: 'Column', line: 'Line Abreast', wedge: 'Wedge' };

const OFFSETS: Record<Formation, [number, number][]> = {
  column: [[0, -15], [0, -30], [0, -45]],
  line: [[-15, 0], [15, 0], [30, 0]],
  wedge: [[-14, -13], [14, -13], [0, -26]],
};

interface Pending {
  order: Order;
  at: number;
}

export class Platoon {
  ais: FriendlyAI[] = [];
  order: Order = 'follow';
  formation: Formation = 'column';
  designated: Tank | null = null;
  movePoint: THREE.Vector3 | null = null;
  moveHeading = 0;
  leaderHeading = 0;
  private pending = new Map<FriendlyAI, Pending>();
  private applied = new Map<FriendlyAI, Order>();
  private arrived = new Set<FriendlyAI>();
  private orderId = 0;
  private counted = new Set<number>();

  constructor(private g: Game) {}

  rebuild(tanks: Tank[]) {
    this.ais = tanks.filter((t) => t.side === 'ally').map((t) => this.ais.find((a) => a.tank === t) ?? new FriendlyAI(t));
  }

  /** AI tanks (excluding the player) in succession order — used for formation slots. */
  members() {
    return this.ais.filter((a) => a.tank.alive && !a.tank.isPlayer).sort((a, b) => a.tank.slotIndex - b.tank.slotIndex);
  }

  /** In contact, a column automatically deploys into line so every gun can bear. */
  inContact = false;
  effectiveFormation(): Formation {
    return this.inContact && this.formation === 'column' ? 'line' : this.formation;
  }

  slotPosition(ai: FriendlyAI, origin: THREE.Vector3, heading: number): THREE.Vector3 {
    const i = Math.max(0, this.members().indexOf(ai));
    const [ox, oz] = OFFSETS[this.effectiveFormation()][Math.min(2, i)];
    const c = Math.cos(heading), s = Math.sin(heading);
    // local +x is the leader's right: rotate (ox, oz) by heading
    const x = origin.x + ox * c + oz * s;
    const z = origin.z - ox * s + oz * c;
    const p = new THREE.Vector3(x, 0, z);
    // nudge out of obstacles
    for (let k = 0; k < 6 && this.g.world.col.pointBlocked(p.x, p.z, 3.5); k++) {
      p.x += (origin.x - p.x) * 0.25;
      p.z += (origin.z - p.z) * 0.25;
    }
    return p;
  }

  issue(order: Order, opts: { point?: THREE.Vector3; target?: Tank | null } = {}) {
    const g = this.g;
    if (order === 'attack') {
      if (!opts.target) {
        g.hud.flash('NO TARGET — aim at an enemy tank first');
        return;
      }
      this.designated = opts.target;
    }
    if (order === 'move') {
      if (!opts.point) return;
      this.movePoint = opts.point.clone();
      const lead = g.playerTank;
      this.moveHeading = lead ? Math.atan2(opts.point.x - lead.pos.x, opts.point.z - lead.pos.z) : 0;
    }
    this.order = order;
    this.orderId++;
    this.arrived.clear();
    g.tracker.ordersIssued++;
    const cohesion = g.campaign.cohesion;
    const leadership = g.mercerLeading() ? 0.7 : 1;
    const cohesionMul = 1 - (cohesion - 50) / 250;
    for (const ai of this.members()) {
      const b = ai.tank.behaviour;
      const delay = (b?.orderDelay ?? 1.2) * leadership * cohesionMul * (1 + ai.tank.stress * (b?.stressPenalty ?? 0.5));
      this.pending.set(ai, { order, at: g.time + delay });
    }
    g.audio.radio();
    g.radio(g.playerCallsign(), `All Vanguard call-signs: ${ORDER_LABEL[order].toUpperCase()}${order === 'attack' && this.designated ? ` — ${this.designated.def.name}` : ''}.`);
    // staggered acknowledgements
    const ms = this.members();
    ms.forEach((ai, i) => {
      const p = this.pending.get(ai)!;
      g.after(p.at - g.time + i * 0.3, () => {
        if (ai.tank.alive && !ai.tank.isPlayer) g.radioFrom(ai.tank, i === 0 ? 'Wilco.' : 'Roger, out.', true);
      });
    });
  }

  setFormation(f: Formation) {
    this.formation = f;
    this.g.radio(this.g.playerCallsign(), `Change formation: ${FORMATION_LABEL[f]}.`);
    this.g.audio.radio();
    if (this.order === 'hold' || this.order === 'move') return;
    this.issue('formup');
  }

  cycleFormation() {
    const all: Formation[] = ['column', 'line', 'wedge'];
    this.setFormation(all[(all.indexOf(this.formation) + 1) % all.length]);
  }

  effectiveOrder(ai: FriendlyAI): Order {
    const p = this.pending.get(ai);
    if (p && this.g.time >= p.at) {
      this.applied.set(ai, p.order);
      this.pending.delete(ai);
    }
    return this.applied.get(ai) ?? 'follow';
  }

  reportArrived(ai: FriendlyAI) {
    if (this.arrived.has(ai)) return;
    this.arrived.add(ai);
    const ms = this.members();
    if (ms.length && ms.every((m) => this.arrived.has(m)) && !this.counted.has(this.orderId)) {
      this.counted.add(this.orderId);
      this.g.tracker.ordersCompleted++;
      if (this.order === 'formup') {
        this.order = 'follow';
        for (const m of ms) this.applied.set(m, 'follow');
      }
      if (this.order === 'move') this.g.radio('Vanguard 1-2', 'All call-signs in position.');
    }
  }

  isAttackingDesignated(killer: Tank, target: Tank) {
    const ai = this.ais.find((a) => a.tank === killer);
    return !!ai && this.applied.get(ai) === 'attack' && this.designated === target;
  }

  update(dt: number) {
    const g = this.g;
    const lead = g.playerTank;
    if (lead) {
      // smoothed leader heading (direction of travel) for stable formation slots
      const h = lead.speed < -0.5 ? wrap(lead.heading + Math.PI) : lead.heading;
      const target = Math.abs(lead.speed) > 0.6 ? (lead.speed < 0 ? lead.heading : h) : this.leaderHeading;
      this.leaderHeading = wrap(this.leaderHeading + wrap(target - this.leaderHeading) * Math.min(1, dt * 1.2));
    }
    if (lead) {
      const was = this.inContact;
      this.inContact = g.tanks.some((t) => t.side === 'enemy' && t.alive && t.active && !t.gone && g.enemySpotted.has(t.id) && t.pos.distanceTo(lead.pos) < 320);
      if (this.inContact && !was && this.formation === 'column') g.radio('Vanguard 1-2', 'Contact — platoon deploying into line!');
    }
    if (this.designated && !this.designated.alive && this.order === 'attack') {
      this.designated = null;
      this.issue('follow');
    }
    let good = 0, n = 0;
    for (const ai of this.ais) {
      ai.update(dt, g);
      if (!ai.tank.isPlayer && ai.tank.alive && (this.order === 'follow' || this.order === 'formup')) {
        n++;
        if (ai.inFormation) good++;
      }
    }
    if (n) {
      g.tracker.formationTime += dt;
      g.tracker.formationGood += (dt * good) / n;
    }
  }

  /** On command transfer: reset AI state toward the new leader. */
  onCommandTransfer() {
    this.pending.clear();
    for (const ai of this.ais) {
      this.applied.set(ai, this.order === 'move' || this.order === 'hold' ? this.order : 'follow');
      ai.holdPoint = null;
    }
    if (this.order === 'attack') this.order = 'follow';
  }
}
