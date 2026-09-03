// Headless smoke test: boots the built game, walks through the menus, enters a battle, and screenshots each stage.
import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';

/** Locate a Chromium binary: CHROME_PATH, a Playwright browser cache, or a system Chrome. */
function chromePath() {
  const candidates = [
    '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
    '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
  ];
  const found = candidates.find((c) => existsSync(c));
  if (!found) throw new Error('No Chromium found. Set CHROME_PATH or run: npx playwright install chromium');
  return found;
}
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
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || chromePath(), args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
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
  // --- real mouse interaction on the globe: drag rotates, wheel zooms, click selects a province
  const camBefore = await page.evaluate(() => window.__gf.globe.camera.position.toArray());
  const cx = 720, cy = 450;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  for (let i = 1; i <= 10; i++) await page.mouse.move(cx + i * 25, cy + i * 6);
  await page.mouse.up();
  await page.waitForTimeout(600);
  const camAfterDrag = await page.evaluate(() => window.__gf.globe.camera.position.toArray());
  const dragMoved = camBefore.some((v, i) => Math.abs(v - camAfterDrag[i]) > 0.01);
  await page.mouse.wheel(0, -600);
  await page.waitForTimeout(600);
  const camAfterZoom = await page.evaluate(() => window.__gf.globe.camera.position.length());
  const zoomed = Math.abs(camAfterZoom - Math.hypot(...camAfterDrag)) > 0.02;
  const underCursor = await page.evaluate(() => document.elementFromPoint(720, 450)?.id);
  await page.mouse.click(720, 450);
  await page.waitForTimeout(400);
  const panelVisible = await page.evaluate(() => {
    const p = document.querySelector('.province-panel');
    return !!p && p.style.display !== 'none' && p.textContent.length > 10;
  });
  console.log('globe interaction', { dragMoved, zoomed, underCursor, panelVisible });
  if (!dragMoved) errors.push('globe drag did not rotate the camera');
  if (!zoomed) errors.push('wheel did not zoom the globe');
  if (underCursor !== 'gl') errors.push('canvas is not the element under the cursor: ' + underCursor);
  if (!panelVisible) errors.push('clicking the globe did not open the province panel');
  await shot('04b-province-panel');
  await page.click('[data-act=closeProvince]');
  // --- UI-driven army order: select the capital (screen centre), pick its army, click a neighbouring province
  await page.evaluate(() => {
    const app = window.__gf;
    app.stratUI.setSpeed(0); // freeze the simulation so panels do not re-render mid-interaction
    const cap = app.sim.world.provinces.find((p) => p.capitalOf === app.sim.playerId);
    app.globe.focusProvince(cap.id, 2.2);
  });
  await page.waitForTimeout(900);
  await page.mouse.click(720, 450);
  await page.waitForTimeout(400);
  const armyRow = await page.$('.province-panel .army-row[data-mine]');
  if (!armyRow) {
    const dbg = await page.evaluate(() => {
      const app = window.__gf;
      const cap = app.sim.world.provinces.find((p) => p.capitalOf === app.sim.playerId);
      const armies = app.sim.armiesOf(app.sim.playerId).map((a) => ({ n: a.name, at: app.sim.world.provinces[a.province].name, moving: a.path.length > 1 }));
      return { capital: cap && cap.name, selected: app.stratUI.selectedProvince !== null ? app.sim.world.provinces[app.stratUI.selectedProvince].name : null, panel: document.querySelector('.province-panel h3')?.textContent, armies };
    });
    errors.push('capital panel shows no army to select: ' + JSON.stringify(dbg));
  }
  else {
    await page.click('.province-panel .army-row[data-mine]');
    await page.waitForTimeout(200);
    const target = await page.evaluate(() => {
      const app = window.__gf;
      const cap = app.sim.world.provinces.find((p) => p.capitalOf === app.sim.playerId);
      const w = app.sim.world;
      const counts = new Map();
      for (let i = 0; i < w.indexMap.length; i += 7) counts.set(w.indexMap[i], (counts.get(w.indexMap[i]) || 0) + 1);
      const cands = cap.neighbors.map((i) => w.provinces[i]).filter((q) => q.isLand && q.owner === app.sim.playerId);
      cands.sort((a, b) => (counts.get(b.id) || 0) - (counts.get(a.id) || 0));
      const nb = cands[0];
      if (!nb) return null;
      const v = nb.pos.clone().multiplyScalar(1.01).project(app.globe.camera);
      return { id: nb.id, name: nb.name, x: (v.x * 0.5 + 0.5) * innerWidth, y: (-v.y * 0.5 + 0.5) * innerHeight };
    });
    if (target) {
      await page.mouse.click(target.x, target.y);
      await page.waitForTimeout(300);
      const moving = await page.evaluate(() => window.__gf.sim.armiesOf(window.__gf.sim.playerId).some((a) => a.path.length > 1));
      const diag = await page.evaluate(() => {
        const app = window.__gf;
        const sel = app.stratUI.selectedProvince;
        return { selected: sel !== null ? app.sim.world.provinces[sel].name : null, moveMode: app.stratUI.moveMode, selectedArmy: app.stratUI.selectedArmy, lastLog: [...document.querySelectorAll('.log .entry')].map((e) => e.textContent).slice(-2) };
      });
      console.log('ui army order', { target, moving, diag });
      if (!moving) errors.push('clicking a destination after selecting an army did not issue a move order: ' + JSON.stringify({ target, diag }));
    }
  }
  await page.evaluate(() => window.__gf.stratUI.selectProvince(null));
  await page.evaluate(() => {
    const app = window.__gf;
    const cap = app.sim.world.provinces.find((p) => p.capitalOf === app.sim.playerId);
    app.globe.focusProvince(cap.id, 1.45);
  });
  await page.waitForTimeout(900);
  await shot('04c-zoomed');
  await page.evaluate(() => {
    const app = window.__gf;
    const cap = app.sim.world.provinces.find((p) => p.capitalOf === app.sim.playerId);
    app.globe.focusProvince(cap.id, 2.6);
  });
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
  const battleHit = await page.evaluate(() => document.elementFromPoint(720, 450)?.id || document.elementFromPoint(720, 450)?.className);
  console.log('battle element under cursor', battleHit);
  if (battleHit !== 'gl') errors.push('battle HUD intercepts mouse input: ' + battleHit);
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
