/**
 * @file PolymarketReplayHarness
 *
 * Feeds historical Polymarket tick data into the TradingEngine for backtesting
 * and integration testing. Reads from fixture JSON files captured via the
 * CLOB `prices-history` API.
 *
 * Usage:
 *   import { PolymarketReplayHarness } from './fixtures/PolymarketReplayHarness.js';
 *   import FIXTURE from './fixtures/btc-5m-real.json' assert { type: 'json' };
 *
 *   const harness = new PolymarketReplayHarness({ fixture: FIXTURE });
 *   harness.entry({ side: 'UP', price: 0.45, shares: 100 });
 *   await harness.run();  // processes all ticks
 */

import { readFileSync } from 'fs';

/**
 * Replay harness that feeds historical Polymarket candle/tick data
 * into the TradingEngine.
 */
export class PolymarketReplayHarness {
  /**
   * @param {Object} opts
   * @param {Object} opts.fixture       - Loaded fixture JSON (btc-5m-real.json)
   * @param {Object} opts.engine         - TradingEngine instance
   * @param {Object} opts.executor       - Executor instance (MockExecutor or LiveExecutor)
   * @param {Object} opts.config         - Trading config
   */
  constructor({ fixture, engine, executor, config }) {
    this.fixture = fixture;
    this.engine = engine;
    this.executor = executor;
    this.config = config;

    /** @type {Array<{side, entryPrice, shares, contractSize}>} */
    this.entries = [];

    this._tickIndex = 0;
    this._tickLog = [];
  }

  // ── Public API ───────────────────────────────────────────────────

  /**
   * Queue an entry order to be placed at tick 0 (first tick).
   * @param {{ side: string, price: number, shares: number }} opts
   */
  entry({ side, price, shares }) {
    const contractSize = price * shares;
    this.entries.push({ side, entryPrice: price, shares, contractSize });
    // Pre-open the position in the executor
    this.executor.openPositionSync({
      side,
      entryPrice: price,
      shares,
      contractSize,
      mark: price,
    });
  }

  /**
   * Process all ticks in the fixture.
   * Returns the tick log.
   */
  async run() {
    const candles = this.fixture.candles?.up || [];
    for (let i = 0; i < candles.length; i++) {
      const tick = candles[i];
      const result = await this._processTick(tick, i);
      if (result?.exited) break;
    }
    return this._tickLog;
  }

  /**
   * Run for a specific number of ticks.
   * @param {number} n
   */
  async runTicks(n) {
    const candles = this.fixture.candles?.up || [];
    for (let i = 0; i < Math.min(n, candles.length); i++) {
      const tick = candles[i];
      const result = await this._processTick(tick, i);
      if (result?.exited) break;
    }
    return this._tickLog;
  }

  // ── Internals ───────────────────────────────────────────────────

  /**
   * @param {{ t: number, ts: string, p: number }} candle
   * @param {number} index
   */
  async _processTick(candle, index) {
    const markPrice = candle.p;

    // Build signals object matching real Polymarket shape
    const signals = {
      market: {
        slug: this.fixture.currentMarket?.slug || 'btc-updown-5m-test',
        endDate: new Date(Date.now() + 240_000).toISOString(),
        liquidityNum: 50000,
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
      modelUp: 0.50,
      modelDown: 0.50,
    };

    // Check if position was closed
    const wasOpen = this.executor._position !== null;
    const prevCloseCalls = this.executor.closeCalls.length;

    // Feed to engine
    await this.engine.processSignals(signals, []);

    // Log
    const closeCalls = this.executor.closeCalls;
    const justExited = wasOpen && closeCalls.length > prevCloseCalls;
    const lastClose = justExited ? closeCalls[closeCalls.length - 1] : null;

    this._tickLog.push({
      tick: index,
      ts: candle.ts,
      epochSec: candle.t,
      markPrice,
      positionOpen: this.executor._position !== null,
      ...(lastClose ? {
        exited: true,
        exitReason: lastClose.reason,
        exitPnl: lastClose.pnl,
      } : {}),
    });

    if (justExited) {
      return { exited: true, reason: lastClose.reason, pnl: lastClose.pnl };
    }
    return {};
  }

  // ── Static helpers ───────────────────────────────────────────────

  /**
   * Load a fixture from disk.
   * @param {string} fixturePath
   */
  static loadFixture(fixturePath) {
    return JSON.parse(readFileSync(fixturePath, 'utf8'));
  }

  /**
   * Build a complete Polymarket-shaped signals object.
   * @param {number} markPrice  - UP price in dollars (e.g. 0.55)
   * @param {Object} [overrides]
   */
  static makeSignals(markPrice, overrides = {}) {
    return {
      market: {
        slug: overrides.slug || 'btc-updown-5m-test',
        endDate: overrides.endDate || new Date(Date.now() + 240_000).toISOString(),
        liquidityNum: overrides.liquidityNum || 50000,
        ...(overrides.market || {}),
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
      timeLeftMin: overrides.timeLeftMin ?? 4,
      modelUp: overrides.modelUp ?? 0.50,
      modelDown: overrides.modelDown ?? 0.50,
      ...overrides,
    };
  }
}

export default PolymarketReplayHarness;
