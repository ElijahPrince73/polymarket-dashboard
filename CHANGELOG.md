# Polymarket Dashboard — Changelog

## WEATHER TRADING

## 2026-03-20 — Weather v1.2: City Detail Pages + Live Position Fix

### City Detail Pages (`/weather/{city}`)
- **Clickable city navigation** throughout weather dashboard
- **Dedicated city pages** with comprehensive analytics:
  - City-specific performance stats (trades, WR, P&L, ROI, avg stake)
  - Live orders section for that city
  - Detailed trade history (winning vs losing trades)
  - Back navigation to main weather overview
- **Enhanced UX** with hover effects and intuitive linking
- **Deep dive analysis** to identify why certain cities perform better

### Live Position Data Overhaul
- **Hybrid API approach** combining Polymarket live data + database enrichment
- **Fixed position sync issues** - dashboard now shows all live orders from Polymarket
- **Eliminated "Unknown" fallbacks** for most positions by using database city/question data
- **Complete coverage** - shows every live order regardless of database status
- **13+ live orders displayed** instead of just 3 filled positions

### Database Independence Attempt
- Tried to eliminate database dependency entirely
- Found Polymarket market API limitations with order.market addresses
- Settled on hybrid: live orders from Polymarket + enriched details from database
- Added fallback handling for new orders not yet in database

### Technical Improvements  
- `/api/weather/live-positions` endpoint for real-time position data
- `/api/weather/sync-database` endpoint to reconcile database with live orders
- Frontend combining logic for positions + pending orders
- React Router city detail pages with parameter handling

---

## 2026-03-18 — Weather v1.1: High-Confidence Strategy

### Performance Tuning (Post-46 Trade Analysis)
- **46 total trades:** 25W/21L (54.3% WR), -$35.30 (-9.5% ROI)
- **City-specific performance** varies dramatically:
  - **Best:** Madrid (72% ROI), Miami (73% ROI), Chicago (59% ROI)
  - **Worst:** Wellington (-100%), Toronto (-100%), Singapore (-100%)

### High-Confidence Improvements
- **Raised edge requirements:** MIN_EDGE 15% → 25%, MIN_ABS_MODEL_DIFF 8% → 12%
- **Added model consensus requirement:** MIN_MODEL_CONSENSUS = 4 (need 4+ weather models agreeing)
- **City-specific confidence thresholds:**
  - TIER 1 (proven): Miami, Paris, London, Chicago, Dallas - 25% edge minimum
  - TIER 2 (marginal): Atlanta, NYC, Sao Paulo - 28% edge minimum  
  - TIER 3 (poor): Seoul, Wellington, Seattle - 35% edge minimum
  - TIER 4 (terrible): Toronto, Tokyo, Singapore - 40% edge minimum

### Strategy Philosophy
- **Extreme selectivity** until model proves itself consistently
- **Tiered risk controls** based on historical city performance
- **Access all cities** but with appropriate confidence barriers
- **Quality over quantity** - better to miss trades than take bad ones

### Expected Impact
- Win rate 46% → 60-65% through increased selectivity
- Turn negative ROI positive by avoiding low-conviction trades
- Maintain coverage across all cities with appropriate risk controls

---

## 2026-03-15 — Weather v1.0: Initial Launch

### Core Trading Engine
- **12 cities:** London, Dallas, Atlanta, NYC, Seoul, Chicago, Miami, Houston, Phoenix, Denver, LA, SF
- **Multi-model weather forecasting:** HRRR, NAM, ECMWF, GFS median blending
- **Normal CDF probability calculation** with EWMA calibration
- **Half-Kelly position sizing:** 1-8% of bankroll based on edge
- **$100 paper bankroll** for initial testing and model validation

### Risk Management
- **Daily exposure limit:** 15% of bankroll
- **Per-city exposure limit:** 6% of bankroll  
- **Daily drawdown stop:** 5%
- **Stop-loss:** 20% of position
- **Position switching:** Automatic reversal when edge flips >5%

### Data Infrastructure  
- **Supabase backend:** weather_trades + weather_calibration tables
- **30-minute tick cycle:** discover → monitor → resolve → report
- **Unified dashboard:** Express + React with real-time updates
- **Migration from SQLite** to cloud database for reliability

### Known Issues
- Model accuracy still being validated over time
- City-specific performance highly variable  
- Need more data to optimize confidence thresholds
- Position switching limited to same market (YES ↔ NO)

---

## BTC TRADING

## 2026-03-20 — v2.2: Live Trading Reliability Overhaul

### Critical Fixes — Exit Flow
- **Signal-based position marking** (`c27b813`) — LiveExecutor `markPositions` now uses real-time signal prices (`polyPricesCents.UP/DOWN` + `orderbook.bestBid`) instead of per-token CLOB orderbook fetches. The old approach returned null marks for expired/illiquid tokens → exit evaluator never triggered TP/SL → trades rode to settlement unmanaged.
- **Exit spam guard reduced** (`8fab12e`) — 30s → 5s cooldown between exit attempts. In 5-minute markets, 30s is an eternity. If the first SELL attempt failed, the bot couldn't retry before settlement.

### Critical Fixes — Entry Flow
- **FOK orders** (`7b813e8`) — Switched from GTC (Good-Til-Cancelled) to FOK (Fill-Or-Kill) for both entries and exits. GTC limit orders would sit on the book unfilled while the bot thought it was in a trade.
- **Fill verification** (`0d59050`) — After posting a FOK order, bot now waits up to 6s (1s + 2s + 3s retries) to confirm the position appears in CLOB `getTrades()`. Only creates structured trade record after fill is verified. Prevents phantom trades from unfilled orders.

### Critical Fixes — Auto-Heal
- **Auto-heal before position check** (`8e5e004`) — Moved settlement check to run BEFORE CLOB position matching, not inside the `else` branch. Settled trades now get healed immediately regardless of CLOB state.
- **Outcome-aware auto-heal** (`2d769b9`) — When auto-heal fires (market settled + 1 min), it now fetches the actual outcome from Polymarket gamma API. Calculates real PnL: Win = `shares × (1 - entry)`, Loss = `-contractSize`. No more $0 PnL auto-heals.

### Configuration
- **Paper trading disabled** (`5bd580a`) — Default flipped from paper to live. `PAPER_TRADING_ENABLED` defaults to `false`, `LIVE_TRADING_ENABLED` defaults to `true`. Environment vars can still override.
- **Version in health endpoint** (`cfd092c`) — `/api/health` now returns a `version` field for deploy verification.

### Data Cleanup
- Deleted 50+ phantom trades from Supabase (accumulated from unfilled GTC orders and $0 auto-heals)
- Backfilled 35 real live trades from CLOB history with correct outcomes and PnL
- Real live stats: 35 trades | 15W / 20L | 42.9% WR | -$2.02 PnL

### Root Cause Summary
The bot was placing limit orders (GTC), assuming they filled, creating trade records, then failing to exit because:
1. Mark prices came from per-token orderbook (returned null for illiquid/expired tokens)
2. No mark → no PnL → exit evaluator never triggered
3. Exit cooldown was 30s → couldn't retry before settlement
4. Auto-heal closed at $0 instead of determining actual outcome

Now: FOK entry → verify fill → signal-based PnL tracking → 5s exit retries → outcome-aware auto-heal as safety net.

## 2026-03-10 — v2.1: Data-Driven Trading Controls

## 2026-03-10 — v2.1: Data-Driven Trading Controls

### Deep Analysis (171-trade archive: `15pct-tp-open-filters-v1`)
- 35.3% WR, -$278.29, PF 0.77
- 65-75¢ entries were worst bucket: 20% WR, -$104
- 52 trades had CORRECT direction but lost to early SL
- 35% of losers went green (MFE > $1), 10 had MFE > $8
- DOWN much worse than UP: 31% WR/-$192 vs 40%/-$79
- Winners are fast: avg 18s hold, median 12s
- Best hours: 1 PM PST (69% WR), 8 AM (56%). Worst: overnight (0-29%)
- After a loss, only 34% chance of winning next trade

### New Features
- **Trading Hours** (`3c6b8e1`): 6 AM - 5 PM PST only. Overnight was -$200+
- **Escalating Loss Cooldown** (`b192d06`): 5 min after 1st loss, 10 after 2nd, 15 after 3rd, caps at 30 min. Resets on any win
- **SL Grace Period** (`3c6b8e1`): No stop loss for first 20s — fixes "direction right but lost"
- **Early Cut** (`3c6b8e1`): Exit if not green by 45s. Winners avg 18s; if not winning fast, cut

### Bug Fixes
- **Settlement timing fix** (`f4ad1be`): Slug epoch is market START, not settlement. Was filling settlement data 5 minutes early with wrong BTC price. All prior direction accuracy data was likely wrong.

### Config (as of `b192d06`)
- `tradingHoursEnabled: true` (6 AM - 5 PM PST)
- `lossCooldownEnabled: true`, `lossCooldownMinutes: 5` (escalates per consecutive loss)
- `stopLossGraceSec: 20`
- `earlyCutSec: 45`
- Entry thresholds tightened halfway: prob 0.54/0.55/0.56, edge 0.008/0.015/0.025
- `maxEntryPolyPrice: 0.75` (was 0.95)

### Known Issues
- Live mode trade display shows raw CLOB data (MAKER, CONFIRMED, Invalid Date). Paper display is correct.
- Historical direction accuracy data is unreliable due to settlement timing bug (now fixed going forward)

### Archived: `15pct-tp-open-filters-v1`
- 170 trades, 35.3% WR, -$278.29, PF 0.77

---

## 2026-03-09 — v2.0: R/R Fix + LLM Active Test

### The Big Fix
- **Take profit was 8%, not 15%** — config had `takeProfitPct: 0.08` which was getting read instead of the 0.15 in exitEvaluator. Average win was $6.61 vs average loss $13.75. Impossible to be profitable.
- Fixed: `takeProfitPct: 0.15` hardcoded in config.js
- Result: 18 trades post-fix, 50% WR, **+$19.01**. Avg win $11.44 vs avg loss $9.33.

### LLM Signal (Active → Shadow)
- Wired Claude Haiku as signal #8 in momentum model with weight 4 (heaviest)
- Upgraded prompt with 15-minute candle structure, support/resistance, momentum exhaustion
- **Result: LLM was useless** — 52% WR when agreeing with momentum, 56% when disagreeing
- Reverted to shadow mode. Still logging predictions for future evaluation.

### Entry Delay
- Bot now waits until 2.5 minutes left in market before entering
- LLM fires at 3 minutes left (2 min of price data before predicting)
- Entry window: 2:30 → 0:10 (force exit at 250s)

### Other Changes
- Stop loss ceiling raised: `maxMaxLossUsd` $12 → $50 (was capping all SLs to $12)
- Max drawdown disabled for paper trading
- Rec=NO_TRADE blocker: removed then restored (caused over-trading without it)
- Fixed Haiku model ID: `claude-haiku-4-5-20251001` (old 3.5 IDs retired)

### Archived: `llm-active-8pct-tp-v1`
- 87 trades, 54% WR, -$239.19, PF 0.57
- Avg win $6.61, avg loss $13.75 (R/R was 1:2 backwards)

---

## 2026-03-08 — v1.12: Kelly Sizing + LLM Shadow + Percentage-Based Exits

### Fractional Kelly Position Sizing
- Pure Kelly formula: `f = α × (2p − 1)` where α = 0.25 (quarter Kelly)
- 55% confidence → $25, 60% → $50, 65% → $75, 70% → $100, 80% → $150
- Clamped to [$25, $250] and [2%, 25%] of balance
- Replaces flat 8% stake

### Percentage-Based TP/SL
- All exit thresholds now percentage of position, not fixed dollar
- TP tiers: 15%/10%/5%/2% at time thresholds (later simplified to flat 15%)
- Dynamic SL: 20% of position (floor $3, ceiling $50)
- Scales naturally with Kelly — bigger positions, bigger absolute thresholds

### LLM Shadow Signal
- Claude Haiku (`claude-haiku-4-5-20251001`) predicts direction once per market
- ~$0.58/day estimated cost
- Cached per market slug, 5s timeout
- Stored in trade extraJson for offline analysis

### Max Drawdown Circuit Breaker
- 15% of starting balance (at $1000: trips at $850)
- Later disabled for paper trading

### UI Updates (React)
- Added: Trading Session, Kelly Size, Orderbook Imbalance, LLM Signal, Time Left
- Removed: RSI, Impulse, Range20, Entry Px, Opp Px, Edge, Prob gates (stale)

---

## 2026-03-07 — v1.11: Tiered Take Profit + $20 Stop Loss

### Data-Driven Tiered TP
- Simulated over 120 trades: +$794 vs settlement-only
- Winners peak at 234s, losers at 99s
- Tiers: $15+ immediately, $10+ after 60s, $5+ after 120s, $2+ after 180s, force exit at 250s
- Later converted to percentage-based

### $20 Stop Loss
- Zero false stops in 70-trade simulation
- Every trade hitting -$20 never recovered (18 stopped trades, 0 would have won)
- Turns -$244 into +$64 in simulation

### Entry Filters Opened Wide
- Stripped all 25+ filters
- Only 3 gates remain: one trade per market, no open position, valid data
- Momentum model trades freely

### Archived Versions
- `tiered-tp-no-sl-v1` — 72 trades, first test of tiered TP
- `tiered-tp-sl20-open-filters-v1` — 207 weekend trades, 60% WR but -$533

---

## 2026-03-06 — v1.10: Momentum Model + All-or-Nothing Test

### Momentum Model Deployed
- Replaces broken probability model (31% direction accuracy — actively harmful)
- 8 weighted signals: BTC spot 5s/15s/60s, Polymarket momentum 30s, price level, tick acceleration, orderbook imbalance, settlement trend
- Total weight: 18

### All-or-Nothing Mode
- No TP, no SL, ride every trade to settlement
- Killed time stop (loserMaxHoldSeconds) — was the #1 hidden profit killer
- Both-sides strategy tested and rejected (UP + DOWN > $1 due to vig)

### PnL Trajectory Tracking
- Samples every 2s during open trades
- Tracks: timesPositive, timePositiveSec, peakPnl, peakAtSec, pnlAtIntervals
- Key finding: 86% of trades go green (MFE ≥ $1), 50% hit +$20

### Archived: `momentum-all-or-nothing-v1` — 211 trades

---

## 2026-03-04 — v1.9: Tightened R/R + Trade Archive

### R/R Adjustments
- Stop $8 → $5, trailing start $3 → $5, fixed TP 5% → 6%
- Later: stop loss tightened 12% → 8%, trailing drawdowns widened 40%

### Trade Archive System
- `tradeArchive.js` — archive trades with version tag and stats
- API: `POST /archive`, `GET /archive/versions`, `GET /archive/trades/:version`
- Never lose historical data across config changes

### v1.0.7 Restored (and Failed)
- Rolled back to best historical config (PF 1.50)
- 107 trades, 27.1% WR, PF 0.56, -$211 — old model was broken

---

## 2026-03-03 — v1.8: One Trade Per Market + Small Balance Test

### One Trade Per Market
- Fixed: was re-entering same market after exit
- Changes across entryGate.js, TradingState.js, config.js

### Small Balance Test ($50)
- 15 trades, 46.7% WR, -$11.33
- Positions too small ($6-18), spread kills you
- Conclusion: minimum viable balance ~$200-500

### Balance Settled at $500, then $1000
- stakePct 35% → 20%, positions ~$100
- Proven sweet spot for paper trading

---

## 2026-02-26 — v1.5: Data-Driven Tuning

### 234-Trade Analysis
- v1.0.5: 46% WR, PF 0.97, -$19.60 (near breakeven)
- Trailing TP: 81% WR, +$599 — profit engine
- Max Loss: 0% WR, -$618 — the whole problem
- Entries < 40¢: 29% WR — raised floor

---

## 2026-02-25 — v1.0.4: Initial Profitability Fixes

### First Analysis (84 trades)
- DOWN trades more profitable
- Entries > 60¢ perform better
- Trailing TP is the profit engine (+$243 net)
- Max Loss is the problem (-$368 net)
- Trade duration avg 21 seconds

### Changes
- Trailing TP tightened: start $20 → $3, drawdown $10 → $1.50
- Dynamic stop loss: 20% → 12%, ceiling $40 → $20
- RSI overbought/oversold filter
- Probability thresholds raised
- Min entry price floor: 0.05 → 0.35
- MFE/MAE persistence bug fixed
- Balance/summary/dailyPnl syncs from Supabase on boot

---

## Hard-Won Lessons

1. **Stop loss saves 10x more than it costs** — most important feature
2. **TP must be ≥ SL percentage** — 8% TP with 20% SL = guaranteed loss regardless of WR
3. **Don't loosen all filters at once** — impossible to know what changed
4. **Trailing TP has $5-19 slippage on Polymarket** — fixed TP is better
5. **Time Stop was the #1 hidden profit killer** — 120s hold cut trades with +$15 MFE at -$5
6. **Old probability model was actively harmful** — 31% direction accuracy
7. **TP/SL must scale with position size** — fixed $ doesn't work with Kelly sizing
8. **Hardcode critical config values** — DO env vars silently override config.js
9. **Weekend data is unreliable** — wider spreads, thinner liquidity, different conditions
10. **One trade per market is essential** — multiple entries = giving back gains
11. **Minimum viable balance ~$200-500** — $50 doesn't work, spread kills tiny positions
12. **Don't churn config** — each change resets the dataset, need 100+ trades minimum
13. **Buying both sides = guaranteed loss** — UP + DOWN > $1 due to vig
14. **Profit protection > perfect entries** — 86% of trades go green, the problem is giving it back
15. **Chainlink aggregators rotate** — always resolve from proxy dynamically
16. **Supabase is source of truth** — local JSON ledger is ephemeral on DO
