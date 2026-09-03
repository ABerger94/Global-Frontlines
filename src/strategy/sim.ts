import { Emitter } from '../core/events';
import { RNG } from '../core/rng';
import { clamp } from '../core/math';
import type { EraDef, NationDef, TechDef, TechEffects, KitId } from '../data/types';
import { generateWorld, findPath, TERRAIN_INFO, type World, type Province } from './world';

export interface NationState {
  id: string;
  def: NationDef;
  steel: number;
  oil: number;
  munitions: number;
  equipment: number;
  manpower: number;
  research: number;
  pp: number;
  stability: number;
  techs: Set<string>;
  researching: string | null;
  researchProgress: number;
  production: { munitions: number; equipment: number; steel: number };
  relations: Map<string, number>;
  allies: Set<string>;
  wars: Set<string>;
  alive: boolean;
  casualties: number;
  kills: number;
  provincesLost: number;
  provincesGained: number;
  nextAiDay: number;
}

export interface Army {
  id: number;
  name: string;
  nation: string;
  province: number;
  prevProvince: number;
  men: number;
  equipment: number;
  org: number;
  path: number[];
  progress: number;
  needed: number;
}

export interface BattleContext {
  id: number;
  provinceId: number;
  attacker: string;
  defender: string;
  attackerArmies: number[];
  defenderArmies: number[];
  defenderGarrison: number;
  day: number;
  attackerPower: number;
  defenderPower: number;
  attackerMen: number;
  defenderMen: number;
}

export interface BattleOutcome {
  attackerWon: boolean;
  attackerLoss: number;
  defenderLoss: number;
  fought: boolean;
}

export interface SupplyState {
  ammo: number; // 0..1
  equipment: number; // 0..1
  oil: number; // 0..1
  medkits: number;
  artillery: number;
  air: number;
  jam: number; // probability per shot
  tank: boolean;
  drone: boolean;
  gas: boolean;
  thermal: boolean;
  infantryBonus: number;
  spreadMult: number;
  enemyAccuracy: number;
  kits: KitId[];
}

export type LogKind = 'info' | 'war' | 'good' | 'bad' | 'research';

type SimEvents = {
  log: [string, LogKind];
  battlePrompt: [BattleContext];
  dirty: [];
  gameOver: [boolean, string];
  reinforcements: ['attacker' | 'defender', number, string];
  day: [];
};

export const ARMY_COST = { steel: 180, manpower: 15000, equipment: 60 };
export const FACTORY_COST = 320;
export const FORT_COST = 150;

export class StrategySim {
  readonly world: World;
  readonly nations = new Map<string, NationState>();
  readonly armies = new Map<number, Army>();
  readonly events = new Emitter<SimEvents>();
  readonly rng: RNG;
  day = 0;
  date: Date;
  pendingBattle: BattleContext | null = null;
  activeBattle: BattleContext | null = null;
  private armySeq = 1;
  private battleSeq = 1;
  gameOver = false;

  constructor(readonly era: EraDef, readonly playerId: string, seed: number) {
    this.rng = new RNG(seed ^ 0xabcdef);
    this.world = generateWorld(era, seed);
    this.date = new Date(Date.UTC(era.startYear, era.startMonth - 1, 1));
    for (const n of era.nations) {
      const st: NationState = {
        id: n.id,
        def: n,
        steel: 300,
        oil: 120,
        munitions: 250,
        equipment: 200,
        manpower: Math.round(40000 * n.manpower),
        research: 0,
        pp: 40,
        stability: n.id === 'russia' && era.id === 'ww1' ? 45 : 65,
        techs: new Set(),
        researching: null,
        researchProgress: 0,
        production: { munitions: 0.35, equipment: 0.35, steel: 0.3 },
        relations: new Map(),
        allies: new Set(),
        wars: new Set(),
        alive: true,
        casualties: 0,
        kills: 0,
        provincesLost: 0,
        provincesGained: 0,
        nextAiDay: this.rng.int(1, 3),
      };
      this.nations.set(n.id, st);
    }
    // relations & blocs
    for (const a of this.nations.values()) {
      for (const b of this.nations.values()) {
        if (a === b) continue;
        a.relations.set(b.id, 0);
      }
    }
    for (const bloc of era.blocs) {
      for (const a of bloc)
        for (const b of bloc) {
          if (a === b) continue;
          const na = this.nations.get(a);
          const nb = this.nations.get(b);
          if (!na || !nb) continue;
          na.allies.add(b);
          na.relations.set(b, 80);
        }
    }
    for (const [a, b] of era.warsAtStart) {
      const na = this.nations.get(a)!;
      const nb = this.nations.get(b)!;
      na.wars.add(b);
      nb.wars.add(a);
      na.relations.set(b, -80);
      nb.relations.set(a, -80);
    }
    // starting armies
    for (const n of this.nations.values()) {
      const owned = this.provincesOf(n.id);
      const count = Math.max(2, Math.round(owned.length / 3));
      const cap = owned.find((p) => p.capitalOf === n.id)!;
      const borderProvs = owned.filter((p) => p.neighbors.some((nb) => this.world.provinces[nb].isLand && this.world.provinces[nb].owner !== n.id));
      for (let i = 0; i < count; i++) {
        const prov = i === 0 ? cap : borderProvs.length ? this.rng.pick(borderProvs) : this.rng.pick(owned);
        this.createArmy(n.id, prov.id, Math.round(18000 * this.rng.range(0.8, 1.2)), 0.8);
      }
    }
  }

  // ---------------------------------------------------------------- helpers
  get player(): NationState {
    return this.nations.get(this.playerId)!;
  }
  provincesOf(nationId: string): Province[] {
    return this.world.provinces.filter((p) => p.owner === nationId);
  }
  armiesIn(provinceId: number): Army[] {
    const out: Army[] = [];
    for (const a of this.armies.values()) if (a.province === provinceId && a.path.length <= 1) out.push(a);
    return out;
  }
  armiesOf(nationId: string): Army[] {
    return [...this.armies.values()].filter((a) => a.nation === nationId);
  }
  atWar(a: string, b: string): boolean {
    return this.nations.get(a)?.wars.has(b) ?? false;
  }
  isAllied(a: string, b: string): boolean {
    return a === b || (this.nations.get(a)?.allies.has(b) ?? false);
  }
  hasTech(n: NationState, id: string): boolean {
    return n.techs.has(id);
  }
  techEffects(n: NationState): Required<Omit<TechEffects, 'unlockKit'>> & { kits: Set<KitId> } {
    const e = {
      infantry: 0, defense: 0, jam: 0, artillery: 0, air: 0, tank: false, tankArmor: 0, steel: 0, munitions: 0, research: 0,
      manpower: 0, medkits: 0, movement: 0, org: 0, drone: false, gas: false, thermal: false, spread: 0, enemyAccuracy: 0,
      kits: new Set<KitId>(),
    };
    for (const id of n.techs) {
      const t = this.era.techs.find((x) => x.id === id);
      if (!t) continue;
      const f = t.effects;
      e.infantry += f.infantry ?? 0;
      e.defense += f.defense ?? 0;
      e.jam += f.jam ?? 0;
      e.artillery += f.artillery ?? 0;
      e.air += f.air ?? 0;
      e.tank ||= !!f.tank;
      e.tankArmor += f.tankArmor ?? 0;
      e.steel += f.steel ?? 0;
      e.munitions += f.munitions ?? 0;
      e.research += f.research ?? 0;
      e.manpower += f.manpower ?? 0;
      e.medkits += f.medkits ?? 0;
      e.movement += f.movement ?? 0;
      e.org += f.org ?? 0;
      e.drone ||= !!f.drone;
      e.gas ||= !!f.gas;
      e.thermal ||= !!f.thermal;
      e.spread += f.spread ?? 0;
      e.enemyAccuracy += f.enemyAccuracy ?? 0;
      if (f.unlockKit) e.kits.add(f.unlockKit);
    }
    return e;
  }
  availableTechs(n: NationState): TechDef[] {
    return this.era.techs.filter((t) => {
      if (n.techs.has(t.id)) return false;
      if (t.tier === 1) return true;
      const prev = this.era.techs.find((x) => x.branch === t.branch && x.tier === t.tier - 1);
      return !!prev && n.techs.has(prev.id);
    });
  }
  availableKits(n: NationState): KitId[] {
    const e = this.techEffects(n);
    return this.era.kits.filter((k) => {
      const lock = this.era.kitLocks[k];
      return !lock || n.techs.has(lock) || e.kits.has(k);
    });
  }
  supplyState(n: NationState): SupplyState {
    const e = this.techEffects(n);
    const armies = this.armiesOf(n.id);
    const men = armies.reduce((s, a) => s + a.men, 0) + 1;
    const ammo = clamp(n.munitions / ((men / 1000) * 4), 0, 1);
    const eq = armies.length ? armies.reduce((s, a) => s + a.equipment, 0) / armies.length : 0.5;
    const d = n.def;
    const nationArt = d.id === 'france' && this.era.id === 'ww1' ? 1 : d.id === 'russia' && this.era.id === 'modern' ? 2 : 0;
    return {
      ammo,
      equipment: eq,
      oil: clamp(n.oil / 60, 0, 1),
      medkits: 1 + e.medkits,
      artillery: ammo > 0.15 ? 1 + e.artillery + nationArt : 0,
      air: n.oil > 10 ? e.air + (d.id === 'usa' && this.era.id === 'ww2' ? 1 : 0) : 0,
      jam: clamp((0.5 - eq * 0.45) * (1 - e.jam) * 0.12, 0.002, 0.08),
      tank: e.tank,
      drone: e.drone,
      gas: e.gas,
      thermal: e.thermal,
      infantryBonus: e.infantry,
      spreadMult: 1 - e.spread,
      enemyAccuracy: 1 - e.enemyAccuracy,
      kits: this.availableKits(n),
    };
  }
  nationPower(id: string): number {
    return this.armiesOf(id).reduce((s, a) => s + a.men * (0.4 + 0.6 * a.equipment), 0) + this.provincesOf(id).reduce((s, p) => s + p.garrison * 0.5, 0);
  }
  log(msg: string, kind: LogKind = 'info') {
    this.events.emit('log', msg, kind);
  }
  dateString(): string {
    return this.date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
  }

  createArmy(nation: string, province: number, men: number, equipment: number): Army {
    const n = this.nations.get(nation)!;
    const idx = this.armiesOf(nation).length + 1;
    const ordinal = (k: number) => (k === 1 ? '1st' : k === 2 ? '2nd' : k === 3 ? '3rd' : k + 'th');
    const a: Army = {
      id: this.armySeq++,
      name: `${ordinal(idx)} ${n.def.adjective} Army`,
      nation,
      province,
      prevProvince: province,
      men,
      equipment,
      org: 0.8,
      path: [],
      progress: 0,
      needed: 0,
    };
    this.armies.set(a.id, a);
    return a;
  }

  // ---------------------------------------------------------------- player / AI actions
  canRaiseArmy(n: NationState): boolean {
    return n.steel >= ARMY_COST.steel && n.manpower >= ARMY_COST.manpower && n.equipment >= ARMY_COST.equipment;
  }
  raiseArmy(nationId: string, provinceId: number): Army | null {
    const n = this.nations.get(nationId)!;
    const p = this.world.provinces[provinceId];
    if (p.owner !== nationId || !this.canRaiseArmy(n)) return null;
    n.steel -= ARMY_COST.steel;
    n.manpower -= ARMY_COST.manpower;
    n.equipment -= ARMY_COST.equipment;
    const a = this.createArmy(nationId, provinceId, ARMY_COST.manpower, 0.9);
    if (nationId === this.playerId) this.log(`${a.name} raised in ${p.name}.`, 'good');
    this.events.emit('dirty');
    return a;
  }
  buildFactory(nationId: string, provinceId: number): boolean {
    const n = this.nations.get(nationId)!;
    const p = this.world.provinces[provinceId];
    if (p.owner !== nationId || n.steel < FACTORY_COST) return false;
    n.steel -= FACTORY_COST;
    p.factories += 1;
    if (nationId === this.playerId) this.log(`New factory completed in ${p.name}.`, 'good');
    this.events.emit('dirty');
    return true;
  }
  fortify(nationId: string, provinceId: number): boolean {
    const n = this.nations.get(nationId)!;
    const p = this.world.provinces[provinceId];
    if (p.owner !== nationId || n.steel < FORT_COST || p.fort >= 4) return false;
    n.steel -= FORT_COST;
    p.fort += 1;
    if (nationId === this.playerId) this.log(`${p.name} fortified to level ${p.fort}.`, 'good');
    this.events.emit('dirty');
    return true;
  }
  setResearch(nationId: string, techId: string) {
    const n = this.nations.get(nationId)!;
    if (n.researching === techId) return;
    if (!this.availableTechs(n).some((t) => t.id === techId)) return;
    n.researching = techId;
    n.researchProgress = 0;
    this.events.emit('dirty');
  }
  /** Returns true if the army can be ordered to that province. */
  moveArmy(armyId: number, target: number): boolean {
    const a = this.armies.get(armyId);
    if (!a) return false;
    const n = this.nations.get(a.nation)!;
    const passable = (p: Province) => {
      if (p.terrain === 'ice') return false;
      if (!p.isLand) return true;
      if (!p.owner) return false;
      if (p.owner === a.nation || this.isAllied(a.nation, p.owner)) return true;
      return false; // enemy/minor land is only ever a destination
    };
    const tgt = this.world.provinces[target];
    if (tgt.terrain === 'ice' || !tgt.isLand) return false;
    if (tgt.owner && tgt.owner !== a.nation && !this.isAllied(a.nation, tgt.owner) && tgt.owner !== 'minor' && !n.wars.has(tgt.owner)) return false;
    const path = findPath(this.world, a.province, target, passable);
    if (!path || path.length < 2) return false;
    a.path = path;
    a.progress = 0;
    a.needed = this.legDays(a, path[1]);
    this.events.emit('dirty');
    return true;
  }
  private legDays(a: Army, to: number): number {
    const n = this.nations.get(a.nation)!;
    const e = this.techEffects(n);
    const p = this.world.provinces[to];
    let d = this.era.moveDays * TERRAIN_INFO[p.terrain].moveMult;
    d /= 1 + e.movement;
    if (n.oil <= 0) d *= 1.6;
    return Math.max(1, Math.round(d));
  }
  declareWar(fromId: string, toId: string): boolean {
    const a = this.nations.get(fromId)!;
    const b = this.nations.get(toId)!;
    if (!a.alive || !b.alive || a.wars.has(toId) || a.allies.has(toId)) return false;
    if (a.pp < 50) return false;
    a.pp -= 50;
    a.stability -= 8;
    const sideA = [fromId, ...a.allies].filter((id) => this.nations.get(id)?.alive);
    const sideB = [toId, ...b.allies].filter((id) => this.nations.get(id)?.alive);
    for (const x of sideA)
      for (const y of sideB) {
        if (x === y) continue;
        const nx = this.nations.get(x)!;
        const ny = this.nations.get(y)!;
        nx.wars.add(y);
        ny.wars.add(x);
        nx.relations.set(y, -100);
        ny.relations.set(x, -100);
      }
    this.log(`${a.def.name} declares war on ${b.def.name}!`, 'war');
    this.events.emit('dirty');
    return true;
  }
  improveRelations(fromId: string, toId: string): boolean {
    const a = this.nations.get(fromId)!;
    if (a.pp < 15) return false;
    a.pp -= 15;
    a.relations.set(toId, clamp((a.relations.get(toId) ?? 0) + 20, -100, 100));
    const b = this.nations.get(toId)!;
    b.relations.set(fromId, clamp((b.relations.get(fromId) ?? 0) + 15, -100, 100));
    this.events.emit('dirty');
    return true;
  }
  proposeAlliance(fromId: string, toId: string): boolean {
    const a = this.nations.get(fromId)!;
    const b = this.nations.get(toId)!;
    if (a.pp < 40 || a.allies.has(toId) || a.wars.has(toId)) return false;
    a.pp -= 40;
    const rel = b.relations.get(fromId) ?? 0;
    const sharedEnemy = [...a.wars].some((w) => b.wars.has(w));
    if (rel >= 50 || (rel >= 20 && sharedEnemy)) {
      a.allies.add(toId);
      b.allies.add(fromId);
      this.log(`${b.def.name} accepts an alliance with ${a.def.name}.`, 'good');
      this.events.emit('dirty');
      return true;
    }
    this.log(`${b.def.name} rejects the alliance proposal.`, 'bad');
    this.events.emit('dirty');
    return false;
  }
  offerPeace(fromId: string, toId: string): boolean {
    const a = this.nations.get(fromId)!;
    const b = this.nations.get(toId)!;
    if (!a.wars.has(toId) || a.pp < 30) return false;
    a.pp -= 30;
    const bLosing = b.provincesLost > b.provincesGained || b.stability < 35;
    if (bLosing || this.rng.chance(0.25)) {
      a.wars.delete(toId);
      b.wars.delete(fromId);
      a.relations.set(toId, -30);
      b.relations.set(fromId, -30);
      this.log(`${b.def.name} agrees to a truce with ${a.def.name}.`, 'good');
      this.events.emit('dirty');
      return true;
    }
    this.log(`${b.def.name} refuses to negotiate.`, 'bad');
    this.events.emit('dirty');
    return false;
  }

  // ---------------------------------------------------------------- tick
  tickDay() {
    if (this.gameOver) return;
    this.day++;
    this.date = new Date(this.date.getTime() + 86400000);
    for (const n of this.nations.values()) if (n.alive) this.economy(n);
    for (const p of this.world.provinces) {
      if (!p.isLand) continue;
      const base = 1500 + p.population * 0.5;
      if (p.garrison < base) p.garrison = Math.min(base, p.garrison + 60);
    }
    for (const a of [...this.armies.values()]) this.moveTick(a);
    for (const n of this.nations.values()) {
      if (!n.alive || n.id === this.playerId) continue;
      if (this.day >= n.nextAiDay) {
        n.nextAiDay = this.day + 3;
        this.aiTurn(n);
      }
    }
    this.checkVictory();
    this.events.emit('day');
  }

  private economy(n: NationState) {
    const e = this.techEffects(n);
    const owned = this.provincesOf(n.id);
    let factories = 0;
    let oil = 0;
    let pop = 0;
    let research = 0;
    for (const p of owned) {
      factories += p.factories;
      oil += p.oil;
      pop += p.population;
      research += (p.terrain === 'urban' ? 3 : 0.6) + p.factories * 0.4;
    }
    const output = factories * 4.2 * n.def.industry;
    n.munitions += output * n.production.munitions * (1 + e.munitions);
    n.equipment += output * n.production.equipment;
    n.steel += output * n.production.steel * (1 + e.steel);
    n.oil += oil * 1.5 + 0.6;
    n.manpower += pop * 0.00028 * n.def.manpower * (1 + e.manpower) * 1000 / 1000;
    n.research += research * (1 + e.research);
    n.pp = Math.min(200, n.pp + 1);
    // research progress
    if (n.researching) {
      const t = this.era.techs.find((x) => x.id === n.researching)!;
      const spend = Math.min(n.research, 30);
      n.research -= spend;
      n.researchProgress += spend;
      if (n.researchProgress >= t.cost) {
        n.techs.add(t.id);
        n.researching = null;
        n.researchProgress = 0;
        if (n.id === this.playerId) this.log(`Research complete: ${t.name}.`, 'research');
        this.events.emit('dirty');
      }
    }
    // upkeep
    const armies = this.armiesOf(n.id);
    let men = 0;
    for (const a of armies) {
      men += a.men;
      if (a.path.length > 1) n.oil -= 0.6;
      if (a.equipment < 1 && n.equipment > 0) {
        const want = Math.min(0.03, 1 - a.equipment);
        const cost = want * (a.men / 1000) * 3;
        const take = Math.min(cost, n.equipment);
        n.equipment -= take;
        a.equipment += (take / cost) * want;
      }
      a.org = Math.min(1, a.org + 0.015 * (1 + e.org));
      // reinforcement
      if (a.men < 18000 && n.manpower > 500) {
        const add = Math.min(200, n.manpower, 18000 - a.men);
        n.manpower -= add;
        a.men += add;
      }
    }
    n.munitions -= (men / 1000) * 0.05;
    if (n.munitions < 0) n.munitions = 0;
    if (n.oil < 0) n.oil = 0;
    // stability
    const wars = n.wars.size;
    n.stability += (60 - n.stability) * 0.004 - wars * 0.015;
    n.stability = clamp(n.stability, 0, 100);
    if (n.stability <= 0 && n.alive) this.collapse(n);
  }

  private moveTick(a: Army) {
    if (a.path.length < 2) return;
    a.progress += 1;
    if (a.progress < a.needed) return;
    const next = a.path[1];
    a.prevProvince = a.province;
    a.path.shift();
    a.progress = 0;
    const p = this.world.provinces[next];
    const n = this.nations.get(a.nation)!;
    a.province = next;
    if (this.activeBattle && this.activeBattle.provinceId === next) {
      // Reinforcements arriving into an ongoing (player) battle
      const b = this.activeBattle;
      if (this.isAllied(a.nation, b.defender) || a.nation === b.defender) {
        b.defenderArmies.push(a.id);
        b.defenderMen += a.men;
        this.events.emit('reinforcements', 'defender', a.men, a.name);
      } else if (this.isAllied(a.nation, b.attacker) || a.nation === b.attacker) {
        b.attackerArmies.push(a.id);
        b.attackerMen += a.men;
        this.events.emit('reinforcements', 'attacker', a.men, a.name);
      }
      a.path = [];
      return;
    }
    if (p.isLand && p.owner && p.owner !== a.nation && !this.isAllied(a.nation, p.owner)) {
      if (p.owner === 'minor' || n.wars.has(p.owner)) {
        a.path = [];
        this.startBattle(a, p);
        return;
      }
      // Cannot enter: stop
      a.path = [];
      a.province = a.prevProvince;
      return;
    }
    if (a.path.length > 1) a.needed = this.legDays(a, a.path[1]);
    else {
      a.path = [];
      if (a.nation === this.playerId) this.log(`${a.name} arrived in ${p.name}.`, 'info');
    }
    this.events.emit('dirty');
  }

  // ---------------------------------------------------------------- battles
  private armyPower(a: Army, attacking: boolean): number {
    const n = this.nations.get(a.nation)!;
    const e = this.techEffects(n);
    const s = this.supplyState(n);
    const supply = 0.55 + 0.45 * s.ammo;
    return a.men * (0.4 + 0.6 * a.equipment) * (0.5 + 0.5 * a.org) * (1 + e.infantry + (attacking ? 0 : e.defense)) * supply;
  }
  private startBattle(attackerArmy: Army, p: Province) {
    const attacker = attackerArmy.nation;
    const defender = p.owner!;
    const defArmies = this.armiesIn(p.id).filter((x) => x.nation === defender || this.isAllied(defender, x.nation));
    const atkArmies = this.armiesIn(p.id).filter((x) => x.nation === attacker || this.isAllied(attacker, x.nation));
    if (!atkArmies.includes(attackerArmy)) atkArmies.push(attackerArmy);
    let atkPower = 0;
    let atkMen = 0;
    for (const a of atkArmies) {
      atkPower += this.armyPower(a, true);
      atkMen += a.men;
    }
    let defPower = p.garrison * 0.7 * (defender === 'minor' ? 0.8 : 1);
    let defMen = p.garrison;
    for (const a of defArmies) {
      defPower += this.armyPower(a, false);
      defMen += a.men;
    }
    defPower *= TERRAIN_INFO[p.terrain].defense * (1 + p.fort * 0.25);
    const ctx: BattleContext = {
      id: this.battleSeq++,
      provinceId: p.id,
      attacker,
      defender,
      attackerArmies: atkArmies.map((a) => a.id),
      defenderArmies: defArmies.map((a) => a.id),
      defenderGarrison: p.garrison,
      day: this.day,
      attackerPower: atkPower,
      defenderPower: defPower,
      attackerMen: atkMen,
      defenderMen: defMen,
    };
    const playerInvolved = attacker === this.playerId || defender === this.playerId;
    if (p.owner === 'minor' && attacker === this.playerId) this.player.stability -= 3;
    if (playerInvolved) {
      this.pendingBattle = ctx;
      this.events.emit('battlePrompt', ctx);
    } else {
      const out = this.autoResolve(ctx);
      this.applyOutcome(ctx, out);
    }
  }
  autoResolve(ctx: BattleContext): BattleOutcome {
    const ratio = (ctx.attackerPower * this.rng.range(0.85, 1.15)) / Math.max(1, ctx.defenderPower * this.rng.range(0.85, 1.15));
    const attackerWon = ratio > 1;
    const margin = clamp(Math.abs(Math.log(ratio)), 0, 1.2);
    const loserLoss = clamp(0.22 + margin * 0.25, 0.2, 0.55);
    const winnerLoss = clamp(0.16 - margin * 0.1, 0.04, 0.16);
    return {
      attackerWon,
      attackerLoss: attackerWon ? winnerLoss : loserLoss,
      defenderLoss: attackerWon ? loserLoss : winnerLoss,
      fought: false,
    };
  }
  /** Resolve the currently pending battle with an outcome (from auto-resolve or FPS). */
  resolvePending(outcome: BattleOutcome) {
    const ctx = this.pendingBattle;
    if (!ctx) return;
    this.pendingBattle = null;
    this.activeBattle = null;
    this.applyOutcome(ctx, outcome);
  }
  applyOutcome(ctx: BattleContext, out: BattleOutcome) {
    const p = this.world.provinces[ctx.provinceId];
    const atkN = this.nations.get(ctx.attacker)!;
    const defN = this.nations.get(ctx.defender);
    const atkArmies = ctx.attackerArmies.map((id) => this.armies.get(id)).filter((a): a is Army => !!a);
    const defArmies = ctx.defenderArmies.map((id) => this.armies.get(id)).filter((a): a is Army => !!a);
    const totalMen = (arr: Army[]) => arr.reduce((s, a) => s + a.men, 0);
    const atkLost = Math.round(totalMen(atkArmies) * out.attackerLoss);
    const defLost = Math.round((totalMen(defArmies) + p.garrison) * out.defenderLoss);
    for (const a of atkArmies) {
      a.men = Math.round(a.men * (1 - out.attackerLoss));
      a.org = clamp(a.org - 0.3, 0.1, 1);
      a.equipment = clamp(a.equipment - 0.1, 0.1, 1);
    }
    for (const a of defArmies) {
      a.men = Math.round(a.men * (1 - out.defenderLoss));
      a.org = clamp(a.org - 0.25, 0.1, 1);
    }
    p.garrison = Math.round(p.garrison * (1 - out.defenderLoss));
    atkN.casualties += atkLost;
    atkN.kills += defLost;
    if (defN) {
      defN.casualties += defLost;
      defN.kills += atkLost;
    }
    const spend = (n: NationState, men: number) => (n.munitions = Math.max(0, n.munitions - (men / 1000) * 0.6));
    spend(atkN, ctx.attackerMen);
    if (defN) spend(defN, ctx.defenderMen);

    const playerSide = ctx.attacker === this.playerId ? 'attacker' : ctx.defender === this.playerId ? 'defender' : null;
    const playerWon = playerSide === 'attacker' ? out.attackerWon : playerSide === 'defender' ? !out.attackerWon : null;

    if (out.attackerWon) {
      const prevOwner = p.owner;
      p.owner = ctx.attacker;
      p.fort = Math.max(0, p.fort - 1);
      p.garrison = 800;
      atkN.provincesGained++;
      atkN.stability = clamp(atkN.stability + 2, 0, 100);
      if (defN) {
        defN.provincesLost++;
        defN.stability = clamp(defN.stability - 3, 0, 100);
      }
      // defenders retreat
      for (const a of defArmies) this.retreat(a, p.id);
      const who = defN ? defN.def.name : 'neutral forces';
      this.log(`${atkN.def.name} captures ${p.name} from ${who}${out.fought ? ' after a hard-fought battle' : ''}.`, playerSide ? (playerWon ? 'good' : 'bad') : 'war');
      if (prevOwner && p.capitalOf === prevOwner && defN) this.capitulate(defN, atkN);
    } else {
      for (const a of atkArmies) this.retreat(a, p.id);
      if (defN) defN.stability = clamp(defN.stability + 1.5, 0, 100);
      atkN.stability = clamp(atkN.stability - 2, 0, 100);
      this.log(`${atkN.def.name}'s assault on ${p.name} is repulsed.`, playerSide ? (playerWon ? 'good' : 'bad') : 'war');
    }
    for (const a of [...atkArmies, ...defArmies]) if (a.men < 600) this.armies.delete(a.id);
    this.events.emit('dirty');
    this.checkVictory();
  }
  private retreat(a: Army, from: number) {
    const own = (id: number) => {
      const q = this.world.provinces[id];
      return q.isLand && q.owner && (q.owner === a.nation || this.isAllied(a.nation, q.owner));
    };
    let dest = -1;
    if (a.prevProvince !== from && own(a.prevProvince)) dest = a.prevProvince;
    else {
      const p = this.world.provinces[from];
      const cands = p.neighbors.filter(own);
      if (cands.length) dest = this.rng.pick(cands);
    }
    if (dest < 0) {
      // nowhere to go — the army is captured
      this.armies.delete(a.id);
      return;
    }
    a.province = dest;
    a.prevProvince = dest;
    a.path = [];
  }
  private capitulate(n: NationState, victor: NationState) {
    n.alive = false;
    n.wars.clear();
    for (const other of this.nations.values()) {
      other.wars.delete(n.id);
      other.allies.delete(n.id);
    }
    for (const a of this.armiesOf(n.id)) this.armies.delete(a.id);
    for (const p of this.provincesOf(n.id)) {
      p.owner = victor.id;
      p.garrison = 800;
    }
    this.log(`${n.def.name} has capitulated to ${victor.def.name}!`, 'war');
    if (n.id === this.playerId) this.endGame(false, `${n.def.name} has capitulated. Your capital has fallen.`);
  }
  private collapse(n: NationState) {
    n.alive = false;
    n.wars.clear();
    for (const other of this.nations.values()) {
      other.wars.delete(n.id);
      other.allies.delete(n.id);
    }
    for (const a of this.armiesOf(n.id)) this.armies.delete(a.id);
    for (const p of this.provincesOf(n.id)) {
      p.owner = 'minor';
      p.garrison = 1500;
    }
    this.log(`Revolution! ${n.def.name} collapses into chaos.`, 'war');
    if (n.id === this.playerId) this.endGame(false, 'Stability collapsed. Your government has fallen to revolution.');
  }
  private checkVictory() {
    if (this.gameOver) return;
    const p = this.player;
    if (!p.alive) return;
    const rivals = [...this.nations.values()].filter((n) => n.id !== p.id && !p.allies.has(n.id));
    if (rivals.length && rivals.every((n) => !n.alive)) {
      this.endGame(true, 'Every rival power has capitulated. The world is yours.');
      return;
    }
    const land = this.world.provinces.filter((q) => q.isLand);
    const owned = land.filter((q) => q.owner === p.id).length;
    if (owned / land.length >= 0.6) this.endGame(true, 'You control the majority of the world. Total victory.');
  }
  private endGame(won: boolean, reason: string) {
    this.gameOver = true;
    this.events.emit('gameOver', won, reason);
  }

  // ---------------------------------------------------------------- AI
  private aiTurn(n: NationState) {
    const per = n.def.personality;
    // research
    if (!n.researching) {
      const avail = this.availableTechs(n);
      if (avail.length) {
        const order: Record<string, string[]> = {
          aggressive: ['armor', 'infantry', 'industry'],
          cautious: ['industry', 'infantry', 'armor'],
          opportunist: ['industry', 'armor', 'infantry'],
        };
        avail.sort((a, b) => a.tier - b.tier || order[per].indexOf(a.branch) - order[per].indexOf(b.branch));
        n.researching = avail[0].id;
        n.researchProgress = 0;
      }
    }
    n.production = per === 'aggressive' ? { munitions: 0.4, equipment: 0.35, steel: 0.25 } : { munitions: 0.32, equipment: 0.33, steel: 0.35 };
    // build
    const owned = this.provincesOf(n.id);
    const armies = this.armiesOf(n.id);
    const maxArmies = Math.floor(owned.length / 2) + 2;
    if (armies.length < maxArmies && this.canRaiseArmy(n)) {
      const spot = owned.find((p) => p.capitalOf === n.id) ?? owned[0];
      if (spot) this.raiseArmy(n.id, spot.id);
    } else if (n.steel > FACTORY_COST + 200 && this.rng.chance(0.5)) {
      const spot = this.rng.pick(owned);
      if (spot) this.buildFactory(n.id, spot.id);
    } else if (n.steel > FORT_COST + 150 && n.wars.size) {
      const border = owned.filter((p) => p.fort < 2 && p.neighbors.some((nb) => this.isEnemyLand(n, this.world.provinces[nb])));
      if (border.length) this.fortify(n.id, this.rng.pick(border).id);
    }
    // diplomacy
    if (n.pp >= 60 && n.wars.size === 0) {
      const aggression = per === 'aggressive' ? 0.35 : per === 'opportunist' ? 0.2 : 0.06;
      if (this.rng.chance(aggression)) {
        const targets = [...this.nations.values()].filter((o) => o.alive && o.id !== n.id && !n.allies.has(o.id) && (n.relations.get(o.id) ?? 0) < 20);
        targets.sort((a, b) => this.nationPower(a.id) - this.nationPower(b.id));
        const weakest = targets[0];
        if (weakest && this.nationPower(weakest.id) < this.nationPower(n.id) * (per === 'aggressive' ? 1.2 : 0.8) && this.sharesBorder(n.id, weakest.id)) {
          this.declareWar(n.id, weakest.id);
        }
      }
    }
    if (n.pp >= 40 && n.wars.size && n.stability < 35 && this.rng.chance(0.3)) {
      const enemy = [...n.wars][0];
      this.offerPeace(n.id, enemy);
    }
    // armies
    for (const a of armies) {
      if (a.path.length > 1) continue;
      if (a.org < 0.45 || a.men < 5000) continue;
      this.aiArmyOrder(n, a, per);
    }
  }
  private isEnemyLand(n: NationState, p: Province): boolean {
    return p.isLand && !!p.owner && p.owner !== n.id && !this.isAllied(n.id, p.owner) && (p.owner === 'minor' || n.wars.has(p.owner));
  }
  private sharesBorder(a: string, b: string): boolean {
    for (const p of this.world.provinces) {
      if (p.owner !== a) continue;
      for (const nb of p.neighbors) {
        const q = this.world.provinces[nb];
        if (q.owner === b) return true;
        if (!q.isLand) for (const nb2 of q.neighbors) if (this.world.provinces[nb2].owner === b) return true;
      }
    }
    return false;
  }
  private defenseOf(p: Province): number {
    let d = p.garrison * 0.7;
    for (const a of this.armiesIn(p.id)) if (a.nation === p.owner || (p.owner && this.isAllied(p.owner, a.nation))) d += a.men * (0.4 + 0.6 * a.equipment);
    return d * TERRAIN_INFO[p.terrain].defense * (1 + p.fort * 0.25);
  }
  private aiArmyOrder(n: NationState, a: Army, per: string) {
    const here = this.world.provinces[a.province];
    const power = a.men * (0.4 + 0.6 * a.equipment) * (0.5 + 0.5 * a.org);
    const caution = per === 'aggressive' ? 1.0 : per === 'cautious' ? 1.6 : 1.3;
    // 1. Threatened own provinces nearby -> defend
    const owned = this.provincesOf(n.id);
    let bestDef: Province | null = null;
    let bestThreat = 0;
    for (const p of owned) {
      let threat = 0;
      for (const nb of p.neighbors) {
        for (const ea of this.armiesIn(nb)) if (n.wars.has(ea.nation)) threat += ea.men;
      }
      const d = this.defenseOf(p);
      const score = threat - d;
      if (threat > 0 && score > bestThreat) {
        bestThreat = score;
        bestDef = p;
      }
    }
    if (bestDef && bestDef.id !== a.province) {
      if (this.moveArmy(a.id, bestDef.id)) return;
    }
    // 2. Attack the weakest enemy province adjacent to our territory
    const targets: { p: Province; d: number }[] = [];
    const wantMinors = n.wars.size === 0 || per !== 'cautious';
    for (const p of this.world.provinces) {
      if (!p.isLand || !p.owner || p.owner === n.id || this.isAllied(n.id, p.owner)) continue;
      const isMinor = p.owner === 'minor';
      if (isMinor && !wantMinors) continue;
      if (!isMinor && !n.wars.has(p.owner)) continue;
      const adjacentOurs = p.neighbors.some((nb) => this.world.provinces[nb].owner === n.id);
      if (!adjacentOurs) continue;
      targets.push({ p, d: this.defenseOf(p) * (p.capitalOf ? 0.8 : 1) });
    }
    targets.sort((x, y) => x.d - y.d);
    for (const t of targets.slice(0, 4)) {
      if (power > t.d * caution) {
        if (this.moveArmy(a.id, t.p.id)) return;
      }
    }
    // 3. Move to a frontline province if not already there
    const frontline = here.neighbors.some((nb) => this.isEnemyLand(n, this.world.provinces[nb]));
    if (!frontline && n.wars.size) {
      const fronts = owned.filter((p) => p.neighbors.some((nb) => this.isEnemyLand(n, this.world.provinces[nb])));
      if (fronts.length) {
        fronts.sort((x, y) => this.defenseOf(x) - this.defenseOf(y));
        this.moveArmy(a.id, fronts[0].id);
      }
    }
  }
}
