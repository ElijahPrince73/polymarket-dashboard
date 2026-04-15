export const CONFIG = {
  // Symbol for display/labels
  symbol: 'BTCUSD',

  // Price feed source
  priceFeed: process.env.PRICE_FEED || 'kraken',

  // Kraken configuration
  kraken: {
    baseUrl: process.env.KRAKEN_REST_BASE_URL || 'https://api.kraken.com',
    wsUrl: process.env.KRAKEN_WS_URL || 'wss://ws.kraken.com',
    pair: process.env.KRAKEN_PAIR || 'XXBTZUSD',
  },

  // Spot reference feed (used for impulse/basis comparisons)
  // Note: current implementation uses Coinbase Exchange WS/REST.
  coinbase: {
    symbol: process.env.COINBASE_SYMBOL || 'BTC-USD',
    baseUrl:
      process.env.COINBASE_REST_BASE_URL || 'https://api.exchange.coinbase.com',
    wsBaseUrl:
      process.env.COINBASE_WS_URL || 'wss://ws-feed.exchange.coinbase.com',
  },

  // Polymarket API endpoints
  gammaBaseUrl: 'https://gamma-api.polymarket.com',
  clobBaseUrl: 'https://clob.polymarket.com',

  // Polling and candle settings
  pollIntervalMs: 1_000, // 1s loop for faster UI responsiveness on 5m markets
  candleWindowMinutes: 5,

  // Indicator settings (faster defaults for 5m markets)
  vwapSlopeLookbackMinutes: 3,
  rsiPeriod: 9,
  rsiMaPeriod: 9,
  macdFast: 6,
  macdSlow: 13,
  macdSignal: 5,

  // Polymarket market settings
  polymarket: {
    marketSlug: process.env.POLYMARKET_SLUG || '',
    // BTC Up/Down 5m series id (Gamma). Override with POLYMARKET_SERIES_ID if needed.
    seriesId: process.env.POLYMARKET_SERIES_ID || '10684',
    seriesSlug: process.env.POLYMARKET_SERIES_SLUG || 'btc-up-or-down-5m',
    autoSelectLatest:
      (process.env.POLYMARKET_AUTO_SELECT_LATEST || 'true').toLowerCase() ===
      'true',
    liveDataWsUrl:
      process.env.POLYMARKET_LIVE_WS_URL || 'wss://ws-live-data.polymarket.com',
    upOutcomeLabel: process.env.POLYMARKET_UP_LABEL || 'Up',
    downOutcomeLabel: process.env.POLYMARKET_DOWN_LABEL || 'Down',
  },

  // Chainlink settings (Polygon RPC for fallback)
  chainlink: {
    polygonRpcUrls: (process.env.POLYGON_RPC_URLS || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    polygonRpcUrl: process.env.POLYGON_RPC_URL || 'https://polygon-rpc.com',
    polygonWssUrls: (process.env.POLYGON_WSS_URLS || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    polygonWssUrl: process.env.POLYGON_WSS_URL || '',
    btcUsdAggregator:
      process.env.CHAINLINK_BTC_USD_AGGREGATOR ||
      '0xc907E116054Ad103354f2D350FD2514433D57F6f',
  },

  // Paper trading settings
  paperTrading: {
    enabled:
      (process.env.PAPER_TRADING_ENABLED || 'false').toLowerCase() === 'true',

    // Bankroll + position sizing
    startingBalance: 1000,
    // Raised from 8% to 12%: at $1,139 balance this means ~$137/trade instead of ~$91.
    // As balance grows, trades scale automatically. Floor $50, ceiling $300.
    // At $500: 20% = $100 positions. Sweet spot for risk/reward.
    stakePct: 0.08, // 20% of balance per trade
    minTradeUsd: 25,
    maxTradeUsd: 250,

    // Fractional Kelly sizing: scale position by model confidence.
    // Quarter Kelly (0.25) is standard for volatile markets.
    // Multiplier clamped to [0.3x, 2.0x] of base stakePct.
    kellyEnabled: true,
    kellyFraction: 0.25,

    // Back-compat (legacy fixed size). If stakePct is set, we use dynamic sizing.
    contractSize: 100,

    // Thresholds (higher = more hesitation)
    // 5m defaults tuned for higher-frequency paper trading
    // Raised from 0.52/0.53/0.55 based on 84-trade analysis:
    // entries at >60¢ (higher conviction) had 63% WR vs 27% at <40¢.
    // Loosened for high-frequency: bet on almost every market
    // Tightened: 75% of entries never went green. Need higher conviction.
    minProbEarly: 0.54,  // tightened from 0.51, v1.0.7 was 0.57
    minProbMid: 0.55,    // tightened from 0.51, v1.0.7 was 0.58
    minProbLate: 0.56,   // tightened from 0.51, v1.0.7 was 0.60

    // Lowered from 0.02 to 0.015: 84% of trades are EARLY phase with PF near 1.0.
    // Slightly looser edge lets more volume through where timing advantage is highest.
    // Minimal edge requirements — let volume flow
    // Tightened: need real edge, not noise
    edgeEarly: 0.008,   // tightened from 0.001, v1.0.7 was 0.015
    edgeMid: 0.015,     // tightened from 0.001, v1.0.7 was 0.03
    edgeLate: 0.025,    // tightened from 0.001, v1.0.7 was 0.05

    // Extra strictness knobs (used to improve odds without killing trade count)
    // MID entries tend to be weaker; require a bit more strength.
    midProbBoost: 0.01,
    midEdgeBoost: 0.01,

    // In loose mode (rec gating ignored) when side is inferred, require stronger signals.
    inferredProbBoost: 0.01,
    inferredEdgeBoost: 0.01,

    // Exit settings
    // Close before settlement to avoid rollover weirdness.
    // Disabled: let trades ride to settlement instead of force-exiting at a bad price.
    // The market resolves and pays out based on outcome — better than forced exit slippage.
    // Exit 1 min before settlement to avoid rollover losses
    exitBeforeEndMinutes: 1.0,

    // Stagnation exit: if trade is flat (PnL within ±$2) after this many seconds, exit early.
    // v1.0.7 data: trades >25s had 36% WR, +$0.55 avg. Stagnating trades usually hit max loss.
    stagnationExitSeconds: 0, // 0 = disabled
    stagnationBandUsd: 2,

    // Time stop: if a trade can't go green quickly, cut it.
    // ALL OR NOTHING: no time stop. Hardcoded 0.
    loserMaxHoldSeconds: 0,

    // Minimum hold before max loss can trigger (seconds).
    // Prevents stop-outs from entry volatility. 5/7 "right direction but lost" trades
    // hit max loss in <10s — the market dipped then went our way.
    minHoldBeforeStopSeconds: 0,

    // Hard max loss cap (USD): prevents one trade from wiping multiple small wins.
    // If pnlNow <= -maxLossUsdPerTrade, force exit (unless max-loss grace is enabled).
    // ALL OR NOTHING: no fixed max loss fallback either. Hardcoded 0.
    maxLossUsdPerTrade: 20,

    // Dynamic stop loss: scale maxLoss proportionally to position size.
    // When enabled, maxLoss = contractSize * dynamicStopLossPct, clamped to [minMaxLossUsd, maxMaxLossUsd].
    // When disabled, the fixed maxLossUsdPerTrade above is used (backward compat).
    // Example: $80 trade * 0.20 = $16 max loss; $250 trade * 0.20 = $40 (ceiling).
    // Dynamic stop loss: scales with Kelly position size.
    // 20% of position: $25 trade → $5 SL, $100 trade → $20 SL, $200 trade → $40 SL
    dynamicStopLossEnabled: true,
    // Tightened from 18% to 12%: 101-trade analysis showed max loss trades (-$521)
    // wiping all trailing TP profit (+$503). 75% of max losses never went green.
    // At $120 position: 12% = $14.40 max loss (was $21.60 at 18%).
    // At $6 position ($50 balance): 12% = $0.72
    // Fixed take-profit: exit immediately at X% of position. No trailing, no slippage.
    // At $100 position: 5% = $5 profit target. Fires before trailing TP.
    // ALL OR NOTHING: no fixed TP, ride to settlement. Hardcoded false.
    fixedTakeProfitEnabled: false,
    // Raised from 5% to 10%: $5 TP vs $8 SL needed 62% WR (too hard).
    // $10 TP vs $8 SL needs only 44% WR. Data shows trades regularly hit $10+ MFE.
    fixedTakeProfitPct: 0.06, // 6% of position (~$5 at $80)
    // Time-based TP reduction disabled
    reducedTakeProfitPct: 0.05,
    reducedTpAfterSeconds: 9999,

    // Tightened from 12% to 8%: simulation showed $76 saved over 20 max-loss trades
    // Tightened: risk $5 instead of $8. At 30% MFE $5+ rate, breakeven ~50% WR
    dynamicStopLossPct: 0.30, // 30% of position — loose stop for volatility, let winners ride
    minMaxLossUsd: 0,
    maxMaxLossUsd: 50,

    // Max-loss grace (optional): when pnl breaches -maxLossUsdPerTrade, allow a short grace window
    // to recover (helps avoid wick/chop stop-outs) *only when conditions are supportive*.
    maxLossGraceEnabled: true,
    maxLossGraceSeconds: 60,
    // If PnL recovers above -maxLossRecoverUsd during grace, we cancel the pending stop.
    maxLossRecoverUsd: 10,
    // Require the model to still support the trade side during grace.
    maxLossGraceRequireModelSupport: true,

    // Quick stop: if trade drops X% of position within first N seconds, exit immediately.
    // 101-trade analysis showed 75% of max-loss trades never went green — bad entries.
    // At $120 position: 4% = $4.80 threshold. At $6 ($50 balance): $0.24 threshold.
    // Disabled: at small balances ($50), 4% of $6 position = $0.24 — too tight.
    // Polymarket price noise exceeds this on every tick.
    quickStopEnabled: false,
    quickStopSeconds: 5,
    quickStopPct: 0.04,

    // Cooldown after a losing trade (seconds): prevents rapid back-to-back losses.
    // Reduced cooldowns for high-frequency
    lossCooldownSeconds: 0,

    // Trading hours (PST) — only trade during profitable hours
    tradingHoursEnabled: true,
    tradingHoursStart: 6,   // 6 AM PST
    tradingHoursEnd: 17,    // 5 PM PST

    // Loss cooldown — skip next market after a loss
    lossCooldownEnabled: true,
    lossCooldownMinutes: 5, // 5 minute cooldown after a loss

    // SL grace period — don't apply stop loss for first N seconds
    // Data: 52/171 direction-correct trades lost to early SL
    stopLossGraceSec: 20,

    winCooldownSeconds: 0,

    // Daily loss limit: kill-switch threshold (applies to BOTH paper and live modes)
    // Alias: DAILY_LOSS_LIMIT overrides LIVE_MAX_DAILY_LOSS_USD for unified behavior
    maxDailyLossUsd: 0,

    // Kill-switch for paper mode: disabled by default for testing flexibility.
    // Set PAPER_KILL_SWITCH_ENABLED=true to re-enable.
    paperKillSwitchEnabled: false,

    // Kill-switch override buffer: 10% additional loss allowed after override
    killSwitchOverrideBufferPct: 0.10,

    // Circuit breaker: after N consecutive losses, pause entries for a cooldown period.
    // Set to 0 to disable.
    // Loosened circuit breaker
    circuitBreakerConsecutiveLosses: 8,
    circuitBreakerCooldownMs: 2 * 60_000, // 2 minutes

    // Max Drawdown breaker: stop trading if session drawdown exceeds this % of starting balance.
    // 15% = stop if $500 balance drops to $425. Prevents catastrophic loss spirals.
    maxDrawdownPct: 0, // disabled for paper trading

    // If true: after a Max Loss stopout, do not enter again until the market rolls to the next slug.
    // One trade per market: after any exit (win or lose), skip rest of this 5m market.
    oneTradePerMarket: true,
    // Legacy: skip only after max loss (superseded by oneTradePerMarket)
    skipMarketAfterMaxLoss: false,

    // Stop loss (disabled by default for 5m; rollover + chop made it a big drag)
    stopLossEnabled: false,
    // Example: 0.25 => cut the trade if it loses 25% of contractSize.
    stopLossPct: 0.2,

    // Take profit
    // NOTE: Immediate TP exits as soon as mark-to-market PnL is >= takeProfitPnlUsd.
    // For 5m, trailing TP tends to behave better (lets winners run, then protects gains).
    takeProfitImmediate: false,
    // Default loosened to let winners run a bit (can override via TAKE_PROFIT_PNL_USD env var)
    takeProfitPnlUsd: 25.0,

    // Trailing take profit (recommended):
    // - Once maxUnrealizedPnl >= trailingStartUsd, we track a trail = maxUnrealizedPnl - trailingDrawdownUsd.
    // - If pnlNow falls back below the trail, we exit (locking in gains).
    // Disabled: fixed TP handles exits now. Trailing TP was undercutting
    // by exiting at small pullbacks before fixed TP could trigger.
    // ALL OR NOTHING: no trailing TP, ride to settlement. Hardcoded false.
    trailingTakeProfitEnabled: false,
    // Dynamic trailing TP: scales with position size (% of contractSize).
    // At $1000 balance, 12% stake = $120 position:
    //   start = $120 * 0.04 = $4.80, base dd = $120 * 0.017 = $2.04
    // At $2000 balance: start = $9.60, base dd = $4.08
    // Scales automatically — no manual tuning needed as balance grows.
    // Disabled: v1.0.7 used fixed USD values, not dynamic %
    dynamicTrailingEnabled: false,

    // Trailing start threshold as % of position size
    // Lowered from 4% to 3%: activate trailing sooner to lock in gains earlier
    // Raised: don't trail until $5+ profit. 30% of trades hit this level.
    trailingStartPct: 0.06,  // 6%

    // Base trailing drawdown as % of position size
    // Widened from 1.2% to 1.7%: was cutting winners too early (46% MFE capture)
    trailingDrawdownPct: 0.017, // 1.7%

    // Tiered trailing drawdown (% of position). Thresholds are also % of position.
    // Sorted descending by threshold. First match wins.
    // Widened ~40% from tightened values to let winners run.
    trailingDrawdownTiersPct: [
      { abovePct: 0.33, ddPct: 0.058 },  // PnL >33% of position: ride the monsters
      { abovePct: 0.21, ddPct: 0.042 },  // PnL 21-33%: big winners
      { abovePct: 0.125, ddPct: 0.033 }, // PnL 12.5-21%: solid winners
      { abovePct: 0.067, ddPct: 0.025 }, // PnL 6.7-12.5%: medium winners
      // Below 6.7%: uses base trailingDrawdownPct (1.7%)
    ],

    // Fallback fixed-dollar values (used when dynamicTrailingEnabled=false or contractSize unavailable)
    // v1.0.7 values: start at $3, drawdown $2.50
    trailingStartUsd: 3,
    trailingDrawdownUsd: 2.50,
    trailingDrawdownTiers: [
      { above: 40, dd: 7.0 },
      { above: 25, dd: 5.0 },
      { above: 15, dd: 4.0 },
      { above: 8, dd: 3.0 },
    ],

    // Dynamic exit: close when opposite side becomes more likely.
    // Example: if you're in UP and modelDown >= modelUp + exitFlipMargin AND modelDown >= exitFlipMinProb → exit.
    exitFlipMinProb: 0.62,
    exitFlipMargin: 0.06,
    // Avoid noisy early flips: require trade to be open at least this long before flip-exit is allowed.
    exitFlipMinHoldSeconds: 15,

    // When a probability flip happens, optionally close and immediately open the other side.
    // Default OFF (analytics showed flips were a major drag on PnL). Set FLIP_ON_PROB_FLIP=true to re-enable.
    // Realistic paper trading simulation (approximate live market conditions)
    // Fee simulation: 200 bps = 2% (Polymarket maker fee)
    simFeeRateBps: 200,
    simLatencyDriftPct: 0.002, // 0-0.2% from fill delay
    simPartialFillRate: 0.05, // 5% chance of partial
    simRejectRate: 0.03, // 3% chance of rejection
    // Slippage: random 0-0.3% adverse price movement on entry/exit
    simSlippagePct: 0.003,

    flipOnProbabilityFlip: false,
    flipCooldownSeconds: 60,

    // Market quality filters
    // Liquidity filter (Polymarket market.liquidityNum). Raise this to avoid thin markets.
    minLiquidity: 500,
    // (disabled) Market volume filter. Use volatility/chop filters instead.
    // Set MIN_MARKET_VOLUME_NUM > 0 to re-enable.
    minMarketVolumeNum: 0,
    // Max allowed Polymarket orderbook spread (dollars). 0.008 = 0.8¢
    // Tighten spread for better fills
    // Tightened to reduce adverse selection / churn in wide markets
    // Widened for high-frequency
    maxSpread: 0.10,

    // Trading schedule filter (America/Los_Angeles)
    // If enabled, blocks weekend entries (with optional Sunday exception).
    // Disabled: collecting data on weekend performance for paper trading.
    weekdaysOnly: true,
    // Optional exception: allow Sunday entries after this hour (0-23). Set negative/empty to disable.
    // Allow Sunday evening (6 PM PST) when volume picks up before Monday.
    allowSundayAfterHour: 18,
    // Block new entries after this hour on Friday (0-23). Set empty/negative to disable.
    noEntryAfterFridayHour: 17,

    // Weekend tightening: allow weekend trading, but require stronger signals/market quality.
    weekendTighteningEnabled: false,
    weekendMaxSpread: 0.008, // 0.8¢
    weekendMinLiquidity: 20000,
    weekendMinRangePct20: 0.0025, // 0.25%
    weekendMinModelMaxProb: 0.6,
    weekendProbBoost: 0.03,
    weekendEdgeBoost: 0.03,
    requiredCandlesInDirection: 2,

    // Spot impulse filter (uses Coinbase spot as reference)
    // Require the BTC spot price to have moved at least this much over the last 60s.
    // Set to 0 to disable.
    // Lowered: don't require much movement to enter
    minBtcImpulsePct1m: 0, // 0.01%

    // Volume filters (set to 0 to disable)
    // volumeRecent is sum of last 20x 1m candle volumes
    minVolumeRecent: 0,
    // require volumeRecent >= volumeAvg * minVolumeRatio (volumeAvg is approx avg per-20m block)
    minVolumeRatio: 0,

    // Polymarket price sanity (dollars, 0..1). Prevent "0.00" entries.
    // Polymarket prices are decimal (0–1): 0.56 = 56¢.
    // Avoid dust prices where spread/tick noise dominates.
    minPolyPrice: 0.15,
    maxPolyPrice: 0.95,
    maxEntryPolyPrice: 0.45,
    minOppositePolyPrice: 0.01,

    // Price-asymmetry entry strategy
    // Buy the cheap side — at 30c entry, only need 30% WR to break even
    maxCheapEntryPrice: 0.40,   // max price to consider "cheap" (40c = need 40% WR)
    minCheapEntryPrice: 0.15,   // backtested 225 markets: 15-40c + RSI + Rec = PF 1.30 ($2,266)
    modelVetoThreshold: 1.01,   // disabled — price is the edge, not model prediction
    recGatingEnabled: true,     // only enter when signal engine says ENTER (market quality filter)
    rsiBiasEnabled: true,       // backtested: RSI bias improves PF 1.21 → 1.30 on 61k ticks
    allowedPhases: ['EARLY', 'MID'],  // block LATE: 5% WR, -$1,161 across 105 trades (403 total)

    // Chop/volatility filter (BTC reference): block entries when recent movement is too small.
    // rangePct20 = (max(close,last20) - min(close,last20)) / lastClose
    // Moderate default: require ~0.20% range over last 20 minutes.
    // More permissive for 5m (higher frequency): require ~0.12% range over last 20 minutes.
    // Lowered: allow quieter markets
    minRangePct20: 0,

    // Confidence filter: avoid coin-flip markets where the model is near 50/50.
    // We require max(modelUp, modelDown) >= this value to allow entries.
    // Lowered: allow near-50/50 markets
    // Tightened: require model to have at least 55% confidence in one direction
    minModelMaxProb: 0.50,

    // RSI consolidation filter: disabled for high-frequency trading
    noTradeRsiMin: 0,
    noTradeRsiMax: 0,

    // RSI overbought/oversold directional filter
    noTradeRsiOverbought: 100,
    noTradeRsiOversold: 0,

    // RSI directional bias: align trade direction with momentum.
    // RSI < 40 → only DOWN allowed. RSI > 60 → only UP allowed.
    // 234-trade data: RSI<40 UP entries were worst performers.
    // Disabled for high-frequency — let both sides trade freely
    rsiDirectionalBiasEnabled: false,
    rsiBearishThreshold: 0,
    // Raised from 60 to 65: RSI>60 UP had 42 trades at -$7 PnL. Cuts marginal entries.
    rsiBullishThreshold: 100,

    // Heiken Ashi exhaustion filter: block entries when HA count is 4-6.
    // 157-trade data: count 4-6 had 38% WR, -$35. Count 2-3 best (54% WR, +$112).
    // Count 7+ allowed (strong trend, 53% WR).
    // Disabled for high-frequency
    heikenExhaustionFilterEnabled: false,
    // Narrowed from 4 to 5: count 4 was borderline, allow it through. Block only 5-6.
    heikenExhaustionMin: 5,
    heikenExhaustionMax: 6,

    // Require at least one strong signal: model prob >= 80% OR edge >= 8%.
    // 157-trade data: 60-80% prob with <8% edge was bleeding money.
    // Disabled: was blocking 63% of ticks. Probability + edge thresholds handle filtering now.
    requireStrongSignalEnabled: false,
    // Loosened further: still blocking 80% of ticks at 0.70/0.06. 0.65/0.04 should open more volume.
    strongProbThreshold: 0.65,
    strongEdgeThreshold: 0.04,

    // Time filters
    // For 5m, avoid new entries too close to settlement (rollover risk)
    // Allow entries closer to settlement
    noEntryFinalMinutes: 1.5,
    // Only enter in the final X minutes of the market. 0 = disabled.
    // Disabled: price-asymmetry strategy doesn't need timing gate — price IS the filter.
    onlyEntryFinalMinutes: 0,

    // Require enough 1m candles before allowing entries (helps avoid 50/50 startup)
    minCandlesForEntry: 1,

    // Rec gating controls whether we require the engine to explicitly say ENTER.
    // - strict: must be Rec=ENTER
    // - loose: allow entry if thresholds hit, even when Rec=NO_TRADE/HOLD
    recGating: 'loose',

    // Forced entries OFF by default
    forcedEntriesEnabled: false,
  },

  // Live trading settings (Polymarket CLOB)
  liveTrading: {
    enabled:
      (process.env.LIVE_TRADING_ENABLED || 'true').toLowerCase() === 'true',

    // Environment gate: if set, LIVE_ENV_GATE must match this value to allow live trading.
    // This prevents accidental live trading in development.
    envGate: process.env.LIVE_ENV_GATE || null, // Set to "production" to gate

    // Start small, scale up as strategy proves out in live.
    // Week 1: $3, Week 2: $10, Week 3: $25, Week 4+: full size
    maxPerTradeUsd: 10,
    maxOpenExposureUsd: 10,

    // Kill switch: if realized PnL for the day <= -maxDailyLossUsd, stop live trading.
    // Reset mode: "midnight_pt" (default)
    maxDailyLossUsd: 30,
    dailyLossReset: 'midnight_pt',

    // Optional: baseline offset for daily loss accounting.
    // realizedTodayEffective = realizedTodayRaw - dailyLossBaselineUsd
    // Example: set to current realizedTodayRaw after deploying risk controls, so earlier PnL doesn't count.
    dailyLossBaselineUsd:
      process.env.LIVE_DAILY_LOSS_BASELINE_USD != null &&
      String(process.env.LIVE_DAILY_LOSS_BASELINE_USD).trim() !== ''
        ? Number(process.env.LIVE_DAILY_LOSS_BASELINE_USD)
        : 0,

    // Fee observability
    feeCacheTtlMs: 30_000,
    feeRateAlertThresholdBps: 300, // warn if > 3%

    // Execution preferences
    allowMarketOrders: false,
    // Post-only = maker orders only = cheaper fees on Polymarket.
    postOnly: true,

    // Take-profit on high-priced outcome token regardless of time left.
    // Set to null — let trailing TP system handle exits instead of a fixed price ceiling.
    takeProfitPrice: null,

    // If true, manage exits for ALL open positions (even older tokenIDs), and do not enter until flat.
    manageAllPositions: true,

    // Kill-switch override: additional loss buffer after override (10% = allows 10% more loss)
    killSwitchOverrideBufferPct: 0.10,

    // Order lifecycle: timeout for pending orders (auto-cancel after this)
    orderTimeoutMs: 30_000,

    // Order retry: max attempts for CLOB order submission
    maxOrderRetries: 3,

    // Retry delays are hardcoded: [1000, 2000, 4000] ms (not env-configurable)

    // ── CRITICAL: Stop loss and risk management ──
    // Keep these explicit so live mode never depends on accidental paper inheritance.
    dynamicStopLossEnabled: true,
    dynamicStopLossPct: 0.30,        // 30% of position — loose stop for volatility, let winners ride
    minMaxLossUsd: 0,
    maxMaxLossUsd: 50,
    maxLossGraceEnabled: false,
    maxLossGraceSeconds: 0,
    maxLossRecoverUsd: null,
    maxLossGraceRequireModelSupport: false,
    stopLossGraceSec: 0,
  },

  // UI server settings
  uiPort: Number(process.env.UI_PORT) || 8080,
};

function cloneConfig(config) {
  return {
    ...config,
    kraken: { ...config.kraken },
    coinbase: { ...config.coinbase },
    polymarket: { ...config.polymarket },
    chainlink: { ...config.chainlink },
    paperTrading: { ...config.paperTrading },
    liveTrading: config.liveTrading ? { ...config.liveTrading } : null,
  };
}

export const CONFIG_15M = (() => {
  const config = cloneConfig(CONFIG);
  config.pollIntervalMs = 2_000;
  config.candleWindowMinutes = 15;
  config.vwapSlopeLookbackMinutes = 9;
  config.rsiPeriod = 14;
  config.rsiMaPeriod = 14;
  config.macdFast = 12;
  config.macdSlow = 26;
  config.macdSignal = 9;
  config.polymarket = {
    ...config.polymarket,
    seriesSlug: process.env.POLYMARKET_SERIES_SLUG_15M || 'btc-up-or-down-15m',
  };
  config.paperTrading = {
    ...config.paperTrading,
    enabled:
      (process.env.PAPER_TRADING_ENABLED_15M || 'true').toLowerCase() === 'true',
    exitBeforeEndMinutes: 2.0,
    noEntryFinalMinutes: 3.0,
    onlyEntryFinalMinutes: 0,  // disabled — price-asymmetry strategy, enter anytime
    minCheapEntryPrice: 0.15,  // 15m has more room for reversals, keep 15c floor
    maxCheapEntryPrice: 0.50,  // wider band for 15m — more time for reversals
    recGatingEnabled: true,    // only enter when signal engine says ENTER
    rsiBiasEnabled: true,      // align cheap side with momentum — works on 15m timeframe
    rsiBearishThreshold: 40,
    rsiBullishThreshold: 60,
    stopLossGraceSec: 60,
    lossCooldownMinutes: 15,
    dynamicStopLossPct: 0.15,
    maxSpread: 0.10,
  };
  return config;
})();

export function getConfigForTimeframe(timeframe = '5m') {
  return String(timeframe).toLowerCase() === '15m' ? CONFIG_15M : CONFIG;
}

export function buildTradingConfig(config, mode = 'paper', timeframe = '5m') {
  const normalizedMode = mode === 'live' ? 'live' : 'paper';
  if (normalizedMode === 'live') {
    return {
      ...config.paperTrading,
      ...config.liveTrading,
      _mode: 'live',
      timeframe,
    };
  }

  return {
    ...config.paperTrading,
    _mode: 'paper',
    ...(config.paperTrading.paperKillSwitchEnabled === false ? { maxDailyLossUsd: 0 } : {}),
    timeframe,
  };
}
