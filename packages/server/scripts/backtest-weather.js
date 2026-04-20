import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import {
  CITIES,
  MODEL_CANDIDATES,
  SIGMA_C,
  SIGMA_F,
  MIN_PRICE as CONFIG_MIN_PRICE,
  MAX_PRICE as CONFIG_MAX_PRICE,
  MIN_HOURS_TO_CLOSE,
} from '../src/weather/config.js';
import {
  parseRangeC,
  detectMarketType,
  normalCdf,
  fetchJson,
} from '../src/weather/utils.js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SUPABASE_KEY) {
  throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set');
}
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: false },
});

const EDGE_GRID = [0.05, 0.08, 0.12, 0.15, 0.20];
const DEFAULT_THRESHOLD = 0.12;
const FLAT_STAKE = 25;
const BANKROLL = 1000;
const KELLY_CAP = 0.06;
const ENTRY_OFFSET_MS = MIN_HOURS_TO_CLOSE * 3600 * 1000;
const GAMMA_EVENT = 'https://gamma-api.polymarket.com/events/slug';
const CLOB_HISTORY = 'https://clob.polymarket.com/prices-history';
const OM_HIST_FORECAST = 'https://historical-forecast-api.open-meteo.com/v1/forecast';
const REPLAY_CONCURRENCY = 4;
const ENTRY_TOLERANCE_MS = 120 * 60 * 1000;
// Cities whose config station+lat/lon were updated to match Polymarket's
// resolutionSource. Phase D re-forecasts these cities at the corrected
// coordinates to see whether the fix flips their backtest profitability.
const MISMATCH_CITIES = new Set(['Paris', 'Denver', 'Houston', 'Tokyo']);

const cityByName = new Map(CITIES.map((c) => [c.name, c]));

const args = new Map();
for (const arg of process.argv.slice(2)) {
  const m = arg.match(/^--([\w-]+)(?:=(.*))?$/);
  if (m) args.set(m[1], m[2] ?? 'true');
}
const cityFilter = args.get('city') || null;
const runPhaseB = args.get('skip-phase-b') !== 'true';
const eventLimit = args.get('limit') ? Number.parseInt(args.get('limit'), 10) : null;
const debug = args.get('debug') === 'true';
const MIN_PRICE = args.has('min-price') ? Number.parseFloat(args.get('min-price')) : CONFIG_MIN_PRICE;
const MAX_PRICE = args.has('max-price') ? Number.parseFloat(args.get('max-price')) : CONFIG_MAX_PRICE;
console.error(`[backtest] price band [${MIN_PRICE}, ${MAX_PRICE}] (config default [${CONFIG_MIN_PRICE}, ${CONFIG_MAX_PRICE}])`);

function extractEventSlug(url) {
  const m = String(url || '').match(/polymarket\.com\/event\/([^/?#]+)/i);
  return m ? m[1] : null;
}
function parseJsonArray(s) {
  if (Array.isArray(s)) return s;
  try { return JSON.parse(s || '[]'); } catch { return []; }
}
function parseKellyMult(notes) {
  const m = String(notes || '').match(/KellyMult=([\d.]+)/);
  const v = m ? Number.parseFloat(m[1]) : NaN;
  return Number.isFinite(v) ? v : 0.5;
}
function parseSigmaFromNotes(notes) {
  const m = String(notes || '').match(/σ=([\d.]+)/);
  const v = m ? Number.parseFloat(m[1]) : NaN;
  return Number.isFinite(v) ? v : null;
}
function hypotheticalPnl(entryPrice, win, stake) {
  if (!Number.isFinite(entryPrice) || entryPrice <= 0 || stake <= 0) return 0;
  return win ? stake * (1 / entryPrice - 1) : -stake;
}
function kellyStake(modelProb, entryPrice, kellyMult) {
  if (!Number.isFinite(entryPrice) || entryPrice <= 0) return 0;
  const payoff = (1 / entryPrice) - 1;
  if (payoff <= 0) return 0;
  const k = (modelProb * payoff - (1 - modelProb)) / payoff;
  const sizePct = Math.max(0, (k / 2) * kellyMult);
  return BANKROLL * Math.min(sizePct, KELLY_CAP);
}
function forecastInC(forecast, unit) {
  if (forecast == null) return null;
  return unit === 'F' ? ((forecast - 32) * 5) / 9 : forecast;
}
function sigmaInC(unit, calibration) {
  if (calibration && calibration.resolved_count >= 30
      && Number.isFinite(calibration.avg_error) && calibration.avg_error > 0) {
    return unit === 'F' ? (calibration.avg_error * 5) / 9 : calibration.avg_error;
  }
  return unit === 'F' ? (SIGMA_F * 5) / 9 : SIGMA_C;
}

async function loadResolvedTrades() {
  let query = supabase
    .from('weather_trades')
    .select('id, city, event_date, question, entry_price, model_prob, stake_usd, size_pct, result, pnl, notes, market_url, forecast_temp, token_id, condition_id')
    .in('result', ['WIN', 'LOSS'])
    .eq('trading_mode', 'paper')
    .not('model_prob', 'is', null)
    .not('entry_price', 'is', null)
    .order('event_date', { ascending: true });
  if (cityFilter) query = query.eq('city', cityFilter);
  const { data, error } = await query;
  if (error) throw new Error(`loadResolvedTrades: ${error.message}`);
  return data ?? [];
}

async function loadCalibration() {
  const { data, error } = await supabase
    .from('weather_calibration')
    .select('city, market_type, sigma, bias, avg_error, resolved_count');
  if (error) throw new Error(`loadCalibration: ${error.message}`);
  const map = new Map();
  for (const row of data ?? []) map.set(`${row.city}|${row.market_type}`, row);
  return map;
}

function fmtPct(v, d = 1) {
  return v == null || !Number.isFinite(v) ? 'N/A' : `${(v * 100).toFixed(d)}%`;
}
function fmtUsd(v) {
  if (v == null || !Number.isFinite(v)) return 'N/A';
  const sign = v < 0 ? '-' : '';
  return `${sign}$${Math.abs(v).toFixed(2)}`;
}
function pad(s, w, align = 'left') {
  const t = String(s);
  if (t.length >= w) return t;
  const padN = w - t.length;
  return align === 'right' ? ' '.repeat(padN) + t : t + ' '.repeat(padN);
}

function phaseA(trades) {
  const actual = { n: 0, wins: 0, pnl: 0, stake: 0, byCity: new Map() };
  for (const t of trades) {
    actual.n += 1;
    actual.wins += t.result === 'WIN' ? 1 : 0;
    actual.pnl += t.pnl ?? 0;
    actual.stake += t.stake_usd ?? 0;
    if (!actual.byCity.has(t.city)) {
      actual.byCity.set(t.city, { n: 0, wins: 0, pnl: 0, stake: 0 });
    }
    const c = actual.byCity.get(t.city);
    c.n += 1;
    c.wins += t.result === 'WIN' ? 1 : 0;
    c.pnl += t.pnl ?? 0;
    c.stake += t.stake_usd ?? 0;
  }

  const sweep = [];
  for (const threshold of EDGE_GRID) {
    const agg = { threshold, n: 0, wins: 0, flatPnl: 0, kellyPnl: 0,
                  flatStake: 0, kellyStake: 0, byCity: new Map() };
    for (const t of trades) {
      const price = t.entry_price;
      const modelProb = t.model_prob;
      if (price < MIN_PRICE || price > MAX_PRICE) continue;
      const edge = modelProb - price;
      if (edge < threshold) continue;

      const win = t.result === 'WIN';
      const kMult = parseKellyMult(t.notes);
      const kStake = kellyStake(modelProb, price, kMult);
      const flat = hypotheticalPnl(price, win, FLAT_STAKE);
      const kelly = hypotheticalPnl(price, win, kStake);
      agg.n += 1;
      agg.wins += win ? 1 : 0;
      agg.flatPnl += flat;
      agg.kellyPnl += kelly;
      agg.flatStake += FLAT_STAKE;
      agg.kellyStake += kStake;
      if (!agg.byCity.has(t.city)) {
        agg.byCity.set(t.city, { n: 0, wins: 0, flatPnl: 0, kellyPnl: 0,
                                  flatStake: 0, kellyStake: 0 });
      }
      const c = agg.byCity.get(t.city);
      c.n += 1;
      c.wins += win ? 1 : 0;
      c.flatPnl += flat;
      c.kellyPnl += kelly;
      c.flatStake += FLAT_STAKE;
      c.kellyStake += kStake;
    }
    sweep.push(agg);
  }
  return { actual, sweep };
}

const historicalForecastCache = new Map();
async function fetchHistoricalForecastC(cityMeta, eventDate) {
  const key = `${cityMeta.name}|${eventDate}`;
  if (historicalForecastCache.has(key)) return historicalForecastCache.get(key);
  const models = MODEL_CANDIDATES[cityMeta.name];
  const joined = [...(models?.shortRange ?? []), ...(models?.global ?? [])]
    .filter(Boolean);
  const modelParam = joined.length ? joined.join(',') : 'ecmwf_ifs025,gfs_seamless';
  const params = new URLSearchParams({
    latitude: String(cityMeta.lat),
    longitude: String(cityMeta.lon),
    start_date: eventDate,
    end_date: eventDate,
    daily: 'temperature_2m_max',
    timezone: cityMeta.tz,
    models: modelParam,
  });
  let result = null;
  try {
    const res = await fetchJson(`${OM_HIST_FORECAST}?${params}`, { retries: 2, retryDelayMs: 1500 });
    const vals = [];
    for (const model of joined) {
      const arr = res?.daily?.[`temperature_2m_max_${model}`];
      const v = Array.isArray(arr) ? Number.parseFloat(arr[0]) : NaN;
      if (Number.isFinite(v)) vals.push(v);
    }
    // Open-Meteo sometimes returns a plain `temperature_2m_max` too.
    const plain = res?.daily?.temperature_2m_max;
    if (Array.isArray(plain) && plain.length) {
      const v = Number.parseFloat(plain[0]);
      if (Number.isFinite(v) && vals.length === 0) vals.push(v);
    }
    if (vals.length) result = vals.reduce((a, b) => a + b, 0) / vals.length;
  } catch {
    result = null;
  }
  historicalForecastCache.set(key, result);
  return result;
}

const priceHistoryCache = new Map();
async function fetchPriceAt(tokenId, entryTime) {
  let history = priceHistoryCache.get(tokenId);
  if (!history) {
    try {
      const res = await fetchJson(
        `${CLOB_HISTORY}?market=${tokenId}&interval=max&fidelity=60`,
        { retries: 2, retryDelayMs: 1000 }
      );
      history = res?.history || [];
    } catch {
      history = [];
    }
    priceHistoryCache.set(tokenId, history);
  }
  if (!history.length) return null;
  let best = null;
  let bestDiff = Infinity;
  for (const pt of history) {
    const ts = (pt.t ?? pt.ts ?? 0) * 1000;
    const diff = Math.abs(ts - entryTime);
    if (diff < bestDiff) { best = pt; bestDiff = diff; }
  }
  if (!best || bestDiff > ENTRY_TOLERANCE_MS) return null;
  const price = Number.parseFloat(best.p ?? best.price);
  return Number.isFinite(price) ? price : null;
}

async function simulateEvent(city, eventDate, anchorTrade, calibrationMap, oldConditionIds, stats) {
  const cityMeta = cityByName.get(city);
  if (!cityMeta) return [];
  const slug = extractEventSlug(anchorTrade.market_url);
  if (!slug) { stats.noSlug += 1; return []; }

  let event;
  try {
    event = await fetchJson(`${GAMMA_EVENT}/${slug}`, { retries: 2, retryDelayMs: 1000 });
  } catch {
    stats.gammaErr += 1;
    return [];
  }
  if (!Array.isArray(event?.markets) || event.markets.length === 0) {
    stats.noMarkets += 1;
    return [];
  }

  const eventEnd = event.endDate || event.end_date_iso;
  if (!eventEnd) { stats.noEnd += 1; return []; }
  const entryTime = new Date(eventEnd).getTime() - ENTRY_OFFSET_MS;

  const type = detectMarketType(event.markets[0]?.question) || 'temp_max';
  const cal = calibrationMap.get(`${city}|${type}`);
  // Prefer the sigma that was actually in effect at trade time (from the anchor
  // trade's notes) — matches the distribution used to compute the stored
  // model_prob. Fall back to current-calibration lookup.
  const sigmaNative = parseSigmaFromNotes(anchorTrade.notes);
  const sigmaC = sigmaNative != null
    ? (cityMeta.unit === 'F' ? (sigmaNative * 5) / 9 : sigmaNative)
    : sigmaInC(cityMeta.unit, cal);
  const bias = Number.isFinite(cal?.bias) ? cal.bias : 0;
  const forecastC = forecastInC(anchorTrade.forecast_temp, cityMeta.unit);
  if (forecastC == null) { stats.noForecast += 1; return []; }

  const candidates = [];
  for (const market of event.markets) {
    if (!market?.question) continue;
    const range = parseRangeC(market.question);
    if (!range) continue;
    const tokenIds = parseJsonArray(market.clobTokenIds);
    const outcomes = parseJsonArray(market.outcomes);
    const finalPrices = parseJsonArray(market.outcomePrices);
    const yesIdx = outcomes.findIndex((o) => String(o).toLowerCase() === 'yes');
    if (yesIdx < 0 || !tokenIds[yesIdx]) continue;
    const finalYes = Number.parseFloat(finalPrices[yesIdx] ?? '0');
    if (!Number.isFinite(finalYes)) continue;
    const won = finalYes >= 0.95;

    const z1 = (range.lowC - forecastC) / sigmaC;
    const z2 = (range.highC - forecastC) / sigmaC;
    const rawProb = Math.max(0, normalCdf(z2) - normalCdf(z1));
    const modelProb = Math.max(0, Math.min(1, rawProb + bias));

    stats.bucketsSeen += 1;
    const entryPrice = await fetchPriceAt(tokenIds[yesIdx], entryTime);
    if (entryPrice == null) { stats.priceMiss += 1; continue; }

    const midC = (range.lowC + range.highC) / 2;
    candidates.push({
      conditionId: market.conditionId,
      question: market.question,
      modelProb,
      entryPrice,
      edge: modelProb - entryPrice,
      midC,
      rangeLowC: range.lowC,
      rangeHighC: range.highC,
      distanceC: Math.abs(midC - forecastC),
      won,
      isNew: !oldConditionIds.has(market.conditionId),
    });
  }
  if (debug) {
    console.error(`[debug] ${city} ${eventDate}: forecastC=${forecastC?.toFixed(2)} sigmaC=${sigmaC?.toFixed(2)} bias=${bias.toFixed(3)} — ${candidates.length} buckets with prices`);
    for (const c of candidates) {
      const flag = c.isNew ? 'NEW' : 'OLD';
      const tag = (c.entryPrice >= MIN_PRICE && c.entryPrice <= MAX_PRICE && c.edge >= 0.05) ? '✓' : ' ';
      console.error(`  ${tag} ${flag} p=${c.entryPrice.toFixed(3)} mProb=${c.modelProb.toFixed(3)} edge=${c.edge.toFixed(3)} distC=${c.distanceC.toFixed(2)} won=${c.won ? 'Y' : 'N'} | ${c.question.slice(0, 60)}`);
    }
  }
  return candidates;
}

async function phaseB(trades, calibrationMap) {
  const groups = new Map();
  for (const t of trades) {
    const key = `${t.city}|${t.event_date}`;
    if (!groups.has(key)) groups.set(key, { city: t.city, eventDate: t.event_date, trades: [] });
    groups.get(key).trades.push(t);
  }
  const entries = Array.from(groups.values());
  const work = eventLimit ? entries.slice(0, eventLimit) : entries;

  const stats = {
    eventsSeen: work.length,
    noSlug: 0, gammaErr: 0, noMarkets: 0, noEnd: 0, noForecast: 0,
    bucketsSeen: 0, priceMiss: 0,
    byThreshold: new Map(),
    phaseC: {
      n: 0, nNew: 0, wins: 0, winsNew: 0,
      flatPnl: 0, flatPnlNew: 0, kellyPnl: 0, kellyPnlNew: 0,
      flatStake: 0, kellyStake: 0,
      byCity: new Map(),
    },
    phaseD: {
      n: 0, wins: 0,
      flatPnl: 0, kellyPnl: 0, flatStake: 0, kellyStake: 0,
      forecastMiss: 0,
      byCity: new Map(),
    },
  };
  for (const threshold of EDGE_GRID) {
    stats.byThreshold.set(threshold, {
      threshold, n: 0, nNew: 0, wins: 0, winsNew: 0,
      flatPnl: 0, flatPnlNew: 0, kellyPnl: 0, kellyPnlNew: 0,
      flatStake: 0, kellyStake: 0,
      byCity: new Map(),
    });
  }

  let processed = 0;
  const queue = work.slice();
  async function worker() {
    while (queue.length) {
      const g = queue.shift();
      if (!g) return;
      const anchor = g.trades[0];
      const oldConditionIds = new Set(
        g.trades.map((t) => t.condition_id).filter(Boolean)
      );
      const candidates = await simulateEvent(
        g.city, g.eventDate, anchor, calibrationMap, oldConditionIds, stats
      );
      const kMult = parseKellyMult(anchor.notes);

      // --- Phase B: edge-filtered, top-3 by edge ---
      for (const threshold of EDGE_GRID) {
        const eligible = candidates.filter(
          (c) => c.entryPrice >= MIN_PRICE && c.entryPrice <= MAX_PRICE && c.edge >= threshold
        );
        eligible.sort((a, b) => b.edge - a.edge);
        const chosen = eligible.slice(0, 3);
        const agg = stats.byThreshold.get(threshold);
        if (!agg.byCity.has(g.city)) {
          agg.byCity.set(g.city, { n: 0, nNew: 0, wins: 0, winsNew: 0,
            flatPnl: 0, flatPnlNew: 0, kellyPnl: 0, kellyPnlNew: 0,
            flatStake: 0, kellyStake: 0 });
        }
        const cityAgg = agg.byCity.get(g.city);
        for (const c of chosen) {
          const kStake = kellyStake(c.modelProb, c.entryPrice, kMult);
          const flat = hypotheticalPnl(c.entryPrice, c.won, FLAT_STAKE);
          const kelly = hypotheticalPnl(c.entryPrice, c.won, kStake);
          agg.n += 1; cityAgg.n += 1;
          agg.flatPnl += flat; cityAgg.flatPnl += flat;
          agg.kellyPnl += kelly; cityAgg.kellyPnl += kelly;
          agg.flatStake += FLAT_STAKE; cityAgg.flatStake += FLAT_STAKE;
          agg.kellyStake += kStake; cityAgg.kellyStake += kStake;
          if (c.won) { agg.wins += 1; cityAgg.wins += 1; }
          if (c.isNew) {
            agg.nNew += 1; cityAgg.nNew += 1;
            agg.flatPnlNew += flat; cityAgg.flatPnlNew += flat;
            agg.kellyPnlNew += kelly; cityAgg.kellyPnlNew += kelly;
            if (c.won) { agg.winsNew += 1; cityAgg.winsNew += 1; }
          }
        }
      }

      // --- Phase C: proximity-only, top-3 closest to forecast ---
      // No edge filter, no price filter beyond excluding settled zeroes.
      const cCandidates = candidates.filter((c) => c.entryPrice >= 0.01);
      cCandidates.sort((a, b) => a.distanceC - b.distanceC);
      const cChosen = cCandidates.slice(0, 3);
      const cAgg = stats.phaseC;
      if (!cAgg.byCity.has(g.city)) {
        cAgg.byCity.set(g.city, { n: 0, nNew: 0, wins: 0, winsNew: 0,
          flatPnl: 0, flatPnlNew: 0, kellyPnl: 0, kellyPnlNew: 0,
          flatStake: 0, kellyStake: 0 });
      }
      const cCityAgg = cAgg.byCity.get(g.city);
      for (const c of cChosen) {
        const kStake = kellyStake(c.modelProb, c.entryPrice, kMult);
        const flat = hypotheticalPnl(c.entryPrice, c.won, FLAT_STAKE);
        const kelly = hypotheticalPnl(c.entryPrice, c.won, kStake);
        cAgg.n += 1; cCityAgg.n += 1;
        cAgg.flatPnl += flat; cCityAgg.flatPnl += flat;
        cAgg.kellyPnl += kelly; cCityAgg.kellyPnl += kelly;
        cAgg.flatStake += FLAT_STAKE; cCityAgg.flatStake += FLAT_STAKE;
        cAgg.kellyStake += kStake; cCityAgg.kellyStake += kStake;
        if (c.won) { cAgg.wins += 1; cCityAgg.wins += 1; }
        if (c.isNew) {
          cAgg.nNew += 1; cCityAgg.nNew += 1;
          cAgg.flatPnlNew += flat; cCityAgg.flatPnlNew += flat;
          cAgg.kellyPnlNew += kelly; cCityAgg.kellyPnlNew += kelly;
          if (c.won) { cAgg.winsNew += 1; cCityAgg.winsNew += 1; }
        }
      }

      // --- Phase D: station-corrected forecast + proximity pick ---
      // Only for cities whose station/lat-lon was fixed. Re-fetch historical
      // forecast at the corrected coordinates via Open-Meteo, recompute
      // modelProb + distance with default sigma and bias=0, then take top-3
      // closest to the new forecast.
      if (MISMATCH_CITIES.has(g.city)) {
        const cityMeta = cityByName.get(g.city);
        const correctedForecastC = await fetchHistoricalForecastC(cityMeta, g.eventDate);
        const dAgg = stats.phaseD;
        if (!dAgg.byCity.has(g.city)) {
          dAgg.byCity.set(g.city, { n: 0, wins: 0, flatPnl: 0, kellyPnl: 0,
            flatStake: 0, kellyStake: 0, eventsCovered: 0, forecastMiss: 0 });
        }
        const dCityAgg = dAgg.byCity.get(g.city);
        if (correctedForecastC == null) {
          dAgg.forecastMiss += 1;
          dCityAgg.forecastMiss += 1;
        } else {
          dCityAgg.eventsCovered += 1;
          const defaultSigmaC = cityMeta.unit === 'F' ? (SIGMA_F * 5) / 9 : SIGMA_C;
          const dRescored = candidates
            .filter((c) => c.entryPrice >= 0.01)
            .map((c) => {
              const z1 = (c.rangeLowC - correctedForecastC) / defaultSigmaC;
              const z2 = (c.rangeHighC - correctedForecastC) / defaultSigmaC;
              const modelProb = Math.max(0, Math.min(1, normalCdf(z2) - normalCdf(z1)));
              return {
                ...c,
                modelProb,
                distanceC: Math.abs(c.midC - correctedForecastC),
              };
            });
          dRescored.sort((a, b) => a.distanceC - b.distanceC);
          const dChosen = dRescored.slice(0, 3);
          for (const c of dChosen) {
            const kStake = kellyStake(c.modelProb, c.entryPrice, kMult);
            const flat = hypotheticalPnl(c.entryPrice, c.won, FLAT_STAKE);
            const kelly = hypotheticalPnl(c.entryPrice, c.won, kStake);
            dAgg.n += 1; dCityAgg.n += 1;
            dAgg.flatPnl += flat; dCityAgg.flatPnl += flat;
            dAgg.kellyPnl += kelly; dCityAgg.kellyPnl += kelly;
            dAgg.flatStake += FLAT_STAKE; dCityAgg.flatStake += FLAT_STAKE;
            dAgg.kellyStake += kStake; dCityAgg.kellyStake += kStake;
            if (c.won) { dAgg.wins += 1; dCityAgg.wins += 1; }
          }
        }
      }
      processed += 1;
      if (processed % 10 === 0) {
        console.error(`[replay] ${processed}/${work.length} events processed (price misses ${stats.priceMiss}/${stats.bucketsSeen})`);
      }
    }
  }
  await Promise.all(Array.from({ length: REPLAY_CONCURRENCY }, () => worker()));
  return stats;
}

function printPhaseA(phaseAResult) {
  const { actual, sweep } = phaseAResult;
  const wr = actual.n ? actual.wins / actual.n : null;
  const roi = actual.stake ? actual.pnl / actual.stake : null;
  console.log('=== Baseline (actual) ===');
  console.log(`${actual.n} trades · ${actual.wins} wins · WR ${fmtPct(wr)} · stake ${fmtUsd(actual.stake)} · pnl ${fmtUsd(actual.pnl)} · ROI ${fmtPct(roi)}`);
  console.log();
  console.log('=== Phase A — Filter replay on historical rows ===');
  console.log(`${pad('edge≥', 7)} ${pad('kept', 5, 'right')} ${pad('WR', 7, 'right')} ${pad('flat pnl', 10, 'right')} ${pad('flat ROI', 9, 'right')} ${pad('kelly pnl', 11, 'right')} ${pad('kelly ROI', 10, 'right')}`);
  for (const s of sweep) {
    const sWr = s.n ? s.wins / s.n : null;
    const fRoi = s.flatStake ? s.flatPnl / s.flatStake : null;
    const kRoi = s.kellyStake ? s.kellyPnl / s.kellyStake : null;
    console.log(
      `${pad(s.threshold.toFixed(2), 7)} ${pad(s.n, 5, 'right')} ${pad(fmtPct(sWr), 7, 'right')} ${pad(fmtUsd(s.flatPnl), 10, 'right')} ${pad(fmtPct(fRoi), 9, 'right')} ${pad(fmtUsd(s.kellyPnl), 11, 'right')} ${pad(fmtPct(kRoi), 10, 'right')}`
    );
  }
}

function printPerCity(phaseAResult, phaseBStats) {
  const { actual, sweep } = phaseAResult;
  const aAgg = sweep.find((s) => s.threshold === DEFAULT_THRESHOLD) || sweep[0];
  const bAgg = phaseBStats?.byThreshold.get(DEFAULT_THRESHOLD) || null;
  console.log();
  console.log(`=== Per-city at edge≥${DEFAULT_THRESHOLD} ===`);
  console.log(`${pad('city', 16)} ${pad('old n/WR/ROI', 22)} ${pad('A-kept n/WR/flat/kelly', 28)} ${pad('B-new n/WR/flat/kelly', 28)}`);
  const cities = new Set([...actual.byCity.keys()]);
  for (const city of Array.from(cities).sort()) {
    const old = actual.byCity.get(city);
    const oldWr = old.n ? old.wins / old.n : null;
    const oldRoi = old.stake ? old.pnl / old.stake : null;
    const a = aAgg.byCity.get(city) || null;
    const aWr = a?.n ? a.wins / a.n : null;
    const aFRoi = a?.flatStake ? a.flatPnl / a.flatStake : null;
    const aKRoi = a?.kellyStake ? a.kellyPnl / a.kellyStake : null;
    const b = bAgg?.byCity.get(city) || null;
    const bWr = b?.nNew ? b.winsNew / b.nNew : null;
    const bFlat = b?.flatPnlNew ?? null;
    const bKelly = b?.kellyPnlNew ?? null;
    console.log(
      `${pad(city, 16)} ${pad(`${old.n}/${fmtPct(oldWr, 0)}/${fmtPct(oldRoi, 0)}`, 22)} ${pad(a ? `${a.n}/${fmtPct(aWr, 0)}/${fmtUsd(a.flatPnl)}/${fmtUsd(a.kellyPnl)}` : '0/-/-/-', 28)} ${pad(b ? `${b.nNew}/${fmtPct(bWr, 0)}/${fmtUsd(bFlat)}/${fmtUsd(bKelly)}` : '-', 28)}`
    );
  }
}

function printPhaseBSummary(stats) {
  if (!stats) return;
  console.log();
  console.log('=== Phase B — Full market replay (all buckets per event) ===');
  console.log(`events ${stats.eventsSeen} · buckets seen ${stats.bucketsSeen} · price-history misses ${stats.priceMiss} (${stats.bucketsSeen ? fmtPct(stats.priceMiss / stats.bucketsSeen) : 'N/A'}) · no-slug ${stats.noSlug} · gamma-err ${stats.gammaErr} · no-markets ${stats.noMarkets} · no-end ${stats.noEnd} · no-forecast ${stats.noForecast}`);
  console.log(`${pad('edge≥', 7)} ${pad('total n', 8, 'right')} ${pad('new n', 6, 'right')} ${pad('WR(new)', 9, 'right')} ${pad('flat(new)', 11, 'right')} ${pad('flat ROI', 9, 'right')} ${pad('kelly(new)', 12, 'right')} ${pad('kelly ROI', 10, 'right')}`);
  for (const threshold of EDGE_GRID) {
    const a = stats.byThreshold.get(threshold);
    const wrNew = a.nNew ? a.winsNew / a.nNew : null;
    const flatStakeNew = a.nNew * FLAT_STAKE;
    const fRoi = flatStakeNew ? a.flatPnlNew / flatStakeNew : null;
    const kRoi = a.kellyStake && a.nNew ? a.kellyPnlNew / (a.kellyStake * a.nNew / Math.max(a.n, 1)) : null;
    console.log(
      `${pad(threshold.toFixed(2), 7)} ${pad(a.n, 8, 'right')} ${pad(a.nNew, 6, 'right')} ${pad(fmtPct(wrNew), 9, 'right')} ${pad(fmtUsd(a.flatPnlNew), 11, 'right')} ${pad(fmtPct(fRoi), 9, 'right')} ${pad(fmtUsd(a.kellyPnlNew), 12, 'right')} ${pad(fmtPct(kRoi), 10, 'right')}`
    );
  }
}

function printPhaseCSummary(stats, actualByCity) {
  if (!stats?.phaseC) return;
  const c = stats.phaseC;
  const wrAll = c.n ? c.wins / c.n : null;
  const wrNew = c.nNew ? c.winsNew / c.nNew : null;
  const flatRoi = c.flatStake ? c.flatPnl / c.flatStake : null;
  const kellyRoi = c.kellyStake ? c.kellyPnl / c.kellyStake : null;
  const flatRoiNew = c.nNew ? c.flatPnlNew / (c.nNew * FLAT_STAKE) : null;
  console.log();
  console.log('=== Phase C — Proximity-only (3 closest to forecast, no edge filter) ===');
  console.log(`total ${c.n} entries (${c.nNew} new) · WR all ${fmtPct(wrAll)} · WR new ${fmtPct(wrNew)}`);
  console.log(`flat pnl ${fmtUsd(c.flatPnl)} (${fmtPct(flatRoi)} ROI) · new-only ${fmtUsd(c.flatPnlNew)} (${fmtPct(flatRoiNew)} ROI)`);
  console.log(`kelly pnl ${fmtUsd(c.kellyPnl)} (${fmtPct(kellyRoi)} ROI) · new-only ${fmtUsd(c.kellyPnlNew)}`);
  console.log();
  console.log('Per-city (Phase C):');
  console.log(`${pad('city', 16)} ${pad('old (n/WR/ROI)', 20)} ${pad('C-all (n/WR/flat/kelly)', 32)} ${pad('C-new (n/WR/flat)', 24)}`);
  const cities = new Set(actualByCity.keys());
  for (const city of Array.from(cities).sort()) {
    const old = actualByCity.get(city);
    const oldWr = old.n ? old.wins / old.n : null;
    const oldRoi = old.stake ? old.pnl / old.stake : null;
    const row = c.byCity.get(city);
    const rWr = row?.n ? row.wins / row.n : null;
    const rWrNew = row?.nNew ? row.winsNew / row.nNew : null;
    const oldStr = `${old.n}/${fmtPct(oldWr, 0)}/${fmtPct(oldRoi, 0)}`;
    const allStr = row
      ? `${row.n}/${fmtPct(rWr, 0)}/${fmtUsd(row.flatPnl)}/${fmtUsd(row.kellyPnl)}`
      : '0/-/-/-';
    const newStr = row
      ? `${row.nNew}/${fmtPct(rWrNew, 0)}/${fmtUsd(row.flatPnlNew)}`
      : '-';
    console.log(`${pad(city, 16)} ${pad(oldStr, 20)} ${pad(allStr, 32)} ${pad(newStr, 24)}`);
  }
}

function printPhaseDSummary(stats, actualByCity, phaseCStats) {
  if (!stats?.phaseD) return;
  const d = stats.phaseD;
  const c = phaseCStats;
  const wrAll = d.n ? d.wins / d.n : null;
  const flatRoi = d.flatStake ? d.flatPnl / d.flatStake : null;
  const kellyRoi = d.kellyStake ? d.kellyPnl / d.kellyStake : null;
  console.log();
  console.log('=== Phase D — Station-corrected replay (mismatched cities only) ===');
  console.log(`Scope: ${[...MISMATCH_CITIES].join(', ')}`);
  console.log(`Forecast misses: ${d.forecastMiss}`);
  console.log(`total ${d.n} entries · WR ${fmtPct(wrAll)} · flat ${fmtUsd(d.flatPnl)} (${fmtPct(flatRoi)} ROI) · kelly ${fmtUsd(d.kellyPnl)} (${fmtPct(kellyRoi)} ROI)`);
  console.log();
  console.log(`${pad('city', 16)} ${pad('old (n/WR/ROI)', 20)} ${pad('Phase C (n/WR/flat/kelly)', 32)} ${pad('Phase D (n/WR/flat/kelly)', 32)}`);
  for (const city of [...MISMATCH_CITIES].sort()) {
    const old = actualByCity.get(city) ?? { n: 0, wins: 0, pnl: 0, stake: 0 };
    const oldWr = old.n ? old.wins / old.n : null;
    const oldRoi = old.stake ? old.pnl / old.stake : null;
    const cRow = c?.byCity?.get(city);
    const cWr = cRow?.n ? cRow.wins / cRow.n : null;
    const dRow = d.byCity.get(city);
    const dWr = dRow?.n ? dRow.wins / dRow.n : null;
    const oldStr = `${old.n}/${fmtPct(oldWr, 0)}/${fmtPct(oldRoi, 0)}`;
    const cStr = cRow ? `${cRow.n}/${fmtPct(cWr, 0)}/${fmtUsd(cRow.flatPnl)}/${fmtUsd(cRow.kellyPnl)}` : '-';
    const dStr = dRow ? `${dRow.n}/${fmtPct(dWr, 0)}/${fmtUsd(dRow.flatPnl)}/${fmtUsd(dRow.kellyPnl)}` : '-';
    console.log(`${pad(city, 16)} ${pad(oldStr, 20)} ${pad(cStr, 32)} ${pad(dStr, 32)}`);
  }
}

function printCaveats() {
  console.log();
  console.log('=== Caveats ===');
  console.log('• Phase A: replays the NEW filter on buckets the OLD bot actually bought.');
  console.log('  Reliable for "would the new filter have dropped the losers?".');
  console.log('• Phase B: enumerates every range market per event, fetches CLOB prices-history');
  console.log('  near endDate-3h, and simulates the new top-3-by-edge selection. Only covers');
  console.log('  events the old bot engaged (so forecast_temp is on a stored trade row).');
  console.log('• Sigma/bias used in Phase B is the CURRENT calibration snapshot, not per-day.');
  console.log('  Bias drifts via 0.9·old + 0.1·err, so recent values approximate history well.');
  console.log('• Kelly sizing uses kellyMultiplier parsed from the anchor trade\'s notes');
  console.log('  (live value at that event). Missing → defaults to 0.5.');
  console.log('• Price-history misses occur when CLOB has no samples within ±30min of');
  console.log('  entry (resolved markets may be thinly sampled). Count reported above.');
  console.log('• Baseline totals must match /api/weather/summary rolling to validate the query.');
}

(async () => {
  console.error('[backtest] loading resolved trades...');
  const trades = await loadResolvedTrades();
  console.error(`[backtest] ${trades.length} resolved paper trades${cityFilter ? ` (city=${cityFilter})` : ''}`);
  const calibration = await loadCalibration();
  console.error(`[backtest] ${calibration.size} calibration rows`);

  const phaseAResult = phaseA(trades);
  let phaseBStats = null;
  if (runPhaseB) {
    console.error('[backtest] starting phase B market replay...');
    phaseBStats = await phaseB(trades, calibration);
  } else {
    console.error('[backtest] phase B skipped (--skip-phase-b)');
  }

  printPhaseA(phaseAResult);
  printPhaseBSummary(phaseBStats);
  printPerCity(phaseAResult, phaseBStats);
  printPhaseCSummary(phaseBStats, phaseAResult.actual.byCity);
  printPhaseDSummary(phaseBStats, phaseAResult.actual.byCity, phaseBStats?.phaseC);
  printCaveats();
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
