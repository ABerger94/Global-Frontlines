import * as THREE from 'three';
import { RNG, hashString } from '../core/rng';
import { Noise3D } from '../core/noise';
import { latLonToVec3, vec3ToLatLon, angularDistance } from '../core/math';
import type { EraDef, NationDef } from '../data/types';

export type Terrain = 'plains' | 'forest' | 'hills' | 'mountain' | 'desert' | 'urban' | 'sea' | 'ice';

export const TERRAIN_INFO: Record<Terrain, { name: string; defense: number; moveMult: number; color: number }> = {
  plains: { name: 'Plains', defense: 1.0, moveMult: 1.0, color: 0x8faa5a },
  forest: { name: 'Forest', defense: 1.2, moveMult: 1.2, color: 0x4f7d3f },
  hills: { name: 'Hills', defense: 1.35, moveMult: 1.3, color: 0x9a8f5c },
  mountain: { name: 'Mountains', defense: 1.7, moveMult: 1.7, color: 0x8d8a85 },
  desert: { name: 'Desert', defense: 0.95, moveMult: 1.1, color: 0xd6c184 },
  urban: { name: 'Urban', defense: 1.5, moveMult: 1.0, color: 0x9c9c9c },
  sea: { name: 'Sea', defense: 1.0, moveMult: 2.0, color: 0x1d3f6e },
  ice: { name: 'Ice', defense: 1.0, moveMult: 2.5, color: 0xdfe8f0 },
};

export interface Province {
  id: number;
  name: string;
  pos: THREE.Vector3;
  lat: number;
  lon: number;
  terrain: Terrain;
  isLand: boolean;
  owner: string | null; // nation id, 'minor', or null for sea/ice
  originalOwner: string | null;
  population: number; // thousands
  factories: number;
  oil: number;
  fort: number;
  garrison: number; // men
  neighbors: number[];
  capitalOf: string | null;
  cityName?: string;
}

export interface World {
  provinces: Province[];
  /** Province index per pixel of an equirectangular map. */
  indexMap: Uint16Array;
  W: number;
  H: number;
  seed: number;
  noise: Noise3D;
}

const NATION_NAMES: Record<string, string[]> = {
  britain: ['Wessex', 'Mercia', 'Northumbria', 'Kent', 'Cornwall', 'Yorkshire', 'Lothian', 'Ulster', 'Anglia', 'Cumbria', 'Gwynedd', 'Highlands'],
  uk: ['Wessex', 'Mercia', 'Northumbria', 'Kent', 'Cornwall', 'Yorkshire', 'Lothian', 'Ulster', 'Anglia', 'Cumbria', 'Gwynedd', 'Highlands'],
  nato: ['Flanders', 'Wallonia', 'Holland', 'Rhineland', 'Bavaria', 'Lorraine', 'Normandy', 'Provence', 'Lombardy', 'Tuscany', 'Silesia', 'Bohemia', 'Jutland', 'Catalonia'],
  france: ['Normandy', 'Picardy', 'Champagne', 'Burgundy', 'Provence', 'Aquitaine', 'Brittany', 'Lorraine', 'Languedoc', 'Auvergne', 'Alsace', 'Gascony'],
  germany: ['Prussia', 'Bavaria', 'Saxony', 'Westphalia', 'Silesia', 'Rhineland', 'Hanover', 'Pomerania', 'Swabia', 'Hesse', 'Brandenburg', 'Thuringia'],
  russia: ['Novgorod', 'Smolensk', 'Kazan', 'Ryazan', 'Voronezh', 'Perm', 'Ural', 'Kuban', 'Volga', 'Karelia', 'Tver', 'Siberia', 'Tomsk', 'Omsk', 'Irkutsk', 'Amur', 'Kolyma', 'Yakutia', 'Don', 'Vologda'],
  ussr: ['Leningrad', 'Smolensk', 'Kazan', 'Kursk', 'Voronezh', 'Perm', 'Ural', 'Kuban', 'Stalingrad', 'Karelia', 'Kalinin', 'Novosibirsk', 'Tomsk', 'Omsk', 'Irkutsk', 'Amur', 'Kolyma', 'Yakutia', 'Rostov', 'Vologda'],
  ottoman: ['Anatolia', 'Thrace', 'Cilicia', 'Trebizond', 'Kurdistan', 'Syria', 'Mesopotamia', 'Hejaz', 'Palestine', 'Pontus', 'Armenia', 'Aleppo'],
  regional: ['Persia', 'Khorasan', 'Fars', 'Kurdistan', 'Mesopotamia', 'Hejaz', 'Levant', 'Sindh', 'Punjab', 'Baluchistan', 'Azerbaijan', 'Oman'],
  usa: ['New England', 'Virginia', 'Carolina', 'Georgia', 'Ohio', 'Michigan', 'Illinois', 'Texas', 'Colorado', 'Dakota', 'Oregon', 'California', 'Nevada', 'Florida', 'Missouri', 'Montana'],
  japan: ['Kanto', 'Kansai', 'Tohoku', 'Kyushu', 'Hokkaido', 'Chugoku', 'Shikoku', 'Chubu', 'Ryukyu', 'Korea', 'Manchuria', 'Formosa'],
  china: ['Hebei', 'Shandong', 'Henan', 'Jiangsu', 'Sichuan', 'Guangdong', 'Hunan', 'Hubei', 'Shaanxi', 'Yunnan', 'Manchuria', 'Xinjiang', 'Tibet', 'Fujian', 'Guangxi'],
};

const SYL_A = ['Kar', 'Vel', 'Mor', 'Tan', 'Bel', 'Sar', 'Dor', 'Lun', 'Ost', 'Nar', 'Ash', 'Kel', 'Tor', 'Vas', 'Mir', 'Al', 'Bar', 'Zan', 'Ela', 'Ori'];
const SYL_B = ['ia', 'land', 'mark', 'stan', 'ova', 'burg', 'heim', 'gard', 'esh', 'ara', 'ium', 'ona', 'ika', 'oria', 'wick', 'ria'];
const SEA_NAMES = ['Northern Sea', 'Western Ocean', 'Southern Ocean', 'Eastern Sea', 'Central Sea', 'Coastal Waters', 'Deep Ocean', 'Gulf', 'Strait', 'Bay'];

export function generateWorld(era: EraDef, seed: number): World {
  const rng = new RNG(seed);
  const noise = new Noise3D(seed ^ 0x9e3779b9);
  const terrainNoise = new Noise3D(seed ^ 0x51ed27);
  const dryNoise = new Noise3D(seed ^ 0x77123);

  const capitals = era.nations.map((n) => ({ n, v: latLonToVec3(n.capital.lat, n.capital.lon) }));

  // Land function: continents from fBm, boosted near capitals so major nations always sit on land.
  const landValue = (v: THREE.Vector3): number => {
    let boost = 0;
    for (const c of capitals) {
      const d = angularDistance(v, c.v);
      boost += Math.max(0, 1 - d / 0.3) * 0.55;
    }
    const n = noise.fbm(v.x * 1.5, v.y * 1.5, v.z * 1.5, 5, 2.1, 0.52);
    const n2 = noise.fbm(v.x * 4.5 + 3.1, v.y * 4.5, v.z * 4.5, 3, 2, 0.5) * 0.22;
    return n + n2 + boost;
  };

  // --- candidate points
  const pts: THREE.Vector3[] = [];
  const N = 560;
  const golden = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < N; i++) {
    const y = 1 - (i / (N - 1)) * 2;
    const r = Math.sqrt(1 - y * y);
    const th = golden * i;
    const v = new THREE.Vector3(Math.cos(th) * r, y, Math.sin(th) * r);
    v.add(new THREE.Vector3(rng.range(-0.05, 0.05), rng.range(-0.05, 0.05), rng.range(-0.05, 0.05))).normalize();
    pts.push(v);
  }
  // densify around capitals (Europe is crowded)
  for (const c of capitals) {
    for (let k = 0; k < 8; k++) {
      const ang = (k / 8) * Math.PI * 2 + rng.range(-0.3, 0.3);
      const rad = rng.range(0.07, 0.15);
      const tangent = new THREE.Vector3().crossVectors(c.v, new THREE.Vector3(0, 1, 0)).normalize();
      const bitangent = new THREE.Vector3().crossVectors(c.v, tangent).normalize();
      const v = c.v.clone().add(tangent.multiplyScalar(Math.cos(ang) * rad)).add(bitangent.multiplyScalar(Math.sin(ang) * rad)).normalize();
      pts.push(v);
    }
  }
  // Remove points too close to each other
  const kept: THREE.Vector3[] = [];
  for (const p of pts) {
    let ok = true;
    for (const q of kept) {
      if (angularDistance(p, q) < 0.055) {
        ok = false;
        break;
      }
    }
    if (ok) kept.push(p);
  }

  // Classify
  const provinces: Province[] = [];
  for (const v of kept) {
    const { lat, lon } = vec3ToLatLon(v);
    const lv = landValue(v);
    const ice = Math.abs(lat) > 76;
    const isLand = !ice && lv > 0.14;
    if (!isLand && !ice && rng.next() > 0.55) continue; // thin out sea provinces
    provinces.push({
      id: provinces.length,
      name: '',
      pos: v,
      lat,
      lon,
      terrain: ice ? 'ice' : isLand ? 'plains' : 'sea',
      isLand,
      owner: null,
      originalOwner: null,
      population: 0,
      factories: 0,
      oil: 0,
      fort: 0,
      garrison: 0,
      neighbors: [],
      capitalOf: null,
    });
  }

  // --- pixel index map (equirectangular)
  const W = 640;
  const H = 320;
  const indexMap = new Uint16Array(W * H);
  const px = new Float32Array(provinces.length * 3);
  provinces.forEach((p, i) => {
    px[i * 3] = p.pos.x;
    px[i * 3 + 1] = p.pos.y;
    px[i * 3 + 2] = p.pos.z;
  });
  const tmp = new THREE.Vector3();
  for (let y = 0; y < H; y++) {
    const lat = 90 - (y / H) * 180;
    for (let x = 0; x < W; x++) {
      const lon = (x / W) * 360 - 180;
      latLonToVec3(lat, lon, 1, tmp);
      let best = -1;
      let bestD = -2;
      for (let i = 0; i < provinces.length; i++) {
        const d = px[i * 3] * tmp.x + px[i * 3 + 1] * tmp.y + px[i * 3 + 2] * tmp.z;
        if (d > bestD) {
          bestD = d;
          best = i;
        }
      }
      indexMap[y * W + x] = best;
    }
  }

  // --- adjacency from pixel map
  const adj: Set<number>[] = provinces.map(() => new Set<number>());
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const a = indexMap[y * W + x];
      const b = indexMap[y * W + ((x + 1) % W)];
      if (a !== b) {
        adj[a].add(b);
        adj[b].add(a);
      }
      if (y + 1 < H) {
        const c = indexMap[(y + 1) * W + x];
        if (a !== c) {
          adj[a].add(c);
          adj[c].add(a);
        }
      }
    }
  }
  provinces.forEach((p, i) => (p.neighbors = [...adj[i]]));

  // --- terrain for land provinces
  for (const p of provinces) {
    if (!p.isLand) continue;
    const v = p.pos;
    const elev = terrainNoise.fbm(v.x * 3.2, v.y * 3.2, v.z * 3.2, 4);
    const dry = dryNoise.fbm(v.x * 2.4 + 9, v.y * 2.4, v.z * 2.4, 3);
    const absLat = Math.abs(p.lat);
    let terrain: Terrain = 'plains';
    if (elev > 0.34) terrain = 'mountain';
    else if (elev > 0.16) terrain = 'hills';
    else if (absLat > 15 && absLat < 38 && dry > 0.12) terrain = 'desert';
    else if (absLat > 52 || dry < -0.15) terrain = 'forest';
    else if (rng.next() < 0.3) terrain = 'forest';
    p.terrain = terrain;
    const base = terrain === 'mountain' ? 300 : terrain === 'desert' ? 500 : terrain === 'hills' ? 900 : terrain === 'forest' ? 1100 : 1800;
    p.population = Math.round(base * rng.range(0.6, 1.6));
    p.oil = terrain === 'desert' ? (rng.next() < 0.5 ? rng.int(2, 4) : 0) : rng.next() < 0.14 ? rng.int(1, 3) : 0;
  }

  // --- assign ownership
  const land = provinces.filter((p) => p.isLand);
  const nearestLand = (v: THREE.Vector3): Province => {
    let best = land[0];
    let bestD = Infinity;
    for (const p of land) {
      const d = angularDistance(v, p.pos);
      if (d < bestD) {
        bestD = d;
        best = p;
      }
    }
    return best;
  };
  const claims: { n: NationDef; cap: Province; want: number; have: Province[] }[] = [];
  for (const c of capitals) {
    const cap = nearestLand(c.v);
    cap.owner = c.n.id;
    cap.capitalOf = c.n.id;
    cap.terrain = 'urban';
    cap.cityName = c.n.capital.name;
    cap.population = Math.round(4000 * rng.range(0.9, 1.3));
    claims.push({ n: c.n, cap, want: c.n.size, have: [cap] });
  }
  // Round-robin growth: each nation claims the nearest unowned land province that touches its territory.
  let progress = true;
  while (progress) {
    progress = false;
    for (const cl of claims) {
      if (cl.have.length >= cl.want) continue;
      let best: Province | null = null;
      let bestD = Infinity;
      for (const owned of cl.have) {
        for (const nb of owned.neighbors) {
          const q = provinces[nb];
          if (!q.isLand || q.owner) continue;
          const d = angularDistance(q.pos, cl.cap.pos);
          if (d < bestD) {
            bestD = d;
            best = q;
          }
        }
      }
      if (!best) {
        // Not contiguous: claim nearest unowned by distance (overseas holdings)
        for (const q of land) {
          if (q.owner) continue;
          const d = angularDistance(q.pos, cl.cap.pos);
          if (d < bestD) {
            bestD = d;
            best = q;
          }
        }
      }
      if (best) {
        best.owner = cl.n.id;
        cl.have.push(best);
        progress = true;
      }
    }
  }
  for (const p of land) if (!p.owner) p.owner = 'minor';

  // --- names, factories, garrison
  const used = new Set<string>();
  const nameCounters: Record<string, number> = {};
  for (const p of land) {
    const list = p.owner && NATION_NAMES[p.owner];
    let name = '';
    if (p.cityName) name = p.cityName;
    else if (list) {
      const i = nameCounters[p.owner!] ?? 0;
      nameCounters[p.owner!] = i + 1;
      name = list[i % list.length] + (i >= list.length ? ' ' + ['II', 'III', 'IV'][Math.floor(i / list.length) - 1] : '');
    }
    if (!name || used.has(name)) {
      do {
        name = rng.pick(SYL_A) + rng.pick(SYL_B);
      } while (used.has(name));
    }
    used.add(name);
    p.name = name;
    const nation = era.nations.find((n) => n.id === p.owner);
    const ind = nation ? nation.industry : 0.5;
    if (p.capitalOf) p.factories = Math.round(4 * ind);
    else if (p.terrain === 'urban') p.factories = Math.round(2 * ind);
    else p.factories = rng.next() < 0.45 * ind ? 1 : 0;
    if (nation && !p.capitalOf && rng.next() < 0.12) {
      p.terrain = 'urban';
      p.population = Math.round(p.population * 1.8);
      p.factories += 1;
    }
    p.originalOwner = p.owner;
    p.garrison = nation ? 2000 + Math.round(p.population * 0.5) : 1500 + Math.round(p.population * 0.6);
    p.fort = p.capitalOf ? 2 : 0;
  }
  let seaIdx = 0;
  for (const p of provinces) {
    if (p.isLand) continue;
    p.name = p.terrain === 'ice' ? 'Polar Ice' : SEA_NAMES[seaIdx++ % SEA_NAMES.length] + ' ' + Math.ceil(seaIdx / SEA_NAMES.length);
  }

  return { provinces, indexMap, W, H, seed, noise };
}

export function provinceAtLatLon(world: World, lat: number, lon: number): Province {
  const x = Math.floor(((lon + 180) / 360) * world.W) % world.W;
  const y = Math.min(world.H - 1, Math.max(0, Math.floor(((90 - lat) / 180) * world.H)));
  return world.provinces[world.indexMap[y * world.W + x]];
}

export function provinceAtPoint(world: World, v: THREE.Vector3): Province {
  const { lat, lon } = vec3ToLatLon(v);
  return provinceAtLatLon(world, lat, lon);
}

/** BFS shortest path (by hop count, weighted by terrain movement) between provinces. */
export function findPath(world: World, from: number, to: number, passable: (p: Province) => boolean): number[] | null {
  if (from === to) return [from];
  const dist = new Float32Array(world.provinces.length).fill(Infinity);
  const prev = new Int32Array(world.provinces.length).fill(-1);
  dist[from] = 0;
  const open: number[] = [from];
  while (open.length) {
    let bi = 0;
    for (let i = 1; i < open.length; i++) if (dist[open[i]] < dist[open[bi]]) bi = i;
    const cur = open.splice(bi, 1)[0];
    if (cur === to) break;
    for (const nb of world.provinces[cur].neighbors) {
      const q = world.provinces[nb];
      if (!passable(q) && nb !== to) continue;
      const cost = TERRAIN_INFO[q.terrain].moveMult;
      const nd = dist[cur] + cost;
      if (nd < dist[nb]) {
        dist[nb] = nd;
        prev[nb] = cur;
        if (!open.includes(nb)) open.push(nb);
      }
    }
  }
  if (dist[to] === Infinity) return null;
  const path: number[] = [];
  for (let c = to; c !== -1; c = prev[c]) path.push(c);
  return path.reverse();
}

export function seedFromString(s: string): number {
  return hashString(s);
}
