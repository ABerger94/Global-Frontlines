import type { StrategySim, BattleContext, LogKind, Army } from './sim';
import { ARMY_COST, FACTORY_COST, FORT_COST } from './sim';
import type { GlobeScene } from './globeScene';
import { TERRAIN_INFO, type Province } from './world';
import type { NationDef, RoleId, KitId, TechDef } from '../data/types';
import { KIT_INFO, ROLE_INFO } from '../data/eras';
import { WEAPONS } from '../data/weapons';
import { fmtNum } from '../core/math';
import { audio } from '../audio/audio';
import { device } from '../core/device';
import { DIFFICULTIES, DEFAULT_DIFFICULTY } from '../battle/difficulty';

export interface StrategyUICallbacks {
  onMenu: () => void;
  onAutoResolve: (ctx: BattleContext) => void;
  onTakeCommand: (ctx: BattleContext, role: RoleId, kit: KitId, difficulty: string) => void;
}

export function flagStyle(n: NationDef | undefined | null): string {
  if (!n) return 'background: linear-gradient(135deg,#8a8a80,#5a5a55)';
  const hex = (c: number) => '#' + c.toString(16).padStart(6, '0');
  const colors = n.flag?.colors?.length ? n.flag.colors : [n.color, 0xffffff, n.color];
  const step = 100 / colors.length;
  const stops = colors.map((c, i) => `${hex(c)} ${(i * step).toFixed(1)}% ${((i + 1) * step).toFixed(1)}%`).join(', ');
  return `background: linear-gradient(${n.flag?.dir === 'v' ? '90deg' : '180deg'}, ${stops})`;
}

type Tab = 'research' | 'production' | 'diplomacy' | 'armies' | null;

export class StrategyUI {
  readonly root: HTMLElement;
  private topbar: HTMLElement;
  private provincePanel: HTMLElement;
  private sidePanel: HTMLElement;
  private logEl: HTMLElement;
  private hint: HTMLElement;
  private modalHost: HTMLElement;
  selectedProvince: number | null = null;
  selectedArmy: number | null = null;
  moveMode = false;
  activeTab: Tab = null;
  speed = 1;
  private lastHover: number | null = null;
  private unsub: (() => void)[] = [];
  private logEntries: { msg: string; kind: LogKind; date: string; count: number }[] = [];
  private logCollapsed = false;
  private logUnread = 0;
  private toastHost: HTMLElement;
  private pendingRefresh: number | null = null;

  constructor(readonly host: HTMLElement, readonly sim: StrategySim, readonly globe: GlobeScene, readonly cb: StrategyUICallbacks) {
    this.root = document.createElement('div');
    this.root.className = 'strat';
    host.appendChild(this.root);
    this.topbar = document.createElement('div');
    this.topbar.className = 'topbar';
    this.provincePanel = document.createElement('div');
    this.provincePanel.className = 'panel province-panel';
    this.provincePanel.style.display = 'none';
    this.sidePanel = document.createElement('div');
    this.sidePanel.className = 'panel side-panel';
    this.sidePanel.style.display = 'none';
    this.logEl = document.createElement('div');
    this.logEl.className = 'log';
    try {
      const stored = localStorage.getItem('gf.logCollapsed');
      // on a phone the log would cover the map, so it starts folded away
      this.logCollapsed = stored === null ? device.narrow : stored === '1';
    } catch {
      this.logCollapsed = device.narrow;
    }
    this.toastHost = document.createElement('div');
    this.toastHost.className = 'toasts';
    this.hint = document.createElement('div');
    this.hint.className = 'bottom-hint';
    this.hint.textContent = 'Drag to rotate · Scroll to zoom · Click a province to inspect it · Space to pause';
    this.modalHost = document.createElement('div');
    this.root.append(this.topbar, this.provincePanel, this.sidePanel, this.logEl, this.toastHost, this.hint, this.modalHost);
    this.renderLog();
    this.unsub.push(sim.events.on('log', (m, k) => this.log(m, k)));
    this.unsub.push(sim.events.on('dirty', () => this.scheduleRefresh()));
    this.unsub.push(sim.events.on('day', () => this.renderTopbar()));
    this.root.addEventListener('click', (e) => this.onClick(e));
    this.root.addEventListener('input', (e) => this.onInput(e));
    this.refresh();
    this.log(`${sim.player.def.name} enters the ${sim.era.name} campaign. ${sim.dateString()}.`, 'info');
    const wars = [...sim.player.wars].map((w) => sim.nations.get(w)!.def.name);
    if (wars.length) this.log(`At war with ${wars.join(', ')}.`, 'war');
    else this.log('At peace. Build your strength, forge alliances, or strike first.', 'info');
  }

  setSpeed(s: number) {
    this.speed = s;
    this.renderTopbar();
  }

  // ---------------------------------------------------------------- rendering
  /** Coalesce simulation-driven redraws; user actions still refresh immediately. */
  private scheduleRefresh() {
    if (this.pendingRefresh !== null) return;
    this.pendingRefresh = window.setTimeout(() => {
      this.pendingRefresh = null;
      this.refresh();
    }, 220);
  }

  /**
   * Replace a panel's markup while keeping the reader where they were.
   * Rebuilding innerHTML resets scrollTop, which is why these panels used to
   * jump back to the top whenever the simulation ticked.
   */
  private renderInto(panel: HTMLElement, html: string, identity: string) {
    const body = panel.querySelector('.body') as HTMLElement | null;
    const same = panel.dataset.identity === identity;
    // never yank a slider out from under the mouse
    if (same && panel.contains(document.activeElement) && (document.activeElement as HTMLElement)?.tagName === 'INPUT') return;
    const scroll = same && body ? body.scrollTop : 0;
    panel.innerHTML = html;
    panel.dataset.identity = identity;
    const next = panel.querySelector('.body') as HTMLElement | null;
    if (next && scroll) next.scrollTop = scroll;
  }

  refresh() {
    this.renderTopbar();
    this.renderProvince();
    this.renderSide();
  }

  private renderTopbar() {
    const n = this.sim.player;
    const s = this.sim.supplyState(n);
    const cls = (v: number, warn: number, bad: number) => (v <= bad ? 'bad' : v <= warn ? 'warn' : '');
    const researching = n.researching ? this.sim.era.techs.find((t) => t.id === n.researching)! : null;
    this.topbar.innerHTML = `
      <div class="nation"><div class="flag" style="${flagStyle(n.def)}"></div><b>${n.def.name}</b></div>
      <div class="res">
        <div class="r ${cls(n.steel, 150, 40)}" title="Steel — construction and raising armies"><small>Steel</small><b>${fmtNum(n.steel)}</b></div>
        <div class="r ${cls(s.ammo, 0.5, 0.2)}" title="Munitions stockpile vs. army needs. Low munitions = fewer magazines in battle."><small>Munitions</small><b>${fmtNum(n.munitions)}<i>${Math.round(s.ammo * 100)}%</i></b></div>
        <div class="r ${cls(n.equipment, 80, 20)}" title="Equipment stock — armies draw from it to stay at full quality"><small>Equipment</small><b>${fmtNum(n.equipment)}</b></div>
        <div class="r ${cls(n.oil, 40, 10)}" title="Oil — movement, armour and air operations"><small>Oil</small><b>${fmtNum(n.oil)}</b></div>
        <div class="r" title="Manpower available for new armies and reinforcements"><small>Manpower</small><b>${fmtNum(n.manpower)}</b></div>
        <div class="r" title="Research points"><small>Research</small><b>${fmtNum(n.research)}${researching ? `<i>${Math.round((n.researchProgress / researching.cost) * 100)}%</i>` : ''}</b></div>
        <div class="r" title="Political power — diplomacy"><small>Pol. Power</small><b>${Math.round(n.pp)}</b></div>
        <div class="r ${cls(n.stability, 45, 30)}" title="Stability — below 30% risks revolution"><small>Stability</small><b>${Math.round(n.stability)}%</b></div>
      </div>
      <div class="tabs">
        <button class="btn ${this.activeTab === 'research' ? 'on' : ''}" data-tab="research">Research</button>
        <button class="btn ${this.activeTab === 'production' ? 'on' : ''}" data-tab="production">Production</button>
        <button class="btn ${this.activeTab === 'diplomacy' ? 'on' : ''}" data-tab="diplomacy">Diplomacy</button>
        <button class="btn ${this.activeTab === 'armies' ? 'on' : ''}" data-tab="armies">Armies</button>
        <button class="btn ghost" data-act="menu">Menu</button>
      </div>
      <div class="date"><b>${this.sim.dateString()}</b><small>Day ${this.sim.day}</small></div>
      <div class="speed">${[0, 1, 2, 3].map((v) => `<button class="${this.speed === v ? 'on' : ''}" data-speed="${v}" title="${v === 0 ? 'Pause' : 'Speed ' + v}">${v === 0 ? '❚❚' : '▶'.repeat(v)}</button>`).join('')}</div>`;
  }

  private renderProvince() {
    if (this.selectedProvince === null) {
      this.provincePanel.style.display = 'none';
      this.root.classList.remove('sheet-open');
      return;
    }
    const p = this.sim.world.provinces[this.selectedProvince];
    const owner = this.sim.nations.get(p.owner ?? '')?.def;
    const ownerName = p.owner === 'minor' ? `${p.countryName ?? 'Independent'} (neutral)` : owner ? owner.name : '—';
    const player = this.sim.player;
    const mine = p.owner === player.id;
    const armies = this.sim.armiesIn(p.id);
    const moving = [...this.sim.armies.values()].filter((a) => a.path.length > 1 && a.province === p.id);
    const t = TERRAIN_INFO[p.terrain];
    let html = `<h3><span style="width:12px;height:12px;border-radius:2px;display:inline-block;${flagStyle(owner)}"></span>${p.name}${p.capitalOf ? ' ★' : ''}<span class="close" data-act="closeProvince">×</span></h3><div class="body">`;
    if (p.isLand) {
      const rel = p.owner && p.owner !== 'minor' && p.owner !== player.id ? (player.wars.has(p.owner) ? ' <span class="st war">War</span>' : player.allies.has(p.owner) ? ' <span class="st ally">Ally</span>' : '') : '';
      html += `<div class="kv">
        <span>Owner</span><b>${ownerName}${rel}</b>
        <span>Country</span><b>${p.countryName ?? '—'}${p.countryCapital ? ' (capital)' : ''}</b>
        <span>Terrain</span><b>${t.name} (def ×${t.defense.toFixed(2)})</b>
        <span>Population</span><b>${fmtNum(p.population * 1000)}</b>
        <span>Factories</span><b>${p.factories}</b>
        <span>Oil</span><b>${p.oil ? p.oil + ' wells' : '—'}</b>
        <span>Fortification</span><b>${'▮'.repeat(p.fort)}${'▯'.repeat(4 - p.fort)}</b>
        <span>Garrison</span><b>${fmtNum(p.garrison)} men</b>
      </div>`;
      if (armies.length || moving.length) {
        const all = [...armies, ...moving];
        html += `<div class="section-title">Armies present <span class="muted">${all.length}</span></div><div class="army-list">`;
        for (const a of all) html += this.armyRow(a);
        html += `</div>`;
      }
      if (mine) {
        html += `<div class="actions">
          <button class="btn small" data-act="raise" ${this.sim.canRaiseArmy(player) ? '' : 'disabled'} title="${ARMY_COST.steel} steel, ${fmtNum(ARMY_COST.manpower)} manpower, ${ARMY_COST.equipment} equipment">Raise Army</button>
          <button class="btn small" data-act="factory" ${player.steel >= FACTORY_COST ? '' : 'disabled'} title="${FACTORY_COST} steel">Build Factory</button>
          <button class="btn small" data-act="fortify" ${player.steel >= FORT_COST && p.fort < 4 ? '' : 'disabled'} title="${FORT_COST} steel">Fortify</button>
        </div>`;
      }
      if (this.moveMode && this.selectedArmy !== null) {
        const a = this.sim.armies.get(this.selectedArmy);
        html += `<div class="move-hint"><b>${a?.name}</b> selected — click a destination province on the globe. Enemy or neutral provinces will be attacked. <button class="btn small" data-act="cancelMove">Cancel</button></div>`;
      }
    } else {
      html += `<div class="kv"><span>Type</span><b>${t.name}</b><span>Transit</span><b>Armies may cross (slow)</b></div>`;
      if (moving.length) for (const a of moving) html += this.armyRow(a);
    }
    html += '</div>';
    // identity is the province alone: armies arriving or leaving must not dump the reader at the top
    this.renderInto(this.provincePanel, html, `p${p.id}`);
    this.provincePanel.style.display = '';
    this.root.classList.add('sheet-open');
  }

  private armyRow(a: Army): string {
    const n = this.sim.nations.get(a.nation)!;
    const mine = a.nation === this.sim.playerId;
    const status = a.path.length > 1 ? `→ ${this.sim.world.provinces[a.path[a.path.length - 1]].name} (${a.needed - a.progress}d)` : 'Holding';
    return `<div class="army-row ${a.id === this.selectedArmy ? 'sel' : ''}" data-army="${a.id}" ${mine ? 'data-mine="1"' : ''}>
      <span class="dot" style="background:#${n.def.color.toString(16).padStart(6, '0')}"></span>
      <span class="nm">${a.name}<small>${status} · Eq ${Math.round(a.equipment * 100)}% · Org ${Math.round(a.org * 100)}%</small></span>
      <span class="men">${fmtNum(a.men)}</span></div>`;
  }

  private renderSide() {
    if (!this.activeTab) {
      this.sidePanel.style.display = 'none';
      this.root.classList.remove('tab-open');
      return;
    }
    const n = this.sim.player;
    let html = '';
    if (this.activeTab === 'research') {
      const avail = new Set(this.sim.availableTechs(n).map((t) => t.id));
      html += `<h3>Research <span class="muted" style="font-weight:400;font-size:12px">${fmtNum(n.research)} pts stored · +${this.researchRate().toFixed(0)}/day</span><span class="close" data-act="closeTab">×</span></h3><div class="body"><div class="tech-grid">`;
      for (const branch of ['infantry', 'armor', 'industry'] as const) {
        const label = branch === 'infantry' ? 'Infantry' : branch === 'armor' ? (this.sim.era.id === 'modern' ? 'Drones & Armour' : 'Armour & Air') : 'Industry';
        html += `<div class="tech-col"><h4>${label}</h4>`;
        for (const t of this.sim.era.techs.filter((x) => x.branch === branch)) {
          const done = n.techs.has(t.id);
          const active = n.researching === t.id;
          const locked = !done && !avail.has(t.id);
          const pct = active ? Math.round((n.researchProgress / t.cost) * 100) : 0;
          html += `<div class="tech ${done ? 'done' : active ? 'active' : locked ? 'locked' : ''}" data-tech="${t.id}"><b>${t.name}</b><small>${t.desc}</small>${done ? '<small style="color:var(--good)">Researched</small>' : active ? `<div class="bar"><i style="--f:${pct}%"></i></div><small>${pct}%</small>` : `<small class="cost">${t.cost} pts</small>`}</div>`;
        }
        html += '</div>';
      }
      html += '</div></div>';
    } else if (this.activeTab === 'production') {
      const s = this.sim.supplyState(n);
      const pr = n.production;
      const factories = this.sim.provincesOf(n.id).reduce((a, p) => a + p.factories, 0);
      const out = factories * 4.2 * n.def.industry;
      const grade = (v: number) => (v >= 0.7 ? 'good' : v >= 0.35 ? 'warn' : 'bad');
      html += `<h3>Production &amp; Logistics<span class="close" data-act="closeTab">×</span></h3><div class="body">
        <p class="muted" style="margin:0 0 8px">${factories} factories · ${out.toFixed(1)} industrial output per day. Divide it between the three lines.</p>
        <div class="slider-row"><span>Munitions</span><input type="range" min="0" max="100" value="${Math.round(pr.munitions * 100)}" data-prod="munitions"><b>${Math.round(pr.munitions * 100)}%</b></div>
        <div class="slider-row"><span>Equipment</span><input type="range" min="0" max="100" value="${Math.round(pr.equipment * 100)}" data-prod="equipment"><b>${Math.round(pr.equipment * 100)}%</b></div>
        <div class="slider-row"><span>Construction steel</span><input type="range" min="0" max="100" value="${Math.round(pr.steel * 100)}" data-prod="steel"><b>${Math.round(pr.steel * 100)}%</b></div>
        <div class="stock">
          <div><small>Munitions</small><b>${fmtNum(n.munitions)}</b></div>
          <div><small>Equipment</small><b>${fmtNum(n.equipment)}</b></div>
          <div><small>Steel</small><b>${fmtNum(n.steel)}</b></div>
          <div><small>Oil</small><b>${fmtNum(n.oil)}</b></div>
        </div>
        <div class="section-title">What your soldiers will get in battle</div>
        <div class="supply-line"><span>Ammunition per soldier</span><b class="${grade(s.ammo)}">${Math.round(35 + s.ammo * 90)}% of standard load</b></div>
        <div class="supply-line"><span>Weapon jam chance</span><b class="${s.jam < 0.01 ? 'good' : s.jam < 0.03 ? 'warn' : 'bad'}">${(s.jam * 100).toFixed(1)}% per shot</b></div>
        <div class="supply-line"><span>Equipment quality</span><b class="${grade(s.equipment)}">${Math.round(s.equipment * 100)}%</b></div>
        <div class="supply-line"><span>Artillery strikes</span><b class="${s.artillery > 0 ? 'good' : 'bad'}">${s.artillery}</b></div>
        <div class="supply-line"><span>Air support calls</span><b class="${s.air > 0 ? 'good' : 'warn'}">${s.air}</b></div>
        <div class="supply-line"><span>Medkits</span><b class="good">${s.medkits}</b></div>
        <div class="supply-line"><span>Armour available</span><b class="${s.tank ? 'good' : 'warn'}">${s.tank ? 'Yes' : 'Research required'}</b></div>
        <div class="supply-line"><span>Infantry combat bonus</span><b class="good">+${Math.round(s.infantryBonus * 100)}%</b></div>
      </div>`;
    } else if (this.activeTab === 'diplomacy') {
      html += `<h3>Diplomacy <span class="muted" style="font-weight:400;font-size:12px">${Math.round(n.pp)} political power</span><span class="close" data-act="closeTab">×</span></h3><div class="body">`;
      const others = [...this.sim.nations.values()].filter((o) => o.id !== n.id);
      others.sort((x, y) => Number(y.def.playable !== false) - Number(x.def.playable !== false) || this.sim.nationPower(y.id) - this.sim.nationPower(x.id));
      for (const o of others) {
        const rel = n.relations.get(o.id) ?? 0;
        const st = !o.alive ? 'dead' : n.wars.has(o.id) ? 'war' : n.allies.has(o.id) ? 'ally' : 'peace';
        const stLabel = st === 'dead' ? 'Capitulated' : st === 'war' ? 'At war' : st === 'ally' ? 'Allied' : 'Peace';
        html += `<div class="dip-row"><div class="flag" style="${flagStyle(o.def)}"></div><div class="nm">${o.def.name}<small>${this.sim.provincesOf(o.id).length} provinces · ${fmtNum(this.sim.nationPower(o.id))} strength · ${o.def.personality}</small></div>
          <span class="rel" style="color:${rel < -30 ? '#ff8a7a' : rel > 30 ? '#8ee59a' : 'inherit'}">${rel > 0 ? '+' : ''}${Math.round(rel)}</span><span class="st ${st}">${stLabel}</span>`;
        if (o.alive) {
          html += `<div style="display:flex;gap:4px">`;
          if (st === 'war') html += `<button class="btn small" data-dip="peace" data-n="${o.id}" ${n.pp >= 30 ? '' : 'disabled'} title="30 PP">Truce</button>`;
          else {
            html += `<button class="btn small" data-dip="improve" data-n="${o.id}" ${n.pp >= 15 ? '' : 'disabled'} title="15 PP">Improve</button>`;
            if (st !== 'ally') html += `<button class="btn small" data-dip="ally" data-n="${o.id}" ${n.pp >= 40 ? '' : 'disabled'} title="40 PP — accepted at +50 relations or +20 with a shared enemy">Alliance</button><button class="btn small danger" data-dip="war" data-n="${o.id}" ${n.pp >= 50 ? '' : 'disabled'} title="50 PP, −8 stability">War</button>`;
          }
          html += `</div>`;
        }
        html += `</div>`;
      }
      html += `<p class="muted" style="font-size:12px">Independent countries (muted colours, no listed government) can be invaded without a declaration at a cost of 3 stability per province.</p></div>`;
    } else if (this.activeTab === 'armies') {
      const armies = this.sim.armiesOf(n.id);
      html += `<h3>Armies <span class="muted" style="font-weight:400;font-size:12px">${armies.length} field armies · ${fmtNum(armies.reduce((s, a) => s + a.men, 0))} men</span><span class="close" data-act="closeTab">×</span></h3><div class="body">`;
      if (!armies.length) html += '<p class="muted">No field armies. Raise one from a province you own.</p>';
      for (const a of armies) {
        const loc = this.sim.world.provinces[a.province].name;
        html += `<div class="army-row ${a.id === this.selectedArmy ? 'sel' : ''}" data-army="${a.id}" data-mine="1" data-focus="1"><span class="dot" style="background:#${n.def.color.toString(16).padStart(6, '0')}"></span><span class="nm">${a.name}<small>${loc} · ${a.path.length > 1 ? 'Moving → ' + this.sim.world.provinces[a.path[a.path.length - 1]].name : 'Holding'} · Eq ${Math.round(a.equipment * 100)}% · Org ${Math.round(a.org * 100)}%</small></span><span class="men">${fmtNum(a.men)}</span></div>`;
      }
      html += '</div>';
    }
    this.renderInto(this.sidePanel, html, this.activeTab ?? '');
    this.sidePanel.style.display = '';
    this.root.classList.add('tab-open');
  }

  private researchRate(): number {
    const n = this.sim.player;
    const e = this.sim.techEffects(n);
    let r = 0;
    for (const p of this.sim.provincesOf(n.id)) r += (p.terrain === 'urban' ? 3 : 0.6) + p.factories * 0.4;
    return r * (1 + e.research);
  }

  // ---------------------------------------------------------------- input
  private onClick(e: Event) {
    const el = (e.target as HTMLElement).closest('[data-act],[data-tab],[data-speed],[data-army],[data-tech],[data-dip]') as HTMLElement | null;
    if (!el) return;
    audio.click();
    const sim = this.sim;
    const pid = this.selectedProvince;
    if (el.dataset.speed !== undefined) {
      this.setSpeed(Number(el.dataset.speed));
      return;
    }
    if (el.dataset.tab) {
      const t = el.dataset.tab as Tab;
      this.activeTab = this.activeTab === t ? null : t;
      this.refresh();
      return;
    }
    if (el.dataset.tech) {
      sim.setResearch(sim.playerId, el.dataset.tech);
      this.refresh();
      return;
    }
    if (el.dataset.dip) {
      const target = el.dataset.n!;
      if (el.dataset.dip === 'improve') sim.improveRelations(sim.playerId, target);
      else if (el.dataset.dip === 'ally') sim.proposeAlliance(sim.playerId, target);
      else if (el.dataset.dip === 'war') sim.declareWar(sim.playerId, target);
      else if (el.dataset.dip === 'peace') sim.offerPeace(sim.playerId, target);
      this.refresh();
      return;
    }
    if (el.dataset.army) {
      const id = Number(el.dataset.army);
      const a = sim.armies.get(id);
      if (!a) return;
      if (el.dataset.mine) {
        this.selectedArmy = this.selectedArmy === id ? null : id;
        this.moveMode = this.selectedArmy !== null;
        this.globe.selectedArmy = this.selectedArmy;
        if (el.dataset.focus) {
          this.selectedProvince = a.province;
          this.globe.selectedProvince = a.province;
          this.globe.focusProvince(a.province, this.globe.camera.position.length());
          this.globe.markDirty();
        }
      }
      this.refresh();
      return;
    }
    switch (el.dataset.act) {
      case 'toggleLog':
        this.toggleLog();
        break;
      case 'menu':
        this.cb.onMenu();
        break;
      case 'closeProvince':
        this.selectProvince(null);
        break;
      case 'closeTab':
        this.activeTab = null;
        this.renderSide();
        this.renderTopbar();
        break;
      case 'raise':
        if (pid !== null) sim.raiseArmy(sim.playerId, pid);
        break;
      case 'factory':
        if (pid !== null) sim.buildFactory(sim.playerId, pid);
        break;
      case 'fortify':
        if (pid !== null) sim.fortify(sim.playerId, pid);
        break;
      case 'cancelMove':
        this.moveMode = false;
        this.selectedArmy = null;
        this.globe.selectedArmy = null;
        this.refresh();
        break;
    }
  }

  private onInput(e: Event) {
    const el = e.target as HTMLInputElement;
    if (!el.dataset.prod) return;
    const key = el.dataset.prod as 'munitions' | 'equipment' | 'steel';
    const v = Number(el.value) / 100;
    const pr = this.sim.player.production;
    const others = (['munitions', 'equipment', 'steel'] as const).filter((k) => k !== key);
    const rest = 1 - v;
    const oSum = pr[others[0]] + pr[others[1]];
    if (oSum > 0) {
      pr[others[0]] = (pr[others[0]] / oSum) * rest;
      pr[others[1]] = (pr[others[1]] / oSum) * rest;
    } else {
      pr[others[0]] = rest / 2;
      pr[others[1]] = rest / 2;
    }
    pr[key] = v;
    // update labels without rebuilding sliders
    this.sidePanel.querySelectorAll<HTMLInputElement>('input[data-prod]').forEach((inp) => {
      const k = inp.dataset.prod as keyof typeof pr;
      inp.value = String(Math.round(pr[k] * 100));
      (inp.nextElementSibling as HTMLElement).textContent = Math.round(pr[k] * 100) + '%';
    });
  }

  selectProvince(id: number | null) {
    this.selectedProvince = id;
    this.globe.selectedProvince = id;
    if (id === null) {
      this.moveMode = false;
      this.selectedArmy = null;
      this.globe.selectedArmy = null;
    }
    this.globe.markDirty();
    this.renderProvince();
  }

  /** Globe click: either issue a move order or select. */
  handleGlobeClick(p: Province | null) {
    if (!p) {
      this.selectProvince(null);
      return;
    }
    if (this.moveMode && this.selectedArmy !== null) {
      const a = this.sim.armies.get(this.selectedArmy);
      if (a && p.id !== a.province) {
        if (this.sim.moveArmy(a.id, p.id)) {
          this.log(`${a.name} ordered to ${p.name}.`, 'info');
          this.moveMode = false;
          this.selectedArmy = null;
          this.globe.selectedArmy = null;
          this.selectProvince(a.province);
          return;
        }
        this.log(`${a.name} cannot reach ${p.name}. Land routes must pass through friendly territory or the sea.`, 'bad');
        return;
      }
    }
    this.selectProvince(p.id);
    audio.click(0.7);
  }

  handleGlobeHover(p: Province | null) {
    const id = p && p.isLand ? p.id : null;
    if (id === this.lastHover) return;
    this.lastHover = id;
    this.globe.hoveredProvince = id;
    this.globe.markDirty();
  }

  log(msg: string, kind: LogKind = 'info') {
    const last = this.logEntries[this.logEntries.length - 1];
    if (last && last.msg === msg) {
      // a stalled front repeats the same report for days; collapse it into one row
      last.count++;
      last.date = this.sim.dateString();
      this.renderLog();
      return;
    }
    this.logEntries.push({ msg, kind, date: this.sim.dateString(), count: 1 });
    if (this.logEntries.length > 80) this.logEntries.shift();
    if (this.logCollapsed) this.logUnread++;
    this.renderLog();
    if (this.isImportant(msg, kind)) this.toast(msg, kind);
  }

  /** Banners are for the player's own war, not for every skirmish on Earth. */
  private isImportant(msg: string, kind: LogKind): boolean {
    if (kind === 'bad') return true;
    const me = this.sim.player.def;
    const mine = msg.includes(me.name) || msg.includes(me.adjective);
    if (mine && (kind === 'war' || kind === 'good')) return true;
    return this.sim.era.politics.events.some((e) => msg.startsWith(e.title));
  }

  private toast(msg: string, kind: LogKind) {
    const el = document.createElement('div');
    el.className = 'toast ' + kind;
    el.textContent = msg;
    this.toastHost.appendChild(el);
    while (this.toastHost.children.length > 2) this.toastHost.firstElementChild!.remove();
    setTimeout(() => el.classList.add('out'), 4200);
    setTimeout(() => el.remove(), 4800);
  }

  private renderLog() {
    const body = this.logEl.querySelector('.log-body') as HTMLElement | null;
    // keep following new entries only when the reader is already at the bottom
    const atBottom = !body || body.scrollHeight - body.scrollTop - body.clientHeight < 24;
    const scroll = body ? body.scrollTop : 0;
    const rows = this.logEntries
      .slice(-60)
      .map((e) => `<div class="entry ${e.kind}"><small>${e.date}</small>${e.msg}${e.count > 1 ? `<i class="rep">×${e.count}</i>` : ''}</div>`)
      .join('');
    this.logEl.className = 'log' + (this.logCollapsed ? ' collapsed' : '');
    this.root.classList.toggle('log-collapsed', this.logCollapsed);
    this.logEl.innerHTML = `<div class="log-head" data-act="toggleLog"><b>War Log</b>${this.logUnread ? `<span class="badge">${this.logUnread}</span>` : ''}<span class="chev">${this.logCollapsed ? '▴' : '▾'}</span></div><div class="log-body">${rows || '<div class="entry muted">No reports yet.</div>'}</div>`;
    if (!this.logCollapsed) {
      const nb = this.logEl.querySelector('.log-body') as HTMLElement;
      nb.scrollTop = atBottom ? nb.scrollHeight : scroll;
    }
  }

  private toggleLog() {
    this.logCollapsed = !this.logCollapsed;
    if (!this.logCollapsed) this.logUnread = 0;
    try {
      localStorage.setItem('gf.logCollapsed', this.logCollapsed ? '1' : '0');
    } catch {
      /* private browsing */
    }
    this.renderLog();
  }

  // ---------------------------------------------------------------- battle prompt
  showBattlePrompt(ctx: BattleContext) {
    const sim = this.sim;
    let savedDifficulty = DEFAULT_DIFFICULTY;
    try {
      savedDifficulty = localStorage.getItem('gf.difficulty') ?? DEFAULT_DIFFICULTY;
    } catch {
      /* private browsing */
    }
    const p = sim.world.provinces[ctx.provinceId];
    const atk = sim.nations.get(ctx.attacker)!;
    const def = sim.nations.get(ctx.defender);
    const playerIsAttacker = ctx.attacker === sim.playerId;
    const me = sim.player;
    const s = sim.supplyState(me);
    const odds = ctx.attackerPower / Math.max(1, ctx.attackerPower + ctx.defenderPower);
    const myOdds = playerIsAttacker ? odds : 1 - odds;
    const t = TERRAIN_INFO[p.terrain];
    const modRows: [string, string, string][] = [
      ['Ammunition', `${Math.round(35 + s.ammo * 90)}% load`, s.ammo > 0.6 ? 'good' : s.ammo > 0.3 ? 'warn' : 'bad'],
      ['Weapon reliability', `${(s.jam * 100).toFixed(1)}% jam`, s.jam < 0.01 ? 'good' : s.jam < 0.03 ? 'warn' : 'bad'],
      ['Artillery', `${s.artillery} strikes`, s.artillery ? 'good' : 'bad'],
      ['Air support', `${s.air} calls`, s.air ? 'good' : 'warn'],
      ['Medkits', `${s.medkits}`, 'good'],
      ['Terrain', `${t.name} ×${t.defense.toFixed(2)} def`, playerIsAttacker ? (t.defense > 1.2 ? 'bad' : 'warn') : t.defense > 1.2 ? 'good' : 'warn'],
      ['Fortification', `Level ${p.fort}`, playerIsAttacker ? (p.fort ? 'bad' : 'good') : p.fort ? 'good' : 'warn'],
      ['Armour', s.tank ? 'Available' : 'None', s.tank ? 'good' : 'warn'],
    ];
    const side = (n: typeof atk | undefined, men: number, power: number, label: string) => `<div class="side"><div class="flag" style="${flagStyle(n?.def)}"></div><b>${n ? n.def.name : (p.countryName ?? 'Local') + ' militia'}</b><span class="muted">${label}</span><div class="kv"><span>Men</span><b>${fmtNum(men)}</b><span>Combat power</span><b>${fmtNum(power)}</b></div></div>`;
    const host = this.modalHost;
    host.innerHTML = `<div class="modal-bg"><div class="modal">
      <div class="head"><small>Conflict zone</small><h2>Battle of ${p.name}</h2><p>${atk.def.name} ${playerIsAttacker ? '(you)' : ''} assaults ${p.name}, held by ${def ? def.def.name + (!playerIsAttacker ? ' (you)' : '') : 'the ' + (p.countryName ?? 'local') + ' garrison'}. ${t.name} terrain${p.fort ? `, fortification level ${p.fort}` : ''}.</p></div>
      <div class="content">
        <div class="vs">${side(atk, ctx.attackerMen, ctx.attackerPower, 'Attacker')}<div class="mid">VS</div>${side(def, ctx.defenderMen, ctx.defenderPower, 'Defender')}</div>
        <div class="odds"><div class="bar"><i style="--f:${(myOdds * 100).toFixed(0)}%"></i></div><div class="lbl"><span>Your estimated odds: <b style="color:${myOdds > 0.55 ? '#8ee59a' : myOdds > 0.4 ? '#e8b84a' : '#ff8a7a'}">${Math.round(myOdds * 100)}%</b></span><span>Auto-resolve uses these numbers. Taking command lets you beat them.</span></div></div>
        <div class="section-title">Your supply situation (feeds directly into the battlefield)</div>
        <div class="mods">${modRows.map(([k, v, c]) => `<div><span>${k}</span><b class="${c}">${v}</b></div>`).join('')}</div>
        <div id="deploy" style="display:none">
          <div class="section-title">Choose your role</div>
          <div class="roles">${(['commander', 'squadleader', 'soldier'] as RoleId[]).map((r) => `<div class="choice ${r === 'soldier' ? 'on' : ''}" data-role="${r}"><b>${ROLE_INFO[r].name}</b><small>${ROLE_INFO[r].desc}</small></div>`).join('')}</div>
          <div class="section-title">Combat difficulty</div>
          <div class="roles diff">${DIFFICULTIES.map((d) => `<div class="choice ${d.id === savedDifficulty ? 'on' : ''}" data-diff="${d.id}"><b>${d.name}</b><small>${d.desc}</small></div>`).join('')}</div>
          <div class="section-title">Choose your kit</div>
          <div class="kits">${sim.era.kits.map((k) => {
            const unlocked = s.kits.includes(k);
            const lock = sim.era.kitLocks[k];
            const lockName = lock ? sim.era.techs.find((x) => x.id === lock)?.name : '';
            const w = me.def.weapons;
            const wid = k === 'mg' ? w.lmg : k === 'smg' ? w.smg ?? 'mp18' : k === 'marksman' ? w.dmr ?? w.rifle : k === 'tank' ? '' : w.rifle;
            const wname = k === 'tank' ? me.def.tankName : WEAPONS[wid]?.name ?? '';
            return `<div class="choice ${k === 'rifleman' ? 'on' : ''} ${unlocked ? '' : 'locked'}" data-kit="${k}" ${unlocked ? '' : `title="Requires ${lockName}"`}><b>${KIT_INFO[k].name}</b><small>${KIT_INFO[k].desc}</small><span class="wp">${unlocked ? wname : 'Locked — ' + lockName}</span></div>`;
          }).join('')}</div>
        </div>
      </div>
      <div class="foot"><span class="muted" style="margin-right:auto;font-size:12px">Time keeps passing on the map while you fight — reinforcements can arrive mid-battle.</span>
        <button class="btn" data-battle="auto">Auto-Resolve</button>
        <button class="btn primary big" data-battle="command">Take Command</button>
        <button class="btn primary big" data-battle="deploy" style="display:none">Deploy</button></div>
    </div></div>`;
    let role: RoleId = 'soldier';
    let kit: KitId = 'rifleman';
    let difficulty = savedDifficulty;
    host.querySelector('.modal')!.addEventListener('click', (e) => {
      const el = (e.target as HTMLElement).closest('[data-battle],[data-role],[data-kit],[data-diff]') as HTMLElement | null;
      if (!el) return;
      audio.click();
      if (el.dataset.diff) {
        difficulty = el.dataset.diff;
        try {
          localStorage.setItem('gf.difficulty', difficulty);
        } catch {
          /* private browsing */
        }
        host.querySelectorAll('[data-diff]').forEach((x) => x.classList.toggle('on', x === el));
      } else if (el.dataset.role) {
        role = el.dataset.role as RoleId;
        host.querySelectorAll('[data-role]').forEach((x) => x.classList.toggle('on', x === el));
      } else if (el.dataset.kit) {
        if (el.classList.contains('locked')) return;
        kit = el.dataset.kit as KitId;
        host.querySelectorAll('[data-kit]').forEach((x) => x.classList.toggle('on', x === el));
      } else if (el.dataset.battle === 'auto') {
        host.innerHTML = '';
        this.cb.onAutoResolve(ctx);
      } else if (el.dataset.battle === 'command') {
        (host.querySelector('#deploy') as HTMLElement).style.display = '';
        (host.querySelector('[data-battle=command]') as HTMLElement).style.display = 'none';
        (host.querySelector('[data-battle=deploy]') as HTMLElement).style.display = '';
      } else if (el.dataset.battle === 'deploy') {
        host.innerHTML = '';
        this.cb.onTakeCommand(ctx, role, kit, difficulty);
      }
    });
  }

  showGameOver(won: boolean, reason: string, onMenu: () => void) {
    const n = this.sim.player;
    const el = document.createElement('div');
    el.className = 'gameover ' + (won ? 'win' : 'loss');
    el.innerHTML = `<div class="gameover-box"><h1>${won ? 'Victory' : 'Defeat'}</h1><p>${reason}</p><p class="muted">${n.def.name} · ${this.sim.dateString()} · ${this.sim.provincesOf(n.id).length} provinces · ${fmtNum(n.kills)} enemy casualties inflicted · ${fmtNum(n.casualties)} suffered</p><button class="btn primary big">Return to Main Menu</button></div>`;
    el.querySelector('button')!.addEventListener('click', onMenu);
    this.modalHost.appendChild(el);
  }

  setVisible(v: boolean) {
    this.root.style.display = v ? '' : 'none';
  }

  dispose() {
    for (const u of this.unsub) u();
    this.root.remove();
  }
}

export type { TechDef };
