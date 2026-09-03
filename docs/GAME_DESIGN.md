# Global Frontlines: Theater of War — Game Design Document

> Working title. A grand-strategy war game fused with a first-person shooter.
> Strategy shapes the shooter; shooter skill saves the strategy.

---

## 1. Vision

You are the Commander-in-Chief of a nation in one of three eras. From a 3D globe you run the
economy, the research programme, diplomacy and the movement of armies. When two armies collide
you can let your generals settle it (**Auto-Resolve**) or **Take Command** and drop into a
first-person battle whose terrain, equipment, supplies and support assets are all derived from the
strategic situation. The result of that battle flows straight back to the map.

Two pillars, one loop:

| Pillar | Fantasy | Time scale |
| --- | --- | --- |
| Grand Strategy | "I am steering a nation through a world war." | days → years |
| Tactical FPS | "I am the one holding the line." | seconds → 15 minutes |

---

## 2. Eras & Nations

Each era changes the tech tree, the unit roster, the weapons, the battlefield generator and the
strategic tempo.

### 2.1 World War I (1914–1918) — *Attrition*
* Tempo: slow. Armies move 4 days per province. Fortified provinces are brutal to assault.
* Battlefield: mud, two opposing trench networks, No Man's Land, barbed wire, shell craters, fog.
  Whistle-blow charges. Gas shells (player must don gas mask — `G`). Creeping barrages.
* Weapons: bolt-action rifles (Lee-Enfield, Gewehr 98, Mosin), Lewis/MG08 machine guns, Mills bombs.
* Nations: **Britain, France, Germany, Russia, Ottoman Empire, USA**.

### 2.2 World War II (1939–1945) — *Manoeuvre*
* Tempo: fast. Armour and air superiority dominate. Encirclement matters.
* Battlefield: rolling hills, hedgerows, a ruined town at the centre, wrecked vehicles.
* Weapons: Garand/Kar98k/SVT, Thompson/MP40/PPSh, BAR/MG42, drivable tanks (Sherman / Panzer IV /
  T-34), air strikes.
* Nations: **USA, UK, USSR, Germany, Japan**.

### 2.3 Present Day (2026+) — *Precision*
* Tempo: very fast but expensive. Drones, precision missiles, electronic warfare.
* Battlefield: night-time urban sprawl. Night vision (`N`) and thermal drone recon reveal enemies.
* Weapons: M4 / AK-12 / QBZ-191, DMRs, SAWs, MBTs, loitering munitions, precision strikes.
* Nations: **USA, China, Russia, NATO Coalition, Regional Coalition**.

---

## 3. Grand Strategy Layer

The macro view is a 3D globe of the real Earth. Coastlines and country borders come from Natural
Earth (110 m). At campaign start each country is subdivided into provinces (by area and population,
seeded with farthest-point sampling so Alaska, Hawaii and Kaliningrad get their own), named from a
gazetteer of historical regions and real cities, and assigned to a nation from the era's political
table (`src/data/history.ts`). Terrain comes from mountain and desert belts plus noise; oil sits where
the oil is. Independent countries keep their own identity and can be invaded at a stability cost.

Each era also carries non-playable AI powers (Austria-Hungary, Italy, Serbia, Belgium, China, Finland,
Hungary, Romania, Vichy France, Ukraine, Japan, Korea, India and others) and a track of dated events
that fire as the calendar advances. Events never script the player's own nation.

### 3.1 Province
Each province has: owner, terrain type (plains / forest / hills / mountain / urban / desert /
coast), population, factories, oil, fortification level, supply level, and a garrison.

### 3.2 Economy & Logistics
Daily tick. Resources:

| Resource | Source | Spent on |
| --- | --- | --- |
| Steel | factories × industry tech | equipment, fortification, new armies |
| Oil | oil provinces | mobility (movement speed), armour, air ops |
| Munitions | factories allocated to munitions | combat upkeep — **starve this and troops spawn with less ammo** |
| Manpower | population | raising armies, replacing losses |
| Research | urban provinces, labs | tech tree |
| Stability | victories, defeats, casualties | above 30% or the nation collapses |

The **production slider** divides factory output between Munitions, Equipment and Vehicles. The
**supply state** of the nation is computed from stockpiles and directly parameterises FPS battles.

### 3.3 Research
Three branches per era, four tiers each (Infantry, Armour/Air, Industry). Every node has a
tangible effect on both layers: e.g. *Semi-Automatic Rifles* changes the rifleman's spawn weapon;
*Creeping Barrage* adds artillery strikes to the commander's call-in budget; *Assembly Lines*
increases steel and reduces weapon jam chance.

### 3.4 Diplomacy
Relations from −100 to +100. Historical blocs start allied. Actions: improve relations, form an
alliance, declare war (costs stability if unprovoked), request a truce. AI nations pursue their
own wars based on personality (aggressive / cautious / opportunist).

### 3.5 Armies & Frontlines
Armies are stacks (men, equipment quality, organisation). They move province to province; sea
provinces are traversable at slow speed (abstract naval transport). Moving into an enemy province
creates a **conflict zone**.

---

## 4. Tactical FPS Layer

### 4.1 Entering a battle
A conflict prompt shows both sides, the terrain, and the supply-derived modifiers. Choose:

* **Auto-Resolve** — resolved statistically (strength × equipment × org × tech × terrain × supply).
* **Take Command** — pick a role and deploy.

### 4.2 Roles
* **Supreme Commander** — starts in the top-down command map (`Tab`). Assign squad objectives,
  drop artillery markers, call air support. Can still drop to the ground at any time.
* **Squad Leader** — a squad of AI soldiers follows you. `Q` toggles Follow / Hold, `E` issues
  an attack-move to where you are aiming.
* **Boots on the Ground** — Rifleman, Machine Gunner, Medic (heals allies, extra medkits),
  Tank Commander (drivable armour, WWII/Modern). Fighter Pilot is on the roadmap.

### 4.3 Battle rules
* Three capture points (A/B/C) between the attacker spawn and the defender spawn.
* Both sides have **tickets** derived from their army strength. Deaths cost tickets; holding a
  majority of points bleeds the enemy.
* Battle ends when a side hits 0 tickets or the 12-minute clock runs out.
* **Time still passes on the globe** (one strategic day every 30 seconds). If a friendly army
  reaches the contested province during the fight, reinforcements arrive: extra tickets and a
  fresh squad. *Holding a bridge for twenty minutes really does buy your map time.*

### 4.4 Strategy → FPS modifiers

| Strategic state | FPS effect |
| --- | --- |
| Munitions stockpile low | fewer magazines, no artillery |
| Equipment quality low | higher weapon jam chance, lower accuracy for AI allies |
| Medical tech / supply | number of medkits, medic heal rate |
| Artillery tech | number of artillery strikes available |
| Air tech + oil | air support strafing runs |
| Armour tech | tank availability & armour |
| Organisation | AI ally morale (cover-seeking, retreat threshold) |
| Terrain type | battlefield generator preset |

### 4.5 FPS → Strategy
* Victory: province captured (attacking) or held (defending); loser suffers casualties scaled to
  tickets lost.
* Defeat: army retreats with heavy losses.
* Kills, points held and time survived are recorded in the after-action report.

---

## 5. Controls

| Key | Action |
| --- | --- |
| `W A S D` | Move |
| `Shift` | Sprint |
| `Ctrl` | Crouch |
| `Space` | Jump |
| `Mouse` | Aim / Fire (LMB) / ADS (RMB) |
| `R` | Reload / clear jam |
| `1` `2` | Primary / sidearm |
| `F` | Grenade |
| `H` | Use medkit |
| `Q` / `E` | Squad Follow-Hold / Attack-move |
| `5` | Call artillery on aim point |
| `6` | Call air support on aim point |
| `7` | Recon drone (modern) |
| `G` | Gas mask (WWI) |
| `N` | Night vision (modern) |
| `Tab` | Command map |
| `M` | Minimap toggle |
| `Esc` | Pause |

---

## 6. Technology

* **Renderer**: Three.js (WebGL 2) with post-processing (bloom, vignette, tone mapping).
* **Language**: TypeScript, bundled by Vite. No backend; runs in any modern browser.
* **Audio**: procedurally synthesised via WebAudio (no asset downloads).
* **Assets**: everything procedural — terrain from fractal noise, buildings, soldiers and weapons
  from primitive geometry. This keeps the repository tiny and iteration fast; a future art pass
  can swap in GLTF models via the `MeshFactory` seams.

Repository layout:

```
src/
  core/       rng, noise, maths, event bus
  data/       eras, nations, techs, weapons, units
  strategy/   world generator, simulation, globe scene, strategy UI
  battle/     terrain, player, weapons, AI soldiers, vehicles, support, commander, HUD, effects
  audio/      synthesiser
  ui/         menus, shared styles
docs/         design documents
scripts/      smoke test (Playwright)
```

---

## 7. Roadmap

**Vertical slice (this repo, v0.1)** — era/nation select, procedural globe, economy, research,
diplomacy, army movement, conflict prompt, auto-resolve, full FPS battle with three roles, tank,
support call-ins, commander map, reinforcements during battle, after-action report.

**v0.2** — Fighter Pilot role, naval units, more nations per era, save/load, campaign scenarios
based on historical frontlines.

**v0.3** — Co-op multiplayer squads (WebRTC), GLTF art pass, voice lines, weather system.

**v1.0** — Full campaign scripting, dynamic front lines drawn as continuous arrows, mod support.
