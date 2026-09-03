import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RNG } from '../core/rng';
import { clamp } from '../core/math';
import type { WeaponDef } from '../data/types';
import { WEAPONS } from '../data/weapons';
import type { BattleSetup, BattleResult, Team } from './types';
import { Battlefield, HALF } from './terrain';
import { Effects } from './effects';
import { Soldier, Squad, UNIFORM_COLORS } from './soldiers';
import { Player, type PlayerConfig } from './player';
import { Tank } from './vehicle';
import { Support } from './support';
import { CommanderMode } from './commander';
import { HUD, type MinimapUnit } from './hud';
import { Input } from './input';
import type { BattleWorld, Combatant, GasCloud } from './combat';
import { audio } from '../audio/audio';

const SURNAMES: Record<string, string[]> = {
  en: ['Walker', 'Hughes', 'Bennett', 'Carter', 'Fletcher', 'Harris', 'Morgan', 'Price', 'Reid', 'Turner', 'Wallace', 'Young', 'Cooper', 'Mason', 'Ellis', 'Grant'],
  fr: ['Moreau', 'Lefebvre', 'Garnier', 'Dubois', 'Renard', 'Marchand', 'Fontaine', 'Rousseau', 'Chevalier', 'Bertrand', 'Leroy', 'Giraud'],
  de: ['Müller', 'Schneider', 'Fischer', 'Weber', 'Wagner', 'Becker', 'Hoffmann', 'Koch', 'Richter', 'Wolf', 'Vogel', 'Krüger'],
  ru: ['Ivanov', 'Petrov', 'Sokolov', 'Volkov', 'Kuznetsov', 'Popov', 'Novikov', 'Morozov', 'Lebedev', 'Kozlov', 'Orlov', 'Belov'],
  tr: ['Yilmaz', 'Kaya', 'Demir', 'Çelik', 'Şahin', 'Yildiz', 'Aydin', 'Öztürk', 'Arslan', 'Doğan', 'Kilic', 'Aslan'],
  ja: ['Sato', 'Suzuki', 'Takahashi', 'Tanaka', 'Watanabe', 'Ito', 'Yamamoto', 'Nakamura', 'Kobayashi', 'Kato', 'Yoshida', 'Yamada'],
  zh: ['Wang', 'Li', 'Zhang', 'Liu', 'Chen', 'Yang', 'Huang', 'Zhao', 'Wu', 'Zhou', 'Xu', 'Sun'],
  fa: ['Hosseini', 'Ahmadi', 'Karimi', 'Rahimi', 'Moradi', 'Rezaei', 'Jafari', 'Mousavi', 'Sadeghi', 'Nazari', 'Kazemi', 'Ebrahimi'],
};
const LANG: Record<string, string> = { britain: 'en', uk: 'en', usa: 'en', france: 'fr', germany: 'de', russia: 'ru', ussr: 'ru', ottoman: 'tr', japan: 'ja', china: 'zh', nato: 'en', regional: 'fa', minor: 'en' };

const NVG_SHADER = {
  uniforms: { tDiffuse: { value: null }, amount: { value: 0 }, time: { value: 0 } },
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
  fragmentShader: `uniform sampler2D tDiffuse; uniform float amount; uniform float time; varying vec2 vUv;
    float rand(vec2 co){ return fract(sin(dot(co.xy, vec2(12.9898,78.233)) + time) * 43758.5453); }
    void main(){ vec4 c = texture2D(tDiffuse, vUv); float l = dot(c.rgb, vec3(0.3,0.59,0.11)); l = pow(clamp(l * 2.4, 0.0, 1.0), 0.75) * 0.95;
      float n = rand(vUv) * 0.07; vec3 g = vec3(0.25, 1.0, 0.35) * (l * 0.9 + n + 0.03);
      float d = distance(vUv, vec2(0.5)); g *= smoothstep(0.75, 0.35, d);
      gl_FragColor = mix(c, vec4(g, 1.0), amount); }`,
};

interface SpawnStyle {
  uniform: number;
  accent: number;
  color: number;
}

export class BattleScene {
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly field: Battlefield;
  readonly effects: Effects;
  readonly world: BattleWorld;
  readonly input: Input;
  readonly hud: HUD;
  readonly support: Support;
  readonly commander: CommanderMode;
  readonly player: Player;
  readonly rng: RNG;
  private composer: EffectComposer;
  private nvgPass: ShaderPass;
  private bloomPass: UnrealBloomPass;
  private soldiers: Soldier[] = [];
  private squads: Squad[] = [];
  private tanks: Tank[] = [];
  private playerTank: Tank | null = null;
  private tankCam = { yaw: 0, pitch: 0.2 };
  private time = 0;
  private tickets: Record<Team, number>;
  private ticketsStart: Record<Team, number>;
  private bleedTimer = 0;
  private waveTimer = 5;
  private respawnTimer = 0;
  private dayTimer = 0;
  private hudTimer = 0;
  private ended = false;
  private paused = false;
  private mode: 'fps' | 'commander' | 'tank' = 'fps';
  private artillery: number;
  private air: number;
  private drones: number;
  private cooldowns = { artillery: 0, air: 0, drone: 0 };
  private enemySupportTimer = 45;
  private enemyGasTimer = 70;
  private enemyTankTimer = 0;
  private pointsHeldTime = 0;
  private squadSeq = 1;
  private styleFor: Record<Team, SpawnStyle>;
  private weaponsFor: Record<Team, { rifle: WeaponDef; lmg: WeaponDef; smg?: WeaponDef }>;
  private accuracyFor: Record<Team, number>;
  private pointerHint: HTMLElement;
  private sun: THREE.DirectionalLight;
  private ambient: THREE.AmbientLight;
  private hemi: THREE.HemisphereLight;
  private timeLimit = 12 * 60;
  private killLog = 0;
  private lastPlayerDeathReason = '';
  private reportShown = false;
  private frameHandle = 0;

  constructor(readonly renderer: THREE.WebGLRenderer, readonly uiRoot: HTMLElement, readonly setup: BattleSetup, readonly onEnd: (r: BattleResult) => void) {
    this.rng = new RNG(setup.seed);
    this.camera = new THREE.PerspectiveCamera(75, 1, 0.08, 900);
    this.field = new Battlefield(setup.theme, setup.terrain, setup.seed, setup.night, setup.playerIsAttacker);
    this.scene.add(this.field.group);
    this.effects = new Effects(this.scene);
    this.input = new Input(renderer.domElement);
    this.hud = new HUD(uiRoot, setup);
    this.tickets = { player: setup.playerTickets, enemy: setup.enemyTickets };
    this.ticketsStart = { player: setup.playerTickets, enemy: setup.enemyTickets };
    const roleBonusArt = setup.role === 'commander' ? 2 : 0;
    const roleBonusAir = setup.role === 'commander' ? 1 : 0;
    this.artillery = setup.supply.artillery + roleBonusArt;
    this.air = setup.supply.air + roleBonusAir;
    this.drones = setup.supply.drone ? 3 : 0;

    const pn = setup.playerNation;
    const en = setup.enemyNation;
    this.styleFor = {
      player: { uniform: UNIFORM_COLORS[pn.id] ?? 0x6f6b4b, accent: 0x4a90e2, color: pn.color },
      enemy: { uniform: UNIFORM_COLORS[en.id] ?? 0x7c7460, accent: 0xd94040, color: en.color },
    };
    const wp = (n: typeof pn) => ({ rifle: WEAPONS[n.weapons.rifle], lmg: WEAPONS[n.weapons.lmg], smg: n.weapons.smg ? WEAPONS[n.weapons.smg] : undefined });
    this.weaponsFor = { player: wp(pn), enemy: wp(en) };
    this.accuracyFor = {
      player: 0.32 + setup.supply.equipment * 0.25 + setup.supply.infantryBonus * 0.3,
      enemy: 0.3 + setup.enemySupply.equipment * 0.25 + setup.enemySupply.infantryBonus * 0.3,
    };

    // world facade
    const gasClouds: GasCloud[] = [];
    const self = this;
    this.world = {
      field: this.field,
      effects: this.effects,
      get time() {
        return self.time;
      },
      rng: this.rng,
      combatants: [],
      get player() {
        return self.player;
      },
      listenerPos: new THREE.Vector3(),
      listenerYaw: 0,
      gasClouds,
      revealed: false,
      enemyAccuracyMult: setup.supply.enemyAccuracy,
      friendlyAccuracyMult: 1,
      night: setup.night,
      onKill: (a, v) => this.handleKill(a, v),
    };

    // lighting & sky
    this.sun = new THREE.DirectionalLight(0xffffff, 1);
    this.ambient = new THREE.AmbientLight(0xffffff, 0.4);
    this.hemi = new THREE.HemisphereLight(0xbfd4ff, 0x4a3b2a, 0.5);
    this.setupLighting();
    this.scene.add(this.sun, this.sun.target, this.ambient, this.hemi);
    this.buildSky();

    // player
    const supply = setup.supply;
    const kitWeapons = this.playerWeapons();
    const cfg: PlayerConfig = {
      weapons: kitWeapons,
      jamChance: supply.jam,
      medkits: supply.medkits + (setup.kit === 'medic' ? 3 : 0),
      grenades: setup.kit === 'smg' ? 4 : 2,
      spreadMult: supply.spreadMult,
      kit: setup.kit,
      hasMask: setup.era.id === 'ww1',
      hasNVG: setup.era.id === 'modern',
      ammoMult: 0.35 + supply.ammo * 0.9,
    };
    this.player = new Player(this.world, this.camera, cfg, this.input, this.scene);
    this.player.onHit = (kill, head) => this.hud.showHitmarker(kill || head);
    this.player.onNotify = (m, s) => this.hud.showMessage(m, s ?? '', 2);
    if (setup.night && setup.era.id === 'modern') this.player.nvgOn = true;

    this.support = new Support(this.world, this.scene, setup.era.id);
    this.commander = new CommanderMode(this.scene, this.field, this.input, () => this.squads);
    this.commander.onArtillery = (p) => this.callArtillery(p);
    this.commander.onAir = (p) => this.callAir(p);
    this.commander.onOrder = (s, p) => {
      s.mode = 'attack';
      s.objective = p.clone();
      this.hud.showMessage('SQUAD ORDERED', `Squad ${s.id} moving to position`, 1.5);
    };

    // post-processing
    this.composer = new EffectComposer(renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloomPass = new UnrealBloomPass(new THREE.Vector2(1, 1), setup.night ? 0.55 : 0.28, 0.5, setup.night ? 0.6 : 0.9);
    this.composer.addPass(this.bloomPass);
    this.nvgPass = new ShaderPass(NVG_SHADER);
    this.composer.addPass(this.nvgPass);
    this.composer.addPass(new OutputPass());

    // HUD extras
    this.hud.buildMinimap((x, z) => this.field.heightAt(x, z), this.field.colliders, setup.theme);
    this.hud.onResume = () => this.resume();
    this.hud.onWithdraw = () => this.finish(false, true);
    this.pointerHint = document.createElement('div');
    this.pointerHint.className = 'pointer-hint';
    this.pointerHint.innerHTML = 'CLICK TO TAKE CONTROL<small>Esc pauses · Tab opens the command map</small>';
    this.pointerHint.addEventListener('click', () => this.input.requestLock());
    uiRoot.appendChild(this.pointerHint);

    // spawn forces
    this.spawnInitialForces();
    this.deployPlayer(true);
    if (setup.role === 'commander') this.enterCommander();
    this.hud.showMessage(setup.playerIsAttacker ? 'ASSAULT ON ' + setup.provinceName.toUpperCase() : 'DEFEND ' + setup.provinceName.toUpperCase(), setup.playerIsAttacker ? 'Take the objectives. Push forward.' : 'Hold the objectives. Do not yield.', 4.5);
    if (setup.era.id === 'ww1') setTimeout(() => audio.whistle(), 1500);
    audio.startAmbience(setup.theme === 'urban' ? 'city' : 'wind');
    this.resize();
  }

  // ---------------------------------------------------------------- setup helpers
  private setupLighting() {
    const s = this.setup;
    if (s.night) {
      this.sun.color.setHex(0x9db4e6);
      this.sun.intensity = 0.7;
      this.sun.position.set(-60, 120, 40);
      this.ambient.intensity = 0.22;
      this.hemi.intensity = 0.4;
      this.hemi.color.setHex(0x4a5f9a);
      this.renderer.toneMappingExposure = 1.05;
    } else if (s.theme === 'trench') {
      this.sun.color.setHex(0xd8d4c8);
      this.sun.intensity = 1.2;
      this.sun.position.set(40, 80, -60);
      this.ambient.intensity = 0.6;
      this.hemi.intensity = 0.7;
      this.hemi.color.setHex(0x9aa0a8);
      this.renderer.toneMappingExposure = 0.95;
    } else {
      this.sun.color.setHex(0xfff0d8);
      this.sun.intensity = 2.2;
      this.sun.position.set(80, 110, -50);
      this.ambient.intensity = 0.55;
      this.hemi.intensity = 0.85;
      this.renderer.toneMappingExposure = 1.0;
    }
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const cam = this.sun.shadow.camera;
    cam.left = -150;
    cam.right = 150;
    cam.top = 150;
    cam.bottom = -150;
    cam.near = 10;
    cam.far = 400;
    this.sun.shadow.bias = -0.0008;
    this.sun.shadow.normalBias = 0.05;
    this.sun.target.position.set(0, 0, 0);
    const density = this.setup.theme === 'trench' ? 0.011 : this.setup.theme === 'urban' ? (this.setup.night ? 0.009 : 0.005) : 0.0055;
    this.scene.fog = new THREE.FogExp2(this.field.fogColor.getHex(), density);
  }

  private buildSky() {
    const night = this.setup.night;
    const top = new THREE.Color(night ? 0x05070f : this.setup.theme === 'trench' ? 0x6f7a86 : 0x3d78c8);
    const horizon = this.field.fogColor.clone();
    const sky = new THREE.Mesh(
      new THREE.SphereGeometry(800, 32, 16),
      new THREE.ShaderMaterial({
        uniforms: { top: { value: top }, horizon: { value: horizon }, sunDir: { value: this.sun.position.clone().normalize() }, night: { value: night ? 1 : 0 } },
        vertexShader: `varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
        fragmentShader: `uniform vec3 top; uniform vec3 horizon; uniform vec3 sunDir; uniform float night; varying vec3 vDir;
          float hash(vec3 p){ return fract(sin(dot(p, vec3(12.9898,78.233,45.164))) * 43758.5453); }
          void main(){ float h = clamp(vDir.y, 0.0, 1.0); vec3 c = mix(horizon, top, pow(h, 0.55));
            float s = max(0.0, dot(vDir, sunDir)); c += (night > 0.5 ? vec3(0.4,0.45,0.6) : vec3(1.0,0.85,0.6)) * pow(s, night > 0.5 ? 400.0 : 180.0) * (night > 0.5 ? 0.8 : 1.2);
            c += vec3(1.0,0.9,0.7) * pow(s, 8.0) * (night > 0.5 ? 0.02 : 0.12);
            if (night > 0.5) { vec3 g = floor(vDir * 180.0); float st = step(0.997, hash(g)); c += vec3(st) * h * 0.8; }
            gl_FragColor = vec4(c, 1.0); }`,
        side: THREE.BackSide,
        depthWrite: false,
        fog: false,
      }),
    );
    this.scene.add(sky);
  }

  private playerWeapons(): WeaponDef[] {
    const n = this.setup.playerNation;
    const w = n.weapons;
    const pistol = WEAPONS[w.pistol];
    switch (this.setup.kit) {
      case 'mg':
        return [WEAPONS[w.lmg], pistol];
      case 'smg':
        return [WEAPONS[w.smg ?? 'mp18'], pistol];
      case 'marksman':
        return [WEAPONS[w.dmr ?? w.rifle], pistol];
      case 'medic':
        return [WEAPONS[w.rifle], pistol];
      case 'tank':
        return [WEAPONS[w.smg ?? w.rifle], pistol];
      default:
        return [WEAPONS[w.rifle], pistol];
    }
  }

  private soldierName(team: Team): string {
    const n = team === 'player' ? this.setup.playerNation : this.setup.enemyNation;
    const list = SURNAMES[LANG[n.id] ?? 'en'];
    const rank = this.rng.pick(['Pvt.', 'Pvt.', 'Pvt.', 'Cpl.', 'Sgt.']);
    return `${rank} ${this.rng.pick(list)}`;
  }

  private spawnSquad(team: Team, size: number, where: THREE.Vector3, isPlayerSquad = false): Squad {
    const sq = new Squad(team, this.squadSeq++, isPlayerSquad);
    const st = this.styleFor[team];
    const wp = this.weaponsFor[team];
    const hasMask = team === 'player' ? this.setup.supply.gas || this.setup.era.id !== 'ww1' : this.setup.enemySupply.gas || this.setup.era.id !== 'ww1';
    for (let i = 0; i < size; i++) {
      const weapon = i === 1 ? wp.lmg : i === 2 && wp.smg ? wp.smg : wp.rifle;
      const pos = where.clone().add(new THREE.Vector3((this.rng.next() - 0.5) * 14, 0, (this.rng.next() - 0.5) * 8));
      const s = new Soldier(this.world, team, pos, weapon, this.accuracyFor[team] * this.rng.range(0.85, 1.15), { uniform: st.uniform, era: this.setup.era.id, team, accent: st.accent }, hasMask, this.soldierName(team));
      s.squad = sq;
      sq.members.push(s);
      this.soldiers.push(s);
      this.scene.add(s.group);
    }
    this.squads.push(sq);
    return sq;
  }

  private spawnPoint(team: Team): THREE.Vector3 {
    const attackerIsPlayer = this.setup.playerIsAttacker;
    const base = (team === 'player') === attackerIsPlayer ? this.field.attackerSpawn : this.field.defenderSpawn;
    // forward spawn at the friendliest held point closest to base
    const held = this.field.capturePoints.filter((p) => p.owner === team && Math.abs(p.progress) >= 1);
    if (held.length && this.rng.next() < 0.6) {
      const p = this.rng.pick(held);
      return p.pos.clone().add(new THREE.Vector3((this.rng.next() - 0.5) * 16, 0, (base.z > 0 ? 8 : -8)));
    }
    return base.clone().add(new THREE.Vector3((this.rng.next() - 0.5) * 60, 0, 0));
  }

  private spawnTank(team: Team) {
    const n = team === 'player' ? this.setup.playerNation : this.setup.enemyNation;
    const armor = team === 'player' ? 1 + (this.setup.supply.tank ? 0.3 : 0) : 1;
    const pos = this.spawnPoint(team);
    pos.x = clamp(pos.x, -60, 60);
    // find open ground: no colliders within 6 m
    for (let k = 0; k < 30; k++) {
      const cand = pos.clone().add(new THREE.Vector3((this.rng.next() - 0.5) * 50 * (k / 10 + 1), 0, (this.rng.next() - 0.5) * 30));
      cand.x = clamp(cand.x, -HALF + 10, HALF - 10);
      cand.z = clamp(cand.z, -HALF + 10, HALF - 10);
      const y = this.field.heightAt(cand.x, cand.z);
      if (!this.field.insideCollider(cand.x, y + 1, cand.z, 6)) {
        pos.copy(cand);
        break;
      }
    }
    const t = new Tank(this.world, team, pos, this.styleFor[team].uniform, armor, n.tankName, this.support);
    t.yaw = team === 'player' ? (this.setup.playerIsAttacker ? Math.PI : 0) : this.setup.playerIsAttacker ? 0 : Math.PI;
    t.turretYaw = t.yaw;
    this.tanks.push(t);
    this.scene.add(t.group);
    return t;
  }

  private spawnInitialForces() {
    const pSpawn = this.setup.playerIsAttacker ? this.field.attackerSpawn : this.field.defenderSpawn;
    const eSpawn = this.setup.playerIsAttacker ? this.field.defenderSpawn : this.field.attackerSpawn;
    const pCount = clamp(Math.round(16 + this.setup.playerTickets / 12), 16, 30);
    const eCount = clamp(Math.round(16 + this.setup.enemyTickets / 12), 16, 30);
    const make = (team: Team, count: number, base: THREE.Vector3) => {
      let left = count;
      let k = 0;
      while (left > 0) {
        const size = Math.min(6, left);
        const where = base.clone().add(new THREE.Vector3(-60 + k * 30, 0, 0));
        this.spawnSquad(team, size, where);
        left -= size;
        k++;
      }
    };
    // Defenders start spread onto their points
    make('player', pCount, pSpawn);
    make('enemy', eCount, eSpawn);
    const defTeam: Team = this.setup.playerIsAttacker ? 'enemy' : 'player';
    for (const sq of this.squads) {
      if (sq.team !== defTeam) continue;
      const pts = this.field.capturePoints.filter((p) => p.owner === defTeam);
      const pt = pts.length ? this.rng.pick(pts) : null;
      if (pt) for (const m of sq.members) {
        m.pos.set(pt.pos.x + (this.rng.next() - 0.5) * 24, 0, pt.pos.z + (this.rng.next() - 0.5) * 16);
        m.pos.y = this.field.heightAt(m.pos.x, m.pos.z);
      }
    }
    if (this.setup.role === 'squadleader') {
      const sq = this.spawnSquad('player', 5, pSpawn.clone(), true);
      sq.mode = 'follow';
      sq.leader = this.player;
    }
    if (this.setup.enemySupply.tank) this.spawnTank('enemy');
    if (this.setup.supply.tank && this.setup.kit !== 'tank') this.spawnTank('player');
  }

  private deployPlayer(initial = false) {
    const pos = this.spawnPoint('player');
    const yaw = this.setup.playerIsAttacker ? Math.PI : 0;
    if (this.setup.kit === 'tank' && (initial || this.rng.next() < 0.5) && this.tickets.player > 8) {
      const t = this.spawnTank('player');
      t.playerControlled = true;
      t.isPlayer = true;
      this.playerTank = t;
      this.player.spawn(pos, yaw);
      this.player.controlEnabled = false;
      this.mode = 'tank';
      this.tankCam.yaw = t.yaw;
      this.hud.setMode('tank');
      this.hud.showMessage(this.setup.playerNation.tankName.toUpperCase(), 'W/S drive · A/D steer · LMB main gun · RMB coaxial MG', 4);
    } else {
      this.player.spawn(pos, yaw);
      this.player.controlEnabled = true;
      if (this.mode === 'tank') {
        this.mode = 'fps';
        this.hud.setMode('fps');
      }
    }
    this.player.alive = true;
  }

  // ---------------------------------------------------------------- support
  private callArtillery(p: THREE.Vector3): boolean {
    if (this.artillery <= 0 || this.cooldowns.artillery > 0) {
      this.hud.showMessage('ARTILLERY UNAVAILABLE', this.artillery <= 0 ? 'No shells allocated — check munitions production' : 'Battery reloading', 2);
      return false;
    }
    this.artillery--;
    this.cooldowns.artillery = 22;
    this.support.artilleryStrike(p, 'player', this.player, 6);
    this.hud.showMessage('FIRE MISSION', 'Shells inbound — clear the area', 2.5);
    return true;
  }
  private callAir(p: THREE.Vector3): boolean {
    if (this.air <= 0 || this.cooldowns.air > 0) {
      this.hud.showMessage('AIR SUPPORT UNAVAILABLE', this.air <= 0 ? 'No aircraft on station — research air doctrine and keep oil flowing' : 'Aircraft rearming', 2);
      return false;
    }
    this.air--;
    this.cooldowns.air = 35;
    const mode = this.setup.era.id === 'modern' ? 'drone' : this.setup.era.id === 'ww2' ? 'bomb' : 'strafe';
    this.support.airStrike(p, 'player', this.player, mode, this.styleFor.player.uniform);
    this.hud.showMessage(mode === 'drone' ? 'LOITERING MUNITION' : 'AIR SUPPORT', `${this.setup.playerNation.planeName} inbound`, 2.5);
    return true;
  }
  private callDrone(): boolean {
    if (this.drones <= 0 || this.cooldowns.drone > 0) return false;
    this.drones--;
    this.cooldowns.drone = 28;
    this.support.reconDrone(15);
    this.hud.showMessage('RECON DRONE', 'Enemy positions revealed', 2);
    return true;
  }

  private enemySupportTick(dt: number) {
    this.enemySupportTimer -= dt;
    if (this.enemySupportTimer <= 0 && this.setup.enemySupply.artillery > 0) {
      this.enemySupportTimer = 50 + this.rng.range(0, 40);
      // target: densest cluster of player team
      const cands = this.world.combatants.filter((c) => c.alive && c.team === 'player');
      if (cands.length) {
        const t = this.rng.pick(cands).pos.clone();
        this.support.artilleryStrike(t, 'enemy', null, 5);
        this.hud.showMessage('INCOMING ARTILLERY', 'Take cover!', 2);
      }
    }
    if (this.setup.era.id === 'ww1' && this.setup.enemySupply.gas) {
      this.enemyGasTimer -= dt;
      if (this.enemyGasTimer <= 0) {
        this.enemyGasTimer = 90 + this.rng.range(0, 40);
        const cands = this.world.combatants.filter((c) => c.alive && c.team === 'player');
        if (cands.length) {
          const t = this.rng.pick(cands).pos.clone();
          this.support.artilleryStrike(t, 'enemy', null, 3, true);
          this.hud.showMessage('GAS! GAS! GAS!', 'Press G to put on your mask', 3);
        }
      }
    }
  }

  // ---------------------------------------------------------------- kills / tickets
  private handleKill(attacker: Combatant | null, victim: Combatant) {
    const cost = victim.isVehicle ? 6 : 1;
    this.tickets[victim.team] -= cost;
    const name = (c: Combatant | null) => (!c ? 'Artillery' : c.isPlayer ? 'You' : c instanceof Soldier ? c.name : c instanceof Tank ? c.name : '?');
    const vName = victim.isPlayer && !victim.isVehicle ? 'You' : name(victim);
    const aName = name(attacker);
    const cls = attacker?.isPlayer ? 'me' : '';
    if (victim.isPlayer || attacker?.isPlayer || this.rng.next() < 0.5) this.hud.addKill(`${aName} ✕ ${vName}`, cls);
    if (victim.isPlayer && !victim.isVehicle) {
      this.lastPlayerDeathReason = attacker ? `Killed by ${aName}` : 'Killed by artillery';
      this.respawnTimer = 5;
      this.input.releaseLock();
    }
    if (victim === this.playerTank) {
      this.playerTank = null;
      this.player.controlEnabled = true;
      this.mode = 'fps';
      this.hud.setMode('fps');
      this.hud.showMessage('ARMOUR LOST', 'Bailing out — continue on foot', 3);
      this.player.spawn(victim.pos.clone().add(new THREE.Vector3(3, 0, 3)), this.tankCam.yaw);
    }
  }

  private updateCapture(dt: number) {
    const counts = { player: 0, enemy: 0 };
    for (const p of this.field.capturePoints) {
      counts.player = 0;
      counts.enemy = 0;
      for (const c of this.world.combatants) {
        if (!c.alive) continue;
        const dx = c.pos.x - p.pos.x;
        const dz = c.pos.z - p.pos.z;
        if (dx * dx + dz * dz < p.radius * p.radius) counts[c.team] += c.isVehicle ? 2 : 1;
      }
      const prev = p.owner;
      const prevProg = p.progress;
      if (counts.player > 0 && counts.enemy === 0) p.progress = Math.min(1, p.progress + dt * 0.11 * Math.min(4, counts.player));
      else if (counts.enemy > 0 && counts.player === 0) p.progress = Math.max(-1, p.progress - dt * 0.11 * Math.min(4, counts.enemy));
      if (p.progress >= 1) p.owner = 'player';
      else if (p.progress <= -1) p.owner = 'enemy';
      else if ((prevProg > 0 && p.progress <= 0) || (prevProg < 0 && p.progress >= 0)) p.owner = null;
      if (p.owner !== prev) {
        const ringMat = p.ring.material as THREE.MeshBasicMaterial;
        const flagMat = p.flag.material as THREE.MeshStandardMaterial;
        const col = p.owner === 'player' ? 0x4a90e2 : p.owner === 'enemy' ? 0xd94040 : 0xcccccc;
        ringMat.color.setHex(col);
        flagMat.color.setHex(col);
        flagMat.emissive.setHex(col);
        p.light.color.setHex(col);
        p.light.intensity = p.owner ? 8 : 0;
        if (p.owner === 'player') {
          this.hud.showMessage(`OBJECTIVE ${p.id} CAPTURED`, '', 2.5);
          audio.capture(true);
        } else if (p.owner === 'enemy') {
          this.hud.showMessage(`OBJECTIVE ${p.id} LOST`, '', 2.5);
          audio.capture(false);
        }
      }
      p.flag.rotation.y = Math.sin(this.time * 3 + p.pos.x) * 0.25;
    }
    // bleed
    const held = { player: 0, enemy: 0 };
    for (const p of this.field.capturePoints) if (p.owner) held[p.owner]++;
    if (held.player >= 2) this.pointsHeldTime += dt;
    this.bleedTimer += dt;
    if (this.bleedTimer >= 3) {
      this.bleedTimer = 0;
      if (held.player > held.enemy) this.tickets.enemy -= held.player === 3 ? 2 : 1;
      else if (held.enemy > held.player) this.tickets.player -= held.enemy === 3 ? 2 : 1;
    }
  }

  private updateWaves(dt: number) {
    this.waveTimer -= dt;
    if (this.waveTimer > 0) return;
    this.waveTimer = 11;
    for (const team of ['player', 'enemy'] as Team[]) {
      const alive = this.soldiers.filter((s) => s.alive && s.team === team).length;
      const max = 26;
      if (alive >= max || this.tickets[team] <= 2) continue;
      const size = Math.min(6, max - alive);
      const sq = this.spawnSquad(team, size, this.spawnPoint(team));
      if (team === 'player' && this.commander.active) sq.mode = 'auto';
    }
    // enemy tank respawn
    if (this.setup.enemySupply.tank && !this.tanks.some((t) => t.alive && t.team === 'enemy')) {
      this.enemyTankTimer += 11;
      if (this.enemyTankTimer >= 90 && this.tickets.enemy > 15) {
        this.enemyTankTimer = 0;
        this.spawnTank('enemy');
        this.hud.showMessage('ENEMY ARMOUR', `${this.setup.enemyNation.tankName} spotted`, 2.5);
      }
    }
    // cleanup old bodies
    let dead = this.soldiers.filter((s) => !s.alive);
    if (dead.length > 40) {
      dead = dead.slice(0, dead.length - 40);
      for (const s of dead) {
        this.scene.remove(s.group);
        this.soldiers.splice(this.soldiers.indexOf(s), 1);
      }
    }
  }

  /** Strategic reinforcements arriving mid-battle. */
  reinforce(side: 'player' | 'enemy', men: number, armyName: string) {
    const tickets = Math.round(men / 400);
    this.tickets[side] += tickets;
    const sq = this.spawnSquad(side, 6, this.spawnPoint(side));
    if (side === 'player') {
      this.hud.showMessage('REINFORCEMENTS ARRIVED', `${armyName} joins the battle — +${tickets} tickets`, 4);
      audio.capture(true);
      sq.mode = 'auto';
    } else this.hud.showMessage('ENEMY REINFORCEMENTS', `${armyName} has arrived — +${tickets} enemy tickets`, 4);
  }

  // ---------------------------------------------------------------- modes
  private enterCommander() {
    this.mode = 'commander';
    this.commander.enter();
    this.player.controlEnabled = false;
    this.hud.setMode('commander');
    this.hud.setMinimapVisible(false);
    this.commander.resize(this.aspect());
  }
  private exitCommander() {
    this.commander.exit();
    if (this.playerTank && this.playerTank.alive) {
      this.mode = 'tank';
      this.hud.setMode('tank');
    } else {
      this.mode = 'fps';
      this.player.controlEnabled = true;
      this.hud.setMode('fps');
    }
    this.hud.setMinimapVisible(true);
    this.input.requestLock();
  }
  private pause() {
    if (this.ended) return;
    this.paused = true;
    this.hud.showPause(true);
    this.input.releaseLock();
  }
  private resume() {
    this.paused = false;
    this.hud.showPause(false);
    if (this.mode !== 'commander') this.input.requestLock();
  }

  private aspect() {
    return this.renderer.domElement.clientWidth / Math.max(1, this.renderer.domElement.clientHeight);
  }

  resize() {
    const w = this.renderer.domElement.clientWidth;
    const h = this.renderer.domElement.clientHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.composer.setSize(w, h);
    this.commander.resize(w / h);
  }

  // ---------------------------------------------------------------- main loop
  update(dt: number) {
    dt = Math.min(dt, 0.05);
    const input = this.input;
    if (this.ended) {
      this.effects.update(dt);
      this.render();
      input.endFrame();
      return;
    }
    if (input.pressed('Escape')) {
      if (this.commander.active && this.commander.pendingAction) this.commander.pendingAction = null;
      else if (this.paused) this.resume();
      else this.pause();
    }
    // pointer lock lost -> pause (only in FPS/tank mode)
    if (!this.paused && this.mode !== 'commander' && !input.locked && this.player.alive && this.time > 1) {
      this.pointerHint.style.display = '';
    } else this.pointerHint.style.display = 'none';
    if (this.paused) {
      this.hud.update(dt);
      this.render();
      input.endFrame();
      return;
    }
    if (input.pressed('Tab')) {
      if (this.commander.active) this.exitCommander();
      else this.enterCommander();
    }
    this.time += dt;
    this.dayTimer += dt;
    if (this.dayTimer >= 30) {
      this.dayTimer = 0;
      this.setup.onDay?.();
    }
    for (const k of Object.keys(this.cooldowns) as (keyof typeof this.cooldowns)[]) this.cooldowns[k] = Math.max(0, this.cooldowns[k] - dt);

    // combatants list
    const list: Combatant[] = [];
    for (const s of this.soldiers) if (s.alive) list.push(s);
    for (const t of this.tanks) if (t.alive) list.push(t);
    if (this.player.alive && this.mode !== 'tank') list.push(this.player);
    this.world.combatants = list;

    // player / tank / commander
    const now = this.time;
    if (this.mode === 'commander') {
      this.commander.update(dt, this.aspect());
      this.player.update(dt, now);
    } else if (this.mode === 'tank' && this.playerTank) {
      this.player.viewRoot.visible = false;
      this.playerTank.controlUpdate(dt, input, this.camera, this.tankCam);
      this.player.pos.copy(this.playerTank.pos);
      if (input.mousePressed(0) && !input.locked) input.requestLock();
    } else {
      if (input.mousePressed(0) && !input.locked && this.player.alive) input.requestLock();
      this.player.update(dt, now);
    }
    if (this.mode === 'commander') this.player.viewRoot.visible = false;
    // support keys
    if (this.mode !== 'commander' && this.player.alive) {
      if (input.pressed('Digit5')) this.callArtillery(this.player.aimPoint(320));
      if (input.pressed('Digit6')) this.callAir(this.player.aimPoint(320));
      if (input.pressed('Digit7')) this.callDrone();
      if (input.pressed('KeyM')) this.hud.setMinimapVisible(this.hud.root.querySelector('.hud-minimap')!.getAttribute('style')?.includes('none') ?? false);
      // squad leader orders
      const mySquad = this.squads.find((s) => s.isPlayerSquad);
      if (mySquad) {
        if (input.pressed('KeyQ')) {
          if (mySquad.mode === 'follow') {
            mySquad.mode = 'hold';
            mySquad.objective = mySquad.center();
            this.hud.showMessage('SQUAD: HOLD POSITION', '', 1.5);
          } else {
            mySquad.mode = 'follow';
            this.hud.showMessage('SQUAD: FOLLOW ME', '', 1.5);
          }
        }
        if (input.pressed('KeyE')) {
          mySquad.mode = 'attack';
          mySquad.objective = this.player.aimPoint(200);
          this.hud.showMessage('SQUAD: ATTACK', 'Moving to marked position', 1.5);
        }
      }
    }
    // listener
    this.camera.getWorldPosition(this.world.listenerPos);
    this.world.listenerYaw = this.mode === 'tank' ? this.tankCam.yaw : this.player.yaw;
    // thermal: aiming with thermal optics reveals
    if (this.setup.supply.thermal && this.player.ads && this.setup.night) this.support.revealUntil = Math.max(this.support.revealUntil, this.time + 0.2);

    // AI
    const pts = this.field.capturePoints;
    for (const s of this.soldiers) s.update(dt, pts);
    for (const t of this.tanks) t.update(dt, pts);
    this.support.update(dt);
    this.enemySupportTick(dt);
    this.updateCapture(dt);
    this.updateWaves(dt);
    this.effects.update(dt);

    // player respawn
    if (!this.player.alive && this.mode !== 'tank') {
      this.respawnTimer -= dt;
      this.hud.showDead(this.respawnTimer, this.lastPlayerDeathReason);
      if (this.respawnTimer <= 0) {
        if (this.tickets.player > 0) {
          this.deployPlayer();
          this.hud.showDead(0, '');
          if (this.mode === 'fps') input.requestLock();
        }
      }
    } else this.hud.showDead(0, '');
    // medic passive heal
    if (this.setup.kit === 'medic' && this.player.alive) {
      for (const s of this.soldiers) if (s.alive && s.team === 'player' && s.hp < 100 && s.pos.distanceTo(this.player.pos) < 4) s.hp = Math.min(100, s.hp + dt * 10);
    }
    // end conditions
    if (this.tickets.player <= 0 || this.tickets.enemy <= 0 || this.time >= this.timeLimit) {
      const won = this.tickets.enemy <= 0 ? true : this.tickets.player <= 0 ? false : this.tickets.player > this.tickets.enemy;
      this.finish(won, false);
    }
    this.updateHud(dt);
    this.render();
    input.endFrame();
  }

  private updateHud(dt: number) {
    this.hud.update(dt);
    this.hudTimer -= dt;
    const p = this.player;
    this.hud.setCompass(this.mode === 'tank' ? this.tankCam.yaw : p.yaw);
    if (this.mode === 'tank' && this.playerTank) this.hud.setTankStats(this.playerTank.hp, this.playerTank.maxHp, this.playerTank.shells, this.playerTank.reloading);
    else {
      this.hud.setHealth(p.hp, p.maxHp);
      const w = p.weaponHudState();
      this.hud.setAmmo(w.mag, w.reserve, w.name, w.state);
      this.hud.setCrosshairSpread(p.crosshairSpread());
    }
    this.hud.setNVG(p.nvgOn && this.mode !== 'commander');
    this.hud.setGas(p.maskOn && this.mode === 'fps');
    this.hud.setScope(this.mode === 'fps' && p.ads && !!p.weapon.def.scoped && p.adsAmount > 0.9);
    this.nvgPass.uniforms.amount.value = p.nvgOn && this.mode !== 'commander' ? 1 : 0;
    this.nvgPass.uniforms.time.value = this.time;
    this.nvgPass.enabled = this.nvgPass.uniforms.amount.value > 0;
    this.ambient.intensity = this.setup.night ? (p.nvgOn ? 0.6 : 0.22) : this.ambient.intensity;
    this.hud.setReveal(this.world.revealed);
    if (this.hudTimer <= 0) {
      this.hudTimer = 0.12;
      this.hud.setObjectives(this.field.capturePoints);
      this.hud.setTickets(this.tickets.player, this.tickets.enemy, this.setup.playerNation.name, this.setup.enemyNation.name);
      this.hud.setTimer(this.timeLimit - this.time);
      this.hud.setConsumables(p.medkits, p.grenades);
      const slots = [
        { key: '5', name: 'Artillery', count: this.artillery, ready: this.cooldowns.artillery <= 0, cooldown: this.cooldowns.artillery },
        { key: '6', name: this.setup.era.id === 'modern' ? 'Loitering munition' : 'Air support', count: this.air, ready: this.cooldowns.air <= 0, cooldown: this.cooldowns.air },
      ];
      if (this.setup.era.id === 'modern') slots.push({ key: '7', name: 'Recon drone', count: this.drones, ready: this.cooldowns.drone <= 0, cooldown: this.cooldowns.drone });
      this.hud.setSupport(slots);
      const mySquad = this.squads.find((s) => s.isPlayerSquad);
      if (mySquad) this.hud.setSquad(mySquad.mode === 'follow' ? 'Following you' : mySquad.mode === 'hold' ? 'Holding position' : 'Attacking marked position', mySquad.alive.length, mySquad.members.length);
      else if (this.setup.role === 'commander') this.hud.setSquad(`${this.squads.filter((s) => s.team === 'player' && s.alive.length).length} squads under command`, this.soldiers.filter((s) => s.alive && s.team === 'player').length, 0);
      const units: MinimapUnit[] = [];
      for (const s of this.soldiers) if (s.alive && (s.team === 'player' || this.world.revealed || s.pos.distanceTo(p.pos) < 45)) units.push({ x: s.pos.x, z: s.pos.z, team: s.team, isSquad: !!s.squad?.isPlayerSquad });
      for (const t of this.tanks) if (t.alive) units.push({ x: t.pos.x, z: t.pos.z, team: t.team, isVehicle: true });
      units.push({ x: p.pos.x, z: p.pos.z, team: 'player', isPlayer: true, yaw: this.mode === 'tank' ? this.tankCam.yaw : p.yaw });
      this.hud.drawMinimap(units, this.field.capturePoints, this.support.markers.map((m) => ({ x: m.x, z: m.z, kind: m.kind })));
      if (this.mode === 'commander') this.hud.setHint(this.commander.pendingAction === 'artillery' ? 'Click on the map to call artillery' : this.commander.pendingAction === 'air' ? 'Click on the map to call air support' : this.commander.selectedSquad ? `Squad ${this.commander.selectedSquad.id} selected — right-click to order` : '');
      else this.hud.setHint('');
    }
  }

  private render() {
    if (this.mode === 'commander') {
      this.commander.setVisible(true);
      const fog = this.scene.fog;
      this.scene.fog = null;
      const amb = this.ambient.intensity;
      this.ambient.intensity = Math.max(amb, 0.6);
      this.renderer.render(this.scene, this.commander.camera);
      this.ambient.intensity = amb;
      this.scene.fog = fog;
    } else {
      this.commander.setVisible(false);
      this.composer.render();
    }
  }

  private finish(won: boolean, withdrew: boolean) {
    if (this.ended) return;
    this.ended = true;
    this.input.releaseLock();
    this.hud.showPause(false);
    this.pointerHint.style.display = 'none';
    audio.stopAmbience();
    const result: BattleResult = {
      won,
      withdrew,
      playerTicketsStart: this.ticketsStart.player,
      playerTicketsLeft: this.tickets.player,
      enemyTicketsStart: this.ticketsStart.enemy,
      enemyTicketsLeft: this.tickets.enemy,
      kills: this.player.kills,
      deaths: this.player.deaths,
      duration: this.time,
      pointsHeld: this.field.capturePoints.filter((p) => p.owner === 'player').length,
    };
    if (!this.reportShown) {
      this.reportShown = true;
      this.hud.showReport(result, this.uiRoot, () => this.onEnd(result));
    }
  }

  dispose() {
    cancelAnimationFrame(this.frameHandle);
    this.input.dispose();
    this.hud.dispose();
    this.pointerHint.remove();
    this.player.dispose();
    this.support.dispose();
    this.commander.dispose();
    this.effects.dispose();
    this.composer.dispose();
    audio.stopAmbience();
    this.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.geometry) m.geometry.dispose();
      const mat = m.material as THREE.Material | THREE.Material[] | undefined;
      if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
      else if (mat && !(o as THREE.Sprite).isSprite) mat.dispose();
    });
    this.renderer.toneMappingExposure = 1;
  }
}
