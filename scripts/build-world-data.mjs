// Builds compact geography data from Natural Earth (public domain).
// Output: src/data/geo/countries.json and src/data/geo/cities.json
import { writeFileSync, existsSync, readFileSync, mkdirSync } from 'node:fs';

const BASE = 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/';
const CACHE = process.env.NE_CACHE || '/tmp/ne-cache';
mkdirSync(CACHE, { recursive: true });
async function load(name) {
  const f = `${CACHE}/${name}.geojson`;
  if (!existsSync(f)) {
    const r = await fetch(BASE + name + '.geojson');
    if (!r.ok) throw new Error('fetch failed ' + name + ' ' + r.status);
    writeFileSync(f, await r.text());
  }
  return JSON.parse(readFileSync(f, 'utf8'));
}

const countries = await load('ne_110m_admin_0_countries');
const places = await load('ne_110m_populated_places_simple');

const round = (v) => Math.round(v * 100) / 100;
const outCountries = [];
for (const f of countries.features) {
  const p = f.properties;
  let id = p.ADM0_A3 || p.ISO_A3;
  if (id === '-99' || !id) id = p.SOV_A3;
  const g = f.geometry;
  const polys = g.type === 'Polygon' ? [g.coordinates] : g.coordinates;
  const polygons = polys.map((rings) => rings.map((ring) => {
    const flat = [];
    let last = null;
    for (const [lon, lat] of ring) {
      const x = round(lon);
      const y = round(lat);
      if (last && last[0] === x && last[1] === y) continue;
      flat.push(x, y);
      last = [x, y];
    }
    return flat;
  }));
  outCountries.push({ id, name: p.NAME_LONG || p.NAME, sov: p.SOV_A3, pop: p.POP_EST || 0, polygons });
}
outCountries.sort((a, b) => a.id.localeCompare(b.id));

const outCities = places.features
  .map((f) => {
    const p = f.properties;
    return { n: p.name, c: p.adm0_a3, lat: round(p.latitude), lon: round(p.longitude), p: p.pop_max || 0, cap: p.adm0cap ? 1 : 0 };
  })
  .sort((a, b) => b.p - a.p);

mkdirSync('src/data/geo', { recursive: true });
writeFileSync('src/data/geo/countries.json', JSON.stringify(outCountries));
writeFileSync('src/data/geo/cities.json', JSON.stringify(outCities));
const ids = outCountries.map((c) => c.id);
console.log('countries', outCountries.length, 'cities', outCities.length);
console.log('bytes countries', JSON.stringify(outCountries).length, 'cities', JSON.stringify(outCities).length);
console.log(ids.join(' '));
