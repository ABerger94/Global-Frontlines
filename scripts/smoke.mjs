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
const shot2 = shot;
// Advancing days during UI tests can trigger a battle prompt whose modal blocks clicks.
const clearPrompt = async () => {
  if (await page.$('[data-battle=auto]')) {
    await page.click('[data-battle=auto]');
    await page.waitForTimeout(400);
  }
};
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

  // --- panels must keep their scroll position while the simulation ticks
  await page.click('[data-tab=diplomacy]');
  await page.waitForTimeout(400);
  const scrollTest = await page.evaluate(async () => {
    const app = window.__gf;
    const body = document.querySelector('.side-panel .body');
    const scrollable = body.scrollHeight > body.clientHeight + 10;
    body.scrollTop = 140;
    const set = body.scrollTop;
    // simulate several days: each emits the events that used to rebuild the panel
    for (let i = 0; i < 6; i++) {
      app.sim.tickDay();
      app.sim.events.emit('dirty');
    }
    await new Promise((r) => setTimeout(r, 700));
    const after = document.querySelector('.side-panel .body');
    return { scrollable, set, kept: after.scrollTop, sameNode: after === body };
  });
  console.log('side panel scroll', scrollTest);
  if (!scrollTest.scrollable) errors.push('diplomacy panel did not overflow, scroll test is meaningless');
  if (Math.abs(scrollTest.kept - scrollTest.set) > 4) errors.push(`side panel scroll jumped: set ${scrollTest.set}, kept ${scrollTest.kept}`);
  await clearPrompt();
  await page.click('[data-act=closeTab]');

  // --- a big stack of armies in one province must be scrollable and keep position
  const armyScroll = await page.evaluate(async () => {
    const app = window.__gf;
    const sim = app.sim;
    const cap = sim.world.provinces.find((p) => p.capitalOf === sim.playerId);
    for (let i = 0; i < 10; i++) sim.createArmy(sim.playerId, cap.id, 12000, 0.8);
    app.stratUI.selectProvince(cap.id);
    await new Promise((r) => setTimeout(r, 250));
    const rowCount = () => document.querySelectorAll('.province-panel .army-row').length;
    const body = () => document.querySelector('.province-panel .body');
    const rows = rowCount();
    const scrollable = body().scrollHeight > body().clientHeight + 10;
    body().scrollTop = 90;
    const set = body().scrollTop;
    // 1: the simulation ticking must not move the reader
    for (let i = 0; i < 3; i++) sim.tickDay();
    for (let i = 0; i < 6; i++) sim.events.emit('dirty');
    await new Promise((r) => setTimeout(r, 700));
    const keptOnTick = body().scrollTop;
    // 2: nor must the list itself changing underneath them
    const before = rowCount();
    sim.createArmy(sim.playerId, cap.id, 9000, 0.8);
    sim.events.emit('dirty');
    await new Promise((r) => setTimeout(r, 500));
    return { rows, scrollable, set, keptOnTick, keptOnChange: body().scrollTop, grew: rowCount() > before };
  });
  console.log('army list scroll', armyScroll);
  if (armyScroll.rows < 10) errors.push('army list did not show the whole stack: ' + armyScroll.rows);
  if (!armyScroll.scrollable) errors.push('army list did not become scrollable with 10 armies');
  if (Math.abs(armyScroll.keptOnTick - armyScroll.set) > 4) errors.push(`army list scroll jumped on a sim tick: ${armyScroll.set} -> ${armyScroll.keptOnTick}`);
  if (Math.abs(armyScroll.keptOnChange - armyScroll.set) > 4) errors.push(`army list scroll jumped when an army arrived: ${armyScroll.set} -> ${armyScroll.keptOnChange}`);
  if (!armyScroll.grew) errors.push('army list did not pick up the new army');
  await clearPrompt();
  await shot('04d-army-list');

  // --- the Menu button opens a menu, it does not throw the campaign away
  await clearPrompt();
  await page.click('[data-act=menu]');
  await page.waitForTimeout(400);
  const menu = await page.evaluate(() => ({
    open: !!document.querySelector('.game-menu'),
    stillPlaying: window.__gf.screen === 'strategy' && !!window.__gf.sim,
    paused: window.__gf.stratUI.speed === 0,
    hasQuit: !!document.querySelector('[data-menu=quit]'),
    hasResume: !!document.querySelector('[data-menu=resume]'),
    hasDifficulty: document.querySelectorAll('[data-menu=diff]').length,
    hasVolume: !!document.querySelector('[data-menu=volume]'),
  }));
  console.log('game menu', menu);
  if (!menu.open) errors.push('the Menu button did not open a menu');
  if (!menu.stillPlaying) errors.push('the Menu button abandoned the campaign with no confirmation');
  if (!menu.paused) errors.push('opening the menu did not pause the campaign');
  if (!menu.hasQuit || !menu.hasResume || menu.hasDifficulty !== 4 || !menu.hasVolume) errors.push('the menu is missing options: ' + JSON.stringify(menu));
  await shot('04e-game-menu');

  // quitting takes two deliberate steps
  await page.click('[data-menu=quit]');
  await page.waitForTimeout(300);
  const confirming = await page.evaluate(() => ({
    warned: !!document.querySelector('.quit-warning'),
    stillPlaying: window.__gf.screen === 'strategy' && !!window.__gf.sim,
    canCancel: !!document.querySelector('[data-menu=cancelQuit]'),
  }));
  await shot('04f-quit-confirm');
  console.log('quit confirmation', confirming);
  if (!confirming.warned) errors.push('quitting gave no warning that progress is lost');
  if (!confirming.stillPlaying) errors.push('the first click on Quit already ended the campaign');
  if (!confirming.canCancel) errors.push('there is no way to back out of quitting');
  await page.click('[data-menu=cancelQuit]');
  await page.waitForTimeout(300);

  // resume restores the speed the player had set
  await page.click('[data-menu=resume]');
  await page.waitForTimeout(400);
  const resumed = await page.evaluate(() => ({
    closed: !document.querySelector('.game-menu'),
    speed: window.__gf.stratUI.speed,
    playing: window.__gf.screen === 'strategy',
  }));
  console.log('resume', resumed);
  if (!resumed.closed) errors.push('Resume did not close the menu');
  if (!resumed.playing) errors.push('Resume did not return to the campaign');
  if (resumed.speed === 0) errors.push('Resume left the campaign paused');

  // Esc opens the menu when nothing is open, and closes it again. Clear the
  // board first: Esc closes an open panel before it reaches for the menu.
  await clearPrompt();
  await page.evaluate(() => {
    const ui = window.__gf.stratUI;
    ui.setSpeed(0);
    while (ui.closeTop());
  });
  await page.waitForTimeout(250);
  const clean = await page.evaluate(() => ({
    menu: window.__gf.stratUI.isMenuOpen,
    tab: window.__gf.stratUI.activeTab,
    province: window.__gf.stratUI.selectedProvince,
  }));
  if (clean.menu || clean.tab || clean.province !== null) errors.push('could not reach a clean state before the Esc test: ' + JSON.stringify(clean));
  await page.keyboard.press('Escape');
  await page.waitForTimeout(350);
  const escOpen = await page.evaluate(() => !!document.querySelector('.game-menu'));
  await page.keyboard.press('Escape');
  await page.waitForTimeout(350);
  const escShut = await page.evaluate(() => !document.querySelector('.game-menu'));
  console.log('esc menu', { escOpen, escShut });
  if (!escOpen) errors.push('Escape did not open the game menu with nothing else open');
  if (!escShut) errors.push('Escape did not close the game menu');

  // and Esc must still prefer closing an open panel over opening the menu
  await page.click('[data-tab=armies]');
  await page.waitForTimeout(300);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(350);
  const panelFirst = await page.evaluate(() => ({
    tabClosed: window.__gf.stratUI.activeTab === null,
    menuOpen: !!document.querySelector('.game-menu'),
  }));
  console.log('esc closes panels first', panelFirst);
  if (!panelFirst.tabClosed) errors.push('Escape did not close the open tab');
  if (panelFirst.menuOpen) errors.push('Escape opened the menu instead of just closing the panel');
  await page.evaluate(() => window.__gf.stratUI.closeGameMenu());
  await clearPrompt();

  // --- the close button must be a real target and survive a redraw mid-click
  await clearPrompt();
  await page.click('[data-tab=diplomacy]');
  await page.waitForTimeout(400);
  const closeBox = await page.locator('.side-panel .close').boundingBox();
  console.log('close button', closeBox && { w: Math.round(closeBox.width), h: Math.round(closeBox.height) });
  if (!closeBox || closeBox.width < 26 || closeBox.height < 26) errors.push('the close button is too small to hit: ' + JSON.stringify(closeBox));
  // press, force the panel to redraw while held, then release
  await page.mouse.move(closeBox.x + closeBox.width / 2, closeBox.y + closeBox.height / 2);
  await page.mouse.down();
  // a redraw alone reproduces the race, without the side effects of advancing days
  await page.evaluate(() => {
    for (let i = 0; i < 4; i++) window.__gf.sim.events.emit('dirty');
  });
  await page.waitForTimeout(500);
  const held = await page.evaluate(() => ({
    survived: !!document.querySelector('.side-panel .close'),
    blocked: !!document.querySelector('.modal-bg'),
  }));
  const survived = held.survived;
  if (held.blocked) errors.push('a modal covered the panel during the close test');
  await page.mouse.up();
  await page.waitForTimeout(400);
  const closedUnderRedraw = await page.evaluate(() => window.__gf.stratUI.activeTab === null);
  console.log('close under redraw', { survived, closed: closedUnderRedraw });
  if (!survived) errors.push('the close button was destroyed while the mouse was held on it');
  if (!closedUnderRedraw) errors.push('clicking close failed because the panel redrew mid-click');
  await clearPrompt();

  // --- the war log collapses, remembers it, and never covers the side panel
  await page.click('[data-tab=research]');
  await page.waitForTimeout(300);
  const logTest = await page.evaluate(async () => {
    const overlap = () => {
      const a = document.querySelector('.log').getBoundingClientRect();
      const b = document.querySelector('.side-panel').getBoundingClientRect();
      return !(a.right < b.left || b.right < a.left || a.bottom < b.top || b.bottom < a.top);
    };
    const before = overlap();
    document.querySelector('.log-head').click();
    await new Promise((r) => setTimeout(r, 150));
    const collapsed = document.querySelector('.log').classList.contains('collapsed');
    const stored = localStorage.getItem('gf.logCollapsed');
    document.querySelector('.log-head').click();
    await new Promise((r) => setTimeout(r, 150));
    return { overlapsSidePanel: before, collapsed, stored, reopened: !document.querySelector('.log').classList.contains('collapsed'), entries: document.querySelectorAll('.log .entry').length };
  });
  console.log('war log', logTest);
  const noise = await page.evaluate(async () => {
    const app = window.__gf;
    document.querySelectorAll('.toast').forEach((t) => t.remove());
    // a sentence the simulation never produces, so the count is unambiguous
    const line = 'Quartermaster reports the ledgers are in order.';
    for (let i = 0; i < 5; i++) app.stratUI.log(line, 'war');
    app.stratUI.log('A quiet day on the front.', 'info');
    await new Promise((r) => setTimeout(r, 100));
    const rows = [...document.querySelectorAll('.log .entry')].map((e) => e.textContent);
    const mine = rows.filter((t) => t.includes(line));
    return { repeated: mine.length, hasCount: mine.some((t) => t.includes('\u00d75')), toasts: document.querySelectorAll('.toast').length };
  });
  console.log('log noise', noise);
  if (noise.repeated !== 1 || !noise.hasCount) errors.push('repeated reports were not collapsed: ' + JSON.stringify(noise));
  if (noise.toasts > 0) errors.push('a foreign skirmish raised a banner: ' + noise.toasts);
  if (logTest.overlapsSidePanel) errors.push('war log overlaps the side panel');
  if (!logTest.collapsed || logTest.stored !== '1' || !logTest.reopened) errors.push('war log collapse toggle is broken: ' + JSON.stringify(logTest));
  await page.click('[data-act=closeTab]');
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
  const diffCount = await page.$$eval('[data-diff]', (els) => els.length);
  if (diffCount !== 4) errors.push('deploy panel is missing the difficulty selector: ' + diffCount);
  await page.click('[data-diff=recruit]');
  const chosen = await page.evaluate(() => localStorage.getItem('gf.difficulty'));
  if (chosen !== 'recruit') errors.push('difficulty choice was not remembered: ' + chosen);
  await page.click(`[data-role=${ROLE}]`);
  await page.click(`[data-kit=${KIT}]`);
  await shot('08-deploy');
  await page.click('[data-battle=deploy]');
  await page.waitForSelector('.hud', { timeout: 30000 });
  await page.waitForTimeout(6000);
  const combat = await page.evaluate(() => {
    const b = window.__gf.battle;
    return { difficulty: b.world.difficulty.id, cap: b.world.difficulty.maxAttackers, attackers: b.world.playerAttackers.size, hp: Math.round(b.player.hp) };
  });
  console.log('combat state', combat);
  if (combat.difficulty !== 'recruit') errors.push('battle did not use the chosen difficulty: ' + combat.difficulty);
  if (combat.attackers > combat.cap) errors.push('more enemies engaged the player than the cap allows');
  await shot('09-battle');
  const battleHit = await page.evaluate(() => document.elementFromPoint(720, 450)?.id || document.elementFromPoint(720, 450)?.className);
  console.log('battle element under cursor', battleHit);
  if (battleHit !== 'gl') errors.push('battle HUD intercepts mouse input: ' + battleHit);
  // --- armour: the camera must sit behind and above the hull, looking past it
  if (KIT === 'tank') {
    const tank = await page.evaluate(() => {
      const b = window.__gf.battle;
      const t = b.playerTank ?? b['playerTank'];
      if (!t) return { missing: true };
      const cam = new (window.__gf.debug.THREE ?? Object)();
      const p = b.camera.getWorldPosition(new b.camera.position.constructor());
      const dir = b.camera.getWorldDirection(new b.camera.position.constructor());
      // where the tank lands on screen
      const proj = t.pos.clone().add(new b.camera.position.constructor(0, 1.5, 0)).project(b.camera);
      return {
        mode: b['mode'],
        dist: +p.distanceTo(t.pos).toFixed(2),
        above: +(p.y - t.pos.y).toFixed(2),
        lookingDown: +dir.y.toFixed(3),
        tankOnScreen: Math.abs(proj.x) < 0.4 && Math.abs(proj.y) < 0.9 && proj.z < 1,
        tankScreenY: +proj.y.toFixed(2),
      };
    });
    console.log('tank camera', tank);
    if (tank.missing) errors.push('tank kit did not put the player in a tank');
    else {
      if (tank.dist < 6 || tank.dist > 20) errors.push(`tank camera is not a chase camera: ${tank.dist}m from the hull`);
      if (tank.above < 1 || tank.above > 10) errors.push(`tank camera height is wrong: ${tank.above}m above the hull`);
      if (tank.lookingDown < -0.6) errors.push(`tank camera is a birdseye view: looking down ${tank.lookingDown}`);
      if (!tank.tankOnScreen) errors.push('the tank is not visible from its own camera');
      if (tank.tankScreenY > 0.35) errors.push('the tank sits too high on screen, hiding the view ahead');
    }
    // the gun must shoot where the crosshair points
    const shot = await page.evaluate(async () => {
      const b = window.__gf.battle;
      const t = b.playerTank;
      const before = b.support['shells'].length;
      const V = b.camera.position.constructor;
      const camPos = b.camera.getWorldPosition(new V());
      const camDir = b.camera.getWorldDirection(new V());
      t.reload = 0;
      t.fireCannon(camPos.clone().addScaledVector(camDir, 120));
      const shells = b.support['shells'];
      if (shells.length <= before) return { fired: false };
      const s = shells[shells.length - 1];
      const vel = s.vel.clone().normalize();
      return { fired: true, alignment: +vel.dot(camDir).toFixed(3) };
    });
    console.log('tank gun', shot);
    if (!shot.fired) errors.push('the tank cannon did not fire');
    else if (shot.alignment < 0.985) errors.push(`shells do not follow the crosshair (alignment ${shot.alignment})`);
    await shot2('09b-tank');
  }
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
