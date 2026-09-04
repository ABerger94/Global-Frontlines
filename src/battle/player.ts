import * as THREE from 'three';
import type { WeaponDef, KitId } from '../data/types';
import { HALF } from './terrain';
import { rayHitCombatant, explode, type BattleWorld, type Combatant } from './combat';
import type { Input } from './input';
import { audio } from '../audio/audio';
import { clamp, lerp } from '../core/math';

export interface PlayerConfig {
  weapons: WeaponDef[];
  jamChance: number;
  medkits: number;
  grenades: number;
  spreadMult: number;
  kit: KitId;
  hasMask: boolean;
  hasNVG: boolean;
  ammoMult: number;
}

interface WeaponState {
  def: WeaponDef;
  mag: number;
  reserve: number;
  reloadTimer: number;
  jammed: boolean;
  boltTimer: number;
  lastShot: number;
  model: THREE.Group;
  muzzle: THREE.Object3D;
}

interface Grenade {
  mesh: THREE.Mesh;
  vel: THREE.Vector3;
  timer: number;
}

function buildWeaponModel(def: WeaponDef): { group: THREE.Group; muzzle: THREE.Object3D } {
  const group = new THREE.Group();
  const metal = new THREE.MeshStandardMaterial({ color: 0x2b2b2b, roughness: 0.45, metalness: 0.7 });
  const wood = new THREE.MeshStandardMaterial({ color: 0x3e2a18, roughness: 0.75 });
  const poly = new THREE.MeshStandardMaterial({ color: 0x1e1f22, roughness: 0.8 });
  const isModern = ['m4a1', 'ak12', 'qbz191', 'hk416', 'ak103', 'm110', 'svd', 'qbu', 'm249', 'pkm', 'qjy201', 'm17', 'mp443', 'qsz92', 'glock17'].includes(def.id);
  const furniture = isModern ? poly : wood;
  const len = def.kind === 'pistol' ? 0.28 : def.kind === 'smg' ? 0.6 : def.kind === 'lmg' ? 1.05 : def.kind === 'dmr' ? 1.1 : 0.95;
  const receiver = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.08, len * 0.45), metal);
  receiver.position.z = -len * 0.2;
  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.014, len * 0.55, 8), metal);
  barrel.rotation.x = Math.PI / 2;
  barrel.position.set(0, 0.015, -len * 0.7);
  const stock = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.07, len * 0.35), furniture);
  stock.position.set(0, -0.015, len * 0.12);
  const grip = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.09, 0.04), furniture);
  grip.position.set(0, -0.07, -len * 0.05);
  grip.rotation.x = 0.3;
  const handguard = new THREE.Mesh(new THREE.BoxGeometry(0.048, 0.05, len * 0.35), furniture);
  handguard.position.set(0, 0, -len * 0.5);
  group.add(receiver, barrel, stock, grip, handguard);
  if (def.kind !== 'pistol' && !def.boltAction) {
    const mag = new THREE.Mesh(new THREE.BoxGeometry(0.03, def.kind === 'lmg' ? 0.06 : 0.14, 0.06), metal);
    mag.position.set(0, -0.1, -len * 0.25);
    group.add(mag);
  }
  if (def.kind === 'lmg' && (def.id === 'lewis' || def.id === 'dp28')) {
    const pan = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.02, 16), metal);
    pan.position.set(0, 0.07, -len * 0.25);
    group.add(pan);
  }
  const sight = new THREE.Mesh(new THREE.BoxGeometry(0.008, 0.03, 0.01), metal);
  sight.position.set(0, 0.055, -len * 0.05);
  const front = sight.clone();
  front.position.set(0, 0.05, -len * 0.9);
  group.add(sight, front);
  if (def.scoped) {
    const scope = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.2, 10), metal);
    scope.rotation.x = Math.PI / 2;
    scope.position.set(0, 0.08, -len * 0.15);
    group.add(scope);
  }
  if (def.kind === 'lmg') {
    const bipod = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.12, 0.01), metal);
    bipod.position.set(0, -0.08, -len * 0.85);
    group.add(bipod);
  }
  const muzzle = new THREE.Object3D();
  muzzle.position.set(0, 0.015, -len * 0.98);
  group.add(muzzle);
  const flash = new THREE.Sprite(new THREE.SpriteMaterial({ color: 0xffd28a, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthTest: false }));
  flash.scale.set(0.25, 0.25, 1);
  flash.name = 'flash';
  muzzle.add(flash);
  group.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).castShadow = false;
  });
  return { group, muzzle };
}

export class Player implements Combatant {
  readonly id = 0;
  readonly team = 'player' as const;
  pos = new THREE.Vector3(0, 0, -HALF + 20);
  alive = true;
  height = 1.7;
  radius = 0.35;
  isVehicle = false;
  isPlayer = true;
  moving = false;
  crouching = false;
  sprinting = false;
  hp = 100;
  maxHp = 100;
  yaw = 0;
  pitch = 0;
  vel = new THREE.Vector3();
  grounded = false;
  ads = false;
  adsAmount = 0;
  weapons: WeaponState[] = [];
  weaponIndex = 0;
  medkits: number;
  grenades: number;
  maskOn = false;
  nvgOn = false;
  kills = 0;
  deaths = 0;
  controlEnabled = true;
  protectedUntil = 0;
  readonly viewRoot = new THREE.Group();
  private grenadeList: Grenade[] = [];
  private bob = 0;
  private recoil = 0;
  private recoilPitch = 0;
  private healTimer = 0;
  private healAmount = 0;
  private baseFov: number;
  private shakeOffset = new THREE.Vector3();
  private cameraHolder = new THREE.Object3D();
  private switchTimer = 0;
  private eyeHeight = 1.62;
  private hurtCooldown = 0;
  private lastDamageTime = -100;
  private lastGroundY = 0;
  private landing = 0;
  onHit: ((kill: boolean, head: boolean) => void) | null = null;
  onNotify: ((msg: string, sub?: string) => void) | null = null;
  onShot: (() => void) | null = null;
  /** Called with the bearing of the attacker in radians (null when it is not directional). */
  onDamage: ((bearing: number | null) => void) | null = null;

  constructor(readonly world: BattleWorld, readonly camera: THREE.PerspectiveCamera, readonly cfg: PlayerConfig, readonly input: Input, readonly scene: THREE.Scene) {
    this.baseFov = camera.fov;
    this.medkits = cfg.medkits;
    this.grenades = cfg.grenades;
    for (const def of cfg.weapons) {
      const { group, muzzle } = buildWeaponModel(def);
      group.visible = false;
      this.viewRoot.add(group);
      this.weapons.push({ def, mag: def.magSize, reserve: Math.max(1, Math.round(def.magSize * def.reserveMags * cfg.ammoMult)), reloadTimer: 0, jammed: false, boltTimer: 0, lastShot: -10, model: group, muzzle });
    }
    this.weapons[0].model.visible = true;
    this.camera.add(this.viewRoot);
    this.viewRoot.scale.setScalar(0.5);
    this.viewRoot.position.set(0.17, -0.17, -0.36);
    scene.add(this.cameraHolder);
    this.cameraHolder.add(this.camera);
  }

  get weapon(): WeaponState {
    return this.weapons[this.weaponIndex];
  }

  spawn(pos: THREE.Vector3, yaw: number) {
    this.pos.copy(pos);
    this.pos.y = this.world.field.heightAt(pos.x, pos.z);
    this.yaw = yaw;
    this.pitch = 0;
    this.hp = this.maxHp;
    this.alive = true;
    this.lastDamageTime = this.world.time;
    // brief grace period so redeploying into a firefight is not an instant death
    this.protectedUntil = this.world.time + this.world.difficulty.spawnProtection;
    this.vel.set(0, 0, 0);
    for (const w of this.weapons) {
      w.jammed = false;
      w.reloadTimer = 0;
      if (w.mag === 0 && w.reserve > 0) {
        const take = Math.min(w.def.magSize, w.reserve);
        w.mag = take;
        w.reserve -= take;
      }
    }
    this.updateCamera(0);
  }

  takeDamage(amount: number, attacker: Combatant | null) {
    if (!this.alive) return;
    if (attacker && this.world.time < this.protectedUntil) return;
    this.hp -= amount * this.world.difficulty.playerDamage;
    this.lastDamageTime = this.world.time;
    if (attacker) {
      // Angle of the shooter relative to where the player is facing, for the hit indicator.
      const dx = attacker.pos.x - this.pos.x;
      const dz = attacker.pos.z - this.pos.z;
      const world = Math.atan2(dx, dz);
      this.onDamage?.(((world - (this.yaw + Math.PI) + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
    } else this.onDamage?.(null);
    if (this.hurtCooldown <= 0) {
      audio.hurt();
      this.hurtCooldown = 0.25;
    }
    if (this.hp <= 0) {
      this.hp = 0;
      this.alive = false;
      this.deaths++;
      this.world.onKill(attacker, this);
    }
  }

  heal(amount: number) {
    this.hp = Math.min(this.maxHp, this.hp + amount);
  }

  /** World point the player is looking at (for support call-ins). */
  aimPoint(maxDist = 400): THREE.Vector3 {
    const dir = new THREE.Vector3();
    this.camera.getWorldDirection(dir);
    const origin = this.eye();
    const d = this.world.field.raycast(origin, dir, maxDist);
    const t = Math.min(d, maxDist);
    const p = origin.add(dir.multiplyScalar(t));
    p.y = this.world.field.heightAt(p.x, p.z);
    return p;
  }

  eye(): THREE.Vector3 {
    return new THREE.Vector3(this.pos.x, this.pos.y + this.eyeHeight, this.pos.z);
  }

  private tryFire(now: number, dt: number) {
    const w = this.weapon;
    const def = w.def;
    if (w.reloadTimer > 0 || w.jammed || w.boltTimer > 0 || this.switchTimer > 0) return;
    if (w.mag <= 0) {
      if (this.input.mousePressed(0)) {
        audio.click(0.5);
        if (w.reserve > 0) this.startReload();
      }
      return;
    }
    const interval = 60 / def.rpm;
    const wantFire = def.auto ? this.input.mouseDown(0) : this.input.mousePressed(0);
    if (!wantFire || now - w.lastShot < interval) return;
    w.lastShot = now;
    w.mag--;
    // jam?
    if (Math.random() < this.cfg.jamChance) {
      w.jammed = true;
      audio.jam();
      this.onNotify?.('WEAPON JAMMED', 'Press R to clear');
      return;
    }
    audio.gunshot(def.sound, 0, 0);
    this.onShot?.();
    // spread
    const moveSpread = this.moving ? (this.sprinting ? 2.5 : 1.4) : 1;
    const crouchMult = this.crouching ? 0.7 : 1;
    const spread = lerp(def.spread, def.adsSpread, this.adsAmount) * this.cfg.spreadMult * moveSpread * crouchMult + this.recoil * 0.01;
    const dir = new THREE.Vector3();
    this.camera.getWorldDirection(dir);
    const right = new THREE.Vector3().crossVectors(dir, new THREE.Vector3(0, 1, 0)).normalize();
    const up = new THREE.Vector3().crossVectors(right, dir).normalize();
    const a = Math.random() * Math.PI * 2;
    const r = Math.sqrt(Math.random()) * spread;
    dir.add(right.multiplyScalar(Math.cos(a) * r)).add(up.multiplyScalar(Math.sin(a) * r)).normalize();
    const origin = this.eye();
    // find nearest hit among combatants & world
    const worldDist = this.world.field.raycast(origin, dir, def.range * 1.5);
    let best: { c: Combatant; t: number; head: boolean } | null = null;
    for (const c of this.world.combatants) {
      if (c === this || !c.alive || c.team === this.team) continue;
      const h = rayHitCombatant(origin, dir, c, Math.min(worldDist, def.range * 1.5));
      if (h && (!best || h.t < best.t)) best = { c, t: h.t, head: h.head };
    }
    const muzzleWorld = new THREE.Vector3();
    w.muzzle.getWorldPosition(muzzleWorld);
    if (best) {
      const hitPos = origin.clone().add(dir.clone().multiplyScalar(best.t));
      const falloff = clamp(1 - Math.max(0, best.t - def.range * 0.6) / def.range, 0.4, 1);
      const dmg = def.damage * (0.85 + Math.random() * 0.3) * falloff * (best.c.isVehicle ? 0.04 : 1);
      const wasAlive = best.c.alive;
      best.c.takeDamage(dmg, this, best.head);
      const killed = wasAlive && !best.c.alive;
      if (killed) this.kills++;
      this.onHit?.(killed, best.head);
      this.world.effects.impact(hitPos, best.c.isVehicle ? 'metal' : 'blood', 6);
      this.world.effects.tracer(muzzleWorld, hitPos);
      audio.hitmarker();
    } else {
      const t = Math.min(worldDist, def.range * 1.5);
      const end = origin.clone().add(dir.clone().multiplyScalar(t));
      this.world.effects.tracer(muzzleWorld, end);
      if (worldDist < def.range * 1.5) this.world.effects.impact(end, this.world.field.theme === 'urban' ? 'concrete' : this.world.field.theme === 'trench' ? 'mud' : 'dust', 8);
    }
    // muzzle flash
    const flash = w.muzzle.getObjectByName('flash') as THREE.Sprite;
    flash.material.opacity = 1;
    flash.material.rotation = Math.random() * Math.PI;
    this.world.effects.muzzleFlash(muzzleWorld, def.kind === 'lmg');
    // recoil
    this.recoil += def.recoil * 40 * (this.ads ? 0.7 : 1);
    this.recoilPitch += def.recoil * (this.ads ? 0.6 : 1) * (0.7 + Math.random() * 0.6);
    this.yaw += (Math.random() - 0.5) * def.recoil * 0.4;
    if (def.boltAction) w.boltTimer = 0.55;
    if (w.mag === 0 && w.reserve > 0 && !def.boltAction) setTimeout(() => this.startReload(), 250);
  }

  private startReload() {
    const w = this.weapon;
    if (w.reloadTimer > 0 || w.reserve <= 0 || w.mag >= w.def.magSize) return;
    w.reloadTimer = w.def.reloadTime;
    audio.reload();
  }

  private finishReload(w: WeaponState) {
    const need = w.def.magSize - w.mag;
    const take = Math.min(need, w.reserve);
    w.mag += take;
    w.reserve -= take;
  }

  private throwGrenade() {
    if (this.grenades <= 0) return;
    this.grenades--;
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 6), new THREE.MeshStandardMaterial({ color: 0x3a4a30, roughness: 0.8 }));
    const dir = new THREE.Vector3();
    this.camera.getWorldDirection(dir);
    mesh.position.copy(this.eye()).add(dir.clone().multiplyScalar(0.5));
    this.scene.add(mesh);
    this.grenadeList.push({ mesh, vel: dir.multiplyScalar(17).add(new THREE.Vector3(0, 4, 0)).add(this.vel.clone().multiplyScalar(0.5)), timer: 3 });
    audio.whoosh(2, 0);
  }

  private useMedkit() {
    if (this.medkits <= 0 || this.hp >= this.maxHp || this.healTimer > 0) return;
    this.medkits--;
    this.healTimer = 2;
    this.healAmount = this.cfg.kit === 'medic' ? 70 : 50;
    audio.heal();
  }

  update(dt: number, now: number) {
    const input = this.input;
    const field = this.world.field;
    this.hurtCooldown -= dt;
    // grenades physics always
    for (let i = this.grenadeList.length - 1; i >= 0; i--) {
      const gr = this.grenadeList[i];
      gr.timer -= dt;
      gr.vel.y -= 14 * dt;
      const next = gr.mesh.position.clone().add(gr.vel.clone().multiplyScalar(dt));
      const groundY = field.heightAt(next.x, next.z) + 0.07;
      if (next.y < groundY) {
        next.y = groundY;
        gr.vel.y = Math.abs(gr.vel.y) * 0.35;
        gr.vel.x *= 0.6;
        gr.vel.z *= 0.6;
      }
      if (field.insideCollider(next.x, next.y, next.z, 0.07)) {
        gr.vel.x *= -0.4;
        gr.vel.z *= -0.4;
      } else gr.mesh.position.copy(next);
      gr.mesh.rotation.x += dt * 6;
      if (gr.timer <= 0) {
        this.scene.remove(gr.mesh);
        this.grenadeList.splice(i, 1);
        explode(this.world, gr.mesh.position.clone(), 7, 110, this, 0.8);
        const d = gr.mesh.position.distanceTo(this.pos);
        audio.explosion(d, 0, 0.8);
      }
    }
    if (!this.alive) return;
    // out-of-combat recovery: without it a single unseen rifleman ends the round
    const regen = this.world.difficulty.regen;
    if (regen > 0 && this.hp < this.maxHp && this.world.time - this.lastDamageTime > 5) this.hp = Math.min(this.maxHp, this.hp + regen * dt);
    // healing
    if (this.healTimer > 0) {
      const step = Math.min(dt, this.healTimer);
      this.heal((this.healAmount / 2) * step);
      this.healTimer -= dt;
    }
    // gas
    for (const gc of this.world.gasClouds) {
      if (this.pos.distanceTo(gc.pos) < gc.radius && !this.maskOn) this.takeDamage(7 * gc.strength * dt, null);
    }
    // look
    if (this.controlEnabled && (input.locked || input.touchLook)) {
      const sens = 0.0021 * (this.ads ? lerp(1, 0.55, this.adsAmount) : 1);
      this.yaw -= input.mouseDX * sens;
      this.pitch -= input.mouseDY * sens;
      this.pitch = clamp(this.pitch, -1.45, 1.45);
    }
    // recoil recovery
    this.pitch += this.recoilPitch * dt * 12;
    this.recoilPitch *= Math.max(0, 1 - dt * 14);
    this.pitch = clamp(this.pitch, -1.45, 1.45);
    this.recoil *= Math.max(0, 1 - dt * 6);
    // movement
    const fwd = new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    const right = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    const wish = new THREE.Vector3();
    let moveAmount = 0;
    if (this.controlEnabled) {
      const axis = input.moveAxis();
      moveAmount = Math.hypot(axis.x, axis.y);
      wish.addScaledVector(fwd, axis.y).addScaledVector(right, axis.x);
    }
    const wantCrouch = this.controlEnabled && (input.down('ControlLeft') || input.down('KeyC'));
    this.crouching = wantCrouch;
    this.sprinting = this.controlEnabled && input.down('ShiftLeft') && moveAmount > 0.85 && !this.crouching && !this.ads;
    const speed = (this.crouching ? 2.4 : this.sprinting ? 7.2 : 4.8) * (this.ads ? 0.7 : 1) * (this.maskOn ? 0.9 : 1);
    if (wish.lengthSq() > 0) wish.normalize().multiplyScalar(speed * Math.min(1, moveAmount));
    const accel = this.grounded ? 12 : 3;
    this.vel.x += (wish.x - this.vel.x) * Math.min(1, dt * accel);
    this.vel.z += (wish.z - this.vel.z) * Math.min(1, dt * accel);
    if (this.controlEnabled && input.pressed('Space') && this.grounded) {
      this.vel.y = 5.2;
      this.grounded = false;
    }
    this.vel.y -= 16 * dt;
    const next = this.pos.clone().addScaledVector(this.vel, dt);
    next.x = clamp(next.x, -HALF + 3, HALF - 3);
    next.z = clamp(next.z, -HALF + 3, HALF - 3);
    field.resolveCollision(next, this.radius, this.crouching ? 1.1 : 1.7);
    const ground = field.groundAt(next.x, next.z, next.y);
    // step up small terrain
    if (next.y <= ground + 0.05) {
      if (!this.grounded && this.vel.y < -6) {
        this.landing = Math.min(1, -this.vel.y / 12);
        this.world.effects.dustRing(next, 0.6);
      }
      next.y = ground;
      this.vel.y = 0;
      this.grounded = true;
    } else this.grounded = false;
    this.pos.copy(next);
    this.moving = moveAmount > 0.1 && this.grounded;
    this.lastGroundY = ground;
    // actions
    const w = this.weapon;
    if (this.controlEnabled) {
      this.ads = input.mouseDown(2) && !this.sprinting && w.reloadTimer <= 0;
      if (input.pressed('KeyR')) {
        if (w.jammed) {
          w.jammed = false;
          w.reloadTimer = 0.9;
          audio.reload();
        } else this.startReload();
      }
      if (input.pressed('Digit1') && this.weaponIndex !== 0) this.switchWeapon(0);
      if (input.pressed('Digit2') && this.weapons.length > 1 && this.weaponIndex !== 1) this.switchWeapon(1);
      if (input.wheel !== 0 && this.weapons.length > 1) this.switchWeapon((this.weaponIndex + 1) % this.weapons.length);
      if (input.pressed('KeyF')) this.throwGrenade();
      if (input.pressed('KeyH')) this.useMedkit();
      if (input.pressed('KeyG') && this.cfg.hasMask) this.maskOn = !this.maskOn;
      if (input.pressed('KeyN') && this.cfg.hasNVG) this.nvgOn = !this.nvgOn;
      if (input.locked || input.touchLook || input.mouseDown(0)) this.tryFire(now, dt);
    } else this.ads = false;
    this.adsAmount += ((this.ads ? 1 : 0) - this.adsAmount) * Math.min(1, dt * 12);
    if (w.reloadTimer > 0) {
      w.reloadTimer -= dt;
      if (w.reloadTimer <= 0) this.finishReload(w);
    }
    if (w.boltTimer > 0) w.boltTimer -= dt;
    if (this.switchTimer > 0) this.switchTimer -= dt;
    // view bob / camera
    const speedNorm = this.vel.length() / 7;
    if (this.moving) this.bob += dt * (this.sprinting ? 12 : 8);
    this.landing = Math.max(0, this.landing - dt * 3);
    this.updateCamera(dt, speedNorm);
    // weapon model pose
    const flash = w.muzzle.getObjectByName('flash') as THREE.Sprite;
    flash.material.opacity *= Math.max(0, 1 - dt * 25);
    const hip = new THREE.Vector3(0.17, -0.17, -0.36);
    const adsPos = new THREE.Vector3(0, -0.09 + (w.def.scoped ? -0.02 : 0), -0.26);
    const target = hip.clone().lerp(adsPos, this.adsAmount);
    const bobX = Math.sin(this.bob) * 0.012 * speedNorm * (1 - this.adsAmount);
    const bobY = Math.abs(Math.cos(this.bob)) * 0.01 * speedNorm * (1 - this.adsAmount);
    target.x += bobX + input.mouseDX * 0.0002 * (1 - this.adsAmount * 0.8);
    target.y += bobY - this.landing * 0.05 + input.mouseDY * 0.0002 * (1 - this.adsAmount * 0.8);
    target.z += this.recoil * 0.004;
    if (w.reloadTimer > 0) {
      target.y -= 0.12 * Math.sin((w.reloadTimer / w.def.reloadTime) * Math.PI);
      target.x += 0.05;
    }
    if (w.boltTimer > 0) {
      target.z += 0.03 * Math.sin((w.boltTimer / 0.55) * Math.PI);
      target.x += 0.02;
    }
    if (this.sprinting) {
      target.y -= 0.08;
      target.x += 0.1;
      target.z += 0.05;
    }
    this.viewRoot.position.lerp(target, Math.min(1, dt * 14));
    this.viewRoot.rotation.x = this.recoil * 0.01 + (this.sprinting ? -0.3 : 0) + (w.reloadTimer > 0 ? -0.2 : 0);
    this.viewRoot.rotation.z = this.sprinting ? 0.15 : 0;
    this.viewRoot.rotation.y = (this.sprinting ? 0.25 : 0) + (w.boltTimer > 0 ? -0.15 : 0);
    this.viewRoot.visible = !this.ads || !w.def.scoped || this.adsAmount < 0.9;
    const targetFov = lerp(this.baseFov + (this.sprinting ? 6 : 0), w.def.adsFov, this.adsAmount);
    this.camera.fov += (targetFov - this.camera.fov) * Math.min(1, dt * 12);
    this.camera.updateProjectionMatrix();
  }

  private switchWeapon(i: number) {
    this.weapon.model.visible = false;
    this.weaponIndex = i;
    this.weapon.model.visible = true;
    this.switchTimer = 0.45;
    audio.click(0.8);
  }

  updateCamera(dt: number, speedNorm = 0) {
    const targetEye = this.crouching ? 1.1 : 1.62;
    this.eyeHeight += (targetEye - this.eyeHeight) * Math.min(1, dt * 10 || 1);
    const bobY = Math.abs(Math.sin(this.bob)) * 0.035 * speedNorm;
    const shake = this.world.effects.shake;
    this.shakeOffset.set((Math.random() - 0.5) * shake * 0.08, (Math.random() - 0.5) * shake * 0.08, 0);
    this.cameraHolder.position.set(this.pos.x, this.pos.y + this.eyeHeight + bobY - this.landing * 0.12, this.pos.z);
    this.cameraHolder.rotation.set(0, this.yaw, 0);
    this.camera.position.copy(this.shakeOffset);
    this.camera.rotation.set(this.pitch, 0, Math.sin(this.bob) * 0.004 * speedNorm + (Math.random() - 0.5) * shake * 0.01);
  }

  weaponHudState(): { mag: number; reserve: number; name: string; state: 'ok' | 'reloading' | 'jammed' | 'empty' | 'bolt' } {
    const w = this.weapon;
    return { mag: w.mag, reserve: w.reserve, name: w.def.name, state: w.jammed ? 'jammed' : w.reloadTimer > 0 ? 'reloading' : w.mag === 0 ? 'empty' : w.boltTimer > 0 ? 'bolt' : 'ok' };
  }

  crosshairSpread(): number {
    const w = this.weapon;
    const s = lerp(w.def.spread, w.def.adsSpread, this.adsAmount) * (this.moving ? 1.4 : 1) * (this.crouching ? 0.7 : 1) + this.recoil * 0.01;
    return 6 + s * 900;
  }

  dispose() {
    this.camera.remove(this.viewRoot);
    this.cameraHolder.remove(this.camera);
    this.scene.remove(this.cameraHolder);
    for (const g of this.grenadeList) this.scene.remove(g.mesh);
  }
}
