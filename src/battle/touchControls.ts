/**
 * On-screen controls for touch devices: a floating thumbstick on the left,
 * a look-and-fire area on the right, and action buttons within thumb reach.
 * Everything feeds the same `Input` the keyboard and mouse drive, so the rest
 * of the battle code needs no knowledge of touch.
 */
import type { Input } from './input';
import type { EraId, KitId, RoleId } from '../data/types';

export type TouchMode = 'fps' | 'tank' | 'commander';

interface Pointer {
  id: number;
  role: 'stick' | 'look' | 'button';
  startX: number;
  startY: number;
  x: number;
  y: number;
  moved: boolean;
  el?: HTMLElement;
  t0: number;
}

const LOOK_SENSITIVITY = 1.5;
const STICK_RADIUS = 58;

export class TouchControls {
  readonly root: HTMLElement;
  private stickZone: HTMLElement;
  private stickBase: HTMLElement;
  private stickKnob: HTMLElement;
  private lookZone: HTMLElement;
  private fpsBar: HTMLElement;
  private mapBar: HTMLElement;
  private supportRow: HTMLElement;
  private squadRow: HTMLElement;
  private pointers = new Map<number, Pointer>();
  private pinchStart = 0;
  private mode: TouchMode = 'fps';
  private disposed = false;
  private handlers: Array<[EventTarget, string, EventListener]> = [];
  /** Set while the map is in "order squad" mode, so taps become right-clicks. */
  private orderMode = false;
  onPause: (() => void) | null = null;
  onToggleMap: (() => void) | null = null;

  constructor(
    private readonly host: HTMLElement,
    private readonly input: Input,
    opts: { era: EraId; role: RoleId; kit: KitId; hasDrone: boolean },
  ) {
    this.root = document.createElement('div');
    this.root.className = 'touch-ui';

    this.stickZone = el('div', 'tc-stick-zone');
    this.stickBase = el('div', 'tc-stick-base');
    this.stickKnob = el('div', 'tc-stick-knob');
    this.stickBase.appendChild(this.stickKnob);
    this.stickZone.appendChild(this.stickBase);

    this.lookZone = el('div', 'tc-look-zone');

    // --- right-hand action cluster
    this.fpsBar = el('div', 'tc-actions');
    const fire = btn('tc-fire', 'FIRE', { btn: '0' });
    const ads = btn('tc-btn tc-ads', 'AIM', { btn: '2' });
    const reload = btn('tc-btn', 'R', { key: 'KeyR', tap: '1' });
    const jump = btn('tc-btn', '▲', { key: 'Space', tap: '1' });
    const crouch = btn('tc-btn tc-toggle', 'CR', { key: 'ControlLeft', toggle: '1' });
    const sprint = btn('tc-btn tc-toggle', 'RUN', { key: 'ShiftLeft', toggle: '1' });
    this.fpsBar.append(fire, ads, reload, jump, crouch, sprint);

    // consumables join the right-hand cluster: the left half is reserved for movement
    this.fpsBar.append(btn('tc-btn', '✚', { key: 'KeyH', tap: '1' }), btn('tc-btn', '●', { key: 'KeyF', tap: '1' }));
    if (opts.era === 'ww1') this.fpsBar.append(btn('tc-btn', 'GAS', { key: 'KeyG', tap: '1' }));
    if (opts.era === 'modern') this.fpsBar.append(btn('tc-btn', 'NV', { key: 'KeyN', tap: '1' }));

    // --- support call-ins
    this.supportRow = el('div', 'tc-support');
    this.supportRow.append(btn('tc-btn wide', 'ARTY', { key: 'Digit5', tap: '1' }), btn('tc-btn wide', 'AIR', { key: 'Digit6', tap: '1' }));
    if (opts.hasDrone) this.supportRow.append(btn('tc-btn wide', 'DRONE', { key: 'Digit7', tap: '1' }));

    // --- squad orders
    this.squadRow = el('div', 'tc-squad');
    if (opts.role === 'squadleader') {
      this.squadRow.append(btn('tc-btn wide', 'HOLD', { key: 'KeyQ', tap: '1' }), btn('tc-btn wide', 'ATTACK', { key: 'KeyE', tap: '1' }));
    }

    // --- top-right system buttons
    const sys = el('div', 'tc-sys');
    const mapBtn = btn('tc-btn', 'MAP', {});
    mapBtn.addEventListener('click', () => this.onToggleMap?.());
    const pauseBtn = btn('tc-btn', '❚❚', {});
    pauseBtn.addEventListener('click', () => this.onPause?.());
    sys.append(mapBtn, pauseBtn);

    // --- commander map toolbar
    this.mapBar = el('div', 'tc-mapbar');
    const tool = (label: string, fn: () => void, cls = '') => {
      const b = btn('tc-btn wide ' + cls, label, {});
      b.addEventListener('click', () => {
        fn();
        this.mapBar.querySelectorAll('.on').forEach((x) => x.classList.remove('on'));
        if (label !== 'SELECT') b.classList.add('on');
      });
      return b;
    };
    this.mapBar.append(
      tool('SELECT', () => (this.orderMode = false)),
      tool('ORDER', () => (this.orderMode = true)),
      tool('ARTY', () => {
        this.orderMode = false;
        this.input.tapVirtualKey('KeyZ');
      }),
      tool('AIR', () => {
        this.orderMode = false;
        this.input.tapVirtualKey('KeyX');
      }),
    );

    this.root.append(this.lookZone, this.stickZone, this.fpsBar, this.supportRow, this.squadRow, sys, this.mapBar);
    host.appendChild(this.root);
    this.bind();
    this.setMode('fps');
  }

  private bind() {
    const on = (t: EventTarget, type: string, fn: (e: any) => void, opts?: AddEventListenerOptions) => {
      t.addEventListener(type, fn, opts);
      this.handlers.push([t, type, fn as EventListener]);
    };
    const zoneOf = (target: HTMLElement): 'stick' | 'look' | 'button' | null => {
      if (target.closest('[data-key],[data-btn],.tc-btn,.tc-fire')) return 'button';
      if (target.closest('.tc-stick-zone')) return 'stick';
      if (target.closest('.tc-look-zone')) return 'look';
      return null;
    };
    on(
      this.root,
      'pointerdown',
      (e: PointerEvent) => {
        const target = e.target as HTMLElement;
        const role = zoneOf(target);
        if (!role) return;
        e.preventDefault();
        try {
          (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
        } catch {
          /* synthetic or already-released pointer */
        }
        const p: Pointer = { id: e.pointerId, role, startX: e.clientX, startY: e.clientY, x: e.clientX, y: e.clientY, moved: false, t0: performance.now() };
        this.pointers.set(e.pointerId, p);
        if (role === 'stick') {
          this.stickBase.style.left = `${e.clientX}px`;
          this.stickBase.style.top = `${e.clientY}px`;
          this.stickBase.classList.add('active');
          this.updateStick(p);
        } else if (role === 'look') {
          this.input.touchLook = true;
        } else {
          p.el = target.closest('.tc-btn, .tc-fire') as HTMLElement;
          this.pressButton(p.el, true);
        }
        if (this.pointers.size === 2) {
          const [a, b] = [...this.pointers.values()];
          this.pinchStart = Math.hypot(a.x - b.x, a.y - b.y);
        }
      },
      { passive: false },
    );
    on(
      this.root,
      'pointermove',
      (e: PointerEvent) => {
        const p = this.pointers.get(e.pointerId);
        if (!p) return;
        e.preventDefault();
        const dx = e.clientX - p.x;
        const dy = e.clientY - p.y;
        p.x = e.clientX;
        p.y = e.clientY;
        if (Math.hypot(e.clientX - p.startX, e.clientY - p.startY) > 10) p.moved = true;
        if (p.role === 'stick') this.updateStick(p);
        else if (p.role === 'look') {
          if (this.mode === 'commander') {
            this.input.dragX += dx;
            this.input.dragY += dy;
          } else this.input.addLook(dx * LOOK_SENSITIVITY, dy * LOOK_SENSITIVITY);
        }
        // pinch to zoom the command map
        if (this.mode === 'commander' && this.pointers.size === 2) {
          const [a, b] = [...this.pointers.values()];
          const d = Math.hypot(a.x - b.x, a.y - b.y);
          if (this.pinchStart > 0) this.input.pinchDelta += (d - this.pinchStart) / Math.max(80, this.pinchStart);
          this.pinchStart = d;
        }
      },
      { passive: false },
    );
    const end = (e: PointerEvent) => {
      const p = this.pointers.get(e.pointerId);
      if (!p) return;
      this.pointers.delete(e.pointerId);
      if (p.role === 'stick') {
        this.input.stick.x = 0;
        this.input.stick.y = 0;
        this.stickBase.classList.remove('active');
        this.stickKnob.style.transform = 'translate(-50%, -50%)';
      } else if (p.role === 'look') {
        if (this.pointers.size === 0) this.input.endTouchLook();
        // a quick tap on the map area is a click at that spot
        if (this.mode === 'commander' && !p.moved && performance.now() - p.t0 < 400) {
          this.input.tap = { x: (p.x / window.innerWidth) * 2 - 1, y: -(p.y / window.innerHeight) * 2 + 1, button: this.orderMode ? 2 : 0 };
        }
      } else if (p.el) this.pressButton(p.el, false);
      if (this.pointers.size < 2) this.pinchStart = 0;
    };
    on(this.root, 'pointerup', end);
    on(this.root, 'pointercancel', end);
    on(window, 'blur', () => {
      this.pointers.clear();
      this.input.clearVirtual();
      this.input.touchLook = false;
    });
  }

  private pressButton(el: HTMLElement | undefined, down: boolean) {
    if (!el) return;
    el.classList.toggle('pressed', down);
    const key = el.dataset.key;
    const button = el.dataset.btn;
    if (el.dataset.toggle && down) {
      // crouch and sprint latch, so a thumb is not tied up holding them
      const active = el.classList.toggle('on');
      if (key) this.input.setVirtualKey(key, active);
      return;
    }
    if (el.dataset.tap) {
      if (down && key) this.input.tapVirtualKey(key);
      return;
    }
    if (key) this.input.setVirtualKey(key, down);
    if (button !== undefined) this.input.setVirtualButton(Number(button), down);
  }

  setMode(mode: TouchMode) {
    this.mode = mode;
    this.root.classList.toggle('mode-commander', mode === 'commander');
    this.root.classList.toggle('mode-tank', mode === 'tank');
    if (mode === 'commander') {
      this.input.stick.x = 0;
      this.input.stick.y = 0;
      this.input.clearVirtual();
      this.root.querySelectorAll('.tc-btn.on').forEach((x) => x.classList.remove('on'));
    }
  }

  private updateStick(p: Pointer) {
    const dx = p.x - parseFloat(this.stickBase.style.left);
    const dy = p.y - parseFloat(this.stickBase.style.top);
    const len = Math.hypot(dx, dy);
    const clamped = Math.min(len, STICK_RADIUS);
    const nx = len > 0 ? (dx / len) * clamped : 0;
    const ny = len > 0 ? (dy / len) * clamped : 0;
    this.stickKnob.style.transform = `translate(calc(-50% + ${nx}px), calc(-50% + ${ny}px))`;
    // small deadzone keeps a resting thumb from creeping forward
    const dead = 0.14;
    const mag = Math.max(0, (clamped / STICK_RADIUS - dead) / (1 - dead));
    this.input.stick.x = len > 0 ? (dx / len) * mag : 0;
    this.input.stick.y = len > 0 ? (-dy / len) * mag : 0;
  }

  /** Mirror the support counts onto the buttons, which replace the HUD readout on touch. */
  setSupport(slots: { key: string; name: string; count: number; ready: boolean }[]) {
    for (const slot of slots) {
      const code = 'Digit' + slot.key;
      const el = this.supportRow.querySelector(`[data-key="${code}"]`) as HTMLElement | null;
      if (!el) continue;
      const label = slot.name.split(' ')[0].toUpperCase().slice(0, 5);
      const text = `${label} ${slot.count > 0 ? slot.count : '—'}`;
      if (el.textContent !== text) el.textContent = text;
      el.classList.toggle('dim', slot.count <= 0 || !slot.ready);
    }
  }

  /** Hide the shooting controls while the after-action report or pause menu is up. */
  setVisible(v: boolean) {
    this.root.style.display = v ? '' : 'none';
    if (!v) {
      this.input.clearVirtual();
      this.input.touchLook = false;
      this.pointers.clear();
    }
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    for (const [t, type, fn] of this.handlers) t.removeEventListener(type, fn);
    this.root.remove();
    this.input.clearVirtual();
  }
}

function el(tag: string, cls: string): HTMLElement {
  const e = document.createElement(tag);
  e.className = cls;
  return e;
}

function btn(cls: string, label: string, data: { key?: string; btn?: string; tap?: string; toggle?: string }): HTMLElement {
  const e = document.createElement('div');
  e.className = cls;
  e.textContent = label;
  if (data.key) e.dataset.key = data.key;
  if (data.btn) e.dataset.btn = data.btn;
  if (data.tap) e.dataset.tap = data.tap;
  if (data.toggle) e.dataset.toggle = data.toggle;
  return e;
}
