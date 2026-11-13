import { describe, it, expect } from 'vitest';
import { newCampaign, nextCommandIndex, successionOrder, isAvailable } from '../src/campaign/campaign';
import { MissionTracker, XP } from '../src/progression/tracker';
import { commitResult, previewResult, MISSION_COMPLETION_XP, isPromotionEligible } from '../src/progression/debrief';
import { SaveSystem, memoryKV, migrate } from '../src/persistence/save';
import { resolveCasualty, deathChance, TUTORIAL_TUNING } from '../src/progression/casualty';
import { makeRng } from '../src/core/rng';

function trackerFor(s = newCampaign(1)) {
  const t = new MissionTracker('bellwick', 'The Battle of Bellwick');
  for (const sl of s.slots) t.addCommander(sl.commanderId!, sl.callsign, sl.tankId!);
  return { s, t };
}

describe('initial campaign', () => {
  it('starts with the four original commanders and Mercer in command', () => {
    const s = newCampaign(1);
    const names = s.slots.map((sl) => s.commanders[sl.commanderId!].lastName);
    expect(names).toEqual(['Mercer', 'Vale', 'Bennett', 'Ward']);
    expect(s.platoonCommanderId).toBe('cmdr-mercer');
    expect(s.deputyId).toBe('cmdr-vale');
    expect(s.slots[0].callsign).toBe('Vanguard 1-1');
    // ids are stable and not callsigns
    expect(new Set(Object.keys(s.commanders)).size).toBe(4);
    expect(Object.keys(s.commanders).every((id) => !id.includes('Vanguard'))).toBe(true);
  });
});

describe('command succession', () => {
  const order = [0, 1, 2, 3];
  it('passes to the next operational tank', () => {
    expect(nextCommandIndex(order, 0, (i) => i !== 0)).toBe(1);
  });
  it('skips knocked-out tanks', () => {
    const alive = new Set([3]);
    expect(nextCommandIndex(order, 1, (i) => alive.has(i))).toBe(3);
  });
  it('wraps around to anyone still fighting', () => {
    expect(nextCommandIndex(order, 3, (i) => i === 2)).toBe(2);
  });
  it('returns -1 when the platoon is wiped out (mission fails)', () => {
    expect(nextCommandIndex(order, 2, () => false)).toBe(-1);
  });

  it('makes Vale platoon commander if Mercer is killed', () => {
    const { s, t } = trackerFor();
    t.setVehicle('cmdr-mercer', 'destroyed', 0);
    t.setCrew('cmdr-mercer', 'killed', 'Ammunition detonation');
    const r = t.result(true, 900, 7, 'cmdr-vale');
    const rep = commitResult(s, r);
    expect(rep.platoonCommanderKilled).toBe(true);
    expect(s.platoonCommanderId).toBe('cmdr-vale');
    expect(s.slots[0].commanderId).toBe('cmdr-vale');
    expect(s.slots[0].callsign).toBe('Vanguard 1-1');
    expect(s.deputyId).not.toBe('cmdr-vale');
    expect(s.deputyId).not.toBeNull();
  });

  it('skips to the next surviving commander if Mercer and Vale both die', () => {
    const { s, t } = trackerFor();
    for (const id of ['cmdr-mercer', 'cmdr-vale']) {
      t.setVehicle(id, 'destroyed', 0);
      t.setCrew(id, 'killed', 'x');
    }
    commitResult(s, t.result(true, 900, 7, 'cmdr-bennett'));
    expect(['cmdr-bennett', 'cmdr-ward']).toContain(s.platoonCommanderId);
    // two replacements fill the platoon, none are clones of the originals
    const reps = s.slots.map((sl) => s.commanders[sl.commanderId!]).filter((c) => !c.original);
    expect(reps.length).toBe(2);
    for (const r of reps) {
      expect(['Mercer', 'Vale', 'Bennett', 'Ward']).not.toContain(r.lastName);
      expect(r.serviceNumber).toMatch(/^AL-/);
    }
    expect(new Set(reps.map((r) => r.serviceNumber)).size).toBe(2);
  });
});

describe('casualty persistence', () => {
  it('a killed commander goes to the Roll of Honour with his record intact and never returns', () => {
    const { s, t } = trackerFor();
    t.tankKilled('cmdr-ward', 'light');
    t.setVehicle('cmdr-ward', 'destroyed', 0);
    t.setCrew('cmdr-ward', 'killed', 'Penetrating hit to the turret');
    commitResult(s, t.result(true, 1000, 7, 'cmdr-mercer'));
    const w = s.commanders['cmdr-ward'];
    expect(w.status).toBe('kia');
    expect(s.rollOfHonour).toContain('cmdr-ward');
    expect(w.kia?.rankAtDeath).toBe(0);
    expect(w.kia?.missionId).toBe('bellwick');
    expect(w.tankKills).toBe(1);
    expect(w.medals.some((m) => m.medalId === 'BELLWICK_RIBBON' && m.posthumous)).toBe(true);
    expect(isAvailable(s, w)).toBe(false);
    expect(s.slots.some((sl) => sl.commanderId === 'cmdr-ward')).toBe(false);
    // Another reorganisation still never brings him back
    const { t: t2 } = trackerFor(s);
    commitResult(s, t2.result(true, 800, 7, s.platoonCommanderId));
    expect(s.slots.some((sl) => sl.commanderId === 'cmdr-ward')).toBe(false);
    expect(s.commanders['cmdr-ward'].status).toBe('kia');
  });

  it('a destroyed tank does not automatically kill the commander', () => {
    const rng = makeRng(42);
    let deaths = 0;
    for (let i = 0; i < 2000; i++) {
      const o = resolveCasualty({ severity: 0.5, penetrated: true, ammoDetonation: false, crewCompartmentHit: false, fire: false, kind: 'destroyed' }, rng);
      if (o === 'killed') deaths++;
    }
    expect(deaths).toBeGreaterThan(0);
    expect(deaths / 2000).toBeLessThan(0.2); // uncommon in the tutorial mission
  });

  it('ammunition detonation is far more lethal than a disabling hit', () => {
    const base = { severity: 0.4, penetrated: true, crewCompartmentHit: false, fire: false };
    expect(deathChance({ ...base, ammoDetonation: true, kind: 'destroyed' }, TUTORIAL_TUNING)).toBeGreaterThan(
      deathChance({ ...base, ammoDetonation: false, kind: 'disabled' }, TUTORIAL_TUNING) * 3,
    );
  });

  it('a surviving crew whose tank was destroyed gets a replacement tank', () => {
    const { s, t } = trackerFor();
    const oldTank = s.slots[2].tankId!;
    t.setVehicle('cmdr-bennett', 'destroyed', 0);
    t.setCrew('cmdr-bennett', 'unhurt', 'x');
    commitResult(s, t.result(true, 900, 7, 'cmdr-mercer'));
    const slot = s.slots.find((sl) => sl.commanderId === 'cmdr-bennett')!;
    expect(slot.tankId).not.toBe(oldTank);
    expect(s.tanks[oldTank].status).toBe('destroyed');
    expect(s.tanks[slot.tankId!].status).toBe('active');
  });
});

describe('XP allocation', () => {
  it('credits kills to the commander who made them, not the player', () => {
    const { s, t } = trackerFor();
    t.tankKilled('cmdr-vale', 'medium');
    t.tankKilled('cmdr-mercer', 'light');
    t.objectiveComplete('Reach the crossroads', 'cmdr-mercer');
    const r = t.result(true, 900, 7, 'cmdr-mercer');
    const vale = r.commanders.find((c) => c.commanderId === 'cmdr-vale')!;
    const mercer = r.commanders.find((c) => c.commanderId === 'cmdr-mercer')!;
    expect(vale.xp).toBe(XP.KILL_MEDIUM);
    expect(mercer.xp).toBe(XP.KILL_LIGHT + XP.OBJECTIVE);
    commitResult(s, r);
    expect(s.commanders['cmdr-vale'].xp).toBe(XP.KILL_MEDIUM + MISSION_COMPLETION_XP);
    expect(s.commanders['cmdr-bennett'].xp).toBe(MISSION_COMPLETION_XP);
    expect(s.commanders['cmdr-vale'].tankKills).toBe(1);
  });

  it('coordinated kills credit both the designator and the shooter', () => {
    const { t } = trackerFor();
    t.tankKilled('cmdr-bennett', 'light', { coordinated: true, designatorId: 'cmdr-mercer' });
    expect(t.get('cmdr-mercer')!.xp).toBe(XP.COORDINATED);
    expect(t.get('cmdr-bennett')!.xp).toBe(XP.KILL_LIGHT + XP.COORDINATED);
  });

  it('one introductory mission does not earn a promotion', () => {
    const { s, t } = trackerFor();
    for (let i = 0; i < 5; i++) t.tankKilled('cmdr-ward', i < 3 ? 'light' : 'medium');
    const rep = commitResult(s, t.result(true, 900, 7, 'cmdr-mercer'));
    expect(rep.commanders.every((c) => !c.promoted)).toBe(true);
    expect(isPromotionEligible(s.commanders['cmdr-ward'])).toBe(false);
    // ...but it does earn a defined decoration
    expect(s.commanders['cmdr-ward'].medals.some((m) => m.medalId === 'ARMOURED_SERVICE_CROSS')).toBe(true);
  });
});

describe('save-state integrity', () => {
  it('committing the same result twice never duplicates XP or medals', () => {
    const { s, t } = trackerFor();
    t.tankKilled('cmdr-vale', 'light');
    const r = t.result(true, 900, 7, 'cmdr-mercer');
    commitResult(s, r);
    const xp = s.commanders['cmdr-vale'].xp;
    const medals = s.commanders['cmdr-vale'].medals.length;
    commitResult(s, r);
    commitResult(s, r);
    expect(s.commanders['cmdr-vale'].xp).toBe(xp);
    expect(s.commanders['cmdr-vale'].medals.length).toBe(medals);
    expect(s.missionCounter).toBe(1);
  });

  it('preview does not mutate the campaign', () => {
    const { s, t } = trackerFor();
    t.tankKilled('cmdr-vale', 'light');
    const before = JSON.stringify(s);
    previewResult(s, t.result(true, 900, 7, 'cmdr-mercer'));
    expect(JSON.stringify(s)).toBe(before);
  });

  it('restarting a failed mission restores the pre-mission state', () => {
    const save = new SaveSystem(memoryKV());
    const s = newCampaign(7);
    save.snapshotPreMission(s);
    // simulate in-mission corruption of the in-memory state
    s.commanders['cmdr-mercer'].status = 'kia';
    s.cohesion = 1;
    const restored = save.restorePreMission()!;
    expect(restored.commanders['cmdr-mercer'].status).toBe('active');
    expect(restored.cohesion).toBe(55);
    expect(save.load()!.commanders['cmdr-mercer'].status).toBe('active');
  });

  it('a finished mission is locked in as pending, so a reload cannot dodge casualties', () => {
    const kv = memoryKV();
    const save = new SaveSystem(kv);
    const { s, t } = trackerFor();
    save.snapshotPreMission(s);
    t.setVehicle('cmdr-ward', 'destroyed', 0);
    t.setCrew('cmdr-ward', 'killed', 'x');
    const r = t.result(true, 900, 7, 'cmdr-mercer');
    save.recordPending(s, r);
    const reloaded = new SaveSystem(kv).load()!;
    expect(reloaded.pendingResult?.resultId).toBe(r.resultId);
    new SaveSystem(kv).confirm(reloaded, reloaded.pendingResult!);
    const final = new SaveSystem(kv).load()!;
    expect(final.commanders['cmdr-ward'].status).toBe('kia');
    expect(final.pendingResult).toBeNull();
    expect(final.rollOfHonour).toEqual(['cmdr-ward']);
  });

  it('migrates a v1 save', () => {
    const s: any = newCampaign(3);
    s.schemaVersion = 1;
    delete s.pendingResult;
    delete s.replacementsIssued;
    const m = migrate(JSON.parse(JSON.stringify(s)))!;
    expect(m.schemaVersion).toBe(2);
    expect(m.pendingResult).toBeNull();
    expect(m.replacementsIssued).toEqual({ commanders: 0, tanks: 0 });
  });

  it('round-trips through storage', () => {
    const save = new SaveSystem(memoryKV());
    const s = newCampaign(9);
    save.save(s);
    expect(save.load()).toEqual(s);
  });
});

describe('successionOrder', () => {
  it('follows slot order', () => {
    const s = newCampaign(2);
    expect(successionOrder(s).map((x) => x.callsign)).toEqual(['Vanguard 1-1', 'Vanguard 1-2', 'Vanguard 1-3', 'Vanguard 1-4']);
  });
});
