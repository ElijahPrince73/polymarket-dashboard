# Weather Trading — Changelog

## 2026-03-26 — Weather v2.0: Major Integration + Test Suite

### Strategy Overhaul (March 20-26)
Multiple strategy iterations tested during this period:
1. **Old edge-based** (25% min edge, city tiers) → too restrictive, few trades
2. **Forecast bucket YES** (best single bucket) → 7.7% WR, picked wrong market types
3. **Inequality YES** (>60% model confidence) → no qualifying markets, tails too expensive
4. **NO on tails** (bet against extremes) → 100% WR but $0.13/trade, unsustainable risk
5. **Current: YES on range buckets** (top 3 near forecast, 5-50¢) → paper testing

### Airport Station Coordinates (High Impact Fix)
- Polymarket markets resolve on airport stations, not city centers
- **NYC: KJFK → KLGA (LaGuardia)** — was forecasting for the wrong station entirely
- Updated 14 cities: Paris, Tokyo, Toronto, Singapore, Sao Paulo, Wellington, Berlin, Madrid, Mumbai, Bangkok, Sydney, Mexico City
- Difference between city center and airport can be 3-8°F — critical for 2°F range buckets

### METAR Real-Time Observations
- New `fetchMetar(station)` fetches live airport weather from aviationweather.gov
- Free API, no key required
- Blended into forecasts with 2:1 weight (observation vs model) for same-day markets
- Significantly improves accuracy when trading today's markets

### Dynamic Sigma Per City
- Replaced static FORECAST_SIGMA=3 with per-city defaults
- US cities (°F): σ=2.0 | International cities (°C): σ=1.2
- Calibration table can override per-city for learned accuracy
- Added `unit` field ("F"/"C") to every city in config

### Slippage Filter
- MAX_SLIPPAGE=0.05 — skips markets where bid-ask spread exceeds 5%
- Prevents entering on illiquid markets with poor execution prices

### Test Suite (27 tests, all passing)
- **vitest** framework (ESM compatible)
- `config.test.js` — city fields, ICAO codes, coordinates, units
- `utils.test.js` — parseRangeC, parseInequalityC, normalCdf, detectMarketType
- `trader.test.js` — Kelly sizing, nextDay, price filters, sigma selection, slippage
- `discovery.test.js` — fetchMetar, forecastHourlyBlended, clobPrice
- `resolver.test.js` — PnL calculations, paper vs live trade resolution
- Run: `cd packages/server && npm test`

### Other Fixes (March 20-26)
- Fixed @heroicons/react missing dependency (inline SVG)
- Fixed live-positions enrichment (condition_id fallback)
- Restricted trading to next-day markets only
- Removed stop-loss (Half-Kelly handles downside)
- Disabled monitor (was fighting NO-on-tails strategy)
- Fixed dedup at question level (prevented duplicate trades)
- Fixed resolver for paper trades (no order_id required)
- Added paper trades section to dashboard UI
- Added /reset-trades and /dedup-trades endpoints
- Daily stop bypass for strategy transition days

### Reference
- Inspired by: https://github.com/alteregoeth-ai/weatherbot
- Key insight: airport coordinates and METAR observations

---

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

## Key Lessons Learned

### Technical Architecture
- **Hybrid APIs work better than pure approaches** - live data + enriched metadata
- **Database dependency challenging to eliminate** due to Polymarket API limitations
- **UI should match user mental model** - Polymarket shows all live orders as "positions"
- **City-level analytics enable better decision making** - can identify failure patterns

### Trading Strategy
- **City performance varies dramatically** - tiered approach better than blacklisting
- **Model consensus requirements** prevent low-confidence trades
- **Extreme selectivity improves win rate** - quality over quantity
- **Position switching works** but limited to same market (could enhance for cross-market)

### Data & Sync Issues
- **Database sync critical** - live orders must match database state
- **Live position display complex** - need to reconcile multiple data sources
- **Order status tracking** - pending vs filled vs resolved states need clear handling
- **Market resolution timing** - settlement detection requires careful implementation