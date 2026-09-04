/**
 * Combat difficulty. The AI is deliberately handicapped against the player:
 * real soldiers do not snap-fire across 300 m the instant they see a silhouette,
 * and a lone player cannot fight a platoon that all shoots at once.
 */
export interface Difficulty {
  id: string;
  name: string;
  desc: string;
  /** Multiplier on enemy hit chance when the target is the player. */
  enemyAccuracy: number;
  /** Multiplier on all damage the player takes. */
  playerDamage: number;
  /** How many enemies may engage the player at the same time. */
  maxAttackers: number;
  /** Seconds a bot needs to acquire and settle on a newly spotted player. */
  reaction: number;
  /** How far the player can be spotted, relative to normal AI sight. */
  playerVisibility: number;
  /** Player health regenerated per second once out of fire for a few seconds. */
  regen: number;
  /** The first shot of a freshly acquired burst at the player always misses. */
  firstShotMisses: boolean;
  /** Seconds of immunity after redeploying. */
  spawnProtection: number;
}

export const DIFFICULTIES: Difficulty[] = [
  {
    id: 'recruit',
    name: 'Recruit',
    desc: 'Enemies are slow to spot you, shoot poorly at range, and only a couple engage you at once. Health regenerates quickly.',
    enemyAccuracy: 0.4,
    playerDamage: 0.45,
    maxAttackers: 2,
    reaction: 1.7,
    playerVisibility: 0.6,
    regen: 9,
    firstShotMisses: true,
    spawnProtection: 4,
  },
  {
    id: 'regular',
    name: 'Regular',
    desc: 'A fair fight. Enemies take a moment to aim, engage at believable ranges, and you recover between firefights.',
    enemyAccuracy: 0.6,
    playerDamage: 0.6,
    maxAttackers: 3,
    reaction: 1.2,
    playerVisibility: 0.75,
    regen: 6,
    firstShotMisses: true,
    spawnProtection: 3,
  },
  {
    id: 'veteran',
    name: 'Veteran',
    desc: 'Enemies react quickly, shoot straight and flank in numbers. Use cover and your squad, not your reflexes.',
    enemyAccuracy: 0.85,
    playerDamage: 0.85,
    maxAttackers: 4,
    reaction: 0.7,
    playerVisibility: 0.9,
    regen: 3,
    firstShotMisses: false,
    spawnProtection: 2,
  },
  {
    id: 'elite',
    name: 'Elite',
    desc: 'No handicap. The enemy sees what you see, fires as fast as you do, and the whole line will shoot at you.',
    enemyAccuracy: 1.0,
    playerDamage: 1.0,
    maxAttackers: 8,
    reaction: 0.35,
    playerVisibility: 1.0,
    regen: 0,
    firstShotMisses: false,
    spawnProtection: 0,
  },
];

export const DEFAULT_DIFFICULTY = 'regular';

export function getDifficulty(id: string | undefined): Difficulty {
  return DIFFICULTIES.find((d) => d.id === id) ?? DIFFICULTIES.find((d) => d.id === DEFAULT_DIFFICULTY)!;
}

/**
 * How far each weapon class is actually fought with on a 270 m battlefield.
 * Ballistic range (`WeaponDef.range`) stays long for the player; the AI is held
 * to these so it does not snipe you with an SMG from the far spawn.
 */
export const AI_ENGAGE_RANGE: Record<string, number> = {
  rifle: 150,
  dmr: 190,
  lmg: 140,
  carbine: 110,
  smg: 60,
  pistol: 35,
};
