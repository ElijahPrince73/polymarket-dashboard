/**
 * @file Integration tests for TradingEngine — full pipeline with mock executor.
 *
 * Exercises the complete trading pipeline:
 *   processSignals() → getOpenPositions() → markPositions() → evaluateExits() → closePosition()
 *
 * These are NOT unit tests of exitEvaluator (those live in exitEvaluator.test.js).
 * Here we test the TradingEngine orchestration with a mock executor that tracks
 * whether closePosition() was called and with what reason.
 */

import { describe, expect, it, beforeEach } from 'vitest';
import { TradingEngine } from '../../../src/btc/application/TradingEngine.js';
import { buildTradingConfig, CONFIG } from '../../../src/btc/config.js';

/** @type {import('../../../src/btc/application/ExecutorInterface.js').OrderExecutor} */
class MockExecutor {
  /**
   * @param {Object} opts
   * @param {Array}  opts.priceTicks  - Array of mark prices (in dollars, e.g. 0.55)
   * @param {number} opts.entryPrice   - Entry price in dollars
   * @param {number} opts.shares       - Number of shares
   * @param {string} opts.side         - 'UP' or 'DOWN'
   * @param {string} opts.marketSlug    - Market slug for the position
   * @param {string} [opts.mode='live'] - 'paper' or 'live'
   */
  constructor(opts) {
    this.priceTicks = opts.priceTicks ?? [];
    this.entryPrice = opts.entryPrice ?? 0.45;
    this.shares = opts.shares ?? 100;
    this.side = opts.side ?? 'UP';
    this.marketSlug = opts.marketSlug ?? 'btc-updown-5m-1893456000';
    this.mode = opts.mode ?? 'live';

    // Simulated position state
    this._position = null;         // set after openPosition is called

    // Tracking: did we call closePosition and with what?
    this.closeCalls = [];           // [{ tradeId, reason, pnl }]
    this.markPositionsCalls = [];   // [{ positions, signals }]
    this.openPositionCalls = [];   // for completeness
    this.getOpenPositionsCalls = []; // [{ signals }]
  }

  // ── OrderExecutor interface ──────────────────────────────────────

  async initialize() {
    // no-op for mock
  }

  getMode() {
    return this.mode;
  }

  /**
   * Get the current mark price from signals (UP price in dollars).
   * This is the source of truth for pricing — not an internal tick counter.
   */
  _getMarkPriceFromSignals(signals) {
    const upCents = signals?.polyPricesCents?.UP;
    if (upCents != null && upCents > 0) {
      return upCents / 100;
    }
    // Fallback: try orderbook
    return signals?.polyMarketSnapshot?.orderbook?.up?.bestAsk / 100 ?? null;
  }

  async getOpenPositions(signals) {
    this.getOpenPositionsCalls.push({ signals });
    if (!this._position) return [];

    const markPrice = this._getMarkPriceFromSignals(signals);
    const pos = { ...this._position };
    if (markPrice !== null) {
      pos.mark = markPrice;
      pos.unrealizedPnl = this._computePnl(markPrice);
    }
    return [pos];
  }

  async markPositions(positions, signals) {
    this.markPositionsCalls.push({ positions: positions.map(p => ({ ...p })), signals });
    const markPrice = this._getMarkPriceFromSignals(signals);

    for (const p of positions) {
      if (markPrice !== null) {
        p.mark = markPrice;
        p.unrealizedPnl = this._computePnl(markPrice);
      }
    }

    // Mirror the updated mark/PnL back onto the stored position so closePosition()
    // reads the correct values (not stale entry-price data)
    if (this._position && markPrice !== null) {
      this._position.mark = markPrice;
      this._position.unrealizedPnl = this._computePnl(markPrice);
    }

    return positions;
  }

  async getBalance() {
    return { balance: 1000, available: 1000, currency: 'USD' };
  }

  async openPosition(request) {
    this.openPositionCalls.push(request);
    this._position = {
      id: 'mock-trade-' + Date.now(),
      side: request.side,
      tokenID: '0xtoken' + Math.random().toString(16).slice(2),
      shares: this.shares,
      contractSize: this.entryPrice * this.shares,
      entryPrice: this.entryPrice,
      mark: this.entryPrice,
      unrealizedPnl: 0,
      marketSlug: this.marketSlug,
      maxUnrealizedPnl: 0,
      minUnrealizedPnl: 0,
      outcome: request.side,
      entryTime: new Date().toISOString(),
      lastTradeTime: Math.floor(Date.now() / 1000),
    };

    return {
      filled: true,
      fillPrice: this.entryPrice,
      fillShares: this.shares,
      fillSizeUsd: this.entryPrice * this.shares,
    };
  }

  async closePosition({ tradeId, side, shares, reason, tokenID }) {
    // The real TradingEngine.closePosition() does NOT receive signals.
    // It uses the position's already-set mark + unrealizedPnl from markPositions().
    // The position object (referenced via tradeId) has been updated by markPositions.
    // We look it up from the stored position reference.
    const pos = this._position;
    let pnl = 0;
    if (pos && pos.id === tradeId) {
      pnl = pos.unrealizedPnl ?? this._computePnl(pos.mark ?? this.entryPrice);
    }

    this.closeCalls.push({ tradeId, side, shares, reason, tokenID, pnl });

    // Clear the position so subsequent getOpenPositions calls return []
    // (mimics the real executor behavior after a close)
    this._position = null;

    return { closed: true, pnl };
  }

  // ── Internal helpers ─────────────────────────────────────────────

  _computePnl(markPrice) {
    if (this.side === 'UP') {
      return this.shares * (markPrice - this.entryPrice);
    } else {
      // DOWN: profit when price goes DOWN
      return this.shares * (this.entryPrice - markPrice);
    }
  }

  /** Pre-open a position (used by tests that start with an existing position) */
  openPositionSync(overrides = {}) {
    const now = Date.now();
    this._position = {
      id: overrides.id ?? 'mock-trade-pre',
      side: overrides.side ?? this.side,
      tokenID: overrides.tokenID ?? '0xtokenpre',
      shares: overrides.shares ?? this.shares,
      contractSize: overrides.contractSize ?? (this.entryPrice * this.shares),
      entryPrice: overrides.entryPrice ?? this.entryPrice,
      mark: overrides.mark ?? this.entryPrice,
      unrealizedPnl: overrides.unrealizedPnl ?? 0,
      marketSlug: overrides.marketSlug ?? this.marketSlug,
      maxUnrealizedPnl: 0,
      minUnrealizedPnl: 0,
      outcome: overrides.side ?? this.side,
      entryTime: overrides.entryTime ?? new Date(now - 60_000).toISOString(),
      lastTradeTime: overrides.lastTradeTime ?? Math.floor((now - 60_000) / 1000),
      ...overrides,
    };
  }
}

// ─── Shared config & helpers ─────────────────────────────────────────

const NOW = Date.now();

/** Build live trading config (30% dynamic stop loss, no grace) */
function liveConfig(overrides = {}) {
  return {
    ...buildTradingConfig(CONFIG, 'live', '5m'),
    ...overrides,
  };
}

/** Build a minimal signals bundle for a given mark price */
function makeSignals(markPrice, overrides = {}) {
  return {
    market: {
      slug: overrides.slug ?? 'btc-updown-5m-' + Math.floor(NOW / 1000),
      endDate: new Date(NOW + 240_000).toISOString(),
      liquidityNum: 50000,
      ...overrides.market,
    },
    polyPricesCents: {
      UP: Math.round(markPrice * 100),
      DOWN: Math.round((1 - markPrice) * 100),
    },
    polyMarketSnapshot: {
      orderbook: {
        up: { bestAsk: Math.round(markPrice * 100) },
        down: { bestAsk: Math.round((1 - markPrice) * 100) },
      },
    },
    timeLeftMin: 4,
    modelUp: 0.55,
    modelDown: 0.45,
    ...overrides,
  };
}

// ─── Tests ────────────────────────────────────────────────────────────

describe('TradingEngine + MockExecutor — full tick loop integration', () => {

  // ── Core stop-loss tick simulation ────────────────────────────────
  describe('stop loss fires at exactly 30% as price degrades', () => {
    /**
     * Scenario:
     *   Entry: UP @ 45¢, 100 shares, $45 position
     *   30% stop loss = -$13.50 PnL threshold
     *
     *   Tick 0: price = 55¢ → PnL = +$10 (green)  → NO EXIT
     *   Tick 1: price = 50¢ → PnL = +$5  (green)  → NO EXIT
     *   Tick 2: price = 45¢ → PnL = $0   (entry)  → NO EXIT
     *   Tick 3: price = 40¢ → PnL = -$5  (11% loss) → NO EXIT
     *   Tick 4: price = 35¢ → PnL = -$10 (22% loss) → NO EXIT
     *   Tick 5: price = 30¢ → PnL = -$15 (33% loss) → EXIT FIRED!
     */
    it('emits NO exit on green ticks 0-4, fires Max Loss at tick 5', async () => {
      const ENTRY_PRICE = 0.45;   // 45¢
      const SHARES = 100;
      const CONTRACT_SIZE = ENTRY_PRICE * SHARES; // $45
      const STOP_LOSS_PCT = 0.30;
      const STOP_LOSS_THRESHOLD = -(CONTRACT_SIZE * STOP_LOSS_PCT); // -$13.50

      const PRICE_TICKS = [0.55, 0.50, 0.45, 0.40, 0.35, 0.30];

      // Executor pre-opens the position so getOpenPositions returns it
      const executor = new MockExecutor({
        entryPrice: ENTRY_PRICE,
        shares: SHARES,
        side: 'UP',
        priceTicks: PRICE_TICKS,
        mode: 'live',
      });
      executor.openPositionSync({ contractSize: CONTRACT_SIZE });

      const engine = new TradingEngine({
        executor,
        config: liveConfig({ dynamicStopLossPct: STOP_LOSS_PCT }),
      });
      engine.tradingEnabled = true;

      // Capture posId BEFORE loop — _position will be null after exit fires
      const posId = executor._position?.id ?? null;

      // Simulate each price tick
      for (let i = 0; i < PRICE_TICKS.length; i++) {
        const signals = makeSignals(PRICE_TICKS[i]);
        await engine.processSignals(signals, []);

        // Check closePosition calls so far
        const exitCalls = executor.closeCalls.filter(c => c.tradeId === posId);

        if (i < 5) {
          // Ticks 0-4: no exit should have fired
          expect(exitCalls.length, `Tick ${i}: price=${PRICE_TICKS[i]}¢, PnL=${(SHARES * (PRICE_TICKS[i] - ENTRY_PRICE)).toFixed(2)}`).toBe(0);

          // markPositions should have been called with correct PnL
          const lastMarkCall = executor.markPositionsCalls[executor.markPositionsCalls.length - 1];
          const expectedPnl = SHARES * (PRICE_TICKS[i] - ENTRY_PRICE);
          expect(lastMarkCall.positions[0].unrealizedPnl).toBeCloseTo(expectedPnl, 2);
        } else {
          // Tick 5: stop loss should have fired
          expect(exitCalls.length, `Tick ${i}: price=${PRICE_TICKS[i]}¢ → should have exactly 1 close call`).toBe(1);
          expect(exitCalls[0].reason).toContain('Max Loss');
          expect(exitCalls[0].pnl).toBeLessThanOrEqual(STOP_LOSS_THRESHOLD);
        }
      }
    });

    it('records correct exit PnL when stop loss fires', async () => {
      const ENTRY_PRICE = 0.45;
      const SHARES = 100;
      const PRICE_TICKS = [0.55, 0.50, 0.45, 0.40, 0.35, 0.30];

      const executor = new MockExecutor({
        entryPrice: ENTRY_PRICE,
        shares: SHARES,
        side: 'UP',
        priceTicks: PRICE_TICKS,
        mode: 'live',
      });
      executor.openPositionSync({ contractSize: ENTRY_PRICE * SHARES });

      const engine = new TradingEngine({
        executor,
        config: liveConfig({ dynamicStopLossPct: 0.30 }),
      });
      engine.tradingEnabled = true;

      // Run all 6 ticks
      for (let i = 0; i < PRICE_TICKS.length; i++) {
        await engine.processSignals(makeSignals(PRICE_TICKS[i]), []);
      }

      const exitCall = executor.closeCalls[0];
      expect(exitCall.pnl).toBeCloseTo(-15.0, 2); // PnL at 30¢ mark: 100 * (0.30 - 0.45) = -$15
    });

    it('closePosition is called exactly once when stop loss fires', async () => {
      const executor = new MockExecutor({
        entryPrice: 0.45,
        shares: 100,
        side: 'UP',
        priceTicks: [0.55, 0.50, 0.45, 0.40, 0.35, 0.30, 0.25, 0.20],
        mode: 'live',
      });
      executor.openPositionSync({ contractSize: 0.45 * 100 });

      const engine = new TradingEngine({
        executor,
        config: liveConfig({ dynamicStopLossPct: 0.30 }),
      });
      engine.tradingEnabled = true;

      // Capture posId BEFORE loop — _position will be null after exit fires
      const posId = executor._position?.id ?? null;

      // Run more ticks than needed — closePosition should only be called once
      for (const price of [0.55, 0.50, 0.45, 0.40, 0.35, 0.30, 0.25, 0.20]) {
        await engine.processSignals(makeSignals(price), []);
      }

      const posCloseCalls = executor.closeCalls.filter(c => c.tradeId === posId);
      expect(posCloseCalls.length).toBe(1);
      expect(posCloseCalls[0].reason).toContain('Max Loss');
    });
  });

  // ── markPositions computes PnL correctly ─────────────────────────
  describe('markPositions computes PnL correctly from price ticks', () => {
    it('computes UP PnL as shares * (mark - entry)', async () => {
      const executor = new MockExecutor({
        entryPrice: 0.45,
        shares: 100,
        side: 'UP',
        priceTicks: [0.60, 0.30],
        mode: 'live',
      });
      executor.openPositionSync({ contractSize: 0.45 * 100 });

      const engine = new TradingEngine({
        executor,
        config: liveConfig(),
      });
      engine.tradingEnabled = true;

      // Tick 0: mark=60¢ → PnL = 100*(0.60-0.45) = +$15
      await engine.processSignals(makeSignals(0.60), []);
      const call0 = executor.markPositionsCalls[executor.markPositionsCalls.length - 1];
      expect(call0.positions[0].unrealizedPnl).toBeCloseTo(15.0, 2);
      expect(call0.positions[0].mark).toBeCloseTo(0.60, 4);

      // Tick 1: mark=30¢ → PnL = 100*(0.30-0.45) = -$15
      await engine.processSignals(makeSignals(0.30), []);
      const call1 = executor.markPositionsCalls[executor.markPositionsCalls.length - 1];
      expect(call1.positions[0].unrealizedPnl).toBeCloseTo(-15.0, 2);
      expect(call1.positions[0].mark).toBeCloseTo(0.30, 4);
    });

    it('computes DOWN PnL as shares * (entry - mark)', async () => {
      const executor = new MockExecutor({
        entryPrice: 0.60,
        shares: 100,
        side: 'DOWN',
        priceTicks: [0.40, 0.70],
        mode: 'live',
      });
      executor.openPositionSync({ contractSize: 0.60 * 100 });

      const engine = new TradingEngine({
        executor,
        config: liveConfig(),
      });
      engine.tradingEnabled = true;

      // Tick 0: mark=40¢ → DOWN PnL = 100*(0.60-0.40) = +$20 (price went down = win)
      await engine.processSignals(makeSignals(0.40), []);
      const call0 = executor.markPositionsCalls[executor.markPositionsCalls.length - 1];
      expect(call0.positions[0].unrealizedPnl).toBeCloseTo(20.0, 2);

      // Tick 1: mark=70¢ → DOWN PnL = 100*(0.60-0.70) = -$10 (price went up = loss)
      await engine.processSignals(makeSignals(0.70), []);
      const call1 = executor.markPositionsCalls[executor.markPositionsCalls.length - 1];
      expect(call1.positions[0].unrealizedPnl).toBeCloseTo(-10.0, 2);
    });
  });

  // ── Market rollover scenario ─────────────────────────────────────
  describe('market rollover — position on old slug, new slug in signals', () => {
    it('fires exit with Market Rollover when old market has settled', async () => {
      const NOW_MS = NOW;

      // Build slugs: old market settled 600s ago, current market is active
      const settledEpoch = Math.floor(NOW_MS / 1000) - 600;
      const settledSlug = 'btc-updown-5m-' + settledEpoch;
      const currentEpoch = Math.floor(NOW_MS / 1000);
      const currentSlug = 'btc-updown-5m-' + currentEpoch;

      // Price stays at 45¢ — profitable, but rollover should force exit
      const executor = new MockExecutor({
        entryPrice: 0.45,
        shares: 100,
        side: 'UP',
        priceTicks: [0.55, 0.55, 0.55],  // all green — no stop loss
        marketSlug: settledSlug,
        mode: 'live',
      });
      executor.openPositionSync({
        contractSize: 0.45 * 100,
        marketSlug: settledSlug,
        unrealizedPnl: 10.0,
        mark: 0.55,
      });

      const engine = new TradingEngine({
        executor,
        config: liveConfig(),
      });
      engine.tradingEnabled = true;

      // Signals show the new (current) slug — old market has settled
      const posId = executor._position?.id ?? null;
      const signals = makeSignals(0.55, {
        slug: currentSlug,
        market: {
          slug: currentSlug,
          endDate: new Date(NOW_MS + 240_000).toISOString(),
        },
      });

      await engine.processSignals(signals, []);


      const posCloseCalls = executor.closeCalls.filter(
        c => c.tradeId === posId,
      );

      // Should have fired exactly one exit for Market Rollover
      expect(posCloseCalls.length).toBe(1);
      expect(posCloseCalls[0].reason).toBe('Market Rollover');
    });

    it('does NOT fire rollover exit when old market has NOT settled yet', async () => {
      const NOW_MS = NOW;

      // Both slugs are within the same 5-minute window — old market hasn't settled
      const currentEpoch = Math.floor(NOW_MS / 1000);
      const positionSlug = 'btc-updown-5m-' + currentEpoch;
      const nextSlug = 'btc-updown-5m-' + (currentEpoch + 300); // next 5m market

      const executor = new MockExecutor({
        entryPrice: 0.45,
        shares: 100,
        side: 'UP',
        priceTicks: [0.55],
        marketSlug: positionSlug,
        mode: 'live',
      });
      executor.openPositionSync({
        contractSize: 0.45 * 100,
        marketSlug: positionSlug,
        unrealizedPnl: 10.0,
        mark: 0.55,
      });

      const engine = new TradingEngine({
        executor,
        config: liveConfig(),
      });
      engine.tradingEnabled = true;

      const signals = makeSignals(0.55, {
        slug: nextSlug,
        market: {
          slug: nextSlug,
          endDate: new Date(NOW_MS + 240_000).toISOString(),
        },
      });
      const posId = executor._position?.id ?? null;

      await engine.processSignals(signals, []);

      const posCloseCalls = executor.closeCalls.filter(
        c => c.tradeId === posId,
      );

      // Should NOT exit — old market still active
      expect(posCloseCalls.length).toBe(0);
    });
  });

  // ── Pre-settlement scenario ──────────────────────────────────────
  describe('pre-settlement exit — position with market ending soon', () => {
    it('fires Pre-settlement Exit when time left < exitBeforeEndMinutes', async () => {
      // Build a slug representing a market that ends in ~25 seconds
      // epoch = (now + 25000) / 1000 - 300
      const settleEpoch = Math.floor(NOW / 1000) - 275;
      const settleSlug = 'btc-updown-5m-' + settleEpoch;

      const executor = new MockExecutor({
        entryPrice: 0.45,
        shares: 100,
        side: 'UP',
        priceTicks: [0.50],  // slight profit
        marketSlug: settleSlug,
        mode: 'live',
      });
      executor.openPositionSync({
        contractSize: 0.45 * 100,
        marketSlug: settleSlug,
        unrealizedPnl: 5.0,
        mark: 0.50,
      });

      const engine = new TradingEngine({
        executor,
        config: liveConfig({ exitBeforeEndMinutes: 0.5 }),
      });
      engine.tradingEnabled = true;

      // Signals: only 0.4 minutes left (< 0.5 exitBeforeEndMinutes)
      const signals = makeSignals(0.50, {
        slug: settleSlug,
        market: {
          slug: settleSlug,
          endDate: new Date(NOW + 25_000).toISOString(), // ~25 seconds
        },
        timeLeftMin: 0.4,
      });
      const posId = executor._position?.id ?? null;
      await engine.processSignals(signals, []);

      const posCloseCalls = executor.closeCalls.filter(
        c => c.tradeId === posId,
      );

      expect(posCloseCalls.length).toBe(1);
      expect(posCloseCalls[0].reason).toBe('Pre-settlement Exit');
    });
  });

  // ── Full pipeline — entry → tick loop → exit ────────────────────
  describe('full pipeline: entry → tick loop → stop loss exit', () => {
    it('entry gate allows position open, tick loop degrades to stop loss', async () => {
      // This test verifies the complete lifecycle:
      // 1. Engine starts with no position
      // 2. Entry signal causes openPosition to be called
      // 3. Subsequent ticks track PnL
      // 4. Stop loss fires at 30%

      const ENTRY_PRICE = 0.40;
      const SHARES = 100;
      const CONTRACT_SIZE = ENTRY_PRICE * SHARES; // $40
      const STOP_LOSS_PCT = 0.30;
      const STOP_LOSS_THRESHOLD = -(CONTRACT_SIZE * STOP_LOSS_PCT); // -$12

      // Price path: green → green → breakeven → degrading to stop loss
      const PRICE_TICKS = [0.50, 0.45, 0.40, 0.35, 0.30, 0.28];

      const executor = new MockExecutor({
        entryPrice: ENTRY_PRICE,
        shares: SHARES,
        side: 'UP',
        priceTicks: PRICE_TICKS,
        mode: 'live',
      });

      // Config that disables all entry gate blockers so openPosition is called
      const engine = new TradingEngine({
        executor,
        config: liveConfig({
          dynamicStopLossPct: STOP_LOSS_PCT,
          tradingHoursEnabled: false,
          weekdaysOnly: false,
          recGatingEnabled: false,
          rsiDirectionalBiasEnabled: false,
          maxCheapEntryPrice: 0.95,
          minCheapEntryPrice: 0.05,
          minPolyPrice: 0.01,
          maxPolyPrice: 0.99,
          minModelMaxProb: 0.0,
          edgeEarly: 0.0,
          edgeMid: 0.0,
          edgeLate: 0.0,
          minProbEarly: 0.0,
          minProbMid: 0.0,
          minProbLate: 0.0,
          minCandlesForEntry: 0,
          heikenExhaustionFilterEnabled: false,
          minRangePct20: 0,
          minBtcImpulsePct1m: 0,
          minLiquidity: 0,
          maxSpread: 99,
          noEntryFinalMinutes: 0,
        }),
      });
      engine.tradingEnabled = true;

      // First tick: no position yet — engine should evaluate entry
      const entrySignals = makeSignals(ENTRY_PRICE + 0.05, {
        rec: { action: 'ENTER', side: 'UP', edge: 0.1 },
        indicators: { rsiNow: 50, vwapSlope: 0.01, heikenColor: 'green', heikenCount: 2 },
        spot: { price: 95000, delta1mPct: 0.005 },
        market: { volumeNum: 100000, liquidityNum: 50000 },
      });

      await engine.processSignals(entrySignals, []);

      // openPosition should have been called
      expect(executor.openPositionCalls.length).toBe(1);
      expect(executor.openPositionCalls[0].side).toBe('UP');

      // Now run the price degradation ticks
      for (let i = 0; i < PRICE_TICKS.length; i++) {
        await engine.processSignals(makeSignals(PRICE_TICKS[i]), []);
      }

      // closePosition should have been called exactly once
      const closeCalls = executor.closeCalls;
      expect(closeCalls.length).toBe(1);
      expect(closeCalls[0].reason).toContain('Max Loss');
      expect(closeCalls[0].pnl).toBeLessThanOrEqual(STOP_LOSS_THRESHOLD);
    });
  });

  // ── Edge case: no early exit on partial recovery ─────────────────
  describe('no premature exit when price briefly dips but stays above threshold', () => {
    it('does not fire stop loss when PnL dips to -$5 (11%) then recovers to +$2', async () => {
      const executor = new MockExecutor({
        entryPrice: 0.45,
        shares: 100,
        side: 'UP',
        priceTicks: [0.55, 0.40, 0.47, 0.52],
        mode: 'live',
      });
      executor.openPositionSync({ contractSize: 0.45 * 100 });

      const engine = new TradingEngine({
        executor,
        config: liveConfig({ dynamicStopLossPct: 0.30 }),
      });
      engine.tradingEnabled = true;

      // Tick 0: PnL = +$10 (green)
      // Tick 1: PnL = -$5  (11% loss — below threshold of -$13.50)
      // Tick 2: PnL = +$2  (recovered)
      // Tick 3: PnL = +$7  (still green)
      const posId = executor._position?.id ?? null;
      for (const price of [0.55, 0.40, 0.47, 0.52]) {
        await engine.processSignals(makeSignals(price), []);
      }


      // No exit should have fired
      const posCloseCalls = executor.closeCalls.filter(
        c => c.tradeId === posId,
      );
      expect(posCloseCalls.length).toBe(0);
    });
  });

  // ── Grace period disabled in live config ────────────────────────
  describe('live config has no grace: stop loss fires immediately at threshold', () => {
    it('fires at first tick that crosses 30% threshold', async () => {
      // Price jumps from green straight to -35% loss (jump over the threshold)
      const executor = new MockExecutor({
        entryPrice: 0.45,
        shares: 100,
        side: 'UP',
        priceTicks: [0.55, 0.28], // tick 1: PnL = -$17 (38% loss)
        mode: 'live',
      });
      executor.openPositionSync({ contractSize: 0.45 * 100 });

      const engine = new TradingEngine({
        executor,
        config: liveConfig({ dynamicStopLossPct: 0.30 }),
      });
      engine.tradingEnabled = true;

      // Tick 0: still green
      await engine.processSignals(makeSignals(0.55), []);
      expect(executor.closeCalls.length).toBe(0);

      // Tick 1: crosses 30% threshold immediately
      const posId = executor._position?.id ?? null;
      await engine.processSignals(makeSignals(0.28), []);


      const posCloseCalls = executor.closeCalls.filter(
        c => c.tradeId === posId,
      );
      expect(posCloseCalls.length).toBe(1);
      expect(posCloseCalls[0].reason).toContain('Max Loss');
    });
  });

});
