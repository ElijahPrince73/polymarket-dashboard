import 'dotenv/config';
import { CITIES } from '../src/weather/config.js';
import {
  fetchObservedHighTempDispatched,
  fetchObservedHighTempNOAA,
  hasNoaaCoverage,
} from '../src/weather/services/noaa-cdo.js';
import { fetchObservedHighTemp as fetchVC } from '../src/weather/services/visual-crossing.js';
import { fetchObservedHighTempWU, hasWunderground } from '../src/weather/services/wunderground.js';

const date = process.argv[2] || '2026-04-15';

const results = [];
for (const city of CITIES) {
  const [noaa, wu, vc] = await Promise.all([
    hasNoaaCoverage(city.station) ? fetchObservedHighTempNOAA(city, date) : Promise.resolve(null),
    hasWunderground(city.station) ? fetchObservedHighTempWU(city, date) : Promise.resolve(null),
    fetchVC(city.name, date),
  ]);
  const dispatched = await fetchObservedHighTempDispatched(city.name, date);
  results.push({
    city: city.name,
    station: city.station,
    unit: city.unit,
    noaa: noaa?.actualTemp ?? null,
    wu: wu?.actualTemp ?? null,
    vc: vc?.actualTemp ?? null,
    dispatched_val: dispatched?.actualTemp ?? null,
    dispatched_src: dispatched?.source ?? null,
  });
}

console.log(`date: ${date}\n`);
const pad = (s, w) => {
  const t = String(s ?? '-');
  return t.length >= w ? t.slice(0, w) : t + ' '.repeat(w - t.length);
};
console.log(`${pad('city', 16)} ${pad('unit', 5)} ${pad('noaa', 7)} ${pad('wu', 7)} ${pad('vc', 7)} ${pad('used', 14)} Δ(wu-vc)`);
console.log('-'.repeat(80));
for (const r of results) {
  const delta = r.wu != null && r.vc != null ? (r.wu - r.vc).toFixed(2) : '-';
  const usedStr = `${r.dispatched_val ?? '-'} (${r.dispatched_src ?? '-'})`;
  console.log(`${pad(r.city, 16)} ${pad(r.unit, 5)} ${pad(r.noaa, 7)} ${pad(r.wu, 7)} ${pad(r.vc, 7)} ${pad(usedStr, 14)} ${delta}`);
}
