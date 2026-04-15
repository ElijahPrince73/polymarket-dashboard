import crypto from 'crypto';
import { CONFIG, getConfigForTimeframe } from '../config.js';
import { initializeLedger, getLedger, recalculateSummary } from '../paper_trading/ledger.js';
import { getOpenTrade } from '../paper_trading/trader.js';
import { fetchCollateralBalance } from '../live_trading/clob.js';
import { getLiveLedger } from '../live_trading/ledger.js';
import { getPacificTimeInfo } from '../domain/entryGate.js';
import { getPositionSummary } from './positionService.js';

// Diagnostic: unique ID per process instance + boot timestamp.
// If the UI sees different instanceIds across consecutive polls, there are
// multiple instances or the app is crash-restarting.
const _instanceId = crypto.randomBytes(4).toString('hex');
const _bootedAtMs = Date.now();

function getMarketPrefix(timeframe = '5m') {
  return String(timeframe).toLowerCase() === '15m' ? 'btc-updown-15m-' : 'btc-updown-5m-';
}

function filterTradesForTimeframe(trades, timeframe = '5m') {
  const prefix = getMarketPrefix(timeframe);
  const otherPrefix = timeframe === '15m' ? 'btc-updown-5m-' : 'btc-updown-15m-';
  return (Array.isArray(trades) ? trades : []).filter((trade) => {
    const slug = String(trade?.marketSlug || '');
    if (slug.startsWith(prefix)) return true;
    if (slug.startsWith(otherPrefix)) return false;
    return timeframe !== '15m';
  });
}

export async function assembleStatus(options = {}) {
  const timeframe = options.timeframe || '5m';
  const config = getConfigForTimeframe(timeframe);
  const engineKey = options.engineKey || '__tradingEngine';
  const modeManagerKey = options.modeManagerKey || '__modeManager';
  const statusKey = options.statusKey || '__uiStatus';
  await initializeLedger();

  // New unified engine + mode manager (exposed by index.js)
  const engine = globalThis[engineKey] ?? null;
  const modeManager = globalThis[modeManagerKey] ?? null;

  // Get open trade with live MFE/MAE. Try multiple sources:
  // 1. Paper trader's live in-memory trade (MFE/MAE updated every tick)
  // 2. Engine executor's copy
  // 3. Ledger fallback (stale, no MFE/MAE)
  const traderTrade = getOpenTrade();
  const executorTrade = engine?.executor?.openTrade;
  const openTrade = traderTrade ?? executorTrade;

  // Entry debug from unified engine
  const entryDebug = engine?.lastEntryStatus ?? null;
  const blockerSummary = engine?.state?.getBlockerSummary?.(10) ?? null;

  // Try Supabase trade store first (survives deploys), fall back to JSON ledger
  let trades = [];
  let meta = { realizedOffset: 0 };
  if (globalThis.__tradeStore_getTradeStore) {
    try {
      const store = globalThis.__tradeStore_getTradeStore();
      trades = await store.getAllTrades();
      const storeMeta = store.getMeta();
      if (storeMeta) meta = storeMeta;
    } catch { /* fallback below */ }
  }
  if (trades.length === 0) {
    const ledgerData = getLedger();
    trades = ledgerData.trades ?? [];
    meta = ledgerData.meta ?? { realizedOffset: 0 };
  }
  trades = filterTradesForTimeframe(trades, timeframe);
  const summary = recalculateSummary(trades);

  const starting = config.paperTrading.startingBalance ?? 1000;
  const baseRealized = typeof summary.totalPnL === 'number' ? summary.totalPnL : 0;
  const offset = (meta && typeof meta.realizedOffset === 'number' && Number.isFinite(meta.realizedOffset))
    ? meta.realizedOffset
    : 0;
  const realized = baseRealized + offset;
  const balance = starting + realized;

  let liveCollateral = null;
  if (config.liveTrading?.enabled) {
    try {
      liveCollateral = await fetchCollateralBalance();
    } catch (e) {
      liveCollateral = { error: e?.message || String(e) };
    }
  }

  const liveLedger = config.liveTrading?.enabled ? (getLiveLedger()?.trades ?? []) : [];

  const dailyPnl = engine?.state?.todayRealizedPnl ?? null;

  return {
    status: { ok: true, updatedAt: new Date().toISOString(), _instanceId, _uptimeS: Math.round((Date.now() - _bootedAtMs) / 1000) },
    mode: modeManager?.getMode()?.toUpperCase() ?? (config.liveTrading?.enabled ? 'LIVE' : 'PAPER'),
    tradingEnabled: engine?.tradingEnabled ?? false,
    openTrade,
    entryDebug,
    blockerSummary,
    ledgerSummary: summary,
    balance: { starting, realized, balance },
    paperTrading: {
      enabled: config.paperTrading.enabled,
      stakePct: config.paperTrading.stakePct,
      minTradeUsd: config.paperTrading.minTradeUsd,
      maxTradeUsd: config.paperTrading.maxTradeUsd,
      stopLossPct: config.paperTrading.stopLossPct,
      flipOnProbabilityFlip: config.paperTrading.flipOnProbabilityFlip
    },
    liveTrading: {
      enabled: Boolean(config.liveTrading?.enabled),
      available: modeManager?.isLiveAvailable() ?? false,
      funder: process.env.FUNDER_ADDRESS || null,
      signatureType: process.env.SIGNATURE_TYPE || null,
      limits: config.liveTrading || null,
      collateral: liveCollateral,
      tradesCount: Array.isArray(liveLedger) ? liveLedger.length : 0,
      daily: {
        realizedPnlUsd: typeof dailyPnl === 'number' ? dailyPnl : null,
        maxDailyLossUsd: config.liveTrading?.maxDailyLossUsd ?? config.paperTrading.maxDailyLossUsd ?? null,
        remainingLossBudgetUsd: (typeof dailyPnl === 'number' && Number.isFinite(dailyPnl))
          ? (Number(config.liveTrading?.maxDailyLossUsd ?? config.paperTrading.maxDailyLossUsd ?? 0) + dailyPnl)
          : null
      },
      fees: engine?.executor?.feeService?.getSnapshot?.() ?? null,
      approvals: engine?.executor?.approvalService?.getStatus?.() ?? null,
    },
    // Polymarket on-chain position data (live mode)
    positions: await (async () => {
      const funder = process.env.FUNDER_ADDRESS;
      if (!funder) return null;
      try {
        return await getPositionSummary(funder);
      } catch { return null; }
    })(),
    entryThresholds: (() => {
      const { isWeekend, wd, hour } = getPacificTimeInfo();
      return {
      // Schedule context (Pacific time)
      isWeekend,
      pacificDay: wd,
      pacificHour: hour,
      weekendTighteningActive: isWeekend && Boolean(config.paperTrading.weekendTighteningEnabled ?? true),
      // Prob thresholds (MID includes midProbBoost)
      minProbEarly: config.paperTrading.minProbEarly ?? 0.52,
      minProbMid: (config.paperTrading.minProbMid ?? 0.53) + (config.paperTrading.midProbBoost ?? 0.01),
      minProbLate: config.paperTrading.minProbLate ?? 0.55,
      // Edge thresholds (MID includes midEdgeBoost)
      edgeEarly: config.paperTrading.edgeEarly ?? 0.02,
      edgeMid: (config.paperTrading.edgeMid ?? 0.03) + (config.paperTrading.midEdgeBoost ?? 0.01),
      edgeLate: config.paperTrading.edgeLate ?? 0.05,
      // Weekend tightening boosts
      weekendProbBoost: config.paperTrading.weekendProbBoost ?? 0.03,
      weekendEdgeBoost: config.paperTrading.weekendEdgeBoost ?? 0.03,
      // Market quality
      maxSpread: config.paperTrading.maxSpread ?? 0.012,
      weekendMaxSpread: config.paperTrading.weekendMaxSpread ?? 0.008,
      minLiquidity: config.paperTrading.minLiquidity ?? 500,
      weekendMinLiquidity: config.paperTrading.weekendMinLiquidity ?? 20000,
      minModelMaxProb: config.paperTrading.minModelMaxProb ?? 0.53,
      weekendMinModelMaxProb: config.paperTrading.weekendMinModelMaxProb ?? 0.6,
      // Filters
      minRangePct20: config.paperTrading.minRangePct20 ?? 0.0012,
      minBtcImpulsePct1m: config.paperTrading.minBtcImpulsePct1m ?? 0.0003,
      noTradeRsiMin: config.paperTrading.noTradeRsiMin ?? 30,
      noTradeRsiMax: config.paperTrading.noTradeRsiMax ?? 45,
      maxEntryPolyPrice: config.paperTrading.maxEntryPolyPrice ?? 0.65,
      minOppositePolyPrice: config.paperTrading.minOppositePolyPrice ?? 0.10,
      minPolyPrice: config.paperTrading.minPolyPrice ?? 0.05,
      maxPolyPrice: config.paperTrading.maxPolyPrice ?? 0.95,
      weekendMinRangePct20: config.paperTrading.weekendMinRangePct20 ?? 0.0025,
      minCandlesForEntry: config.paperTrading.minCandlesForEntry ?? 12,
      // Volume thresholds
      minVolumeRecent: config.paperTrading.minVolumeRecent ?? 0,
      minVolumeRatio: config.paperTrading.minVolumeRatio ?? 0,
      minMarketVolumeNum: config.paperTrading.minMarketVolumeNum ?? 0,
      // Guardrails
      circuitBreakerConsecutiveLosses: config.paperTrading.circuitBreakerConsecutiveLosses ?? 5,
      maxDailyLossUsd: config.paperTrading.maxDailyLossUsd ?? 50,
      lossCooldownSeconds: config.paperTrading.lossCooldownSeconds ?? 30,
      winCooldownSeconds: config.paperTrading.winCooldownSeconds ?? 30,
      noEntryFinalMinutes: config.paperTrading.noEntryFinalMinutes ?? 1.5,
      onlyEntryFinalMinutes: config.paperTrading.onlyEntryFinalMinutes ?? 2.5,
      tradingHoursEnabled: config.paperTrading.tradingHoursEnabled ?? false,
      tradingHoursStart: config.paperTrading.tradingHoursStart ?? 6,
      tradingHoursEnd: config.paperTrading.tradingHoursEnd ?? 17,
      stopLossGraceSec: config.paperTrading.stopLossGraceSec ?? 20,
      lossCooldownEnabled: config.paperTrading.lossCooldownEnabled ?? true,
      lossCooldownMinutes: config.paperTrading.lossCooldownMinutes ?? 5,
      }; // end return
    })(),
    // Guardrail live state (for gate status table)
    guardrails: (() => {
      const st = engine?.state;
      if (!st) return null;
      const now = Date.now();
      const lossCdSec = engine?.config?.lossCooldownSeconds ?? config.paperTrading.lossCooldownSeconds ?? 0;
      const winCdSec = engine?.config?.winCooldownSeconds ?? config.paperTrading.winCooldownSeconds ?? 0;
      const lossCdRemaining = (lossCdSec > 0 && st.lastLossAtMs)
        ? Math.max(0, lossCdSec * 1000 - (now - st.lastLossAtMs)) : 0;
      const winCdRemaining = (winCdSec > 0 && st.lastWinAtMs)
        ? Math.max(0, winCdSec * 1000 - (now - st.lastWinAtMs)) : 0;
      const cbMax = engine?.config?.circuitBreakerConsecutiveLosses ?? config.paperTrading.circuitBreakerConsecutiveLosses ?? 0;
      const cbCooldownMs = engine?.config?.circuitBreakerCooldownMs ?? 5 * 60_000;
      const cbResult = (cbMax > 0 && typeof st.checkCircuitBreaker === 'function')
        ? st.checkCircuitBreaker(cbMax, cbCooldownMs) : { tripped: false, remaining: 0 };
      return {
        lossCooldownActive: lossCdRemaining > 0,
        lossCooldownRemainingMs: lossCdRemaining,
        winCooldownActive: winCdRemaining > 0,
        winCooldownRemainingMs: winCdRemaining,
        consecutiveLosses: st.consecutiveLosses ?? 0,
        circuitBreakerTripped: cbResult.tripped,
        circuitBreakerRemainingMs: cbResult.remaining,
        skipMarketSlug: st.skipMarketUntilNextSlug ?? null,
        hasOpenPosition: st.hasOpenPosition ?? false,
        weekdaysOnly: engine?.config?.weekdaysOnly ?? config.paperTrading.weekdaysOnly ?? false,
      };
    })(),
    killSwitch: engine?.state?.getKillSwitchStatus?.(
      engine?.config?.maxDailyLossUsd ?? config.liveTrading?.maxDailyLossUsd ?? config.paperTrading?.maxDailyLossUsd ?? null,
    ) ?? null,
    orderLifecycle: engine?.executor?.orderManager?.getAllOrderViews?.() ?? [],
    reconciliation: engine?.executor?.getReconciliationStatus?.() ?? null,
    failureEvents: (engine?.executor?.getFailureEvents?.() ?? []).slice(-10),
    runtime: globalThis[statusKey] ?? null,
    sleepMode: globalThis[statusKey]?.sleepMode ?? false,
    sleepReason: globalThis[statusKey]?.sleepReason ?? null,
  };
}
