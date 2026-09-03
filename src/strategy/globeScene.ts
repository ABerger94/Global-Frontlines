import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { TERRAIN_INFO, provinceAtPoint, type World, type Province } from './world';
import type { StrategySim, Army } from './sim';
import { Noise3D } from '../core/noise';
import { latLonToVec3 } from '../core/math';

const MINOR_COLOR = new THREE.Color(0xb8b09a);

export class GlobeScene {
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly controls: OrbitControls;
  readonly globe: THREE.Mesh;
  private texture: THREE.CanvasTexture;
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private imageData: ImageData;
  private shade: Float32Array;
  private clouds: THREE.Mesh;
  private armyMesh: THREE.InstancedMesh;
  private armyIds: number[] = [];
  private capitalGroup = new THREE.Group();
  private pathLines = new THREE.Group();
  private battleRing: THREE.Mesh;
  private labelRoot: HTMLElement;
  private labels = new Map<string, HTMLDivElement>();
  private raycaster = new THREE.Raycaster();
  selectedProvince: number | null = null;
  hoveredProvince: number | null = null;
  selectedArmy: number | null = null;
  autoRotate = false;
  private time = 0;
  private dirtyTexture = true;
  private sun: THREE.DirectionalLight;

  constructor(readonly renderer: THREE.WebGLRenderer, readonly world: World, readonly sim: StrategySim, labelRoot: HTMLElement) {
    this.labelRoot = labelRoot;
    this.camera = new THREE.PerspectiveCamera(42, 1, 0.01, 200);
    this.camera.position.set(0, 0.9, 2.6);
    this.controls = new OrbitControls(this.camera, renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.enablePan = false;
    this.controls.minDistance = 1.35;
    this.controls.maxDistance = 4.5;
    this.controls.zoomSpeed = 0.8;
    this.scene.background = new THREE.Color(0x05070d);

    // ---- stars
    const starGeo = new THREE.BufferGeometry();
    const starPos = new Float32Array(4000 * 3);
    for (let i = 0; i < 4000; i++) {
      const v = new THREE.Vector3().randomDirection().multiplyScalar(80 + Math.random() * 20);
      starPos.set([v.x, v.y, v.z], i * 3);
    }
    starGeo.setAttribute('position', new THREE.BufferAttribute(starPos, 3));
    this.scene.add(new THREE.Points(starGeo, new THREE.PointsMaterial({ color: 0xbfc8ff, size: 0.25, sizeAttenuation: true, transparent: true, opacity: 0.8 })));

    // ---- lights
    const sun = new THREE.DirectionalLight(0xfff2dc, 2.6);
    sun.position.set(3, 2, 4);
    this.sun = sun;
    this.scene.add(sun);
    this.scene.add(new THREE.AmbientLight(0x8a9cc8, 1.0));
    this.scene.add(new THREE.HemisphereLight(0x8fb3ff, 0x1a1408, 0.35));

    // ---- globe texture
    this.canvas = document.createElement('canvas');
    this.canvas.width = world.W;
    this.canvas.height = world.H;
    this.ctx = this.canvas.getContext('2d')!;
    this.imageData = this.ctx.createImageData(world.W, world.H);
    this.shade = new Float32Array(world.W * world.H);
    const bump = document.createElement('canvas');
    bump.width = world.W;
    bump.height = world.H;
    const bctx = bump.getContext('2d')!;
    const bdata = bctx.createImageData(world.W, world.H);
    const n = new Noise3D(world.seed ^ 0x1234);
    const tmp = new THREE.Vector3();
    for (let y = 0; y < world.H; y++) {
      const lat = 90 - (y / world.H) * 180;
      for (let x = 0; x < world.W; x++) {
        const lon = (x / world.W) * 360 - 180;
        latLonToVec3(lat, lon, 1, tmp);
        const idx = y * world.W + x;
        const p = world.provinces[world.indexMap[idx]];
        const v = n.fbm(tmp.x * 6, tmp.y * 6, tmp.z * 6, 4);
        this.shade[idx] = v;
        let h = 128;
        if (p.isLand) {
          const mount = p.terrain === 'mountain' ? 1 : p.terrain === 'hills' ? 0.5 : 0.2;
          h = 128 + (v * 60 + 20) * mount + 10;
        } else h = 60 + v * 10;
        bdata.data[idx * 4] = bdata.data[idx * 4 + 1] = bdata.data[idx * 4 + 2] = Math.max(0, Math.min(255, h));
        bdata.data[idx * 4 + 3] = 255;
      }
    }
    bctx.putImageData(bdata, 0, 0);
    const bumpTex = new THREE.CanvasTexture(bump);
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.anisotropy = renderer.capabilities.getMaxAnisotropy();
    const mat = new THREE.MeshStandardMaterial({ map: this.texture, bumpMap: bumpTex, bumpScale: 0.6, roughness: 0.75, metalness: 0.05 });
    this.globe = new THREE.Mesh(new THREE.SphereGeometry(1, 128, 96), mat);
    this.scene.add(this.globe);

    // ---- atmosphere
    const atmo = new THREE.Mesh(
      new THREE.SphereGeometry(1.07, 64, 48),
      new THREE.ShaderMaterial({
        uniforms: { c: { value: 0.55 }, p: { value: 4.0 }, glowColor: { value: new THREE.Color(0x4a8cff) } },
        vertexShader: `varying vec3 vNormal; varying vec3 vPos; void main(){ vNormal = normalize(normalMatrix * normal); vec4 mv = modelViewMatrix * vec4(position,1.0); vPos = mv.xyz; gl_Position = projectionMatrix * mv; }`,
        fragmentShader: `uniform float c; uniform float p; uniform vec3 glowColor; varying vec3 vNormal; varying vec3 vPos; void main(){ vec3 viewDir = normalize(-vPos); float i = pow(c - dot(vNormal, viewDir), p); gl_FragColor = vec4(glowColor, 1.0) * i; }`,
        side: THREE.BackSide,
        blending: THREE.AdditiveBlending,
        transparent: true,
        depthWrite: false,
      }),
    );
    this.scene.add(atmo);

    // ---- clouds
    const cc = document.createElement('canvas');
    cc.width = 512;
    cc.height = 256;
    const cctx = cc.getContext('2d')!;
    const cd = cctx.createImageData(512, 256);
    const cn = new Noise3D(world.seed ^ 0x777);
    for (let y = 0; y < 256; y++) {
      const lat = 90 - (y / 256) * 180;
      for (let x = 0; x < 512; x++) {
        const lon = (x / 512) * 360 - 180;
        latLonToVec3(lat, lon, 1, tmp);
        const v = cn.fbm(tmp.x * 5, tmp.y * 5, tmp.z * 5, 5, 2.2, 0.55);
        const a = Math.max(0, Math.min(1, (v - 0.12) * 3));
        const i = (y * 512 + x) * 4;
        cd.data[i] = cd.data[i + 1] = cd.data[i + 2] = 255;
        cd.data[i + 3] = a * 200;
      }
    }
    cctx.putImageData(cd, 0, 0);
    const cloudTex = new THREE.CanvasTexture(cc);
    this.clouds = new THREE.Mesh(new THREE.SphereGeometry(1.015, 64, 48), new THREE.MeshLambertMaterial({ map: cloudTex, transparent: true, opacity: 0.4, depthWrite: false }));
    this.scene.add(this.clouds);

    // ---- capitals
    this.scene.add(this.capitalGroup);
    for (const p of world.provinces) {
      if (!p.capitalOf) continue;
      const nation = sim.era.nations.find((x) => x.id === p.capitalOf)!;
      const m = new THREE.Mesh(new THREE.OctahedronGeometry(0.012, 0), new THREE.MeshStandardMaterial({ color: nation.color, emissive: nation.color, emissiveIntensity: 0.5 }));
      m.position.copy(p.pos).multiplyScalar(1.012);
      m.lookAt(0, 0, 0);
      const ring = new THREE.Mesh(new THREE.RingGeometry(0.014, 0.019, 24), new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide, transparent: true, opacity: 0.8 }));
      ring.position.copy(p.pos).multiplyScalar(1.004);
      ring.lookAt(p.pos.clone().multiplyScalar(2));
      this.capitalGroup.add(m, ring);
    }

    // ---- armies (instanced counters)
    const counterGeo = new THREE.BoxGeometry(0.022, 0.006, 0.016);
    const counterMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.4, metalness: 0.2 });
    this.armyMesh = new THREE.InstancedMesh(counterGeo, counterMat, 256);
    this.armyMesh.count = 0;
    this.armyMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.scene.add(this.armyMesh);

    this.scene.add(this.pathLines);

    this.battleRing = new THREE.Mesh(new THREE.RingGeometry(0.03, 0.036, 32), new THREE.MeshBasicMaterial({ color: 0xff3030, side: THREE.DoubleSide, transparent: true, opacity: 0.9, depthTest: false }));
    this.battleRing.visible = false;
    this.battleRing.renderOrder = 10;
    this.scene.add(this.battleRing);

    this.redrawTexture();
  }

  resize(w: number, h: number) {
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  /** Focus camera on a province. */
  focusProvince(id: number, distance = 2.2) {
    const p = this.world.provinces[id];
    const dir = p.pos.clone().normalize();
    this.controls.target.set(0, 0, 0);
    this.camera.position.copy(dir.multiplyScalar(distance));
    this.controls.update();
  }

  pickProvince(ndcX: number, ndcY: number): Province | null {
    this.raycaster.setFromCamera(new THREE.Vector2(ndcX, ndcY), this.camera);
    const hits = this.raycaster.intersectObject(this.globe, false);
    if (!hits.length) return null;
    return provinceAtPoint(this.world, hits[0].point);
  }

  markDirty() {
    this.dirtyTexture = true;
  }

  private nationColor(owner: string | null): THREE.Color {
    if (!owner) return new THREE.Color(0x000000);
    if (owner === 'minor') return MINOR_COLOR;
    const n = this.sim.era.nations.find((x) => x.id === owner);
    return new THREE.Color(n ? n.color : 0xffffff);
  }

  redrawTexture() {
    const { W, H, indexMap, provinces } = this.world;
    const d = this.imageData.data;
    const colorCache = new Map<string, THREE.Color>();
    const ownerColor = (o: string | null) => {
      const k = o ?? '_';
      let c = colorCache.get(k);
      if (!c) {
        c = this.nationColor(o);
        colorCache.set(k, c);
      }
      return c;
    };
    const player = this.sim.player;
    const warWith = (o: string | null) => !!o && o !== 'minor' && player.wars.has(o);
    const provColors: THREE.Color[] = provinces.map((p) => {
      const c = new THREE.Color();
      if (!p.isLand) {
        c.setHex(p.terrain === 'ice' ? 0xe6eef5 : 0x1e4f8a);
        return c;
      }
      const t = new THREE.Color(TERRAIN_INFO[p.terrain].color);
      const o = ownerColor(p.owner);
      c.copy(t).lerp(o, 0.6).multiplyScalar(1.15);
      if (p.id === this.selectedProvince) c.lerp(new THREE.Color(0xffffff), 0.35);
      else if (p.id === this.hoveredProvince) c.lerp(new THREE.Color(0xffffff), 0.15);
      return c;
    });
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const i = y * W + x;
        const pi = indexMap[i];
        const p = provinces[pi];
        const c = provColors[pi];
        const s = this.shade[i];
        let r = c.r;
        let g = c.g;
        let b = c.b;
        if (p.isLand) {
          const v = 1 + s * 0.22;
          r *= v;
          g *= v;
          b *= v;
        } else if (p.terrain === 'sea') {
          const v = 1 + s * 0.35;
          r *= v;
          g *= v;
          b *= v;
        }
        // borders
        const right = indexMap[y * W + ((x + 1) % W)];
        const down = y + 1 < H ? indexMap[(y + 1) * W + x] : pi;
        const left = indexMap[y * W + ((x + W - 1) % W)];
        const up = y > 0 ? indexMap[(y - 1) * W + x] : pi;
        let edge = 0;
        let war = false;
        for (const o of [right, down, left, up]) {
          if (o === pi) continue;
          const q = provinces[o];
          if (p.isLand && q.isLand) {
            if (q.owner !== p.owner) {
              edge = Math.max(edge, 0.55);
              if ((warWith(p.owner) && q.owner === player.id) || (warWith(q.owner) && p.owner === player.id)) war = true;
            } else edge = Math.max(edge, 0.18);
          } else if (p.isLand !== q.isLand) edge = Math.max(edge, 0.35);
        }
        if (war) {
          r = 1;
          g = 0.15;
          b = 0.1;
        } else if (edge > 0) {
          r *= 1 - edge;
          g *= 1 - edge;
          b *= 1 - edge;
        }
        d[i * 4] = Math.min(255, r * 255);
        d[i * 4 + 1] = Math.min(255, g * 255);
        d[i * 4 + 2] = Math.min(255, b * 255);
        d[i * 4 + 3] = 255;
      }
    }
    this.ctx.putImageData(this.imageData, 0, 0);
    this.texture.needsUpdate = true;
    this.dirtyTexture = false;
  }

  private armyWorldPos(a: Army, out: THREE.Vector3): THREE.Vector3 {
    const from = this.world.provinces[a.province].pos;
    if (a.path.length > 1 && a.needed > 0) {
      const to = this.world.provinces[a.path[1]].pos;
      const t = Math.min(1, a.progress / a.needed);
      out.copy(from).lerp(to, t).normalize();
    } else out.copy(from);
    return out;
  }

  private ensureLabel(key: string, cls: string): HTMLDivElement {
    let el = this.labels.get(key);
    if (!el) {
      el = document.createElement('div');
      el.className = 'globe-label ' + cls;
      this.labelRoot.appendChild(el);
      this.labels.set(key, el);
    }
    return el;
  }

  update(dt: number) {
    this.time += dt;
    if (this.dirtyTexture) this.redrawTexture();
    this.clouds.rotation.y += dt * 0.004;
    this.controls.autoRotate = this.autoRotate;
    this.controls.autoRotateSpeed = 0.35;
    const dist = this.camera.position.length();
    this.controls.rotateSpeed = Math.max(0.12, (dist - 1) * 0.45);
    this.controls.update();
    // key light follows the camera so the viewed hemisphere is always lit
    const camDir = this.camera.position.clone().normalize();
    const camRight = new THREE.Vector3().crossVectors(camDir, new THREE.Vector3(0, 1, 0)).normalize();
    this.sun.position.copy(camDir).multiplyScalar(4).add(camRight.multiplyScalar(-2.2)).add(new THREE.Vector3(0, 2.5, 0));

    // armies
    const armies = [...this.sim.armies.values()];
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const pos = new THREE.Vector3();
    const up = new THREE.Vector3(0, 1, 0);
    const color = new THREE.Color();
    const stackCount = new Map<number, number>();
    this.armyIds = [];
    let i = 0;
    for (const a of armies) {
      if (i >= 256) break;
      this.armyWorldPos(a, pos);
      const key = a.path.length > 1 ? -1 : a.province;
      const k = stackCount.get(key) ?? 0;
      stackCount.set(key, k + 1);
      const scale = 0.85 + Math.min(1.2, a.men / 18000) * 0.5;
      const lift = 1.008 + k * 0.007;
      q.setFromUnitVectors(up, pos);
      m.compose(pos.clone().multiplyScalar(lift), q, new THREE.Vector3(scale, 1, scale));
      this.armyMesh.setMatrixAt(i, m);
      color.copy(this.nationColor(a.nation));
      if (a.id === this.selectedArmy) color.lerp(new THREE.Color(0xffffff), 0.5 + 0.3 * Math.sin(this.time * 6));
      this.armyMesh.setColorAt(i, color);
      this.armyIds.push(a.id);
      i++;
    }
    this.armyMesh.count = i;
    this.armyMesh.instanceMatrix.needsUpdate = true;
    if (this.armyMesh.instanceColor) this.armyMesh.instanceColor.needsUpdate = true;

    // paths
    this.pathLines.clear();
    for (const a of armies) {
      if (a.path.length < 2) continue;
      if (a.nation !== this.sim.playerId && a.id !== this.selectedArmy) continue;
      const pts: THREE.Vector3[] = [];
      this.armyWorldPos(a, pos);
      pts.push(pos.clone().multiplyScalar(1.012));
      for (let k = 1; k < a.path.length; k++) {
        const from = pts[pts.length - 1].clone().normalize();
        const to = this.world.provinces[a.path[k]].pos;
        for (let s = 1; s <= 6; s++) pts.push(from.clone().lerp(to, s / 6).normalize().multiplyScalar(1.012));
      }
      const geo = new THREE.BufferGeometry().setFromPoints(pts);
      const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: a.nation === this.sim.playerId ? 0xffe28a : 0xff6060, transparent: true, opacity: 0.9 }));
      this.pathLines.add(line);
    }

    // battle ring
    const b = this.sim.pendingBattle ?? this.sim.activeBattle;
    if (b) {
      const p = this.world.provinces[b.provinceId];
      this.battleRing.visible = true;
      this.battleRing.position.copy(p.pos).multiplyScalar(1.01);
      this.battleRing.lookAt(p.pos.clone().multiplyScalar(2));
      const s = 1 + 0.25 * Math.sin(this.time * 5);
      this.battleRing.scale.set(s, s, s);
    } else this.battleRing.visible = false;

    this.updateLabels();
  }

  private updateLabels() {
    const w = this.renderer.domElement.clientWidth;
    const h = this.renderer.domElement.clientHeight;
    const camDir = this.camera.position.clone().normalize();
    const seen = new Set<string>();
    const place = (key: string, cls: string, worldPos: THREE.Vector3, text: string, extraStyle?: (el: HTMLDivElement) => void) => {
      const facing = worldPos.clone().normalize().dot(camDir);
      const el = this.ensureLabel(key, cls);
      seen.add(key);
      if (facing < 0.12) {
        el.style.display = 'none';
        return;
      }
      const v = worldPos.clone().project(this.camera);
      const x = (v.x * 0.5 + 0.5) * w;
      const y = (-v.y * 0.5 + 0.5) * h;
      el.style.display = '';
      el.style.transform = `translate(-50%, -50%) translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
      el.style.opacity = String(Math.min(1, (facing - 0.12) * 4));
      if (el.textContent !== text) el.textContent = text;
      extraStyle?.(el);
    };
    const dist = this.camera.position.length();
    const showArmies = dist < 3.6;
    for (const p of this.world.provinces) {
      if (!p.capitalOf) continue;
      const n = this.sim.nations.get(p.capitalOf);
      place('cap' + p.id, 'capital', p.pos.clone().multiplyScalar(1.03), n && n.alive ? n.def.name : p.name);
    }
    if (showArmies) {
      const pos = new THREE.Vector3();
      const grouped = new Map<number, Army[]>();
      for (const a of this.sim.armies.values()) {
        if (a.path.length > 1) {
          this.armyWorldPos(a, pos);
          place('army' + a.id, 'army moving', pos.clone().multiplyScalar(1.03), `${Math.round(a.men / 1000)}k`, (el) => {
            el.style.setProperty('--c', '#' + this.nationColor(a.nation).getHexString());
          });
          continue;
        }
        (grouped.get(a.province) ?? grouped.set(a.province, []).get(a.province)!).push(a);
      }
      for (const [pid, list] of grouped) {
        const p = this.world.provinces[pid];
        const men = list.reduce((s, a) => s + a.men, 0);
        const owner = list[0].nation;
        place('armyp' + pid, 'army' + (list.some((a) => a.id === this.selectedArmy) ? ' sel' : ''), p.pos.clone().multiplyScalar(1.035), `${list.length > 1 ? list.length + '× ' : ''}${Math.round(men / 1000)}k`, (el) => {
          el.style.setProperty('--c', '#' + this.nationColor(owner).getHexString());
        });
      }
    }
    if (this.selectedProvince !== null) {
      const p = this.world.provinces[this.selectedProvince];
      place('selp', 'province', p.pos.clone().multiplyScalar(1.02), p.name);
    }
    for (const [k, el] of this.labels) {
      if (!seen.has(k)) {
        el.remove();
        this.labels.delete(k);
      }
    }
  }

  dispose() {
    this.controls.dispose();
    for (const el of this.labels.values()) el.remove();
    this.labels.clear();
    this.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.geometry) m.geometry.dispose();
      const mat = m.material as THREE.Material | THREE.Material[] | undefined;
      if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
      else mat?.dispose();
    });
  }
}
