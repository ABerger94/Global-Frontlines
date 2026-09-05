/** Procedural WebAudio synthesiser — no audio assets required. */
import type { FireSound } from '../data/types';

class AudioEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private sfx: GainNode | null = null;
  private ambience: GainNode | null = null;
  private ambNodes: AudioNode[] = [];
  private noiseBuffer: AudioBuffer | null = null;
  enabled = true;

  private ensure(): AudioContext | null {
    if (!this.enabled) return null;
    if (!this.ctx) {
      try {
        this.ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
      } catch {
        this.enabled = false;
        return null;
      }
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.7;
      const comp = this.ctx.createDynamicsCompressor();
      comp.threshold.value = -18;
      comp.ratio.value = 6;
      this.master.connect(comp).connect(this.ctx.destination);
      this.sfx = this.ctx.createGain();
      this.sfx.connect(this.master);
      this.ambience = this.ctx.createGain();
      this.ambience.gain.value = 0;
      this.ambience.connect(this.master);
      const len = this.ctx.sampleRate * 2;
      this.noiseBuffer = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = this.noiseBuffer.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    }
    if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
    return this.ctx;
  }

  /** Call on a user gesture to unlock audio. */
  unlock() {
    this.ensure();
  }

  setVolume(v: number) {
    if (this.master) this.master.gain.value = v;
  }

  private noise(ctx: AudioContext, duration: number, filterType: BiquadFilterType, freq: number, q = 1): { src: AudioBufferSourceNode; out: AudioNode } {
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer!;
    src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = filterType;
    f.frequency.value = freq;
    f.Q.value = q;
    src.connect(f);
    src.start();
    src.stop(ctx.currentTime + duration + 0.05);
    return { src, out: f };
  }

  private env(ctx: AudioContext, node: AudioNode, peak: number, attack: number, decay: number, dest: AudioNode, delay = 0) {
    const g = ctx.createGain();
    const t = ctx.currentTime + delay;
    // exponential ramps reject zero, and a far-away source can compute exactly that
    const target = Math.max(0.0002, peak);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(target, t + Math.max(0.001, attack));
    g.gain.exponentialRampToValueAtTime(0.0001, t + Math.max(0.001, attack) + Math.max(0.001, decay));
    node.connect(g).connect(dest);
    return g;
  }

  private spatial(ctx: AudioContext, distance: number, pan: number): { node: StereoPannerNode; gain: number } {
    const p = ctx.createStereoPanner();
    p.pan.value = Math.max(-1, Math.min(1, pan));
    p.connect(this.sfx!);
    const gain = 1 / (1 + distance * 0.035);
    return { node: p, gain };
  }

  gunshot(kind: FireSound, distance = 0, pan = 0) {
    const ctx = this.ensure();
    if (!ctx || distance > 400) return;
    const { node, gain } = this.spatial(ctx, distance, pan);
    const far = Math.min(1, distance / 120);
    const cfg = {
      bolt: { crack: 0.9, thump: 0.8, dur: 0.22, freq: 2200 },
      semi: { crack: 0.8, thump: 0.6, dur: 0.16, freq: 2600 },
      auto: { crack: 0.55, thump: 0.45, dur: 0.1, freq: 3000 },
      heavy: { crack: 0.75, thump: 0.8, dur: 0.15, freq: 1800 },
      pistol: { crack: 0.6, thump: 0.35, dur: 0.1, freq: 3200 },
    }[kind];
    const crack = this.noise(ctx, cfg.dur, 'bandpass', cfg.freq * (1 - far * 0.6), 0.7);
    this.env(ctx, crack.out, cfg.crack * gain * (1 - far * 0.5), 0.002, cfg.dur, node);
    const thump = this.noise(ctx, 0.3, 'lowpass', 220 + far * 100, 0.8);
    this.env(ctx, thump.out, cfg.thump * gain, 0.004, 0.25 + far * 0.3, node);
    if (distance > 40) {
      const echo = this.noise(ctx, 0.6, 'lowpass', 500, 0.5);
      this.env(ctx, echo.out, 0.25 * gain, 0.05, 0.6, node, 0.08);
    }
  }

  explosion(distance = 0, pan = 0, size = 1) {
    const ctx = this.ensure();
    if (!ctx || distance > 400) return;
    const { node, gain } = this.spatial(ctx, distance, pan);
    const boom = this.noise(ctx, 1.4 * size, 'lowpass', 160, 0.6);
    this.env(ctx, boom.out, 1.3 * gain * size, 0.01, 1.2 * size, node);
    const crack = this.noise(ctx, 0.35, 'bandpass', 900, 0.4);
    this.env(ctx, crack.out, 0.7 * gain * (1 - Math.min(1, distance / 200)), 0.003, 0.3, node);
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(90, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(28, ctx.currentTime + 0.9 * size);
    osc.start();
    osc.stop(ctx.currentTime + 1.2 * size);
    this.env(ctx, osc, 0.8 * gain * size, 0.01, 0.9 * size, node);
  }

  whoosh(distance = 0, pan = 0) {
    const ctx = this.ensure();
    if (!ctx) return;
    const { node, gain } = this.spatial(ctx, distance, pan);
    const w = this.noise(ctx, 1.2, 'bandpass', 600, 1.2);
    const f = w.out as BiquadFilterNode;
    f.frequency.setValueAtTime(300, ctx.currentTime);
    f.frequency.exponentialRampToValueAtTime(2400, ctx.currentTime + 1.0);
    this.env(ctx, f, 0.5 * gain, 0.3, 0.8, node);
  }

  planeFlyby() {
    const ctx = this.ensure();
    if (!ctx) return;
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(110, ctx.currentTime);
    osc.frequency.linearRampToValueAtTime(180, ctx.currentTime + 1.5);
    osc.frequency.linearRampToValueAtTime(70, ctx.currentTime + 3.5);
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 900;
    osc.connect(f);
    osc.start();
    osc.stop(ctx.currentTime + 4);
    this.env(ctx, f, 0.35, 1.2, 2.5, this.sfx!);
  }

  click(pitch = 1) {
    const ctx = this.ensure();
    if (!ctx) return;
    const osc = ctx.createOscillator();
    osc.type = 'square';
    osc.frequency.value = 1400 * pitch;
    osc.start();
    osc.stop(ctx.currentTime + 0.05);
    this.env(ctx, osc, 0.12, 0.002, 0.04, this.sfx!);
  }

  uiHover() {
    this.click(1.6);
  }

  reload() {
    const ctx = this.ensure();
    if (!ctx) return;
    const a = this.noise(ctx, 0.08, 'highpass', 2500, 1);
    this.env(ctx, a.out, 0.25, 0.003, 0.06, this.sfx!);
    const b = this.noise(ctx, 0.08, 'bandpass', 1200, 2);
    this.env(ctx, b.out, 0.3, 0.003, 0.08, this.sfx!, 0.35);
    const c = this.noise(ctx, 0.08, 'highpass', 3000, 1);
    this.env(ctx, c.out, 0.3, 0.003, 0.05, this.sfx!, 0.75);
  }

  jam() {
    const ctx = this.ensure();
    if (!ctx) return;
    const a = this.noise(ctx, 0.12, 'bandpass', 700, 3);
    this.env(ctx, a.out, 0.4, 0.003, 0.1, this.sfx!);
  }

  hitmarker() {
    const ctx = this.ensure();
    if (!ctx) return;
    const osc = ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.value = 1900;
    osc.start();
    osc.stop(ctx.currentTime + 0.08);
    this.env(ctx, osc, 0.18, 0.002, 0.06, this.sfx!);
  }

  hurt() {
    const ctx = this.ensure();
    if (!ctx) return;
    const a = this.noise(ctx, 0.25, 'lowpass', 400, 0.5);
    this.env(ctx, a.out, 0.6, 0.005, 0.22, this.sfx!);
  }

  heal() {
    const ctx = this.ensure();
    if (!ctx) return;
    for (let i = 0; i < 3; i++) {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = 520 + i * 180;
      osc.start(ctx.currentTime + i * 0.09);
      osc.stop(ctx.currentTime + i * 0.09 + 0.15);
      this.env(ctx, osc, 0.15, 0.01, 0.12, this.sfx!, i * 0.09);
    }
  }

  whistle() {
    const ctx = this.ensure();
    if (!ctx) return;
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(2300, ctx.currentTime);
    osc.frequency.linearRampToValueAtTime(2600, ctx.currentTime + 0.4);
    osc.frequency.linearRampToValueAtTime(2100, ctx.currentTime + 1.4);
    const trem = ctx.createOscillator();
    trem.frequency.value = 22;
    const tg = ctx.createGain();
    tg.gain.value = 0.35;
    trem.connect(tg).connect(osc.frequency);
    trem.start();
    trem.stop(ctx.currentTime + 1.5);
    osc.start();
    osc.stop(ctx.currentTime + 1.5);
    this.env(ctx, osc, 0.25, 0.05, 1.3, this.sfx!);
  }

  capture(good: boolean) {
    const ctx = this.ensure();
    if (!ctx) return;
    const notes = good ? [440, 554, 659] : [440, 415, 349];
    notes.forEach((f, i) => {
      const osc = ctx.createOscillator();
      osc.type = 'triangle';
      osc.frequency.value = f;
      osc.start(ctx.currentTime + i * 0.12);
      osc.stop(ctx.currentTime + i * 0.12 + 0.25);
      this.env(ctx, osc, 0.2, 0.01, 0.22, this.sfx!, i * 0.12);
    });
  }

  droneBuzz(duration: number) {
    const ctx = this.ensure();
    if (!ctx) return;
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.value = 240;
    const osc2 = ctx.createOscillator();
    osc2.type = 'sawtooth';
    osc2.frequency.value = 247;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 1200;
    osc.connect(f);
    osc2.connect(f);
    osc.start();
    osc2.start();
    osc.stop(ctx.currentTime + duration);
    osc2.stop(ctx.currentTime + duration);
    this.env(ctx, f, 0.12, 0.4, duration - 0.4, this.sfx!);
  }

  /** Battlefield ambience: wind + distant rumble. */
  startAmbience(kind: 'wind' | 'city' | 'space') {
    const ctx = this.ensure();
    if (!ctx || !this.ambience) return;
    this.stopAmbience();
    const wind = ctx.createBufferSource();
    wind.buffer = this.noiseBuffer!;
    wind.loop = true;
    const wf = ctx.createBiquadFilter();
    wf.type = 'lowpass';
    wf.frequency.value = kind === 'space' ? 120 : kind === 'city' ? 260 : 420;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.13;
    const lg = ctx.createGain();
    lg.gain.value = kind === 'space' ? 30 : 180;
    lfo.connect(lg).connect(wf.frequency);
    lfo.start();
    const wg = ctx.createGain();
    wg.gain.value = kind === 'space' ? 0.08 : 0.16;
    wind.connect(wf).connect(wg).connect(this.ambience);
    wind.start();
    const rumble = ctx.createOscillator();
    rumble.type = 'sine';
    rumble.frequency.value = kind === 'city' ? 48 : 36;
    const rg = ctx.createGain();
    rg.gain.value = kind === 'space' ? 0.03 : 0.06;
    rumble.connect(rg).connect(this.ambience);
    rumble.start();
    this.ambNodes = [wind, lfo, rumble];
    this.ambience.gain.cancelScheduledValues(ctx.currentTime);
    this.ambience.gain.setValueAtTime(0.0001, ctx.currentTime);
    this.ambience.gain.exponentialRampToValueAtTime(1, ctx.currentTime + 2);
  }

  stopAmbience() {
    if (!this.ctx || !this.ambience) return;
    for (const n of this.ambNodes) {
      try {
        (n as AudioScheduledSourceNode).stop();
      } catch {
        /* ignore */
      }
    }
    this.ambNodes = [];
    this.ambience.gain.setValueAtTime(0.0001, this.ctx.currentTime);
  }
}

export const audio = new AudioEngine();
