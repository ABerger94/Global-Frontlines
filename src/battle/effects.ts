import * as THREE from 'three';

const MAX_PARTICLES = 4000;
const MAX_TRACERS = 300;

function makeSpriteTexture(): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.4, 'rgba(255,255,255,0.6)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  return t;
}

function makeSmokeTexture(): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const ctx = c.getContext('2d')!;
  for (let i = 0; i < 40; i++) {
    const x = 64 + (Math.random() - 0.5) * 70;
    const y = 64 + (Math.random() - 0.5) * 70;
    const r = 12 + Math.random() * 22;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, 'rgba(255,255,255,0.35)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 128, 128);
  }
  return new THREE.CanvasTexture(c);
}

interface Transient {
  update(dt: number): boolean; // false when finished
  dispose(): void;
}

export class Effects {
  readonly group = new THREE.Group();
  shake = 0;
  private pPos: Float32Array;
  private pCol: Float32Array;
  private pSize: Float32Array;
  private pVel: Float32Array;
  private pLife: Float32Array;
  private pMax: Float32Array;
  private pGrav: Float32Array;
  private pHead = 0;
  private points: THREE.Points;
  private tPos: Float32Array;
  private tCol: Float32Array;
  private tLife: Float32Array;
  private tHead = 0;
  private tracers: THREE.LineSegments;
  private transients: Transient[] = [];
  private spriteTex = makeSpriteTexture();
  private smokeTex = makeSmokeTexture();
  private flashMat: THREE.SpriteMaterial;
  private smokeMat: THREE.SpriteMaterial;
  private lightPool: THREE.PointLight[] = [];

  constructor(readonly scene: THREE.Scene) {
    scene.add(this.group);
    this.pPos = new Float32Array(MAX_PARTICLES * 3);
    this.pCol = new Float32Array(MAX_PARTICLES * 3);
    this.pSize = new Float32Array(MAX_PARTICLES);
    this.pVel = new Float32Array(MAX_PARTICLES * 3);
    this.pLife = new Float32Array(MAX_PARTICLES);
    this.pMax = new Float32Array(MAX_PARTICLES);
    this.pGrav = new Float32Array(MAX_PARTICLES);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pPos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('color', new THREE.BufferAttribute(this.pCol, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('size', new THREE.BufferAttribute(this.pSize, 1).setUsage(THREE.DynamicDrawUsage));
    const mat = new THREE.ShaderMaterial({
      uniforms: { map: { value: this.spriteTex } },
      vertexShader: `attribute float size; varying vec3 vColor; void main(){ vColor = color; vec4 mv = modelViewMatrix * vec4(position,1.0); gl_PointSize = size * (300.0 / -mv.z); gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `uniform sampler2D map; varying vec3 vColor; void main(){ vec4 t = texture2D(map, gl_PointCoord); if (t.a < 0.05) discard; gl_FragColor = vec4(vColor, t.a); }`,
      transparent: true,
      depthWrite: false,
      vertexColors: true,
    });
    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
    this.group.add(this.points);

    this.tPos = new Float32Array(MAX_TRACERS * 6);
    this.tCol = new Float32Array(MAX_TRACERS * 6);
    this.tLife = new Float32Array(MAX_TRACERS);
    const tg = new THREE.BufferGeometry();
    tg.setAttribute('position', new THREE.BufferAttribute(this.tPos, 3).setUsage(THREE.DynamicDrawUsage));
    tg.setAttribute('color', new THREE.BufferAttribute(this.tCol, 3).setUsage(THREE.DynamicDrawUsage));
    this.tracers = new THREE.LineSegments(tg, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false }));
    this.tracers.frustumCulled = false;
    this.group.add(this.tracers);

    this.flashMat = new THREE.SpriteMaterial({ map: this.spriteTex, color: 0xffd28a, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false });
    this.smokeMat = new THREE.SpriteMaterial({ map: this.smokeTex, color: 0x555555, transparent: true, depthWrite: false, opacity: 0.8 });
    for (let i = 0; i < 12; i++) {
      const l = new THREE.PointLight(0xffaa55, 0, 25, 2);
      l.visible = false;
      this.group.add(l);
      this.lightPool.push(l);
    }
  }

  private light(): THREE.PointLight | null {
    return this.lightPool.find((l) => !l.visible) ?? null;
  }

  particle(x: number, y: number, z: number, vx: number, vy: number, vz: number, r: number, g: number, b: number, size: number, life: number, gravity: number) {
    const i = this.pHead;
    this.pHead = (this.pHead + 1) % MAX_PARTICLES;
    this.pPos[i * 3] = x;
    this.pPos[i * 3 + 1] = y;
    this.pPos[i * 3 + 2] = z;
    this.pVel[i * 3] = vx;
    this.pVel[i * 3 + 1] = vy;
    this.pVel[i * 3 + 2] = vz;
    this.pCol[i * 3] = r;
    this.pCol[i * 3 + 1] = g;
    this.pCol[i * 3 + 2] = b;
    this.pSize[i] = size;
    this.pLife[i] = life;
    this.pMax[i] = life;
    this.pGrav[i] = gravity;
  }

  impact(pos: THREE.Vector3, kind: 'dust' | 'concrete' | 'blood' | 'metal' | 'mud' = 'dust', count = 10) {
    const col = kind === 'blood' ? [0.55, 0.05, 0.05] : kind === 'concrete' ? [0.7, 0.7, 0.68] : kind === 'metal' ? [1, 0.8, 0.4] : kind === 'mud' ? [0.35, 0.28, 0.18] : [0.6, 0.52, 0.4];
    for (let i = 0; i < count; i++) {
      const s = kind === 'metal' ? 6 : 2.5;
      this.particle(pos.x, pos.y, pos.z, (Math.random() - 0.5) * s, Math.random() * s * 0.8 + 0.5, (Math.random() - 0.5) * s, col[0], col[1], col[2], kind === 'metal' ? 0.12 : 0.35 + Math.random() * 0.3, 0.4 + Math.random() * 0.5, kind === 'metal' ? 9 : 3);
    }
  }

  tracer(from: THREE.Vector3, to: THREE.Vector3, color: THREE.Color | number = 0xffd080) {
    const i = this.tHead;
    this.tHead = (this.tHead + 1) % MAX_TRACERS;
    const c = color instanceof THREE.Color ? color : new THREE.Color(color);
    this.tPos.set([from.x, from.y, from.z, to.x, to.y, to.z], i * 6);
    this.tCol.set([c.r, c.g, c.b, c.r, c.g, c.b], i * 6);
    this.tLife[i] = 0.09;
  }

  muzzleFlash(pos: THREE.Vector3, big = false) {
    const l = this.light();
    if (l) {
      l.position.copy(pos);
      l.intensity = big ? 60 : 18;
      l.distance = big ? 30 : 14;
      l.color.setHex(0xffc070);
      l.visible = true;
      let t = 0;
      this.transients.push({
        update: (dt) => {
          t += dt;
          l.intensity *= 0.6;
          return t < 0.08;
        },
        dispose: () => (l.visible = false),
      });
    }
  }

  explosion(pos: THREE.Vector3, size = 1, colorHex = 0xffa040) {
    // flash
    const flash = new THREE.Sprite(this.flashMat.clone());
    flash.material.color.setHex(colorHex);
    flash.position.copy(pos).add(new THREE.Vector3(0, size * 1.5, 0));
    flash.scale.setScalar(size * 4);
    this.group.add(flash);
    let t = 0;
    this.transients.push({
      update: (dt) => {
        t += dt;
        flash.scale.setScalar(size * (4 + t * 30));
        flash.material.opacity = Math.max(0, 1 - t * 4);
        return t < 0.3;
      },
      dispose: () => {
        this.group.remove(flash);
        flash.material.dispose();
      },
    });
    // light
    const l = this.light();
    if (l) {
      l.position.copy(pos).add(new THREE.Vector3(0, size * 2, 0));
      l.intensity = 400 * size;
      l.distance = 40 * size;
      l.color.setHex(colorHex);
      l.visible = true;
      let lt = 0;
      this.transients.push({
        update: (dt) => {
          lt += dt;
          l.intensity = Math.max(0, 400 * size * (1 - lt * 2.5));
          return lt < 0.4;
        },
        dispose: () => (l.visible = false),
      });
    }
    // smoke sprites
    const n = Math.round(5 * size);
    for (let i = 0; i < n; i++) {
      const s = new THREE.Sprite(this.smokeMat.clone());
      s.position.copy(pos).add(new THREE.Vector3((Math.random() - 0.5) * size * 2, Math.random() * size, (Math.random() - 0.5) * size * 2));
      s.scale.setScalar(size * (2 + Math.random() * 2));
      s.material.rotation = Math.random() * Math.PI * 2;
      s.material.color.setHex(0x2a2622);
      this.group.add(s);
      const vy = 1.5 + Math.random() * 2;
      const vx = (Math.random() - 0.5) * 2;
      const vz = (Math.random() - 0.5) * 2;
      let st = 0;
      const life = 2.5 + Math.random() * 2 * size;
      this.transients.push({
        update: (dt) => {
          st += dt;
          s.position.x += vx * dt;
          s.position.y += vy * dt * Math.max(0.2, 1 - st / life);
          s.position.z += vz * dt;
          s.scale.addScalar(dt * 3 * size);
          s.material.opacity = 0.85 * Math.max(0, 1 - st / life);
          const g = 0.16 + (st / life) * 0.3;
          s.material.color.setRGB(g, g * 0.95, g * 0.9);
          return st < life;
        },
        dispose: () => {
          this.group.remove(s);
          s.material.dispose();
        },
      });
    }
    // debris + sparks
    for (let i = 0; i < 40 * size; i++) {
      const sp = 6 + Math.random() * 14 * size;
      const a = Math.random() * Math.PI * 2;
      const up = Math.random();
      const hot = Math.random() < 0.4;
      this.particle(pos.x, pos.y + 0.3, pos.z, Math.cos(a) * sp * (1 - up), sp * up + 2, Math.sin(a) * sp * (1 - up), hot ? 1 : 0.35, hot ? 0.6 : 0.28, hot ? 0.2 : 0.2, hot ? 0.25 : 0.5, 0.6 + Math.random() * 1.2, 12);
    }
    this.shake = Math.max(this.shake, size);
  }

  scorch(pos: THREE.Vector3, radius: number) {
    const m = new THREE.Mesh(new THREE.CircleGeometry(radius, 20), new THREE.MeshBasicMaterial({ color: 0x0a0806, transparent: true, opacity: 0.65, depthWrite: false }));
    m.rotation.x = -Math.PI / 2;
    m.position.copy(pos).add(new THREE.Vector3(0, 0.08, 0));
    this.group.add(m);
    let t = 0;
    this.transients.push({
      update: (dt) => {
        t += dt;
        if (t > 60) (m.material as THREE.MeshBasicMaterial).opacity = Math.max(0, 0.65 * (1 - (t - 60) / 20));
        return t < 80;
      },
      dispose: () => {
        this.group.remove(m);
        m.geometry.dispose();
        (m.material as THREE.Material).dispose();
      },
    });
  }

  /** Short-lived dust ring for landing/hit. */
  dustRing(pos: THREE.Vector3, size = 1) {
    for (let i = 0; i < 14; i++) {
      const a = (i / 14) * Math.PI * 2;
      this.particle(pos.x, pos.y + 0.2, pos.z, Math.cos(a) * 3 * size, 0.6, Math.sin(a) * 3 * size, 0.5, 0.45, 0.35, 0.6 * size, 0.5, 1);
    }
  }

  addTransient(t: Transient) {
    this.transients.push(t);
  }

  update(dt: number) {
    for (let i = 0; i < MAX_PARTICLES; i++) {
      if (this.pLife[i] <= 0) continue;
      this.pLife[i] -= dt;
      if (this.pLife[i] <= 0) {
        this.pSize[i] = 0;
        continue;
      }
      this.pVel[i * 3 + 1] -= this.pGrav[i] * dt;
      this.pVel[i * 3] *= 0.98;
      this.pVel[i * 3 + 2] *= 0.98;
      this.pPos[i * 3] += this.pVel[i * 3] * dt;
      this.pPos[i * 3 + 1] += this.pVel[i * 3 + 1] * dt;
      this.pPos[i * 3 + 2] += this.pVel[i * 3 + 2] * dt;
    }
    (this.points.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    (this.points.geometry.attributes.size as THREE.BufferAttribute).needsUpdate = true;
    (this.points.geometry.attributes.color as THREE.BufferAttribute).needsUpdate = true;
    for (let i = 0; i < MAX_TRACERS; i++) {
      if (this.tLife[i] <= 0) continue;
      this.tLife[i] -= dt;
      if (this.tLife[i] <= 0) this.tPos.fill(0, i * 6, i * 6 + 6);
    }
    (this.tracers.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    (this.tracers.geometry.attributes.color as THREE.BufferAttribute).needsUpdate = true;
    for (let i = this.transients.length - 1; i >= 0; i--) {
      if (!this.transients[i].update(dt)) {
        this.transients[i].dispose();
        this.transients.splice(i, 1);
      }
    }
    this.shake = Math.max(0, this.shake - dt * 2.5);
  }

  dispose() {
    for (const t of this.transients) t.dispose();
    this.transients = [];
    this.scene.remove(this.group);
  }
}
