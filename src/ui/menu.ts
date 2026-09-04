import { ERAS } from '../data/eras';
import type { EraDef, NationDef } from '../data/types';
import { flagStyle } from '../strategy/strategyUI';
import { audio } from '../audio/audio';

export class Menu {
  readonly root: HTMLElement;
  private era: EraDef | null = null;
  private nation: NationDef | null = null;

  constructor(readonly host: HTMLElement, readonly onStart: (era: EraDef, nation: NationDef) => void) {
    this.root = document.createElement('div');
    host.appendChild(this.root);
    this.root.addEventListener('click', () => audio.unlock(), { once: true });
    this.showMain();
  }

  show() {
    this.root.style.display = '';
    this.showMain();
  }
  hide() {
    this.root.style.display = 'none';
  }

  private showMain() {
    this.root.innerHTML = `<div class="menu">
      <div class="menu-title"><h1>Global Frontlines<br><span>Theater of War</span></h1><p>Grand strategy · First-person warfare</p></div>
      <div class="menu-body">
        <div class="menu-main">
          <button class="btn" data-act="new">New Campaign</button>
          <button class="btn" data-act="how">How to Play</button>
          <button class="btn" data-act="about">About</button>
        </div>
        <div class="menu-side" id="menu-side">
          <p><b>Command a nation from the globe.</b> Run the economy, research the tech tree, forge alliances and push your armies across continents.</p>
          <p><b>When armies clash, take command yourself.</b> Drop into a first-person battlefield built from the strategic situation — your munitions, equipment, artillery and air power all come from the map.</p>
          <p><b>What you do on the ground changes the map.</b> Hold the line long enough and reinforcements arrive. Break through and the province is yours.</p>
        </div>
      </div>
      <div class="menu-footer"><span>v0.1 vertical slice · procedural worlds · no downloads</span><span>Requires a mouse and keyboard · WebGL 2</span></div></div>`;
    this.root.querySelector('[data-act=new]')!.addEventListener('click', () => {
      audio.click();
      this.showEra();
    });
    this.root.querySelector('[data-act=how]')!.addEventListener('click', () => {
      audio.click();
      this.root.querySelector('#menu-side')!.innerHTML = `
        <p><b>Strategy layer.</b> Click provinces to inspect them. Select one of your armies and click a destination to move it — moving into enemy or neutral land starts a battle. Use the top-right tabs for Research, Production, Diplomacy and your army list. Space pauses; number keys 1–3 set the speed.</p>
        <p><b>Production.</b> Split factory output between Munitions (ammo in battle), Equipment (weapon quality, jam chance) and Steel (armies, factories, forts). Starve munitions and your soldiers spawn with half-empty pouches.</p>
        <p><b>Battle layer.</b> WASD to move, mouse to aim, RMB to aim down sights, R to reload or clear a jam. 5 calls artillery, 6 calls air support, Tab opens the command map where you can order squads and drop strikes. Capture A, B and C; bleed the enemy's tickets to zero.</p>`;
    });
    this.root.querySelector('[data-act=about]')!.addEventListener('click', () => {
      audio.click();
      this.root.querySelector('#menu-side')!.innerHTML = `
        <p><b>Global Frontlines: Theater of War</b> is a hybrid grand-strategy / FPS built with Three.js and TypeScript. Every world, battlefield, soldier, weapon and sound is generated procedurally at runtime.</p>
        <p>Three eras — World War I, World War II and the present day — each with their own nations, tech trees, weapons and battlefield generators. See <code>docs/GAME_DESIGN.md</code> for the full design document.</p>`;
    });
  }

  private showEra() {
    this.era = null;
    this.root.innerHTML = `<div class="setup">
      <div class="setup-head"><h2>Choose your era</h2><div class="steps"><span class="on">1 · Era</span><span>2 · Nation</span><span>3 · Deploy</span></div></div>
      <div class="setup-body"><div class="cards">${ERAS.map(
        (e) => `<div class="card" data-era="${e.id}"><div class="years">${e.years}</div><h3>${e.name}</h3><p>${e.description}</p><div class="tags">${e.focus.map((f) => `<span>${f}</span>`).join('')}</div><div class="stat"><span>Nations</span><b>${e.nations.length}</b></div><div class="stat"><span>Doctrine</span><b>${e.tagline}</b></div></div>`,
      ).join('')}</div></div>
      <div class="setup-foot"><button class="btn" data-act="back">← Back</button><button class="btn primary big" data-act="next" disabled>Choose a nation →</button></div></div>`;
    this.root.querySelectorAll<HTMLElement>('[data-era]').forEach((c) =>
      c.addEventListener('click', () => {
        audio.click();
        this.era = ERAS.find((e) => e.id === c.dataset.era)!;
        this.root.querySelectorAll('[data-era]').forEach((x) => x.classList.toggle('selected', x === c));
        (this.root.querySelector('[data-act=next]') as HTMLButtonElement).disabled = false;
      }),
    );
    this.root.querySelector('[data-act=back]')!.addEventListener('click', () => this.showMain());
    this.root.querySelector('[data-act=next]')!.addEventListener('click', () => this.era && this.showNation());
  }

  private showNation() {
    const era = this.era!;
    this.nation = null;
    this.root.innerHTML = `<div class="setup">
      <div class="setup-head"><h2>${era.name} · Choose your nation</h2><div class="steps"><span>1 · Era</span><span class="on">2 · Nation</span><span>3 · Deploy</span></div></div>
      <div class="setup-body"><div class="cards">${era.nations.filter((n) => n.playable !== false).map((n) => {
        const all = [...era.nations, ...era.politics.aiNations];
        const nameOf = (id: string) => all.find((y) => y.id === id)?.name;
        const allies = era.blocs.find((b) => b.includes(n.id))?.filter((x) => x !== n.id).map(nameOf).filter(Boolean) ?? [];
        const enemies = era.warsAtStart.filter((w) => w.includes(n.id)).map((w) => nameOf(w[0] === n.id ? w[1] : w[0])).filter(Boolean);
        return `<div class="card" data-nation="${n.id}"><div class="swatch" style="background:#${n.color.toString(16).padStart(6, '0')}"></div><div class="flag" style="${flagStyle(n)}"></div><h3>${n.name}</h3><p>${n.description}</p><div class="tags">${n.strengths.map((s) => `<span>${s}</span>`).join('')}</div>
          <div class="stat"><span>Capital</span><b>${n.capital.name}</b></div><div class="stat"><span>Industry</span><b>${'★'.repeat(Math.round(n.industry * 3))}</b></div><div class="stat"><span>Manpower</span><b>${'★'.repeat(Math.round(n.manpower * 2.5))}</b></div>
          <div class="stat"><span>Allies</span><b>${allies.length ? allies.join(', ') : 'None'}</b></div><div class="stat"><span>At war with</span><b>${enemies.length ? enemies.join(', ') : 'Nobody (yet)'}</b></div>
          <div class="stat"><span>Territory</span><b style="text-align:right;max-width:60%">${n.holdings ?? ''}</b></div></div>`;
      }).join('')}</div></div>
      <div class="setup-foot"><button class="btn" data-act="back">← Back</button><button class="btn primary big" data-act="start" disabled>Start Campaign</button></div></div>`;
    this.root.querySelectorAll<HTMLElement>('[data-nation]').forEach((c) =>
      c.addEventListener('click', () => {
        audio.click();
        this.nation = era.nations.find((n) => n.id === c.dataset.nation)!;
        this.root.querySelectorAll('[data-nation]').forEach((x) => x.classList.toggle('selected', x === c));
        (this.root.querySelector('[data-act=start]') as HTMLButtonElement).disabled = false;
      }),
    );
    this.root.querySelector('[data-act=back]')!.addEventListener('click', () => this.showEra());
    this.root.querySelector('[data-act=start]')!.addEventListener('click', () => {
      if (!this.nation) return;
      audio.click(1.3);
      this.onStart(era, this.nation);
    });
  }
}
