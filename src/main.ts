import * as THREE from 'three';
import './ui/styles.css';
import { ERAS } from './data/eras';
import type { EraDef, NationDef, RoleId, KitId } from './data/types';
import { StrategySim, type BattleContext } from './strategy/sim';
import { GlobeScene } from './strategy/globeScene';
import { StrategyUI } from './strategy/strategyUI';
import { Menu } from './ui/menu';
import { BattleScene } from './battle/battleScene';
import type { BattleSetup, BattleResult } from './battle/types';
import { audio } from './audio/audio';
import { device, applyDeviceClasses } from './core/device';

type Screen = 'menu' | 'strategy' | 'battle';

class App {
  renderer: THREE.WebGLRenderer;
  canvas: HTMLCanvasElement;
  ui: HTMLElement;
  labels: HTMLElement;
  screen: Screen = 'menu';
  menu: Menu;
  sim: StrategySim | null = null;
  globe: GlobeScene | null = null;
  stratUI: StrategyUI | null = null;
  battle: BattleScene | null = null;
  private clock = new THREE.Clock();
  private dayAccum = 0;
  private mouseDown: { x: number; y: number } | null = null;
  private touchCount = 0;
  private orientationHint: HTMLElement | null = null;
  private menuGlobe: GlobeScene | null = null;
  private loadingEl: HTMLElement | null = null;

  constructor() {
    this.canvas = document.getElementById('gl') as HTMLCanvasElement;
    this.ui = document.getElementById('ui')!;
    this.labels = document.getElementById('labels')!;
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, powerPreference: 'high-performance' });
    // phones gain far more from a stable frame rate than from extra pixels
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, device.lowPower ? 1.5 : 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    applyDeviceClasses();
    try {
      const v = localStorage.getItem('gf.volume');
      if (v !== null) audio.setVolume(Number(v) / 100);
    } catch {
      /* private browsing */
    }
    this.buildOrientationHint();
    this.menu = new Menu(this.ui, (era, nation) => this.startCampaign(era, nation));
    setTimeout(() => this.buildMenuGlobe(), 30);
    window.addEventListener('resize', () => this.resize());
    this.canvas.addEventListener('pointerdown', (e) => {
      this.mouseDown = { x: e.clientX, y: e.clientY };
      this.touchCount++;
    });
    this.canvas.addEventListener('pointerup', (e) => {
      const multi = this.touchCount > 1;
      this.touchCount = Math.max(0, this.touchCount - 1);
      if (this.screen !== 'strategy' || !this.mouseDown || !this.globe || !this.stratUI) return;
      const dx = e.clientX - this.mouseDown.x;
      const dy = e.clientY - this.mouseDown.y;
      this.mouseDown = null;
      // a finger is less steady than a mouse, and a pinch must never select
      const slop = e.pointerType === 'touch' ? 144 : 25;
      if (multi || dx * dx + dy * dy > slop || e.button !== 0) return;
      const p = this.globe.pickProvince((e.clientX / window.innerWidth) * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1);
      this.stratUI.handleGlobeClick(p);
    });
    this.canvas.addEventListener('pointercancel', () => {
      this.mouseDown = null;
      this.touchCount = Math.max(0, this.touchCount - 1);
    });
    this.canvas.addEventListener('pointermove', (e) => {
      if (e.pointerType === 'touch' || this.screen !== 'strategy' || !this.globe || !this.stratUI) return;
      const p = this.globe.pickProvince((e.clientX / window.innerWidth) * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1);
      this.stratUI.handleGlobeHover(p);
    });
    document.addEventListener('keydown', (e) => {
      if (this.screen !== 'strategy' || !this.stratUI) return;
      if ((e.target as HTMLElement).tagName === 'INPUT') return;
      if (e.code === 'Space') {
        e.preventDefault();
        this.stratUI.setSpeed(this.stratUI.speed === 0 ? 1 : 0);
      } else if (e.code === 'Digit1') this.stratUI.setSpeed(1);
      else if (e.code === 'Digit2') this.stratUI.setSpeed(2);
      else if (e.code === 'Digit3') this.stratUI.setSpeed(3);
      else if (e.code === 'Escape') {
        if (!this.stratUI.closeTop()) this.stratUI.showGameMenu();
      }
    });
    this.resize();
    this.loop();
  }

  private buildMenuGlobe() {
    if (this.screen !== 'menu') return;
    const sim = new StrategySim(ERAS[1], 'usa', 1942);
    this.menuGlobe = new GlobeScene(this.renderer, sim.world, sim, this.labels);
    this.menuGlobe.autoRotate = true;
    this.menuGlobe.camera.position.set(-0.4, 1.1, 2.6);
    this.menuGlobe.controls.enabled = false;
    this.menuGlobe.resize(window.innerWidth, window.innerHeight);
  }

  resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.globe?.resize(w, h);
    this.menuGlobe?.resize(w, h);
    this.battle?.resize();
  }

  /** Phones need landscape for the shooter; the globe is fine either way. */
  private buildOrientationHint() {
    const el = document.createElement('div');
    el.className = 'orientation-hint';
    el.innerHTML = '<div><h2>Rotate your device</h2><p>The battlefield needs landscape.</p></div>';
    this.ui.appendChild(el);
    this.orientationHint = el;
    const sync = () => {
      const show = device.touch && device.portrait && this.screen === 'battle';
      el.classList.toggle('on', show);
    };
    window.addEventListener('resize', sync);
    window.addEventListener('orientationchange', () => setTimeout(sync, 150));
    setInterval(sync, 600);
  }

  private showLoading(title: string, text: string) {
    this.loadingEl?.remove();
    const el = document.createElement('div');
    el.className = 'loading';
    el.innerHTML = `<h2>${title}</h2><div class="bar"><i style="--f:30%"></i></div><p>${text}</p>`;
    this.ui.appendChild(el);
    this.loadingEl = el;
  }
  private hideLoading() {
    this.loadingEl?.remove();
    this.loadingEl = null;
  }

  // ---------------------------------------------------------------- campaign
  startCampaign(era: EraDef, nation: NationDef) {
    audio.unlock();
    this.menu.hide();
    this.showLoading('Generating the world', `${era.name} · ${nation.name}`);
    setTimeout(() => {
      const seed = (Math.random() * 0xffffffff) >>> 0;
      this.sim = new StrategySim(era, nation.id, seed);
      this.menuGlobe?.dispose();
      this.menuGlobe = null;
      this.labels.innerHTML = '';
      this.globe = new GlobeScene(this.renderer, this.sim.world, this.sim, this.labels);
      this.stratUI = new StrategyUI(this.ui, this.sim, this.globe, {
        onQuit: () => this.returnToMenu(),
        onAutoResolve: (ctx) => this.autoResolve(ctx),
        onTakeCommand: (ctx, role, kit, difficulty) => this.takeCommand(ctx, role, kit, difficulty),
      });
      this.sim.events.on('battlePrompt', (ctx) => {
        this.stratUI!.setSpeed(0);
        this.globe!.focusProvince(ctx.provinceId, Math.min(2.4, this.globe!.camera.position.length()));
        this.stratUI!.showBattlePrompt(ctx);
        audio.capture(false);
      });
      this.sim.events.on('gameOver', (won, reason) => {
        this.stratUI!.setSpeed(0);
        this.stratUI!.showGameOver(won, reason, () => this.returnToMenu());
      });
      const cap = this.sim.world.provinces.find((p) => p.capitalOf === nation.id)!;
      this.globe.focusProvince(cap.id, 2.6);
      this.screen = 'strategy';
      this.resize();
      this.hideLoading();
      audio.startAmbience('space');
    }, 60);
  }

  private returnToMenu() {
    this.battle?.dispose();
    this.battle = null;
    this.stratUI?.dispose();
    this.stratUI = null;
    this.globe?.dispose();
    this.globe = null;
    this.sim = null;
    this.labels.innerHTML = '';
    this.ui.querySelectorAll('.report-overlay').forEach((e) => e.remove());
    audio.stopAmbience();
    this.buildMenuGlobe();
    this.screen = 'menu';
    this.menu.show();
    this.resize();
  }

  private autoResolve(ctx: BattleContext) {
    if (!this.sim) return;
    const out = this.sim.autoResolve(ctx);
    this.sim.resolvePending(out);
    this.stratUI?.setSpeed(1);
  }

  private takeCommand(ctx: BattleContext, role: RoleId, kit: KitId, difficulty: string) {
    const sim = this.sim!;
    const p = sim.world.provinces[ctx.provinceId];
    const playerIsAttacker = ctx.attacker === sim.playerId;
    const enemyId = playerIsAttacker ? ctx.defender : ctx.attacker;
    const enemyState = sim.nations.get(enemyId);
    const me = sim.player;
    const supply = sim.supplyState(me);
    const enemySupply = enemyState
      ? (() => {
          const s = sim.supplyState(enemyState);
          return { ammo: s.ammo, equipment: s.equipment, infantryBonus: s.infantryBonus, tank: s.tank, gas: s.gas, artillery: s.artillery };
        })()
      : { ammo: 0.5, equipment: 0.4, infantryBonus: 0, tank: false, gas: false, artillery: 0 };
    const enemyNation: NationDef = enemyState
      ? enemyState.def
      : { id: 'minor', name: 'Local Militia', adjective: 'Militia', color: 0xb8b09a, capital: { lat: 0, lon: 0, name: '' }, size: 0, industry: 0.5, manpower: 1, personality: 'cautious', bloc: '', description: '', strengths: [], weapons: { rifle: sim.era.id === 'ww1' ? 'mosin' : sim.era.id === 'ww2' ? 'kar98k' : 'ak103', lmg: sim.era.id === 'ww1' ? 'lewis' : sim.era.id === 'ww2' ? 'dp28' : 'pkm', pistol: 'webley' }, tankName: 'Improvised armour', planeName: 'None' };
    const myPower = playerIsAttacker ? ctx.attackerPower : ctx.defenderPower;
    const enemyPower = playerIsAttacker ? ctx.defenderPower : ctx.attackerPower;
    const total = myPower + enemyPower;
    const playerTickets = Math.round(40 + (myPower / total) * 120);
    const enemyTickets = Math.round(40 + (enemyPower / total) * 120);
    const night = sim.era.id === 'modern' || (sim.era.id === 'ww2' && sim.rng.chance(0.2));
    const setup: BattleSetup = {
      era: sim.era,
      theme: sim.era.theme,
      terrain: p.terrain,
      provinceName: p.name,
      playerNation: me.def,
      enemyNation,
      playerIsAttacker,
      role,
      kit,
      supply,
      enemySupply,
      playerTickets,
      enemyTickets,
      seed: (sim.world.seed ^ (ctx.id * 7919)) >>> 0,
      night,
      difficulty,
      onDay: () => {
        sim.tickDay();
      },
    };
    sim.activeBattle = ctx;
    this.showLoading('Deploying to ' + p.name, `${me.def.name} · ${role} · ${kit}`);
    this.stratUI!.setVisible(false);
    this.labels.style.display = 'none';
    setTimeout(() => {
      const reinfHandler = (side: 'attacker' | 'defender', men: number, name: string) => {
        const mine = (side === 'attacker') === playerIsAttacker;
        this.battle?.reinforce(mine ? 'player' : 'enemy', men, name);
      };
      const off = sim.events.on('reinforcements', reinfHandler);
      const offLog = sim.events.on('log', (m, k) => this.battle?.hud.addKill(m, k === 'bad' ? 'me' : ''));
      this.battle = new BattleScene(this.renderer, this.ui, setup, (result) => {
        off();
        offLog();
        this.endBattle(ctx, result, playerIsAttacker);
      });
      this.screen = 'battle';
      this.resize();
      this.hideLoading();
    }, 60);
  }

  private endBattle(ctx: BattleContext, result: BattleResult, playerIsAttacker: boolean) {
    const sim = this.sim!;
    this.battle?.dispose();
    this.battle = null;
    this.ui.querySelectorAll('.report-overlay').forEach((e) => e.remove());
    const attackerWon = playerIsAttacker ? result.won : !result.won;
    const pFrac = Math.max(0, result.playerTicketsLeft) / result.playerTicketsStart;
    const eFrac = Math.max(0, result.enemyTicketsLeft) / result.enemyTicketsStart;
    const winnerLoss = (frac: number) => 0.06 + (1 - frac) * 0.22;
    const loserLoss = (frac: number) => 0.3 + (1 - frac) * 0.3;
    const playerLoss = result.won ? winnerLoss(pFrac) : loserLoss(pFrac);
    const enemyLoss = result.won ? loserLoss(eFrac) : winnerLoss(eFrac);
    sim.resolvePending({
      attackerWon,
      attackerLoss: playerIsAttacker ? playerLoss : enemyLoss,
      defenderLoss: playerIsAttacker ? enemyLoss : playerLoss,
      fought: true,
    });
    this.screen = 'strategy';
    this.stratUI?.setVisible(true);
    this.labels.style.display = '';
    this.stratUI?.setSpeed(1);
    this.stratUI?.log(`After-action: ${result.kills} kills, ${result.deaths} deaths, ${result.pointsHeld}/3 objectives at the end.`, result.won ? 'good' : 'bad');
    this.resize();
    audio.startAmbience('space');
    if (this.globe) this.globe.markDirty();
  }

  // ---------------------------------------------------------------- loop
  private loop = () => {
    requestAnimationFrame(this.loop);
    const dt = Math.min(0.1, this.clock.getDelta());
    if (this.screen === 'menu' && this.menuGlobe) {
      this.menuGlobe.update(dt);
      this.renderer.render(this.menuGlobe.scene, this.menuGlobe.camera);
    } else if (this.screen === 'strategy' && this.globe && this.sim && this.stratUI) {
      const speed = this.stratUI.speed;
      if (speed > 0 && !this.sim.pendingBattle && !this.sim.gameOver) {
        const secPerDay = speed === 1 ? 1.0 : speed === 2 ? 0.4 : 0.15;
        this.dayAccum += dt;
        let guard = 0;
        while (this.dayAccum >= secPerDay && guard++ < 5) {
          this.dayAccum -= secPerDay;
          this.sim.tickDay();
          if (this.sim.pendingBattle || this.sim.gameOver) {
            this.dayAccum = 0;
            break;
          }
        }
      } else this.dayAccum = 0;
      this.globe.update(dt);
      this.renderer.render(this.globe.scene, this.globe.camera);
    } else if (this.screen === 'battle' && this.battle) {
      this.battle.update(dt);
    }
  };
}

const app = new App();
(window as any).__gf = app;
(window as any).__gf.debug = { StrategySim, ERAS };
