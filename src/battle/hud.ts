import type { BattleSetup, BattleResult } from './types';
import type { CapturePoint } from './terrain';
import { HALF } from './terrain';
import { pad2 } from '../core/math';
import { getDifficulty } from './difficulty';

export interface SupportSlot {
  key: string;
  name: string;
  count: number;
  ready: boolean;
  cooldown?: number;
}

export interface MinimapUnit {
  x: number;
  z: number;
  team: 'player' | 'enemy';
  isPlayer?: boolean;
  isSquad?: boolean;
  isVehicle?: boolean;
  yaw?: number;
}

const el = (tag: string, cls?: string, html?: string) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html !== undefined) e.innerHTML = html;
  return e;
};

export class HUD {
  root: HTMLElement;
  private health: HTMLElement;
  private healthBar: HTMLElement;
  private ammo: HTMLElement;
  private weaponName: HTMLElement;
  private ammoState: HTMLElement;
  private objectives: HTMLElement;
  private tickets: HTMLElement;
  private timer: HTMLElement;
  private compass: HTMLElement;
  private killfeed: HTMLElement;
  private hitmarker: HTMLElement;
  private message: HTMLElement;
  private subMessage: HTMLElement;
  private support: HTMLElement;
  private squad: HTMLElement;
  private crosshair: HTMLElement;
  private vignette: HTMLElement;
  private damage: HTMLElement;
  private nvg: HTMLElement;
  private gas: HTMLElement;
  private scope: HTMLElement;
  private minimap: HTMLCanvasElement;
  private minimapBg: HTMLCanvasElement;
  private pause: HTMLElement;
  private dead: HTMLElement;
  private modeTag: HTMLElement;
  private hint: HTMLElement;
  private medkits: HTMLElement;
  private grenades: HTMLElement;
  private cmdHelp: HTMLElement;
  private reveal: HTMLElement;
  private hitDir: HTMLElement;
  private msgTimer = 0;
  private lastHealth = 100;
  onResume: (() => void) | null = null;
  onWithdraw: (() => void) | null = null;

  constructor(container: HTMLElement, readonly setup: BattleSetup) {
    this.root = el('div', 'hud');
    container.appendChild(this.root);
    this.vignette = el('div', 'hud-vignette');
    this.damage = el('div', 'hud-damage');
    this.nvg = el('div', 'hud-nvg');
    this.gas = el('div', 'hud-gas');
    this.scope = el('div', 'hud-scope');
    this.root.append(this.vignette, this.damage, this.nvg, this.gas, this.scope);

    this.hitDir = el('div', 'hud-hitdir');
    this.root.append(this.hitDir);
    this.crosshair = el('div', 'hud-crosshair', '<i></i><i></i><i></i><i></i>');
    this.hitmarker = el('div', 'hud-hitmarker', '<i></i><i></i><i></i><i></i>');
    this.root.append(this.crosshair, this.hitmarker);

    const top = el('div', 'hud-top');
    this.tickets = el('div', 'hud-tickets');
    this.timer = el('div', 'hud-timer');
    this.objectives = el('div', 'hud-objectives');
    top.append(this.tickets, this.timer, this.objectives);
    this.root.append(top);

    this.compass = el('div', 'hud-compass');
    this.root.append(this.compass);
    const strip = el('div', 'hud-compass-strip');
    const marks = ['N', '·', 'NE', '·', 'E', '·', 'SE', '·', 'S', '·', 'SW', '·', 'W', '·', 'NW', '·'];
    let html = '';
    for (let r = 0; r < 3; r++) for (const m of marks) html += `<span class="${m === '·' ? 'dot' : ''}">${m}</span>`;
    strip.innerHTML = html;
    this.compass.append(strip, el('div', 'hud-compass-needle'));

    const bl = el('div', 'hud-bl');
    this.health = el('div', 'hud-health');
    this.healthBar = el('div', 'hud-health-bar');
    this.health.append(el('div', 'hud-health-label', 'HEALTH'), this.healthBar);
    this.medkits = el('div', 'hud-consumable');
    this.grenades = el('div', 'hud-consumable');
    const cons = el('div', 'hud-consumables');
    cons.append(this.medkits, this.grenades);
    this.squad = el('div', 'hud-squad');
    bl.append(this.squad, this.health, cons);
    this.root.append(bl);

    const br = el('div', 'hud-br');
    this.weaponName = el('div', 'hud-weapon');
    this.ammo = el('div', 'hud-ammo');
    this.ammoState = el('div', 'hud-ammo-state');
    br.append(this.weaponName, this.ammo, this.ammoState);
    this.root.append(br);

    this.support = el('div', 'hud-support');
    this.root.append(this.support);

    this.killfeed = el('div', 'hud-killfeed');
    this.root.append(this.killfeed);

    this.message = el('div', 'hud-message');
    this.subMessage = el('div', 'hud-submessage');
    this.root.append(this.message, this.subMessage);

    this.minimap = document.createElement('canvas');
    this.minimap.width = this.minimap.height = 200;
    this.minimap.className = 'hud-minimap';
    this.minimapBg = document.createElement('canvas');
    this.minimapBg.width = this.minimapBg.height = 200;
    this.root.append(this.minimap);

    this.modeTag = el('div', 'hud-mode');
    this.hint = el('div', 'hud-hint');
    this.cmdHelp = el('div', 'hud-cmdhelp');
    this.cmdHelp.innerHTML = '<b>COMMAND MAP</b> — Left-click a friendly squad to select it, right-click to order it. <kbd>Z</kbd> then click: artillery. <kbd>X</kbd> then click: air support. <kbd>Tab</kbd> return to the field.';
    this.reveal = el('div', 'hud-reveal', 'RECON ACTIVE');
    this.root.append(this.modeTag, this.hint, this.cmdHelp, this.reveal);

    this.dead = el('div', 'hud-dead');
    this.root.append(this.dead);

    this.pause = el('div', 'hud-pause');
    this.pause.innerHTML = `<div class="pause-box"><h2>Battle Paused</h2><p class="muted">${setup.provinceName} · ${setup.era.name} · Difficulty: ${getDifficulty(setup.difficulty).name}</p>
      <div class="pause-controls">
        <div><kbd>W A S D</kbd> Move · <kbd>Shift</kbd> Sprint · <kbd>Ctrl</kbd> Crouch · <kbd>Space</kbd> Jump</div>
        <div><kbd>LMB</kbd> Fire · <kbd>RMB</kbd> Aim · <kbd>R</kbd> Reload/Unjam · <kbd>1</kbd><kbd>2</kbd> Weapons · <kbd>F</kbd> Grenade · <kbd>H</kbd> Medkit</div>
        <div><kbd>Q</kbd> Squad follow/hold · <kbd>E</kbd> Squad attack-move · <kbd>5</kbd> Artillery · <kbd>6</kbd> Air support · <kbd>7</kbd> Recon drone</div>
        <div><kbd>G</kbd> Gas mask · <kbd>N</kbd> Night vision · <kbd>Tab</kbd> Command map · <kbd>M</kbd> Minimap</div>
      </div>
      <button class="btn primary" data-act="resume">Resume</button>
      <button class="btn danger" data-act="withdraw">Withdraw (lose battle)</button></div>`;
    this.pause.querySelector('[data-act=resume]')!.addEventListener('click', () => this.onResume?.());
    this.pause.querySelector('[data-act=withdraw]')!.addEventListener('click', () => this.onWithdraw?.());
    this.root.append(this.pause);
  }

  setHealth(hp: number, max: number) {
    const f = Math.max(0, hp / max);
    this.healthBar.style.setProperty('--f', f.toFixed(3));
    this.healthBar.classList.toggle('low', f < 0.35);
    this.vignette.style.opacity = String((1 - f) * 0.9);
    if (hp < this.lastHealth - 0.5) this.flashDamage();
    this.lastHealth = hp;
  }
  /** Wedge pointing at whoever just shot you. `null` for artillery and gas. */
  showHitDirection(bearing: number | null) {
    if (bearing === null) return;
    const wedge = el('i');
    // CSS rotates clockwise from straight up, the bearing is counter-clockwise from forward.
    wedge.style.transform = `rotate(${(-bearing * 180) / Math.PI}deg)`;
    this.hitDir.appendChild(wedge);
    requestAnimationFrame(() => wedge.classList.add('fade'));
    setTimeout(() => wedge.remove(), 1400);
    while (this.hitDir.children.length > 6) this.hitDir.firstElementChild!.remove();
  }

  flashDamage() {
    this.damage.classList.remove('flash');
    void this.damage.offsetWidth;
    this.damage.classList.add('flash');
  }
  setConsumables(medkits: number, grenades: number) {
    this.medkits.innerHTML = `<span class="ico">✚</span> ${medkits} <small>H</small>`;
    this.grenades.innerHTML = `<span class="ico">●</span> ${grenades} <small>F</small>`;
  }
  setAmmo(mag: number, reserve: number, name: string, state: 'ok' | 'reloading' | 'jammed' | 'empty' | 'bolt') {
    this.weaponName.textContent = name;
    this.ammo.innerHTML = `<b>${mag}</b><span>/ ${reserve}</span>`;
    this.ammoState.textContent = state === 'reloading' ? 'RELOADING' : state === 'jammed' ? 'JAMMED — PRESS R' : state === 'empty' ? 'EMPTY — PRESS R' : state === 'bolt' ? '' : '';
    this.ammoState.className = 'hud-ammo-state ' + state;
    this.ammo.classList.toggle('low', mag <= 3);
  }
  setTankStats(hp: number, max: number, shells: number, reloading: boolean) {
    this.weaponName.textContent = 'MAIN GUN';
    this.ammo.innerHTML = `<b>${shells}</b><span>shells</span>`;
    this.ammoState.textContent = reloading ? 'LOADING' : 'RMB: COAX MG';
    this.ammoState.className = 'hud-ammo-state ' + (reloading ? 'reloading' : 'ok');
    this.setHealth(hp, max);
  }
  setObjectives(points: CapturePoint[]) {
    let html = '';
    for (const p of points) {
      const cls = p.owner === 'player' ? 'own' : p.owner === 'enemy' ? 'enemy' : 'neutral';
      const contested = Math.abs(p.progress) < 1 && Math.abs(p.progress) > 0.02 ? ' contested' : '';
      const pct = ((p.progress + 1) / 2) * 100;
      html += `<div class="obj ${cls}${contested}"><span>${p.id}</span><i style="--p:${pct.toFixed(0)}%"></i></div>`;
    }
    this.objectives.innerHTML = html;
  }
  setTickets(p: number, e: number, pName: string, eName: string) {
    this.tickets.innerHTML = `<div class="own"><small>${pName}</small><b>${Math.max(0, Math.round(p))}</b></div><div class="enemy"><b>${Math.max(0, Math.round(e))}</b><small>${eName}</small></div>`;
  }
  setTimer(sec: number) {
    const s = Math.max(0, Math.floor(sec));
    this.timer.textContent = `${pad2(Math.floor(s / 60))}:${pad2(s % 60)}`;
  }
  setCompass(yawRad: number) {
    // yaw 0 = facing -Z (north). strip: 16 marks per 360deg, 3 repeats, each mark 40px
    const deg = ((-yawRad * 180) / Math.PI + 720) % 360;
    const px = (deg / 360) * 640;
    const strip = this.compass.firstElementChild as HTMLElement;
    strip.style.transform = `translateX(${(-px - 640 + 160).toFixed(1)}px)`;
  }
  showHitmarker(kill: boolean) {
    this.hitmarker.classList.remove('show', 'kill');
    void this.hitmarker.offsetWidth;
    this.hitmarker.classList.add('show');
    if (kill) this.hitmarker.classList.add('kill');
  }
  addKill(text: string, cls = '') {
    const row = el('div', 'kf ' + cls, text);
    this.killfeed.prepend(row);
    while (this.killfeed.children.length > 6) this.killfeed.lastElementChild!.remove();
    setTimeout(() => row.classList.add('fade'), 5000);
    setTimeout(() => row.remove(), 6000);
  }
  showMessage(text: string, sub = '', duration = 3) {
    this.message.textContent = text;
    this.subMessage.textContent = sub;
    this.message.classList.add('show');
    this.subMessage.classList.toggle('show', !!sub);
    this.msgTimer = duration;
  }
  setSupport(slots: SupportSlot[]) {
    this.support.innerHTML = slots
      .map((s) => `<div class="sup ${s.ready && s.count > 0 ? 'ready' : 'off'}"><kbd>${s.key}</kbd><span>${s.name}</span><b>${s.count > 0 ? '×' + s.count : '—'}</b>${s.cooldown && s.cooldown > 0 ? `<i>${Math.ceil(s.cooldown)}s</i>` : ''}</div>`)
      .join('');
  }
  setSquad(text: string, alive: number, total: number) {
    this.squad.innerHTML = text ? `<div class="sq-title">${total > 0 ? `SQUAD <span>${alive}/${total}</span>` : `FORCES <span>${alive} soldiers</span>`}</div><div class="sq-order">${text}</div>` : '';
  }
  setMode(mode: 'fps' | 'commander' | 'tank') {
    this.modeTag.textContent = mode === 'commander' ? 'COMMAND MAP' : mode === 'tank' ? 'ARMOUR' : '';
    this.root.classList.toggle('commander', mode === 'commander');
    this.cmdHelp.style.display = mode === 'commander' ? 'block' : 'none';
  }
  setHint(text: string) {
    this.hint.textContent = text;
    this.hint.classList.toggle('show', !!text);
  }
  setNVG(on: boolean) {
    this.nvg.classList.toggle('on', on);
  }
  setGas(on: boolean) {
    this.gas.classList.toggle('on', on);
  }
  setScope(on: boolean) {
    this.scope.classList.toggle('on', on);
    this.crosshair.style.opacity = on ? '0' : '';
  }
  setReveal(on: boolean) {
    this.reveal.classList.toggle('on', on);
  }
  setCrosshairSpread(px: number) {
    this.crosshair.style.setProperty('--s', px.toFixed(0) + 'px');
  }
  showDead(seconds: number, text: string) {
    this.dead.innerHTML = seconds > 0 ? `<h3>${text}</h3><p>Redeploying in <b>${Math.ceil(seconds)}</b></p>` : '';
    this.dead.classList.toggle('on', seconds > 0);
  }
  showPause(on: boolean) {
    this.pause.classList.toggle('on', on);
  }
  setMinimapVisible(on: boolean) {
    this.minimap.style.display = on ? '' : 'none';
  }

  /** Pre-render terrain shading into the minimap background. */
  buildMinimap(heightAt: (x: number, z: number) => number, colliders: { min: { x: number; z: number }; max: { x: number; z: number } }[], theme: string) {
    const ctx = this.minimapBg.getContext('2d')!;
    const S = 200;
    const img = ctx.createImageData(S, S);
    const base = theme === 'trench' ? [70, 58, 40] : theme === 'ruins' ? [70, 90, 50] : [50, 52, 56];
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        const wx = (x / S) * 2 * HALF - HALF;
        const wz = (y / S) * 2 * HALF - HALF;
        const h = heightAt(wx, wz);
        const hx = heightAt(wx + 2, wz) - h;
        const shade = 1 + hx * 0.25 + h * 0.02;
        const i = (y * S + x) * 4;
        img.data[i] = Math.min(255, base[0] * shade);
        img.data[i + 1] = Math.min(255, base[1] * shade);
        img.data[i + 2] = Math.min(255, base[2] * shade);
        img.data[i + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    ctx.fillStyle = 'rgba(210,210,215,0.7)';
    for (const c of colliders) {
      const x0 = ((c.min.x + HALF) / (2 * HALF)) * S;
      const z0 = ((c.min.z + HALF) / (2 * HALF)) * S;
      const w = ((c.max.x - c.min.x) / (2 * HALF)) * S;
      const d = ((c.max.z - c.min.z) / (2 * HALF)) * S;
      if (w > 1.5 && d > 1.5) ctx.fillRect(x0, z0, w, d);
    }
  }

  drawMinimap(units: MinimapUnit[], points: CapturePoint[], markers: { x: number; z: number; kind: string }[]) {
    const ctx = this.minimap.getContext('2d')!;
    const S = 200;
    ctx.clearRect(0, 0, S, S);
    ctx.drawImage(this.minimapBg, 0, 0);
    const toX = (x: number) => ((x + HALF) / (2 * HALF)) * S;
    const toY = (z: number) => ((z + HALF) / (2 * HALF)) * S;
    for (const p of points) {
      ctx.beginPath();
      ctx.arc(toX(p.pos.x), toY(p.pos.z), 7, 0, Math.PI * 2);
      ctx.fillStyle = p.owner === 'player' ? 'rgba(80,160,255,0.55)' : p.owner === 'enemy' ? 'rgba(255,80,60,0.55)' : 'rgba(220,220,220,0.4)';
      ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 9px Oswald, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(p.id, toX(p.pos.x), toY(p.pos.z) + 3);
    }
    for (const m of markers) {
      ctx.strokeStyle = m.kind === 'artillery' ? '#ffb040' : m.kind === 'air' ? '#ff5050' : '#ffe';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(toX(m.x), toY(m.z), 4, 0, Math.PI * 2);
      ctx.stroke();
    }
    for (const u of units) {
      const x = toX(u.x);
      const y = toY(u.z);
      if (u.isPlayer) continue;
      ctx.fillStyle = u.team === 'player' ? (u.isSquad ? '#9ad2ff' : '#4a90e2') : '#ff4a3a';
      if (u.isVehicle) {
        ctx.fillRect(x - 3, y - 3, 6, 6);
      } else {
        ctx.beginPath();
        ctx.arc(x, y, 2.2, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    const me = units.find((u) => u.isPlayer);
    if (me) {
      const x = toX(me.x);
      const y = toY(me.z);
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(-(me.yaw ?? 0));
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.moveTo(0, -6);
      ctx.lineTo(4, 5);
      ctx.lineTo(0, 3);
      ctx.lineTo(-4, 5);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
  }

  update(dt: number) {
    if (this.msgTimer > 0) {
      this.msgTimer -= dt;
      if (this.msgTimer <= 0) {
        this.message.classList.remove('show');
        this.subMessage.classList.remove('show');
      }
    }
  }

  showReport(r: BattleResult, container: HTMLElement, onContinue: () => void) {
    const box = el('div', 'report-overlay');
    const s = this.setup;
    const mins = Math.floor(r.duration / 60);
    const secs = Math.floor(r.duration % 60);
    box.innerHTML = `<div class="report ${r.won ? 'win' : 'loss'}">
      <div class="report-head"><small>AFTER-ACTION REPORT · ${s.provinceName}</small><h1>${r.won ? 'VICTORY' : r.withdrew ? 'WITHDRAWAL' : 'DEFEAT'}</h1></div>
      <div class="report-grid">
        <div><small>${s.playerNation.name}</small><b>${Math.max(0, Math.round(r.playerTicketsLeft))}</b><span>of ${r.playerTicketsStart} tickets</span></div>
        <div><small>${s.enemyNation.name}</small><b>${Math.max(0, Math.round(r.enemyTicketsLeft))}</b><span>of ${r.enemyTicketsStart} tickets</span></div>
        <div><small>Your kills</small><b>${r.kills}</b><span>${r.deaths} deaths</span></div>
        <div><small>Duration</small><b>${pad2(mins)}:${pad2(secs)}</b><span>${r.pointsHeld} objectives held</span></div>
      </div>
      <p class="report-text">${r.won ? (s.playerIsAttacker ? `${s.provinceName} has been taken. Your armies move in.` : `${s.provinceName} holds. The enemy assault is broken.`) : s.playerIsAttacker ? 'The assault has failed. Your army falls back with heavy losses.' : `${s.provinceName} has fallen. Your forces retreat.`}</p>
      <button class="btn primary big">Return to the War Room</button></div>`;
    box.querySelector('button')!.addEventListener('click', onContinue);
    container.appendChild(box);
    return box;
  }

  dispose() {
    this.root.remove();
  }
}
