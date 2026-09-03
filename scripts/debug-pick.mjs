import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';
const PORT = 4187;
const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { stdio: 'pipe', detached: true });
await new Promise((r) => setTimeout(r, 2500));
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.on('pageerror', (e) => console.log('pageerror', e.message));
await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'load' });
await page.waitForTimeout(1500);
await page.click('[data-act=new]'); await page.click('[data-era=ww2]'); await page.click('[data-act=next]'); await page.click('[data-nation=germany]'); await page.click('[data-act=start]');
await page.waitForTimeout(4000);
// replicate the smoke drag
await page.mouse.move(720, 450); await page.mouse.down();
for (let i = 1; i <= 10; i++) await page.mouse.move(720 + i * 25, 450 + i * 6);
await page.mouse.up();
await page.waitForTimeout(600);
const st = await page.evaluate(() => ({ state: window.__gf.globe.controls.state, camPos: window.__gf.globe.camera.position.toArray() }));
console.log('after drag', JSON.stringify(st));
await page.mouse.wheel(0, -600);
await page.waitForTimeout(600);
await page.mouse.click(720, 450);
await page.waitForTimeout(400);
const sel0 = await page.evaluate(() => ({ selected: window.__gf.stratUI.selectedProvince, camDist: window.__gf.globe.camera.position.length() }));
console.log('after wheel+click', JSON.stringify(sel0));
await page.click('[data-act=closeProvince]');
await page.waitForTimeout(300);
const st2 = await page.evaluate(() => ({ state: window.__gf.globe.controls.state, camPos: window.__gf.globe.camera.position.toArray() }));
console.log('after extra move', JSON.stringify(st2));
const out = await page.evaluate(() => {
  const app = window.__gf;
  const cap = app.sim.world.provinces.find((p) => p.capitalOf === app.sim.playerId);
  app.globe.focusProvince(cap.id, 2.2);
  const v = cap.pos.clone().project(app.globe.camera);
  const picked = app.globe.pickProvince(0, 0);
  return { cap: cap.name, lat: cap.lat, lon: cap.lon, proj: [v.x, v.y], picked: picked && picked.name, pickedLatLon: picked && [picked.lat, picked.lon], camPos: app.globe.camera.position.toArray() };
});
console.log(JSON.stringify(out));
await page.waitForTimeout(500);
const out2 = await page.evaluate(() => {
  const app = window.__gf;
  const picked = app.globe.pickProvince(0, 0);
  return { pickedAfter: picked && picked.name, camPos: app.globe.camera.position.toArray() };
});
console.log(JSON.stringify(out2));
await page.evaluate(() => {
  const app = window.__gf;
  window.__picks = [];
  const orig = app.globe.pickProvince.bind(app.globe);
  app.globe.pickProvince = (x, y) => { const r = orig(x, y); window.__picks.push({ x, y, r: r && r.name }); return r; };
});
await page.mouse.click(720, 450);
await page.waitForTimeout(300);
const out3 = await page.evaluate(() => ({ picks: window.__picks, selected: window.__gf.stratUI.selectedProvince, iw: innerWidth, ih: innerHeight, cw: document.getElementById('gl').clientWidth, ch: document.getElementById('gl').clientHeight, camPos: window.__gf.globe.camera.position.toArray() }));
console.log(JSON.stringify(out3));
await browser.close();
try { process.kill(-server.pid, 'SIGKILL'); } catch {}
process.exit(0);
