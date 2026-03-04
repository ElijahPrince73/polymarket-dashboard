# Weather Bot Changelog

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
