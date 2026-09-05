import * as THREE from 'three';
import type { Team } from './types';
import { HALF } from './terrain';
import { hasLOS, soundAt, type BattleWorld, type Combatant } from './combat';
import type { Support } from './support';
import type { Input } from './input';
import { audio } from '../audio/audio';
import { clamp } from '../core/math';

let vehicleSeq = 1000;

export class Tank implements Combatant {
  readonly id = vehicleSeq++;
  pos = new THREE.Vector3();
  alive = true;
  height = 2.4;
  radius = 2.6;
  isVehicle = true;
  isPlayer = false;
  moving = false;
  crouching = false;
  hp: number;
  maxHp: number;
  yaw = 0;
  turretYaw = 0;
  readonly group = new THREE.Group();
  private turret: THREE.Group;
  private barrel: THREE.Mesh;
  private muzzle = new THREE.Object3D();
  private gun = new THREE.Group();
  private speed = 0;
  private reload = 0;
  shells = 30;
  get reloading(): boolean {
    return this.reload > 0;
  }
  mgTimer = 0;
  private target: Combatant | null = null;
  private perceive = 0;
  private goal: THREE.Vector3 | null = null;
  private wreck = false;
  private smokeTimer = 0;
  playerControlled = false;
  readonly name: string;

  constructor(readonly world: BattleWorld, readonly team: Team, start: THREE.Vector3, color: number, armorMult: number, name: string, readonly support: Support) {
    this.name = name;
    this.maxHp = Math.round(520 * armorMult);
    this.hp = this.maxHp;
    const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.6, metalness: 0.45 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x1e1e1e, roughness: 0.8 });
    const hull = new THREE.Mesh(new THREE.BoxGeometry(3.2, 1.1, 6.2), mat);
    hull.position.y = 1.0;
    const glacis = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.7, 1.4), mat);
    glacis.position.set(0, 1.35, -2.6);
    glacis.rotation.x = 0.5;
    const trackL = new THREE.Mesh(new THREE.BoxGeometry(0.7, 1.0, 6.4), dark);
    trackL.position.set(-1.7, 0.6, 0);
    const trackR = trackL.clone();
    trackR.position.x = 1.7;
    this.turret = new THREE.Group();
    const tur = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 1.35, 0.8, 12), mat);
    tur.position.y = 0.4;
    this.barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.13, 4.2, 8), dark);
    this.barrel.rotation.x = Math.PI / 2;
    this.barrel.position.set(0, 0, -2.6);
    this.muzzle.position.set(0, 0, -4.7);
    // barrel and muzzle share a group so the gun can elevate as one piece
    this.gun.position.y = 0.45;
    this.gun.add(this.barrel, this.muzzle);
    this.turret.add(tur, this.gun);
    this.turret.position.y = 1.55;
    this.group.add(hull, glacis, trackL, trackR, this.turret);
    this.group.traverse((o) => {
      (o as THREE.Mesh).castShadow = true;
      (o as THREE.Mesh).receiveShadow = true;
    });
    this.pos.copy(start);
    this.pos.y = world.field.heightAt(start.x, start.z);
    this.group.position.copy(this.pos);
  }

  takeDamage(amount: number, attacker: Combatant | null) {
    if (!this.alive) return;
    this.hp -= amount;
    if (this.hp <= 0) {
      this.hp = 0;
      this.alive = false;
      this.wreck = true;
      this.world.onKill(attacker, this);
      this.world.effects.explosion(this.pos.clone().add(new THREE.Vector3(0, 1.5, 0)), 2.2);
      const s = soundAt(this.world, this.pos);
      audio.explosion(s.distance, s.pan, 2);
      this.group.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.isMesh) m.material = new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 1 });
      });
    }
  }

  fireCannon(aimPoint?: THREE.Vector3): boolean {
    if (this.reload > 0 || this.shells <= 0 || !this.alive) return false;
    this.reload = 4;
    this.shells--;
    const from = new THREE.Vector3();
    this.muzzle.getWorldPosition(from);
    const dir = aimPoint
      ? aimPoint.clone().sub(from).normalize()
      : new THREE.Vector3(0, 0, -1).applyQuaternion(this.gun.getWorldQuaternion(new THREE.Quaternion()));
    this.support.spawnShell(from, dir.multiplyScalar(130), 170, 7, this, 1.5, 4);
    this.world.effects.muzzleFlash(from, true);
    this.world.effects.explosion(from, 0.35);
    const s = soundAt(this.world, from);
    audio.explosion(s.distance, s.pan, 0.7);
    return true;
  }

  fireMG(target: THREE.Vector3): void {
    if (this.mgTimer > 0 || !this.alive) return;
    this.mgTimer = 0.1;
    const from = new THREE.Vector3();
    this.muzzle.getWorldPosition(from);
    from.y -= 0.2;
    const aim = target.clone().add(new THREE.Vector3((Math.random() - 0.5) * 1.5, (Math.random() - 0.5) * 0.8, (Math.random() - 0.5) * 1.5));
    const dir = aim.clone().sub(from).normalize();
    const maxD = 200;
    const obst = this.world.field.raycast(from, dir, maxD);
    let hitD = obst;
    let victim: Combatant | null = null;
    for (const c of this.world.combatants) {
      if (!c.alive || c.team === this.team || c === this) continue;
      const cc = c.pos.clone();
      cc.y += 1;
      const toC = cc.clone().sub(from);
      const t = toC.dot(dir);
      if (t < 0 || t > hitD) continue;
      const perp = toC.sub(dir.clone().multiplyScalar(t)).length();
      if (perp < (c.isVehicle ? 2 : 0.55)) {
        hitD = t;
        victim = c;
      }
    }
    const end = from.clone().addScaledVector(dir, Math.min(hitD, maxD));
    this.world.effects.tracer(from, end, 0xffe0a0);
    if (victim) victim.takeDamage(victim.isVehicle ? 2 : 30, this);
    else if (hitD < maxD) this.world.effects.impact(end, 'dust', 4);
    const s = soundAt(this.world, from);
    if (Math.random() < 0.6) audio.gunshot('heavy', s.distance, s.pan);
  }

  private drive(dt: number, forward: number, turn: number) {
    const field = this.world.field;
    const targetSpeed = forward * (forward > 0 ? 7 : 4);
    this.speed += (targetSpeed - this.speed) * Math.min(1, dt * 1.5);
    this.yaw += turn * dt * 0.8 * (Math.abs(this.speed) > 0.5 ? 1 : 0.6);
    const dir = new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    const next = this.pos.clone().addScaledVector(dir, this.speed * dt);
    next.x = clamp(next.x, -HALF + 6, HALF - 6);
    next.z = clamp(next.z, -HALF + 6, HALF - 6);
    const before = next.clone();
    field.resolveCollision(next, 2.2, 2);
    if (before.distanceToSquared(next) > 0.01) this.speed *= 0.3;
    this.pos.copy(next);
    this.pos.y = field.heightAt(this.pos.x, this.pos.z);
    this.moving = Math.abs(this.speed) > 0.5;
    // tilt with terrain
    const hf = field.heightAt(this.pos.x + dir.x * 2.5, this.pos.z + dir.z * 2.5);
    const hb = field.heightAt(this.pos.x - dir.x * 2.5, this.pos.z - dir.z * 2.5);
    const pitch = Math.atan2(hf - hb, 5);
    this.group.position.copy(this.pos);
    this.group.rotation.set(-pitch, this.yaw, 0);
    this.turret.rotation.y = this.turretYaw - this.yaw;
  }

  /** Player control: WASD drive, mouse turret, LMB cannon, RMB MG. Camera third person. */
  /**
   * Player driving. The camera orbits behind and slightly above the hull and
   * looks down its own axis, so the crosshair sits on the ground ahead of the
   * tank rather than on the tank itself, and the gun fires where it points.
   */
  controlUpdate(dt: number, input: Input, camera: THREE.PerspectiveCamera, camPitchRef: { yaw: number; pitch: number }) {
    if (!this.alive) return;
    const axis = input.moveAxis();
    this.drive(dt, axis.y, -axis.x);
    if (input.locked || input.touchLook) {
      camPitchRef.yaw -= input.mouseDX * 0.0022;
      // same sense as on foot: drag down to look down, which lifts the camera
      camPitchRef.pitch = clamp(camPitchRef.pitch - input.mouseDY * 0.0022, -0.5, 0.22);
    }
    const yaw = camPitchRef.yaw;
    const p = camPitchRef.pitch;
    const cp = Math.cos(p);
    // the direction the player is looking
    const look = new THREE.Vector3(-Math.sin(yaw) * cp, Math.sin(p), -Math.cos(yaw) * cp);
    const anchor = this.pos.clone().add(new THREE.Vector3(0, 2.3, 0));
    const dist = 12;
    const camPos = anchor.clone().addScaledVector(look, -dist).add(new THREE.Vector3(0, 1.2, 0));
    // pull in if terrain or a building is between the tank and the camera
    const toCam = camPos.clone().sub(anchor);
    const want = toCam.length();
    const hit = this.world.field.raycast(anchor, toCam.clone().normalize(), want);
    if (hit < want) camPos.copy(anchor).addScaledVector(toCam.normalize(), Math.max(3.5, hit - 0.6));
    const ground = this.world.field.heightAt(camPos.x, camPos.z) + 1.0;
    if (camPos.y < ground) camPos.y = ground;
    camera.position.lerp(camPos, Math.min(1, dt * 12));
    camera.lookAt(anchor.clone().addScaledVector(look, 60));

    // where the crosshair lands, and therefore where the gun shoots
    const aim = this.aimPoint(camera);
    // turret tracks the aim, the gun elevates to match
    const wantYaw = Math.atan2(-(aim.x - this.pos.x), -(aim.z - this.pos.z));
    let d = wantYaw - this.turretYaw;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    this.turretYaw += clamp(d, -dt * 1.8, dt * 1.8);
    this.turret.rotation.y = this.turretYaw - this.yaw;
    const flat = Math.hypot(aim.x - this.pos.x, aim.z - this.pos.z);
    const elev = clamp(Math.atan2(aim.y - (this.pos.y + 2.0), Math.max(1, flat)), -0.18, 0.3);
    this.gun.rotation.x += clamp(-elev - this.gun.rotation.x, -dt * 1.5, dt * 1.5);

    if (input.mousePressed(0)) this.fireCannon(aim);
    if (input.mouseDown(2)) this.fireMG(aim);
  }

  /** First thing the camera's centre line meets, or a point far downrange. */
  private aimPoint(camera: THREE.PerspectiveCamera): THREE.Vector3 {
    const origin = new THREE.Vector3();
    camera.getWorldPosition(origin);
    const dir = new THREE.Vector3();
    camera.getWorldDirection(dir);
    const maxDist = 400;
    let best = this.world.field.raycast(origin, dir, maxDist);
    for (const c of this.world.combatants) {
      if (!c.alive || c === this || c.team === this.team) continue;
      const centre = c.pos.clone();
      centre.y += c.isVehicle ? 1.2 : 0.9;
      const to = centre.clone().sub(origin);
      const along = to.dot(dir);
      if (along < 4 || along > best) continue;
      if (to.sub(dir.clone().multiplyScalar(along)).length() < (c.isVehicle ? 2.5 : 1.1)) best = along;
    }
    return origin.addScaledVector(dir, Math.min(best, maxDist));
  }

  update(dt: number, points: { pos: THREE.Vector3; owner: Team | null }[]) {
    this.reload = Math.max(0, this.reload - dt);
    this.mgTimer = Math.max(0, this.mgTimer - dt);
    if (this.wreck) {
      this.smokeTimer -= dt;
      if (this.smokeTimer <= 0) {
        this.smokeTimer = 0.25;
        const p = this.pos;
        this.world.effects.particle(p.x + (Math.random() - 0.5), p.y + 2.2, p.z + (Math.random() - 0.5), 0, 1.5 + Math.random(), 0, 0.15, 0.15, 0.15, 2.5, 3, -0.3);
      }
      return;
    }
    if (this.playerControlled) return;
    // AI
    this.perceive -= dt;
    if (this.perceive <= 0) {
      this.perceive = 0.4;
      let best: Combatant | null = null;
      let bestD = 170;
      const eye = this.pos.clone().add(new THREE.Vector3(0, 2.2, 0));
      for (const c of this.world.combatants) {
        if (!c.alive || c.team === this.team) continue;
        const d = c.pos.distanceTo(this.pos);
        const score = c.isVehicle ? d * 0.5 : d;
        if (score < bestD) {
          const chest = c.pos.clone().add(new THREE.Vector3(0, 1.2, 0));
          if (hasLOS(this.world.field, eye, chest)) {
            best = c;
            bestD = score;
          }
        }
      }
      this.target = best;
      // goal: nearest point not ours
      let bp: THREE.Vector3 | null = null;
      let bd = Infinity;
      for (const p of points) {
        const d = p.pos.distanceTo(this.pos);
        const s = d + (p.owner === this.team ? 400 : 0);
        if (s < bd) {
          bd = s;
          bp = p.pos;
        }
      }
      this.goal = bp;
    }
    let forward = 0;
    let turn = 0;
    if (this.goal && this.goal.distanceTo(this.pos) > 14) {
      const dir = this.goal.clone().sub(this.pos);
      const wantYaw = Math.atan2(-dir.x, -dir.z);
      let d = wantYaw - this.yaw;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      turn = clamp(d * 2, -1, 1);
      forward = Math.abs(d) < 0.8 ? 1 : 0.2;
    }
    if (this.target && this.target.alive) {
      const dir = this.target.pos.clone().sub(this.pos);
      const wantYaw = Math.atan2(-dir.x, -dir.z);
      let d = wantYaw - this.turretYaw;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      this.turretYaw += clamp(d, -dt * 1.4, dt * 1.4);
      if (Math.abs(d) < 0.08) {
        if (this.target.isVehicle || Math.random() < 0.3) this.fireCannon();
        else this.fireMG(this.target.pos.clone().add(new THREE.Vector3(0, 1, 0)));
      }
      forward *= 0.5;
    } else this.turretYaw = this.yaw;
    this.drive(dt, forward, turn);
  }

  dispose() {
    this.group.parent?.remove(this.group);
  }
}
