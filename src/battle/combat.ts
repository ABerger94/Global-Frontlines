import * as THREE from 'three';
import type { RNG } from '../core/rng';
import type { Battlefield } from './terrain';
import type { Effects } from './effects';
import type { Team } from './types';
import type { Difficulty } from './difficulty';

export interface Combatant {
  id: number;
  team: Team;
  /** Feet position. */
  pos: THREE.Vector3;
  alive: boolean;
  height: number;
  radius: number;
  isVehicle: boolean;
  isPlayer: boolean;
  moving: boolean;
  /** World time until which enemies ignore this combatant (respawn protection). */
  protectedUntil?: number;
  crouching: boolean;
  takeDamage(amount: number, attacker: Combatant | null, headshot?: boolean): void;
}

export interface GasCloud {
  pos: THREE.Vector3;
  radius: number;
  strength: number;
}

export interface BattleWorld {
  field: Battlefield;
  effects: Effects;
  time: number;
  rng: RNG;
  combatants: Combatant[];
  player: Combatant;
  listenerPos: THREE.Vector3;
  listenerYaw: number;
  gasClouds: GasCloud[];
  revealed: boolean;
  enemyAccuracyMult: number;
  friendlyAccuracyMult: number;
  night: boolean;
  difficulty: Difficulty;
  /** Ids of the enemies currently allowed to engage the player. */
  playerAttackers: Set<number>;
  onKill(attacker: Combatant | null, victim: Combatant): void;
}

/** Distance & stereo pan of a world position relative to the listener. */
export function soundAt(world: BattleWorld, pos: THREE.Vector3): { distance: number; pan: number } {
  const dx = pos.x - world.listenerPos.x;
  const dz = pos.z - world.listenerPos.z;
  const distance = Math.hypot(dx, dz, pos.y - world.listenerPos.y);
  // listener forward = (-sin(yaw), -cos(yaw)); right = (cos(yaw), -sin(yaw))... using yaw around Y
  const rx = Math.cos(world.listenerYaw);
  const rz = -Math.sin(world.listenerYaw);
  const pan = distance > 0.5 ? (dx * rx + dz * rz) / distance : 0;
  return { distance, pan: Math.max(-1, Math.min(1, pan * 0.8)) };
}

const _o = new THREE.Vector3();
const _d = new THREE.Vector3();

/** Line of sight between two points (true if unobstructed). */
export function hasLOS(field: Battlefield, from: THREE.Vector3, to: THREE.Vector3): boolean {
  _o.copy(from);
  _d.copy(to).sub(from);
  const dist = _d.length();
  if (dist < 0.01) return true;
  _d.divideScalar(dist);
  const hit = field.raycast(_o, _d, dist);
  return hit >= dist - 0.4;
}

/** Ray-sphere & ray-cylinder style hit test against a combatant; returns distance or null and headshot flag. */
export function rayHitCombatant(origin: THREE.Vector3, dir: THREE.Vector3, c: Combatant, maxDist: number): { t: number; head: boolean } | null {
  if (!c.alive) return null;
  if (c.isVehicle) {
    // approximate as box-ish sphere
    const center = _o.copy(c.pos);
    center.y += c.height * 0.5;
    const r = c.radius;
    const oc = _d.copy(origin).sub(center);
    const b = oc.dot(dir);
    const cc = oc.dot(oc) - r * r;
    const disc = b * b - cc;
    if (disc < 0) return null;
    const t = -b - Math.sqrt(disc);
    if (t < 0 || t > maxDist) return null;
    return { t, head: false };
  }
  const h = c.crouching ? c.height * 0.65 : c.height;
  // head sphere
  const headC = _o.copy(c.pos);
  headC.y += h - 0.12;
  const headR = 0.17;
  {
    const oc = _d.copy(origin).sub(headC);
    const b = oc.dot(dir);
    const cc = oc.dot(oc) - headR * headR;
    const disc = b * b - cc;
    if (disc >= 0) {
      const t = -b - Math.sqrt(disc);
      if (t > 0 && t < maxDist) return { t, head: true };
    }
  }
  // body: vertical cylinder from feet to h-0.25
  const r = c.radius;
  const ox = origin.x - c.pos.x;
  const oz = origin.z - c.pos.z;
  const a = dir.x * dir.x + dir.z * dir.z;
  if (a < 1e-6) return null;
  const b = 2 * (ox * dir.x + oz * dir.z);
  const cc = ox * ox + oz * oz - r * r;
  const disc = b * b - 4 * a * cc;
  if (disc < 0) return null;
  const t = (-b - Math.sqrt(disc)) / (2 * a);
  if (t < 0 || t > maxDist) return null;
  const y = origin.y + dir.y * t;
  if (y < c.pos.y || y > c.pos.y + h - 0.2) return null;
  return { t, head: false };
}

/** Area damage with falloff, visual explosion and screen shake. */
export function explode(world: BattleWorld, pos: THREE.Vector3, radius: number, damage: number, attacker: Combatant | null, size = 1, colorHex = 0xffa040) {
  world.effects.explosion(pos, size, colorHex);
  if (size >= 1) world.effects.scorch(pos, radius * 0.45);
  for (const c of world.combatants) {
    if (!c.alive) continue;
    const d = c.pos.distanceTo(pos);
    if (d > radius) continue;
    const f = 1 - (d / radius) * 0.8;
    // light cover check: blocked by buildings between
    const chest = c.pos.clone();
    chest.y += 1;
    const blocked = !hasLOS(world.field, pos.clone().add(new THREE.Vector3(0, 0.8, 0)), chest);
    c.takeDamage(damage * f * (blocked ? 0.35 : 1) * (c.isVehicle ? 0.5 : 1), attacker);
  }
}
