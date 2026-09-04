import * as THREE from 'three';
import { HALF, type Battlefield } from './terrain';
import type { Squad } from './soldiers';
import type { Input } from './input';
import { audio } from '../audio/audio';

export type CommanderAction = 'artillery' | 'air' | null;

export class CommanderMode {
  readonly camera: THREE.OrthographicCamera;
  active = false;
  selectedSquad: Squad | null = null;
  pendingAction: CommanderAction = null;
  private markers = new THREE.Group();
  private squadRings: THREE.Mesh[] = [];
  private raycaster = new THREE.Raycaster();
  private zoom = 1;
  private center = new THREE.Vector2(0, 0);
  onArtillery: ((p: THREE.Vector3) => boolean) | null = null;
  onAir: ((p: THREE.Vector3) => boolean) | null = null;
  onOrder: ((squad: Squad, p: THREE.Vector3) => void) | null = null;

  constructor(readonly scene: THREE.Scene, readonly field: Battlefield, readonly input: Input, readonly squads: () => Squad[]) {
    this.camera = new THREE.OrthographicCamera(-HALF, HALF, HALF, -HALF, 1, 600);
    this.camera.position.set(0, 300, 0);
    this.camera.up.set(0, 0, -1);
    this.camera.lookAt(0, 0, 0);
    scene.add(this.markers);
  }

  resize(aspect: number) {
    const h = HALF / this.zoom;
    const w = h * aspect;
    this.camera.left = -w;
    this.camera.right = w;
    this.camera.top = h;
    this.camera.bottom = -h;
    this.camera.updateProjectionMatrix();
  }

  enter() {
    this.active = true;
    this.pendingAction = null;
    this.input.releaseLock();
  }
  exit() {
    this.active = false;
    this.selectedSquad = null;
    this.pendingAction = null;
  }

  private groundPoint(ndc: THREE.Vector2 = this.input.mouseNDC): THREE.Vector3 | null {
    this.camera.updateMatrixWorld();
    this.raycaster.setFromCamera(ndc, this.camera);
    const hits = this.raycaster.intersectObject(this.field.terrainMesh, false);
    return hits.length ? hits[0].point : null;
  }

  private addOrderMarker(p: THREE.Vector3, color: number) {
    const m = new THREE.Mesh(new THREE.RingGeometry(2.5, 3.2, 24), new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide, transparent: true, opacity: 0.9, depthTest: false }));
    m.rotation.x = -Math.PI / 2;
    m.position.copy(p).add(new THREE.Vector3(0, 0.5, 0));
    m.renderOrder = 20;
    this.markers.add(m);
    setTimeout(() => this.markers.remove(m), 6000);
  }

  /** Viewport height in pixels, so touch drags pan by the right amount. */
  renderHeight = 900;

  update(dt: number, aspect: number) {
    if (!this.active) return;
    // pan / zoom
    if (this.input.wheel !== 0) this.zoom = Math.max(0.8, Math.min(3, this.zoom - this.input.wheel * 0.2));
    const pan = 120 * dt / this.zoom;
    if (this.input.down('KeyW')) this.center.y -= pan;
    if (this.input.down('KeyS')) this.center.y += pan;
    if (this.input.down('KeyA')) this.center.x -= pan;
    if (this.input.down('KeyD')) this.center.x += pan;
    this.center.x = Math.max(-HALF, Math.min(HALF, this.center.x));
    this.center.y = Math.max(-HALF, Math.min(HALF, this.center.y));
    this.camera.position.set(this.center.x, 300, this.center.y);
    this.camera.lookAt(this.center.x, 0, this.center.y);
    this.resize(aspect);
    // touch: one finger drags the map, two fingers pinch to zoom
    if (this.input.pinchDelta) this.zoom = Math.max(0.8, Math.min(3, this.zoom * (1 + this.input.pinchDelta)));
    if (this.input.dragX || this.input.dragY) {
      const scale = (HALF / this.zoom) / (this.renderHeight * 0.5);
      this.center.x -= this.input.dragX * scale;
      this.center.y -= this.input.dragY * scale;
    }
    if (this.input.pressed('KeyZ')) this.pendingAction = this.pendingAction === 'artillery' ? null : 'artillery';
    if (this.input.pressed('KeyX')) this.pendingAction = this.pendingAction === 'air' ? null : 'air';
    if (this.input.pressed('Escape')) this.pendingAction = null;
    const tap = this.input.tap;
    if (this.input.mousePressed(0) || (tap && tap.button === 0)) {
      const p = this.groundPoint(tap ? new THREE.Vector2(tap.x, tap.y) : undefined);
      if (p) {
        if (this.pendingAction === 'artillery') {
          if (this.onArtillery?.(p)) this.addOrderMarker(p, 0xffb040);
          this.pendingAction = null;
        } else if (this.pendingAction === 'air') {
          if (this.onAir?.(p)) this.addOrderMarker(p, 0xff5050);
          this.pendingAction = null;
        } else {
          // select squad
          let best: Squad | null = null;
          let bestD = 18;
          for (const s of this.squads()) {
            if (s.team !== 'player' || !s.alive.length) continue;
            const d = s.center().distanceTo(p);
            if (d < bestD) {
              bestD = d;
              best = s;
            }
          }
          this.selectedSquad = best;
          if (best) audio.click(1.2);
        }
      }
    }
    if ((this.input.mousePressed(2) || (tap && tap.button === 2)) && this.selectedSquad) {
      const p = this.groundPoint(tap ? new THREE.Vector2(tap.x, tap.y) : undefined);
      if (p) {
        this.onOrder?.(this.selectedSquad, p);
        this.addOrderMarker(p, 0x6fb8ff);
        audio.click(0.9);
      }
    }
    // squad rings
    const squads = this.squads().filter((s) => s.alive.length);
    while (this.squadRings.length < squads.length) {
      const m = new THREE.Mesh(new THREE.RingGeometry(5, 5.8, 24), new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide, transparent: true, opacity: 0.7, depthTest: false }));
      m.rotation.x = -Math.PI / 2;
      m.renderOrder = 19;
      this.markers.add(m);
      this.squadRings.push(m);
    }
    this.squadRings.forEach((m, i) => {
      const s = squads[i];
      m.visible = !!s;
      if (!s) return;
      const c = s.center();
      m.position.set(c.x, c.y + 0.5, c.z);
      const mat = m.material as THREE.MeshBasicMaterial;
      mat.color.setHex(s.team === 'player' ? (s === this.selectedSquad ? 0xffe28a : 0x6fb8ff) : 0xff5a4a);
      const pulse = s === this.selectedSquad ? 1 + 0.15 * Math.sin(performance.now() * 0.008) : 1;
      m.scale.setScalar(pulse);
    });
  }

  setVisible(v: boolean) {
    this.markers.visible = v;
  }

  dispose() {
    this.scene.remove(this.markers);
  }
}
