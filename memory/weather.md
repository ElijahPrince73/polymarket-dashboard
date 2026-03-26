# Weather Trading Bot — Project Memory

## Current Status (March 26, 2026)
- **Strategy:** v2.0 Range Bucket YES — paper trading
- **Bankroll:** ~$211
- **Mode:** Paper (switched from live during strategy iterations)

## Current Strategy
- Buy YES on top 3 range buckets closest to forecast temp
- Price band: 5-50¢ | Model prob floor: >15% | Kelly capped at 6%
- Tomorrow-only markets | Monitor disabled | No stop-loss

## v2.0 Integration (March 26)
Integrated features from alteregoeth-ai/weatherbot:
1. **Airport coordinates** — 14 cities fixed (NYC was KJFK→KLGA, Paris/Tokyo/Toronto/etc.)
2. **METAR observations** — live airport weather from aviationweather.gov
3. **Dynamic sigma** — σ=2.0°F (US), σ=1.2°C (international), calibration table override
4. **Slippage filter** — MAX_SLIPPAGE=0.05, skip wide-spread markets
5. **Unit field** — every city has "F" or "C"

## Test Suite
- 27 tests across 5 files (vitest)
- Run: `cd packages/server && npm test`
- config, utils, trader, discovery, resolver all covered

## Key Files
- `packages/server/src/weather/config.js` — cities, coordinates, sigma, slippage
- `packages/server/src/weather/services/trader.js` — range bucket strategy
- `packages/server/src/weather/services/discovery.js` — forecasts + METAR
- `packages/server/src/weather/services/resolver.js` — trade resolution
- `packages/server/src/weather/services/monitor.js` — DISABLED (empty passthrough)
- `packages/server/src/weather/services/exchange.js` — Polymarket CLOB orders
- `packages/server/src/weather/db.js` — Supabase layer
- `packages/server/tests/weather/` — test suite

## API Endpoints
- `/api/weather/status` — bot status, mode, bankroll
- `/api/weather/trades` — all trades
- `/api/weather/live-positions` — Polymarket orders + DB enrichment
- `/api/weather/tick` — force a tick cycle
- `/api/weather/mode` — switch paper/live
- `/api/weather/kill` — cancel all open orders + mark SKIP
- `/api/weather/reset-trades` — delete all non-OPEN trades
- `/api/weather/dedup-trades` — remove duplicate entries

## Strategy History
1. Edge-based (v1.0-1.2) → too restrictive, few trades
2. Forecast bucket YES → 7.7% WR, wrong market types (inequalities not ranges)
3. Inequality YES → no markets qualify (tails priced at 95-100¢)
4. NO on tails → 100% WR but $0.13/trade, unsustainable
5. **Range bucket YES (current)** → paper testing with v2.0 accuracy improvements

## Lessons Learned
- Airport coordinates matter: 3-8°F difference from city center
- Static sigma=3 was too high — real forecast error is 1-2°F
- METAR ground truth beats model predictions for same-day
- Stop-loss doesn't work on cheap discrete-price markets (jumps over trigger)
- Monitor switch logic was fighting NO-side positions (model_prob interpretation)
- Dedup must be at question level, not just city+date
- Resolver must allow paper trades without order_id
- Always check slippage before entering
