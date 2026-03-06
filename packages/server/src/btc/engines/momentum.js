/**
 * Momentum-based direction model for 5-minute BTC Polymarket markets.
 *
 * Replaces the lagging-indicator scoring model (probability.js) with
 * leading signals: short-term BTC spot momentum, Polymarket price momentum,
 * and recent settlement history.
 *
 * Each signal votes UP or DOWN with a weight. Final probability is
 * derived from weighted votes, not lagging indicator counts.
 */

import { clamp } from '../utils.js';

// ── Ring buffer for Polymarket price history ──────────────────────
const polyHistory = { up: [], down: [] };
const POLY_HISTORY_MAX = 120; // keep 2 minutes of poly prices

/**
 * Record current Polymarket prices. Call every tick (~1s).
 */
export function recordPolyPrice(upPrice, downPrice) {
  const now = Date.now();
  if (typeof upPrice === 'number' && Number.isFinite(upPrice)) {
    polyHistory.up.push({ t: now, price: upPrice });
    while (polyHistory.up.length > POLY_HISTORY_MAX) polyHistory.up.shift();
  }
  if (typeof downPrice === 'number' && Number.isFinite(downPrice)) {
    polyHistory.down.push({ t: now, price: downPrice });
    while (polyHistory.down.length > POLY_HISTORY_MAX) polyHistory.down.shift();
  }
}

/**
 * Get Polymarket price delta over the last N seconds.
 * Returns fractional change (e.g., 0.05 = price went up 5¢).
 */
function getPolyDelta(side, seconds) {
  const history = side === 'UP' ? polyHistory.up : polyHistory.down;
  if (history.length < 2) return null;

  const now = history[history.length - 1];
  const cutoff = now.t - seconds * 1000;

  let base = null;
  for (let i = 0; i < history.length; i++) {
    if (history[i].t >= cutoff) {
      base = history[i].price;
      break;
    }
  }
  if (base === null) base = history[0]?.price;
  if (base === null || base === 0) return null;

  return now.price - base;
}

// ── Settlement history tracking ──────────────────────────────────
let recentSettlements = []; // [{side: 'UP'|'DOWN', slug: string}]

/**
 * Record a market settlement. Call when a market resolves.
 */
export function recordSettlement(side, slug) {
  if (!side || !slug) return;
  // Avoid duplicates
  if (recentSettlements.length && recentSettlements[recentSettlements.length - 1].slug === slug) return;
  recentSettlements.push({ side, slug, t: Date.now() });
  // Keep last 20 settlements
  while (recentSettlements.length > 20) recentSettlements.shift();
}

/**
 * Get settlement trend: fraction of last N settlements that were UP.
 */
function getSettlementTrend(n = 5) {
  const recent = recentSettlements.slice(-n);
  if (recent.length < 2) return null; // not enough data
  const upCount = recent.filter(s => s.side === 'UP').length;
  return upCount / recent.length;
}

// ── Main momentum scoring ────────────────────────────────────────

/**
 * Score direction using momentum signals.
 *
 * @param {Object} params
 * @param {Array}  params.spotTicks    - BTC spot price ticks [{t, price}]
 * @param {number} params.polyUp       - Current Polymarket UP price (0-1)
 * @param {number} params.polyDown     - Current Polymarket DOWN price (0-1)
 * @param {number} params.timeLeftMin  - Minutes remaining in current market
 * @returns {{ rawUp: number, signals: Object, confidence: string }}
 */
export function scoreMomentum({ spotTicks, polyUp, polyDown, timeLeftMin, orderbookImbalance, orderbookWall }) {
  const signals = {};
  let upWeight = 0;
  let downWeight = 0;
  let totalWeight = 0;

  // ── 0. BTC Spot Momentum (5s window) — weight 2 ────────────────
  // Ultra-short: immediate impulse, freshest signal possible
  const SPOT_5_WEIGHT = 2;

  if (Array.isArray(spotTicks) && spotTicks.length >= 2) {
    const now = spotTicks[spotTicks.length - 1];
    const cutoff = now.t - 5_000;

    let base = null;
    for (let i = 0; i < spotTicks.length; i++) {
      if (spotTicks[i].t >= cutoff) { base = spotTicks[i].price; break; }
    }
    if (base === null) base = spotTicks[0]?.price;

    if (base && base > 0) {
      const delta = (now.price - base) / base;
      signals.spotDelta5s = delta;

      // Lower threshold for 5s — even small moves matter at this timescale
      if (Math.abs(delta) > 0.00003) {
        if (delta > 0) upWeight += SPOT_5_WEIGHT;
        else downWeight += SPOT_5_WEIGHT;
        totalWeight += SPOT_5_WEIGHT;
      }
    }
  }

  // ── 1. BTC Spot Momentum (15s window) — weight 3 ──────────────
  // Most important: what is BTC doing RIGHT NOW?
  const SPOT_WINDOW_S = 15;
  const SPOT_WEIGHT = 3;

  if (Array.isArray(spotTicks) && spotTicks.length >= 2) {
    const now = spotTicks[spotTicks.length - 1];
    const cutoff = now.t - SPOT_WINDOW_S * 1000;

    let base = null;
    for (let i = 0; i < spotTicks.length; i++) {
      if (spotTicks[i].t >= cutoff) { base = spotTicks[i].price; break; }
    }
    if (base === null) base = spotTicks[0]?.price;

    if (base && base > 0) {
      const delta = (now.price - base) / base;
      signals.spotDelta15s = delta;

      // Only count if movement is significant (> 0.005% = ~$3.40 at $68k)
      if (Math.abs(delta) > 0.00005) {
        if (delta > 0) upWeight += SPOT_WEIGHT;
        else downWeight += SPOT_WEIGHT;
        totalWeight += SPOT_WEIGHT;
      }
    }
  }

  // ── 2. BTC Spot Momentum (60s window) — weight 2 ──────────────
  // Confirms the 15s momentum isn't just noise
  const SPOT_60_WEIGHT = 2;

  if (Array.isArray(spotTicks) && spotTicks.length >= 2) {
    const now = spotTicks[spotTicks.length - 1];
    const cutoff = now.t - 60_000;

    let base = null;
    for (let i = 0; i < spotTicks.length; i++) {
      if (spotTicks[i].t >= cutoff) { base = spotTicks[i].price; break; }
    }
    if (base === null) base = spotTicks[0]?.price;

    if (base && base > 0) {
      const delta = (now.price - base) / base;
      signals.spotDelta60s = delta;

      if (Math.abs(delta) > 0.0001) {
        if (delta > 0) upWeight += SPOT_60_WEIGHT;
        else downWeight += SPOT_60_WEIGHT;
        totalWeight += SPOT_60_WEIGHT;
      }
    }
  }

  // ── 3. Polymarket Price Momentum (30s) — weight 3 ─────────────
  // What are OTHER TRADERS doing right now? Follow the money.
  const POLY_WEIGHT = 3;

  const polyDeltaUp = getPolyDelta('UP', 30);
  const polyDeltaDown = getPolyDelta('DOWN', 30);
  signals.polyDelta30sUp = polyDeltaUp;
  signals.polyDelta30sDown = polyDeltaDown;

  if (polyDeltaUp !== null && Math.abs(polyDeltaUp) > 0.005) {
    // UP price rising = market thinks UP
    if (polyDeltaUp > 0) upWeight += POLY_WEIGHT;
    else downWeight += POLY_WEIGHT;
    totalWeight += POLY_WEIGHT;
  }

  // ── 4. Polymarket Price Level — weight 2 ──────────────────────
  // If UP is already at 65¢+, market is confident about UP
  const LEVEL_WEIGHT = 2;

  if (typeof polyUp === 'number' && typeof polyDown === 'number') {
    signals.polyUp = polyUp;
    signals.polyDown = polyDown;

    if (polyUp > 0.60) {
      upWeight += LEVEL_WEIGHT;
      totalWeight += LEVEL_WEIGHT;
    } else if (polyDown > 0.60) {
      downWeight += LEVEL_WEIGHT;
      totalWeight += LEVEL_WEIGHT;
    }
    // 50/50 zone (both 40-60¢) — no signal, skip
  }

  // ── 5. Tick Acceleration — weight 2 ─────────────────────────────
  // Is the Polymarket price move accelerating or decelerating?
  // Acceleration = velocity is increasing → more trustworthy signal
  const ACCEL_WEIGHT = 2;

  const polyDelta60Up = getPolyDelta('UP', 60);
  const polyDelta15Up = getPolyDelta('UP', 15);
  signals.polyDelta60sUp = polyDelta60Up;
  signals.polyDelta15sUp = polyDelta15Up;

  if (polyDelta60Up !== null && polyDelta15Up !== null) {
    // 60s velocity and 15s velocity
    // If 15s velocity > half of 60s velocity, the move is accelerating
    const velocity60 = polyDelta60Up;
    const velocity15 = polyDelta15Up;
    const acceleration = velocity15 - (velocity60 - velocity15); // positive = speeding up

    signals.polyAcceleration = acceleration;

    // Only fire if there's meaningful movement AND it's accelerating
    if (Math.abs(velocity60) > 0.005 && Math.abs(acceleration) > 0.002) {
      if (acceleration > 0) {
        upWeight += ACCEL_WEIGHT;
      } else {
        downWeight += ACCEL_WEIGHT;
      }
      totalWeight += ACCEL_WEIGHT;
    }
  }

  // ── 6. Order Book Imbalance — weight 3 ────────────────────────
  // Heavy bid volume = smart money expects UP. Strongest forward-looking signal.
  const OB_WEIGHT = 3;

  if (typeof orderbookImbalance === 'number' && Number.isFinite(orderbookImbalance)) {
    signals.orderbookImbalance = orderbookImbalance;
    signals.orderbookWall = orderbookWall ?? null;

    // Threshold: |imbalance| > 0.20 is meaningful
    if (Math.abs(orderbookImbalance) > 0.20) {
      if (orderbookImbalance > 0) {
        upWeight += OB_WEIGHT;
      } else {
        downWeight += OB_WEIGHT;
      }
      totalWeight += OB_WEIGHT;

      // Bonus weight for wall detection (large single order)
      if (orderbookWall === 'BID') { upWeight += 1; totalWeight += 1; }
      if (orderbookWall === 'ASK') { downWeight += 1; totalWeight += 1; }
    }
  }

  // ── 7. Settlement Trend (last 5 markets) — weight 1 ──────────
  // Lightest weight: trend persistence. If last 3+ settled UP, lean UP.
  const TREND_WEIGHT = 1;

  const trend = getSettlementTrend(5);
  signals.settlementTrend = trend;

  if (trend !== null) {
    if (trend >= 0.7) {
      upWeight += TREND_WEIGHT; // strong UP trend
      totalWeight += TREND_WEIGHT;
    } else if (trend <= 0.3) {
      downWeight += TREND_WEIGHT; // strong DOWN trend
      totalWeight += TREND_WEIGHT;
    }
  }

  // ── Compute final probability ─────────────────────────────────
  // If no signals fired, return 50/50 (no trade)
  if (totalWeight === 0) {
    return {
      rawUp: 0.5,
      signals,
      confidence: 'NONE',
      upWeight: 0,
      downWeight: 0,
    };
  }

  const rawUp = clamp(upWeight / (upWeight + downWeight), 0, 1);

  // Confidence based on agreement
  const agreement = Math.abs(upWeight - downWeight) / totalWeight;
  const confidence = agreement > 0.6 ? 'HIGH' : agreement > 0.3 ? 'MEDIUM' : 'LOW';

  return {
    rawUp,
    signals,
    confidence,
    upWeight,
    downWeight,
  };
}

/**
 * Apply time awareness: as time runs out, move toward 50/50.
 * Same as probability.js but separated for clarity.
 */
export function applyTimeAwarenessMomentum(rawUp, remainingMinutes, windowMinutes) {
  const timeDecay = clamp(remainingMinutes / windowMinutes, 0, 1);
  const adjustedUp = clamp(0.5 + (rawUp - 0.5) * timeDecay, 0, 1);
  return { timeDecay, adjustedUp, adjustedDown: 1 - adjustedUp };
}
