// Mobile pass: phone viewport with touch emulation, drives the on-screen controls.
import { chromium, devices } from 'playwright-core';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';

function chromePath() {
  const c = ['/opt/pw-browsers/chromium-1194/chrome-linux/chrome', '/usr/bin/chromium', '/usr/bin/google-chrome'];
  const f = c.find((x) => existsSync(x));
  if (!f) throw new Error('no chromium; set CHROME_PATH');
  return f;
}
const PORT = Number(process.env.PORT || 4260);
const OUT = process.env.OUT || 'scripts/out/mobile';
const PORTRAIT = process.env.PORTRAIT === '1';
mkdirSync(OUT, { recursive: true });
const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { stdio: 'pipe', detached: true });
await new Promise((r) => setTimeout(r, 2500));
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || chromePath(), args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const phone = devices['Pixel 7'];
const context = await browser.newContext({
  ...phone,
  viewport: PORTRAIT ? { width: 412, height: 915 } : { width: 915, height: 412 },
  isMobile: true,
  hasTouch: true,
  deviceScaleFactor: 1, // software GL in CI; real phones have a GPU
});
const page = await context.newPage();
const errors = [];
page.on('pageerror', (e) => { if (!/Pointer Lock/i.test(e.message)) errors.push('pageerror: ' + e.message); });
page.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('net::')) errors.push('console: ' + m.text()); });
const shot = (n) => page.screenshot({ path: `${OUT}/${n}.png` });
const fail = (m) => errors.push(m);
// Software GL can drop to a couple of frames a second, so wait on simulated time
// rather than the wall clock; a real phone reaches these points far sooner.
async function waitGameTime(seconds, timeoutMs = 40000) {
  const t0 = await page.evaluate(() => window.__gf.battle?.time ?? 0);
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const t = await page.evaluate(() => window.__gf.battle?.time ?? 0);
    if (t - t0 >= seconds) return true;
    await page.waitForTimeout(120);
  }
  return false;
}

// dispatch a real pointer drag through the element under the start point
async function drag(x0, y0, x1, y1, steps = 8) {
  await page.evaluate(
    async ([x0, y0, x1, y1, steps]) => {
      const target = document.elementFromPoint(x0, y0);
      if (!target) throw new Error('nothing at ' + x0 + ',' + y0);
      const opts = (x, y) => ({ pointerId: 1, pointerType: 'touch', isPrimary: true, clientX: x, clientY: y, bubbles: true, cancelable: true });
      target.dispatchEvent(new PointerEvent('pointerdown', opts(x0, y0)));
      for (let i = 1; i <= steps; i++) {
        const x = x0 + ((x1 - x0) * i) / steps;
        const y = y0 + ((y1 - y0) * i) / steps;
        target.dispatchEvent(new PointerEvent('pointermove', opts(x, y)));
        await new Promise((r) => setTimeout(r, 16));
      }
      return true;
    },
    [x0, y0, x1, y1, steps],
  );
}
async function release(x, y) {
  await page.evaluate(
    ([x, y]) => {
      const target = document.elementFromPoint(x, y) || document.body;
      target.dispatchEvent(new PointerEvent('pointerup', { pointerId: 1, pointerType: 'touch', isPrimary: true, clientX: x, clientY: y, bubbles: true, cancelable: true }));
    },
    [x, y],
  );
}

try {
  await page.goto(`http://localhost:${PORT}/?touch=1`, { waitUntil: 'load' });
  await page.waitForTimeout(2500);
  const env = await page.evaluate(() => ({
    isTouch: document.documentElement.classList.contains('is-touch'),
    narrow: document.documentElement.classList.contains('is-narrow'),
    overflowX: document.body.scrollWidth > window.innerWidth + 1,
    w: window.innerWidth,
    h: window.innerHeight,
  }));
  console.log('environment', env);
  if (!env.isTouch) fail('touch mode was not detected');
  if (env.overflowX) fail('menu overflows horizontally');
  await shot('01-menu');

  await page.tap('[data-act=new]');
  await page.waitForTimeout(400);
  await page.tap('[data-era=ww2]');
  await page.tap('[data-act=next]');
  await page.waitForTimeout(400);
  await shot('02-nation');
  const cardFits = await page.evaluate(() => {
    const c = document.querySelector('.card').getBoundingClientRect();
    return c.right <= window.innerWidth + 1 && c.left >= -1;
  });
  if (!cardFits) fail('nation cards do not fit the screen');
  await page.tap('[data-nation=germany]');
  await page.tap('[data-act=start]');
  await page.waitForTimeout(5000);
  await shot('03-globe');
  const bar = await page.evaluate(() => {
    const r = (s) => { const e = document.querySelector(s); const b = e.getBoundingClientRect(); return { w: Math.round(b.width), right: Math.round(b.right), visible: b.width > 0 }; };
    return { res: r('.topbar .res'), date: r('.topbar .date'), tabs: r('.tabs'), vw: window.innerWidth };
  });
  console.log('top bar', bar);
  if (!bar.res.visible || bar.res.w < 60) fail('the resource strip collapsed: ' + JSON.stringify(bar.res));
  if (bar.date.right > bar.vw + 1) fail('the date is pushed off the edge');
  if (bar.tabs.right > bar.vw + 1) fail('the tabs are pushed off the edge');

  // --- globe: tap to select, drag to rotate, pinch handled by OrbitControls
  const cx = Math.round(env.w / 2);
  const cy = Math.round(env.h / 2);
  const before = await page.evaluate(() => window.__gf.globe.camera.position.toArray());
  await page.touchscreen.tap(cx, cy);
  await page.waitForTimeout(600);
  const sel = await page.evaluate(() => {
    const p = document.querySelector('.province-panel');
    const r = p.getBoundingClientRect();
    return { open: p.style.display !== 'none', fits: r.right <= window.innerWidth + 1 && r.bottom <= window.innerHeight + 1, selected: window.__gf.stratUI.selectedProvince !== null };
  });
  console.log('globe tap', sel);
  if (!sel.selected) fail('tapping the globe did not select a province');
  if (!sel.fits) fail('province sheet does not fit the screen');
  await shot('04-province');
  await page.tap('[data-act=closeProvince]');

  // tabs must open as sheets that fit
  await page.tap('[data-tab=diplomacy]');
  await page.waitForTimeout(500);
  const tab = await page.evaluate(() => {
    const r = document.querySelector('.side-panel').getBoundingClientRect();
    const body = document.querySelector('.side-panel .body');
    return { fits: r.right <= window.innerWidth + 1 && r.bottom <= window.innerHeight + 1 && r.left >= -1, scrollable: body.scrollHeight > body.clientHeight };
  });
  console.log('diplomacy sheet', tab);
  if (!tab.fits) fail('diplomacy sheet does not fit the screen');
  await shot('05-diplomacy');
  await page.tap('[data-act=closeTab]');

  // --- into a battle
  await page.evaluate(() => {
    const app = window.__gf;
    const sim = app.sim;
    const enemyLand = (q) => q.isLand && q.owner && q.owner !== sim.playerId && !sim.isAllied(sim.playerId, q.owner) && (q.owner === 'minor' || sim.player.wars.has(q.owner));
    for (const a of sim.armiesOf(sim.playerId)) {
      const here = sim.world.provinces[a.province];
      const t = here.neighbors.map((i) => sim.world.provinces[i]).find(enemyLand);
      if (t && sim.moveArmy(a.id, t.id)) break;
    }
    app.stratUI.setSpeed(3);
  });
  await page.waitForSelector('[data-battle=command]', { timeout: 120000 });
  await shot('06-prompt');
  await page.tap('[data-battle=command]');
  await page.waitForTimeout(300);
  await page.tap('[data-battle=deploy]');
  await page.waitForSelector('.touch-ui', { timeout: 30000 });
  await page.waitForTimeout(4000);
  await shot('07-battle');

  if (PORTRAIT) {
    const hint = await page.evaluate(() => {
      const el = document.querySelector('.orientation-hint');
      return { shown: el.classList.contains('on'), blocks: getComputedStyle(el).pointerEvents !== 'none' };
    });
    console.log('portrait battle', hint);
    if (!hint.shown) fail('portrait battle did not ask the player to rotate');
    if (!hint.blocks) fail('the rotate prompt does not block the controls behind it');
    await shot('08-rotate');
  } else {

  const layout = await page.evaluate(() => {
    const hit = (x, y) => {
      const e = document.elementFromPoint(x, y);
      return e ? e.className.toString() : 'none';
    };
    const r = (sel) => {
      const e = document.querySelector(sel);
      if (!e) return null;
      const b = e.getBoundingClientRect();
      return { onScreen: b.right <= window.innerWidth + 2 && b.bottom <= window.innerHeight + 2 && b.left >= -2 && b.top >= -2, w: Math.round(b.width) };
    };
    return {
      stickZone: hit(80, window.innerHeight - 80),
      lookZone: hit(Math.round(window.innerWidth * 0.75), Math.round(window.innerHeight * 0.35)),
      fire: r('.tc-fire'),
      sys: r('.tc-sys'),
      buttons: document.querySelectorAll('.tc-btn').length,
    };
  });
  console.log('control layout', layout);
  if (!layout.stickZone.includes('tc-stick-zone')) fail('thumbstick area is covered: ' + layout.stickZone);
  if (!layout.lookZone.includes('tc-look-zone')) fail('look area is covered: ' + layout.lookZone);
  if (!layout.fire?.onScreen) fail('fire button is off screen');
  if (!layout.sys?.onScreen) fail('map/pause buttons are off screen');

  // --- thumbstick moves the player
  // make sure the subject is alive and standing before measuring movement and look
  await page.evaluate(() => {
    const b = window.__gf.battle;
    if (!b.player.alive) b.player.spawn(b.player.pos.clone(), b.player.yaw);
    b.player.hp = b.player.maxHp;
  });
  const stickPt = [Math.round(env.w * 0.22), Math.round(env.h - 60)];
  const lookPt = [Math.round(env.w * 0.6), Math.round(env.h * 0.3)];
  const zones = await page.evaluate(([s, l]) => ({
    stick: (document.elementFromPoint(s[0], s[1]) || {}).className || 'none',
    look: (document.elementFromPoint(l[0], l[1]) || {}).className || 'none',
  }), [stickPt, lookPt]);
  console.log('drag targets', zones);
  if (!String(zones.stick).includes('tc-stick-zone')) fail('thumbstick point is blocked by ' + zones.stick);
  if (!String(zones.look).includes('tc-look-zone')) fail('look point is blocked by ' + zones.look);
  const p0 = await page.evaluate(() => ({ ...window.__gf.battle.player.pos }));
  await drag(stickPt[0], stickPt[1], stickPt[0], stickPt[1] - 60, 6);
  const stick = await page.evaluate(() => ({ x: +window.__gf.battle.input.stick.x.toFixed(2), y: +window.__gf.battle.input.stick.y.toFixed(2) }));
  if (!(await waitGameTime(1.5))) fail('the battle loop stalled while holding the thumbstick');
  const p1 = await page.evaluate(() => ({ ...window.__gf.battle.player.pos }));
  await release(stickPt[0], stickPt[1] - 60);
  const moved = Math.hypot(p1.x - p0.x, p1.z - p0.z);
  console.log('thumbstick', { stick, moved: +moved.toFixed(2) });
  if (stick.y < 0.5) fail('thumbstick did not register forward input: ' + JSON.stringify(stick));
  if (moved < 1.5) fail('player did not move with the thumbstick: ' + moved.toFixed(2));

  // --- look drag turns the camera
  const yaw0 = await page.evaluate(() => window.__gf.battle.player.yaw);
  await drag(lookPt[0], lookPt[1], lookPt[0] - 140, lookPt[1], 8);
  await release(lookPt[0] - 140, lookPt[1]);
  await waitGameTime(0.3);
  const yaw1 = await page.evaluate(() => window.__gf.battle.player.yaw);
  console.log('look drag', { yaw0: +yaw0.toFixed(3), yaw1: +yaw1.toFixed(3) });
  if (Math.abs(yaw1 - yaw0) < 0.05) fail('look drag did not turn the camera');

  // --- fire button shoots
  const ammo0 = await page.evaluate(() => window.__gf.battle.player.weapons[window.__gf.battle.player.weaponIndex].mag);
  await page.evaluate(() => {
    const b = document.querySelector('.tc-fire');
    const o = (t) => new PointerEvent(t, { pointerId: 3, pointerType: 'touch', isPrimary: true, clientX: 0, clientY: 0, bubbles: true, cancelable: true });
    b.dispatchEvent(o('pointerdown'));
  });
  await waitGameTime(0.6);
  await page.evaluate(() => document.querySelector('.tc-fire').dispatchEvent(new PointerEvent('pointerup', { pointerId: 3, pointerType: 'touch', isPrimary: true, bubbles: true, cancelable: true })));
  const ammo1 = await page.evaluate(() => window.__gf.battle.player.weapons[window.__gf.battle.player.weaponIndex].mag);
  console.log('fire', { ammo0, ammo1 });
  if (ammo1 >= ammo0) fail(`fire button did not shoot: ${ammo0} -> ${ammo1}`);
  // the HUD must not sit under the thumb cluster
  const clash = await page.evaluate(() => {
    const box = (s) => { const e = document.querySelector(s); if (!e || getComputedStyle(e).display === 'none') return null; const b = e.getBoundingClientRect(); return b.width ? b : null; };
    const hit = (a, b) => a && b && !(a.right < b.left || b.right < a.left || a.bottom < b.top || b.bottom < a.top);
    const fire = box('.tc-fire');
    return { ammoOverFire: hit(box('.hud-br'), fire), supportShown: !!box('.hud-support'), artyLabel: (document.querySelector('.tc-support .tc-btn') || {}).textContent };
  });
  console.log('hud vs controls', clash);
  if (clash.ammoOverFire) fail('the ammo readout sits under the fire button');
  if (clash.supportShown) fail('the support readout duplicates the on-screen buttons');
  if (!/\d|—/.test(clash.artyLabel || '')) fail('support buttons do not show their remaining count: ' + clash.artyLabel);
  await shot('08-firing');

  // --- command map via the MAP button
  await page.evaluate(() => {
    const b = [...document.querySelectorAll('.tc-sys .tc-btn')].find((x) => x.textContent === 'MAP');
    b.click();
  });
  await page.waitForTimeout(900);
  const cmd = await page.evaluate(() => ({
    commander: window.__gf.battle.commander.active,
    mapbar: getComputedStyle(document.querySelector('.tc-mapbar')).display,
    sticks: getComputedStyle(document.querySelector('.tc-stick-zone')).display,
  }));
  console.log('command map', cmd);
  if (!cmd.commander) fail('MAP button did not open the command map');
  if (cmd.mapbar === 'none') fail('map toolbar is hidden in command mode');
  if (cmd.sticks !== 'none') fail('thumbstick still showing on the command map');
  await shot('09-command');

  // pan the map with a drag
  const c0 = await page.evaluate(() => ({ ...window.__gf.battle.commander['center'] }));
  await drag(Math.round(env.w * 0.5), Math.round(env.h * 0.5), Math.round(env.w * 0.5) - 120, Math.round(env.h * 0.5) - 60, 6);
  await release(Math.round(env.w * 0.5) - 120, Math.round(env.h * 0.5) - 60);
  await waitGameTime(0.3);
  const c1 = await page.evaluate(() => ({ ...window.__gf.battle.commander['center'] }));
  console.log('map pan', { c0, c1 });
  if (Math.hypot(c1.x - c0.x, c1.y - c0.y) < 1) fail('dragging did not pan the command map');

  await page.evaluate(() => [...document.querySelectorAll('.tc-sys .tc-btn')].find((x) => x.textContent === 'MAP').click());
  await waitGameTime(0.3);
  await page.evaluate(() => [...document.querySelectorAll('.tc-sys .tc-btn')].find((x) => x.textContent !== 'MAP').click());
  await page.waitForTimeout(500);
  const paused = await page.evaluate(() => ({ pause: document.querySelector('.hud-pause').classList.contains('on'), touchHidden: document.querySelector('.touch-ui').style.display === 'none' }));
  console.log('pause', paused);
  if (!paused.pause) fail('pause button did not open the pause menu');
  if (!paused.touchHidden) fail('touch controls still visible while paused');
  await shot('10-paused');
  }
} catch (e) {
  errors.push('script: ' + (e && e.message));
  await shot('error').catch(() => {});
}
await Promise.race([browser.close(), new Promise((r) => setTimeout(r, 5000))]);
try { process.kill(-server.pid, 'SIGKILL'); } catch { server.kill('SIGKILL'); }
if (errors.length) { console.error('ERRORS:\n' + errors.join('\n')); process.exit(1); }
console.log('mobile test passed');
process.exit(0);
