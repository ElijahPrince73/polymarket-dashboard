import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { CITIES } from '../src/weather/config.js';
import { fetchJson } from '../src/weather/utils.js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SUPABASE_KEY) {
  throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set');
}
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: false },
});

const GAMMA_EVENT = 'https://gamma-api.polymarket.com/events/slug';

function parseWUStation(url) {
  if (!url) return null;
  const path = String(url).split('?')[0].split('#')[0].replace(/\/+$/, '');
  if (!/wunderground\.com\/history\/daily\//i.test(path)) return null;
  const parts = path.split('/').filter(Boolean);
  const last = parts[parts.length - 1];
  return last && /^[A-Z0-9]{3,4}$/i.test(last) ? last.toUpperCase() : null;
}

function extractEventSlug(url) {
  const m = String(url || '').match(/polymarket\.com\/event\/([^/?#]+)/i);
  return m ? m[1] : null;
}

async function latestEventSlugForCity(city) {
  const { data, error } = await supabase
    .from('weather_trades')
    .select('market_url, event_date')
    .eq('city', city)
    .not('market_url', 'is', null)
    .order('event_date', { ascending: false })
    .limit(3);
  if (error) throw new Error(`supabase(${city}): ${error.message}`);
  for (const row of data ?? []) {
    const slug = extractEventSlug(row.market_url);
    if (slug) return slug;
  }
  return null;
}

async function pollyStationForSlug(slug) {
  try {
    const event = await fetchJson(`${GAMMA_EVENT}/${slug}`, { retries: 2, retryDelayMs: 1000 });
    const src = event?.markets?.[0]?.resolutionSource || '';
    return { source: src, station: parseWUStation(src) };
  } catch (err) {
    return { source: null, station: null, err: err.message };
  }
}

function pad(s, w, align = 'left') {
  const t = String(s ?? '');
  if (t.length >= w) return t.slice(0, w);
  const padN = w - t.length;
  return align === 'right' ? ' '.repeat(padN) + t : t + ' '.repeat(padN);
}

(async () => {
  console.log(`${pad('city', 16)} ${pad('config', 8)} ${pad('config lat,lon', 18)} ${pad('poly', 8)} ${pad('match', 8)} source`);
  console.log('-'.repeat(120));
  const rows = [];
  for (const city of CITIES) {
    const slug = await latestEventSlugForCity(city.name);
    if (!slug) {
      rows.push({ city, polly: null, source: '(no resolved trades)' });
      continue;
    }
    const { station, source, err } = await pollyStationForSlug(slug);
    rows.push({ city, polly: station, source: source || err || '' });
  }
  const mismatches = [];
  for (const { city, polly, source } of rows) {
    const match = polly && city.station === polly ? 'match' : (polly ? 'MISMATCH' : 'n/a');
    if (match === 'MISMATCH') mismatches.push({ city: city.name, config: city.station, polly });
    const latLon = `${city.lat.toFixed(3)},${city.lon.toFixed(3)}`;
    console.log(`${pad(city.name, 16)} ${pad(city.station, 8)} ${pad(latLon, 18)} ${pad(polly || '-', 8)} ${pad(match, 8)} ${source}`);
  }
  console.log();
  console.log(`Mismatches: ${mismatches.length}`);
  for (const m of mismatches) {
    console.log(`  ${m.city}: config=${m.config} → polymarket=${m.polly}`);
  }
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
