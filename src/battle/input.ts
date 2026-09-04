import * as THREE from 'three';

export class Input {
  private keys = new Set<string>();
  /** Buttons and keys driven by the on-screen controls. */
  private virtualKeys = new Set<string>();
  private virtualPressed = new Set<string>();
  private virtualButtons = new Set<number>();
  private virtualButtonPressed = new Set<number>();
  /** Analog movement from a thumbstick: x = strafe, y = forward. */
  stick = { x: 0, y: 0 };
  /** True while the look area is being dragged, so the game can skip pointer lock. */
  touchLook = false;
  private touchLookEnding = false;
  /** Screen-space drag for map-style views, in pixels this frame. */
  dragX = 0;
  dragY = 0;
  /** Relative pinch change this frame (positive = zoom in). */
  pinchDelta = 0;
  /** A completed tap, in normalised device coordinates. */
  tap: { x: number; y: number; button: number } | null = null;
  private pressedKeys = new Set<string>();
  private buttons = new Set<number>();
  private pressedButtons = new Set<number>();
  mouseDX = 0;
  mouseDY = 0;
  wheel = 0;
  locked = false;
  mouseNDC = new THREE.Vector2();
  private handlers: Array<[EventTarget, string, EventListener]> = [];
  wantsLock = false;
  onLockLost: (() => void) | null = null;

  constructor(readonly canvas: HTMLCanvasElement) {
    const on = (t: EventTarget, type: string, fn: (e: any) => void) => {
      t.addEventListener(type, fn);
      this.handlers.push([t, type, fn]);
    };
    on(document, 'keydown', ((e: KeyboardEvent) => {
      if (e.repeat) return;
      this.keys.add(e.code);
      this.pressedKeys.add(e.code);
      if (['Tab', 'Space', 'KeyF', 'KeyR', 'ControlLeft', 'ShiftLeft'].includes(e.code) || e.code.startsWith('Digit')) e.preventDefault();
    }));
    on(document, 'keyup', ((e: KeyboardEvent) => this.keys.delete(e.code)));
    on(document, 'mousemove', ((e: MouseEvent) => {
      if (this.locked) {
        this.mouseDX += e.movementX;
        this.mouseDY += e.movementY;
      }
      const r = canvas.getBoundingClientRect();
      this.mouseNDC.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    }));
    on(canvas, 'mousedown', ((e: MouseEvent) => {
      this.buttons.add(e.button);
      this.pressedButtons.add(e.button);
      if (e.button === 1) e.preventDefault();
    }));
    on(document, 'mouseup', ((e: MouseEvent) => this.buttons.delete(e.button)));
    on(canvas, 'contextmenu', ((e: Event) => e.preventDefault()));
    on(canvas, 'wheel', ((e: WheelEvent) => {
      this.wheel += Math.sign(e.deltaY);
    }));
    on(document, 'pointerlockchange', (() => {
      const was = this.locked;
      this.locked = document.pointerLockElement === canvas;
      if (was && !this.locked) this.onLockLost?.();
    }));
    on(document, 'pointerlockerror', (() => {
      this.locked = false;
    }));
    on(window, 'blur', (() => {
      this.keys.clear();
      this.buttons.clear();
    }));
  }

  requestLock() {
    if (document.pointerLockElement === this.canvas) return;
    // Chrome rejects the returned promise when there is no user gesture; swallow it
    // so a redeploy without focus does not spew unhandled rejections.
    const attempt = (opts?: PointerLockOptions): Promise<void> | null => {
      try {
        const p = (opts ? this.canvas.requestPointerLock(opts) : this.canvas.requestPointerLock()) as unknown;
        return p && typeof (p as Promise<void>).then === 'function' ? (p as Promise<void>) : null;
      } catch {
        return null;
      }
    };
    const first = attempt({ unadjustedMovement: true } as PointerLockOptions);
    if (first) first.catch(() => attempt()?.catch(() => {}));
  }
  releaseLock() {
    if (document.pointerLockElement === this.canvas) document.exitPointerLock();
  }
  down(code: string): boolean {
    return this.keys.has(code) || this.virtualKeys.has(code);
  }
  pressed(code: string): boolean {
    return this.pressedKeys.has(code) || this.virtualPressed.has(code);
  }
  mouseDown(b: number): boolean {
    return this.buttons.has(b) || this.virtualButtons.has(b);
  }
  mousePressed(b: number): boolean {
    return this.pressedButtons.has(b) || this.virtualButtonPressed.has(b);
  }

  /** Movement axes, from the thumbstick when present and the keyboard otherwise. */
  moveAxis(): { x: number; y: number } {
    let x = this.stick.x;
    let y = this.stick.y;
    if (this.down('KeyW')) y += 1;
    if (this.down('KeyS')) y -= 1;
    if (this.down('KeyD')) x += 1;
    if (this.down('KeyA')) x -= 1;
    const len = Math.hypot(x, y);
    if (len > 1) {
      x /= len;
      y /= len;
    }
    return { x, y };
  }

  // ---- driven by the on-screen controls
  setVirtualKey(code: string, down: boolean) {
    if (down) {
      if (!this.virtualKeys.has(code)) this.virtualPressed.add(code);
      this.virtualKeys.add(code);
    } else this.virtualKeys.delete(code);
  }
  tapVirtualKey(code: string) {
    this.virtualPressed.add(code);
  }
  setVirtualButton(b: number, down: boolean) {
    if (down) {
      if (!this.virtualButtons.has(b)) this.virtualButtonPressed.add(b);
      this.virtualButtons.add(b);
    } else this.virtualButtons.delete(b);
  }
  addLook(dx: number, dy: number) {
    this.mouseDX += dx;
    this.mouseDY += dy;
  }
  /**
   * End a touch look drag. The flag survives until the end of the next frame so a
   * flick that lifts off before the frame renders still turns the camera.
   */
  endTouchLook() {
    this.touchLookEnding = true;
  }
  clearVirtual() {
    this.virtualKeys.clear();
    this.virtualButtons.clear();
    this.stick.x = 0;
    this.stick.y = 0;
  }

  endFrame() {
    this.pressedKeys.clear();
    this.pressedButtons.clear();
    this.virtualPressed.clear();
    this.virtualButtonPressed.clear();
    this.mouseDX = 0;
    this.mouseDY = 0;
    this.wheel = 0;
    this.dragX = 0;
    this.dragY = 0;
    this.pinchDelta = 0;
    this.tap = null;
    if (this.touchLookEnding) {
      this.touchLook = false;
      this.touchLookEnding = false;
    }
  }
  dispose() {
    for (const [t, type, fn] of this.handlers) t.removeEventListener(type, fn);
    this.releaseLock();
  }
}
