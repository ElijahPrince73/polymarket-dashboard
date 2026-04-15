import { describe, expect, it, beforeEach } from 'vitest';
import { buildTradingConfig, CONFIG } from '../../src/btc/config.js';
import { evaluateExits } from '../../src/btc/domain/exitEvaluator.js';

/**
 * Live trading stop loss tests using mock CLOB position data.
 *
 * Uses liveTrading config defaults:
 *   dynamicStopLossPct: 0.30 (30%)
 *   stopLossGraceSec: 0  (immediate — no grace)
 *   maxLossGraceEnabled: false
 *   maxLossGraceSeconds: 0
 */

const LIVE_CONFIG = buildTradingConfig(CONFIG, 'live', '5m');
const NOW = Date.now();

// Helper to build a mock position with CLOB fields
function makePosition(overrides = {}) {
  return {
    id: 'test-trade-1',
    side: 'UP',
    tokenID: '0x1234567890abcdef',
    shares: 80,
    contractSize: 40, // $40 position (80 shares * $0.50 entry)
    mark: null,
    unrealizedPnl: null,
    entryTime: null,
    lastTradeTime: Math.floor(NOW / 1000), // current epoch seconds
    marketSlug: 'btc-updown-5m-1893456000',
    maxUnrealizedPnl: 0,
    minUnrealizedPnl: 0,
    outcome: 'UP',
    ...overrides,
  };
}

// Helper to build a mock signals bundle
function makeSignals(overrides = {}) {
  return {
    market: {
      slug: 'btc-updown-5m-1893456000',
      endDate: new Date(NOW + 240_000).toISOString(), // 4 min from now
    },
    polyPricesCents: { UP: 50, DOWN: 50 },
    polyMarketSnapshot: {
      orderbook: {
        up: { bestBid: 50 },
        down: { bestBid: 50 },
      },
    },
    timeLeftMin: 4,
    modelUp: 0.55,
    modelDown: 0.45,
    ...overrides,
  };
}

describe('live-exit-evaluator — stop loss with mock CLOB data', () => {

  describe('PnL null handling', () => {
    it('should NOT exit when unrealizedPnl is null', () => {
      const position = makePosition({ unrealizedPnl: null, mark: null });
      const signals = makeSignals();

      const result = evaluateExits(position, signals, LIVE_CONFIG, { breachAtMs: null, used: false }, NOW);

      expect(result.decision).toBeNull();
      expect(result.pnlNow).toBeNull();
    });

    it('should NOT exit when mark is null (no price)', () => {
      const position = makePosition({ unrealizedPnl: null, mark: null });
      const signals = makeSignals();

      const result = evaluateExits(position, signals, LIVE_CONFIG, { breachAtMs: null, used: false }, NOW);

      expect(result.decision).toBeNull();
    });

    it('should NOT exit when both mark and unrealizedPnl are null', () => {
      const position = makePosition({ mark: null, unrealizedPnl: null });
      const signals = makeSignals();

      const result = evaluateExits(position, signals, LIVE_CONFIG, { breachAtMs: null, used: false }, NOW);

      expect(result.decision).toBeNull();
    });
  });

  describe('PnL above stop loss threshold', () => {
    it('should NOT exit when PnL is positive', () => {
      // $40 position, mark at $0.55 → pnl = 80 * 0.55 - 40 = $4 profit
      const position = makePosition({
        contractSize: 40,
        mark: 55, // 55¢ = profit
        unrealizedPnl: 4.00,
        entryTime: new Date(NOW - 30_000).toISOString(),
      });
      const signals = makeSignals();

      const result = evaluateExits(position, signals, LIVE_CONFIG, { breachAtMs: null, used: false }, NOW);

      expect(result.decision).toBeNull();
      expect(result.pnlNow).toBe(4.00);
    });

    it('should NOT exit when PnL is small loss above threshold', () => {
      // $40 position, 30% threshold = $12 max loss
      // PnL = -$10 (25% loss) — above the -$12 threshold
      const position = makePosition({
        contractSize: 40,
        mark: 37.5, // 37.5¢ → 80 * 0.375 = $30, loss = -$10
        unrealizedPnl: -10.00,
        entryTime: new Date(NOW - 30_000).toISOString(),
      });
      const signals = makeSignals();

      const result = evaluateExits(position, signals, LIVE_CONFIG, { breachAtMs: null, used: false }, NOW);

      expect(result.decision).toBeNull();
      expect(result.pnlNow).toBe(-10.00);
    });
  });

  describe('PnL at or above 30% stop loss threshold', () => {
    it('should exit immediately when PnL is exactly at 30% loss (no grace)', () => {
      // $40 position, 30% = $12 loss exactly
      const position = makePosition({
        contractSize: 40,
        mark: 25, // 25¢ → 80 * 0.25 = $20, loss = -$20 — actually 50%
        unrealizedPnl: -12.00, // exactly 30%
        entryTime: new Date(NOW - 5_000).toISOString(),
        lastTradeTime: Math.floor((NOW - 5_000) / 1000),
      });
      const signals = makeSignals();

      // Note: liveTrading.stopLossGraceSec = 0, so no grace period
      const result = evaluateExits(position, signals, LIVE_CONFIG, { breachAtMs: null, used: false }, NOW);

      expect(result.decision).not.toBeNull();
      expect(result.decision.reason).toContain('Max Loss');
    });

    it('should exit immediately when PnL exceeds 30% loss', () => {
      // $40 position, 30% = $12 max loss
      // PnL = -$14 (35% loss)
      const position = makePosition({
        contractSize: 40,
        mark: 22.5, // 22.5¢ → 80 * 0.225 = $18, loss = -$22 → actually 55%
        unrealizedPnl: -14.00, // -35%
        entryTime: new Date(NOW - 5_000).toISOString(),
        lastTradeTime: Math.floor((NOW - 5_000) / 1000),
      });
      const signals = makeSignals();

      const result = evaluateExits(position, signals, LIVE_CONFIG, { breachAtMs: null, used: false }, NOW);

      expect(result.decision).not.toBeNull();
      expect(result.decision.reason).toContain('Max Loss');
    });

    it('should exit large position at 30% threshold (cap enforced by config)', () => {
      // $100 position, 30% = $30 max loss
      const position = makePosition({
        contractSize: 100,
        shares: 200,
        unrealizedPnl: -30.00, // exactly 30%
        entryTime: new Date(NOW - 2_000).toISOString(),
        lastTradeTime: Math.floor((NOW - 2_000) / 1000),
      });
      const signals = makeSignals();

      const result = evaluateExits(position, signals, LIVE_CONFIG, { breachAtMs: null, used: false }, NOW);

      expect(result.decision).not.toBeNull();
      expect(result.decision.reason).toContain('Max Loss');
    });
  });

  describe('trade age with grace enabled (for future config expansion)', () => {
    it('should NOT exit during stopLossGrace period when trade is young', () => {
      // With stopLossGraceSec=20 and trade age=10s: within grace, SL skipped
      const configWithGrace = {
        ...LIVE_CONFIG,
        stopLossGraceSec: 20,
      };

      const position = makePosition({
        contractSize: 40,
        mark: 20, // big loss
        unrealizedPnl: -20.00, // -50% — well beyond threshold
        entryTime: new Date(NOW - 10_000).toISOString(),
        lastTradeTime: Math.floor((NOW - 10_000) / 1000),
      });
      const signals = makeSignals();

      const result = evaluateExits(position, signals, configWithGrace, { breachAtMs: null, used: false }, NOW);

      // Within 20s stop-loss grace period — stop loss should not fire
      expect(result.decision).toBeNull();
    });

    it('should exit after stopLossGrace period expires', () => {
      const configWithGrace = {
        ...LIVE_CONFIG,
        stopLossGraceSec: 20,
      };

      // Trade is 25 seconds old — past the 20s grace period
      const position = makePosition({
        contractSize: 40,
        mark: 20,
        unrealizedPnl: -20.00,
        entryTime: new Date(NOW - 25_000).toISOString(),
        lastTradeTime: Math.floor((NOW - 25_000) / 1000),
      });
      const signals = makeSignals();

      const result = evaluateExits(position, signals, configWithGrace, { breachAtMs: null, used: false }, NOW);

      expect(result.decision).not.toBeNull();
      expect(result.decision.reason).toContain('Max Loss');
    });
  });

  describe('position in active maxLoss grace period', () => {
    it('should NOT exit while position is in active grace window', () => {
      const configWithGrace = {
        ...LIVE_CONFIG,
        maxLossGraceEnabled: true,
        maxLossGraceSeconds: 60,
        stopLossGraceSec: 0,
      };

      // Grace started 30s ago — 60s grace window, 30s elapsed, still holding
      const graceBreachAt = NOW - 30_000;
      const position = {
        id: 'grace-test',
        side: 'UP',
        tokenID: '0xtoken',
        shares: 80,
        contractSize: 40,
        mark: 20,
        unrealizedPnl: -20.00,
        entryTime: new Date(NOW - 30_000).toISOString(),
        lastTradeTime: Math.floor((NOW - 30_000) / 1000),
        marketSlug: 'btc-updown-5m-' + Math.floor(NOW / 1000),
        maxUnrealizedPnl: 0,
        minUnrealizedPnl: 0,
        outcome: 'UP',
      };
      const signals = {
        market: { slug: position.marketSlug, endDate: new Date(NOW + 240_000).toISOString(), liquidityNum: 50000 },
        timeLeftMin: 4,
        modelUp: 0.55,
        modelDown: 0.45,
      };

      const result = evaluateExits(position, signals, configWithGrace, { breachAtMs: graceBreachAt, used: true }, NOW);

      // Still within 60s grace (30s elapsed, 30s remaining) — hold
      expect(result.decision).toBeNull();
    });

    it('should exit when grace period expires', () => {
      const configWithGrace = {
        ...LIVE_CONFIG,
        maxLossGraceEnabled: true,
        maxLossGraceSeconds: 60,
        stopLossGraceSec: 0,
      };

      // Grace started 65s ago — past the 60s window
      const graceBreachAt = NOW - 65_000;
      const position = {
        id: 'grace-test',
        side: 'UP',
        tokenID: '0xtoken',
        shares: 80,
        contractSize: 40,
        mark: 20,
        unrealizedPnl: -20.00,
        entryTime: new Date(NOW - 65_000).toISOString(),
        lastTradeTime: Math.floor((NOW - 65_000) / 1000),
        marketSlug: 'btc-updown-5m-' + Math.floor(NOW / 1000),
        maxUnrealizedPnl: 0,
        minUnrealizedPnl: 0,
        outcome: 'UP',
      };
      const signals = {
        market: { slug: position.marketSlug, endDate: new Date(NOW + 240_000).toISOString() },
        timeLeftMin: 4,
        modelUp: 0.55,
        modelDown: 0.45,
      };

      const result = evaluateExits(position, signals, configWithGrace, { breachAtMs: graceBreachAt, used: true }, NOW);

      expect(result.decision).not.toBeNull();
      expect(result.decision.reason).toContain('Max Loss');
    });
  });

  describe('market settlement approaching', () => {
    it('should exit pre-settlement when time left < exitBeforeEndMinutes', () => {
      // Build a slug representing a market that settles in ~30s
      // epoch = (now + 30000) / 1000 - 300 = now/1000 - 270
      const preSettleEpoch = Math.floor(NOW / 1000) - 270;
      const settleSlug = 'btc-updown-5m-' + preSettleEpoch;

      const position = {
        id: 'pre-settle',
        side: 'UP',
        tokenID: '0xtoken',
        shares: 80,
        contractSize: 40,
        mark: 45,
        unrealizedPnl: -2.00,
        entryTime: new Date(NOW - 60_000).toISOString(),
        lastTradeTime: Math.floor((NOW - 60_000) / 1000),
        marketSlug: settleSlug,
        maxUnrealizedPnl: 0,
        minUnrealizedPnl: 0,
        outcome: 'UP',
      };

      const signals = {
        market: { slug: settleSlug, endDate: new Date(NOW + 30_000).toISOString() },
        timeLeftMin: 0.5,
        modelUp: 0.55,
        modelDown: 0.45,
      };

      const result = evaluateExits(position, signals, LIVE_CONFIG, { breachAtMs: null, used: false }, NOW);

      expect(result.decision).not.toBeNull();
      expect(result.decision.reason).toContain('Pre-settlement');
    });
  });

  describe('market rollover', () => {
    it('should exit with Market Rollover when slug has changed and old market settled', () => {
      // Build a settled slug: epoch from 600+ seconds ago (market ended in the past)
      const settledEpoch = Math.floor(NOW / 1000) - 600;
      const settledSlug = 'btc-updown-5m-' + settledEpoch;
      const currentEpoch = Math.floor(NOW / 1000);
      const currentSlug = 'btc-updown-5m-' + currentEpoch;

      const position = {
        id: 'rollover-test',
        side: 'UP',
        tokenID: '0xtoken',
        shares: 80,
        contractSize: 40,
        mark: 45,
        unrealizedPnl: 2.00,
        entryTime: new Date(NOW - 120_000).toISOString(),
        lastTradeTime: Math.floor((NOW - 120_000) / 1000),
        marketSlug: settledSlug,
        maxUnrealizedPnl: 0,
        minUnrealizedPnl: 0,
        outcome: 'UP',
      };

      const signals = {
        market: { slug: currentSlug, endDate: new Date(NOW + 240_000).toISOString() },
        timeLeftMin: 4,
        modelUp: 0.55,
        modelDown: 0.45,
      };

      const result = evaluateExits(position, signals, LIVE_CONFIG, { breachAtMs: null, used: false }, NOW);

      expect(result.decision).not.toBeNull();
      expect(result.decision.reason).toBe('Market Rollover');
    });

    it('should NOT exit on slug change if old market has NOT settled yet', () => {
      // Both slugs are current — market hasn't settled yet
      const currentEpoch = Math.floor(NOW / 1000);
      const positionSlug = 'btc-updown-5m-' + currentEpoch;
      const nextSlug = 'btc-updown-5m-' + (currentEpoch + 300);

      const position = {
        id: 'no-rollover-test',
        side: 'UP',
        tokenID: '0xtoken',
        shares: 80,
        contractSize: 40,
        mark: 45,
        unrealizedPnl: 2.00,
        entryTime: new Date(NOW - 30_000).toISOString(),
        lastTradeTime: Math.floor((NOW - 30_000) / 1000),
        marketSlug: positionSlug,
        maxUnrealizedPnl: 0,
        minUnrealizedPnl: 0,
        outcome: 'UP',
      };

      const signals = {
        market: { slug: nextSlug, endDate: new Date(NOW + 240_000).toISOString() },
        timeLeftMin: 4,
        modelUp: 0.55,
        modelDown: 0.45,
      };

      const result = evaluateExits(position, signals, LIVE_CONFIG, { breachAtMs: null, used: false }, NOW);

      // Should NOT trigger rollover since position market hasn't settled
      expect(result.decision).toBeNull();
    });
  });

  describe('grace recovery — CLEAR_GRACE action', () => {
    it('should clear grace when PnL recovers above recover threshold during grace', () => {
      const configWithGrace = {
        ...LIVE_CONFIG,
        maxLossGraceEnabled: true,
        maxLossGraceSeconds: 60,
        maxLossRecoverUsd: 10, // recover when PnL > -$10
        stopLossGraceSec: 20,
      };

      const position = makePosition({
        contractSize: 40,
        mark: 35, // slight loss
        unrealizedPnl: -8.00, // recovered to -$8 (above -$10 threshold)
        entryTime: new Date(NOW - 25_000).toISOString(),
        lastTradeTime: Math.floor((NOW - 25_000) / 1000),
      });
      const signals = makeSignals();

      const result = evaluateExits(
        position,
        signals,
        configWithGrace,
        { breachAtMs: NOW - 20_000, used: false }, // was in grace, breached 20s ago
        NOW,
      );

      // Should clear grace since PnL recovered
      expect(result.graceAction).toBe('CLEAR_GRACE');
    });
  });
});
  // ═══════════════════════════════════════════════════════════════
  // STOP LOSS TIME-SERIES TEST
  // Simulates a trade degrading over multiple ticks and verifies
  // the exit evaluator fires the stop loss at exactly 30%.
  //
  // Test case: UP trade, entry at 45¢, 100 shares, $45 position
  // 30% stop loss = -$13.50 PnL threshold
  // Stop fires when mark <= 31.5¢ (entry - 30% = 0.315)
  // ═══════════════════════════════════════════════════════════════

  describe('stop loss fires at exactly 30% on time-series', () => {
    it('should exit when PnL crosses 30% loss threshold (no grace, UP trade)', () => {
      const ENTRY_PRICE = 0.45;   // 45¢ entry
      const SHARES = 100;
      const CONTRACT_SIZE = ENTRY_PRICE * SHARES;  // $45
      const STOP_LOSS_PCT = 0.30;
      const STOP_LOSS_AMOUNT = -CONTRACT_SIZE * STOP_LOSS_PCT;  // -$13.50

      // Price path: 55¢ (green) → 50¢ → 45¢ → 40¢ → 35¢ → 30¢ (stop fires)
      // At 55¢: PnL = 100 * (0.55 - 0.45) = +$10 (22% gain)
      // At 50¢: PnL = 100 * (0.50 - 0.45) = +$5 (11% gain)
      // At 45¢: PnL = $0 (at entry)
      // At 40¢: PnL = -$5 (-11% loss)
      // At 35¢: PnL = -$10 (-22% loss)
      // At 30¢: PnL = -$15 (-33% loss) → > 30% threshold
      const PRICE_TICKS = [0.55, 0.50, 0.45, 0.40, 0.35, 0.30];
      const EXPECTED_EXIT_TICK = 5;  // 0-indexed: tick 5 (mark=30¢, PnL=-15) is where stop fires

      const position = {
        id: 'ts-test-up',
        side: 'UP',
        tokenID: '0xtoken123',
        shares: SHARES,
        contractSize: CONTRACT_SIZE,
        mark: null,
        unrealizedPnl: null,
        entryTime: null,
        lastTradeTime: Math.floor(NOW / 1000),  // trade just started
        marketSlug: 'btc-updown-5m-' + Math.floor(NOW / 1000),
        maxUnrealizedPnl: 0,
        minUnrealizedPnl: 0,
        outcome: 'UP',
      };

      const signals = makeSignals({
        market: {
          slug: position.marketSlug,
          endDate: new Date(NOW + 240_000).toISOString(),
          liquidityNum: 50000,
        },
      });

      // Simulate each price tick
      for (let i = 0; i < PRICE_TICKS.length; i++) {
        const mark = PRICE_TICKS[i];
        position.mark = mark;
        // PnL in dollars: shares * (current price in $ - entry price in $)
        position.unrealizedPnl = SHARES * (mark - ENTRY_PRICE);
        // Advance trade age by 2 seconds per tick
        position.lastTradeTime = Math.floor((NOW + i * 2_000) / 1000);
        if (position.entryTime) {
          position.entryTime = new Date(NOW + i * 2_000).toISOString();
        }

        const result = evaluateExits(position, signals, LIVE_CONFIG, { breachAtMs: null, used: false }, NOW + i * 2_000);

        if (i < EXPECTED_EXIT_TICK) {
          // Before stop fires: PnL should be above 30% threshold
          expect(result.decision, `Tick ${i}: mark=${mark}¢, PnL=$${position.unrealizedPnl.toFixed(2)} (above -$13.50, no exit)`).toBeNull();
        } else if (i === EXPECTED_EXIT_TICK) {
          // Exactly at the stop-loss tick: should fire
          expect(result.decision, `Tick ${i}: mark=${mark}¢, PnL=$${position.unrealizedPnl.toFixed(2)} (should exit at exactly 30% threshold)`).not.toBeNull();
          expect(result.decision.reason).toContain('Max Loss');
        }
      }
    });

    it('should NOT exit early even if PnL briefly spikes negative before recovering', () => {
      const ENTRY_PRICE = 0.50;   // 50¢ entry
      const SHARES = 100;
      const CONTRACT_SIZE = ENTRY_PRICE * SHARES;  // $50

      // Price path: 55¢ → 47¢ (brief red) → 52¢ (recovered, still above entry)
      // PnL at 47¢: 100 * (0.47 - 0.50) = -$3 (not a stop loss at 30% = -$15)
      const PRICE_TICKS = [0.55, 0.47, 0.52, 0.56];

      const position = {
        id: 'ts-recover-test',
        side: 'UP',
        tokenID: '0xtoken456',
        shares: SHARES,
        contractSize: CONTRACT_SIZE,
        mark: null,
        unrealizedPnl: null,
        entryTime: null,
        lastTradeTime: Math.floor(NOW / 1000),
        marketSlug: 'btc-updown-5m-' + Math.floor(NOW / 1000),
        maxUnrealizedPnl: 0,
        minUnrealizedPnl: 0,
        outcome: 'UP',
      };

      const signals = makeSignals({
        market: {
          slug: position.marketSlug,
          endDate: new Date(NOW + 240_000).toISOString(),
          liquidityNum: 50000,
        },
      });

      for (let i = 0; i < PRICE_TICKS.length; i++) {
        const mark = PRICE_TICKS[i];
        position.mark = mark;
        position.unrealizedPnl = SHARES * (mark - ENTRY_PRICE);
        position.lastTradeTime = Math.floor((NOW + i * 2_000) / 1000);

        const result = evaluateExits(position, signals, LIVE_CONFIG, { breachAtMs: null, used: false }, NOW + i * 2_000);

        // Should NOT exit — PnL never crosses -30% threshold (-$15)
        expect(result.decision, `Tick ${i}: mark=${mark}¢, PnL=$${position.unrealizedPnl.toFixed(2)}`).toBeNull();
      }
    });

    it('should handle DOWN trade stop loss correctly', () => {
      const ENTRY_PRICE = 0.55;   // 55¢ entry (bought DOWN side)
      const SHARES = 100;
      const CONTRACT_SIZE = ENTRY_PRICE * SHARES;  // $55
      const STOP_LOSS_PCT = 0.30;
      const STOP_LOSS_AMOUNT = -CONTRACT_SIZE * STOP_LOSS_PCT;  // -$16.50

      // For DOWN trade, price going DOWN is good (PnL = shares * (entryPrice - currentPrice))
      // 30% of $55 = $16.50 → stop fires when PnL <= -$16.50
      // PnL = 100 * (0.55 - mark)
      // At 65¢: PnL = -$10 (not triggered)
      // At 70¢: PnL = -$15 (27.3% loss, NOT triggered — need <= -$16.50)
      // At 71.5¢: PnL = -$16.50 (exactly 30%) → EXIT
      const PRICE_TICKS = [0.45, 0.50, 0.55, 0.60, 0.65, 0.70, 0.715];
      const EXPECTED_EXIT_TICK = 6;  // stop fires at 71.5¢ (exactly 30% loss)

      const position = {
        id: 'ts-test-down',
        side: 'DOWN',
        tokenID: '0xtoken789',
        shares: SHARES,
        contractSize: CONTRACT_SIZE,
        mark: null,
        unrealizedPnl: null,
        entryTime: null,
        lastTradeTime: Math.floor(NOW / 1000),
        marketSlug: 'btc-updown-5m-' + Math.floor(NOW / 1000),
        maxUnrealizedPnl: 0,
        minUnrealizedPnl: 0,
        outcome: 'DOWN',
      };

      const signals = makeSignals({
        market: {
          slug: position.marketSlug,
          endDate: new Date(NOW + 240_000).toISOString(),
          liquidityNum: 50000,
        },
      });

      for (let i = 0; i < PRICE_TICKS.length; i++) {
        const mark = PRICE_TICKS[i];
        position.mark = mark;
        // DOWN trade PnL: shares * (entryPrice - currentPrice)
        position.unrealizedPnl = SHARES * (ENTRY_PRICE - mark);
        position.lastTradeTime = Math.floor((NOW + i * 2_000) / 1000);

        const result = evaluateExits(position, signals, LIVE_CONFIG, { breachAtMs: null, used: false }, NOW + i * 2_000);

        if (i < EXPECTED_EXIT_TICK) {
          expect(result.decision, `Tick ${i}: mark=${mark}¢, PnL=$${position.unrealizedPnl.toFixed(2)} (above -$16.50, no exit)`).toBeNull();
        } else if (i === EXPECTED_EXIT_TICK) {
          expect(result.decision, `Tick ${i}: mark=${mark}¢, PnL=$${position.unrealizedPnl.toFixed(2)} (should exit at 30%)`).not.toBeNull();
          expect(result.decision.reason).toContain('Max Loss');
        }
      }
    });
  });
