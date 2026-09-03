import * as THREE from 'three';

export class Input {
  private keys = new Set<string>();
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
      this.locked = document.pointerLockElement === canvas;
    }));
    on(window, 'blur', (() => {
      this.keys.clear();
      this.buttons.clear();
    }));
  }

  requestLock() {
    if (document.pointerLockElement !== this.canvas) {
      try {
        const p = this.canvas.requestPointerLock({ unadjustedMovement: true } as any) as unknown;
        if (p && typeof (p as Promise<void>).catch === 'function') (p as Promise<void>).catch(() => this.canvas.requestPointerLock());
      } catch {
        try {
          this.canvas.requestPointerLock();
        } catch {
          /* ignore */
        }
      }
    }
  }
  releaseLock() {
    if (document.pointerLockElement === this.canvas) document.exitPointerLock();
  }
  down(code: string): boolean {
    return this.keys.has(code);
  }
  pressed(code: string): boolean {
    return this.pressedKeys.has(code);
  }
  mouseDown(b: number): boolean {
    return this.buttons.has(b);
  }
  mousePressed(b: number): boolean {
    return this.pressedButtons.has(b);
  }
  endFrame() {
    this.pressedKeys.clear();
    this.pressedButtons.clear();
    this.mouseDX = 0;
    this.mouseDY = 0;
    this.wheel = 0;
  }
  dispose() {
    for (const [t, type, fn] of this.handlers) t.removeEventListener(type, fn);
    this.releaseLock();
  }
}
