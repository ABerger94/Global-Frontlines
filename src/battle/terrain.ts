import * as THREE from 'three';
import { Noise3D } from '../core/noise';
import { RNG } from '../core/rng';
import { clamp, lerp } from '../core/math';
import type { BattleTheme } from '../data/types';
import type { Terrain } from '../strategy/world';
import type { AABB } from './types';

export const FIELD = 270; // metres, square
export const HALF = FIELD / 2;
const GRID = 136;

export interface CapturePoint {
  id: string;
  pos: THREE.Vector3;
  radius: number;
  owner: 'player' | 'enemy' | null;
  progress: number; // -1 enemy .. +1 player
  ring: THREE.Mesh;
  flag: THREE.Mesh;
  light: THREE.PointLight;
}

/** Tiling detail texture built from noise (no downloads). */
export function makeDetailTexture(seed: number, base: number, variation: number, size = 256): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d')!;
  const img = ctx.createImageData(size, size);
  const n = new Noise3D(seed);
  const col = new THREE.Color(base);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      // periodic sampling on a torus keeps the tile seamless
      const ax = (x / size) * Math.PI * 2;
      const ay = (y / size) * Math.PI * 2;
      const v = n.fbm(Math.cos(ax) * 2.2, Math.sin(ax) * 2.2 + Math.cos(ay) * 2.2, Math.sin(ay) * 2.2, 4, 2.3, 0.55);
      const v2 = n.fbm(Math.cos(ax) * 7 + 3, Math.sin(ax) * 7 + Math.cos(ay) * 7, Math.sin(ay) * 7, 2, 2, 0.5);
      const f = 1 + v * variation + v2 * variation * 0.5;
      const i = (y * size + x) * 4;
      img.data[i] = Math.min(255, col.r * 255 * f);
      img.data[i + 1] = Math.min(255, col.g * 255 * f);
      img.data[i + 2] = Math.min(255, col.b * 255 * f);
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class Battlefield {
  readonly group = new THREE.Group();
  readonly wallTexture: THREE.CanvasTexture;
  readonly heights: Float32Array;
  readonly colliders: AABB[] = [];
  readonly coverPoints: THREE.Vector3[] = [];
  readonly capturePoints: CapturePoint[] = [];
  readonly attackerSpawn = new THREE.Vector3(0, 0, -HALF + 18);
  readonly defenderSpawn = new THREE.Vector3(0, 0, HALF - 18);
  readonly noise: Noise3D;
  readonly rng: RNG;
  readonly terrainMesh: THREE.Mesh;
  fogColor = new THREE.Color(0x9aa2a8);
  private step = FIELD / (GRID - 1);

  constructor(readonly theme: BattleTheme, readonly terrain: Terrain, seed: number, readonly night: boolean, readonly playerIsAttacker: boolean) {
    this.rng = new RNG(seed);
    this.noise = new Noise3D(seed);
    this.wallTexture = makeDetailTexture(seed ^ 0x55, 0xffffff, 0.22, 128);
    this.wallTexture.repeat.set(2, 2);
    this.heights = new Float32Array(GRID * GRID);
    this.generateHeights();
    this.terrainMesh = this.buildTerrainMesh();
    this.group.add(this.terrainMesh);
    this.buildProps();
    this.buildCapturePoints();
  }

  // ---------------------------------------------------------------- heightmap
  private generateHeights() {
    const n = this.noise;
    const amp = this.theme === 'trench' ? 2.2 : this.theme === 'ruins' ? 5.5 : 1.2;
    const hillMult = this.terrain === 'mountain' ? 2.6 : this.terrain === 'hills' ? 1.7 : 1;
    for (let j = 0; j < GRID; j++) {
      for (let i = 0; i < GRID; i++) {
        const x = -HALF + i * this.step;
        const z = -HALF + j * this.step;
        let h = n.fbm2(x * 0.008, z * 0.008, 4) * amp * hillMult + n.fbm2(x * 0.05 + 7, z * 0.05, 2) * 0.25;
        // bowl-shaped edges so the field feels enclosed
        const edge = Math.max(Math.abs(x), Math.abs(z)) / HALF;
        if (edge > 0.82) h += (edge - 0.82) * 40;
        // Flatten centre for the town in ruins/urban
        if (this.theme !== 'trench') {
          const d = Math.sqrt(x * x + z * z);
          const flat = this.theme === 'urban' ? 1 : clamp(1 - (d - 45) / 30, 0, 1);
          h = lerp(h, h * 0.15, flat);
        }
        this.heights[j * GRID + i] = h;
      }
    }
    if (this.theme === 'trench') {
      // trench lines: defenders at z=+32, attackers at z=-32 (zigzag)
      this.carveTrench(32, 1);
      this.carveTrench(-32, -1);
      // craters
      for (let k = 0; k < 90; k++) {
        const cx = this.rng.range(-HALF * 0.85, HALF * 0.85);
        const cz = this.rng.range(-HALF * 0.85, HALF * 0.85);
        this.crater(cx, cz, this.rng.range(2.5, 7), this.rng.range(0.8, 2.4));
      }
    } else {
      for (let k = 0; k < 25; k++) {
        const cx = this.rng.range(-HALF * 0.8, HALF * 0.8);
        const cz = this.rng.range(-HALF * 0.8, HALF * 0.8);
        this.crater(cx, cz, this.rng.range(2, 5), this.rng.range(0.5, 1.4));
      }
    }
  }

  private carveTrench(zLine: number, _side: number) {
    const depth = 2.3;
    const width = 3.2;
    for (let j = 0; j < GRID; j++) {
      for (let i = 0; i < GRID; i++) {
        const x = -HALF + i * this.step;
        const z = -HALF + j * this.step;
        if (Math.abs(x) > HALF * 0.78) continue;
        // zigzag
        const zz = zLine + Math.round(x / 14) % 2 * 3.5 + this.noise.fbm2(x * 0.03, 3, 2) * 4;
        const d = Math.abs(z - zz);
        if (d < width) {
          const t = 1 - (d / width) ** 2;
          this.heights[j * GRID + i] -= depth * t;
        } else if (d < width + 1.5) {
          // parapet
          const t = 1 - (d - width) / 1.5;
          this.heights[j * GRID + i] += 0.5 * t;
        }
      }
    }
    // communication trenches every ~40m
    for (let x = -HALF * 0.7; x < HALF * 0.7; x += 42) {
      for (let j = 0; j < GRID; j++) {
        for (let i = 0; i < GRID; i++) {
          const px = -HALF + i * this.step;
          const pz = -HALF + j * this.step;
          const dz = zLine > 0 ? pz - zLine : zLine - pz;
          if (dz < 0 || dz > 22) continue;
          const d = Math.abs(px - x - Math.sin(pz * 0.3) * 1.5);
          if (d < 2) this.heights[j * GRID + i] -= depth * 0.9 * (1 - (d / 2) ** 2);
        }
      }
    }
  }

  private crater(cx: number, cz: number, radius: number, depth: number) {
    const i0 = Math.max(0, Math.floor((cx - radius + HALF) / this.step));
    const i1 = Math.min(GRID - 1, Math.ceil((cx + radius + HALF) / this.step));
    const j0 = Math.max(0, Math.floor((cz - radius + HALF) / this.step));
    const j1 = Math.min(GRID - 1, Math.ceil((cz + radius + HALF) / this.step));
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const x = -HALF + i * this.step;
        const z = -HALF + j * this.step;
        const d = Math.hypot(x - cx, z - cz) / radius;
        if (d < 1) this.heights[j * GRID + i] -= depth * (1 - d * d) - depth * 0.15;
        else if (d < 1.3) this.heights[j * GRID + i] += depth * 0.15 * (1 - (d - 1) / 0.3);
      }
    }
  }

  heightAt(x: number, z: number): number {
    const fx = clamp((x + HALF) / this.step, 0, GRID - 1.001);
    const fz = clamp((z + HALF) / this.step, 0, GRID - 1.001);
    const i = Math.floor(fx);
    const j = Math.floor(fz);
    const tx = fx - i;
    const tz = fz - j;
    const h00 = this.heights[j * GRID + i];
    const h10 = this.heights[j * GRID + i + 1];
    const h01 = this.heights[(j + 1) * GRID + i];
    const h11 = this.heights[(j + 1) * GRID + i + 1];
    return lerp(lerp(h00, h10, tx), lerp(h01, h11, tx), tz);
  }

  /** Ground height including building roofs. */
  groundAt(x: number, z: number, y: number): number {
    let h = this.heightAt(x, z);
    for (const c of this.colliders) {
      if (x > c.min.x && x < c.max.x && z > c.min.z && z < c.max.z && y >= c.max.y - 0.6) h = Math.max(h, c.max.y);
    }
    return h;
  }

  insideCollider(x: number, y: number, z: number, radius = 0): AABB | null {
    for (const c of this.colliders) {
      if (x + radius > c.min.x && x - radius < c.max.x && z + radius > c.min.z && z - radius < c.max.z && y > c.min.y - 0.1 && y < c.max.y) return c;
    }
    return null;
  }

  /** Push a circle (x,z,radius) out of colliders. Returns adjusted position. */
  resolveCollision(pos: THREE.Vector3, radius: number, height: number) {
    for (let iter = 0; iter < 3; iter++) {
      let moved = false;
      for (const c of this.colliders) {
        if (pos.y + height < c.min.y || pos.y > c.max.y - 0.3) continue;
        if (pos.x + radius <= c.min.x || pos.x - radius >= c.max.x || pos.z + radius <= c.min.z || pos.z - radius >= c.max.z) continue;
        const dxMin = pos.x + radius - c.min.x;
        const dxMax = c.max.x - (pos.x - radius);
        const dzMin = pos.z + radius - c.min.z;
        const dzMax = c.max.z - (pos.z - radius);
        const m = Math.min(dxMin, dxMax, dzMin, dzMax);
        if (m === dxMin) pos.x -= dxMin;
        else if (m === dxMax) pos.x += dxMax;
        else if (m === dzMin) pos.z -= dzMin;
        else pos.z += dzMax;
        moved = true;
      }
      if (!moved) break;
    }
  }

  /** Distance along ray to first obstruction (terrain or collider), or Infinity. */
  raycast(origin: THREE.Vector3, dir: THREE.Vector3, maxDist: number): number {
    let best = Infinity;
    // colliders (slab test)
    for (const c of this.colliders) {
      let tmin = 0;
      let tmax = maxDist;
      let ok = true;
      for (const axis of ['x', 'y', 'z'] as const) {
        const o = origin[axis];
        const d = dir[axis];
        const lo = c.min[axis];
        const hi = c.max[axis];
        if (Math.abs(d) < 1e-6) {
          if (o < lo || o > hi) {
            ok = false;
            break;
          }
        } else {
          let t1 = (lo - o) / d;
          let t2 = (hi - o) / d;
          if (t1 > t2) [t1, t2] = [t2, t1];
          tmin = Math.max(tmin, t1);
          tmax = Math.min(tmax, t2);
          if (tmin > tmax) {
            ok = false;
            break;
          }
        }
      }
      if (ok && tmin < best && tmin > 0) best = tmin;
    }
    // terrain march
    const stepLen = 1.5;
    const limit = Math.min(maxDist, best);
    let px = origin.x;
    let py = origin.y;
    let pz = origin.z;
    for (let t = stepLen; t < limit; t += stepLen) {
      px = origin.x + dir.x * t;
      py = origin.y + dir.y * t;
      pz = origin.z + dir.z * t;
      if (Math.abs(px) > HALF || Math.abs(pz) > HALF) return t;
      if (py < this.heightAt(px, pz)) {
        // refine
        let lo = t - stepLen;
        let hi = t;
        for (let k = 0; k < 4; k++) {
          const mid = (lo + hi) / 2;
          const my = origin.y + dir.y * mid;
          if (my < this.heightAt(origin.x + dir.x * mid, origin.z + dir.z * mid)) hi = mid;
          else lo = mid;
        }
        return hi;
      }
    }
    return best;
  }

  // ---------------------------------------------------------------- meshes
  private buildTerrainMesh(): THREE.Mesh {
    const geo = new THREE.PlaneGeometry(FIELD, FIELD, GRID - 1, GRID - 1);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position as THREE.BufferAttribute;
    const colors = new Float32Array(pos.count * 3);
    const c = new THREE.Color();
    const palette = this.palette();
    for (let k = 0; k < pos.count; k++) {
      const x = pos.getX(k);
      const z = pos.getZ(k);
      const h = this.heightAt(x, z);
      pos.setY(k, h);
      const n = this.noise.fbm2(x * 0.06 + 11, z * 0.06, 3);
      const n2 = this.noise.fbm2(x * 0.3, z * 0.3 + 5, 2);
      c.copy(palette.base).lerp(palette.alt, clamp(n * 0.5 + 0.5, 0, 1));
      // trench floor / low = darker mud
      const base = this.noise.fbm2(x * 0.008, z * 0.008, 4) * 2.2;
      if (this.theme === 'trench' && h < base - 0.8) c.lerp(palette.low, clamp((base - 0.8 - h) / 1.5, 0, 1));
      if (this.theme !== 'trench' && h > 4) c.lerp(palette.high, clamp((h - 4) / 8, 0, 1));
      const shade = 1 + n2 * 0.12;
      colors[k * 3] = c.r * shade;
      colors[k * 3 + 1] = c.g * shade;
      colors[k * 3 + 2] = c.b * shade;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.computeVertexNormals();
    const detail = makeDetailTexture(this.rng.int(1, 1e9), 0xffffff, 0.35);
    detail.repeat.set(FIELD / 6, FIELD / 6);
    detail.anisotropy = 8;
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, map: detail, roughness: 0.95, metalness: 0.0 });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.receiveShadow = true;
    return mesh;
  }

  private palette() {
    if (this.theme === 'trench') return { base: new THREE.Color(0x5b4a34), alt: new THREE.Color(0x6e5c3e), low: new THREE.Color(0x2e241a), high: new THREE.Color(0x7d6b4a) };
    if (this.theme === 'ruins') {
      if (this.terrain === 'desert') return { base: new THREE.Color(0xb59a62), alt: new THREE.Color(0xc9ad74), low: new THREE.Color(0x7a6440), high: new THREE.Color(0xd8c294) };
      return { base: new THREE.Color(0x4f6b34), alt: new THREE.Color(0x6f8a3d), low: new THREE.Color(0x3a4a26), high: new THREE.Color(0x8a8a70) };
    }
    return { base: new THREE.Color(0x3c3f42), alt: new THREE.Color(0x4a4d50), low: new THREE.Color(0x2a2c2f), high: new THREE.Color(0x5a5d60) };
  }

  private addBox(x: number, y: number, z: number, w: number, h: number, d: number, mat: THREE.Material, solid = true, castShadow = true): THREE.Mesh {
    const sm = mat as THREE.MeshStandardMaterial;
    if (sm.isMeshStandardMaterial && !sm.map) {
      sm.map = this.wallTexture;
      sm.needsUpdate = true;
    }
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x, y + h / 2, z);
    m.castShadow = castShadow;
    m.receiveShadow = true;
    this.group.add(m);
    if (solid) this.colliders.push({ min: { x: x - w / 2, y, z: z - d / 2 }, max: { x: x + w / 2, y: y + h, z: z + d / 2 } });
    return m;
  }

  private buildProps() {
    const rng = this.rng;
    if (this.theme === 'trench') this.buildTrenchProps();
    else if (this.theme === 'ruins') this.buildRuinsProps();
    else this.buildUrbanProps();
    // Cover points: sample terrain low spots / near colliders
    for (const c of this.colliders) {
      const cx = (c.min.x + c.max.x) / 2;
      const cz = (c.min.z + c.max.z) / 2;
      const w = c.max.x - c.min.x;
      const d = c.max.z - c.min.z;
      for (const [ox, oz] of [
        [w / 2 + 1.2, 0],
        [-w / 2 - 1.2, 0],
        [0, d / 2 + 1.2],
        [0, -d / 2 - 1.2],
      ]) {
        const px = cx + ox;
        const pz = cz + oz;
        if (Math.abs(px) < HALF - 5 && Math.abs(pz) < HALF - 5 && !this.insideCollider(px, this.heightAt(px, pz) + 0.5, pz, 0.5)) this.coverPoints.push(new THREE.Vector3(px, this.heightAt(px, pz), pz));
      }
    }
    if (this.theme === 'trench') {
      for (let x = -HALF * 0.75; x < HALF * 0.75; x += 5) {
        for (const zl of [32, -32]) {
          const zz = zl + (Math.round(x / 14) % 2) * 3.5 + this.noise.fbm2(x * 0.03, 3, 2) * 4;
          this.coverPoints.push(new THREE.Vector3(x + rng.range(-1, 1), this.heightAt(x, zz), zz));
        }
      }
    }
    for (let k = 0; k < 120; k++) {
      const x = rng.range(-HALF * 0.8, HALF * 0.8);
      const z = rng.range(-HALF * 0.8, HALF * 0.8);
      const h = this.heightAt(x, z);
      const avg = (this.heightAt(x + 3, z) + this.heightAt(x - 3, z) + this.heightAt(x, z + 3) + this.heightAt(x, z - 3)) / 4;
      if (h < avg - 0.5 && !this.insideCollider(x, h + 0.5, z, 0.5)) this.coverPoints.push(new THREE.Vector3(x, h, z));
    }
  }

  private buildTrenchProps() {
    const rng = this.rng;
    const woodMat = new THREE.MeshStandardMaterial({ color: 0x4a3a28, roughness: 0.9 });
    const sandMat = new THREE.MeshStandardMaterial({ color: 0x6b5d45, roughness: 1 });
    const wireMat = new THREE.MeshStandardMaterial({ color: 0x222222, roughness: 0.6, metalness: 0.5 });
    // Barbed wire posts across No Man's Land
    const postGeo = new THREE.CylinderGeometry(0.06, 0.08, 1.3, 5);
    const posts = new THREE.InstancedMesh(postGeo, woodMat, 400);
    const wireGeo = new THREE.CylinderGeometry(0.02, 0.02, 4.2, 4);
    const wires = new THREE.InstancedMesh(wireGeo, wireMat, 400);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    let pi = 0;
    for (const zl of [18, 12, -12, -18]) {
      for (let x = -HALF * 0.75; x < HALF * 0.75 && pi < 400; x += 4) {
        const z = zl + rng.range(-1.5, 1.5);
        const y = this.heightAt(x, z);
        m.compose(new THREE.Vector3(x, y + 0.6, z), q.setFromEuler(new THREE.Euler(rng.range(-0.15, 0.15), 0, rng.range(-0.15, 0.15))), new THREE.Vector3(1, 1, 1));
        posts.setMatrixAt(pi, m);
        m.compose(new THREE.Vector3(x + 2, y + 0.9, z), q.setFromEuler(new THREE.Euler(0, 0, Math.PI / 2)), new THREE.Vector3(1, 1, 1));
        wires.setMatrixAt(pi, m);
        pi++;
      }
    }
    posts.count = pi;
    wires.count = pi;
    posts.castShadow = true;
    this.group.add(posts, wires);
    // Sandbag parapets along trenches
    const bagGeo = new THREE.BoxGeometry(1.2, 0.5, 0.6);
    const bags = new THREE.InstancedMesh(bagGeo, sandMat, 600);
    let bi = 0;
    for (const zl of [32, -32]) {
      const side = zl > 0 ? -1 : 1; // face No Man's Land
      for (let x = -HALF * 0.78; x < HALF * 0.78 && bi < 600; x += 1.25) {
        const zz = zl + (Math.round(x / 14) % 2) * 3.5 + this.noise.fbm2(x * 0.03, 3, 2) * 4;
        const z = zz + side * 3.4;
        const y = this.heightAt(x, z);
        for (let l = 0; l < 2 && bi < 600; l++) {
          m.compose(new THREE.Vector3(x + (l ? 0.6 : 0), y + 0.25 + l * 0.48, z + rng.range(-0.1, 0.1)), q.setFromEuler(new THREE.Euler(0, rng.range(-0.1, 0.1), 0)), new THREE.Vector3(1, 1, 1));
          bags.setMatrixAt(bi++, m);
        }
      }
    }
    bags.count = bi;
    bags.castShadow = true;
    bags.receiveShadow = true;
    this.group.add(bags);
    // Dead trees
    const trunkGeo = new THREE.CylinderGeometry(0.15, 0.35, 6, 6);
    const trees = new THREE.InstancedMesh(trunkGeo, woodMat, 60);
    for (let k = 0; k < 60; k++) {
      const x = rng.range(-HALF * 0.85, HALF * 0.85);
      const z = rng.range(-HALF * 0.85, HALF * 0.85);
      const y = this.heightAt(x, z);
      m.compose(new THREE.Vector3(x, y + 2.5, z), q.setFromEuler(new THREE.Euler(rng.range(-0.2, 0.2), rng.range(0, 6), rng.range(-0.2, 0.2))), new THREE.Vector3(1, rng.range(0.5, 1.2), 1));
      trees.setMatrixAt(k, m);
      this.colliders.push({ min: { x: x - 0.35, y: y, z: z - 0.35 }, max: { x: x + 0.35, y: y + 5, z: z + 0.35 } });
    }
    trees.castShadow = true;
    this.group.add(trees);
    // Bunkers / dugouts behind each trench line
    const concrete = new THREE.MeshStandardMaterial({ color: 0x5f5f5a, roughness: 0.95 });
    for (const zl of [46, -46]) {
      for (let x = -80; x <= 80; x += 40) {
        const y = this.heightAt(x, zl);
        this.addBox(x, y - 0.3, zl, 7, 2.6, 5, concrete);
      }
    }
    // Wrecked artillery pieces / debris
    const metal = new THREE.MeshStandardMaterial({ color: 0x3b3b3b, roughness: 0.7, metalness: 0.4 });
    for (let k = 0; k < 10; k++) {
      const x = rng.range(-90, 90);
      const z = rng.range(-HALF * 0.7, HALF * 0.7);
      const y = this.heightAt(x, z);
      this.addBox(x, y - 0.2, z, rng.range(2, 4), rng.range(1, 1.8), rng.range(1.5, 3), metal);
    }
    this.fogColor.setHex(this.night ? 0x1a1c20 : 0x8f8a80);
  }

  private buildRuinsProps() {
    const rng = this.rng;
    const desert = this.terrain === 'desert';
    const wallMat = new THREE.MeshStandardMaterial({ color: desert ? 0xc9b48a : 0x9c8f7c, roughness: 0.95 });
    const wallMat2 = new THREE.MeshStandardMaterial({ color: desert ? 0xb09a6e : 0x7d6f60, roughness: 0.95 });
    const roofMat = new THREE.MeshStandardMaterial({ color: 0x8a5a48, roughness: 0.9 });
    const rubbleMat = new THREE.MeshStandardMaterial({ color: 0x6f6a62, roughness: 1 });
    // Town grid in the centre
    const blocks = 5;
    const spacing = 22;
    for (let bx = -Math.floor(blocks / 2); bx <= Math.floor(blocks / 2); bx++) {
      for (let bz = -Math.floor(blocks / 2); bz <= Math.floor(blocks / 2); bz++) {
        if (rng.next() < 0.18) continue;
        const cx = bx * spacing + rng.range(-3, 3);
        const cz = bz * spacing + rng.range(-3, 3);
        const w = rng.range(8, 14);
        const d = rng.range(8, 14);
        const y = this.heightAt(cx, cz) - 0.3;
        const ruined = rng.next() < 0.55;
        const mat = rng.next() < 0.5 ? wallMat : wallMat2;
        if (ruined) {
          // four walls of differing heights, some missing
          const t = 0.6;
          const walls: [number, number, number, number][] = [
            [cx, cz - d / 2, w, t],
            [cx, cz + d / 2, w, t],
            [cx - w / 2, cz, t, d],
            [cx + w / 2, cz, t, d],
          ];
          for (const [wx, wz, ww, wd] of walls) {
            if (rng.next() < 0.25) continue;
            const h = rng.range(1.5, 5);
            this.addBox(wx, y, wz, ww, h, wd, mat);
          }
          // rubble inside
          for (let k = 0; k < 4; k++) {
            const rx = cx + rng.range(-w / 3, w / 3);
            const rz = cz + rng.range(-d / 3, d / 3);
            this.addBox(rx, y, rz, rng.range(1, 3), rng.range(0.4, 1.3), rng.range(1, 3), rubbleMat, true, false);
          }
        } else {
          const h = rng.range(5, 9);
          this.addBox(cx, y, cz, w, h, d, mat);
          const roof = new THREE.Mesh(new THREE.ConeGeometry(Math.max(w, d) * 0.72, 2.6, 4), roofMat);
          roof.position.set(cx, y + h + 1.3, cz);
          roof.rotation.y = Math.PI / 4;
          roof.castShadow = true;
          this.group.add(roof);
        }
      }
    }
    // Church tower / landmark
    const cy = this.heightAt(0, 0) - 0.3;
    this.addBox(0, cy, 0, 6, 16, 6, wallMat2);
    // Hedgerows in the fields
    const hedgeMat = new THREE.MeshStandardMaterial({ color: desert ? 0x8a7a50 : 0x2f4d22, roughness: 1 });
    for (let k = 0; k < 14; k++) {
      const horizontal = rng.next() < 0.5;
      const len = rng.range(20, 50);
      const x = rng.range(-HALF * 0.8, HALF * 0.8);
      const z = rng.range(-HALF * 0.8, HALF * 0.8);
      if (Math.hypot(x, z) < 70) continue;
      const y = this.heightAt(x, z) - 0.5;
      this.addBox(x, y, z, horizontal ? len : 1.6, 1.8, horizontal ? 1.6 : len, hedgeMat);
    }
    // Wrecked vehicles
    const metal = new THREE.MeshStandardMaterial({ color: 0x3a3a38, roughness: 0.7, metalness: 0.4 });
    for (let k = 0; k < 8; k++) {
      const x = rng.range(-100, 100);
      const z = rng.range(-100, 100);
      const y = this.heightAt(x, z) - 0.2;
      this.addBox(x, y, z, 3.2, 1.6, 6, metal);
      this.addBox(x, y + 1.6, z, 2, 0.9, 2.4, metal, false);
    }
    // Trees
    const trunk = new THREE.MeshStandardMaterial({ color: 0x4a3a28, roughness: 0.9 });
    const leaf = new THREE.MeshStandardMaterial({ color: desert ? 0x6d7a3a : 0x2e5a25, roughness: 0.9 });
    const trunkGeo = new THREE.CylinderGeometry(0.2, 0.3, 4, 6);
    const leafGeo = new THREE.ConeGeometry(2.2, 5, 7);
    const trunks = new THREE.InstancedMesh(trunkGeo, trunk, 90);
    const leaves = new THREE.InstancedMesh(leafGeo, leaf, 90);
    const m = new THREE.Matrix4();
    let ti = 0;
    for (let k = 0; k < 200 && ti < 90; k++) {
      const x = rng.range(-HALF * 0.9, HALF * 0.9);
      const z = rng.range(-HALF * 0.9, HALF * 0.9);
      if (Math.hypot(x, z) < 65) continue;
      const y = this.heightAt(x, z);
      m.makeTranslation(x, y + 2, z);
      trunks.setMatrixAt(ti, m);
      m.makeTranslation(x, y + 5.5, z);
      leaves.setMatrixAt(ti, m);
      this.colliders.push({ min: { x: x - 0.3, y, z: z - 0.3 }, max: { x: x + 0.3, y: y + 4, z: z + 0.3 } });
      ti++;
    }
    trunks.count = ti;
    leaves.count = ti;
    trunks.castShadow = leaves.castShadow = true;
    this.group.add(trunks, leaves);
    this.fogColor.setHex(this.night ? 0x14161c : desert ? 0xd9c9a0 : 0xa9b4bd);
  }

  private buildUrbanProps() {
    const rng = this.rng;
    const mats = [0x5c6470, 0x7a8290, 0x4b5260, 0x8b8f96, 0x3f4653].map((c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.6, metalness: 0.2 }));
    const glass = new THREE.MeshStandardMaterial({ color: 0x1b2a3a, roughness: 0.2, metalness: 0.7, emissive: 0x233a55, emissiveIntensity: this.night ? 0.6 : 0.05 });
    const road = new THREE.MeshStandardMaterial({ color: 0x232527, roughness: 0.9 });
    const blockSize = 30;
    const roadW = 10;
    const count = 7;
    const origin = -((count - 1) * blockSize) / 2;
    // roads
    for (let k = 0; k < count + 1; k++) {
      const c = origin - blockSize / 2 + k * blockSize;
      const r1 = new THREE.Mesh(new THREE.PlaneGeometry(roadW, FIELD * 0.85), road);
      r1.rotation.x = -Math.PI / 2;
      r1.position.set(c, this.heightAt(c, 0) + 0.05, 0);
      r1.receiveShadow = true;
      const r2 = new THREE.Mesh(new THREE.PlaneGeometry(FIELD * 0.85, roadW), road);
      r2.rotation.x = -Math.PI / 2;
      r2.position.set(0, this.heightAt(0, c) + 0.05, c);
      r2.receiveShadow = true;
      this.group.add(r1, r2);
    }
    // buildings
    for (let bx = 0; bx < count; bx++) {
      for (let bz = 0; bz < count; bz++) {
        const cx = origin + bx * blockSize;
        const cz = origin + bz * blockSize;
        // capture point plazas stay open
        if (Math.abs(cx) < 16 && (Math.abs(cz) < 16 || Math.abs(Math.abs(cz) - 45) < 16)) {
          if (rng.next() < 0.7) continue;
        }
        const n = rng.int(1, 3);
        for (let k = 0; k < n; k++) {
          const w = rng.range(7, 13);
          const d = rng.range(7, 13);
          const ox = n === 1 ? 0 : rng.range(-7, 7);
          const oz = n === 1 ? 0 : rng.range(-7, 7);
          const x = cx + ox;
          const z = cz + oz;
          const dist = Math.hypot(x, z);
          const h = dist < 60 ? rng.range(12, 42) : rng.range(6, 18);
          const y = this.heightAt(x, z) - 0.5;
          const body = this.addBox(x, y, z, w, h, d, rng.pick(mats));
          // window band
          const band = new THREE.Mesh(new THREE.BoxGeometry(w + 0.1, h * 0.85, d + 0.1), glass);
          band.position.copy(body.position);
          band.scale.set(1, 1, 1);
          this.group.add(band);
          if (rng.next() < 0.35) {
            // rooftop structure
            this.addBox(x, y + h, z, w * 0.4, 2.5, d * 0.4, mats[0], false);
          }
        }
      }
    }
    // Cars & barricades along roads
    const carMat = new THREE.MeshStandardMaterial({ color: 0x3b3f44, roughness: 0.5, metalness: 0.5 });
    const barrier = new THREE.MeshStandardMaterial({ color: 0x9a9a9a, roughness: 0.9 });
    for (let k = 0; k < 40; k++) {
      const alongX = rng.next() < 0.5;
      const lane = origin - blockSize / 2 + rng.int(0, count) * blockSize + (rng.next() < 0.5 ? -3.5 : 3.5);
      const t = rng.range(-HALF * 0.75, HALF * 0.75);
      const x = alongX ? t : lane;
      const z = alongX ? lane : t;
      const y = this.heightAt(x, z);
      if (rng.next() < 0.7) this.addBox(x, y, z, alongX ? 4.4 : 2, 1.4, alongX ? 2 : 4.4, carMat);
      else this.addBox(x, y, z, alongX ? 2.4 : 1, 1.1, alongX ? 1 : 2.4, barrier);
    }
    // Street lights
    if (this.night) {
      const poleMat = new THREE.MeshStandardMaterial({ color: 0x555555 });
      const lampMat = new THREE.MeshStandardMaterial({ color: 0xffd28a, emissive: 0xffb050, emissiveIntensity: 2 });
      const poleGeo = new THREE.CylinderGeometry(0.1, 0.12, 7, 5);
      const lampGeo = new THREE.SphereGeometry(0.35, 8, 6);
      const poles = new THREE.InstancedMesh(poleGeo, poleMat, 80);
      const lamps = new THREE.InstancedMesh(lampGeo, lampMat, 80);
      const m = new THREE.Matrix4();
      let li = 0;
      for (let k = 0; k < count + 1 && li < 80; k++) {
        const c = origin - blockSize / 2 + k * blockSize;
        for (let t = -HALF * 0.7; t < HALF * 0.7 && li < 80; t += 30) {
          const x = c + 5.5;
          const z = t;
          const y = this.heightAt(x, z);
          m.makeTranslation(x, y + 3.5, z);
          poles.setMatrixAt(li, m);
          m.makeTranslation(x, y + 7, z);
          lamps.setMatrixAt(li, m);
          li++;
        }
      }
      poles.count = lamps.count = li;
      this.group.add(poles, lamps);
    }
    this.fogColor.setHex(this.night ? 0x0b0f18 : 0xa8b0ba);
  }

  private buildCapturePoints() {
    const defs: [string, number, number][] = [
      ['A', -12, -46],
      ['B', 8, 0],
      ['C', -6, 46],
    ];
    for (const [id, x, z] of defs) {
      const y = this.heightAt(x, z);
      const ring = new THREE.Mesh(new THREE.RingGeometry(9, 10, 48), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.55, side: THREE.DoubleSide, depthWrite: false }));
      ring.rotation.x = -Math.PI / 2;
      ring.position.set(x, y + 0.15, z);
      const poleMat = new THREE.MeshStandardMaterial({ color: 0x777777 });
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 6, 6), poleMat);
      pole.position.set(x, y + 3, z);
      const flag = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 1.3), new THREE.MeshStandardMaterial({ color: 0xcccccc, side: THREE.DoubleSide, emissive: 0x222222 }));
      flag.position.set(x + 1.1, y + 5.3, z);
      const light = new THREE.PointLight(0xffffff, 0, 30);
      light.position.set(x, y + 6, z);
      this.group.add(ring, pole, flag, light);
      const start = this.playerIsAttacker ? (z > 20 ? 'enemy' : null) : z < -20 ? 'enemy' : null;
      const startP = this.playerIsAttacker ? (z < -20 ? 'player' : start) : z > 20 ? 'player' : start;
      this.capturePoints.push({ id, pos: new THREE.Vector3(x, y, z), radius: 10, owner: startP, progress: startP === 'player' ? 1 : startP === 'enemy' ? -1 : 0, ring, flag, light });
    }
  }
}
