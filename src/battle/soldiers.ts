import * as THREE from 'three';
import type { WeaponDef, EraId } from '../data/types';
import type { Team } from './types';
import { HALF, type Battlefield } from './terrain';
import { hasLOS, soundAt, type BattleWorld, type Combatant } from './combat';
import { audio } from '../audio/audio';
import { clamp } from '../core/math';

export const UNIFORM_COLORS: Record<string, number> = {
  britain: 0x6b6a4a, france: 0x6b7fa0, germany: 0x5b6357, russia: 0x6e6a4c, ottoman: 0x8a7a55, usa: 0x6f6b4b,
  uk: 0x7a7350, ussr: 0x6f6a45, japan: 0x6f6b45, china: 0x5e6a58, nato: 0x66705a, regional: 0x7a7455, minor: 0x7c7460,
};

let soldierSeq = 1;

export type SquadMode = 'auto' | 'follow' | 'hold' | 'attack';

export class Squad {
  members: Soldier[] = [];
  mode: SquadMode = 'auto';
  objective: THREE.Vector3 | null = null;
  leader: Combatant | null = null;
  readonly id: number;
  constructor(readonly team: Team, id: number, readonly isPlayerSquad = false) {
    this.id = id;
  }
  get alive(): Soldier[] {
    return this.members.filter((m) => m.alive);
  }
  center(): THREE.Vector3 {
    const c = new THREE.Vector3();
    const a = this.alive;
    if (!a.length) return c;
    for (const m of a) c.add(m.pos);
    return c.divideScalar(a.length);
  }
}

interface SoldierStyle {
  uniform: number;
  era: EraId;
  team: Team;
  accent: number;
}

let markerTex: THREE.Texture | null = null;
function getMarkerTexture(): THREE.Texture {
  if (markerTex) return markerTex;
  const c = document.createElement('canvas');
  c.width = c.height = 32;
  const ctx = c.getContext('2d')!;
  ctx.beginPath();
  ctx.arc(16, 16, 12, 0, Math.PI * 2);
  ctx.fillStyle = '#fff';
  ctx.fill();
  ctx.lineWidth = 3;
  ctx.strokeStyle = 'rgba(0,0,0,0.6)';
  ctx.stroke();
  markerTex = new THREE.CanvasTexture(c);
  return markerTex;
}

const geoCache = new Map<string, THREE.BufferGeometry>();
const g = (key: string, make: () => THREE.BufferGeometry) => {
  let v = geoCache.get(key);
  if (!v) {
    v = make();
    geoCache.set(key, v);
  }
  return v;
};
const matCache = new Map<number, THREE.MeshStandardMaterial>();
const mat = (color: number, rough = 0.9) => {
  let m = matCache.get(color);
  if (!m) {
    m = new THREE.MeshStandardMaterial({ color, roughness: rough });
    matCache.set(color, m);
  }
  return m;
};

export function buildSoldierMesh(style: SoldierStyle): { group: THREE.Group; legs: THREE.Object3D[]; torso: THREE.Object3D; arms: THREE.Object3D; marker: THREE.Sprite } {
  const group = new THREE.Group();
  const uniform = mat(style.uniform);
  const skin = mat(0xc9a27e);
  const dark = mat(0x2a2a2a, 0.6);
  const torso = new THREE.Mesh(g('torso', () => new THREE.BoxGeometry(0.46, 0.62, 0.28)), uniform);
  torso.position.y = 1.12;
  torso.castShadow = true;
  const head = new THREE.Mesh(g('head', () => new THREE.SphereGeometry(0.13, 10, 8)), skin);
  head.position.y = 1.56;
  const helmetColor = style.era === 'ww1' ? (style.uniform === 0x5b6357 ? 0x4a4f48 : 0x5d5a3d) : style.era === 'ww2' ? 0x4d5142 : 0x55594a;
  let helmet: THREE.Mesh;
  if (style.era === 'ww1') {
    helmet = new THREE.Mesh(g('brodie', () => new THREE.CylinderGeometry(0.2, 0.22, 0.07, 12)), mat(helmetColor));
    helmet.position.y = 1.63;
    const dome = new THREE.Mesh(g('dome', () => new THREE.SphereGeometry(0.14, 10, 8, 0, Math.PI * 2, 0, Math.PI / 2)), mat(helmetColor));
    dome.position.y = 1.6;
    group.add(dome);
  } else {
    helmet = new THREE.Mesh(g('helm', () => new THREE.SphereGeometry(0.155, 10, 8, 0, Math.PI * 2, 0, Math.PI / 1.7)), mat(helmetColor));
    helmet.position.y = 1.56;
    if (style.era === 'modern') {
      const nvg = new THREE.Mesh(g('nvg', () => new THREE.BoxGeometry(0.06, 0.06, 0.1)), dark);
      nvg.position.set(0, 1.64, 0.16);
      group.add(nvg);
    }
  }
  const legL = new THREE.Mesh(g('leg', () => new THREE.CylinderGeometry(0.08, 0.075, 0.82, 7)), mat(style.era === 'modern' ? style.uniform : style.uniform - 0x0a0a0a));
  legL.position.set(-0.11, 0.41, 0);
  const legR = legL.clone();
  legR.position.x = 0.11;
  legL.castShadow = legR.castShadow = true;
  const arms = new THREE.Group();
  const armL = new THREE.Mesh(g('arm', () => new THREE.CylinderGeometry(0.06, 0.055, 0.6, 6)), uniform);
  armL.position.set(-0.28, 1.2, 0.1);
  armL.rotation.x = -1.2;
  const armR = armL.clone();
  armR.position.set(0.24, 1.2, 0.15);
  armR.rotation.x = -1.4;
  const rifle = new THREE.Mesh(g('rifle', () => new THREE.BoxGeometry(0.06, 0.08, 0.95)), dark);
  rifle.position.set(0.05, 1.3, 0.42);
  arms.add(armL, armR, rifle);
  // team accent band on arm + backpack
  const band = new THREE.Mesh(g('band', () => new THREE.CylinderGeometry(0.065, 0.065, 0.1, 6)), mat(style.accent));
  band.position.set(-0.28, 1.35, 0.06);
  band.rotation.x = -1.2;
  const pack = new THREE.Mesh(g('pack', () => new THREE.BoxGeometry(0.34, 0.4, 0.16)), mat(style.uniform - 0x101008));
  pack.position.set(0, 1.15, -0.2);
  group.add(torso, head, helmet, legL, legR, arms, band, pack);
  const marker = new THREE.Sprite(new THREE.SpriteMaterial({ map: getMarkerTexture(), color: style.team === 'player' ? 0x6fb8ff : 0xff5a4a, transparent: true, opacity: 0.85, depthTest: false }));
  marker.scale.set(0.22, 0.22, 1);
  marker.position.y = 2.05;
  marker.visible = style.team === 'player';
  group.add(marker);
  return { group, legs: [legL, legR], torso, arms, marker };
}

export class Soldier implements Combatant {
  readonly id = soldierSeq++;
  pos = new THREE.Vector3();
  alive = true;
  height = 1.7;
  radius = 0.32;
  isVehicle = false;
  isPlayer = false;
  moving = false;
  crouching = false;
  hp = 100;
  yaw = 0;
  readonly group: THREE.Group;
  private legs: THREE.Object3D[];
  private arms: THREE.Object3D;
  private torsoObj: THREE.Object3D;
  private marker: THREE.Sprite;
  private walkPhase = 0;
  private target: Combatant | null = null;
  private perceiveTimer = Math.random() * 0.3;
  private fireTimer = 0;
  private burstLeft = 0;
  private coverPos: THREE.Vector3 | null = null;
  private coverUntil = 0;
  private lastHit = -10;
  private goal = new THREE.Vector3();
  private offset = new THREE.Vector3((Math.random() - 0.5) * 8, 0, (Math.random() - 0.5) * 8);
  private deadTime = 0;
  private speed = 0;
  private vel = new THREE.Vector3();
  private stuckTimer = 0;
  private hasMask: boolean;
  private muzzle = new THREE.Vector3();
  squad: Squad | null = null;
  kills = 0;
  readonly name: string;

  constructor(
    readonly world: BattleWorld,
    readonly team: Team,
    start: THREE.Vector3,
    readonly weapon: WeaponDef,
    readonly accuracy: number,
    style: SoldierStyle,
    hasMask: boolean,
    name: string,
  ) {
    const built = buildSoldierMesh(style);
    this.group = built.group;
    this.legs = built.legs;
    this.arms = built.arms;
    this.torsoObj = built.torso;
    this.marker = built.marker;
    this.pos.copy(start);
    this.pos.y = world.field.heightAt(start.x, start.z);
    this.group.position.copy(this.pos);
    this.hasMask = hasMask;
    this.name = name;
    this.goal.copy(this.pos);
  }

  takeDamage(amount: number, attacker: Combatant | null, headshot = false) {
    if (!this.alive) return;
    this.hp -= amount * (headshot ? 2.5 : 1);
    this.lastHit = this.world.time;
    if (this.hp <= 0) this.die(attacker);
    else if (!this.coverPos && Math.random() < 0.5) this.seekCover();
  }

  private die(attacker: Combatant | null) {
    this.alive = false;
    this.deadTime = this.world.time;
    this.marker.visible = false;
    this.world.onKill(attacker, this);
    this.world.effects.impact(this.pos.clone().add(new THREE.Vector3(0, 1.1, 0)), 'blood', 12);
  }

  private seekCover() {
    const field = this.world.field;
    let best: THREE.Vector3 | null = null;
    let bestD = 18;
    const towardEnemy = this.target ? this.target.pos : null;
    for (const c of field.coverPoints) {
      const d = c.distanceTo(this.pos);
      if (d < bestD && d > 1) {
        // prefer cover between us and the enemy
        if (towardEnemy) {
          const dirToEnemy = towardEnemy.clone().sub(this.pos).normalize();
          const dirToCover = c.clone().sub(this.pos).normalize();
          if (dirToEnemy.dot(dirToCover) < -0.3) continue;
        }
        bestD = d;
        best = c;
      }
    }
    if (best) {
      this.coverPos = best.clone();
      this.coverUntil = this.world.time + 3 + Math.random() * 4;
    }
  }

  private perceive() {
    const range = this.weapon.range * 0.75 + 40;
    let best: Combatant | null = null;
    let bestD = range;
    const eye = this.pos.clone();
    eye.y += this.crouching ? 1.1 : 1.55;
    const nightPenalty = this.world.night ? 0.7 : 1;
    for (const c of this.world.combatants) {
      if (!c.alive || c.team === this.team) continue;
      const d = c.pos.distanceTo(this.pos);
      if (d > bestD * nightPenalty && !(c.isVehicle && d < bestD)) continue;
      if (d < bestD) {
        const chest = c.pos.clone();
        chest.y += c.isVehicle ? 1.2 : c.crouching ? 0.9 : 1.3;
        if (hasLOS(this.world.field, eye, chest)) {
          best = c;
          bestD = d;
        }
      }
    }
    this.target = best;
  }

  private fire(dt: number) {
    const t = this.target;
    if (!t || !t.alive) return;
    const rpmInterval = 60 / this.weapon.rpm;
    this.fireTimer -= dt;
    if (this.fireTimer > 0) return;
    if (this.burstLeft <= 0) {
      // start a new burst after a pause
      this.burstLeft = this.weapon.auto ? 3 + Math.floor(Math.random() * 4) : 1;
      this.fireTimer = this.weapon.auto ? 0.5 + Math.random() * 0.8 : this.weapon.boltAction ? 1.1 + Math.random() * 0.8 : 0.5 + Math.random() * 0.5;
      return;
    }
    this.burstLeft--;
    this.fireTimer = rpmInterval;
    const dist = t.pos.distanceTo(this.pos);
    const teamAcc = this.team === 'enemy' ? this.world.enemyAccuracyMult : this.world.friendlyAccuracyMult;
    let hitChance = this.accuracy * teamAcc * clamp(1.15 - dist / (this.weapon.range * 1.1), 0.05, 1);
    if (t.moving) hitChance *= 0.65;
    if (t.crouching) hitChance *= 0.7;
    if (this.moving) hitChance *= 0.55;
    if (t.isPlayer) hitChance *= 0.8; // a bit of player forgiveness
    if (t.isVehicle) hitChance *= 1.5;
    if (this.world.night && !this.world.revealed) hitChance *= 0.85;
    const hit = Math.random() < hitChance;
    // visuals
    const from = this.muzzle.copy(this.pos);
    from.y += this.crouching ? 1.05 : 1.35;
    const aim = t.pos.clone();
    aim.y += t.isVehicle ? 1.2 : 0.9 + Math.random() * 0.6;
    if (!hit) aim.add(new THREE.Vector3((Math.random() - 0.5) * 3, (Math.random() - 0.5) * 1.5, (Math.random() - 0.5) * 3));
    const dir = aim.clone().sub(from).normalize();
    const maxD = from.distanceTo(aim) + (hit ? 0 : 30);
    const obst = this.world.field.raycast(from, dir, maxD);
    const end = from.clone().add(dir.clone().multiplyScalar(Math.min(obst, maxD)));
    this.world.effects.tracer(from, end, this.team === 'enemy' ? 0xff7050 : 0xffe0a0);
    if (obst < maxD) this.world.effects.impact(end, 'dust', 4);
    if (Math.random() < 0.6) this.world.effects.muzzleFlash(from);
    const s = soundAt(this.world, from);
    if (s.distance < 220 && Math.random() < (s.distance < 40 ? 1 : 0.5)) audio.gunshot(this.weapon.sound, s.distance, s.pan);
    if (hit) {
      const dmg = this.weapon.damage * (0.7 + Math.random() * 0.5) * (t.isVehicle ? 0.05 : 1);
      t.takeDamage(dmg, this, false);
    }
    this.yaw = Math.atan2(dir.x, dir.z);
  }

  private chooseGoal(points: { pos: THREE.Vector3; owner: Team | null; progress: number }[]) {
    const sq = this.squad;
    if (sq) {
      if (sq.mode === 'follow' && sq.leader && sq.leader.alive) {
        this.goal.copy(sq.leader.pos).add(this.offset.clone().multiplyScalar(0.5));
        return;
      }
      if (sq.mode === 'hold' && sq.objective) {
        this.goal.copy(sq.objective).add(this.offset.clone().multiplyScalar(0.6));
        return;
      }
      if (sq.mode === 'attack' && sq.objective) {
        this.goal.copy(sq.objective).add(this.offset.clone().multiplyScalar(0.6));
        return;
      }
      if (sq.objective && sq.mode === 'auto') {
        this.goal.copy(sq.objective).add(this.offset);
        return;
      }
    }
    // Auto: nearest point not owned by us (prefer contested), weighted by distance
    let best: THREE.Vector3 | null = null;
    let bestScore = Infinity;
    for (const p of points) {
      const mine = p.owner === this.team && ((this.team === 'player' && p.progress >= 1) || (this.team === 'enemy' && p.progress <= -1));
      const d = p.pos.distanceTo(this.pos);
      let score = d;
      if (mine) score += 500;
      if (p.owner && p.owner !== this.team) score -= 20;
      if (score < bestScore) {
        bestScore = score;
        best = p.pos;
      }
    }
    if (best) this.goal.copy(best).add(this.offset);
  }

  update(dt: number, points: { pos: THREE.Vector3; owner: Team | null; progress: number }[]) {
    const field = this.world.field;
    if (!this.alive) {
      const t = this.world.time - this.deadTime;
      const k = Math.min(1, t * 2.5);
      this.group.rotation.x = -Math.PI / 2 * k * 0.95;
      this.group.position.y = this.pos.y + 0.1 * k;
      if (t > 20) this.group.position.y = this.pos.y - (t - 20) * 0.1;
      return;
    }
    this.perceiveTimer -= dt;
    if (this.perceiveTimer <= 0) {
      this.perceiveTimer = 0.25 + Math.random() * 0.15;
      this.perceive();
      if (this.squad?.mode !== 'follow' || Math.random() < 0.3) this.chooseGoal(points);
      // gas
      for (const gc of this.world.gasClouds) {
        if (this.pos.distanceTo(gc.pos) < gc.radius && !this.hasMask) this.takeDamage(6 * gc.strength * 0.4, null);
      }
    }
    const underFire = this.world.time - this.lastHit < 3;
    const hasTarget = !!this.target && this.target.alive;
    const distToTarget = hasTarget ? this.target!.pos.distanceTo(this.pos) : Infinity;
    // Decide movement
    let dest: THREE.Vector3 | null = null;
    if (this.coverPos && this.world.time < this.coverUntil) dest = this.coverPos;
    else {
      this.coverPos = null;
      const holdRange = this.weapon.kind === 'lmg' ? 0.55 : this.weapon.kind === 'smg' ? 0.25 : 0.45;
      if (hasTarget && distToTarget < this.weapon.range * holdRange && this.squad?.mode !== 'follow') dest = null;
      else dest = this.goal;
    }
    this.crouching = hasTarget && !dest && underFire;
    const wantMove = dest ? dest.distanceTo(this.pos) > 1.8 : false;
    if (wantMove && dest) {
      const dir = dest.clone().sub(this.pos);
      dir.y = 0;
      dir.normalize();
      // separation
      for (const c of this.world.combatants) {
        if (c === this || !c.alive || c.isVehicle) continue;
        const dx = this.pos.x - c.pos.x;
        const dz = this.pos.z - c.pos.z;
        const d2 = dx * dx + dz * dz;
        if (d2 < 2.5 && d2 > 0.001) {
          const inv = (1.6 - Math.sqrt(d2)) / 1.6;
          dir.x += (dx / Math.sqrt(d2)) * inv * 1.5;
          dir.z += (dz / Math.sqrt(d2)) * inv * 1.5;
        }
      }
      dir.normalize();
      const targetSpeed = hasTarget ? 3.2 : 4.6;
      this.speed += (targetSpeed - this.speed) * Math.min(1, dt * 6);
      const before = this.pos.clone();
      this.pos.x += dir.x * this.speed * dt;
      this.pos.z += dir.z * this.speed * dt;
      this.pos.x = clamp(this.pos.x, -HALF + 4, HALF - 4);
      this.pos.z = clamp(this.pos.z, -HALF + 4, HALF - 4);
      field.resolveCollision(this.pos, 0.4, 1.6);
      const moved = before.distanceTo(this.pos);
      if (moved < this.speed * dt * 0.3) {
        this.stuckTimer += dt;
        if (this.stuckTimer > 1.2) {
          // sidestep
          this.offset.set((Math.random() - 0.5) * 14, 0, (Math.random() - 0.5) * 14);
          this.goal.add(new THREE.Vector3((Math.random() - 0.5) * 12, 0, (Math.random() - 0.5) * 12));
          this.coverPos = null;
          this.stuckTimer = 0;
        }
      } else this.stuckTimer = 0;
      if (!hasTarget) this.yaw = Math.atan2(dir.x, dir.z);
      this.moving = true;
      this.walkPhase += dt * this.speed * 2.2;
    } else {
      this.speed *= 0.8;
      this.moving = false;
      this.walkPhase *= 0.9;
    }
    this.pos.y = field.heightAt(this.pos.x, this.pos.z);
    if (hasTarget) {
      const d = this.target!.pos.clone().sub(this.pos);
      this.yaw = Math.atan2(d.x, d.z);
      this.fire(dt);
    } else this.burstLeft = 0;
    // pose
    this.group.position.copy(this.pos);
    this.group.rotation.y = this.yaw;
    this.group.rotation.x = 0;
    const swing = Math.sin(this.walkPhase) * 0.6 * Math.min(1, this.speed / 3);
    this.legs[0].rotation.x = swing;
    this.legs[1].rotation.x = -swing;
    const crouchScale = this.crouching ? 0.72 : 1;
    this.group.scale.y += (crouchScale - this.group.scale.y) * Math.min(1, dt * 8);
    this.arms.rotation.x = hasTarget ? -0.15 : 0.05;
    this.marker.visible = this.team === 'player' || this.world.revealed;
    if (this.team === 'enemy') (this.marker.material as THREE.SpriteMaterial).color.setHex(0xff5a4a);
  }
}
