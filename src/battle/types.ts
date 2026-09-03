import type { EraDef, NationDef, KitId, RoleId, BattleTheme } from '../data/types';
import type { SupplyState } from '../strategy/sim';
import type { Terrain } from '../strategy/world';

export interface BattleSetup {
  era: EraDef;
  theme: BattleTheme;
  terrain: Terrain;
  provinceName: string;
  playerNation: NationDef;
  enemyNation: NationDef;
  playerIsAttacker: boolean;
  role: RoleId;
  kit: KitId;
  supply: SupplyState;
  enemySupply: { ammo: number; equipment: number; infantryBonus: number; tank: boolean; gas: boolean; artillery: number };
  playerTickets: number;
  enemyTickets: number;
  seed: number;
  night: boolean;
  /** Called every strategic day while the battle runs. */
  onDay?: () => void;
}

export interface BattleResult {
  won: boolean;
  withdrew: boolean;
  playerTicketsStart: number;
  playerTicketsLeft: number;
  enemyTicketsStart: number;
  enemyTicketsLeft: number;
  kills: number;
  deaths: number;
  duration: number;
  pointsHeld: number;
}

export type Team = 'player' | 'enemy';

export interface AABB {
  min: { x: number; y: number; z: number };
  max: { x: number; y: number; z: number };
}
