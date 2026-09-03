import * as THREE from 'three';
import { RNG, hashString } from '../core/rng';
import { Noise3D } from '../core/noise';
import { latLonToVec3, vec3ToLatLon, angularDistance, clamp } from '../core/math';
import type { EraDef } from '../data/types';
import { REGIONS } from '../data/regions';
import { ICE_COUNTRIES } from '../data/history';
import countriesData from '../data/geo/countries.json';
import citiesData from '../data/geo/cities.json';

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

interface CountryData {
  id: string;
  name: string;
  sov: string;
  pop: number;
  polygons: number[][][];
}
interface CityData {
  n: string;
  c: string;
  lat: number;
  lon: number;
  p: number;
  cap: number;
}
const COUNTRIES = countriesData as CountryData[];
const CITIES = citiesData as CityData[];

export interface Province {
  id: number;
  name: string;
  pos: THREE.Vector3;
  lat: number;
  lon: number;
  terrain: Terrain;
  isLand: boolean;
  owner: string | null; // nation id, 'minor' (independent country), or null for sea/ice
  originalOwner: string | null;
  country: string | null; // ADM0_A3
  countryName: string | null;
  population: number; // thousands
  factories: number;
  oil: number;
  fort: number;
  garrison: number;
  neighbors: number[];
  capitalOf: string | null;
  cityName?: string;
  /** True for the province holding a country's own capital city. */
  countryCapital: boolean;
}

export interface World {
  provinces: Province[];
  indexMap: Uint16Array;
  W: number;
  H: number;
  seed: number;
  noise: Noise3D;
  /** 0 = sea, 1 = land, 2 = ice */
  landMask: Uint8Array;
  countries: { id: string; name: string }[];
  elevationAt: (lat: number, lon: number) => number;
}

const NONE = 0xffff;

// ----------------------------------------------------------------------------- geography helpers
interface Box {
  la0: number;
  la1: number;
  lo0: number;
  lo1: number;
}
const box = (la0: number, la1: number, lo0: number, lo1: number): Box => ({ la0, la1, lo0, lo1 });
const inBox = (b: Box, lat: number, lon: number) => lat >= b.la0 && lat <= b.la1 && (b.lo0 <= b.lo1 ? lon >= b.lo0 && lon <= b.lo1 : lon >= b.lo0 || lon <= b.lo1);
/** Smooth membership 0..1 with soft edges (deg). */
const softBox = (b: Box, lat: number, lon: number, edge = 3) => {
  const fy = Math.min(lat - b.la0, b.la1 - lat);
  let fx = Math.min(lon - b.lo0, b.lo1 - lon);
  if (b.lo0 > b.lo1) fx = lon >= b.lo0 ? Math.min(lon - b.lo0, b.lo1 + 360 - lon) : Math.min(lon + 360 - b.lo0, b.lo1 - lon);
  return clamp(Math.min(fx, fy) / edge + 1, 0, 1);
};

const MOUNTAINS: { b: Box; h: number }[] = [
  { b: box(27, 36, 72, 100), h: 1.0 }, // Himalaya / Karakoram
  { b: box(29, 38, 78, 100), h: 0.7 }, // Tibetan plateau
  { b: box(36, 43, 68, 78), h: 0.7 }, // Pamir / Tian Shan
  { b: box(-55, 10, -80, -63), h: 0.75 }, // Andes
  { b: box(44, 47.5, 5.5, 14), h: 0.8 }, // Alps
  { b: box(42, 43.5, -2, 3), h: 0.6 }, // Pyrenees
  { b: box(35, 60, -125, -105), h: 0.6 }, // Rockies
  { b: box(36, 42, -122, -118), h: 0.6 }, // Sierra Nevada
  { b: box(40.5, 44, 40, 50), h: 0.8 }, // Caucasus
  { b: box(27, 38, 44, 56), h: 0.55 }, // Zagros
  { b: box(52, 67, 56, 62), h: 0.4 }, // Urals
  { b: box(45, 52, 84, 95), h: 0.5 }, // Altai
  { b: box(34, 40, 60, 72), h: 0.55 }, // Hindu Kush
  { b: box(37, 42, 33, 44), h: 0.5 }, // Anatolian / Pontic
  { b: box(31, 36, -8, 0), h: 0.5 }, // Atlas
  { b: box(-19, -4, 34, 40), h: 0.35 }, // East African highlands
  { b: box(5, 15, 35, 42), h: 0.55 }, // Ethiopian highlands
  { b: box(-30, -22, 25, 30), h: 0.3 }, // Drakensberg
  { b: box(36, 42, 20, 24), h: 0.4 }, // Balkans
  { b: box(45, 50, 22, 27), h: 0.45 }, // Carpathians
  { b: box(59, 70, 5, 15), h: 0.45 }, // Scandinavian mountains
  { b: box(-46, -36, 168, 175), h: 0.5 }, // Southern Alps NZ
  { b: box(34, 38, 136, 139), h: 0.4 }, // Japanese Alps
  { b: box(55, 70, 110, 140), h: 0.35 }, // Siberian ranges
  { b: box(60, 66, -150, -140), h: 0.6 }, // Alaska Range
  { b: box(-9, -3, 136, 146), h: 0.55 }, // New Guinea highlands
];
const DESERTS: Box[] = [
  box(15, 31, -17, 35), // Sahara
  box(13, 31, 35, 60), // Arabia / Syrian desert
  box(24, 36, 50, 66), // Iranian plateau deserts
  box(24, 30, 66, 74), // Thar
  box(36, 47, 55, 75), // Karakum / Kyzylkum
  box(37, 46, 88, 112), // Taklamakan / Gobi
  box(-31, -19, 115, 145), // Australian interior
  box(-29, -20, 16, 26), // Kalahari / Namib
  box(-29, -18, -72, -68), // Atacama
  box(29, 38, -119, -103), // US south-west
  box(24, 31, -113, -104), // Sonora / Chihuahua
  box(-48, -38, -71, -65), // Patagonian steppe
  box(3, 12, 42, 50), // Horn of Africa
];
const OIL: { b: Box; v: number }[] = [
  { b: box(26, 36, -104, -93), v: 4 }, // Texas / Oklahoma / Gulf
  { b: box(28, 32, -93, -88), v: 3 }, // Louisiana
  { b: box(8, 11.5, -73, -61), v: 3 }, // Venezuela
  { b: box(38, 42, 47, 52), v: 3 }, // Baku
  { b: box(24, 32, 46, 57), v: 4 }, // Persian Gulf
  { b: box(28, 34, 44, 50), v: 3 }, // Southern Iraq / Khuzestan
  { b: box(43.5, 46, 24, 27), v: 2 }, // Ploiești
  { b: box(-4, 5, 98, 118), v: 3 }, // Sumatra / Borneo
  { b: box(26, 32, 12, 24), v: 3 }, // Libya
  { b: box(26, 32, 3, 9), v: 2 }, // Algerian Sahara
  { b: box(4, 7, 4, 8), v: 3 }, // Niger delta
  { b: box(55, 67, 65, 80), v: 4 }, // Western Siberia
  { b: box(52, 57, 50, 58), v: 3 }, // Volga-Urals
  { b: box(52, 58, -118, -110), v: 3 }, // Alberta
  { b: box(18, 23, -99, -95), v: 2 }, // Mexican Gulf
  { b: box(68, 71, -155, -145), v: 2 }, // Alaska North Slope
  { b: box(-12, -5, 10, 14), v: 2 }, // Angola / Cabinda
  { b: box(42, 48, 50, 60), v: 2 }, // Kazakhstan Caspian
];
const SEAS: { n: string; b: Box }[] = [
  { n: 'Caspian Sea', b: box(36, 47.5, 46, 55) },
  { n: 'Black Sea', b: box(40.5, 47, 27, 42) },
  { n: 'Mediterranean Sea', b: box(30, 46, -6, 37) },
  { n: 'Baltic Sea', b: box(53, 66, 9.5, 30) },
  { n: 'North Sea', b: box(51, 62, -4, 9) },
  { n: 'Red Sea', b: box(12, 30, 32, 44) },
  { n: 'Persian Gulf', b: box(23.5, 30.5, 47.5, 57) },
  { n: 'Arabian Sea', b: box(5, 25, 50, 77) },
  { n: 'Bay of Bengal', b: box(5, 22, 78, 96) },
  { n: 'South China Sea', b: box(0, 23, 104, 121) },
  { n: 'East China Sea', b: box(23, 33, 120, 131) },
  { n: 'Sea of Japan', b: box(34, 51, 128, 142) },
  { n: 'Sea of Okhotsk', b: box(45, 62, 135, 160) },
  { n: 'Bering Sea', b: box(52, 66, 160, -155) },
  { n: 'Caribbean Sea', b: box(9, 22, -88, -60) },
  { n: 'Gulf of Mexico', b: box(18, 30.5, -98, -81) },
  { n: 'Hudson Bay', b: box(51, 64, -95, -76) },
  { n: 'Norwegian Sea', b: box(62, 75, -12, 20) },
  { n: 'Barents Sea', b: box(66, 81, 20, 60) },
  { n: 'Kara Sea', b: box(68, 81, 60, 100) },
  { n: 'Coral Sea', b: box(-26, -9, 145, 162) },
  { n: 'Tasman Sea', b: box(-46, -30, 150, 170) },
  { n: 'Gulf of Guinea', b: box(-5, 6, -10, 10) },
  { n: 'Mozambique Channel', b: box(-26, -10, 35, 45) },
  { n: 'Labrador Sea', b: box(52, 66, -65, -45) },
  { n: 'Greenland Sea', b: box(70, 82, -25, 0) },
  { n: 'Arctic Ocean', b: box(66, 90, -180, 180) },
  { n: 'Southern Ocean', b: box(-90, -55, -180, 180) },
  { n: 'North Atlantic', b: box(0, 66, -85, 0) },
  { n: 'South Atlantic', b: box(-55, 0, -70, 20) },
  { n: 'Indian Ocean', b: box(-55, 25, 20, 120) },
  { n: 'North Pacific', b: box(0, 66, 120, -100) },
  { n: 'South Pacific', b: box(-55, 0, 120, -70) },
];

// ----------------------------------------------------------------------------- rasteriser
/** Scanline even-odd fill of a set of rings (outer + holes) into the index map. */
function fillPolygon(rings: number[][], value: number, out: Uint16Array, W: number, H: number) {
  // edges in pixel space
  const edges: [number, number, number, number][] = [];
  let ymin = Infinity;
  let ymax = -Infinity;
  for (const ring of rings) {
    const n = ring.length / 2;
    for (let i = 0; i < n; i++) {
      const x0 = ((ring[i * 2] + 180) / 360) * W;
      const y0 = ((90 - ring[i * 2 + 1]) / 180) * H;
      const j = (i + 1) % n;
      const x1 = ((ring[j * 2] + 180) / 360) * W;
      const y1 = ((90 - ring[j * 2 + 1]) / 180) * H;
      if (y0 === y1) continue;
      edges.push([x0, y0, x1, y1]);
      ymin = Math.min(ymin, y0, y1);
      ymax = Math.max(ymax, y0, y1);
    }
  }
  const xs: number[] = [];
  const r0 = Math.max(0, Math.floor(ymin));
  const r1 = Math.min(H - 1, Math.ceil(ymax));
  for (let row = r0; row <= r1; row++) {
    const y = row + 0.5;
    xs.length = 0;
    for (const [x0, y0, x1, y1] of edges) {
      if (y < Math.min(y0, y1) || y >= Math.max(y0, y1)) continue;
      xs.push(x0 + ((y - y0) * (x1 - x0)) / (y1 - y0));
    }
    if (xs.length < 2) continue;
    xs.sort((a, b) => a - b);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const a = Math.max(0, Math.round(xs[k]));
      const b = Math.min(W, Math.round(xs[k + 1]));
      for (let x = a; x < b; x++) out[row * W + x] = value;
    }
  }
}

// ----------------------------------------------------------------------------- generation
export function generateWorld(era: EraDef, seed: number): World {
  const rng = new RNG(seed);
  const noise = new Noise3D(seed ^ 0x9e3779b9);
  const W = 2048;
  const H = 1024;
  const t0 = performance.now();

  // 1. country raster
  const countryMap = new Uint16Array(W * H).fill(NONE);
  COUNTRIES.forEach((c, ci) => {
    for (const poly of c.polygons) fillPolygon(poly, ci, countryMap, W, H);
  });
  const landMask = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) {
    const ci = countryMap[i];
    if (ci === NONE) continue;
    landMask[i] = ICE_COUNTRIES.has(COUNTRIES[ci].id) ? 2 : 1;
  }

  const elevationAt = (lat: number, lon: number): number => {
    let m = 0;
    for (const mt of MOUNTAINS) m = Math.max(m, softBox(mt.b, lat, lon, 2.5) * mt.h);
    const v = latLonToVec3(lat, lon);
    const n = noise.fbm(v.x * 3.5, v.y * 3.5, v.z * 3.5, 4) * 0.5 + 0.5;
    const n2 = noise.fbm(v.x * 9 + 2, v.y * 9, v.z * 9, 3) * 0.5;
    return clamp(n * 0.35 + m * (0.7 + n2 * 0.3), 0, 1);
  };

  // 2. per-country pixel candidates (subsampled) + area
  const pxCount = new Float64Array(COUNTRIES.length);
  const areaKm = new Float64Array(COUNTRIES.length);
  for (let y = 0; y < H; y++) {
    const lat = 90 - ((y + 0.5) / H) * 180;
    const w = 382 * Math.cos((lat * Math.PI) / 180);
    for (let x = 0; x < W; x++) {
      const ci = countryMap[y * W + x];
      if (ci === NONE) continue;
      pxCount[ci]++;
      areaKm[ci] += w;
    }
  }
  const candidates: Int32Array[] = COUNTRIES.map((_, ci) => new Int32Array(Math.min(1600, pxCount[ci])));
  const candFill = new Int32Array(COUNTRIES.length);
  const stride = COUNTRIES.map((_, ci) => Math.max(1, Math.ceil(pxCount[ci] / 1600)));
  const seen = new Int32Array(COUNTRIES.length);
  for (let i = 0; i < W * H; i++) {
    const ci = countryMap[i];
    if (ci === NONE) continue;
    if (seen[ci]++ % stride[ci] === 0 && candFill[ci] < candidates[ci].length) candidates[ci][candFill[ci]++] = i;
  }
  const pixelPos = (i: number, out = new THREE.Vector3()) => {
    const x = i % W;
    const y = (i - x) / W;
    return latLonToVec3(90 - ((y + 0.5) / H) * 180, ((x + 0.5) / W) * 360 - 180, 1, out);
  };

  // 3. seeds per country by farthest-point sampling (first seed = near the country's capital city)
  const provinces: Province[] = [];
  const countrySeeds: number[][] = COUNTRIES.map(() => []);
  const cityCapital = new Map<string, CityData>();
  for (const c of CITIES) if (c.cap && !cityCapital.has(c.c)) cityCapital.set(c.c, c);
  COUNTRIES.forEach((c, ci) => {
    const n = candFill[ci];
    if (n === 0) return;
    const ice = ICE_COUNTRIES.has(c.id);
    const kArea = Math.pow(areaKm[ci] / 60000, 0.55);
    const kPop = Math.sqrt(Math.max(0.2, c.pop / 8e6));
    const k = ice ? 4 : clamp(Math.round(0.5 * kArea + 0.5 * kPop), 1, 14);
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i < n; i++) pts.push(pixelPos(candidates[ci][i]));
    const dist = new Float32Array(n).fill(Infinity);
    const chosen: number[] = [];
    let first = 0;
    const cap = cityCapital.get(c.id);
    if (cap) {
      const cv = latLonToVec3(cap.lat, cap.lon);
      let bd = Infinity;
      for (let i = 0; i < n; i++) {
        const d = angularDistance(pts[i], cv);
        if (d < bd) {
          bd = d;
          first = i;
        }
      }
    } else first = Math.floor(rng.next() * n);
    chosen.push(first);
    for (let i = 0; i < n; i++) dist[i] = angularDistance(pts[i], pts[first]);
    while (chosen.length < k) {
      let bi = -1;
      let bd = -1;
      for (let i = 0; i < n; i++) if (dist[i] > bd) (bd = dist[i]), (bi = i);
      if (bi < 0 || bd < 0.012) break;
      chosen.push(bi);
      for (let i = 0; i < n; i++) dist[i] = Math.min(dist[i], angularDistance(pts[i], pts[bi]));
    }
    for (const idx of chosen) {
      const v = pts[idx];
      const { lat, lon } = vec3ToLatLon(v);
      countrySeeds[ci].push(provinces.length);
      provinces.push({
        id: provinces.length, name: '', pos: v, lat, lon, terrain: ice ? 'ice' : 'plains', isLand: !ice, owner: null, originalOwner: null,
        country: c.id, countryName: c.name, population: 0, factories: 0, oil: 0, fort: 0, garrison: 0, neighbors: [], capitalOf: null, countryCapital: false,
      });
    }
  });

  // 4. sea seeds (Fibonacci points over ocean)
  const seaStart = provinces.length;
  {
    const N = 700;
    const golden = Math.PI * (3 - Math.sqrt(5));
    let n = 0;
    for (let i = 0; i < N; i++) {
      const y = 1 - (i / (N - 1)) * 2;
      const r = Math.sqrt(1 - y * y);
      const th = golden * i;
      const v = new THREE.Vector3(Math.cos(th) * r, y, Math.sin(th) * r).normalize();
      const { lat, lon } = vec3ToLatLon(v);
      const px = Math.floor(((lon + 180) / 360) * W) % W;
      const py = clamp(Math.floor(((90 - lat) / 180) * H), 0, H - 1);
      if (landMask[py * W + px] !== 0) continue;
      if (n++ % 3 !== 0) continue;
      const ice = Math.abs(lat) > 79;
      provinces.push({
        id: provinces.length, name: '', pos: v, lat, lon, terrain: ice ? 'ice' : 'sea', isLand: false, owner: null, originalOwner: null,
        country: null, countryName: null, population: 0, factories: 0, oil: 0, fort: 0, garrison: 0, neighbors: [], capitalOf: null, countryCapital: false,
      });
    }
  }
  const seaSeeds = provinces.slice(seaStart);

  // 5. index map: land pixels -> nearest seed of their country; sea -> nearest sea seed (coarse grid)
  const indexMap = new Uint16Array(W * H);
  const seedPos = new Float32Array(provinces.length * 3);
  provinces.forEach((p, i) => seedPos.set([p.pos.x, p.pos.y, p.pos.z], i * 3));
  const tmp = new THREE.Vector3();
  // coarse sea assignment
  const CW = W / 4;
  const CH = H / 4;
  const seaCoarse = new Uint16Array(CW * CH);
  for (let y = 0; y < CH; y++) {
    const lat = 90 - ((y + 0.5) / CH) * 180;
    for (let x = 0; x < CW; x++) {
      latLonToVec3(lat, ((x + 0.5) / CW) * 360 - 180, 1, tmp);
      let best = seaStart;
      let bd = -2;
      for (const s of seaSeeds) {
        const d = seedPos[s.id * 3] * tmp.x + seedPos[s.id * 3 + 1] * tmp.y + seedPos[s.id * 3 + 2] * tmp.z;
        if (d > bd) (bd = d), (best = s.id);
      }
      seaCoarse[y * CW + x] = best;
    }
  }
  for (let y = 0; y < H; y++) {
    const lat = 90 - ((y + 0.5) / H) * 180;
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      const ci = countryMap[i];
      if (ci === NONE) {
        indexMap[i] = seaCoarse[(y >> 2) * CW + (x >> 2)];
        continue;
      }
      const seeds = countrySeeds[ci];
      if (seeds.length === 1) {
        indexMap[i] = seeds[0];
        continue;
      }
      latLonToVec3(lat, ((x + 0.5) / W) * 360 - 180, 1, tmp);
      let best = seeds[0];
      let bd = -2;
      for (const s of seeds) {
        const d = seedPos[s * 3] * tmp.x + seedPos[s * 3 + 1] * tmp.y + seedPos[s * 3 + 2] * tmp.z;
        if (d > bd) (bd = d), (best = s);
      }
      indexMap[i] = best;
    }
  }

  // 6. adjacency
  const adj: Set<number>[] = provinces.map(() => new Set<number>());
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const a = indexMap[y * W + x];
      const b = indexMap[y * W + ((x + 1) % W)];
      if (a !== b) (adj[a].add(b), adj[b].add(a));
      if (y + 1 < H) {
        const c = indexMap[(y + 1) * W + x];
        if (a !== c) (adj[a].add(c), adj[c].add(a));
      }
    }
  }
  provinces.forEach((p, i) => (p.neighbors = [...adj[i]]));

  // 7. terrain, resources, ownership
  const dryNoise = new Noise3D(seed ^ 0x77123);
  const territory = era.politics.territory;
  const eraPop = era.id === 'ww1' ? 0.22 : era.id === 'ww2' ? 0.3 : 1.0;
  const countryProvCount = new Map<string, number>();
  for (const p of provinces) if (p.country) countryProvCount.set(p.country, (countryProvCount.get(p.country) ?? 0) + 1);
  for (const p of provinces) {
    if (!p.isLand) {
      p.name = p.terrain === 'ice' ? 'Polar Ice' : SEAS.find((s) => inBox(s.b, p.lat, p.lon))?.n ?? 'Open Ocean';
      continue;
    }
    const absLat = Math.abs(p.lat);
    const elev = elevationAt(p.lat, p.lon);
    const dry = dryNoise.fbm(p.pos.x * 3 + 9, p.pos.y * 3, p.pos.z * 3, 3);
    const desert = DESERTS.some((b) => inBox(b, p.lat, p.lon)) || (absLat > 15 && absLat < 35 && dry > 0.28);
    let terrain: Terrain = 'plains';
    if (absLat > 72) terrain = 'ice';
    else if (elev > 0.62) terrain = 'mountain';
    else if (elev > 0.42) terrain = 'hills';
    else if (desert) terrain = 'desert';
    else if (absLat > 56 || (absLat < 12 && dry < 0.1) || dry < -0.25) terrain = 'forest';
    p.terrain = terrain;
    if (terrain === 'ice') {
      p.isLand = false;
      p.name = 'Polar Ice';
      continue;
    }
    const country = COUNTRIES.find((c) => c.id === p.country)!;
    const share = 1 / (countryProvCount.get(p.country!) ?? 1);
    const base = (country.pop * share * eraPop) / 1000;
    const terrainMult = terrain === 'mountain' || terrain === 'desert' ? 0.4 : terrain === 'hills' ? 0.7 : 1;
    p.population = Math.max(80, Math.round(base * terrainMult * rng.range(0.7, 1.3)));
    const oilBox = OIL.find((o) => inBox(o.b, p.lat, p.lon));
    p.oil = oilBox ? oilBox.v : rng.next() < 0.04 ? 1 : 0;
    const owner = territory[p.country!];
    p.owner = owner ?? 'minor';
    p.originalOwner = p.owner;
  }

  // 8. names: regions + cities greedily by distance, capitals
  const nameSlots: { n: string; v: THREE.Vector3; country: string; cap: boolean; pop: number }[] = [];
  for (const [cc, list] of Object.entries(REGIONS)) for (const r of list) nameSlots.push({ n: r.n, v: latLonToVec3(r.lat, r.lon), country: cc, cap: false, pop: 0 });
  for (const c of CITIES) nameSlots.push({ n: c.n, v: latLonToVec3(c.lat, c.lon), country: c.c, cap: !!c.cap, pop: c.p });
  const byCountry = new Map<string, Province[]>();
  for (const p of provinces) if (p.country && p.isLand) (byCountry.get(p.country) ?? byCountry.set(p.country, []).get(p.country)!).push(p);
  const pairs: { d: number; slot: (typeof nameSlots)[number]; p: Province }[] = [];
  for (const slot of nameSlots) {
    const list = byCountry.get(slot.country);
    if (!list) continue;
    for (const p of list) {
      const d = angularDistance(slot.v, p.pos);
      if (d < 0.2) pairs.push({ d: d - (slot.cap ? 0.05 : 0), slot, p });
    }
  }
  pairs.sort((a, b) => a.d - b.d);
  const usedNames = new Set<string>();
  for (const { slot, p } of pairs) {
    if (p.name || usedNames.has(slot.n)) continue;
    p.name = slot.n;
    usedNames.add(slot.n);
    if (slot.cap) {
      p.countryCapital = true;
      p.cityName = slot.n;
    }
    if (slot.pop > 2500000 * eraPop || slot.cap) p.terrain = p.terrain === 'mountain' ? 'hills' : 'urban';
  }
  const COMPASS = ['Northern', 'North-Eastern', 'Eastern', 'South-Eastern', 'Southern', 'South-Western', 'Western', 'North-Western'];
  for (const [cc, list] of byCountry) {
    const unnamed = list.filter((p) => !p.name);
    if (!unnamed.length) continue;
    const cname = COUNTRIES.find((c) => c.id === cc)!.name;
    if (list.length === 1) {
      unnamed[0].name = cname;
      continue;
    }
    const cx = list.reduce((s, p) => s + p.lon, 0) / list.length;
    const cy = list.reduce((s, p) => s + p.lat, 0) / list.length;
    for (const p of unnamed) {
      const dx = p.lon - cx;
      const dy = p.lat - cy;
      let name: string;
      if (Math.hypot(dx, dy) < 1.5) name = `Central ${cname}`;
      else {
        const ang = ((Math.atan2(dx, dy) * 180) / Math.PI + 360 + 22.5) % 360;
        name = `${COMPASS[Math.floor(ang / 45)]} ${cname}`;
      }
      let k = 1;
      let final = name;
      while (usedNames.has(final)) final = `${name} ${['II', 'III', 'IV', 'V', 'VI'][k++ - 1] ?? k}`;
      usedNames.add(final);
      p.name = final;
    }
  }
  // country capital fallback: the first seed of each country sits on its capital city
  for (const [cc, list] of byCountry) {
    if (list.some((p) => p.countryCapital)) continue;
    const cap = cityCapital.get(cc);
    const p = cap ? provinceAtLatLon({ provinces, indexMap, W, H } as World, cap.lat, cap.lon) : list[0];
    if (p.country === cc) {
      p.countryCapital = true;
      p.terrain = p.terrain === 'mountain' ? 'hills' : 'urban';
    }
  }
  // nation capitals
  const allNations = [...era.nations, ...era.politics.aiNations];
  for (const n of allNations) {
    let p = provinceAtLatLon({ provinces, indexMap, W, H } as World, n.capital.lat, n.capital.lon);
    if (!p.isLand || p.owner !== n.id) {
      // fall back to the nation's largest owned province closest to the capital coordinates
      const v = latLonToVec3(n.capital.lat, n.capital.lon);
      const owned = provinces.filter((q) => q.owner === n.id && q.isLand);
      if (!owned.length) continue;
      owned.sort((a, b) => angularDistance(a.pos, v) - angularDistance(b.pos, v));
      p = owned[0];
    }
    p.capitalOf = n.id;
    p.cityName = n.capital.name;
    p.name = n.capital.name === p.name ? p.name : p.countryCapital ? p.name : p.name;
    p.terrain = 'urban';
    p.fort = 2;
    p.population = Math.round(p.population * 1.4);
  }

  // 9. factories & garrisons
  for (const p of provinces) {
    if (!p.isLand) continue;
    const nation = allNations.find((n) => n.id === p.owner);
    const ind = nation ? nation.industry : 0.45;
    if (p.capitalOf) p.factories = Math.max(2, Math.round(4 * ind));
    else if (p.terrain === 'urban') p.factories = Math.max(1, Math.round(2 * ind));
    else p.factories = rng.next() < 0.2 * ind ? 1 : 0;
    p.garrison = Math.round((nation ? 1800 : 1400) + p.population * 0.25);
  }

  const countries = COUNTRIES.map((c) => ({ id: c.id, name: c.name }));
  if (typeof console !== 'undefined') console.debug(`world generated in ${(performance.now() - t0).toFixed(0)} ms: ${provinces.length} provinces`);
  return { provinces, indexMap, W, H, seed, noise, landMask, countries, elevationAt };
}

export function provinceAtLatLon(world: Pick<World, 'provinces' | 'indexMap' | 'W' | 'H'>, lat: number, lon: number): Province {
  const x = ((Math.floor(((lon + 180) / 360) * world.W) % world.W) + world.W) % world.W;
  const y = Math.min(world.H - 1, Math.max(0, Math.floor(((90 - lat) / 180) * world.H)));
  return world.provinces[world.indexMap[y * world.W + x]];
}

export function provinceAtPoint(world: World, v: THREE.Vector3): Province {
  const { lat, lon } = vec3ToLatLon(v);
  return provinceAtLatLon(world, lat, lon);
}

/** Dijkstra over province adjacency weighted by terrain movement cost. */
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
