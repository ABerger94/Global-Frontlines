/** Minimal typed event emitter. */
export class Emitter<T extends Record<string, unknown[]>> {
  private handlers: { [K in keyof T]?: Array<(...args: T[K]) => void> } = {};
  on<K extends keyof T>(evt: K, fn: (...args: T[K]) => void): () => void {
    (this.handlers[evt] ??= []).push(fn);
    return () => this.off(evt, fn);
  }
  off<K extends keyof T>(evt: K, fn: (...args: T[K]) => void): void {
    const list = this.handlers[evt];
    if (!list) return;
    const i = list.indexOf(fn);
    if (i >= 0) list.splice(i, 1);
  }
  emit<K extends keyof T>(evt: K, ...args: T[K]): void {
    const list = this.handlers[evt];
    if (!list) return;
    for (const fn of [...list]) fn(...args);
  }
  clear(): void {
    this.handlers = {};
  }
}
