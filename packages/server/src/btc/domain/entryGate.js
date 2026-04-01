/**
 * @file Unified entry gate logic for both paper and live trading.
 *
 * This is a pure function — no I/O, no side effects. Both the PaperExecutor
 * and LiveExecutor call this with identical arguments to get the same set of
 * entry blockers.
 *
 * Extracted from:
 *   - src/paper_trading/trader.js processSignals() lines 110-776
 *   - src/live_trading/trader.js processSignals() lines 102-801
 */

/** @import { TradeSide } from './types.js' */

// ─── helpers ───────────────────────────────────────────────────────

function isNum(x) {
  return typeof x === 'number' && Number.isFinite(x);
}

/**
 * Detect Pacific-time weekend and current day/hour.
 * @returns {{ isWeekend: boolean, wd: string, hour: number }}
 */
export function getPacificTimeInfo() {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(new Date());

  const get = (t) => parts.find((p) => p.type === t)?.value;
  const wd = get('weekday');
  const hour = Number(get('hour'));
  const isWeekend = wd === 'Sat' || wd === 'Sun';

  return { isWeekend, wd, hour };
}

/**
 * Compute effective entry thresholds with weekend/MID/inferred boosts applied.
 *
 * @param {Object} config - Trading config
 * @param {boolean} isWeekend
 * @param {string} phase - 'EARLY' | 'MID' | 'LATE'
 * @param {boolean} sideInferred
 * @param {boolean} strictRec
 * @returns {{ minProb: number, edgeThreshold: number }}
 */
export function computeEffectiveThresholds(config, isWeekend, phase, sideInferred, strictRec) {
  let minProb, edgeThreshold;

  if (phase === 'EARLY') {
    minProb = config.minProbEarly ?? 0.52;
    edgeThreshold = config.edgeEarly ?? 0.02;
  } else if (phase === 'MID') {
    minProb = config.minProbMid ?? 0.53;
    edgeThreshold = config.edgeMid ?? 0.03;
  } else {
    minProb = config.minProbLate ?? 0.55;
    edgeThreshold = config.edgeLate ?? 0.05;
  }

  const weekendTightening =
    Boolean(config.weekendTighteningEnabled ?? true) && isWeekend;

  if (weekendTightening) {
    minProb += config.weekendProbBoost ?? 0;
    edgeThreshold += config.weekendEdgeBoost ?? 0;
  }

  if (phase === 'MID') {
    minProb += config.midProbBoost ?? 0;
    edgeThreshold += config.midEdgeBoost ?? 0;
  }

  if (!strictRec && sideInferred) {
    minProb += config.inferredProbBoost ?? 0;
    edgeThreshold += config.inferredEdgeBoost ?? 0;
  }

  return { minProb, edgeThreshold };
}

// ─── main entry ────────────────────────────────────────────────────

/**
 * Compute all entry blockers. Returns an array of human-readable blocker strings.
 * If the array is empty, entry is allowed.
 *
 * @param {Object} signals       - The unified signals bundle
 * @param {Object} config        - The merged trading config (paperTrading keys, possibly overlaid by liveTrading)
 * @param {Object} state         - TradingState instance (or plain object with matching shape)
 * @param {number} candleCount   - Number of 1m candles available
 * @returns {{ blockers: string[], effectiveSide: TradeSide|null, sideInferred: boolean }}
 */
export function computeEntryBlockers(signals, config, state, candleCount) {
  const blockers = [];

  // ── 1. Trading Hours (PST) ──────────────────────────────────────
  const tradingHoursEnabled = config.tradingHoursEnabled ?? true;
  if (tradingHoursEnabled) {
    const { hour: pstHour } = getPacificTimeInfo();
    const startHour = config.tradingHoursStart ?? 6;
    const endHour = config.tradingHoursEnd ?? 17;
    if (pstHour < startHour || pstHour >= endHour) {
      blockers.push(`Outside trading hours (${pstHour}:00 PST, allowed ${startHour}-${endHour})`);
    }
  }

  // ── 2. Escalating Loss Cooldown ─────────────────────────────────
  const cooldownEnabled = config.lossCooldownEnabled ?? true;
  const isPaperMode = config._mode === 'paper';
  // Skip in paper mode - risk controls are live-only
  if (!isPaperMode && cooldownEnabled && state) {
    const lastTrade = state.lastClosedTrade ?? null;
    const streak = state.consecutiveLosses ?? 0;
    if (lastTrade && (lastTrade.pnl ?? 0) <= 0 && streak > 0) {
      const baseMins = config.lossCooldownMinutes ?? 5;
      const cooldownMins = Math.min(baseMins * streak, 30);
      const cooldownMs = cooldownMins * 60_000;
      const lastExitMs = lastTrade.exitTimeMs ?? 0;
      const elapsed = Date.now() - lastExitMs;
      if (elapsed < cooldownMs) {
        const remaining = Math.ceil((cooldownMs - elapsed) / 1000);
        blockers.push(`Loss cooldown (${remaining}s, streak ${streak}, ${cooldownMins}min)`);
      }
    }
  }

  // ── 3. Side resolution — PRICE ASYMMETRY STRATEGY ───────────────
  // Buy the CHEAP side. At 30c entry, only need 30% WR to break even.
  let effectiveSide = null;
  let sideInferred = false;

  const polyUpPrice = signals.polyPricesCents?.UP ?? (signals.polyMarketSnapshot?.prices?.up ?? null);
  const polyDownPrice = signals.polyPricesCents?.DOWN ?? (signals.polyMarketSnapshot?.prices?.down ?? null);

  const upVal = isNum(polyUpPrice) ? (polyUpPrice > 1 ? polyUpPrice / 100 : polyUpPrice) : null;
  const downVal = isNum(polyDownPrice) ? (polyDownPrice > 1 ? polyDownPrice / 100 : polyDownPrice) : null;

  const maxCheapEntry = config.maxCheapEntryPrice ?? 0.45;
  const minCheapEntry = config.minCheapEntryPrice ?? 0.15;

  if (isNum(upVal) && isNum(downVal)) {
    const cheapSide = upVal <= downVal ? 'UP' : 'DOWN';
    const cheapPrice = cheapSide === 'UP' ? upVal : downVal;

    if (cheapPrice >= minCheapEntry && cheapPrice <= maxCheapEntry) {
      effectiveSide = cheapSide;
      sideInferred = true;
    }
  }

  if (!effectiveSide) {
    blockers.push(`No cheap side available (need price between ${(minCheapEntry * 100).toFixed(0)}-${(maxCheapEntry * 100).toFixed(0)}c)`);
    return { blockers, effectiveSide: null, sideInferred };
  }

  // ── 3b. Rec gating (market quality filter) ──────────────────────
  // When enabled, only enter when the signal engine says ENTER.
  // This filters out stale data, dead markets, and low-quality conditions.
  const recGatingEnabled = config.recGatingEnabled ?? false;
  if (recGatingEnabled) {
    const rec = signals?.rec;
    if (rec?.action !== 'ENTER') {
      blockers.push(`Rec=${rec?.action || 'NONE'} (market quality filter)`);
    }
  }

  // ── 3b2. Phase filter (block LATE entries) ───────────────────────
  // When set, only allow entries during specified phases.
  // 5m data: LATE phase = 5% WR, -$1,161 across 105 trades.
  const allowedPhases = config.allowedPhases ?? null;
  if (allowedPhases) {
    const currentPhase = signals?.rec?.phase ?? null;
    if (currentPhase && !allowedPhases.includes(currentPhase)) {
      blockers.push(`Phase ${currentPhase} blocked (allowed: ${allowedPhases.join(', ')})`);
    }
  }

  // ── 3c. RSI directional bias ────────────────────────────────────
  // When enabled, align cheap side with momentum direction.
  // RSI < bearish threshold → only allow DOWN. RSI > bullish → only allow UP.
  const rsiBiasEnabled = config.rsiBiasEnabled ?? false;
  if (rsiBiasEnabled) {
    const rsiNow = signals.indicators?.rsiNow ?? null;
    const rsiBearish = config.rsiBearishThreshold ?? 40;
    const rsiBullish = config.rsiBullishThreshold ?? 60;
    if (isNum(rsiNow)) {
      if (rsiNow < rsiBearish && effectiveSide === 'UP') {
        blockers.push(`RSI bearish bias blocks UP (RSI ${rsiNow.toFixed(1)} < ${rsiBearish})`);
      }
      if (rsiNow > rsiBullish && effectiveSide === 'DOWN') {
        blockers.push(`RSI bullish bias blocks DOWN (RSI ${rsiNow.toFixed(1)} > ${rsiBullish})`);
      }
    }
  }

  // ── 4. Polymarket price resolution ──────────────────────────────
  const poly = signals.polyMarketSnapshot;
  const rawUpC = signals.polyPricesCents?.UP ?? null;
  const rawDownC = signals.polyPricesCents?.DOWN ?? null;

  const obUpAsk = poly?.orderbook?.up?.bestAsk;
  const obUpBid = poly?.orderbook?.up?.bestBid;
  const obDownAsk = poly?.orderbook?.down?.bestAsk;
  const obDownBid = poly?.orderbook?.down?.bestBid;

  // Orderbook prices are already decimal (0–1). No multiplication needed.
  const fallbackUp =
    isNum(obUpAsk) && obUpAsk > 0 ? obUpAsk
      : isNum(obUpBid) && obUpBid > 0 ? obUpBid
        : null;
  const fallbackDown =
    isNum(obDownAsk) && obDownAsk > 0 ? obDownAsk
      : isNum(obDownBid) && obDownBid > 0 ? obDownBid
        : null;

  const upC = isNum(rawUpC) && rawUpC > 0 ? rawUpC : fallbackUp;
  const downC = isNum(rawDownC) && rawDownC > 0 ? rawDownC : fallbackDown;

  const upCok = isNum(upC) && upC > 0;
  const downCok = isNum(downC) && downC > 0;
  const polyPricesSane = upCok && downCok;

  // All price sources (CLOB, Gamma, orderbook) return decimal (0–1). No division needed.
  const effectivePolyPrices = {
    UP: upCok ? upC : null,
    DOWN: downCok ? downC : null,
  };

  const currentPolyPrice = effectivePolyPrices[effectiveSide];

  if (currentPolyPrice === null || currentPolyPrice === undefined) {
    blockers.push('Missing Polymarket price');
    return { blockers, effectiveSide, sideInferred };
  }

  if (!polyPricesSane) {
    blockers.push('Market data sanity: invalid Polymarket prices (gamma 0/NaN and no valid orderbook quotes)');
  }

  // ── 3b. Candle freshness (uses live tick timestamp, not candle time) ────
  // candleMeta.lastTickAt tracks when the last real Chainlink tick arrived.
  // If no tick has arrived in 3+ minutes, indicators are stale.
  const lastTickAt = signals.candleMeta?.lastTickAt ?? null;
  if (isNum(lastTickAt) && (Date.now() - lastTickAt) > 180_000) {
    blockers.push(`Stale price data (no Chainlink tick in >${Math.round((Date.now() - lastTickAt) / 60_000)}m)`);
  }

  // ── 4. Settlement time gate ─────────────────────────────────────
  const endDate = signals.market?.endDate ?? poly?.market?.endDate ?? null;
  const settlementLeftMin = endDate
    ? (new Date(endDate).getTime() - Date.now()) / 60000
    : null;
  const timeLeftForEntry =
    isNum(settlementLeftMin) ? settlementLeftMin : (signals.timeLeftMin ?? null);

  const noEntryFinal = config.noEntryFinalMinutes ?? 1.5;
  if (isNum(timeLeftForEntry) && timeLeftForEntry < noEntryFinal) {
    blockers.push(`Too late (<${noEntryFinal}m to settlement)`);
  }

  // ── 4b. Only enter in final X minutes (late-entry strategy) ────
  const onlyEntryFinalMinutes = config.onlyEntryFinalMinutes ?? 0;
  if (onlyEntryFinalMinutes > 0 && isNum(timeLeftForEntry) && timeLeftForEntry > onlyEntryFinalMinutes) {
    blockers.push(`Too early (>${onlyEntryFinalMinutes}m left, waiting for final window)`);
  }

  // ── 5. One trade per market: skip rest of 5m window after any exit ──
  const marketSlug = signals.market?.slug;
  const oneTradePerMarket = config.oneTradePerMarket ?? true;
  // Clear skip only when the skipped market has actually settled
  // (Polymarket API can briefly show the next slug before current one ends)
  if (state.skipMarketUntilNextSlug && marketSlug
      && marketSlug !== 'unknown'
      && state.skipMarketUntilNextSlug !== marketSlug) {
    const skipSlugMatch = state.skipMarketUntilNextSlug.match(/(\d+)$/);
    if (skipSlugMatch) {
      const durationSec = state.skipMarketUntilNextSlug.includes('15m') ? 900 : 300;
      const settlementMs = (Number(skipSlugMatch[1]) + durationSec) * 1000;
      if (Date.now() > settlementMs) {
        state.skipMarketUntilNextSlug = null;
      }
      // else: skipped market hasn't settled yet — keep the skip active
    } else {
      state.skipMarketUntilNextSlug = null; // can't parse, fall back to old behavior
    }
  }
  if (oneTradePerMarket && state.skipMarketUntilNextSlug && marketSlug
      && state.skipMarketUntilNextSlug === marketSlug) {
    blockers.push('One trade per market (wait for next 5m)');
  }

  // ── 9. Has open position ───────────────────────────────────────
  if (state.hasOpenPosition) {
    blockers.push('Trade already open');
  }

  // ── 10. Schedule (weekdays, Friday cutoff, Sunday allowance) ──────
  const { isWeekend, wd, hour } = getPacificTimeInfo();
  const weekdaysOnly = config.weekdaysOnly ?? false;

  if (weekdaysOnly) {
    const allowSundayAfterHour = config.allowSundayAfterHour;
    const isSundayAllowed =
      wd === 'Sun' && isNum(allowSundayAfterHour) && allowSundayAfterHour >= 0 && hour >= allowSundayAfterHour;

    const noEntryAfterFridayHour = config.noEntryAfterFridayHour;
    const isFridayAfter =
      wd === 'Fri' && isNum(noEntryAfterFridayHour) && noEntryAfterFridayHour >= 0 && hour >= noEntryAfterFridayHour;

    if ((isWeekend && !isSundayAllowed) || isFridayAfter) {
      blockers.push('Outside schedule (weekdays only / Friday cutoff)');
    }
  }

  // ── 11. Circuit breaker (consecutive losses) ─────────────────
  const cbMaxLosses = config.circuitBreakerConsecutiveLosses ?? 0;
  const cbCooldownMs = config.circuitBreakerCooldownMs ?? 5 * 60_000;

  // Skip in paper mode - risk controls are live-only
  if (!isPaperMode && cbMaxLosses > 0 && typeof state.checkCircuitBreaker === 'function') {
    const cb = state.checkCircuitBreaker(cbMaxLosses, cbCooldownMs);
    if (cb.tripped) {
      blockers.push(`Circuit breaker (${cbMaxLosses} losses, ${(cb.remaining / 1000).toFixed(0)}s left)`);
    }
  }

  // ── 12. Max Drawdown circuit breaker ──────────────────────────
  const mddPct = config.maxDrawdownPct ?? 0.15;
  // Skip in paper mode - risk controls are live-only
  if (!isPaperMode && mddPct > 0 && isNum(state.startingBalance) && state.startingBalance > 0) {
    const currentBalance = isNum(state.currentBalance) ? state.currentBalance
      : (state.startingBalance + (state.todayRealizedPnl ?? 0));
    const drawdownPct = (state.startingBalance - currentBalance) / state.startingBalance;
    if (drawdownPct >= mddPct) {
      blockers.push(`Max drawdown breaker (${(drawdownPct * 100).toFixed(1)}% >= ${(mddPct * 100).toFixed(0)}% of $${state.startingBalance})`);
    }
  }

  // ── 13. Daily loss kill-switch ────────────────────────────────
  const paperKillSwitchDisabled = (config.paperKillSwitchEnabled === false) && (config._mode === 'paper');
  const maxDailyLossUsd = config.maxDailyLossUsd ?? null;
  if (!paperKillSwitchDisabled && isNum(maxDailyLossUsd) && maxDailyLossUsd > 0) {
    if (typeof state.checkKillSwitch === 'function') {
      const ksResult = state.checkKillSwitch(maxDailyLossUsd, {
        overrideBufferPct: config.killSwitchOverrideBufferPct ?? 0.10,
      });
      if (ksResult.triggered) {
        blockers.push(`Daily loss kill-switch: ${ksResult.reason}`);
      }
    } else if (isNum(state.todayRealizedPnl)) {
      if (state.todayRealizedPnl <= -Math.abs(maxDailyLossUsd)) {
        blockers.push(`Daily loss kill-switch hit ($${state.todayRealizedPnl.toFixed(2)} <= -$${Math.abs(maxDailyLossUsd).toFixed(2)})`);
      }
    }
  }

  return { blockers, effectiveSide, sideInferred };
}

/**
 * Compute entry gate evaluation with margin data for analytics.
 * Wraps computeEntryBlockers() and adds threshold margin information.
 *
 * @param {Object} signals       - The unified signals bundle
 * @param {Object} config        - The merged trading config
 * @param {Object} state         - TradingState instance (or plain object)
 * @param {number} candleCount   - Number of 1m candles available
 * @returns {{ blockers: string[], effectiveSide: TradeSide|null, sideInferred: boolean, margins: Object, totalChecks: number, passedCount: number, failedCount: number }}
 */
export function computeEntryGateEvaluation(signals, config, state, candleCount) {
  const { blockers, effectiveSide, sideInferred } = computeEntryBlockers(signals, config, state, candleCount);

  // Compute margins for key configurable thresholds
  const margins = {};

  // Prob margin: distance from minProbMid threshold
  const rec = signals?.rec;
  const phase = rec?.phase ?? 'MID';
  const modelProb = effectiveSide === 'UP' ? signals?.modelUp
    : effectiveSide === 'DOWN' ? signals?.modelDown
      : null;

  if (isNum(modelProb)) {
    const minProb = phase === 'EARLY' ? (config.minProbEarly ?? 0.52)
      : phase === 'LATE' ? (config.minProbLate ?? 0.55)
        : (config.minProbMid ?? 0.53);
    margins.prob = modelProb - minProb;
  } else {
    margins.prob = null;
  }

  // Edge margin: distance from edgeMid threshold
  const edge = rec?.edge ?? null;
  if (isNum(edge)) {
    const edgeThreshold = phase === 'EARLY' ? (config.edgeEarly ?? 0.02)
      : phase === 'LATE' ? (config.edgeLate ?? 0.05)
        : (config.edgeMid ?? 0.03);
    margins.edge = edge - edgeThreshold;
  } else {
    margins.edge = null;
  }

  // RSI margin: distance from no-trade RSI band
  const rsiNow = signals?.indicators?.rsiNow ?? null;
  const noTradeRsiMin = config.noTradeRsiMin;
  const noTradeRsiMax = config.noTradeRsiMax;
  if (isNum(rsiNow) && isNum(noTradeRsiMin) && isNum(noTradeRsiMax)) {
    if (rsiNow < noTradeRsiMin) {
      margins.rsi = noTradeRsiMin - rsiNow; // positive = safely below band
    } else if (rsiNow >= noTradeRsiMax) {
      margins.rsi = rsiNow - noTradeRsiMax; // positive = safely above band
    } else {
      margins.rsi = 0; // inside no-trade band (failed)
    }
  } else {
    margins.rsi = null;
  }

  // Spread margin: distance from maxSpreadThreshold (positive = below max, good)
  const poly = signals?.polyMarketSnapshot;
  const spreadUp = poly?.orderbook?.up?.spread;
  const spreadDown = poly?.orderbook?.down?.spread;
  const effectiveMaxSpread = config.maxSpread ?? 0.012;
  const worstSpread = [spreadUp, spreadDown].filter(isNum).length > 0
    ? Math.max(...[spreadUp, spreadDown].filter(isNum))
    : null;
  if (isNum(worstSpread)) {
    margins.spread = effectiveMaxSpread - worstSpread; // positive = below max
  } else {
    margins.spread = null;
  }

  // Liquidity margin: distance from minLiquidity (positive = above min, good)
  const liquidityNum = signals?.market?.liquidityNum ?? null;
  const effectiveMinLiquidity = config.minLiquidity ?? 0;
  if (isNum(liquidityNum)) {
    margins.liquidity = liquidityNum - effectiveMinLiquidity;
  } else {
    margins.liquidity = null;
  }

  // Impulse margin: distance from minSpotImpulse (positive = above min, good)
  const minImpulse = config.minBtcImpulsePct1m ?? 0;
  const spotDelta1mPct = signals?.spot?.delta1mPct ?? null;
  if (isNum(spotDelta1mPct) && isNum(minImpulse) && minImpulse > 0) {
    margins.impulse = Math.abs(spotDelta1mPct) - minImpulse;
  } else {
    margins.impulse = null;
  }

  const totalChecks = 30; // +RSI directional bias, +heiken exhaustion, +strong signal
  const failedCount = blockers.length;
  const passedCount = totalChecks - failedCount;

  return { blockers, effectiveSide, sideInferred, margins, totalChecks, passedCount, failedCount };
}
