/** Device and input capability detection, evaluated once at startup. */
function query(q: string): boolean {
  return typeof matchMedia === 'function' && matchMedia(q).matches;
}

/** `?touch=1` forces the on-screen controls on, `?touch=0` forces them off. */
function override(): boolean | null {
  if (typeof location === 'undefined') return null;
  const v = new URLSearchParams(location.search).get('touch');
  return v === null ? null : v !== '0';
}

export const device = {
  /** The primary pointer is a finger rather than a mouse. */
  get touch(): boolean {
    const forced = override();
    if (forced !== null) return forced;
    return query('(hover: none) and (pointer: coarse)') || (navigator.maxTouchPoints > 0 && query('(pointer: coarse)'));
  },
  /** Any touch capability at all (includes touch laptops). */
  get hasTouch(): boolean {
    return navigator.maxTouchPoints > 0 || 'ontouchstart' in window;
  },
  get portrait(): boolean {
    return window.innerHeight > window.innerWidth;
  },
  /** Small screen: panels become sheets, the top bar compacts. */
  get narrow(): boolean {
    return Math.min(window.innerWidth, window.innerHeight) < 760;
  },
  get pointerLockAvailable(): boolean {
    return 'pointerLockElement' in document && !device.touch;
  },
  /** Conservative rendering budget for phones and tablets. */
  get lowPower(): boolean {
    return device.touch || (navigator.hardwareConcurrency ?? 8) <= 4;
  },
};

/** Adds `touch` / `mouse` and orientation classes to <html> so CSS can branch. */
export function applyDeviceClasses() {
  const root = document.documentElement;
  const set = () => {
    root.classList.toggle('is-touch', device.touch);
    root.classList.toggle('has-touch', device.hasTouch);
    root.classList.toggle('is-narrow', device.narrow);
    root.classList.toggle('is-portrait', device.portrait);
  };
  set();
  window.addEventListener('resize', set);
  window.addEventListener('orientationchange', () => setTimeout(set, 120));
}
