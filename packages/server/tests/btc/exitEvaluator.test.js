import { describe, expect, it } from 'vitest';

import { buildTradingConfig, CONFIG } from '../../src/btc/config.js';
import { evaluateExits } from '../../src/btc/domain/exitEvaluator.js';

describe('BTC exit evaluator live risk management', () => {
  it('exits a small live position at the configured 12% dynamic max loss', () => {
    const now = Date.now();
    const config = buildTradingConfig(CONFIG, 'live', '5m');
    const result = evaluateExits(
      {
        id: 'live-trade-1',
        side: 'UP',
        marketSlug: 'btc-updown-5m-1893456000',
        entryPrice: 0.5,
        shares: 19.98,
        contractSize: 9.99,
        mark: 0.43994,
        unrealizedPnl: -1.20,
        maxUnrealizedPnl: 0,
        minUnrealizedPnl: -1.20,
        entryTime: new Date(now - 1_000).toISOString(),
        tokenID: 'token-1',
      },
      {
        market: { slug: 'btc-updown-5m-1893456000', endDate: new Date(now + 120_000).toISOString() },
        modelUp: 0.5,
        modelDown: 0.5,
      },
      config,
      { breachAtMs: null, used: false },
      now,
    );

    expect(config.dynamicStopLossPct).toBe(0.12);
    expect(config.minMaxLossUsd).toBe(0);
    expect(config.maxLossGraceEnabled).toBe(false);
    expect(result.decision?.reason).toBe('Max Loss ($1.20)');
  });
});
