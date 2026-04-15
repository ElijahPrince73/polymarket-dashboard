# BTC Trader — Clean Rewrite Spec

## Goal
Delete and rewrite the broken core trading files. Keep everything else intact.

## What Gets Deleted (btc/ directory, fresh start)
```
paper_trading/trader.js      — 1,355 lines of layered fixes
paper_trading/ledger.js      — 207 lines  
application/TradingEngine.js — 518 lines
application/TradingState.js  — 386 lines
live_trading/trader.js       — 800+ lines
live_trading/ledger.js
live_trading/positions.js
live_trading/pnl.js
live_trading/clob.js
infrastructure/executors/PaperExecutor.js
infrastructure/executors/LiveExecutor.js
infrastructure/recovery/stateManager.js
domain/entryGate.js
domain/exitEvaluator.js
domain/sizing.js
```

## What Stays (proven working)
- `boot.js` — thin startup wrapper, works fine
- `config.js` — settings, works fine
- `ui/server.js` + `ui/server15m.js` — routes, work fine
- `index.js` — main loop, works fine
- `data/` — all market feeds (polymarket, binance, chainlink, kraken, CLOB WS)
- `indicators/` — RSI, VWAP, MACD, Heiken Ashi
- `engines/` — momentum, probability, edge, regime, llmSignal, orderbookImbalance
- `services/` — polymarketService, settlementService, redeemService, analyticsService, etc.
- `infrastructure/persistence/supabaseTradeStore.js` — trade persistence, works
- `infrastructure/market/MarketCatalog.js`
- `infrastructure/orders/OrderManager.js`
- `infrastructure/alerts.js`, `webhookService.js`
- `lib/`, `scripts/`, `net/`, `utils.js`

## Core Trading State Machine (simplified)

```
States: IDLE → ENTER_CANDIDATE → OPEN → EXIT → IDLE
```

One rule governs everything: **one trade per market epoch. After exit, skip the rest of that epoch.**

---

## State: IDLE (no open trade)

Every tick:
1. Fetch signals (rec, indicators, poly prices, time left)
2. Check entry conditions (see below)
3. If ALL pass → transition to ENTER_CANDIDATE
4. If any fail → stay in IDLE, log blockers

## State: ENTER_CANDIDATE
1. Check: current market epoch must NOT equal the last exited epoch (skip rule)
2. Check: price is cheap (15c–45c)
3. If both pass → open trade, transition to OPEN
4. If price not cheap → stay ENTER_CANDIDATE (don't go back to IDLE check yet)

## State: OPEN (has open trade)
Every tick:
1. Evaluate exits (see below)
2. If any exit fires → close trade, transition to EXIT
3. If none → stay OPEN

## State: EXIT
1. Record trade (PnL, reason, timestamps)
2. Set skip epoch = current market epoch
3. Transition to IDLE

---

## Entry Conditions (all must pass in IDLE)
1. `tradingEnabled == true`
2. `!openTrade`
3. Time left > noEntryFinalMinutes threshold
4. Indicators warmed up (minCandlesForEntry candles)
5. Within trading hours (configurable, PST)
6. Not in skip (epoch check — see Skip Rule)
7. REC says ENTER or recGating is disabled (loose mode)
8. Phase allowed (config: allowedPhases, e.g. [EARLY, MID])
9. Price is cheap: UP or DOWN between minCheapEntryPrice and maxCheapEntryPrice
10. No open position in TradingState

## Skip Rule (Critical)
**ONE trade per market epoch. After ANY exit, skip remaining time in that epoch.**

On exit:
- `skipMarketUntilNextSlug = marketSlug`
- `skipEpoch = extract epoch from slug (last 10 digits)`

On entry check in IDLE:
- Extract epoch from current slug
- If `currentEpoch === skipEpoch && sameTimeframe` → BLOCK
- Clear skip when `nowSec >= skipEpoch + marketDuration` (i.e., market settled, 300s for 5m)

Cross-timeframe isolation: 5m skip blocks only 5m entries. 15m skip blocks only 15m.

## Exit Reasons (evaluate in OPEN state, any order)
1. **Market Rollover** — current slug ≠ trade's slug. Use trade's slug epoch to determine old market's close price.
2. **Max Loss** — `pnl <= -(contractSize × dynamicStopLossPct)`. Floor at minMaxLossUsd, cap at maxMaxLossUsd.
3. **Trailing TP** — track peak unrealized PnL. Exit if current pnl <= peak - trailPct.
4. **Pre-settlement** — timeLeft < exitBeforeEndMinutes.

## Position Pricing
- Entry: best ask (for UP) or best bid (for DOWN) from Polymarket orderbook
- Exit on rollover: `_lastCandleCloseByEpoch[tradeSlugEpoch]` as settlement proxy
- Exit on max loss / TP: current market mid price at tick

## Balance / Sizing
- Balance: fetched from executor each tick (PaperExecutor reads from ledger.json)
- Contract size: `min(balance * paperTrading.positionSizePct, maxPositionSize)`
- Shares: `contractSize / entryPrice`

## What NOT to include (remove complexity)
- Flip entries (disabled, broken)
- Loss/win cooldowns (didn't help)
- Max loss grace period (complexity, no evidence it helps)
- Quick stop (5s hard stop — cuts winners, no evidence it helps)
- Conditional stop loss (model flip, rarely fires)
- Time stop (cuts losers early, no evidence it helps)
- Circuit breaker (escalating cooldown — for live trading only)
- MDD breaker (for live trading only)
- Kill switch override (for live trading only)

## Configuration (from config.js, existing)
```js
paperTrading: {
  enabled: true,
  positionSizePct: 0.25,       // % of balance per trade
  maxPositionSize: 10,         // hard cap
  dynamicStopLossPct: 0.30,     // of contractSize
  minMaxLossUsd: 3,             // floor
  maxMaxLossUsd: 15,            // cap
  trailingTakeProfitEnabled: true,
  trailingTakeProfitPct: 0.20,  // exit if drawdown from peak ≥ 20%
  takeProfitImmediate: false,  // not used if trailing TP on
  minCheapEntryPrice: 0.15,    // 15c floor
  maxCheapEntryPrice: 0.45,    // 45c ceiling
  recGatingEnabled: false,      // loose mode (ENTER or no rec = allow)
  recGating: 'loose',          // loose = non-ENTER rec doesn't block
  allowedPhases: ['EARLY', 'MID'], // block LATE
  minCandlesForEntry: 30,
  noEntryFinalMinutes: 0.5,
  tradingHoursEnabled: true,
  tradingHoursStart: 6,        // PST
  tradingHoursEnd: 17,         // PST
  weekdaysOnly: false,
  exitBeforeEndMinutes: 0.5,   // pre-settlement exit
}
```

## File Structure After Rewrite

### application/TradingState.js
```js
class TradingState {
  openTrade: null | TradeObject
  skipMarketUntilNextSlug: null | string
  skipEpoch: null | number        // epoch we entered on (blocks re-entry)
  lastExitAtMs: null | number
  lastExitReason: null | string
  consecutiveLosses: 0
  todayRealizedPnl: 0
  startingBalance: null | number
  currentBalance: null | number
  
  // Methods
  recordEntry(trade)
  recordExit(pnl, reason, marketSlug)
  clearSkip()
  isSkipActive(currentEpoch, currentTimeframe) → boolean
  setBalance(balance)
}
```

### application/TradingEngine.js
```js
class TradingEngine {
  executor
  config
  state: TradingState
  tradingEnabled: false
  
  async initialize()
  async processSignals(signals, klines1m)
  
  // private
  _evaluateEntry(signals, klines1m) → 'enter' | 'wait' | 'block'
  _evaluateExits(signals) → exitReason | null
  _openPosition(signals, side, sizeUsd, price)
  _closePosition(reason, price)
}
```

### paper_trading/trader.js
```js
class PaperTrader {
  state: TradingState
  executor: PaperExecutor
  config
  tradingEnabled: true
  
  async processSignals(signals, klines1m)
  
  // Entry gate (simple, no nested conditions)
  _canEnter(signals) → { canEnter: bool, reason: string | null }
  _getSkipEpoch(signals) → number
  
  // Exit gate (simple)
  _shouldExit(signals) → { shouldExit: bool, reason: string | null }
  _getExitPrice(signals, side) → number
  
  // Helpers
  _computeContractSize(balance) → number
  _isSkipActive(currentEpoch) → boolean
  _setSkip(epoch, slug)
}
```

### paper_trading/ledger.js
```js
// Keep existing — reads/writes ledger.json
// addTrade(), updateTrade(), getOpenTrade(), getAllTrades()
// getBalance() → { balance, starting }
```

### infrastructure/executors/PaperExecutor.js
```js
class PaperExecutor {
  openTrade: null | TradeObject
  
  async initialize()
  async openPosition({ side, marketSlug, sizeUsd, price })
  async closePosition({ tradeId, side, shares, reason, exitPrice })
  async getOpenPositions()
  getBalanceSnapshot() → { balance, starting }
  getMode() → 'paper'
}
```

## Test Before Rewrite Considered Done
1. Bot can enter and exit a trade without errors
2. One trade per epoch — if rec fires again in same epoch, entry is blocked
3. Skip clears after 5 minutes (market settles)
4. Max loss fires when loss exceeds dynamic threshold
5. Market rollover uses old market's price for settlement
6. Balance updates correctly after each trade
7. No duplicate trades in same 5-minute window across deploys/restarts

## Rollback Plan
If this goes wrong, `git checkout main~1 -- packages/server/src/btc/` gets back to pre-rewrite state (commit ee49d31).
