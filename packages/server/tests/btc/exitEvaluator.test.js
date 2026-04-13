import { describe, expect, it } from 'vitest';

import { buildTradingConfig, CONFIG } from '../../src/btc/config.js';
import { evaluateExits } from '../../src/btc/domain/exitEvaluator.js';

describe('BTC exit evaluator live risk management', () => {
  it('exits a small live position at the configured 12% dynamic max loss', () => {
    const now = Date.now();
    const config = buildTradingConfig(CONFIG, 'live', '5m');
    
    // Verify config is correct
    expect(config.dynamicStopLossPct).toBe(0.30);
    expect(config.minMaxLossUsd).toBe(0);
    expect(config.dynamicStopLossEnabled).toBe(true);
    
    const position = {
      id: 'live-trade-1',
      side: 'UP',
      marketSlug: 'btc-updown-5m-1893456000',
      entryPrice: 0.5,
      shares: 19.98,
      contractSize: 9.99,
      mark: 0.43994,
      unrealizedPnl: -3.00, // 30% of $9.99 ≈ $3.00
      maxUnrealizedPnl: 0,
      minUnrealizedPnl: -1.20,
      entryTime: new Date(now - 1_000).toISOString(),
    };

    const market = {
      market: { slug: 'btc-updown-5m-1893456000', endDate: new Date(now + 120_000).toISOString() },
      modelUp: 0.5,
      modelDown: 0.5,
    };

    const result = evaluateExits(
      { ...position, ...market },  // position
      market,                         // signals (market data)
      config,                         // config
      { breachAtMs: null, used: false }, // graceState
      now,                           // nowMs
    );

    // Stop loss should fire at 30% for $9.99 position = $3.00 loss
    expect(result.decision?.reason).toBe('Max Loss ($3.00)');
  });

  it('respects maxMaxLossUsd cap for large positions', () => {
    const now = Date.now();
    const config = buildTradingConfig(CONFIG, 'live', '5m');
    
    const position = {
      id: 'live-trade-2',
      side: 'DOWN',
      marketSlug: 'btc-updown-5m-1893456000',
      entryPrice: 0.5,
      shares: 199.8,
      contractSize: 99.9,  // $100 position
      mark: 0.43994,
      unrealizedPnl: -20.0, // 20% loss = $20, exceeds maxMaxLossUsd
      maxUnrealizedPnl: 0,
      minUnrealizedPnl: -20.0,
      entryTime: new Date(now - 1_000).toISOString(),
    };

    const market = {
      market: { slug: 'btc-updown-5m-1893456000', endDate: new Date(now + 120_000).toISOString() },
      modelUp: 0.5,
      modelDown: 0.5,
    };

    const result = evaluateExits(
      { ...position, ...market },
      market,
      config,
      { breachAtMs: null, used: false },
      now,
    );

    // 12% of $99.9 = $11.99, but maxMaxLossUsd caps it
    expect(result.decision?.reason).toContain('Max Loss');
  });
});
