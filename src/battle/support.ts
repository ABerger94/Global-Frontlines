import * as THREE from 'three';
import type { EraId } from '../data/types';
import type { Team } from './types';
import { explode, soundAt, type BattleWorld, type Combatant, type GasCloud } from './combat';
import { audio } from '../audio/audio';

interface Shell {
  mesh: THREE.Object3D;
  vel: THREE.Vector3;
  damage: number;
  radius: number;
  attacker: Combatant | null;
  size: number;
  gravity: number;
  gas: boolean;
  life: number;
}

interface Aircraft {
  mesh: THREE.Group;
  from: THREE.Vector3;
  to: THREE.Vector3;
  target: THREE.Vector3;
  t: number;
  duration: number;
  team: Team;
  attacker: Combatant | null;
  mode: 'strafe' | 'bomb' | 'drone';
  fired: boolean;
  strafeTimer: number;
}

export interface SupportMarker {
  x: number;
  z: number;
  kind: string;
  until: number;
}

function buildPlane(era: EraId, color: number): THREE.Group {
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.5, metalness: 0.4 });
  const fuselage = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.3, era === 'modern' ? 12 : 8, 8), mat);
  fuselage.rotation.x = Math.PI / 2;
  const wing = new THREE.Mesh(new THREE.BoxGeometry(era === 'modern' ? 9 : 11, 0.12, era === 'modern' ? 3.5 : 1.8), mat);
  wing.position.z = era === 'modern' ? 1 : -0.5;
  if (era === 'modern') {
    wing.geometry = new THREE.BoxGeometry(9, 0.12, 3.5);
    wing.rotation.y = 0;
  }
  const tail = new THREE.Mesh(new THREE.BoxGeometry(3.5, 0.1, 1.2), mat);
  tail.position.z = era === 'modern' ? 5 : 3.5;
  const fin = new THREE.Mesh(new THREE.BoxGeometry(0.1, 1.5, 1.4), mat);
  fin.position.set(0, 0.7, era === 'modern' ? 5 : 3.5);
  g.add(fuselage, wing, tail, fin);
  if (era === 'ww1') {
    const wing2 = wing.clone();
    wing2.position.y = 1.3;
    g.add(wing2);
  }
  g.traverse((o) => ((o as THREE.Mesh).castShadow = true));
  return g;
}

function buildDrone(): THREE.Group {
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color: 0x2a2d30, roughness: 0.6 });
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.2, 1.4), mat);
  const wing = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.06, 0.4), mat);
  g.add(body, wing);
  return g;
}

export class Support {
  private shells: Shell[] = [];
  private aircraft: Aircraft[] = [];
  readonly markers: SupportMarker[] = [];
  readonly gasMeshes: { mesh: THREE.Mesh; cloud: GasCloud; life: number }[] = [];
  revealUntil = 0;
  private pending: { at: number; fn: () => void }[] = [];
  private shellGeo = new THREE.SphereGeometry(0.12, 6, 5);
  private shellMat = new THREE.MeshStandardMaterial({ color: 0x333333, metalness: 0.6, roughness: 0.4 });

  constructor(readonly world: BattleWorld, readonly scene: THREE.Scene, readonly era: EraId) {}

  spawnShell(from: THREE.Vector3, vel: THREE.Vector3, damage: number, radius: number, attacker: Combatant | null, size = 1, gravity = 9.8, gas = false) {
    const mesh = new THREE.Mesh(this.shellGeo, this.shellMat);
    mesh.position.copy(from);
    this.scene.add(mesh);
    this.shells.push({ mesh, vel: vel.clone(), damage, radius, attacker, size, gravity, gas, life: 12 });
  }

  /** Six shells falling around the target after a delay. */
  artilleryStrike(target: THREE.Vector3, team: Team, attacker: Combatant | null, shells = 6, gas = false) {
    this.markers.push({ x: target.x, z: target.z, kind: 'artillery', until: this.world.time + 8 });
    for (let i = 0; i < shells; i++) {
      const at = this.world.time + 2.5 + i * 0.55 + Math.random() * 0.3;
      this.pending.push({
        at,
        fn: () => {
          const off = new THREE.Vector3((Math.random() - 0.5) * 22, 0, (Math.random() - 0.5) * 22);
          const impact = target.clone().add(off);
          const from = impact.clone().add(new THREE.Vector3((Math.random() - 0.5) * 20, 120, team === 'player' ? -60 : 60));
          const dir = impact.clone().sub(from).normalize();
          const speed = 110;
          this.spawnShell(from, dir.multiplyScalar(speed), gas ? 0 : 140, gas ? 0 : 9, attacker, gas ? 0.4 : 1.6, 0, gas);
          const s = soundAt(this.world, impact);
          audio.whoosh(s.distance, s.pan);
        },
      });
    }
  }

  gasShell(target: THREE.Vector3) {
    const cloud: GasCloud = { pos: target.clone(), radius: 4, strength: 1 };
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 12, 10), new THREE.MeshBasicMaterial({ color: 0x9ab84a, transparent: true, opacity: 0.35, depthWrite: false }));
    mesh.position.copy(target).add(new THREE.Vector3(0, 1.5, 0));
    mesh.scale.setScalar(4);
    this.scene.add(mesh);
    this.world.gasClouds.push(cloud);
    this.gasMeshes.push({ mesh, cloud, life: 45 });
  }

  /** Aircraft run over a target. */
  airStrike(target: THREE.Vector3, team: Team, attacker: Combatant | null, mode: 'strafe' | 'bomb' | 'drone', color: number) {
    const isDrone = mode === 'drone';
    const mesh = isDrone ? buildDrone() : buildPlane(this.era, color);
    const dirSign = team === 'player' ? 1 : -1;
    const from = target.clone().add(new THREE.Vector3((Math.random() - 0.5) * 40, isDrone ? 70 : 60, -dirSign * 260));
    const to = target.clone().add(new THREE.Vector3((Math.random() - 0.5) * 40, isDrone ? 2 : 55, dirSign * (isDrone ? 0 : 260)));
    mesh.position.copy(from);
    mesh.lookAt(to);
    this.scene.add(mesh);
    this.aircraft.push({ mesh, from, to, target: target.clone(), t: 0, duration: isDrone ? 4.5 : 5.5, team, attacker, mode, fired: false, strafeTimer: 0 });
    this.markers.push({ x: target.x, z: target.z, kind: 'air', until: this.world.time + 6 });
    if (isDrone) audio.droneBuzz(4.5);
    else audio.planeFlyby();
  }

  reconDrone(duration: number) {
    this.revealUntil = this.world.time + duration;
    const mesh = buildDrone();
    mesh.scale.setScalar(0.5);
    const center = this.world.player.pos.clone().add(new THREE.Vector3(0, 30, 0));
    mesh.position.copy(center);
    this.scene.add(mesh);
    let t = 0;
    this.world.effects.addTransient({
      update: (dt) => {
        t += dt;
        mesh.position.set(center.x + Math.cos(t) * 20, center.y, center.z + Math.sin(t) * 20);
        mesh.rotation.y = -t + Math.PI / 2;
        return t < duration;
      },
      dispose: () => this.scene.remove(mesh),
    });
    audio.droneBuzz(3);
  }

  update(dt: number) {
    const now = this.world.time;
    this.world.revealed = now < this.revealUntil;
    for (let i = this.pending.length - 1; i >= 0; i--) {
      if (now >= this.pending[i].at) {
        this.pending[i].fn();
        this.pending.splice(i, 1);
      }
    }
    for (let i = this.markers.length - 1; i >= 0; i--) if (now > this.markers[i].until) this.markers.splice(i, 1);
    // shells
    for (let i = this.shells.length - 1; i >= 0; i--) {
      const s = this.shells[i];
      s.life -= dt;
      s.vel.y -= s.gravity * dt;
      const p = s.mesh.position;
      const next = p.clone().addScaledVector(s.vel, dt);
      const dist = s.vel.length() * dt;
      const dir = s.vel.clone().normalize();
      const hitDist = this.world.field.raycast(p, dir, dist + 0.2);
      let hitPos: THREE.Vector3 | null = null;
      if (hitDist <= dist + 0.2) hitPos = p.clone().addScaledVector(dir, Math.max(0, hitDist - 0.1));
      else if (next.y < this.world.field.heightAt(next.x, next.z)) {
        hitPos = next;
        hitPos.y = this.world.field.heightAt(next.x, next.z);
      } else {
        // direct hit on combatants
        for (const c of this.world.combatants) {
          if (!c.alive || c === s.attacker) continue;
          const cc = c.pos.clone();
          cc.y += c.height * 0.5;
          if (cc.distanceTo(next) < c.radius + 0.6) {
            hitPos = next;
            break;
          }
        }
      }
      if (hitPos || s.life <= 0) {
        this.scene.remove(s.mesh);
        this.shells.splice(i, 1);
        if (hitPos) {
          if (s.gas) {
            this.gasShell(hitPos);
            this.world.effects.explosion(hitPos, 0.5, 0xa0c050);
          } else {
            explode(this.world, hitPos, s.radius, s.damage, s.attacker, s.size);
            const snd = soundAt(this.world, hitPos);
            audio.explosion(snd.distance, snd.pan, s.size);
          }
        }
        continue;
      }
      p.copy(next);
      s.mesh.lookAt(next.clone().add(s.vel));
    }
    // aircraft
    for (let i = this.aircraft.length - 1; i >= 0; i--) {
      const a = this.aircraft[i];
      a.t += dt / a.duration;
      const p = a.from.clone().lerp(a.to, a.t);
      if (a.mode === 'drone') {
        // dive: ease toward target near the end
        const k = a.t * a.t;
        p.lerp(a.target, k);
      }
      a.mesh.position.copy(p);
      a.mesh.lookAt(p.clone().add(a.to.clone().sub(a.from).normalize()));
      a.mesh.rotation.z = Math.sin(a.t * Math.PI) * 0.15;
      const horizontalDist = Math.hypot(p.x - a.target.x, p.z - a.target.z);
      if (a.mode === 'strafe' && horizontalDist < 90 && p.z * (a.team === 'player' ? 1 : -1) < a.target.z * (a.team === 'player' ? 1 : -1)) {
        a.strafeTimer -= dt;
        if (a.strafeTimer <= 0) {
          a.strafeTimer = 0.06;
          const ahead = a.target.clone().add(new THREE.Vector3((Math.random() - 0.5) * 8, 0, (Math.random() - 0.5) * 8));
          const impact = ahead.clone().lerp(new THREE.Vector3(p.x, this.world.field.heightAt(p.x, p.z), p.z), 0.3 + Math.random() * 0.2);
          impact.y = this.world.field.heightAt(impact.x, impact.z);
          this.world.effects.tracer(p.clone(), impact, 0xffd080);
          this.world.effects.impact(impact, 'dust', 6);
          for (const c of this.world.combatants) {
            if (!c.alive || c.team === a.team) continue;
            if (c.pos.distanceTo(impact) < 2.2) c.takeDamage(45, a.attacker);
          }
          if (Math.random() < 0.5) {
            const s = soundAt(this.world, impact);
            audio.gunshot('heavy', s.distance, s.pan);
          }
        }
      }
      if (a.mode === 'bomb' && !a.fired && horizontalDist < 30) {
        a.fired = true;
        for (let k = 0; k < 3; k++) {
          const from = p.clone().add(new THREE.Vector3(0, -1, k * 4));
          this.spawnShell(from, a.to.clone().sub(a.from).normalize().multiplyScalar(40).add(new THREE.Vector3(0, -10, 0)), 180, 12, a.attacker, 2.2, 14);
        }
      }
      if (a.mode === 'drone' && a.t >= 0.98) {
        explode(this.world, a.target.clone(), 10, 160, a.attacker, 1.8);
        const s = soundAt(this.world, a.target);
        audio.explosion(s.distance, s.pan, 1.6);
        this.scene.remove(a.mesh);
        this.aircraft.splice(i, 1);
        continue;
      }
      if (a.t >= 1) {
        this.scene.remove(a.mesh);
        this.aircraft.splice(i, 1);
      }
    }
    // gas clouds
    for (let i = this.gasMeshes.length - 1; i >= 0; i--) {
      const gm = this.gasMeshes[i];
      gm.life -= dt;
      gm.cloud.radius = Math.min(14, gm.cloud.radius + dt * 1.2);
      gm.cloud.strength = Math.min(1, gm.life / 10);
      gm.mesh.scale.setScalar(gm.cloud.radius);
      gm.mesh.position.x += Math.sin(this.world.time * 0.3) * dt * 0.4;
      gm.cloud.pos.x = gm.mesh.position.x;
      (gm.mesh.material as THREE.MeshBasicMaterial).opacity = 0.35 * gm.cloud.strength;
      if (gm.life <= 0) {
        this.scene.remove(gm.mesh);
        const idx = this.world.gasClouds.indexOf(gm.cloud);
        if (idx >= 0) this.world.gasClouds.splice(idx, 1);
        this.gasMeshes.splice(i, 1);
      }
    }
  }

  dispose() {
    for (const s of this.shells) this.scene.remove(s.mesh);
    for (const a of this.aircraft) this.scene.remove(a.mesh);
    for (const g of this.gasMeshes) this.scene.remove(g.mesh);
  }
}
