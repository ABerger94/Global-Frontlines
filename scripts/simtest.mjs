// Runs the strategy simulation headlessly for every era to check stability and balance.
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';

const PORT = Number(process.env.PORT || 4190);
const DAYS = Number(process.env.DAYS || 400);
const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { stdio: 'pipe', detached: true });
await new Promise((r) => setTimeout(r, 2500));
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'load' });
await page.waitForTimeout(1500);
const results = await page.evaluate((DAYS) => {
  const { StrategySim, ERAS } = window.__gf.debug;
  const out = [];
  for (const era of ERAS) {
    for (const nation of era.nations) {
      const t0 = performance.now();
      const sim = new StrategySim(era, nation.id, 1234 + era.nations.indexOf(nation));
      let battles = 0;
      let prompts = 0;
      let logs = 0;
      const wars = [];
      sim.events.on('log', (m, k) => {
        logs++;
        if (k === 'war') wars.push(m);
      });
      sim.events.on('battlePrompt', (ctx) => {
        prompts++;
        battles++;
        sim.resolvePending(sim.autoResolve(ctx));
      });
      let gameOver = null;
      sim.events.on('gameOver', (won, reason) => (gameOver = { won, reason }));
      for (let d = 0; d < DAYS && !sim.gameOver; d++) sim.tickDay();
      const p = sim.player;
      const nan = [p.steel, p.munitions, p.equipment, p.oil, p.manpower, p.research, p.stability].some((v) => !Number.isFinite(v));
      const armies = [...sim.armies.values()];
      const badArmy = armies.some((a) => !Number.isFinite(a.men) || a.men < 0 || !Number.isFinite(a.equipment));
      const owned = sim.provincesOf(p.id).length;
      const alive = [...sim.nations.values()].filter((n) => n.alive).map((n) => n.id);
      out.push({
        era: era.id, nation: nation.id, days: sim.day, ms: Math.round(performance.now() - t0), prompts, logs, nan, badArmy, owned,
        techs: p.techs.size, steel: Math.round(p.steel), mun: Math.round(p.munitions), stab: Math.round(p.stability), armies: armies.length,
        alive: alive.join(','), gameOver: gameOver && gameOver.reason, warEvents: wars.length, sampleWar: wars.slice(-2),
      });
    }
  }
  return out;
}, DAYS);
for (const r of results) console.log(JSON.stringify(r));
await Promise.race([browser.close(), new Promise((r) => setTimeout(r, 5000))]);
try { process.kill(-server.pid, 'SIGKILL'); } catch { server.kill('SIGKILL'); }
if (errors.length) { console.error('ERRORS:\n' + errors.join('\n')); process.exit(1); }
process.exit(0);
