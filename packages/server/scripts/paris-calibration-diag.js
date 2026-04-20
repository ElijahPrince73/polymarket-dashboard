import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { CITIES } from '../src/weather/config.js';
import { fetchObservedHighTempWU } from '../src/weather/services/wunderground.js';
import { fetchObservedHighTemp as fetchVC } from '../src/weather/services/visual-crossing.js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const parisCity = CITIES.find((c) => c.name === 'Paris');

const { data: trades } = await supabase
  .from('weather_trades')
  .select('id, event_date, forecast_temp, actual_temp, result, pnl')
  .eq('city', 'Paris')
  .in('result', ['WIN', 'LOSS'])
  .eq('trading_mode', 'paper')
  .not('forecast_temp', 'is', null)
  .order('event_date', { ascending: false })
  .limit(15);

console.log(`Paris: ${trades.length} resolved trades sampled\n`);
console.log(`${'date'.padEnd(12)} ${'fcst'.padEnd(6)} ${'stored'.padEnd(7)} ${'wu'.padEnd(6)} ${'vc'.padEnd(6)} |fcst-stored| |fcst-wu| |fcst-vc| Δ(wu-stored)`);

const seen = new Set();
let stats = { stored: [], wu: [], vc: [] };
for (const t of trades) {
  const key = t.event_date;
  if (seen.has(key)) continue;
  seen.add(key);
  const [wu, vc] = await Promise.all([
    fetchObservedHighTempWU(parisCity, t.event_date),
    fetchVC('Paris', t.event_date),
  ]);
  const wuT = wu?.actualTemp ?? null;
  const vcT = vc?.actualTemp ?? null;
  const errStored = t.actual_temp != null ? Math.abs(t.forecast_temp - t.actual_temp) : null;
  const errWU = wuT != null ? Math.abs(t.forecast_temp - wuT) : null;
  const errVC = vcT != null ? Math.abs(t.forecast_temp - vcT) : null;
  const delta = wuT != null && t.actual_temp != null ? (wuT - t.actual_temp).toFixed(1) : '-';
  if (errStored != null) stats.stored.push(errStored);
  if (errWU != null) stats.wu.push(errWU);
  if (errVC != null) stats.vc.push(errVC);
  console.log(
    `${t.event_date.padEnd(12)} ${String(t.forecast_temp?.toFixed(1)).padEnd(6)} ${String(t.actual_temp?.toFixed(1) ?? '-').padEnd(7)} ${String(wuT?.toFixed(1) ?? '-').padEnd(6)} ${String(vcT?.toFixed(1) ?? '-').padEnd(6)} ${String(errStored?.toFixed(2) ?? '-').padStart(12)}  ${String(errWU?.toFixed(2) ?? '-').padStart(8)}  ${String(errVC?.toFixed(2) ?? '-').padStart(8)}  ${delta}`
  );
}

const mean = (a) => a.length ? a.reduce((s, x) => s + x, 0) / a.length : null;
console.log();
console.log(`avgError — stored (VC-at-LFPG lat/lon): ${mean(stats.stored)?.toFixed(2)}`);
console.log(`avgError — WU at LFPB (station-exact):   ${mean(stats.wu)?.toFixed(2)}`);
console.log(`avgError — VC at LFPB lat/lon (current): ${mean(stats.vc)?.toFixed(2)}`);
