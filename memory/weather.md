# Weather Trading Bot — Project Memory

## Current Snapshot
- Dashboard: `/weather`
- City details: `/weather/{city}`
- Live positions endpoint: `/api/weather/live-positions`
- Sync endpoint: `/api/weather/sync-database`

## What was implemented recently

### 1) City detail pages
- Added route: `/weather/:city`
- Added new page component: `packages/client/src/pages/WeatherCity.jsx`
- Made city names clickable from weather overview and live orders cards.

### 2) Live positions display fix
- Problem: dashboard showed only partial live data / stale DB status.
- Fix: combined live orders + filled positions so UI matches Polymarket behavior.
- Added status labels and normalized display fields.

### 3) Data enrichment behavior
- Live orders are sourced from Polymarket.
- City/question metadata is enriched from DB when available.
- Unknown values appear only when metadata is missing.

## Known constraints
- Pure market-address lookup via Gamma market endpoint was unreliable for some IDs.
- Hybrid approach (live orders + DB enrichment) is currently the most stable path.

## Key files touched
- `packages/server/src/weather/boot.js`
- `packages/client/src/pages/Weather.jsx`
- `packages/client/src/pages/WeatherCity.jsx`
- `packages/client/src/App.jsx`
- `CHANGELOG-weather.md`

## Next checks if data looks off
1. Compare `/api/weather/open-orders` vs `/api/weather/live-positions`
2. Confirm DB has matching `order_id` records for enrichment fields
3. Verify frontend is reading combined live arrays (filled + pending)
4. Hard-refresh client after deploy
