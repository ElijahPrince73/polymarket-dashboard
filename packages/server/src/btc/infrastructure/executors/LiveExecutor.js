/**
 * @file Live-trading executor using real CLOB orders.
 *
 * Implements the OrderExecutor interface. Delegates to @polymarket/clob-client
 * for actual order placement. Reuses existing position tracking and PnL
 * computation modules.
 *
 * Phase 3 additions:
 *   - Orders wrapped with withOrderRetry for automatic retry on transient failures
 *   - Full lifecycle tracking via OrderManager + OrderLifecycle
 *   - Timeout detection: orders pending > 30s are auto-cancelled
 *   - Structured failure events (createFailureEvent) for Phase 4 webhook
 */

import { OrderExecutor } from '../../application/ExecutorInterface.js';
import { getClobClient } from '../../live_trading/clob.js';
import { appendLiveTrade, initializeLiveLedger } from '../../live_trading/ledger.js';
import {
  computePositionsFromTrades,
  enrichPositionsWithMarks,
} from '../../live_trading/positions.js';
import { fetchClobPrice, isClobCircuitOpen } from '../../data/polymarket.js';
import { CONFIG } from '../../config.js';
import { FeeService } from '../fees/FeeService.js';
import { ApprovalService } from '../approvals/ApprovalService.js';
import { OrderManager } from '../orders/OrderManager.js';
import { pickTokenId } from '../market/tokenMapping.js';
import { LIFECYCLE_STATES } from '../../domain/orderLifecycle.js';
import { withOrderRetry, createFailureEvent } from '../../domain/retryPolicy.js';
import { reconcilePositions, SYNC_STATUS } from '../../domain/reconciliation.js';
import { computeTradeSizeWithFees } from '../../domain/sizing.js';
import { capPnl, computeMaxLossUsd } from '../../domain/exitEvaluator.js';
import { deriveMarketSettlementTime, fetchPolymarketOutcome } from '../../services/settlementService.js';
import { getAllTokenIds } from '../market/tokenMapping.js';

/** @import { OrderRequest, OrderResult, CloseRequest, CloseResult, PositionView, BalanceSnapshot } from '../../domain/types.js' */

function isNum(x) {
  return typeof x === 'number' && Number.isFinite(x);
}

function syncTradeToStoreByTimeframe(trade, mode = 'live', timeframe = '5m') {
  const fn = timeframe === '15m'
    ? globalThis.__syncTradeToStore15m
    : globalThis.__syncTradeToStore;
  if (typeof fn === 'function') {
    fn({ ...trade, timeframe }, mode);
  }
}

export class LiveExecutor extends OrderExecutor {
  /**
   * @param {Object} opts
   * @param {Object} opts.config    - Merged trading config
   * @param {Function} opts.getMarket - Returns the current Polymarket market object
   */
  constructor({ config, getMarket }) {
    super();
    this.config = config;
    this.getMarket = getMarket;
    this.client = getClobClient();

    // Fee observability (SDK handles actual fee injection; this is for logging/UI)
    this.feeService = new FeeService({
      cacheTtlMs: CONFIG.liveTrading?.feeCacheTtlMs ?? 30_000,
      alertThresholdBps: CONFIG.liveTrading?.feeRateAlertThresholdBps ?? 300,
    });

    // Proactive approvals (collateral + conditional tokens)
    this.approvalService = new ApprovalService();

    // Order lifecycle tracking
    this.orderManager = new OrderManager();

    // Cached CLOB trades for position computation
    this._cachedTrades = [];
    this._lastTradesFetchAttemptMs = 0;
    this._lastTradesFetchSuccessMs = 0;

    // Adaptive polling hint
    this._hadPositionLastLoop = false;

    // Exit spam guard (30s cooldown per tokenID)
    this._lastExitAttemptMsByToken = new Map();

    // Structured failure events (capped at 100, FIFO)
    this._failureEvents = [];

    // Retry config from CONFIG or defaults
    this._orderTimeoutMs = CONFIG.liveTrading?.orderTimeoutMs ?? 30_000;
    this._maxOrderRetries = CONFIG.liveTrading?.maxOrderRetries ?? 3;
    this._retryDelays = [1000, 2000, 4000];

    // Structured trade tracking (mirrors PaperExecutor)
    /** @type {Object|null} Currently open structured trade */
    this.openTrade = null;

    // Reconciliation state (Phase 3: LIVE-02)
    this._reconciliationStatus = {
      status: SYNC_STATUS.CHECKING,
      discrepancies: [],
      lastCheckMs: 0,
      lastDiscrepancyMs: null,
    };
  }

  getMode() {
    return 'live';
  }

  async initialize() {
    await initializeLiveLedger();

    // Run startup approvals (best-effort — doesn't block trading)
    this.approvalService.runStartupApprovals().catch((e) => {
      console.warn('LiveExecutor: Startup approvals failed:', e?.message);
    });

    await this._prewarmApprovals();

    console.log('LiveExecutor initialized.');
  }

  // ─── Failure event tracking ────────────────────────────────────

  /**
   * Store a failure event (capped at 100).
   * @param {Object} event
   */
  _recordFailureEvent(event) {
    this._failureEvents.push(event);
    if (this._failureEvents.length > 100) {
      this._failureEvents.shift(); // FIFO evict oldest
    }
  }

  /**
   * Get all stored failure events (for Phase 4 webhook consumption).
   * @returns {Object[]}
   */
  getFailureEvents() {
    return [...this._failureEvents];
  }

  // ─── OrderExecutor interface ─────────────────────────────────

  /**
   * @param {OrderRequest} request
   * @returns {Promise<OrderResult>}
   */
  async openPosition(request) {
    const { side, marketSlug, sizeUsd, price, phase, metadata } = request;
    const emptyResult = { filled: false, tradeId: null, fillPrice: 0, fillShares: 0, fillSizeUsd: 0 };

    const market = this.getMarket();
    const tokenID = market ? pickTokenId(market, side) : null;
    if (!tokenID) {
      return emptyResult;
    }

    // Ensure collateral allowance before every trade
    try {
      const approvalStatus = await this.approvalService.checkAndApproveCollateral();
      if (approvalStatus.state !== 'approved') {
        console.warn(`[live] Collateral approval not ready: ${approvalStatus.state} (allowance: ${approvalStatus.allowance})`);
      }
    } catch (e) {
      console.warn(`[live] Collateral approval check failed: ${e?.message}`);
    }

    // Check collateral
    const collateral = await this._collateralUsd();
    const maxPer = CONFIG.liveTrading?.maxPerTradeUsd || sizeUsd;
    const usd = Math.min(
      maxPer,
      collateral,
      CONFIG.liveTrading?.maxOpenExposureUsd || maxPer,
    );
    if (!isNum(usd) || usd <= 0) {
      return emptyResult;
    }

    // Fetch live buy price
    let buyPrice = price;
    try {
      const px = await fetchClobPrice({ tokenId: tokenID, side: 'buy' });
      if (isNum(px) && px > 0) buyPrice = px;
    } catch {
      // use passed price
    }

    // Fetch fee rate for fee-aware sizing (Phase 3: LIVE-03)
    let feeRateBpsForSizing = null;
    try {
      feeRateBpsForSizing = await this.feeService.getFeeRateBps(tokenID);
    } catch {
      // Fee lookup for sizing is best-effort
    }

    // Fee-aware sizing: deduct estimated fees from trade size
    const rawUsd = usd;
    const feeAdjustedUsd = feeRateBpsForSizing != null
      ? computeTradeSizeWithFees(usd, this.config, feeRateBpsForSizing)
      : usd;
    const effectiveUsd = feeAdjustedUsd > 0 ? feeAdjustedUsd : usd;

    if (feeRateBpsForSizing != null && feeAdjustedUsd !== rawUsd) {
      console.log(
        `[live] Fee-adjusted size: $${effectiveUsd.toFixed(2)} (raw: $${rawUsd.toFixed(2)}, fee: ${feeRateBpsForSizing} bps)`,
      );
    }

    const size = Math.max(5, Math.floor(effectiveUsd / buyPrice));

    // ── Order validation ─────────────────────────────────────────
    if (size < 5) {
      console.warn(`[live] Order rejected: size ${size} < CLOB minimum 5`);
      return emptyResult;
    }
    if (!isNum(buyPrice) || buyPrice < 0.001 || buyPrice > 0.999) {
      console.warn(`[live] Order rejected: price ${buyPrice} outside [0.001, 0.999]`);
      return emptyResult;
    }
    const maxPerTrade = CONFIG.liveTrading?.maxPerTradeUsd ?? Infinity;
    if (size * buyPrice > maxPerTrade) {
      console.warn(`[live] Order rejected: notional $${(size * buyPrice).toFixed(2)} > maxPerTradeUsd $${maxPerTrade}`);
      return emptyResult;
    }

    // Fetch fee rate for observability (SDK handles actual fee injection)
    let feeRateBps = null;
    let feeImpact = null;
    try {
      feeRateBps = await this.feeService.getFeeRateBps(tokenID);
      if (feeRateBps !== null) {
        feeImpact = this.feeService.computeFeeImpact(buyPrice * size, buyPrice, feeRateBps);
        console.log(
          `[live] Fee: ${feeRateBps} bps (${(feeRateBps / 100).toFixed(2)}%) | est. $${feeImpact.feeUsd.toFixed(4)} on $${(buyPrice * size).toFixed(2)} notional`,
        );
      }
    } catch {
      // Fee lookup is best-effort observability
    }

    let retryCount = 0;
    try {
      // Dynamic import to avoid crashing if the library isn't installed
      const { OrderType } = await import('@polymarket/clob-client');

      // Wrap CLOB call with retry policy
      const resp = await withOrderRetry(
        async () => {
          retryCount++;
          return this.client.createAndPostOrder(
            { tokenID, price: buyPrice, size, side: 'BUY' },
            {},
            OrderType.FOK, // Fill-Or-Kill: instant fill or cancel, no phantom orders
            false,
            false, // postOnly OFF for FOK
          );
        },
        {
          maxAttempts: this._maxOrderRetries,
          delays: this._retryDelays,
        },
      );

      // Track order lifecycle
      if (resp?.orderID) {
        const lifecycle = this.orderManager.trackOrder(resp.orderID, {
          tokenID, side: 'BUY', price: buyPrice, size,
          extra: { marketSlug, phase, type: 'OPEN' },
        });
        if (lifecycle) {
          lifecycle.transition(LIFECYCLE_STATES.PENDING);
        }
      }

      await appendLiveTrade({
        type: 'OPEN',
        ts: new Date().toISOString(),
        marketSlug,
        side,
        tokenID,
        price: buyPrice,
        size,
        usdNotional: buyPrice * size,
        orderID: resp?.orderID || null,
        feeRateBps,
        feeImpact,
        retryCount: retryCount - 1, // actual retries (0 if first attempt worked)
        resp,
      });

      // ── Verify fill: check if position actually appeared on CLOB ──
      // FOK orders can be killed without filling. The CLOB SDK returns an
      // orderID regardless. Wait briefly and check for the position.
      let fillVerified = false;
      const verifyDelays = [1000, 2000, 3000]; // 1s, 2s, 3s
      for (const delay of verifyDelays) {
        await new Promise(r => setTimeout(r, delay));
        try {
          const trades = await this.client.getTrades();
          const hasPosition = (Array.isArray(trades) ? trades : []).some(
            t => t?.asset_id === tokenID && String(t?.side).toUpperCase() === 'BUY'
          );
          if (hasPosition) {
            fillVerified = true;
            break;
          }
        } catch {
          // retry
        }
      }

      if (!fillVerified) {
        console.warn(`[live] Order ${resp?.orderID?.substring(0, 12)} not confirmed after ${verifyDelays.reduce((a, b) => a + b, 0) / 1000}s. Treating as unfilled.`);
        await appendLiveTrade({
          type: 'OPEN_UNCONFIRMED',
          ts: new Date().toISOString(),
          marketSlug,
          side,
          tokenID,
          price: buyPrice,
          size,
          orderID: resp?.orderID || null,
        });
        return emptyResult;
      }

      // ── Fill confirmed — create structured trade record ──
      const tradeId = Date.now().toString() + Math.random().toString(36).substring(2, 8);
      const fillSizeUsd = buyPrice * size;
      const structuredTrade = {
        id: tradeId,
        timestamp: new Date().toISOString(),
        marketSlug,
        marketSettlementTime: deriveMarketSettlementTime(marketSlug),
        side,
        instrument: 'POLY',
        entryPrice: buyPrice,
        shares: size,
        contractSize: fillSizeUsd,
        status: 'OPEN',
        entryTime: new Date().toISOString(),
        exitPrice: null,
        exitTime: null,
        pnl: 0,
        entryPhase: phase,
        entryReason: 'Live',
        maxUnrealizedPnl: 0,
        minUnrealizedPnl: 0,
        tokenID,
        orderID: resp?.orderID || null,
        mode: 'live',
        ...metadata,
      };

      this.openTrade = structuredTrade;
      syncTradeToStoreByTimeframe(structuredTrade, 'live', this.config?.timeframe);

      console.log(`[live] Fill CONFIRMED: ${side} ${size} shares @ ${(buyPrice * 100).toFixed(1)}¢ ($${fillSizeUsd.toFixed(2)})`);

      return {
        filled: true,
        tradeId,
        fillPrice: buyPrice,
        fillShares: size,
        fillSizeUsd,
        orderId: resp?.orderID || null,
      };
    } catch (e) {
      // Create and store structured failure event
      const failEvent = createFailureEvent(null, e, retryCount - 1);
      this._recordFailureEvent(failEvent);
      console.error(`[live] OPEN failed after ${retryCount} attempt(s): ${e?.message || e}`);

      await appendLiveTrade({
        type: 'OPEN_FAILED',
        ts: new Date().toISOString(),
        marketSlug,
        side,
        tokenID,
        error: e?.response?.data || e?.message || String(e),
        retryCount: retryCount - 1,
      });
      return emptyResult;
    }
  }

  /**
   * @param {CloseRequest} request
   * @returns {Promise<CloseResult>}
   */
  async closePosition(request) {
    const { tradeId, side, shares, reason, tokenID, exitMetadata } = request;
    const tid = tokenID || tradeId;

    if (!tid) {
      return { closed: false, exitPrice: 0, pnl: 0, reason };
    }

    // Exit spam guard (5s cooldown — enough to prevent double-sends, short enough for 5-min markets)
    const cooldownMs = 5_000;
    const now = Date.now();
    const lastAttempt = this._lastExitAttemptMsByToken.get(tid) ?? 0;
    if (now - lastAttempt < cooldownMs) {
      return { closed: false, exitPrice: 0, pnl: 0, reason: 'Exit cooldown' };
    }
    this._lastExitAttemptMsByToken.set(tid, now);

    // Refresh trade snapshot
    try {
      this._cachedTrades = await this.client.getTrades();
      this._lastTradesFetchSuccessMs = now;
    } catch {
      // best-effort
    }

    let size = Math.max(5, Math.floor(Number(shares)));

    // Ensure conditional token allowance via ApprovalService
    try {
      const maxSell = Math.min(size, await this.approvalService.getSellableQty(tid));

      if (maxSell < 5) {
        const approvalStatus = this.approvalService.getStatus().conditional[tid];
        await appendLiveTrade({
          type: 'EXIT_SELL_SKIPPED',
          ts: new Date().toISOString(),
          tokenID: tid,
          reason,
          note: `Insufficient conditional balance/allowance (bal=${approvalStatus?.balance ?? '?'}, allow=${approvalStatus?.allowance ?? '?'})`,
        });
        return { closed: false, exitPrice: 0, pnl: 0, reason };
      }
      size = maxSell;
    } catch {
      // best-effort; proceed with requested size
    }

    // Fetch sell price
    let sellPrice = null;
    try {
      sellPrice = await fetchClobPrice({ tokenId: tid, side: 'sell' });
    } catch {
      sellPrice = null;
    }
    if (!isNum(sellPrice) || sellPrice <= 0) {
      sellPrice = 0.01; // fallback: will almost certainly fill
    }

    // Fetch fee rate for exit observability
    let exitFeeRateBps = null;
    let exitFeeImpact = null;
    try {
      exitFeeRateBps = await this.feeService.getFeeRateBps(tid);
      if (exitFeeRateBps !== null) {
        exitFeeImpact = this.feeService.computeFeeImpact(sellPrice * size, sellPrice, exitFeeRateBps);
        console.log(
          `[live] Exit fee: ${exitFeeRateBps} bps | est. $${exitFeeImpact.feeUsd.toFixed(4)} on $${(sellPrice * size).toFixed(2)} notional`,
        );
      }
    } catch {
      // best-effort
    }

    let retryCount = 0;
    try {
      const { OrderType } = await import('@polymarket/clob-client');

      // Wrap exit CLOB call with retry policy
      const resp = await withOrderRetry(
        async () => {
          retryCount++;
          return this.client.createAndPostOrder(
            { tokenID: tid, price: sellPrice, size, side: 'SELL' },
            {},
            OrderType.FOK, // Fill-Or-Kill: instant fill or cancel
            false,
            false,
          );
        },
        {
          maxAttempts: this._maxOrderRetries,
          delays: this._retryDelays,
        },
      );

      // Track exit order lifecycle
      if (resp?.orderID) {
        const lifecycle = this.orderManager.trackOrder(resp.orderID, {
          tokenID: tid, side: 'SELL', price: sellPrice, size,
          extra: { reason, type: 'EXIT_SELL' },
        });
        if (lifecycle) {
          lifecycle.transition(LIFECYCLE_STATES.PENDING);
        }
      }

      await appendLiveTrade({
        type: 'EXIT_SELL',
        ts: new Date().toISOString(),
        tokenID: tid,
        price: sellPrice,
        size,
        reason,
        feeRateBps: exitFeeRateBps,
        feeImpact: exitFeeImpact,
        retryCount: retryCount - 1,
        resp,
      });
      return this._finalizeClosedTrade({
        sellPrice,
        size,
        reason,
        exitMetadata,
        tokenID: tid,
      });
    } catch (e) {
      const originalError = e;
      console.warn(`[live] EXIT primary FOK failed for ${tid}: ${e?.message || e}`);
      try {
        const { OrderType } = await import('@polymarket/clob-client');
        const fallbackPrice = 0.01;
        const fallbackResp = await this.client.createAndPostOrder(
          { tokenID: tid, price: fallbackPrice, size, side: 'SELL' },
          {},
          OrderType.FOK,
          false,
          false,
        );

        if (fallbackResp?.orderID) {
          const lifecycle = this.orderManager.trackOrder(fallbackResp.orderID, {
            tokenID: tid, side: 'SELL', price: fallbackPrice, size,
            extra: { reason, type: 'EXIT_SELL_FALLBACK' },
          });
          if (lifecycle) {
            lifecycle.transition(LIFECYCLE_STATES.PENDING);
          }
        }

        await appendLiveTrade({
          type: 'EXIT_SELL_FALLBACK',
          ts: new Date().toISOString(),
          tokenID: tid,
          price: fallbackPrice,
          size,
          reason,
          feeRateBps: exitFeeRateBps,
          feeImpact: exitFeeImpact,
          retryCount: retryCount - 1,
          resp: fallbackResp,
        });

        return this._finalizeClosedTrade({
          sellPrice: fallbackPrice,
          size,
          reason,
          exitMetadata,
          tokenID: tid,
        });
      } catch (fallbackError) {
        console.warn(`[live] EXIT fallback FOK failed for ${tid}: ${fallbackError?.message || fallbackError}`);
      }

      // Create and store structured failure event
      const failEvent = createFailureEvent(null, originalError, retryCount - 1);
      this._recordFailureEvent(failEvent);
      console.error(`[live] EXIT failed after ${retryCount} attempt(s): ${originalError?.message || originalError}`);

      await appendLiveTrade({
        type: 'EXIT_SELL_FAILED',
        ts: new Date().toISOString(),
        tokenID: tid,
        price: sellPrice,
        size,
        reason,
        error: originalError?.response?.data || originalError?.message || String(originalError),
        retryCount: retryCount - 1,
      });
      return { closed: false, exitPrice: 0, pnl: 0, reason };
    }
  }

  /**
   * @param {Object} signals
   * @returns {Promise<PositionView[]>}
   */
  async getOpenPositions(signals) {
    // Adaptive polling: faster when in position, slower when flat
    const now = Date.now();
    const interval = this._hadPositionLastLoop ? 1500 : 5000;
    const elapsed = now - this._lastTradesFetchAttemptMs;

    if (elapsed >= interval && !isClobCircuitOpen()) {
      this._lastTradesFetchAttemptMs = now;
      try {
        const trades = await this.client.getTrades();
        // Cap cached trades at 500 to bound memory
        this._cachedTrades = Array.isArray(trades)
          ? trades.slice(-500)
          : [];
        this._lastTradesFetchSuccessMs = now;
      } catch {
        // use cached
      }
    }

    // ── Timeout detection: auto-cancel orders pending > orderTimeoutMs ──
    try {
      const timedOut = this.orderManager.checkTimeouts(this._orderTimeoutMs);
      for (const lifecycle of timedOut) {
        console.warn(`[live] Order ${lifecycle.orderId} timed out (>${this._orderTimeoutMs / 1000}s). Attempting cancel...`);

        try {
          const cancelResult = await this.orderManager.cancelOrder(lifecycle.orderId);
          if (cancelResult.cancelled) {
            lifecycle.transition(LIFECYCLE_STATES.TIMED_OUT);
            console.log(`[live] Order ${lifecycle.orderId} cancelled after timeout`);
          } else {
            lifecycle.transition(LIFECYCLE_STATES.FAILED);
            lifecycle.error = `Cancel failed: ${cancelResult.error}`;
            console.warn(`[live] Order ${lifecycle.orderId} cancel failed: ${cancelResult.error}. Marking FAILED.`);
          }
        } catch (cancelErr) {
          lifecycle.transition(LIFECYCLE_STATES.FAILED);
          lifecycle.error = `Cancel exception: ${cancelErr?.message || cancelErr}`;
          console.warn(`[live] Order ${lifecycle.orderId} cancel exception: ${cancelErr?.message || cancelErr}. Marking FAILED.`);
        }
      }
    } catch {
      // timeout check is best-effort
    }

    // Auto-prune stale exit attempt timestamps (>10 min) when map is large
    if (this._lastExitAttemptMsByToken.size > 50) {
      const staleThreshold = now - 10 * 60_000;
      for (const [tid, ts] of this._lastExitAttemptMsByToken) {
        if (ts < staleThreshold) this._lastExitAttemptMsByToken.delete(tid);
      }
    }

    // Prune old terminal orders (>30 min)
    this.orderManager.pruneOldOrders(30 * 60_000);

    const allPositions = computePositionsFromTrades(this._cachedTrades);

    // Filter to only BTC market tokens — other bots (weather) share the same wallet
    const market = this.getMarket();
    const btcTokenIds = market ? new Set(getAllTokenIds(market)) : new Set();
    // Also include the openTrade tokenID if present
    if (this.openTrade?.tokenID) btcTokenIds.add(this.openTrade.tokenID);

    const rawPositions = btcTokenIds.size > 0
      ? allPositions.filter(p => btcTokenIds.has(p.tokenID))
      : allPositions;

    this._hadPositionLastLoop = rawPositions.length > 0;

    // ── Reconciliation: compare local tracking vs CLOB positions ──
    try {
      // Build local positions from OrderManager (active orders with fills)
      const activeOrders = this.orderManager.getActiveOrders();
      const localPositions = activeOrders
        .filter(o => o.fillSize > 0 && o.meta?.extra?.type === 'OPEN')
        .map(o => ({
          tokenID: o.meta.tokenID,
          qty: o.fillSize,
          side: o.meta.side === 'BUY' ? (o.meta.extra?.marketSlug ? 'UP' : 'UP') : 'DOWN',
          createdAtMs: o.timestamps?.SUBMITTED ?? 0,
        }));

      // Build CLOB positions from rawPositions
      const clobPositions = rawPositions.map(p => ({
        tokenID: p.tokenID,
        qty: p.qty,
        side: String(p.outcome || '').toUpperCase() === 'DOWN' ? 'DOWN' : 'UP',
      }));

      const reconResult = reconcilePositions(localPositions, clobPositions, {
        graceWindowMs: 10_000,
        nowMs: now,
      });

      this._reconciliationStatus = {
        status: reconResult.status,
        discrepancies: reconResult.discrepancies,
        lastCheckMs: now,
        lastDiscrepancyMs: reconResult.discrepancies.length > 0
          ? now
          : this._reconciliationStatus.lastDiscrepancyMs,
      };

      if (reconResult.discrepancies.length > 0) {
        // Only log count, not the full JSON (95 old positions spam the logs)
        console.warn(
          `[live] RECONCILIATION DISCREPANCY: ${reconResult.discrepancies.length} issue(s)`,
        );

        // Store as structured event for Phase 4 webhook
        this._recordFailureEvent({
          type: 'RECONCILIATION_DISCREPANCY',
          discrepancies: reconResult.discrepancies,
          timestamp: new Date().toISOString(),
          severity: 'warning',
          category: 'reconciliation',
        });
      }
    } catch {
      // Reconciliation errors should NOT prevent normal trading operations
      this._reconciliationStatus.status = SYNC_STATUS.CHECKING;
    }

    // Pre-approve conditional token allowance for any open position (via ApprovalService)
    for (const p of rawPositions) {
      if (p.tokenID) {
        // Fire-and-forget — ApprovalService handles its own cooldowns
        this.approvalService.checkAndApproveConditional(p.tokenID).catch(() => {});
      }
    }

    // If we have a structured openTrade, use it (better data than raw CLOB positions)
    if (this.openTrade && this.openTrade.status === 'OPEN') {
      const t = this.openTrade;

      // ── Auto-heal: check FIRST, before anything else ──
      // If market has settled 1+ min ago, close the trade regardless of CLOB state
      const settlementMs = (() => {
        if (t.marketSettlementTime) {
          const parsed = new Date(t.marketSettlementTime).getTime();
          if (Number.isFinite(parsed)) return parsed;
        }
        const slug = t.marketSlug || '';
        const match = slug.match(/(\d+)$/);
        if (!match) return null;
        return (Number(match[1]) + 300) * 1000;
      })();

      if (settlementMs && Date.now() > settlementMs + 60_000) {
        // Determine actual outcome from Polymarket API
        let pnl = 0;
        let exitReason = 'Auto-heal (market settled)';
        try {
          const winner = await fetchPolymarketOutcome(t.marketSlug);
          if (winner) {
            const won = winner === t.side;
            if (won) {
              // Winning side settles at $1 per share
              pnl = Number((t.shares * (1.0 - t.entryPrice)).toFixed(2));
              exitReason = `Market Settlement (Win)`;
            } else {
              // Losing side settles at $0
              pnl = Number((-t.contractSize).toFixed(2));
              exitReason = `Market Settlement (Loss)`;
            }
            console.log(`[live] Auto-heal: ${t.side} ${won ? 'WON' : 'LOST'} (winner: ${winner}) PnL: $${pnl}`);
          } else {
            console.warn(`[live] Auto-heal: couldn't determine outcome for ${t.marketSlug}`);
          }
        } catch (e) {
          console.warn(`[live] Auto-heal outcome fetch failed: ${e?.message}`);
        }

        if (pnl === 0 && exitReason === 'Auto-heal (market settled)') {
          const btcNow = signals?.spot?.price ?? null;
          const btcEntry = t.btcSpotAtEntry ?? null;

          if (isNum(btcNow) && isNum(btcEntry)) {
            const derivedWinner = btcNow > btcEntry ? 'UP' : 'DOWN';
            const won = derivedWinner === t.side;

            if (won) {
              pnl = Number((t.shares * (1.0 - t.entryPrice)).toFixed(2));
              exitReason = 'Market Settlement (Win - price derived)';
            } else {
              pnl = Number((-t.contractSize).toFixed(2));
              exitReason = 'Market Settlement (Loss - price derived)';
            }

            console.log(
              `[live] Auto-heal fallback: ${t.side} ${won ? 'WON' : 'LOST'} ` +
              `(derived: ${derivedWinner}, btcEntry=${btcEntry}, btcNow=${btcNow}) PnL: $${pnl}`
            );
          } else {
            pnl = Number((-t.contractSize).toFixed(2));
            exitReason = 'Market Settlement (Loss - no price data)';
            console.warn(`[live] Auto-heal: no price data for ${t.marketSlug}, assuming loss PnL: $${pnl}`);
          }
        }

        t.exitTime = new Date(settlementMs).toISOString();
        t.status = 'CLOSED';
        t.exitReason = exitReason;
        t.pnl = pnl;
        syncTradeToStoreByTimeframe(t, 'live', this.config?.timeframe);
        this.openTrade = null;
        console.warn(`[live] Auto-healed: ${t.marketSlug} | ${t.side} | PnL: $${pnl} | ${exitReason}`);
        // Fall through — no open positions to return
      }

      // If trade is still open (not auto-healed), return it as the position
      if (this.openTrade) {
        return [{
          id: t.id,
          side: t.side,
          marketSlug: t.marketSlug,
          entryPrice: t.entryPrice,
          shares: t.shares,
          contractSize: t.contractSize,
          mark: null,
          unrealizedPnl: null,
          maxUnrealizedPnl: t.maxUnrealizedPnl ?? 0,
          minUnrealizedPnl: t.minUnrealizedPnl ?? 0,
          entryTime: t.entryTime,
          lastTradeTime: null,
          tokenID: t.tokenID,
          outcome: t.side,
          tradable: true,
        }];
      }
    }

    // Fallback: Convert raw CLOB positions to PositionView[]
    return rawPositions.map((p) => ({
      id: p.tokenID,
      side: String(p.outcome || '').toUpperCase() === 'DOWN' ? 'DOWN' : 'UP',
      marketSlug: signals.market?.slug ?? 'unknown',
      entryPrice: p.avgEntry ?? 0,
      shares: p.qty,
      contractSize: (p.avgEntry ?? 0) * p.qty,
      mark: p.mark ?? null,
      unrealizedPnl: p.unrealizedPnl ?? null,
      maxUnrealizedPnl: 0, // Tracked by TradingState
      minUnrealizedPnl: 0,
      entryTime: null, // Live positions don't have a single entry time
      lastTradeTime: p.lastTradeTime ?? null,
      tokenID: p.tokenID,
      outcome: p.outcome,
      tradable: p.tradable !== false,
    }));
  }

  /**
   * @param {PositionView[]} positions
   * @param {Object} signals
   * @returns {Promise<PositionView[]>}
   */
  async markPositions(positions, signals) {
    // Use Polymarket prices from signals (same source as PaperExecutor)
    // This is more reliable than fetching orderbooks per-token, which
    // can return null/404 for active markets and caches them as expired
    const currentSlug = signals.market?.slug ?? null;

    return positions.map((p) => {
      // Skip marking if signals are for a different market than the position
      // (Polymarket API can flicker to next market before current one settles)
      if (p.marketSlug && currentSlug && p.marketSlug !== currentSlug) {
        return { ...p, mark: p.mark ?? null, unrealizedPnl: p.unrealizedPnl ?? null };
      }

      const poly = signals.polyMarketSnapshot;
      const rawUpC = signals.polyPricesCents?.UP ?? null;
      const rawDownC = signals.polyPricesCents?.DOWN ?? null;
      const obUp = poly?.orderbook?.up;
      const obDown = poly?.orderbook?.down;

      // For marking, use sell-side price (bid) — what we'd get if we sold
      let mark = null;
      if (p.side === 'UP') {
        mark = isNum(rawUpC) && rawUpC > 0
          ? rawUpC
          : (isNum(obUp?.bestBid) && obUp.bestBid > 0 ? obUp.bestBid : null);
      } else {
        mark = isNum(rawDownC) && rawDownC > 0
          ? rawDownC
          : (isNum(obDown?.bestBid) && obDown.bestBid > 0 ? obDown.bestBid : null);
      }

      let unrealizedPnl = null;
      if (isNum(mark) && isNum(p.shares) && isNum(p.contractSize)) {
        unrealizedPnl = p.shares * mark - p.contractSize;
      }

      return { ...p, mark, unrealizedPnl };
    });
  }

  /**
   * @returns {Promise<BalanceSnapshot>}
   */
  async getBalance() {
    const collateral = await this._collateralUsd();
    return {
      balance: collateral,
      starting: collateral, // Live doesn't have a "starting" concept
      realized: 0,
    };
  }

  /**
   * Get the current reconciliation status for API/dashboard.
   * @returns {{ status: string, discrepancies: Array, lastCheckMs: number, lastDiscrepancyMs: number|null }}
   */
  getReconciliationStatus() {
    return { ...this._reconciliationStatus };
  }

  // ─── Helpers ─────────────────────────────────────────────────

  async _collateralUsd() {
    try {
      const bal = await this.client.getBalanceAllowance({
        asset_type: 'COLLATERAL',
      });
      const base = Number(bal?.balance || 0);
      return base / 1e6; // 6 decimals
    } catch {
      return 0;
    }
  }

  async _finalizeClosedTrade({ sellPrice, size, reason, exitMetadata, tokenID }) {
    if (tokenID) {
      this._lastExitAttemptMsByToken.delete(tokenID);
    }

    let tradePnl = 0;
    let finalReason = reason;
    const trade = this.openTrade;

    if (trade) {
      const tradeShares = isNum(trade.shares) ? trade.shares : size;
      const valueNow = tradeShares * sellPrice;
      const rawPnl = valueNow - trade.contractSize;

      const capped = capPnl(
        rawPnl,
        trade.contractSize,
        tradeShares,
        sellPrice,
        this.config,
      );
      tradePnl = capped.pnl;

      const effectiveMaxLoss = computeMaxLossUsd(trade.contractSize, this.config);
      const maxLossAbs = Math.abs(effectiveMaxLoss ?? 0);
      if (rawPnl < -maxLossAbs && tradePnl !== rawPnl) {
        finalReason = `Max Loss ($${maxLossAbs.toFixed(2)})`;
      }

      trade.exitPrice = capped.exitPrice;
      trade.exitTime = new Date().toISOString();
      trade.pnl = Number(tradePnl.toFixed(2));
      trade.status = 'CLOSED';
      trade.exitReason = finalReason;

      if (exitMetadata && typeof exitMetadata === 'object') {
        Object.assign(trade, exitMetadata);
      }

      if (!trade.marketSettlementTime) {
        trade.marketSettlementTime = deriveMarketSettlementTime(trade.marketSlug);
      }
      if (trade.btcAtExit === undefined || trade.btcAtExit === null) {
        trade.btcAtExit = trade.btcSpotAtExit ?? exitMetadata?.btcSpotAtExit ?? null;
      }

      syncTradeToStoreByTimeframe(trade, 'live', this.config?.timeframe);
      this.openTrade = null;
    }

    return {
      closed: true,
      exitPrice: sellPrice,
      pnl: tradePnl,
      reason: finalReason,
    };
  }

  async _prewarmApprovals() {
    try {
      const positions = await this.client.getPositions();
      if (!Array.isArray(positions) || positions.length === 0) {
        console.log('[live] No open positions to pre-warm approvals for');
        return;
      }

      let warmed = 0;
      for (const position of positions) {
        const qty = Number(position?.qty ?? position?.size ?? 0);
        if (!position?.tokenID || !Number.isFinite(qty) || qty <= 0) {
          continue;
        }

        try {
          if (typeof this._ensureConditionalAllowance === 'function') {
            await this._ensureConditionalAllowance(position.tokenID);
            console.log(`[live] Pre-warmed approval for tokenID: ${position.tokenID}`);
            warmed++;
          }
        } catch (e) {
          console.warn(`[live] Pre-warm approval failed for tokenID ${position.tokenID}: ${e?.message || e}`);
        }
      }

      if (warmed === 0) {
        console.log('[live] No open positions to pre-warm approvals for');
      }
    } catch (e) {
      console.warn('[live] Failed to pre-warm approvals:', e?.message || e);
    }
  }

  async _ensureConditionalAllowance(tokenID) {
    return this.approvalService.checkAndApproveConditional(tokenID);
  }
}
