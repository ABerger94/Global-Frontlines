export type EraId = 'ww1' | 'ww2' | 'modern';
export type TechBranch = 'infantry' | 'armor' | 'industry';
export type Personality = 'aggressive' | 'cautious' | 'opportunist';
export type KitId = 'rifleman' | 'mg' | 'smg' | 'medic' | 'marksman' | 'tank';
export type RoleId = 'commander' | 'squadleader' | 'soldier';
export type WeaponKind = 'rifle' | 'smg' | 'lmg' | 'pistol' | 'dmr' | 'carbine';
export type FireSound = 'bolt' | 'semi' | 'auto' | 'heavy' | 'pistol';

export interface WeaponDef {
  id: string;
  name: string;
  kind: WeaponKind;
  damage: number;
  rpm: number;
  magSize: number;
  reserveMags: number;
  reloadTime: number;
  auto: boolean;
  /** Hip-fire spread (radians). */
  spread: number;
  adsSpread: number;
  recoil: number;
  range: number;
  adsFov: number;
  sound: FireSound;
  /** Bolt-action: cycles bolt after each shot. */
  boltAction?: boolean;
  /** Scope overlay when aiming. */
  scoped?: boolean;
}

export interface NationWeapons {
  rifle: string;
  lmg: string;
  smg?: string;
  dmr?: string;
  pistol: string;
}

export interface NationDef {
  id: string;
  name: string;
  adjective: string;
  color: number;
  capital: { lat: number; lon: number; name: string };
  /** Approximate number of provinces at start. */
  size: number;
  industry: number;
  manpower: number;
  personality: Personality;
  bloc: string;
  description: string;
  strengths: string[];
  weapons: NationWeapons;
  tankName: string;
  planeName: string;
  /** Selectable in the campaign menu (default true). */
  playable?: boolean;
  /** Flag stripes, top to bottom (or left to right with dir 'v'). */
  flag?: { colors: number[]; dir?: 'h' | 'v' };
  /** Short description of territory at the campaign start. */
  holdings?: string;
  /** Starting field armies (overrides the territory-based default). */
  armies?: number;
}

export interface TechEffects {
  infantry?: number; // multiplier bonus (0.1 = +10%)
  defense?: number;
  jam?: number; // reduction in jam chance (0..1)
  artillery?: number; // extra strikes
  air?: number; // extra air support calls
  tank?: boolean;
  tankArmor?: number;
  steel?: number;
  munitions?: number;
  research?: number;
  manpower?: number;
  medkits?: number;
  movement?: number;
  org?: number;
  drone?: boolean;
  unlockKit?: KitId;
  gas?: boolean;
  thermal?: boolean;
  spread?: number; // reduce weapon spread fraction
  enemyAccuracy?: number; // reduce enemy accuracy fraction
}

export interface TechDef {
  id: string;
  name: string;
  branch: TechBranch;
  tier: number;
  cost: number;
  desc: string;
  effects: TechEffects;
}

export type BattleTheme = 'trench' | 'ruins' | 'urban';

export interface EraDef {
  id: EraId;
  name: string;
  years: string;
  tagline: string;
  description: string;
  startYear: number;
  startMonth: number;
  nations: NationDef[];
  techs: TechDef[];
  weapons: Record<string, WeaponDef>;
  theme: BattleTheme;
  /** Groups of nation ids that start allied. */
  blocs: string[][];
  /** Pairs at war from day one. */
  warsAtStart: [string, string][];
  moveDays: number;
  kits: KitId[];
  /** Kits locked behind a tech (kit -> tech id). */
  kitLocks: Partial<Record<KitId, string>>;
  focus: string[];
  /** Country ownership table, AI powers and dated events for this era. */
  politics: import('./history').EraPolitics;
}
