import type { CampaignState } from '../campaign/types';
import { SCHEMA_VERSION } from '../campaign/campaign';
import { commitResult, type DebriefReport } from '../progression/debrief';
import type { MissionResult } from '../campaign/types';

export interface KV {
  getItem(k: string): string | null;
  setItem(k: string, v: string): void;
  removeItem(k: string): void;
}

const KEY = 'ironvanguard.campaign';
const PRE_KEY = 'ironvanguard.premission';
const SETTINGS_KEY = 'ironvanguard.settings';

function memoryKV(): KV {
  const m = new Map<string, string>();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v), removeItem: (k) => void m.delete(k) };
}

export function defaultStore(): KV {
  try {
    const ls = globalThis.localStorage;
    const probe = '__iv_probe';
    ls.setItem(probe, '1');
    ls.removeItem(probe);
    return ls;
  } catch {
    return memoryKV(); // private mode / disabled storage: game still runs, nothing persists
  }
}

/** Upgrades older save schemas in place. Add a case per schema bump. */
export function migrate(raw: any): CampaignState | null {
  if (!raw || typeof raw !== 'object' || typeof raw.schemaVersion !== 'number') return null;
  let s = raw;
  if (s.schemaVersion === 1) {
    // v1 → v2: introduced pendingResult and replacementsIssued counters.
    s.pendingResult = s.pendingResult ?? null;
    s.replacementsIssued = s.replacementsIssued ?? { commanders: 0, tanks: 0 };
    s.schemaVersion = 2;
  }
  if (s.schemaVersion !== SCHEMA_VERSION) return null;
  return s as CampaignState;
}

export class SaveSystem {
  constructor(private kv: KV = defaultStore()) {}

  hasCampaign(): boolean {
    return !!this.load();
  }

  load(): CampaignState | null {
    const txt = this.kv.getItem(KEY);
    if (!txt) return null;
    try {
      return migrate(JSON.parse(txt));
    } catch {
      return null;
    }
  }

  save(s: CampaignState): void {
    this.kv.setItem(KEY, JSON.stringify(s));
  }

  /** Called on deployment. The live campaign is never written during combat. */
  snapshotPreMission(s: CampaignState): void {
    this.kv.setItem(PRE_KEY, JSON.stringify(s));
    this.save(s);
  }

  /** Mission failed or restarted: restore the pre-mission campaign exactly. */
  restorePreMission(): CampaignState | null {
    const txt = this.kv.getItem(PRE_KEY);
    if (!txt) return this.load();
    const s = migrate(JSON.parse(txt));
    if (s) this.save(s);
    return s;
  }

  /**
   * Mission succeeded: lock the result in as pending immediately, so reloading the page cannot
   * dodge casualties. The player must go through the debrief to continue.
   */
  recordPending(s: CampaignState, r: MissionResult): CampaignState {
    if (s.committedResultIds.includes(r.resultId)) return s;
    s.pendingResult = r;
    this.save(s);
    return s;
  }

  /** Debrief confirmed: commit permanently. Safe to call more than once. */
  confirm(s: CampaignState, r: MissionResult): DebriefReport {
    const rep = commitResult(s, r);
    this.save(s);
    this.kv.removeItem(PRE_KEY);
    return rep;
  }

  wipe(): void {
    this.kv.removeItem(KEY);
    this.kv.removeItem(PRE_KEY);
  }

  loadSettings<T>(defaults: T): T {
    try {
      const t = this.kv.getItem(SETTINGS_KEY);
      return t ? { ...defaults, ...JSON.parse(t) } : defaults;
    } catch {
      return defaults;
    }
  }
  saveSettings<T>(v: T) {
    this.kv.setItem(SETTINGS_KEY, JSON.stringify(v));
  }
}

export { memoryKV };
