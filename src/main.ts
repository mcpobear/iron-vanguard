import './style.css';
import { SaveSystem, migrate } from './persistence/save';
import { DEFAULT_SETTINGS, usesTouch, type Settings } from './core/settings';
import { newCampaign } from './campaign/campaign';
import type { CampaignState, MissionResult } from './campaign/types';
import { Audio } from './audio/audio';
import { Game } from './game/game';
import { BellwickMission, BELLWICK_INFO } from './missions/bellwick';
import * as S from './ui/screens';

class App implements S.ScreenHost {
  root = document.getElementById('app')!;
  save = new SaveSystem();
  settings: Settings = this.save.loadSettings(DEFAULT_SETTINGS);
  campaign: CampaignState | null = this.save.load();
  audio = new Audio();
  game: Game | null = null;
  mission = BELLWICK_INFO;
  private screenEl: HTMLElement | null = null;

  constructor() {
    this.audio.setVolume(this.settings.volume);
    const unlock = () => this.audio.unlock();
    window.addEventListener('pointerdown', unlock);
    window.addEventListener('keydown', unlock);
    // block page gestures (pinch zoom, double-tap zoom, pull-to-refresh) during play
    document.addEventListener('gesturestart', (e) => e.preventDefault());
    document.addEventListener('touchmove', (e) => {
      if (document.body.classList.contains('in-game')) e.preventDefault();
    }, { passive: false });
    document.addEventListener('dblclick', (e) => e.preventDefault());
    document.body.classList.toggle('touch', usesTouch(this.settings));
    this.show(this.campaign?.pendingResult ? 'debrief' : 'menu', this.campaign?.pendingResult ?? undefined);
    document.getElementById('boot')?.remove();
  }

  show(name: string, arg?: any) {
    this.screenEl?.remove();
    let el: HTMLElement;
    switch (name) {
      case 'staging':
        el = S.staging(this);
        break;
      case 'briefing':
        el = S.briefing(this);
        break;
      case 'debrief':
        el = S.debrief(this, arg);
        break;
      case 'personnel':
        el = S.personnel(this);
        break;
      case 'profile':
        el = S.profile(this, arg);
        break;
      case 'honour':
        el = S.rollOfHonour(this);
        break;
      case 'decorations':
        el = S.decorations(this);
        break;
      case 'settings':
        el = S.settingsScreen(this);
        break;
      default:
        el = S.mainMenu(this);
    }
    this.screenEl = el;
    this.root.appendChild(el);
    el.scrollTop = 0;
  }

  newCampaign() {
    this.campaign = newCampaign();
    this.save.save(this.campaign);
    this.show('staging');
  }

  continueCampaign() {
    if (!this.campaign) return;
    if (this.campaign.pendingResult) this.show('debrief', this.campaign.pendingResult);
    else this.show('staging');
  }

  deploy() {
    if (!this.campaign) return;
    this.save.snapshotPreMission(this.campaign);
    this.startGame();
  }

  private async goFullscreen() {
    try {
      const d = document.documentElement as any;
      if (usesTouch(this.settings) && !document.fullscreenElement && d.requestFullscreen) await d.requestFullscreen({ navigationUI: 'hide' });
      await (screen.orientation as any)?.lock?.('landscape');
    } catch {
      /* not supported (e.g. iPhone Safari) — the rotate prompt covers portrait */
    }
  }

  private startGame() {
    this.screenEl?.remove();
    this.screenEl = null;
    this.goFullscreen();
    this.audio.unlock();
    const loading = S.h('<div class="loading"><div>DEPLOYING TO BELLWICK…</div></div>');
    this.root.appendChild(loading);
    requestAnimationFrame(() =>
      setTimeout(() => {
        // Work on a scratch copy: the stored campaign is never touched during combat.
        const working: CampaignState = JSON.parse(JSON.stringify(this.campaign));
        this.game = new Game(this.root, this.settings, working, new BellwickMission(), this.audio, {
          onComplete: (r) => this.onComplete(r),
          onFailed: () => {},
          onQuit: () => this.endGame('menu'),
          onRestart: () => {
            this.endGame(null);
            this.startGame();
          },
        });
        loading.remove();
        this.game.start();
      }, 30),
    );
  }

  private endGame(next: string | null) {
    this.game?.dispose();
    this.game = null;
    this.campaign = this.save.restorePreMission();
    if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
    if (next) this.show(next);
  }

  private onComplete(r: MissionResult) {
    this.game?.dispose();
    this.game = null;
    // restore the pre-mission campaign, then lock this result in as pending
    this.campaign = this.save.restorePreMission();
    if (this.campaign) this.save.recordPending(this.campaign, r);
    if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
    this.show('debrief', r);
  }

  confirmDebrief(r: MissionResult) {
    if (!this.campaign) return;
    this.save.confirm(this.campaign, r);
    this.show('staging');
  }

  saveSettings(s: Settings) {
    this.settings = s;
    this.save.saveSettings(s);
    this.audio.setVolume(s.volume);
    document.body.classList.toggle('touch', usesTouch(s));
  }

  wipeCampaign() {
    this.save.wipe();
    this.campaign = null;
  }

  exportSave() {
    return this.campaign ? JSON.stringify(this.campaign, null, 1) : null;
  }

  importSave(json: string) {
    try {
      const s = migrate(JSON.parse(json));
      if (!s || !s.commanders || !s.slots) return false;
      this.campaign = s;
      this.save.save(s);
      return true;
    } catch {
      return false;
    }
  }
}

// Debug handle for automated smoke tests and curious players' consoles.
(window as any).__ironVanguard = new App();
