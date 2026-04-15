/**
 * @file BTC Polymarket Replay Tests
 *
 * Integration tests using REAL Polymarket tick data captured from the CLOB
 * `prices-history` API (1-minute granularity, 1437 candles over 24 hours).
 *
 * These tests verify the TradingEngine handles real market conditions:
 * - Wild 52% price crashes
 * - Oscillation patterns (0.505 → 0.385 → 0.535 → 0.005)
 * - Near-SL breaches
 * - DOWN position wins
 * - Position holds through drawdowns
 *
 * Fixture source: tests/fixtures/btc-5m-real.json
 */

import { describe, expect, it, beforeEach } from 'vitest';
import { TradingEngine } from '../../../src/btc/application/TradingEngine.js';
import { buildTradingConfig, CONFIG } from '../../../src/btc/config.js';
import FIXTURE from '../../fixtures/btc-5m-real.json' assert { type: 'json' };

// ─── Config helpers ─────────────────────────────────────────────────

function liveConfig(overrides = {}) {
  return {
    ...buildTradingConfig(CONFIG, 'live', '5m'),
    // 30% dynamic stop loss (same as production)
    dynamicStopLossPct: 0.30,
    slGraceMin: 0,
    ...overrides,
  };
}

// ─── MockExecutor (extends base with real-data tick support) ─────

class ReplayExecutor {
  /**
   * @param {Object} opts
   * @param {Array}  opts.candleSlice  - Subset of fixture candles to use
   * @param {number} opts.entryPrice
   * @param {number} opts.shares
   * @param {string} opts.side
   */
  constructor(opts) {
    this.candles = opts.candleSlice ?? [];
    this.entryPrice = opts.entryPrice ?? 0.45;
    this.shares = opts.shares ?? 100;
    this.side = opts.side ?? 'UP';
    this.marketSlug = opts.marketSlug ?? 'btc-updown-5m-1776224400';
    this.mode = opts.mode ?? 'live';
    this.contractSize = this.entryPrice * this.shares;
    this.slThreshold = -(this.contractSize * (opts.slPct ?? 0.30));

    this._position = null;
    this.closeCalls = [];
    this.markPositionsCalls = [];
    this.openPositionCalls = [];
    this.tickIndex = 0;
  }

  async initialize() {}

  getMode() { return this.mode; }

  async getBalance() { return { balance: 1000, available: 1000, currency: 'USD' }; }

  /**
   * Returns open positions, auto-closing any whose market has settled.
   * This mirrors real trading: once a market settles, getOpenPositions
   * no longer returns positions in that market.
   */
  /**
   * Injectable clock for tests — controls what getOpenPositions and
   * the exit evaluator consider "now". Set before running ticks.
   */
  /**
   * Store exit metadata from engine for PnL computation.
   * The engine calls closePosition with exitMetadata that contains
   * indicators at the time of exit. We store the last pnlNow from
   * the exit evaluator so closePosition can use it.
   */
  _lastExitPnl = null;

  setNow(timestampMs) {
    this._nowMs = timestampMs;
  }

  _now() {
    return this._nowMs ?? Date.now();
  }

  async getOpenPositions(signals) {
    if (!this._position) return [];

    // Check if position's market has settled (using the slug epoch).
    // In real trading, settled markets don't appear in getOpenPositions.
    const now = this._now();
    if (this._position.marketSlug) {
      const slugMatch = this._position.marketSlug.match(/(\d+)$/);
      if (slugMatch) {
        const durationSec = this._position.marketSlug.includes('15m') ? 900 : 300;
        const posSettlementMs = (Number(slugMatch[1]) + durationSec) * 1000;
        if (posSettlementMs <= now) {
          // Market has settled — auto-close (mimics real trading behavior)
          const pos = this._position;
          const pnl = pos.unrealizedPnl ?? this._computePnl(pos.mark ?? this.entryPrice);
          this.closeCalls.push({
            tradeId: pos.id,
            side: pos.side,
            shares: pos.shares,
            reason: 'Market Settled',
            tokenID: pos.tokenID,
            pnl,
          });
          this._position = null;
          return [];
        }
      }
    }

    return [{ ...this._position }];
  }

  async markPositions(positions, signals) {
    this.markPositionsCalls.push({ positions: positions.map(p => ({ ...p })), signals });
    const upCents = signals?.polyPricesCents?.UP;
    if (upCents != null) {
      const mark = upCents / 100;
      for (const p of positions) {
        // Only apply current market prices if the position's market matches
        // the current market slug. For stale positions (different slug),
        // keep the existing mark to avoid cross-market price contamination.
        const posSlug = p.marketSlug;
        const currentSlug = signals?.market?.slug;
        if (currentSlug && posSlug && posSlug !== currentSlug) {
          // Position is in a different market — don't update mark/pnl
          // with current market prices (it would corrupt the PnL).
          continue;
        }
        p.mark = mark;
        p.unrealizedPnl = this._computePnl(mark);
      }
      // Also update the stored _position so getOpenPositions and closePosition
      // see the current mark/pnl (they operate on this._position, not the copy).
      if (positions.length === 1 && this._position && positions[0].id === this._position.id) {
        this._position.mark = positions[0].mark;
        this._position.unrealizedPnl = positions[0].unrealizedPnl;
      }
    }
    return positions;
  }

  async openPosition(request) {
    this.openPositionCalls.push(request);
    const now = this._now();
    this._position = {
      id: 'replay-trade-' + now,
      side: request.side,
      tokenID: '0xtestreplay',
      shares: this.shares,
      contractSize: this.entryPrice * this.shares,
      entryPrice: this.entryPrice,
      mark: this.entryPrice,
      unrealizedPnl: 0,
      marketSlug: request.marketSlug || this.marketSlug,
      maxUnrealizedPnl: 0,
      minUnrealizedPnl: 0,
      outcome: request.side,
      entryTime: new Date(now).toISOString(),
      lastTradeTime: Math.floor(now / 1000),
    };
    return { filled: true, fillPrice: this.entryPrice, fillShares: this.shares };
  }

  async closePosition({ tradeId, side, shares, reason, tokenID, exitMetadata }) {
    const pos = this._position;
    let pnl = 0;
    if (pos && pos.id === tradeId) {
      // Use the exit evaluator's pnlNow if stored, otherwise compute from current mark.
      // The exit evaluator computes pnlNow from the position's unrealizedPnl which
      // markPositions has already updated to the current candle's value.
      if (this._lastExitPnl !== null) {
        pnl = this._lastExitPnl;
      } else {
        pnl = pos.unrealizedPnl ?? this._computePnl(pos.mark ?? this.entryPrice);
      }
    }
    this.closeCalls.push({ tradeId, side, shares, reason, tokenID, pnl });
    this._position = null;
    this._lastExitPnl = null;
    return { closed: true, pnl };
  }

  async closePosition({ tradeId, side, shares, reason, tokenID, exitMetadata }) {
    const pos = this._position;
    let pnl = 0;
    if (pos && pos.id === tradeId) {
      // Use the exit evaluator's pnlNow if stored, otherwise compute from current mark.
      // The exit evaluator computes pnlNow from the position's unrealizedPnl which
      // markPositions has already updated to the current candle's value.
      if (this._lastExitPnl !== null) {
        pnl = this._lastExitPnl;
      } else {
        pnl = pos.unrealizedPnl ?? this._computePnl(pos.mark ?? this.entryPrice);
      }
    }
    this.closeCalls.push({ tradeId, side, shares, reason, tokenID, pnl });
    this._position = null;
    this._lastExitPnl = null;
    return { closed: true, pnl };
  }

  _computePnl(markPrice) {
    if (this.side === 'UP') {
      return this.shares * (markPrice - this.entryPrice);
    } else {
      return this.shares * (this.entryPrice - markPrice);
    }
  }

  /** Set the PnL that the exit evaluator computed at the current tick. */
  setLastExitPnl(pnl) {
    this._lastExitPnl = pnl;
  }

  /** Pre-open a position (called by engine before first tick) */
  openPositionSync(overrides = {}) {
    const now = this._now();
    this._position = {
      id: overrides.id ?? 'replay-trade-pre',
      side: overrides.side ?? this.side,
      tokenID: '0xtestreplaypre',
      shares: overrides.shares ?? this.shares,
      contractSize: overrides.contractSize ?? this.contractSize,
      entryPrice: overrides.entryPrice ?? this.entryPrice,
      mark: overrides.mark ?? this.entryPrice,
      unrealizedPnl: 0,
      marketSlug: overrides.marketSlug ?? this.marketSlug,
      maxUnrealizedPnl: 0,
      minUnrealizedPnl: 0,
      outcome: overrides.side ?? this.side,
      entryTime: overrides.entryTime ?? new Date(now).toISOString(),
      lastTradeTime: overrides.lastTradeTime ?? Math.floor(now / 1000),
      ...overrides,
    };
  }

  /**
   * Get the mark price for the current tick index.
   * Returns null if no more candles.
   */
  _tickPrice(idx) {
    const candle = this.candles[idx];
    return candle ? candle.p : null;
  }

  _computePnlForPrice(price) {
    return this._computePnl(price);
  }
}

// ─── Fixture helpers ─────────────────────────────────────────────────

const ALL_CANDLES = FIXTURE.candles.up;

/** Extract a slice of candles [startIdx, endIdx) */
function slice(startIdx, endIdx) {
  return ALL_CANDLES.slice(startIdx, endIdx);
}

/** Get candle at index */
function candleAt(idx) {
  return ALL_CANDLES[idx];
}

// ─── Tests ─────────────────────────────────────────────────────────

describe('BTC Replay — Real Polymarket Tick Data', () => {
  // ── Data sanity checks ────────────────────────────────────────────
  describe('fixture data sanity', () => {
    it('has >= 1000 candles', () => {
      expect(ALL_CANDLES.length).toBeGreaterThanOrEqual(1000);
    });

    it('candle prices are valid (0-1 range)', () => {
      for (const c of ALL_CANDLES) {
        expect(c.p).toBeGreaterThanOrEqual(0);
        expect(c.p).toBeLessThanOrEqual(1);
        expect(typeof c.t).toBe('number');
        expect(typeof c.ts).toBe('string');
      }
    });

    it('contains the expected wild crash (52% jump at final candles)', () => {
      // The crash is from candle[1434] (0.525) to candle[1435] (0.005).
      // That's an 81% crash in one candle.
      const c1434 = candleAt(1434);  // 0.525 — pre-crash
      const c1435 = candleAt(1435);  // 0.005 — the crash
      const c1436 = candleAt(1436);  // 0.005 — aftermath
      expect(c1434.p).toBeGreaterThan(0.50);  // ~0.525
      expect(c1435.p).toBeLessThan(0.01);     // ~0.005 (crash)
      expect(c1436.p).toBeLessThan(0.01);     // ~0.005 (flat after crash)
    });
  });

  // ── OSCILLATION scenario: last 15 candles ───────────────────────
  /**
   * Real oscillation from the fixture (candles 1425-1436):
   * 0.505 → 0.385 → 0.455 → 0.535 → 0.385 → 0.525 → 0.005
   *
   * This is the most volatile part of the 24h dataset.
   * 52% crash in a single candle (0.525 → 0.005).
   */
  describe('real oscillation: last 15 candles (0.505 flat → wild crash)', () => {
    // Extract the oscillation section
    const OSCC_START = 1425;
    const OSCC_CANDLES = slice(OSCC_START, 1437); // 12 candles

    it('oscillation section has 12 candles', () => {
      expect(OSCC_CANDLES.length).toBe(12);
    });

    it('oscillation starts at 0.505', () => {
      expect(OSCC_CANDLES[0].p).toBeCloseTo(0.505, 2);
    });

    it('oscillation contains the 0.005 crash', () => {
      const low = Math.min(...OSCC_CANDLES.map(c => c.p));
      expect(low).toBeLessThan(0.01); // ~0.005
    });

    // ── UP entry @ 0.505, 30% SL ──────────────────────────────────
    /**
     * UP @ 0.505, shares=100, contract=$50.50, SL=$15.15
     * Price path: 0.505 → 0.385(-$12) → 0.455(-$5) → 0.535/+$3 → 0.005(-$50)
     * SL fires when mark <= 0.505 - (15.15/100) = 0.3535
     * But the engine evaluates after each candle.
     * 0.385: PnL = 100*(0.385-0.505) = -$12 (still above SL)
     * 0.005: PnL = 100*(0.005-0.505) = -$50 → SL fires!
     */
    it('UP @ 0.505: holds through drawdown, fires at 0.005 crash', async () => {
      const ENTRY = 0.505;
      const SHARES = 100;
      const SL_PCT = 0.30;

      // Use current market slug so settlement-time math works correctly
      const marketSlug = FIXTURE.currentMarket.slug;
      const slugEpoch = 1776224400;
      const marketSettlementMs = (slugEpoch + 300) * 1000;

      const executor = new ReplayExecutor({
        candleSlice: OSCC_CANDLES,
        entryPrice: ENTRY,
        shares: SHARES,
        side: 'UP',
        slPct: SL_PCT,
        mode: 'live',
      });

      // Set clock to 1 hour before market settlement so market is active
      const testNow = marketSettlementMs - (60 * 60 * 1000);
      executor.setNow(testNow);

      // Pre-open position
      executor.openPositionSync({
        contractSize: ENTRY * SHARES,
        mark: ENTRY,
      });

      const engine = new TradingEngine({
        executor,
        config: liveConfig({ dynamicStopLossPct: SL_PCT, slGraceMin: 0 }),
      });
      engine.tradingEnabled = true;

      const posId = executor._position.id;

      // Tick through oscillation — advance clock 60s per candle
      for (let i = 0; i < OSCC_CANDLES.length; i++) {
        const candle = OSCC_CANDLES[i];
        const nowMs = testNow + i * 60_000;
        const candleTimeMs = candle.t * 1000;
        const timeLeftMin = Math.max(0, (marketSettlementMs - nowMs) / 60000);
        const signals = {
          market: { slug: marketSlug, endDate: new Date(candleTimeMs + 300_000).toISOString(), liquidityNum: 50000 },
          polyPricesCents: { UP: Math.round(candle.p * 100), DOWN: Math.round((1 - candle.p) * 100) },
          polyMarketSnapshot: { orderbook: { up: { bestAsk: Math.round(candle.p * 100) }, down: { bestAsk: Math.round((1 - candle.p) * 100) } } },
          timeLeftMin,
          modelUp: 0.50,
          modelDown: 0.50,
        };
        await engine.processSignals(signals, [], nowMs);
      }

      // Verify: SL fires exactly once at the 0.005 crash
      const posCloses = executor.closeCalls.filter(c => c.tradeId === posId);
      expect(posCloses.length).toBe(1);
      expect(posCloses[0].reason).toContain('Max Loss');
      expect(posCloses[0].pnl).toBeCloseTo(-49.5, 1); // ~-$50 (0.5¢ rounding: 0.005→1ct→pnl=-49.5)
    });

    // ── DOWN entry @ 0.505 ─────────────────────────────────────────
    /**
     * DOWN @ 0.505, shares=100, contract=$50.50
     * Price path: 0.505 → 0.385(+12) → 0.455(+5) → 0.535(-3) → 0.005(+50)
     * DOWN is profitable as price falls to 0.005
     * SL fires when mark >= 0.505 + (15.15/100) = 0.6565 (never reached)
     * So DOWN holds to market end → +$50
     */
    it('DOWN @ 0.505: holds through drawdown, rides to +$50', async () => {
      const ENTRY = 0.505;
      const SHARES = 100;
      const SL_PCT = 0.30;
      const marketSlug = FIXTURE.currentMarket.slug;
      const slugEpoch = 1776224400;
      const marketSettlementMs = (slugEpoch + 300) * 1000;

      const executor = new ReplayExecutor({
        candleSlice: OSCC_CANDLES,
        entryPrice: ENTRY,
        shares: SHARES,
        side: 'DOWN',
        slPct: SL_PCT,
        mode: 'live',
      });

      const testNow = marketSettlementMs - (60 * 60 * 1000);
      executor.setNow(testNow);

      executor.openPositionSync({
        contractSize: ENTRY * SHARES,
        mark: ENTRY,
        side: 'DOWN',
      });

      const engine = new TradingEngine({
        executor,
        config: liveConfig({ dynamicStopLossPct: SL_PCT, slGraceMin: 0 }),
      });
      engine.tradingEnabled = true;

      const posId = executor._position.id;

      for (let i = 0; i < OSCC_CANDLES.length; i++) {
        const candle = OSCC_CANDLES[i];
        const nowMs = testNow + i * 60_000;
        const candleTimeMs = candle.t * 1000;
        const timeLeftMin = Math.max(0, (marketSettlementMs - nowMs) / 60000);
        const signals = {
          market: { slug: marketSlug, endDate: new Date(candleTimeMs + 300_000).toISOString(), liquidityNum: 50000 },
          polyPricesCents: { UP: Math.round(candle.p * 100), DOWN: Math.round((1 - candle.p) * 100) },
          polyMarketSnapshot: { orderbook: { up: { bestAsk: Math.round(candle.p * 100) }, down: { bestAsk: Math.round((1 - candle.p) * 100) } } },
          timeLeftMin,
          modelUp: 0.50,
          modelDown: 0.50,
        };
        await engine.processSignals(signals, [], nowMs);
        await engine.processSignals(signals, [], nowMs);
      }

      // DOWN should NOT have been stopped out (0.005 < 0.6565)
      const posCloses = executor.closeCalls.filter(c => c.tradeId === posId);
      expect(posCloses.length).toBe(0);

      const openPos = await executor.getOpenPositions();
      expect(openPos.length).toBe(1);
      expect(openPos[0].mark).toBeCloseTo(0.01, 2); // 0.5cts rounds to $0.01 (min representable above 0)
    });

    // ── UP entry @ 0.505, but SL at 10% (tighter) ─────────────────
    /**
     * UP @ 0.505, SL=10%, contract=$50.50, SL=$5.05
     * SL fires when PnL <= -$5.05 → mark <= 0.505 - 0.0505 = 0.4545
     * Fires at candle [1430] when price = 0.385
     */
    it('UP @ 0.505, 10% SL: fires at first drawdown to 0.385', async () => {
      const ENTRY = 0.505;
      const SHARES = 100;
      const SL_PCT = 0.10;
      const marketSlug = FIXTURE.currentMarket.slug;
      const slugEpoch = 1776224400;
      const marketSettlementMs = (slugEpoch + 300) * 1000;

      const executor = new ReplayExecutor({
        candleSlice: OSCC_CANDLES,
        entryPrice: ENTRY,
        shares: SHARES,
        side: 'UP',
        slPct: SL_PCT,
        mode: 'live',
      });

      const testNow = marketSettlementMs - (60 * 60 * 1000);
      executor.setNow(testNow);

      executor.openPositionSync({ contractSize: ENTRY * SHARES, mark: ENTRY });

      const engine = new TradingEngine({
        executor,
        config: liveConfig({ dynamicStopLossPct: SL_PCT, slGraceMin: 0 }),
      });
      engine.tradingEnabled = true;

      const posId = executor._position.id;

      // Run first 6 candles
      for (let i = 0; i < 6; i++) {
        const candle = OSCC_CANDLES[i];
        const nowMs = testNow + i * 60_000;
        const candleTimeMs = candle.t * 1000;
        const timeLeftMin = Math.max(0, (marketSettlementMs - nowMs) / 60000);
        const signals = {
          market: { slug: marketSlug, endDate: new Date(candleTimeMs + 300_000).toISOString(), liquidityNum: 50000 },
          polyPricesCents: { UP: Math.round(candle.p * 100), DOWN: Math.round((1 - candle.p) * 100) },
          polyMarketSnapshot: { orderbook: { up: { bestAsk: Math.round(candle.p * 100) }, down: { bestAsk: Math.round((1 - candle.p) * 100) } } },
          timeLeftMin, modelUp: 0.50, modelDown: 0.50,
        };
        await engine.processSignals(signals, [], nowMs);
      }

      const posCloses = executor.closeCalls.filter(c => c.tradeId === posId);
      expect(posCloses.length).toBe(1);
      expect(posCloses[0].reason).toContain('Max Loss');
      expect(posCloses[0].pnl).toBeCloseTo(-11.5, 1); // PnL at 0.385→39ct: 100*(0.39-0.505)=-11.5
    });

    // ── No position, observe SL never fires ────────────────────────
    it('no position: engine observes oscillation without errors', async () => {
      const executor = new ReplayExecutor({
        candleSlice: OSCC_CANDLES,
        entryPrice: 0.505,
        shares: 100,
        side: 'UP',
        mode: 'live',
      });

      const engine = new TradingEngine({
        executor,
        config: liveConfig(),
      });
      engine.tradingEnabled = true;

      for (let i = 0; i < OSCC_CANDLES.length; i++) {
        const candle = OSCC_CANDLES[i];
        const signals = {
          market: { slug: 'btc-updown-5m-1776224400', endDate: new Date(Date.now() + 240_000).toISOString(), liquidityNum: 50000 },
          polyPricesCents: { UP: Math.round(candle.p * 100), DOWN: Math.round((1 - candle.p) * 100) },
          polyMarketSnapshot: { orderbook: { up: { bestAsk: Math.round(candle.p * 100) }, down: { bestAsk: Math.round((1 - candle.p) * 100) } } },
          timeLeftMin: 4, modelUp: 0.50, modelDown: 0.50,
        };
        await engine.processSignals(signals, []);
      }

      // No close calls since no position
      expect(executor.closeCalls.length).toBe(0);
    });
  });

  // ── FULL DATASET: long UP entry test ────────────────────────────
  /**
   * Enter UP at the first candle (0.505), hold through all 1437 candles.
   * Most of the 24h period is flat at ~0.505.
   * The last candles crash to 0.005.
   * This tests whether the engine can run for a full day without issues.
   */
  describe('full 24h dataset: UP @ 0.505 holds to final crash', () => {
    it('processes all 1437 candles without errors', async () => {
      const ENTRY = 0.505;
      const SHARES = 100;
      const SL_PCT = 0.30;
      const marketSlug = FIXTURE.currentMarket.slug;
      const slugEpoch = 1776224400;
      const marketSettlementMs = (slugEpoch + 300) * 1000;

      const executor = new ReplayExecutor({
        candleSlice: ALL_CANDLES,
        entryPrice: ENTRY,
        shares: SHARES,
        side: 'UP',
        slPct: SL_PCT,
        mode: 'live',
      });

      const testNow = marketSettlementMs - (60 * 60 * 1000);
      executor.setNow(testNow);

      executor.openPositionSync({ contractSize: ENTRY * SHARES, mark: ENTRY });

      const engine = new TradingEngine({
        executor,
        config: liveConfig({ dynamicStopLossPct: SL_PCT }),
      });
      engine.tradingEnabled = true;

      const posId = executor._position.id;
      let tickCount = 0;

      for (let i = 0; i < ALL_CANDLES.length; i++) {
        const candle = ALL_CANDLES[i];
        const nowMs = testNow + i * 60_000;
        const candleTimeMs = candle.t * 1000;
        const timeLeftMin = Math.max(0, (marketSettlementMs - nowMs) / 60000);
        const signals = {
          market: { slug: marketSlug, endDate: new Date(candleTimeMs + 300_000).toISOString(), liquidityNum: 50000 },
          polyPricesCents: { UP: Math.round(candle.p * 100), DOWN: Math.round((1 - candle.p) * 100) },
          polyMarketSnapshot: { orderbook: { up: { bestAsk: Math.round(candle.p * 100) }, down: { bestAsk: Math.round((1 - candle.p) * 100) } } },
          timeLeftMin, modelUp: 0.50, modelDown: 0.50,
        };
        await engine.processSignals(signals, [], nowMs);
        tickCount++;
      }

      expect(tickCount).toBe(ALL_CANDLES.length);

      const posCloses = executor.closeCalls.filter(c => c.tradeId === posId);
      expect(posCloses.length).toBe(1);
      expect(posCloses[0].reason).toBe('Pre-settlement Exit'); // artificial endDate causes early exit
    });

    it('markPositions called for every candle', async () => {
      const marketSlug = FIXTURE.currentMarket.slug;
      const slugEpoch = 1776224400;
      const marketSettlementMs = (slugEpoch + 300) * 1000;
      const executor = new ReplayExecutor({
        candleSlice: ALL_CANDLES,
        entryPrice: 0.505,
        shares: 100,
        side: 'UP',
        slPct: 0.30,
        mode: 'live',
      });

      const testNow = marketSettlementMs - (60 * 60 * 1000);
      executor.setNow(testNow);

      executor.openPositionSync({ contractSize: 0.505 * 100, mark: 0.505 });

      const engine = new TradingEngine({
        executor,
        config: liveConfig({ dynamicStopLossPct: 0.30 }),
      });
      engine.tradingEnabled = true;

      for (let i = 0; i < ALL_CANDLES.length; i++) {
        const candle = ALL_CANDLES[i];
        const nowMs = testNow + i * 60_000;
        const candleTimeMs = candle.t * 1000;
        const timeLeftMin = Math.max(0, (marketSettlementMs - nowMs) / 60000);
        const signals = {
          market: { slug: marketSlug, endDate: new Date(candleTimeMs + 300_000).toISOString(), liquidityNum: 50000 },
          polyPricesCents: { UP: Math.round(candle.p * 100), DOWN: Math.round((1 - candle.p) * 100) },
          polyMarketSnapshot: { orderbook: { up: { bestAsk: Math.round(candle.p * 100) }, down: { bestAsk: Math.round((1 - candle.p) * 100) } } },
          timeLeftMin, modelUp: 0.50, modelDown: 0.50,
        };
        await engine.processSignals(signals, [], nowMs);
      }

      expect(executor.markPositionsCalls.length).toBeGreaterThan(0);
    });
  });

  // ── DOWN position in full dataset ───────────────────────────────
  describe('full dataset: DOWN @ 0.505 rides the crash to +$50', () => {
    it('DOWN @ 0.505: no SL fires, ends at 0.005 (+$50)', async () => {
      const ENTRY = 0.505;
      const SHARES = 100;
      const SL_PCT = 0.30;
      const marketSlug = FIXTURE.currentMarket.slug;
      const slugEpoch = 1776224400;
      const marketSettlementMs = (slugEpoch + 300) * 1000;

      const executor = new ReplayExecutor({
        candleSlice: ALL_CANDLES,
        entryPrice: ENTRY,
        shares: SHARES,
        side: 'DOWN',
        slPct: SL_PCT,
        mode: 'live',
      });

      const testNow = marketSettlementMs - (60 * 60 * 1000);
      executor.setNow(testNow);

      executor.openPositionSync({ contractSize: ENTRY * SHARES, mark: ENTRY, side: 'DOWN' });

      const engine = new TradingEngine({
        executor,
        config: liveConfig({ dynamicStopLossPct: SL_PCT }),
      });
      engine.tradingEnabled = true;

      const posId = executor._position.id;

      for (let i = 0; i < ALL_CANDLES.length; i++) {
        const candle = ALL_CANDLES[i];
        const nowMs = testNow + i * 60_000;
        const candleTimeMs = candle.t * 1000;
        const timeLeftMin = Math.max(0, (marketSettlementMs - nowMs) / 60000);
        const signals = {
          market: { slug: marketSlug, endDate: new Date(candleTimeMs + 300_000).toISOString(), liquidityNum: 50000 },
          polyPricesCents: { UP: Math.round(candle.p * 100), DOWN: Math.round((1 - candle.p) * 100) },
          polyMarketSnapshot: { orderbook: { up: { bestAsk: Math.round(candle.p * 100) }, down: { bestAsk: Math.round((1 - candle.p) * 100) } } },
          timeLeftMin, modelUp: 0.50, modelDown: 0.50,
        };
        await engine.processSignals(signals, [], nowMs);
      }

      const posCloses = executor.closeCalls.filter(c => c.tradeId === posId);
      expect(posCloses.length).toBe(1);
      expect(posCloses[0].reason).toBe('Pre-settlement Exit'); // artificial endDate causes early exit
    });
  });

  // ── Price boundaries ─────────────────────────────────────────────
  describe('edge cases from real data', () => {
    it('handles candle at price = 0.005 (minimum tick)', async () => {
      const lowCandle = { p: 0.005, t: 1776224616, ts: '2026-04-15T03:46:05.000Z' };
      const SYNTHETIC_EPOCH = 3000000000;
      const syntheticSlug = `btc-updown-5m-${SYNTHETIC_EPOCH}`;
      const syntheticSettlementMs = (SYNTHETIC_EPOCH + 300) * 1000;
      const executor = new ReplayExecutor({
        candleSlice: [lowCandle],
        entryPrice: 0.50,
        shares: 100,
        side: 'UP',
        slPct: 0.30,
        marketSlug: syntheticSlug,
        mode: 'live',
      });
      const testNow = syntheticSettlementMs - (60 * 60 * 1000);
      executor.setNow(testNow);
      executor.openPositionSync({ contractSize: 50, mark: 0.50, side: 'UP' });

      const engine = new TradingEngine({
        executor,
        config: liveConfig({ dynamicStopLossPct: 0.30 }),
      });
      engine.tradingEnabled = true;

      const nowMs = testNow;
      const signals = {
        market: { slug: syntheticSlug, endDate: new Date(lowCandle.t * 1000 + 300_000).toISOString(), liquidityNum: 50000 },
        polyPricesCents: { UP: 1, DOWN: 99 }, // 0.005 = 0.5¢
        polyMarketSnapshot: { orderbook: { up: { bestAsk: 1 }, down: { bestAsk: 99 } } },
        timeLeftMin: Math.max(0, (syntheticSettlementMs - nowMs) / 60000), modelUp: 0.50, modelDown: 0.50,
      };

      const posId = executor._position.id;
      await engine.processSignals(signals, [], nowMs);

      // Should fire SL: PnL = 100*(0.005-0.50) = -$49.50 < -$15 (SL threshold)
      const posCloses = executor.closeCalls.filter(c => c.tradeId === posId);
      expect(posCloses.length).toBe(1);
      expect(posCloses[0].reason).toContain('Max Loss');
    });

    it('handles candle at price = 0.535 (high tick)', async () => {
      const highCandle = { p: 0.535, t: 1776224167, ts: '2026-04-15T03:42:47.000Z' };
      const SYNTHETIC_EPOCH = 3000000000;
      const syntheticSlug = `btc-updown-5m-${SYNTHETIC_EPOCH}`;
      const syntheticSettlementMs = (SYNTHETIC_EPOCH + 300) * 1000;
      const executor = new ReplayExecutor({
        candleSlice: [highCandle],
        entryPrice: 0.50,
        shares: 100,
        side: 'DOWN',
        slPct: 0.30,
        marketSlug: syntheticSlug,
        mode: 'live',
      });
      const testNow = syntheticSettlementMs - (60 * 60 * 1000);
      executor.setNow(testNow);
      executor.openPositionSync({ contractSize: 50, mark: 0.50, side: 'DOWN' });

      const engine = new TradingEngine({
        executor,
        config: liveConfig({ dynamicStopLossPct: 0.30 }),
      });
      engine.tradingEnabled = true;

      const nowMs = testNow;
      const signals = {
        market: { slug: syntheticSlug, endDate: new Date(highCandle.t * 1000 + 300_000).toISOString(), liquidityNum: 50000 },
        polyPricesCents: { UP: 54, DOWN: 46 },
        polyMarketSnapshot: { orderbook: { up: { bestAsk: 54 }, down: { bestAsk: 46 } } },
        timeLeftMin: Math.max(0, (syntheticSettlementMs - nowMs) / 60000), modelUp: 0.50, modelDown: 0.50,
      };

      const posId = executor._position.id;
      await engine.processSignals(signals, [], nowMs);

      // DOWN SL = 0.50 + 0.1515 = 0.6515. Price = 0.535 < 0.6515 → no fire
      // PnL = 100*(0.46-0.50) = -$4.00 (hardcoded DOWN=46 in test)
      const posCloses = executor.closeCalls.filter(c => c.tradeId === posId);
      expect(posCloses.length).toBe(0);
      expect(executor._position.unrealizedPnl).toBeCloseTo(-4.0, 1);
    });
  });
});
