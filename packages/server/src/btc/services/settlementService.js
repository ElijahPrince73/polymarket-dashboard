const SETTLEMENT_SLUG_RE = /(\d{10})$/;
const CHECK_INTERVAL_MS = 10_000; // check every 10s for tighter settlement capture
const SETTLEMENT_GRACE_MS = 3_000; // 3s after settlement to let price stabilize
const MAX_BACKFILL_AGE_MS = 30 * 60_000; // backfill within 30 min — Polymarket API is source of truth anyway

let _lastCheckAtMs = 0;
// Ring buffer of recent BTC prices for settlement capture
const _priceSnapshots = []; // { ts: epochMs, price: number }
const MAX_SNAPSHOTS = 600; // ~10 min at 1/sec

function toFiniteNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/**
 * Record a BTC price snapshot. Call every tick (~1s) from the main loop.
 * Used to find the closest price to the actual settlement moment.
 */
export function recordPriceSnapshot(price) {
  const p = toFiniteNumber(price);
  if (p === null) return;
  _priceSnapshots.push({ ts: Date.now(), price: p });
  if (_priceSnapshots.length > MAX_SNAPSHOTS) {
    _priceSnapshots.splice(0, _priceSnapshots.length - MAX_SNAPSHOTS);
  }
}

/**
 * Find the BTC price closest to a given timestamp from our snapshot buffer.
 * Returns null if no snapshot within 10s of the target.
 */
function getPriceAtTime(targetMs) {
  if (_priceSnapshots.length === 0) return null;
  let best = null;
  let bestDiff = Infinity;
  for (const snap of _priceSnapshots) {
    const diff = Math.abs(snap.ts - targetMs);
    if (diff < bestDiff) {
      bestDiff = diff;
      best = snap;
    }
  }
  // Only trust if within 10s of settlement
  if (bestDiff > 10_000) return null;
  return best?.price ?? null;
}

function syncTradeToStoreByMarket(trade) {
  const slug = String(trade?.marketSlug || '');
  const is15m = slug.startsWith('btc-updown-15m-') || trade?.timeframe === '15m';
  const fn = is15m ? globalThis.__syncTradeToStore15m : globalThis.__syncTradeToStore;
  if (typeof fn === 'function') {
    return fn({ ...trade, timeframe: is15m ? '15m' : '5m' }, trade.mode || 'paper');
  }
  return null;
}

/**
 * Fetch the definitive outcome from Polymarket's Gamma API.
 * Returns 'UP' or 'DOWN' if resolved, null if not yet resolved.
 */
export async function fetchPolymarketOutcome(marketSlug) {
  if (!marketSlug) return null;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    const res = await fetch(
      `https://gamma-api.polymarket.com/markets?slug=${encodeURIComponent(marketSlug)}`,
      { signal: controller.signal, headers: { 'User-Agent': 'PolyDashboard/1.0' } }
    );
    clearTimeout(timer);
    if (!res.ok) return null;
    
    const data = await res.json();
    const market = Array.isArray(data) ? data[0] : null;
    if (!market) return null;
    
    // outcomePrices: ["1","0"] means Up won, ["0","1"] means Down won
    // outcomes: ["Up","Down"]
    const prices = market.outcomePrices;
    const outcomes = market.outcomes;
    if (!Array.isArray(prices) || !Array.isArray(outcomes)) return null;
    
    // Find which outcome has price "1" (the winner)
    for (let i = 0; i < prices.length; i++) {
      if (prices[i] === '1' || Number(prices[i]) === 1) {
        const winner = (outcomes[i] || '').toUpperCase();
        if (winner === 'UP' || winner === 'DOWN') return winner;
      }
    }
    
    return null; // not resolved yet or ambiguous
  } catch {
    return null; // timeout or network error — fall back to price snapshot
  }
}

export function parseSettlementMsFromSlug(marketSlug) {
  const match = typeof marketSlug === 'string' ? marketSlug.match(SETTLEMENT_SLUG_RE) : null;
  if (!match) return null;
  const tsSec = Number(match[1]);
  if (!Number.isFinite(tsSec)) return null;
  // Slug epoch is the MARKET START time, not settlement.
  // Settlement is 5 minutes (300s) after market opens.
  return (tsSec + 300) * 1000;
}

export function deriveMarketSettlementTime(marketSlug) {
  const settlementMs = parseSettlementMsFromSlug(marketSlug);
  return settlementMs ? new Date(settlementMs).toISOString() : null;
}

function hasSettlementBackfill(trade) {
  return trade?.settlementSide !== undefined && trade?.settlementSide !== null;
}

async function persistTrade(store, trade) {
  if (!store || !trade?.id) return false;
  if (typeof store.insertTrade === 'function') {
    await store.insertTrade(trade, trade.mode || 'paper');
    return true;
  }
  if (typeof store.upsertTrade === 'function') {
    await store.upsertTrade(trade);
    return true;
  }
  return false;
}

export async function checkSettlements({ currentPrice, nowMs = Date.now() } = {}) {
  if (nowMs - _lastCheckAtMs < CHECK_INTERVAL_MS) return;
  _lastCheckAtMs = nowMs;

  const btcNow = toFiniteNumber(currentPrice);
  if (btcNow === null) return;

  const getStore = globalThis.__tradeStore_getTradeStore;
  if (typeof getStore !== 'function') return;

  let store;
  try {
    store = getStore();
  } catch {
    return;
  }
  if (!store || typeof store.getAllTrades !== 'function') return;

  const trades = await store.getAllTrades();
  if (!Array.isArray(trades) || trades.length === 0) return;

  for (const trade of trades) {
    if (trade?.status !== 'CLOSED' || hasSettlementBackfill(trade)) continue;

    const settlementMs = parseSettlementMsFromSlug(trade.marketSlug);
    if (!settlementMs) continue;
    if (nowMs < settlementMs + SETTLEMENT_GRACE_MS) continue;
    if (nowMs > settlementMs + MAX_BACKFILL_AGE_MS) continue;

    const btcAtEntry = toFiniteNumber(trade.btcSpotAtEntry);
    if (btcAtEntry === null) continue;

    // Try to get the definitive outcome from Polymarket API
    const pmOutcome = await fetchPolymarketOutcome(trade.marketSlug);
    
    let settlementSide;
    let btcAtSettle;
    
    if (pmOutcome) {
      // Definitive: Polymarket tells us who won
      settlementSide = pmOutcome;
      btcAtSettle = getPriceAtTime(settlementMs) ?? btcNow; // best-effort price
    } else {
      // Fallback: use our price snapshot
      btcAtSettle = getPriceAtTime(settlementMs) ?? btcNow;
      settlementSide = btcAtSettle > btcAtEntry ? 'UP' : 'DOWN';
    }

    const updatedTrade = {
      ...trade,
      marketSettlementTime: trade.marketSettlementTime || new Date(settlementMs).toISOString(),
      btcAtSettlement: btcAtSettle,
      settlementSide,
      settlementSource: pmOutcome ? 'polymarket' : 'price-snapshot',
      directionCorrect: trade.side === settlementSide,
    };

    try {
      const saved = await persistTrade(store, updatedTrade);
      if (!saved) {
        await syncTradeToStoreByMarket(updatedTrade);
      }
      console.log(
        `[Settlement] Trade ${updatedTrade.id}: settled ${settlementSide}, ` +
        `picked ${updatedTrade.side} -> ${updatedTrade.directionCorrect ? 'CORRECT' : 'WRONG'}`
      );
    } catch {
      // Settlement enrichment is best-effort; never break the main loop.
    }
  }
}
