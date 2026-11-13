import type { CampaignState, Commander, MissionResult } from '../campaign/types';
import { appointmentOf, fullName, newCampaign, isAvailable } from '../campaign/campaign';
import { RANKS, rankAbbr, rankName } from '../data/ranks';
import { MEDALS } from '../data/medals';
import { portraitCanvas, rankCanvas, medalCanvas } from './art';
import { previewResult } from '../progression/debrief';
import type { Settings } from '../core/settings';
import type { MissionInfo } from '../missions/mission';
import { drawAlderlandRoundel } from '../rendering/textures';

export const h = (html: string) => {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild as HTMLElement;
};

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const fmtDate = (d: string) => {
  const [y, m, dd] = d.split('-').map(Number);
  return `${dd} ${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][m - 1]} ${y}`;
};
const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;

export interface ScreenHost {
  root: HTMLElement;
  campaign: CampaignState | null;
  settings: Settings;
  show(name: string, arg?: any): void;
  newCampaign(): void;
  continueCampaign(): void;
  deploy(): void;
  confirmDebrief(r: MissionResult): void;
  saveSettings(s: Settings): void;
  wipeCampaign(): void;
  importSave(json: string): boolean;
  exportSave(): string | null;
  mission: MissionInfo;
}

function screen(title: string, back: string | null, body: HTMLElement, host: ScreenHost, extraCls = '') {
  const s = h(`<div class="screen ${extraCls}"><header class="scr-head">${back ? '<button class="btn back">‹ BACK</button>' : ''}<h1>${title}</h1></header><div class="scr-body"></div></div>`);
  s.querySelector('.scr-body')!.appendChild(body);
  if (back) s.querySelector('.back')!.addEventListener('click', () => host.show(back));
  return s;
}

function emblem(size = 90) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  drawAlderlandRoundel(c.getContext('2d')!, size / 2, size / 2, size / 2 - 2);
  return c;
}

// ------------------------------------------------------------------------------- main menu

export function mainMenu(host: ScreenHost): HTMLElement {
  const has = !!host.campaign;
  const s = h(`<div class="screen menu-screen">
    <div class="menu-bg"></div>
    <div class="menu-col">
      <div class="logo"><div class="emb"></div><div><h1>IRON VANGUARD</h1><p>The War of the Broken Frontier · 1944</p></div></div>
      <div class="menu-buttons">
        ${has ? '<button class="btn big primary" data-a="continue">CONTINUE CAMPAIGN</button>' : ''}
        <button class="btn big ${has ? '' : 'primary'}" data-a="new">NEW CAMPAIGN</button>
        <button class="btn big" data-a="personnel">PERSONNEL RECORDS</button>
        <button class="btn big" data-a="honour">ROLL OF HONOUR</button>
        <button class="btn big" data-a="decorations">DECORATIONS</button>
        <button class="btn big" data-a="settings">SETTINGS</button>
      </div>
      <p class="tagline">“Machines can be replaced. The men who command them cannot.”</p>
    </div></div>`);
  s.querySelector('.emb')!.appendChild(emblem(72));
  s.querySelectorAll<HTMLElement>('[data-a]').forEach((b) =>
    b.addEventListener('click', () => {
      const a = b.dataset.a!;
      if (a === 'new') {
        if (has && !confirm('Start a new campaign? Your current campaign, including the Roll of Honour, will be replaced.')) return;
        host.newCampaign();
      } else if (a === 'continue') host.continueCampaign();
      else host.show(a);
    }),
  );
  return s;
}

// ------------------------------------------------------------------------------- staging area

export function staging(host: ScreenHost): HTMLElement {
  const c = host.campaign!;
  const done = c.completedMissions.includes('bellwick');
  const body = h(`<div class="staging">
    <div class="st-head">
      <div><small>3rd Armoured Regiment · 2nd Armoured Brigade</small><h2>Regimental Staging Area</h2><div class="muted">${fmtDate(c.warDate)} · Operation Dawn Spear</div></div>
      <div class="cohesion"><small>PLATOON COHESION</small><div class="meter"><i style="width:${c.cohesion}%"></i></div><b>${c.cohesion}</b></div>
    </div>
    <div class="slots"></div>
    <div class="missions">
      <div class="mission-card ${done ? 'done' : 'ready'}" data-a="brief">
        <small>MISSION 1 · ${host.mission.campaign}</small><h3>${host.mission.name}</h3>
        <div class="muted">${host.mission.location} · ${host.mission.time} · ${host.mission.weather}</div>
        <b>${done ? '✓ COMPLETED' : 'BRIEFING ›'}</b>
      </div>
      <div class="mission-card locked"><small>MISSION 2</small><h3>Coming Soon</h3><div class="muted">The advance continues beyond Bellwick.</div><b>LOCKED</b></div>
    </div>
    <div class="st-nav">
      <button class="btn" data-s="personnel">PERSONNEL</button>
      <button class="btn" data-s="honour">ROLL OF HONOUR</button>
      <button class="btn" data-s="decorations">DECORATIONS</button>
      <button class="btn" data-s="menu">MAIN MENU</button>
    </div>
    ${c.log.length ? `<div class="log"><small>WAR DIARY</small>${c.log.slice(-5).reverse().map((l) => `<div>${esc(l)}</div>`).join('')}</div>` : ''}
  </div>`);
  const slots = body.querySelector('.slots')!;
  for (const sl of c.slots) {
    const cm = sl.commanderId ? c.commanders[sl.commanderId] : null;
    const tk = sl.tankId ? c.tanks[sl.tankId] : null;
    const card = h(`<div class="slot-card"><div class="sc-port"></div><div><small>${sl.callsign}</small>
      <b>${cm ? `${rankAbbr(cm.rankIndex)} ${fullName(cm)}` : 'VACANT'}</b>
      <div class="muted">${cm ? appointmentOf(c, cm.id) : ''}</div>
      <div class="muted">${tk ? `${tk.model} Sentinel · turret ${tk.turretNumber} · ${tk.serial}` : 'No vehicle'}</div>
      ${cm && cm.status === 'wounded' ? '<span class="chip dmg">Recovering from wounds</span>' : ''}</div></div>`);
    if (cm) {
      card.querySelector('.sc-port')!.appendChild(portraitCanvas(cm.portrait, cm.rankIndex, false, 84));
      card.addEventListener('click', () => host.show('profile', cm.id));
    }
    slots.appendChild(card);
  }
  const mc = body.querySelector('[data-a="brief"]') as HTMLElement;
  if (!done) mc.addEventListener('click', () => host.show('briefing'));
  body.querySelectorAll<HTMLElement>('[data-s]').forEach((b) => b.addEventListener('click', () => host.show(b.dataset.s!)));
  return screen('VANGUARD 1 PLATOON', null, body, host);
}

// ------------------------------------------------------------------------------- briefing

export function briefing(host: ScreenHost): HTMLElement {
  const m = host.mission;
  const c = host.campaign!;
  const body = h(`<div class="briefing">
    <div class="br-left">
      <div class="br-meta">
        <div><small>CAMPAIGN</small>${m.campaign}</div><div><small>LOCATION</small>${m.location}</div>
        <div><small>TIME</small>${m.time}</div><div><small>WEATHER</small>${m.weather}</div>
        <div><small>DIFFICULTY</small>${m.difficulty}</div><div><small>EXPECTED DURATION</small>${m.duration}</div>
      </div>
      <div class="radio-brief">${m.briefing.map((p) => `<p>${esc(p)}</p>`).join('')}</div>
    </div>
    <div class="br-right">
      <small>OBJECTIVES</small><ol>${m.objectives.map((o) => `<li>${esc(o)}</li>`).join('')}</ol>
      <small>PLATOON — COMMAND SUCCESSION</small>
      <div class="roster">${c.slots
        .map((sl, i) => {
          const cm = c.commanders[sl.commanderId!];
          return `<div><b>${i + 1}.</b> ${sl.callsign} — ${rankAbbr(cm.rankIndex)} ${fullName(cm)}${i === 0 ? ' <i>(you)</i>' : ''}</div>`;
        })
        .join('')}</div>
      <small>FORCES</small>
      <div class="muted">Friendly: 4 × A-44 Sentinel, Able Company 9th Airborne<br>Enemy (reported): V-32 Boar light tanks, V-41 Ox medium tanks, infantry, machine-gun positions</div>
      <p class="warn">Commanders can be killed permanently. Losses are committed when the mission debrief is confirmed. Restarting before then restores the platoon.</p>
      <button class="btn big primary deploy">DEPLOY</button>
    </div></div>`);
  body.querySelector('.deploy')!.addEventListener('click', () => host.deploy());
  return screen('MISSION BRIEFING — ' + m.name.toUpperCase(), 'staging', body, host);
}

// ------------------------------------------------------------------------------- debrief

export function debrief(host: ScreenHost, r: MissionResult): HTMLElement {
  const c = host.campaign!;
  const { report, after } = previewResult(c, r);
  const veh = { operational: 0, damaged: 0, disabled: 0, destroyed: 0 } as Record<string, number>;
  for (const st of r.commanders) veh[st.vehicle]++;
  const kia = r.commanders.filter((st) => st.crew === 'killed');
  const body = h(`<div class="debrief">
    <section class="db-summary">
      <h2>MISSION RESULT — ${r.success ? 'SUCCESS' : 'FAILED'}</h2>
      <div class="stats">
        <div><small>Objectives completed</small><b>${r.objectivesCompleted.length} / ${r.objectivesTotal}</b></div>
        <div><small>Mission duration</small><b>${mmss(r.durationSec)}</b></div>
        <div><small>Enemy tanks destroyed</small><b>${r.enemyTanksDestroyed}${r.enemyTanksDrivenOff ? ` <i>(+${r.enemyTanksDrivenOff} driven off)</i>` : ''}</b></div>
        <div><small>Defensive positions neutralised</small><b>${r.positionsNeutralised}</b></div>
        <div><small>Friendly tanks operational</small><b>${veh.operational}</b></div>
        <div><small>Friendly tanks damaged</small><b>${veh.damaged + veh.disabled}</b></div>
        <div><small>Friendly tanks destroyed</small><b>${veh.destroyed}</b></div>
        <div><small>Commander casualties</small><b>${kia.length} killed · ${r.commanders.filter((s) => s.crew === 'wounded' || s.crew === 'incapacitated').length} wounded</b></div>
      </div>
      <ul class="obj-list">${host.mission.objectives.map((o) => `<li class="${r.objectivesCompleted.includes(o) ? 'ok' : ''}">${esc(o)}</li>`).join('')}</ul>
    </section>
    ${kia.length ? '<section class="casualty-report"></section>' : ''}
    <section class="db-commanders"></section>
    <section class="db-cohesion">
      <h3>Platoon cohesion ${report.cohesionBefore} → ${report.cohesionAfter}</h3>
      <div class="meter"><i style="width:${report.cohesionAfter}%"></i></div>
      <ul>${report.cohesionNotes.map((n) => `<li>${esc(n)}</li>`).join('')}</ul>
    </section>
    <section class="db-personnel"><h3>Personnel &amp; equipment</h3>
      <ul>${report.personnelNotes.length ? report.personnelNotes.map((n) => `<li>${esc(n)}</li>`).join('') : '<li>No changes to platoon appointments.</li>'}</ul>
      <div class="muted">Platoon Commander for the next mission: <b>${report.newPlatoonCommanderId ? `${rankAbbr(after.commanders[report.newPlatoonCommanderId].rankIndex)} ${fullName(after.commanders[report.newPlatoonCommanderId])}` : '—'}</b></div>
    </section>
    <div class="db-actions"><p class="muted">Confirming commits all results permanently to the campaign record.</p><button class="btn big primary confirm">CONFIRM DEBRIEF</button></div>
  </div>`);
  if (kia.length) {
    const cr = body.querySelector('.casualty-report')!;
    cr.innerHTML = '<h3>CASUALTY REPORT</h3>';
    for (const st of kia) {
      const cm = after.commanders[st.commanderId];
      const e = h(`<div class="kia-card"><div class="kp"></div><div>
        <b>${rankAbbr(cm.kia!.rankAtDeath)} ${fullName(cm)}</b> <span class="muted">${cm.serviceNumber}</span>
        <div>${st.callsign} · killed in action, ${esc(host.mission.name)}</div>
        <div class="muted">${esc(st.causeOfLoss ?? 'Enemy action')} · ${cm.missionsCompleted} mission(s) · ${cm.tankKills} enemy tanks destroyed</div>
        <div class="muted">His name has been added to the Roll of Honour.</div>
        ${r.finalPlatoonCommanderId && c.platoonCommanderId === st.commanderId ? `<div>Acting Platoon Commander: <b>${fullName(after.commanders[r.finalPlatoonCommanderId])}</b></div>` : ''}
      </div></div>`);
      e.querySelector('.kp')!.appendChild(portraitCanvas(cm.portrait, cm.rankIndex, true, 80));
      cr.appendChild(e);
    }
  }
  const dc = body.querySelector('.db-commanders')!;
  dc.appendChild(h('<h3>Commanders</h3>'));
  for (const rep of report.commanders) {
    const cm = after.commanders[rep.commanderId];
    const st = r.commanders.find((s) => s.commanderId === rep.commanderId)!;
    const card = h(`<div class="db-cmdr ${rep.killed ? 'fallen' : ''}">
      <div class="dp"></div>
      <div class="dc-main">
        <b>${rankAbbr(rep.rankBefore)} ${esc(rep.name)}</b> <span class="muted">${st.callsign}</span>
        <div class="${rep.killed ? 'red' : ''}">${esc(rep.outcome)}</div>
        <div class="muted">Tanks destroyed: ${st.tankKills} · Hits: ${st.hits}/${st.shotsFired} · Positions: ${st.positions} · Infantry: ${st.infantry}</div>
        <div class="xp"><b>+${rep.xpGained} XP</b> ${rep.xpLog.map((l) => `<span>${esc(l.reason)} ${l.xp}</span>`).join('')}</div>
        <div class="${rep.promoted ? 'promoted' : 'muted'}">${rep.killed ? '' : esc(rep.promotionNote)}</div>
      </div>
      <div class="dc-medals"></div></div>`);
    card.querySelector('.dp')!.appendChild(portraitCanvas(cm.portrait, cm.rankIndex, rep.killed, 64));
    for (const m of rep.newMedals) {
      const md = MEDALS[m.medalId];
      const w = h(`<div class="medal-new" title="${esc(m.citation)}"><span>${md.name}${m.posthumous ? ' (posthumous)' : ''}</span></div>`);
      w.prepend(medalCanvas(md, 40));
      card.querySelector('.dc-medals')!.appendChild(w);
    }
    dc.appendChild(card);
  }
  let confirmed = false;
  body.querySelector('.confirm')!.addEventListener('click', () => {
    if (confirmed) return;
    confirmed = true;
    host.confirmDebrief(r);
  });
  return screen('MISSION DEBRIEF', null, body, host, kia.length ? 'sombre' : '');
}

// ------------------------------------------------------------------------------- personnel

function viewCampaign(host: ScreenHost): CampaignState {
  return host.campaign ?? newCampaign(1944);
}

export function personnel(host: ScreenHost): HTMLElement {
  const c = viewCampaign(host);
  const list = Object.values(c.commanders).filter((x) => x.status !== 'kia');
  const order = c.slots.map((s) => s.commanderId);
  list.sort((a, b) => (order.indexOf(a.id) + 99) % 99 - ((order.indexOf(b.id) + 99) % 99));
  const body = h(`<div class="personnel"><div class="cards"></div>${host.campaign ? '' : '<p class="muted">Preview — start a campaign to begin these men\'s service records.</p>'}</div>`);
  const cards = body.querySelector('.cards')!;
  for (const cm of list) {
    const slot = c.slots.find((s) => s.commanderId === cm.id);
    const card = h(`<div class="p-card"><div class="pc-port"></div><div class="pc-info">
      <div class="pc-rank"></div><b>${fullName(cm)}</b><div>${rankName(cm.rankIndex)}</div>
      <div class="muted">${slot ? slot.callsign + ' · ' : ''}${appointmentOf(c, cm.id)}</div>
      <div class="muted">${cm.abilityName}</div>
      <div class="chips"><span class="chip ${cm.status === 'active' ? 'ok' : 'dmg'}">${cm.status === 'active' ? 'Active' : 'Wounded'}</span><span class="chip">${cm.xp} XP</span><span class="chip">${cm.medals.length} awards</span></div>
    </div></div>`);
    card.querySelector('.pc-port')!.appendChild(portraitCanvas(cm.portrait, cm.rankIndex, false, 110));
    card.querySelector('.pc-rank')!.appendChild(rankCanvas(cm.rankIndex, 30));
    card.addEventListener('click', () => host.show('profile', cm.id));
    cards.appendChild(card);
  }
  return screen('PERSONNEL RECORDS', host.campaign ? 'staging' : 'menu', body, host);
}

export function profile(host: ScreenHost, id: string): HTMLElement {
  const c = viewCampaign(host);
  const cm: Commander = c.commanders[id];
  const slot = c.slots.find((s) => s.commanderId === id);
  const tank = slot?.tankId ? c.tanks[slot.tankId] : cm.kia ? c.tanks[cm.kia.tankId] : null;
  const next = RANKS[cm.rankIndex + 1];
  const pct = next ? Math.min(100, Math.round((cm.xp / next.xp) * 100)) : 100;
  const status = cm.status === 'kia' ? `Killed in action — ${esc(cm.kia!.missionName)}, ${fmtDate(cm.kia!.date)}` : cm.status === 'wounded' ? (isAvailable(c, cm) ? 'Recovered from wounds — fit for duty' : 'Wounded — in hospital') : 'Active service';
  const body = h(`<div class="profile ${cm.status === 'kia' ? 'fallen' : ''}">
    <div class="pf-side">
      <div class="pf-port"></div>
      <h2>${fullName(cm)}</h2>
      <div class="pf-rank"><span></span>${rankName(cm.rankIndex)} (${rankAbbr(cm.rankIndex)})</div>
      <table class="kv">
        <tr><td>Service no.</td><td>${cm.serviceNumber}</td></tr>
        <tr><td>Age</td><td>${cm.age}</td></tr>
        <tr><td>Appointment</td><td>${appointmentOf(c, id)}</td></tr>
        <tr><td>Callsign</td><td>${slot?.callsign ?? cm.kia?.callsign ?? '—'}</td></tr>
        <tr><td>Assigned tank</td><td>${tank ? `${tank.model} Sentinel, turret ${tank.turretNumber} (${tank.serial})${tank.status === 'destroyed' ? ' — destroyed' : ''}` : '—'}</td></tr>
        <tr><td>Status</td><td class="${cm.status === 'kia' ? 'red' : ''}">${status}</td></tr>
      </table>
    </div>
    <div class="pf-main">
      <section><h3>Biography</h3><p>${esc(cm.bio)}</p><div class="chips">${cm.personality.map((p) => `<span class="chip">${esc(p)}</span>`).join('')}</div></section>
      <section><h3>Special ability — ${esc(cm.abilityName)}</h3><ul>${cm.abilityText.map((t) => `<li>${esc(t)}</li>`).join('')}</ul></section>
      <section><h3>Career</h3>
        <div class="stats">
          <div><small>XP</small><b>${cm.xp}</b></div><div><small>Missions</small><b>${cm.missionsCompleted}</b></div>
          <div><small>Enemy tanks destroyed</small><b>${cm.tankKills}</b></div><div><small>Positions destroyed</small><b>${cm.positionsDestroyed}</b></div>
          <div><small>Infantry</small><b>${cm.infantryKills}</b></div>
        </div>
        ${next && cm.status !== 'kia' ? `<div class="muted">Next rank: ${next.name} — ${cm.xp}/${next.xp} XP, ${cm.missionsCompleted}/${next.missions} missions${next.needsLeadership ? ', command experience required' : ''}${cm.promotionEligible ? ' · <b>ELIGIBLE</b>' : ''}</div><div class="meter"><i style="width:${pct}%"></i></div>` : ''}
        <div class="chips">${cm.achievements.length ? cm.achievements.map((a) => `<span class="chip ok">${esc(a)}</span>`).join('') : '<span class="muted">No combat achievements yet.</span>'}</div>
      </section>
      <section><h3>Decorations &amp; ribbons</h3><div class="medals"></div></section>
      <section><h3>Promotion history</h3><ul>${cm.promotionHistory.map((p) => `<li>${fmtDate(p.date)} — ${rankName(p.rankIndex)}: ${esc(p.note)}</li>`).join('')}</ul>
        <h3>Appointments</h3><ul>${cm.appointmentHistory.map((p) => `<li>${fmtDate(p.date)} — ${esc(p.appointment)}</li>`).join('')}</ul></section>
      <section><h3>Mission history</h3>${cm.missionHistory.length ? `<table class="hist"><tr><th>Date</th><th>Mission</th><th>Callsign</th><th>XP</th><th>Kills</th><th>Outcome</th></tr>${cm.missionHistory.map((m) => `<tr><td>${fmtDate(m.date)}</td><td>${esc(m.missionName)}</td><td>${m.callsign}</td><td>${m.xp}</td><td>${m.tankKills}</td><td>${esc(m.outcome)}</td></tr>`).join('')}</table>` : '<p class="muted">No missions yet.</p>'}</section>
    </div></div>`);
  body.querySelector('.pf-port')!.appendChild(portraitCanvas(cm.portrait, cm.rankIndex, cm.status === 'kia', 180));
  body.querySelector('.pf-rank span')!.appendChild(rankCanvas(cm.rankIndex, 34));
  const medals = body.querySelector('.medals')!;
  if (!cm.medals.length) medals.innerHTML = '<span class="muted">None yet.</span>';
  for (const m of cm.medals) {
    const d = MEDALS[m.medalId];
    const e = h(`<div class="medal-item"><div><b>${d.name}</b>${m.posthumous ? ' <i>(posthumous)</i>' : ''}<div class="muted">${fmtDate(m.date)} — ${esc(m.citation)}</div></div></div>`);
    e.prepend(medalCanvas(d, 44));
    medals.appendChild(e);
  }
  return screen(cm.status === 'kia' ? 'SERVICE RECORD — IN MEMORIAM' : 'SERVICE RECORD', cm.status === 'kia' ? 'honour' : 'personnel', body, host);
}

// ------------------------------------------------------------------------------- roll of honour

export function rollOfHonour(host: ScreenHost): HTMLElement {
  const c = host.campaign;
  const ids = c?.rollOfHonour ?? [];
  const body = h(`<div class="honour"><div class="hon-head"><div class="emb"></div><p>In proud memory of the men of Vanguard 1 Platoon, 3rd Armoured Regiment, who gave their lives in the service of the Republic of Alderland.</p></div><div class="hon-list"></div></div>`);
  body.querySelector('.emb')!.appendChild(emblem(64));
  const list = body.querySelector('.hon-list')!;
  if (!ids.length) list.innerHTML = '<p class="muted center">No names have been inscribed. May it remain so.</p>';
  for (const id of ids) {
    const cm = c!.commanders[id];
    const k = cm.kia!;
    const tank = c!.tanks[k.tankId];
    const e = h(`<div class="hon-entry"><div class="hp"></div><div>
      <h3>${rankName(k.rankAtDeath)} ${fullName(cm)}</h3>
      <div class="muted">${cm.serviceNumber} · Age ${cm.age}</div>
      <div>Killed in action, ${esc(k.missionName)} — ${fmtDate(k.date)}</div>
      <div class="muted">${k.callsign} · ${tank ? `A-44 Sentinel, turret ${tank.turretNumber} (${tank.serial})` : ''}</div>
      <div class="muted">${cm.missionsCompleted} mission(s) · ${cm.tankKills} enemy tanks destroyed · ${cm.xp} XP</div>
      <div class="hon-medals"></div></div></div>`);
    e.querySelector('.hp')!.appendChild(portraitCanvas(cm.portrait, k.rankAtDeath, true, 96));
    for (const m of cm.medals) e.querySelector('.hon-medals')!.appendChild(medalCanvas(MEDALS[m.medalId], 30));
    e.addEventListener('click', () => host.show('profile', cm.id));
    list.appendChild(e);
  }
  return screen('ROLL OF HONOUR', host.campaign ? 'staging' : 'menu', body, host, 'sombre');
}

// ------------------------------------------------------------------------------- decorations

export function decorations(host: ScreenHost): HTMLElement {
  const c = host.campaign;
  const body = h('<div class="decorations"></div>');
  for (const d of Object.values(MEDALS).sort((a, b) => b.tier - a.tier)) {
    const holders = c ? Object.values(c.commanders).filter((cm) => cm.medals.some((m) => m.medalId === d.id)) : [];
    const e = h(`<div class="dec"><div class="dimg"></div><div><h3>${d.name}</h3><div class="muted">${d.kind === 'ribbon' ? 'Campaign ribbon' : 'Decoration'}</div>
      <p>${esc(d.description)}</p><p><b>Criteria:</b> ${esc(d.criteria)}</p>
      <div class="muted">Recipients: ${holders.length ? holders.map((h2) => `${rankAbbr(h2.rankIndex)} ${fullName(h2)}${h2.status === 'kia' ? ' †' : ''}`).join(', ') : 'none yet'}</div></div></div>`);
    e.querySelector('.dimg')!.appendChild(medalCanvas(d, 60));
    body.appendChild(e);
  }
  return screen('DECORATIONS', host.campaign ? 'staging' : 'menu', body, host);
}

// ------------------------------------------------------------------------------- settings

export function settingsScreen(host: ScreenHost): HTMLElement {
  const s = { ...host.settings };
  const row = (label: string, ctl: string) => `<label class="set-row"><span>${label}</span>${ctl}</label>`;
  const sel = (k: string, opts: [string, string][]) => `<select data-k="${k}">${opts.map(([v, l]) => `<option value="${v}" ${String((s as any)[k]) === v ? 'selected' : ''}>${l}</option>`).join('')}</select>`;
  const rng = (k: string, min: number, max: number, step: number) => `<input type="range" data-k="${k}" min="${min}" max="${max}" step="${step}" value="${(s as any)[k]}"><output>${(s as any)[k]}</output>`;
  const chk = (k: string) => `<input type="checkbox" data-k="${k}" ${(s as any)[k] ? 'checked' : ''}>`;
  const body = h(`<div class="settings">
    <section><h3>Graphics</h3>
      ${row('Quality preset', sel('graphics', [['low', 'Low (older phones)'], ['medium', 'Medium'], ['high', 'High (shadows)']]))}
      ${row('Frame-rate cap', sel('fpsCap', [['30', '30 FPS (battery saver)'], ['60', '60 FPS'], ['0', 'Uncapped']]))}
      ${row('Interface scale', rng('uiScale', 0.75, 1.4, 0.05))}
    </section>
    <section><h3>Controls</h3>
      ${row('Control scheme', sel('controls', [['auto', 'Automatic'], ['touch', 'Touchscreen'], ['desktop', 'Keyboard & mouse']]))}
      ${row('Camera sensitivity', rng('lookSensitivity', 0.3, 2.5, 0.1))}
      ${row('Gunner\'s sight sensitivity', rng('aimSensitivity', 0.3, 2.5, 0.1))}
      ${row('Joystick sensitivity', rng('joystickSensitivity', 0.6, 1.6, 0.05))}
      ${row('Invert vertical look', chk('invertY'))}
      ${row('Aim assistance (subtle)', chk('aimAssist'))}
      ${row('Slow time while giving orders', chk('slowOnOrders'))}
      ${row('Training hints', chk('tutorialHints'))}
    </section>
    <section><h3>Audio</h3>${row('Volume', rng('volume', 0, 1, 0.05))}</section>
    <section><h3>Save management</h3>
      <div class="muted">Campaign saves are stored in this browser. Export a backup to move it to another device.</div>
      <div class="btn-row"><button class="btn" data-a="export">EXPORT SAVE</button><button class="btn" data-a="import">IMPORT SAVE</button><button class="btn danger" data-a="wipe">DELETE CAMPAIGN</button></div>
      <input type="file" accept="application/json" class="hidden-file" style="display:none">
    </section>
    <div class="btn-row"><button class="btn big primary" data-a="save">SAVE SETTINGS</button></div>
  </div>`);
  body.querySelectorAll<HTMLInputElement | HTMLSelectElement>('[data-k]').forEach((inp) => {
    inp.addEventListener('input', () => {
      const k = inp.dataset.k!;
      let v: any = inp.value;
      if (inp instanceof HTMLInputElement && inp.type === 'checkbox') v = inp.checked;
      else if (inp instanceof HTMLInputElement && inp.type === 'range') {
        v = parseFloat(inp.value);
        (inp.nextElementSibling as HTMLOutputElement).value = String(v);
      } else if (k === 'fpsCap') v = parseInt(v);
      (s as any)[k] = v;
    });
  });
  const file = body.querySelector('.hidden-file') as HTMLInputElement;
  file.addEventListener('change', async () => {
    const f = file.files?.[0];
    if (!f) return;
    const ok = host.importSave(await f.text());
    alert(ok ? 'Campaign imported.' : 'That file is not a valid Iron Vanguard save.');
  });
  body.querySelectorAll<HTMLElement>('[data-a]').forEach((b) =>
    b.addEventListener('click', () => {
      const a = b.dataset.a;
      if (a === 'save') {
        host.saveSettings(s);
        host.show('menu');
      } else if (a === 'wipe') {
        if (confirm('Delete the campaign permanently? This cannot be undone.')) {
          host.wipeCampaign();
          host.show('menu');
        }
      } else if (a === 'export') {
        const json = host.exportSave();
        if (!json) return alert('No campaign to export.');
        const blob = new Blob([json], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = 'iron-vanguard-save.json';
        link.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      } else if (a === 'import') file.click();
    }),
  );
  return screen('SETTINGS', 'menu', body, host);
}
