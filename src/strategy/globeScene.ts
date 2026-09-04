import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { TERRAIN_INFO, provinceAtPoint, type World, type Province } from './world';
import type { StrategySim, Army } from './sim';
import { Noise3D } from '../core/noise';
import { latLonToVec3, clamp } from '../core/math';
import { hashString } from '../core/rng';
import { device } from '../core/device';
import countriesData from '../data/geo/countries.json';

/** Muted, distinct colour for an independent country. */
export function minorColor(country: string | null): THREE.Color {
  const h = (hashString(country ?? 'x') % 360) / 360;
  return new THREE.Color().setHSL(h, 0.28, 0.62);
}

export class GlobeScene {
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly controls: OrbitControls;
  readonly globe: THREE.Mesh;
  private indexTex: THREE.DataTexture;
  private provTex: THREE.DataTexture;
  private infoTex: THREE.DataTexture;
  private provData: Uint8Array;
  private infoData: Uint8Array;
  private paletteW: number;
  private clouds: THREE.Mesh;
  private armyMesh: THREE.InstancedMesh;
  private capitalGroup = new THREE.Group();
  private pathLines = new THREE.Group();
  private battleRing: THREE.Mesh;
  private labelRoot: HTMLElement;
  private labels = new Map<string, HTMLDivElement>();
  private raycaster = new THREE.Raycaster();
  private sun: THREE.DirectionalLight;
  private nationIndex = new Map<string, number>();
  private countrySize = new Map<string, number>();
  selectedProvince: number | null = null;
  hoveredProvince: number | null = null;
  selectedArmy: number | null = null;
  autoRotate = false;
  private time = 0;
  private dirtyPalette = true;
  private labelTimer = 0;

  constructor(readonly renderer: THREE.WebGLRenderer, readonly world: World, readonly sim: StrategySim, labelRoot: HTMLElement) {
    this.labelRoot = labelRoot;
    this.camera = new THREE.PerspectiveCamera(42, 1, 0.01, 200);
    this.camera.position.set(0, 0.9, 2.6);
    this.controls = new OrbitControls(this.camera, renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.enablePan = false;
    this.controls.minDistance = 1.12;
    this.controls.maxDistance = 4.5;
    this.controls.zoomSpeed = 0.8;
    // one finger orbits, two fingers pinch-zoom
    this.controls.touches = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_ROTATE };
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
    this.sun = new THREE.DirectionalLight(0xfff2dc, 2.4);
    this.sun.position.set(3, 2, 4);
    this.scene.add(this.sun);
    this.scene.add(new THREE.AmbientLight(0x8a9cc8, 1.1));
    this.scene.add(new THREE.HemisphereLight(0x8fb3ff, 0x1a1408, 0.35));

    for (const p of world.provinces) if (p.country && p.isLand) this.countrySize.set(p.country, (this.countrySize.get(p.country) ?? 0) + 1);
    // ---- nation indices for the shader
    let ni = 1;
    for (const n of sim.nations.keys()) this.nationIndex.set(n, ni++);

    // ---- textures
    const { W, H } = world;
    const idxData = new Uint8Array(W * H * 4);
    for (let i = 0; i < W * H; i++) {
      const v = world.indexMap[i];
      idxData[i * 4] = v & 255;
      idxData[i * 4 + 1] = v >> 8;
      idxData[i * 4 + 3] = 255;
    }
    this.indexTex = new THREE.DataTexture(idxData, W, H, THREE.RGBAFormat);
    this.indexTex.magFilter = THREE.NearestFilter;
    this.indexTex.minFilter = THREE.NearestFilter;
    this.indexTex.flipY = true;
    this.indexTex.needsUpdate = true;
    this.paletteW = Math.max(16, world.provinces.length);
    this.provData = new Uint8Array(this.paletteW * 4);
    this.infoData = new Uint8Array(this.paletteW * 4);
    this.provTex = new THREE.DataTexture(this.provData, this.paletteW, 1, THREE.RGBAFormat);
    this.infoTex = new THREE.DataTexture(this.infoData, this.paletteW, 1, THREE.RGBAFormat);
    for (const t of [this.provTex, this.infoTex]) {
      t.magFilter = THREE.NearestFilter;
      t.minFilter = THREE.NearestFilter;
    }
    const { base, bump } = this.buildBaseTextures();

    const mat = new THREE.MeshStandardMaterial({ map: base, bumpMap: bump, bumpScale: 1.2, roughness: 0.8, metalness: 0.02 });
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.indexTex = { value: this.indexTex };
      shader.uniforms.provTex = { value: this.provTex };
      shader.uniforms.infoTex = { value: this.infoTex };
      shader.uniforms.indexSize = { value: new THREE.Vector2(W, H) };
      shader.uniforms.paletteW = { value: this.paletteW };
      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          `#include <common>
          uniform sampler2D indexTex; uniform sampler2D provTex; uniform sampler2D infoTex; uniform vec2 indexSize; uniform float paletteW;
          float decodeIdx(vec4 c){ return floor(c.r * 255.0 + 0.5) + floor(c.g * 255.0 + 0.5) * 256.0; }
          vec4 provInfo(float idx){ return texture2D(infoTex, vec2((idx + 0.5) / paletteW, 0.5)); }`,
        )
        .replace(
          '#include <map_fragment>',
          `vec2 guv = vMapUv;
          vec4 baseCol = texture2D(map, guv);
          float idx = decodeIdx(texture2D(indexTex, guv));
          vec4 info = provInfo(idx);
          vec2 px = 1.0 / indexSize;
          // 2x2 supersampled province tint softens the raster steps along borders
          vec4 pc = vec4(0.0);
          for (int sx = 0; sx < 2; sx++) for (int sy = 0; sy < 2; sy++) {
            vec2 suv = guv + vec2(float(sx) - 0.5, float(sy) - 0.5) * px * 0.6;
            float sidx = decodeIdx(texture2D(indexTex, suv));
            pc += texture2D(provTex, vec2((sidx + 0.5) / paletteW, 0.5));
          }
          pc *= 0.25;
          vec3 col = mix(baseCol.rgb, pc.rgb, pc.a);
          float nation = 0.0; float prov = 0.0; float war = 0.0; float coast = 0.0;
          for (int k = 0; k < 4; k++) {
            vec2 off = k == 0 ? vec2(px.x, 0.0) : k == 1 ? vec2(-px.x, 0.0) : k == 2 ? vec2(0.0, px.y) : vec2(0.0, -px.y);
            float nidx = decodeIdx(texture2D(indexTex, guv + off * 1.5));
            if (nidx != idx) {
              vec4 ninfo = provInfo(nidx);
              bool landA = info.a > 0.5; bool landB = ninfo.a > 0.5;
              if (landA && landB) {
                prov = 1.0;
                if (abs(ninfo.r - info.r) > 0.001 || abs(ninfo.g - info.g) > 0.001) nation = 1.0;
                bool warAB = (info.b > 0.75 && ninfo.b > 0.25 && ninfo.b < 0.75) || (ninfo.b > 0.75 && info.b > 0.25 && info.b < 0.75);
                if (warAB) war = 1.0;
              } else if (landA != landB) coast = 1.0;
            }
          }
          if (war > 0.5) col = mix(col, vec3(1.0, 0.12, 0.08), 0.9);
          else if (nation > 0.5) col *= 0.42;
          else if (prov > 0.5) col *= 0.8;
          else if (coast > 0.5) col *= 0.7;
          diffuseColor *= vec4(col, 1.0);`,
        );
    };
    this.globe = new THREE.Mesh(new THREE.SphereGeometry(1, device.lowPower ? 112 : 192, device.lowPower ? 72 : 128), mat);
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
    cc.width = 1024;
    cc.height = 512;
    const cctx = cc.getContext('2d')!;
    const cd = cctx.createImageData(1024, 512);
    const cn = new Noise3D(world.seed ^ 0x777);
    const tmp = new THREE.Vector3();
    for (let y = 0; y < 512; y++) {
      const lat = 90 - (y / 512) * 180;
      for (let x = 0; x < 1024; x++) {
        const lon = (x / 1024) * 360 - 180;
        latLonToVec3(lat, lon, 1, tmp);
        const v = cn.fbm(tmp.x * 5, tmp.y * 5, tmp.z * 5, 5, 2.2, 0.55);
        const a = Math.max(0, Math.min(1, (v - 0.14) * 3));
        const i = (y * 1024 + x) * 4;
        cd.data[i] = cd.data[i + 1] = cd.data[i + 2] = 255;
        cd.data[i + 3] = a * 190;
      }
    }
    cctx.putImageData(cd, 0, 0);
    const cloudTex = new THREE.CanvasTexture(cc);
    this.clouds = new THREE.Mesh(new THREE.SphereGeometry(1.015, 64, 48), new THREE.MeshLambertMaterial({ map: cloudTex, transparent: true, opacity: 0.32, depthWrite: false }));
    this.scene.add(this.clouds);

    // ---- capitals
    this.scene.add(this.capitalGroup);
    for (const p of world.provinces) {
      if (!p.capitalOf) continue;
      const nation = sim.nations.get(p.capitalOf);
      if (!nation) continue;
      const major = nation.def.playable !== false;
      const m = new THREE.Mesh(new THREE.OctahedronGeometry(major ? 0.011 : 0.007, 0), new THREE.MeshStandardMaterial({ color: nation.def.color, emissive: nation.def.color, emissiveIntensity: 0.5 }));
      m.position.copy(p.pos).multiplyScalar(1.01);
      m.lookAt(0, 0, 0);
      const ring = new THREE.Mesh(new THREE.RingGeometry(major ? 0.013 : 0.009, major ? 0.017 : 0.012, 24), new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide, transparent: true, opacity: 0.8 }));
      ring.position.copy(p.pos).multiplyScalar(1.003);
      ring.lookAt(p.pos.clone().multiplyScalar(2));
      this.capitalGroup.add(m, ring);
    }

    // ---- armies
    const counterGeo = new THREE.BoxGeometry(0.02, 0.006, 0.014);
    const counterMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.4, metalness: 0.2 });
    this.armyMesh = new THREE.InstancedMesh(counterGeo, counterMat, 512);
    this.armyMesh.count = 0;
    this.armyMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.scene.add(this.armyMesh);
    this.scene.add(this.pathLines);
    this.scene.add(this.buildBorderLines());

    this.battleRing = new THREE.Mesh(new THREE.RingGeometry(0.03, 0.036, 32), new THREE.MeshBasicMaterial({ color: 0xff3030, side: THREE.DoubleSide, transparent: true, opacity: 0.9, depthTest: false }));
    this.battleRing.visible = false;
    this.battleRing.renderOrder = 10;
    this.scene.add(this.battleRing);

    this.updatePalette();
  }

  /** Crisp vector coastlines / country borders from the polygon data, draped just above the surface. */
  private buildBorderLines(): THREE.LineSegments {
    const pts: number[] = [];
    const a = new THREE.Vector3();
    const b = new THREE.Vector3();
    for (const c of countriesData as { polygons: number[][][] }[]) {
      for (const poly of c.polygons) {
        for (const ring of poly) {
          const n = ring.length / 2;
          for (let i = 0; i < n; i++) {
            const j = (i + 1) % n;
            latLonToVec3(ring[i * 2 + 1], ring[i * 2], 1.0025, a);
            latLonToVec3(ring[j * 2 + 1], ring[j * 2], 1.0025, b);
            if (Math.abs(ring[i * 2] - ring[j * 2]) > 180) continue; // antimeridian jump
            pts.push(a.x, a.y, a.z, b.x, b.y, b.z);
          }
        }
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    const lines = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: 0x0a0c10, transparent: true, opacity: 0.55, depthWrite: false }));
    lines.renderOrder = 2;
    return lines;
  }

  /** Static terrain colouring (land biomes, hillshade, coastal shelf) and a bump map. */
  private buildBaseTextures(): { base: THREE.CanvasTexture; bump: THREE.CanvasTexture } {
    const { W, H, world } = { W: this.world.W, H: this.world.H, world: this.world };
    const c = document.createElement('canvas');
    c.width = W;
    c.height = H;
    const ctx = c.getContext('2d')!;
    const img = ctx.createImageData(W, H);
    const bw = W / 2;
    const bh = H / 2;
    const bc = document.createElement('canvas');
    bc.width = bw;
    bc.height = bh;
    const bctx = bc.getContext('2d')!;
    const bimg = bctx.createImageData(bw, bh);
    const n = new Noise3D(world.seed ^ 0x1234);
    const tmp = new THREE.Vector3();
    // distance-to-land for the coastal shelf (coarse dilation on a 1/4 grid)
    const cw = W / 4;
    const ch = H / 4;
    const coast = new Uint8Array(cw * ch);
    for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) coast[y * cw + x] = world.landMask[y * 4 * W + x * 4] ? 0 : 255;
    for (let pass = 0; pass < 14; pass++) {
      const next = new Uint8Array(coast);
      for (let y = 1; y < ch - 1; y++)
        for (let x = 0; x < cw; x++) {
          const i = y * cw + x;
          if (coast[i] === 0) continue;
          const m = Math.min(coast[i - cw], coast[i + cw], coast[y * cw + ((x + 1) % cw)], coast[y * cw + ((x + cw - 1) % cw)]);
          next[i] = Math.min(coast[i], m + 18);
        }
      coast.set(next);
    }
    const col = new THREE.Color();
    const elevCache = new Float32Array(bw * bh);
    for (let y = 0; y < bh; y++) {
      const lat = 90 - ((y + 0.5) / bh) * 180;
      for (let x = 0; x < bw; x++) elevCache[y * bw + x] = world.elevationAt(lat, ((x + 0.5) / bw) * 360 - 180);
    }
    for (let y = 0; y < H; y++) {
      const lat = 90 - ((y + 0.5) / H) * 180;
      const absLat = Math.abs(lat);
      for (let x = 0; x < W; x++) {
        const lon = ((x + 0.5) / W) * 360 - 180;
        const i = y * W + x;
        const mask = world.landMask[i];
        const p = world.provinces[world.indexMap[i]];
        latLonToVec3(lat, lon, 1, tmp);
        const nv = n.fbm(tmp.x * 12, tmp.y * 12, tmp.z * 12, 3);
        const e = elevCache[(y >> 1) * bw + (x >> 1)];
        const eR = elevCache[(y >> 1) * bw + Math.min(bw - 1, (x >> 1) + 1)];
        const shade = 1 + (e - eR) * 2.2;
        if (mask === 2 || (mask === 1 && p.terrain === 'ice') || (mask === 0 && absLat > 80)) {
          col.setHex(0xe9eff5);
          col.multiplyScalar(0.92 + nv * 0.08);
        } else if (mask === 1) {
          const t = p.isLand ? p.terrain : 'plains';
          col.setHex(TERRAIN_INFO[t === 'urban' ? 'plains' : t].color);
          // blend biome by latitude and elevation
          if (absLat > 55) col.lerp(new THREE.Color(0x5e6f4c), clamp((absLat - 55) / 15, 0, 1));
          if (e > 0.45) col.lerp(new THREE.Color(0x8d8a85), clamp((e - 0.45) / 0.3, 0, 1));
          if (e > 0.78) col.lerp(new THREE.Color(0xf0f0f0), clamp((e - 0.78) / 0.15, 0, 1));
          col.multiplyScalar((1 + nv * 0.14) * clamp(shade, 0.6, 1.4));
        } else {
          const fx = x / 4 - 0.5;
          const fy = y / 4 - 0.5;
          const x0 = Math.max(0, Math.floor(fx));
          const y0 = Math.max(0, Math.floor(fy));
          const x1 = Math.min(cw - 1, x0 + 1);
          const y1 = Math.min(ch - 1, y0 + 1);
          const tx = clamp(fx - x0, 0, 1);
          const ty = clamp(fy - y0, 0, 1);
          const c00 = coast[y0 * cw + x0];
          const c10 = coast[y0 * cw + x1];
          const c01 = coast[y1 * cw + x0];
          const c11 = coast[y1 * cw + x1];
          const d = ((c00 * (1 - tx) + c10 * tx) * (1 - ty) + (c01 * (1 - tx) + c11 * tx) * ty) / 255;
          col.setHex(0x2f7fc4).lerp(new THREE.Color(0x174a86), clamp(d * 1.6, 0, 1));
          col.multiplyScalar(1 + nv * 0.08);
        }
        img.data[i * 4] = Math.min(255, col.r * 255);
        img.data[i * 4 + 1] = Math.min(255, col.g * 255);
        img.data[i * 4 + 2] = Math.min(255, col.b * 255);
        img.data[i * 4 + 3] = 255;
      }
    }
    for (let y = 0; y < bh; y++) {
      for (let x = 0; x < bw; x++) {
        const i = y * bw + x;
        const land = world.landMask[y * 2 * W + x * 2];
        const h = land ? 90 + elevCache[i] * 165 : 40;
        bimg.data[i * 4] = bimg.data[i * 4 + 1] = bimg.data[i * 4 + 2] = h;
        bimg.data[i * 4 + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    bctx.putImageData(bimg, 0, 0);
    const base = new THREE.CanvasTexture(c);
    base.colorSpace = THREE.SRGBColorSpace;
    base.anisotropy = this.renderer.capabilities.getMaxAnisotropy();
    const bump = new THREE.CanvasTexture(bc);
    return { base, bump };
  }

  resize(w: number, h: number) {
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  focusProvince(id: number, distance = 2.2) {
    const p = this.world.provinces[id];
    const dir = p.pos.clone().normalize();
    this.controls.target.set(0, 0, 0);
    // flush any residual drag inertia so the province really lands at the screen centre
    this.controls.enableDamping = false;
    this.controls.update();
    this.camera.position.copy(dir.multiplyScalar(distance));
    this.controls.update();
    this.controls.enableDamping = true;
  }

  pickProvince(ndcX: number, ndcY: number): Province | null {
    // make picking independent of the render loop (camera may have moved since the last frame)
    this.camera.updateMatrixWorld();
    this.raycaster.setFromCamera(new THREE.Vector2(ndcX, ndcY), this.camera);
    const hits = this.raycaster.intersectObject(this.globe, false);
    if (!hits.length) return null;
    return provinceAtPoint(this.world, hits[0].point);
  }

  markDirty() {
    this.dirtyPalette = true;
  }

  nationColor(owner: string | null, country: string | null = null): THREE.Color {
    if (!owner) return new THREE.Color(0x000000);
    if (owner === 'minor') return minorColor(country);
    const n = this.sim.nations.get(owner);
    return new THREE.Color(n ? n.def.color : 0xffffff);
  }

  /** Per-province colour + info textures. Cheap: N provinces, no per-pixel work. */
  updatePalette() {
    const player = this.sim.player;
    const c = new THREE.Color();
    for (const p of this.world.provinces) {
      const o = p.id * 4;
      if (!p.isLand) {
        this.provData[o] = this.provData[o + 1] = this.provData[o + 2] = 0;
        this.provData[o + 3] = 0;
        this.infoData[o] = 0;
        this.infoData[o + 1] = 0;
        this.infoData[o + 2] = 0;
        this.infoData[o + 3] = 0;
        continue;
      }
      c.copy(this.nationColor(p.owner, p.country));
      let a = p.owner === 'minor' ? 0.45 : 0.56;
      if (p.id === this.selectedProvince) {
        c.lerp(new THREE.Color(0xffffff), 0.45);
        a = 0.85;
      } else if (p.id === this.hoveredProvince) {
        c.lerp(new THREE.Color(0xffffff), 0.2);
        a = 0.75;
      }
      this.provData[o] = c.r * 255;
      this.provData[o + 1] = c.g * 255;
      this.provData[o + 2] = c.b * 255;
      this.provData[o + 3] = a * 255;
      const ownerIdx = p.owner === 'minor' ? 0 : (this.nationIndex.get(p.owner!) ?? 0);
      const countryIdx = p.owner === 'minor' ? hashString(p.country ?? '') % 200 : 0;
      this.infoData[o] = ownerIdx;
      this.infoData[o + 1] = countryIdx;
      // b: 255 = player's own, 128 = at war with the player, 0 = other
      this.infoData[o + 2] = p.owner === player.id ? 255 : p.owner && p.owner !== 'minor' && player.wars.has(p.owner) ? 128 : 0;
      this.infoData[o + 3] = 255;
    }
    this.provTex.needsUpdate = true;
    this.infoTex.needsUpdate = true;
    this.dirtyPalette = false;
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
    } else if (el.className !== 'globe-label ' + cls) el.className = 'globe-label ' + cls;
    return el;
  }

  update(dt: number) {
    this.time += dt;
    if (this.dirtyPalette) this.updatePalette();
    this.clouds.rotation.y += dt * 0.003;
    this.controls.autoRotate = this.autoRotate;
    this.controls.autoRotateSpeed = 0.35;
    const dist = this.camera.position.length();
    this.controls.rotateSpeed = Math.max(0.05, (dist - 1) * 0.45);
    this.controls.update();
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
    let i = 0;
    const counterScale = clamp((dist - 1) * 0.9, 0.25, 1);
    for (const a of armies) {
      if (i >= 512) break;
      this.armyWorldPos(a, pos);
      const key = a.path.length > 1 ? -1 : a.province;
      const k = stackCount.get(key) ?? 0;
      stackCount.set(key, k + 1);
      const scale = (0.85 + Math.min(1.2, a.men / 18000) * 0.5) * counterScale;
      const lift = 1.006 + k * 0.006 * counterScale;
      q.setFromUnitVectors(up, pos);
      m.compose(pos.clone().multiplyScalar(lift), q, new THREE.Vector3(scale, counterScale, scale));
      this.armyMesh.setMatrixAt(i, m);
      color.copy(this.nationColor(a.nation));
      if (a.id === this.selectedArmy) color.lerp(new THREE.Color(0xffffff), 0.5 + 0.3 * Math.sin(this.time * 6));
      this.armyMesh.setColorAt(i, color);
      i++;
    }
    this.armyMesh.count = i;
    this.armyMesh.instanceMatrix.needsUpdate = true;
    if (this.armyMesh.instanceColor) this.armyMesh.instanceColor.needsUpdate = true;
    this.capitalGroup.scale.setScalar(1);
    for (const child of this.capitalGroup.children) child.scale.setScalar(clamp((dist - 1) * 0.9, 0.3, 1));

    // paths
    this.pathLines.clear();
    for (const a of armies) {
      if (a.path.length < 2) continue;
      if (a.nation !== this.sim.playerId && a.id !== this.selectedArmy) continue;
      const pts: THREE.Vector3[] = [];
      this.armyWorldPos(a, pos);
      pts.push(pos.clone().multiplyScalar(1.01));
      for (let k = 1; k < a.path.length; k++) {
        const from = pts[pts.length - 1].clone().normalize();
        const to = this.world.provinces[a.path[k]].pos;
        for (let s = 1; s <= 6; s++) pts.push(from.clone().lerp(to, s / 6).normalize().multiplyScalar(1.01));
      }
      const geo = new THREE.BufferGeometry().setFromPoints(pts);
      this.pathLines.add(new THREE.Line(geo, new THREE.LineBasicMaterial({ color: a.nation === this.sim.playerId ? 0xffe28a : 0xff6060, transparent: true, opacity: 0.9 })));
    }

    const b = this.sim.pendingBattle ?? this.sim.activeBattle;
    if (b) {
      const p = this.world.provinces[b.provinceId];
      this.battleRing.visible = true;
      this.battleRing.position.copy(p.pos).multiplyScalar(1.01);
      this.battleRing.lookAt(p.pos.clone().multiplyScalar(2));
      const s = (1 + 0.25 * Math.sin(this.time * 5)) * counterScale;
      this.battleRing.scale.set(s, s, s);
    } else this.battleRing.visible = false;

    this.labelTimer -= dt;
    if (this.labelTimer <= 0) {
      this.labelTimer = 0.05;
      this.updateLabels();
    }
  }

  private updateLabels() {
    const w = this.renderer.domElement.clientWidth;
    const h = this.renderer.domElement.clientHeight;
    const camDir = this.camera.position.clone().normalize();
    const dist = this.camera.position.length();
    const seen = new Set<string>();
    const place = (key: string, cls: string, worldPos: THREE.Vector3, text: string, extraStyle?: (el: HTMLDivElement) => void) => {
      const facing = worldPos.clone().normalize().dot(camDir);
      if (facing < 0.15) return;
      const el = this.ensureLabel(key, cls);
      seen.add(key);
      const v = worldPos.clone().project(this.camera);
      if (v.x < -1.1 || v.x > 1.1 || v.y < -1.1 || v.y > 1.1) {
        el.style.display = 'none';
        return;
      }
      const x = (v.x * 0.5 + 0.5) * w;
      const y = (-v.y * 0.5 + 0.5) * h;
      el.style.display = '';
      el.style.transform = `translate(-50%, -50%) translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
      el.style.opacity = String(Math.min(1, (facing - 0.15) * 4));
      if (el.textContent !== text) el.textContent = text;
      extraStyle?.(el);
    };
    const showArmies = dist < 3.6;
    const showCountries = dist < 2.7;
    const showProvinces = dist < 1.75;
    for (const p of this.world.provinces) {
      if (p.capitalOf) {
        const n = this.sim.nations.get(p.capitalOf);
        if (!n) continue;
        const major = n.def.playable !== false;
        if (!major && !showCountries) continue;
        place('cap' + p.id, major ? 'capital' : 'capital minor', p.pos.clone().multiplyScalar(1.03), n.alive ? n.def.name : p.name);
      } else if (showCountries && p.countryCapital && p.owner === 'minor' && p.isLand) {
        // tiny countries only get a label when zoomed in
        const small = (this.countrySize.get(p.country ?? '') ?? 1) < 2;
        if (small && dist > 1.9) continue;
        place('cc' + p.id, 'country', p.pos.clone().multiplyScalar(1.02), p.countryName ?? p.name);
      }
    }
    if (showProvinces) {
      const limit = 0.55 * (dist - 1) + 0.12;
      let count = 0;
      for (const p of this.world.provinces) {
        if (!p.isLand || p.capitalOf || count > 70) continue;
        if (p.pos.dot(camDir) < Math.cos(limit)) continue;
        if (p.countryCapital && p.owner === 'minor') continue;
        count++;
        place('pn' + p.id, 'provname', p.pos.clone().multiplyScalar(1.015), p.name);
      }
    }
    if (showArmies) {
      const pos = new THREE.Vector3();
      const grouped = new Map<number, Army[]>();
      for (const a of this.sim.armies.values()) {
        if (a.path.length > 1) {
          this.armyWorldPos(a, pos);
          place('army' + a.id, 'army moving', pos.clone().multiplyScalar(1.03), `${Math.round(a.men / 1000)}k`, (el) => el.style.setProperty('--c', '#' + this.nationColor(a.nation).getHexString()));
          continue;
        }
        (grouped.get(a.province) ?? grouped.set(a.province, []).get(a.province)!).push(a);
      }
      for (const [pid, list] of grouped) {
        const p = this.world.provinces[pid];
        const men = list.reduce((s, a) => s + a.men, 0);
        place('armyp' + pid, 'army' + (list.some((a) => a.id === this.selectedArmy) ? ' sel' : ''), p.pos.clone().multiplyScalar(1.035), `${list.length > 1 ? list.length + '× ' : ''}${Math.round(men / 1000)}k`, (el) => el.style.setProperty('--c', '#' + this.nationColor(list[0].nation).getHexString()));
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
    this.indexTex.dispose();
    this.provTex.dispose();
    this.infoTex.dispose();
    this.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.geometry) m.geometry.dispose();
      const mat = m.material as THREE.Material | THREE.Material[] | undefined;
      if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
      else mat?.dispose();
    });
  }
}
