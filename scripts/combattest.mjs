// Measures how survivable the FPS layer is: drops into a battle, drives the game
// loop directly, and reports player deaths / damage rate per difficulty.
import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';

function chromePath() {
  const c = ['/opt/pw-browsers/chromium-1194/chrome-linux/chrome', '/usr/bin/chromium', '/usr/bin/google-chrome'];
  const f = c.find((x) => existsSync(x));
  if (!f) throw new Error('no chromium; set CHROME_PATH');
  return f;
}
const PORT = Number(process.env.PORT || 4192);
const ROOT = process.env.ROOT || '.';
const SECONDS = Number(process.env.SECONDS || 45);
const DIFFS = (process.env.DIFFS || 'recruit,regular,veteran,elite').split(',');
const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { stdio: 'pipe', detached: true, cwd: ROOT });
await new Promise((r) => setTimeout(r, 2500));
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || chromePath(), args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 900, height: 600 } });
const errors = [];
page.on('pageerror', (e) => { if (!/Pointer Lock/i.test(e.message)) errors.push('pageerror: ' + e.message); });
await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'load' });
await page.waitForTimeout(1200);

const rows = [];
for (const diff of DIFFS) {
  // fresh campaign each run so the battlefield is identical apart from difficulty

  await page.evaluate(async (d) => {
    const app = window.__gf;
    const { ERAS } = app.debug;
    localStorage.setItem('gf.difficulty', d);
    app.startCampaign(ERAS[1], ERAS[1].nations.find((n) => n.id === 'germany'));
  }, diff);
  await page.waitForTimeout(4000);
  await page.evaluate((d) => {
    const app = window.__gf;
    const sim = app.sim;
    const enemyLand = (q) => q.isLand && q.owner && q.owner !== sim.playerId && !sim.isAllied(sim.playerId, q.owner) && (q.owner === 'minor' || sim.player.wars.has(q.owner));
    const a = sim.armiesOf(sim.playerId)[0];
    const here = sim.world.provinces[a.province];
    const target = here.neighbors.map((i) => sim.world.provinces[i]).find(enemyLand) || sim.world.provinces.find(enemyLand);
    sim.moveArmy(a.id, target.id);
    app.stratUI.setSpeed(3);
  }, diff);
  await page.waitForSelector('[data-battle=command]', { timeout: 120000 });
  await page.click('[data-battle=command]');
  await page.waitForTimeout(200);
  if (await page.$('[data-diff=' + diff + ']')) await page.click('[data-diff=' + diff + ']');
  await page.click('[data-battle=deploy]');
  await page.waitForSelector('.hud', { timeout: 30000 });
  await page.waitForTimeout(1500);

  const r = await page.evaluate(async (SECONDS) => {
    const app = window.__gf;
    const b = app.battle;
    // take over the clock so the measurement is deterministic and fast
    app.screen = 'paused-for-test';
    // stand the player on the middle objective: the worst case, in the open where the fighting is
    const mid = b.field.capturePoints[1].pos;
    const place = () => {
      b.player.pos.set(mid.x, b.field.heightAt(mid.x, mid.z), mid.z);
      b.player.yaw = b.setup.playerIsAttacker ? Math.PI : 0;
    };
    place();
    const dt = 1 / 30;
    const steps = Math.round(SECONDS / dt);
    let dmg = 0;
    let prev = b.player.hp;
    let attackerPeak = 0;
    let attackerSum = 0;
    let firstDeath = null;
    let engagedSum = 0;
    let samples = 0;
    let ranges = [];
    for (let i = 0; i < steps; i++) {
      b.update(dt);
      const p = b.player;
      if (p.alive) {
        if (p.hp < prev) dmg += prev - p.hp;
        prev = p.hp;
      } else {
        prev = p.maxHp;
        if (firstDeath === null) firstDeath = i * dt;
      }
      // keep the test subject on the objective after each respawn
      if (p.alive && p.pos.distanceTo(mid) > 25) place();
      const n = b.world.playerAttackers ? b.world.playerAttackers.size : 0;
      attackerPeak = Math.max(attackerPeak, n);
      attackerSum += n;
      // enemies with the player as their live target, and how far away they are
      let engaged = 0;
      for (const s of b.world.combatants) {
        if (s.team === 'enemy' && s.target && s.target.isPlayer) {
          engaged++;
          ranges.push(Math.round(s.pos.distanceTo(p.pos)));
        }
      }
      engagedSum += engaged;
      samples++;
      if (i % 60 === 0) await new Promise((r) => setTimeout(r, 0));
    }
    ranges.sort((a, b) => a - b);
    return {
      deaths: b.player.deaths,
      firstDeath,
      dmgPerSec: +(dmg / SECONDS).toFixed(1),
      avgAttackers: +(attackerSum / samples).toFixed(2),
      peakAttackers: attackerPeak,
      avgEngaged: +(engagedSum / samples).toFixed(2),
      medianRange: ranges.length ? ranges[Math.floor(ranges.length / 2)] : null,
      maxRange: ranges.length ? ranges[ranges.length - 1] : null,
      kills: b.player.kills,
      enemiesAlive: b.world.combatants.filter((c) => c.team === 'enemy').length,
    };
  }, SECONDS);
  rows.push({ difficulty: diff, ...r });
  console.log(JSON.stringify({ difficulty: diff, ...r }));
  await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'load' });
  await page.waitForTimeout(1200);
}
console.log('\n  difficulty   deaths  firstDeath  dmg/s  avgAtk  peakAtk  medRange  maxRange');
for (const r of rows) {
  console.log(
    `  ${r.difficulty.padEnd(11)} ${String(r.deaths).padStart(5)} ${String(r.firstDeath === null ? '-' : r.firstDeath.toFixed(1) + 's').padStart(11)} ${String(r.dmgPerSec).padStart(6)} ${String(r.avgAttackers).padStart(7)} ${String(r.peakAttackers).padStart(8)} ${String(r.medianRange).padStart(9)} ${String(r.maxRange).padStart(9)}`,
  );
}
await Promise.race([browser.close(), new Promise((r) => setTimeout(r, 5000))]);
try { process.kill(-server.pid, 'SIGKILL'); } catch { server.kill('SIGKILL'); }
if (errors.length) { console.error('ERRORS:\n' + errors.join('\n')); process.exit(1); }
process.exit(0);
