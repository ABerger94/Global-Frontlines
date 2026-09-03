/** 3D gradient noise (Perlin-style) with fBm, seeded. */
import { RNG } from './rng';

export class Noise3D {
  private perm: Uint8Array;
  constructor(seed: number) {
    const rng = new RNG(seed);
    const p = new Uint8Array(256);
    for (let i = 0; i < 256; i++) p[i] = i;
    for (let i = 255; i > 0; i--) {
      const j = Math.floor(rng.next() * (i + 1));
      [p[i], p[j]] = [p[j], p[i]];
    }
    this.perm = new Uint8Array(512);
    for (let i = 0; i < 512; i++) this.perm[i] = p[i & 255];
  }
  private static fade(t: number) {
    return t * t * t * (t * (t * 6 - 15) + 10);
  }
  private static lerp(a: number, b: number, t: number) {
    return a + t * (b - a);
  }
  private static grad(hash: number, x: number, y: number, z: number) {
    const h = hash & 15;
    const u = h < 8 ? x : y;
    const v = h < 4 ? y : h === 12 || h === 14 ? x : z;
    return ((h & 1) === 0 ? u : -u) + ((h & 2) === 0 ? v : -v);
  }
  /** Returns noise in [-1, 1]. */
  get(x: number, y: number, z: number): number {
    const p = this.perm;
    const X = Math.floor(x) & 255;
    const Y = Math.floor(y) & 255;
    const Z = Math.floor(z) & 255;
    x -= Math.floor(x);
    y -= Math.floor(y);
    z -= Math.floor(z);
    const u = Noise3D.fade(x);
    const v = Noise3D.fade(y);
    const w = Noise3D.fade(z);
    const A = p[X] + Y;
    const AA = p[A] + Z;
    const AB = p[A + 1] + Z;
    const B = p[X + 1] + Y;
    const BA = p[B] + Z;
    const BB = p[B + 1] + Z;
    const g = Noise3D.grad;
    const l = Noise3D.lerp;
    return l(
      l(
        l(g(p[AA], x, y, z), g(p[BA], x - 1, y, z), u),
        l(g(p[AB], x, y - 1, z), g(p[BB], x - 1, y - 1, z), u),
        v,
      ),
      l(
        l(g(p[AA + 1], x, y, z - 1), g(p[BA + 1], x - 1, y, z - 1), u),
        l(g(p[AB + 1], x, y - 1, z - 1), g(p[BB + 1], x - 1, y - 1, z - 1), u),
        v,
      ),
      w,
    );
  }
  /** Fractal Brownian motion in [-1, 1]. */
  fbm(x: number, y: number, z: number, octaves = 4, lacunarity = 2, gain = 0.5): number {
    let amp = 1;
    let freq = 1;
    let sum = 0;
    let norm = 0;
    for (let i = 0; i < octaves; i++) {
      sum += amp * this.get(x * freq, y * freq, z * freq);
      norm += amp;
      amp *= gain;
      freq *= lacunarity;
    }
    return sum / norm;
  }
  /** 2D convenience (z = fixed). */
  fbm2(x: number, y: number, octaves = 4, lacunarity = 2, gain = 0.5): number {
    return this.fbm(x, y, 0.37, octaves, lacunarity, gain);
  }
}
