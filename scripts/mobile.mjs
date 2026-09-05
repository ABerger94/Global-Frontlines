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
const KIT = process.env.KIT || '';
mkdirSync(OUT, { recursive: true });
const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { stdio: 'pipe', detached: true });
await new Promise((r) => setTimeout(r, 2500));
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || chromePath(), args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const phone = devices['Pixel 7'];
const context = await browser.newContext({
  ...phone,
  viewport: process.env.VW ? { width: Number(process.env.VW), height: Number(process.env.VH) } : PORTRAIT ? { width: 412, height: 915 } : { width: 915, height: 412 },
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
  const mapVisible = await page.evaluate(() => {
    let open = 0;
    let total = 0;
    for (let fy = 0.2; fy <= 0.8; fy += 0.05) {
      for (let fx = 0.15; fx <= 0.85; fx += 0.05) {
        total++;
        if (document.elementFromPoint(Math.round(window.innerWidth * fx), Math.round(window.innerHeight * fy))?.id === 'gl') open++;
      }
    }
    return Math.round((open / total) * 100);
  });
  console.log('globe reachable', mapVisible + '% of the screen');
  if (mapVisible < 45) fail(`panels cover the map: only ${mapVisible}% of the screen is globe`);
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
  // the close button must be a comfortable target and must survive a redraw
  const closeBox = await page.locator('.side-panel .close').boundingBox();
  console.log('close button', closeBox && { w: Math.round(closeBox.width), h: Math.round(closeBox.height) });
  if (!closeBox || closeBox.width < 40 || closeBox.height < 40) fail('the close button is too small for a finger: ' + JSON.stringify(closeBox));
  await page.evaluate(() => {
    const b = document.querySelector('.side-panel .close');
    const r = b.getBoundingClientRect();
    const o = (t) => new PointerEvent(t, { pointerId: 9, pointerType: 'touch', isPrimary: true, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, bubbles: true, cancelable: true });
    b.dispatchEvent(o('pointerdown'));
    for (let i = 0; i < 4; i++) window.__gf.sim.events.emit('dirty');
  });
  await page.waitForTimeout(450);
  const stillThere = await page.evaluate(() => !!document.querySelector('.side-panel .close'));
  if (!stillThere) fail('the close button vanished while a finger was on it');
  await page.evaluate(() => {
    const b = document.querySelector('.side-panel .close');
    b.dispatchEvent(new PointerEvent('pointerup', { pointerId: 9, pointerType: 'touch', isPrimary: true, bubbles: true, cancelable: true }));
    b.click();
  });
  await page.waitForTimeout(400);
  const tapClosed = await page.evaluate(() => window.__gf.stratUI.activeTab === null);
  console.log('close on touch', { stillThere, tapClosed });
  if (!tapClosed) fail('tapping close did not close the panel');
  if (await page.locator('[data-act=closeTab]').count()) await page.tap('[data-act=closeTab]');

  // --- into a battle
  await page.evaluate(() => {
    const app = window.__gf;
    const sim = app.sim;
    for (const t of sim.era.techs) sim.player.techs.add(t.id);
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
  if (KIT && (await page.$(`[data-kit=${KIT}]:not(.locked)`))) await page.tap(`[data-kit=${KIT}]`);
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
    // what share of the screen is free to aim with, and free to steer with
    let look = 0;
    let stick = 0;
    let cells = 0;
    for (let fy = 0.1; fy <= 0.92; fy += 0.04) {
      for (let fx = 0.05; fx <= 0.95; fx += 0.04) {
        cells++;
        const e = document.elementFromPoint(Math.round(window.innerWidth * fx), Math.round(window.innerHeight * fy));
        const c = e ? e.className.toString() : '';
        if (c.includes('tc-look-zone')) look++;
        if (c.includes('tc-stick-zone')) stick++;
      }
    }
    return {
      stickZone: hit(80, window.innerHeight - 80),
      lookPct: Math.round((look / cells) * 100),
      stickPct: Math.round((stick / cells) * 100),
      fire: r('.tc-fire'),
      sys: r('.tc-sys'),
      buttons: document.querySelectorAll('.tc-btn').length,
    };
  });
  console.log('control layout', layout);
  if (!layout.stickZone.includes('tc-stick-zone')) fail('thumbstick area is covered: ' + layout.stickZone);
  if (layout.lookPct < 25) fail(`buttons crowd out the aiming area: only ${layout.lookPct}% of the screen is free to look with`);
  if (layout.stickPct < 20) fail(`only ${layout.stickPct}% of the screen is free to steer with`);
  if (!layout.fire?.onScreen) fail('fire button is off screen');
  if (!layout.sys?.onScreen) fail('map/pause buttons are off screen');

  if (KIT === 'tank') {
    const t0 = await page.evaluate(() => {
      const b = window.__gf.battle;
      const t = b.playerTank;
      if (!t) return { missing: true };
      const V = b.camera.position.constructor;
      const p = b.camera.getWorldPosition(new V());
      const dir = b.camera.getWorldDirection(new V());
      const proj = t.pos.clone().add(new V(0, 1.5, 0)).project(b.camera);
      return {
        mode: b.mode,
        dist: +p.distanceTo(t.pos).toFixed(2),
        above: +(p.y - t.pos.y).toFixed(2),
        lookingDown: +dir.y.toFixed(3),
        onScreen: Math.abs(proj.x) < 0.4 && Math.abs(proj.y) < 0.9,
        fire: !!document.querySelector('.tc-fire'),
        stick: !!document.querySelector('.tc-stick-zone'),
        tankClass: document.querySelector('.touch-ui').classList.contains('mode-tank'),
      };
    });
    console.log('tank camera', t0);
    if (t0.missing) fail('tank kit did not put the player in a tank');
    else {
      if (t0.dist < 6 || t0.dist > 20) fail(`tank camera is not a chase camera: ${t0.dist}m`);
      if (t0.above < 1 || t0.above > 10) fail(`tank camera height wrong: ${t0.above}m`);
      if (t0.lookingDown < -0.6) fail(`tank camera is a birdseye view: ${t0.lookingDown}`);
      if (!t0.onScreen) fail('the tank is not visible from its own camera');
      if (!t0.tankClass || !t0.fire || !t0.stick) fail('tank touch controls are missing: ' + JSON.stringify(t0));
    }
    // drive with the thumbstick
    const stickPt2 = [Math.round(env.w * 0.22), Math.round(env.h - 60)];
    const before = await page.evaluate(() => ({ ...window.__gf.battle.playerTank.pos }));
    await drag(stickPt2[0], stickPt2[1], stickPt2[0], stickPt2[1] - 60, 6);
    await waitGameTime(2.0);
    const after = await page.evaluate(() => ({ ...window.__gf.battle.playerTank.pos }));
    await release(stickPt2[0], stickPt2[1] - 60);
    const drove = Math.hypot(after.x - before.x, after.z - before.z);
    console.log('tank driving', { drove: +drove.toFixed(2) });
    if (drove < 2) fail('the thumbstick did not drive the tank: ' + drove.toFixed(2));
    // the camera must still be behind the hull after moving
    const t1 = await page.evaluate(() => {
      const b = window.__gf.battle;
      const V = b.camera.position.constructor;
      const p = b.camera.getWorldPosition(new V());
      return { dist: +p.distanceTo(b.playerTank.pos).toFixed(2) };
    });
    console.log('tank camera after driving', t1);
    if (t1.dist < 6 || t1.dist > 20) fail(`the camera lost the tank while driving: ${t1.dist}m`);
    await shot('07b-tank');
  }

  // --- thumbstick moves the player
  if (KIT === 'tank') {
    await shot('08-firing');
  } else {
  // make sure the subject is alive and standing before measuring movement and look
  await page.evaluate(() => {
    const b = window.__gf.battle;
    if (!b.player.alive) b.player.spawn(b.player.pos.clone(), b.player.yaw);
    b.player.hp = b.player.maxHp;
  });
  const stickPt = [Math.round(env.w * 0.22), Math.round(env.h - 60)];
  const lookPt = [Math.round(env.w * 0.6), Math.round(env.h * 0.3)];
  const zones = await page.evaluate(([s, l]) => {
    const id = (x, y) => {
      const e = document.elementFromPoint(x, y);
      if (!e) return 'none';
      const b = e.getBoundingClientRect();
      return `${e.tagName}.${e.className || '-'}[${e.textContent.trim().slice(0, 8)}] @${Math.round(b.left)},${Math.round(b.top)} ${Math.round(b.width)}x${Math.round(b.height)}`;
    };
    return { stick: id(s[0], s[1]), look: id(l[0], l[1]) };
  }, [stickPt, lookPt]);
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
  }

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

  // --- the whole way out: withdraw -> after-action report -> back to the war room
  await page.tap('[data-act=withdraw]');
  await page.waitForSelector('.report', { timeout: 20000 });
  await page.waitForTimeout(800);
  await shot('11-report');
  const report = await page.evaluate(() => {
    const btn = document.querySelector('.report .btn');
    const b = btn.getBoundingClientRect();
    const ov = document.querySelector('.report-overlay');
    const at = document.elementFromPoint(Math.round(b.left + b.width / 2), Math.round(b.top + b.height / 2));
    return {
      onScreen: b.top >= 0 && b.bottom <= window.innerHeight + 1 && b.left >= 0 && b.right <= window.innerWidth + 1,
      reachable: !!at && (at === btn || btn.contains(at) || btn === at.closest('.btn')),
      overlayScrolls: getComputedStyle(ov).overflowY === 'auto',
      deadShown: document.querySelector('.hud-dead').classList.contains('on'),
    };
  });
  console.log('after-action report', report);
  if (!report.onScreen) fail('the "return to the war room" button is off screen');
  if (!report.reachable) fail('the report button is covered by something else');
  if (!report.overlayScrolls) fail('the report overlay cannot scroll on a short screen');
  if (report.deadShown) fail('the redeploy countdown is still showing behind the report');

  await page.tap('.report .btn');
  await page.waitForTimeout(3000);
  const back = await page.evaluate(() => ({
    screen: window.__gf.screen,
    battleGone: !window.__gf.battle,
    reportGone: !document.querySelector('.report-overlay'),
    touchGone: !document.querySelector('.touch-ui'),
    topbar: !!document.querySelector('[data-tab=research]'),
    stratVisible: getComputedStyle(document.querySelector('.strat')).display !== 'none',
  }));
  console.log('back to war room', back);
  if (back.screen !== 'strategy') fail('did not return to the strategy screen: ' + back.screen);
  if (!back.battleGone) fail('the battle was not torn down');
  if (!back.reportGone) fail('the report overlay is still on screen');
  if (!back.touchGone) fail('the battle touch controls outlived the battle');
  if (!back.topbar || !back.stratVisible) fail('the strategy interface did not come back');

  // the globe must still answer a tap
  await page.evaluate(() => window.__gf.stratUI.selectProvince(null));
  await page.waitForTimeout(300);
  const clearSpot = await page.evaluate(() => {
    // a point that is both uncovered and actually on the planet, not empty space
    for (let fy = 0.3; fy <= 0.75; fy += 0.05) {
      for (let fx = 0.3; fx <= 0.7; fx += 0.05) {
        const x = Math.round(window.innerWidth * fx);
        const y = Math.round(window.innerHeight * fy);
        if (document.elementFromPoint(x, y)?.id !== 'gl') continue;
        const hit = window.__gf.globe.pickProvince((x / window.innerWidth) * 2 - 1, -(y / window.innerHeight) * 2 + 1);
        if (hit) return { x, y };
      }
    }
    return null;
  });
  if (!clearSpot) fail('no part of the globe is reachable: panels cover the whole screen');
  else {
    await page.touchscreen.tap(clearSpot.x, clearSpot.y);
    await page.waitForTimeout(800);
    const responsive = await page.evaluate(() => window.__gf.stratUI.selectedProvince !== null);
    if (!responsive) fail(`the globe stopped responding to taps after the battle (tapped ${clearSpot.x},${clearSpot.y})`);
  }
  await shot('12-war-room');
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
