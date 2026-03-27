import { createClient } from '@supabase/supabase-js';

const TABLE_NAME = 'signal_ticks';
const FLUSH_BATCH_SIZE = 10;
const FLUSH_INTERVAL_MS = 30_000;

let client = null;
let initPromise = null;
let initChecked = false;
let recorderEnabled = true;
let flushTimer = null;
let flushInFlight = null;
const buffer = [];

function toNum(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function scheduleFlush() {
  if (flushTimer || !recorderEnabled) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    void flushTicks();
  }, FLUSH_INTERVAL_MS);
}

function clearFlushTimer() {
  if (!flushTimer) return;
  clearTimeout(flushTimer);
  flushTimer = null;
}

function getClient() {
  if (client || !recorderEnabled) return client;

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    recorderEnabled = false;
    console.warn('[tickRecorder] SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY missing; tick recording disabled.');
    return null;
  }

  client = createClient(url, key, {
    auth: { persistSession: false },
  });

  return client;
}

export async function initTickRecorder() {
  if (initChecked) return recorderEnabled;
  if (initPromise) return initPromise;

  initPromise = (async () => {
    const supabase = getClient();
    if (!supabase) {
      initChecked = true;
      return false;
    }

    try {
      const { error } = await supabase
        .from(TABLE_NAME)
        .select('id', { head: true, count: 'exact' })
        .limit(1);

      if (error) {
        recorderEnabled = false;
        console.warn(`[tickRecorder] ${TABLE_NAME} check failed: ${error.message}`);
      }
    } catch (error) {
      recorderEnabled = false;
      console.warn(`[tickRecorder] ${TABLE_NAME} init failed: ${error?.message || error}`);
    } finally {
      initChecked = true;
    }

    return recorderEnabled;
  })();

  return initPromise;
}

function normalizeTick(signals, timeframe) {
  if (!signals?.market?.slug) return null;

  return {
    timeframe,
    market_slug: signals.market.slug,
    time_left_min: toNum(signals.timeLeftMin),
    poly_up: toNum(signals.polyPricesCents?.UP),
    poly_down: toNum(signals.polyPricesCents?.DOWN),
    model_up: toNum(signals.modelUp),
    model_down: toNum(signals.modelDown),
    rsi: toNum(signals.indicators?.rsiNow),
    rec_action: signals.rec?.action ?? null,
    rec_side: signals.rec?.side ?? null,
    rec_phase: signals.rec?.phase ?? null,
    rec_edge: toNum(signals.rec?.edge),
    spread_up: toNum(signals.polyMarketSnapshot?.orderbook?.up?.spread),
    spread_down: toNum(signals.polyMarketSnapshot?.orderbook?.down?.spread),
    btc_spot: toNum(signals.spot?.price),
    spot_delta_1m_pct: toNum(signals.spot?.delta1mPct),
    liquidity: toNum(signals.market?.liquidityNum),
    volume: toNum(signals.market?.volumeNum),
  };
}

export function recordTick(signals, timeframe) {
  void initTickRecorder().then((ready) => {
    if (!ready) return;

    const tick = normalizeTick(signals, timeframe);
    if (!tick) return;

    buffer.push(tick);

    if (buffer.length >= FLUSH_BATCH_SIZE) {
      clearFlushTimer();
      void flushTicks();
      return;
    }

    scheduleFlush();
  }).catch((error) => {
    console.warn(`[tickRecorder] recordTick init failed: ${error?.message || error}`);
  });
}

export async function flushTicks() {
  if (flushInFlight) return flushInFlight;

  flushInFlight = (async () => {
    const ready = await initTickRecorder();
    if (!ready || buffer.length === 0) return;

    clearFlushTimer();
    const batch = buffer.splice(0, FLUSH_BATCH_SIZE);

    try {
      const { error } = await client
        .from(TABLE_NAME)
        .insert(batch);

      if (error) {
        buffer.unshift(...batch);
        console.warn(`[tickRecorder] flush failed: ${error.message}`);
        scheduleFlush();
      } else if (buffer.length > 0) {
        scheduleFlush();
      }
    } catch (error) {
      buffer.unshift(...batch);
      console.warn(`[tickRecorder] flush error: ${error?.message || error}`);
      scheduleFlush();
    }
  })();

  try {
    await flushInFlight;
  } finally {
    flushInFlight = null;
  }
}
