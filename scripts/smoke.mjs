// Headless smoke test: boots the built game, walks through the menus, enters a battle, and screenshots each stage.
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';

const PORT = Number(process.env.PORT || 4173);
const ERA = process.env.ERA || 'ww2';
const NATION = process.env.NATION || 'germany';
const ROLE = process.env.ROLE || 'squadleader';
const KIT = process.env.KIT || 'rifleman';
const ALLTECH = process.env.ALLTECH === '1';
const OUT = process.env.OUT || 'scripts/out';
mkdirSync(OUT, { recursive: true });
const shot = (name) => page.screenshot({ path: `${OUT}/${name}.png` });
const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { stdio: 'pipe', detached: true });
await new Promise((r) => setTimeout(r, 2500));
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => {
  if (m.type() === 'error' && !m.text().includes('net::')) errors.push('console: ' + m.text());
});
try {
  await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'load' });
  await page.waitForTimeout(2500);
  await shot('01-menu');
  await page.click('[data-act=new]');
  await page.waitForTimeout(300);
  await shot('02-era');
  await page.click(`[data-era=${ERA}]`);
  await page.click('[data-act=next]');
  await page.waitForTimeout(300);
  await shot('03-nation');
  await page.click(`[data-nation=${NATION}]`);
  await page.click('[data-act=start]');
  await page.waitForTimeout(3500);
  await shot('04-strategy');
  // open research & production tabs
  await page.click('[data-tab=research]');
  await page.waitForTimeout(400);
  await shot('05-research');
  await page.click('[data-tab=production]');
  await page.waitForTimeout(400);
  await shot('06-production');
  await page.click('[data-act=closeTab]');
  // Force a battle: order the first player army into the nearest enemy province
  const info = await page.evaluate((ALLTECH) => {
    const app = window.__gf;
    const sim = app.sim;
    if (ALLTECH) for (const t of sim.era.techs) sim.player.techs.add(t.id);
    const enemyLand = (q) => q.isLand && q.owner && q.owner !== sim.playerId && !sim.isAllied(sim.playerId, q.owner) && (q.owner === 'minor' || sim.player.wars.has(q.owner));
    const armies = sim.armiesOf(sim.playerId);
    // adjacent targets first, then anything reachable
    for (const a of armies) {
      const here = sim.world.provinces[a.province];
      for (const nb of here.neighbors) {
        const q = sim.world.provinces[nb];
        if (enemyLand(q) && sim.moveArmy(a.id, q.id)) { app.stratUI.setSpeed(3); return { ok: true, army: a.name, target: q.name, adjacent: true }; }
      }
    }
    const targets = sim.world.provinces.filter(enemyLand);
    for (const a of armies) for (const q of targets) if (sim.moveArmy(a.id, q.id)) { app.stratUI.setSpeed(3); return { ok: true, army: a.name, target: q.name, adjacent: false, days: a.path.length }; }
    return { ok: false };
  }, ALLTECH);
  console.log('move order', info);
  await page.waitForSelector('[data-battle=command]', { timeout: 150000 });
  await shot('07-battle-prompt');
  await page.click('[data-battle=command]');
  await page.waitForTimeout(300);
  await page.click(`[data-role=${ROLE}]`);
  await page.click(`[data-kit=${KIT}]`);
  await shot('08-deploy');
  await page.click('[data-battle=deploy]');
  await page.waitForSelector('.hud', { timeout: 30000 });
  await page.waitForTimeout(6000);
  await shot('09-battle');
  await page.keyboard.press('Tab');
  await page.waitForTimeout(1500);
  await shot('10-commander');
  await page.keyboard.press('Tab');
  await page.waitForTimeout(4000);
  await shot('11-battle2');
  // Withdraw through the pause menu
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);
  await page.click('[data-act=withdraw]');
  await page.waitForSelector('.report', { timeout: 10000 });
  await shot('12-report');
  await page.click('.report button');
  await page.waitForTimeout(2000);
  await shot('13-back-to-strategy');
  const state = await page.evaluate(() => {
    const w = window.__gf.sim.world;
    let land = 0;
    for (let i = 0; i < w.indexMap.length; i++) if (w.provinces[w.indexMap[i]].isLand) land++;
    return { screen: window.__gf.screen, day: window.__gf.sim.day, log: document.querySelectorAll('.log .entry').length, landFraction: (land / w.indexMap.length).toFixed(2), provinces: w.provinces.length };
  });
  console.log('final state', state);
} catch (e) {
  errors.push('script: ' + (e && e.message));
  await shot('error').catch(() => {});
}
await Promise.race([browser.close(), new Promise((r) => setTimeout(r, 5000))]);
try {
  process.kill(-server.pid, 'SIGKILL');
} catch {
  server.kill('SIGKILL');
}
if (errors.length) {
  console.error('ERRORS:\n' + errors.join('\n'));
  process.exit(1);
}
console.log('smoke test passed');
process.exit(0);
