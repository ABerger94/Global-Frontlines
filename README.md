# Global Frontlines: Theater of War

A grand-strategy war game fused with a first-person shooter, running entirely in the browser.

Pick an era (**World War I**, **World War II**, **Present Day**) and a nation, then run your war from a
3D globe: economy, research, diplomacy and army movement. When two armies collide you can
**Auto-Resolve** the battle or **Take Command** and drop into a first-person battlefield generated from
the strategic situation. Your munitions, equipment quality, artillery, air power and tech all follow you
onto the field, and the battle's outcome flows straight back to the map.

![Strategy globe](docs/screenshots/strategy.png)
![WWII battle](docs/screenshots/battle-ww2.png)

## Running it

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # production bundle in dist/
npm run preview    # serve the production bundle
npm run smoke      # headless Playwright walkthrough with screenshots (scripts/out/)
```

Requirements: a modern browser with WebGL 2, a mouse and a keyboard. No assets are downloaded; every
world, battlefield, soldier, weapon and sound is generated procedurally at runtime.

## Deploying to Vercel

The repo is a static Vite site and ships with a `vercel.json`, so deployment is zero-config:

1. Import the repository at [vercel.com/new](https://vercel.com/new). Vercel detects the Vite framework
   preset; the config pins `npm ci` for install, `npm run build` for build and `dist` as the output.
2. Deploy. There are no environment variables, serverless functions or databases.

Or from the command line: `npx vercel --prod`. Every push to the connected branch produces a new
deployment; the `assets/` bundle is served with immutable caching and the Three.js chunk is split
from the game code so it stays cached between releases.

The headless smoke test uses `playwright-core` and needs a Chromium binary. Set `CHROME_PATH`, or run
`npx playwright install chromium` once, before `npm run smoke`.

## How to play

**Strategy layer**

* Drag to rotate the globe, scroll to zoom, click a province to inspect it.
* Select one of your armies in the province panel, then click a destination. Moving into enemy or
  neutral land starts a battle.
* Top-right tabs: **Research** (three branches, four tiers), **Production** (split factory output
  between munitions, equipment and construction steel), **Diplomacy** (relations, alliances, war,
  truces) and **Armies**.
* `Space` pauses, `1` `2` `3` set the speed.

**Battle layer**

| Key | Action |
| --- | --- |
| `W A S D` / `Shift` / `Ctrl` / `Space` | Move / sprint / crouch / jump |
| `LMB` / `RMB` | Fire / aim down sights |
| `R` | Reload, or clear a jam |
| `1` `2` / wheel | Switch weapons |
| `F` / `H` | Grenade / medkit |
| `Q` / `E` | Squad: follow-hold toggle / attack-move to aim point |
| `5` / `6` / `7` | Artillery / air support / recon drone |
| `G` / `N` | Gas mask (WWI) / night vision (modern) |
| `Tab` | Command map: select squads, right-click to order, `Z`+click artillery, `X`+click air |
| `Esc` | Pause / withdraw |

Capture **A**, **B** and **C**. Holding more objectives than the enemy bleeds their tickets. Time keeps
passing on the globe while you fight (one day every 30 seconds), so a friendly army arriving at the
contested province shows up as reinforcements mid-battle.

## Roles and kits

* **Supreme Commander** — starts in the command map with extra strikes; direct squads and drop fire missions.
* **Squad Leader** — a squad of AI soldiers follows you and takes your orders.
* **Boots on the Ground** — Rifleman, Machine Gunner, SMG/Trench Raider, Medic, Marksman, or Tank Commander
  (a drivable tank with main gun and coaxial MG). Some kits are unlocked by research.

## Strategy → battle modifiers

| Strategic state | Battle effect |
| --- | --- |
| Munitions stockpile | Ammunition per soldier, artillery availability |
| Equipment quality | Weapon jam chance, AI accuracy |
| Artillery / air / drone tech | Support call-ins |
| Armour tech | Tank kit and AI tanks |
| Gas warfare (WWI) | Gas shells for both sides; masks for yours |
| Thermal optics (modern) | Aiming reveals enemies at night |
| Terrain and fortification | Battlefield preset and auto-resolve odds |

## Project layout

```
src/
  core/       seeded RNG, 3D noise, maths, event bus
  data/       eras, nations, weapons, tech trees, kits
  strategy/   world generator, simulation (economy, AI, diplomacy, battles), globe scene, UI
  battle/     terrain generator, effects, AI soldiers, player, tank, support, commander map, HUD
  audio/      WebAudio synthesiser
  ui/         menus and styles
docs/         GAME_DESIGN.md — the full design document
scripts/      smoke.mjs — headless end-to-end test
```

Built with [Three.js](https://threejs.org), TypeScript and Vite.
