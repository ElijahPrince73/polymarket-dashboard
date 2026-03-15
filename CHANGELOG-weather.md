# Weather Bot Changelog

## 2026-03-15 — v4: UI/UX Improvements + Data Accuracy

### Trading Mode Separation
- **Fixed mode toggle** — paper/live switch now actually changes trading behavior at runtime
- Added `trading_mode` column to database — paper and live trades fully separated
- Clean slate when switching modes — no more paper data bleeding into live view

### Position vs Order Clarity  
- **Replaced confusing "3/5" displays** with clear "Open Positions" and "Pending Orders" sections
- **Open Positions:** Actual shares owned (real market exposure)
- **Pending Orders:** Orders sitting on book (just reserving collateral)
- Fixed data sync issue — now uses live Polymarket order data as truth instead of stale database values

### UI Improvements
- Removed useless uPnL display (was always $0.00)
- Clean position cards: shares, city, side, price, date
- Separate stat cards for positions vs pending orders
- Much clearer understanding of actual vs potential exposure

### Technical Changes
- Added `/api/weather/open-orders` endpoint for live order status
- Enhanced `/api/weather/trades` with computed `actualPosition`, `pendingOrderSize`, `orderStillActive` fields
- `enrichTradesWithOpenOrders()` function cross-references database with live CLOB data
- Uses `size_matched` from live orders instead of database `fill_size`

## 2026-03-06 — v3: YES-First Strategy

### Problem with v2
- 15 trades: 7W/8L, -$12.81, 47% WR
- 20%+ edge bucket: 60% WR, -7% ROI (close to breakeven)
- 10-20% edge bucket: 20% WR, -50% ROI (disaster)
- Still mostly betting NO on off-center buckets — bad payoff asymmetry

### Fix: Flip to YES-First
- **Core change:** Find the bucket that CONTAINS the forecast temperature, buy YES if underpriced
- Payoff comparison: YES at $0.15 → $1.00 = 567% return vs NO at $0.60 → $1.00 = 67%
- Forecast bucket detection uses ±1.5°C containment, not highest model probability
- NO bets only for extreme mispricings (>25% edge on far-from-forecast buckets)
- MIN_EDGE: 8% → 15% (kills the bad 10-20% edge trades)
- Tick interval: 30min → 10min (catch opportunities faster)
- Data wiped for clean start

## 2026-03-04 — Model Rebuild (v2.0)

### Problem
- 22 trades: 11W/11L (50% WR), -$25.42 PnL, -18.7% ROI
- Model was claiming 20-40% edge on every trade — all phantom
- Root cause: computing bucket probabilities independently with continuous CDF
- F-range buckets (80-81°F = 0.56°C wide) got near-zero prob, creating fake NO edge
- sigma=1.5 was too tight — model overconfident in forecast precision

### Fix: Multinomial Bucket Normalization
- **New approach:** compute CDF probability for ALL buckets in an event, then normalize so they sum to 1
- This gives proper multinomial distribution across market buckets
- sigma: 1.5 → 3.0 (matches real forecast error)
- MIN_BUCKET_PROB: 5% floor (no bucket below 5%)
- MIN_EDGE: 3% → 8% (only trade with real conviction)
- Kelly max: 8% → 4% (smaller positions)
- Multi-model blending: now fetches 3-day forecast (works for tomorrow's markets)
- Data reset: clean slate

### Also Fixed
- Resolver: neg-risk grouped events now resolve properly (outcome prices >= 0.95 as signal)

## 2026-02-28 — Live CLOB Integration
- Added @polymarket/clob-client for real order placement
- Paper/Live mode toggle, kill switch
- Same wallet as BTC bot

## 2026-02-27 — Initial Build
- Full rewrite from Python+Notion to Node ESM
- SQLite → later migrated to Supabase
- 12 cities, multi-model blending, Kelly sizing
- Express dashboard with dark theme
