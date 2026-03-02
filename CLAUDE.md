# Polymarket Dashboard — Unified Monorepo

## Overview
This is a monorepo combining two existing Polymarket trading bots into a single React + Express application:
- **BTC 5-Min Trader** — high-frequency BTC price prediction bot (existing repo: `~/Dev/polymarket-btc-5m-assistant`)
- **Weather Bot** — temperature prediction bot across 12 cities (existing repo: `~/Dev/polymarket-weather-bot`)

## Architecture

```
packages/
├── client/          # React + Vite frontend
│   ├── src/
│   │   ├── main.jsx
│   │   ├── App.jsx           # Router + layout
│   │   ├── api/
│   │   │   ├── btc.js        # fetch wrappers for /api/btc/*
│   │   │   └── weather.js    # fetch wrappers for /api/weather/*
│   │   ├── hooks/
│   │   │   └── useApi.js     # generic fetch hook with loading/error
│   │   ├── components/
│   │   │   ├── Layout.jsx    # sidebar nav + main content area
│   │   │   ├── StatusBadge.jsx
│   │   │   ├── TradeTable.jsx
│   │   │   └── StatCard.jsx
│   │   └── pages/
│   │       ├── Overview.jsx      # combined P&L summary
│   │       ├── BtcDashboard.jsx  # replicate existing BTC dashboard
│   │       ├── BtcTrades.jsx     # trade history table
│   │       ├── BtcAnalytics.jsx  # analytics charts
│   │       ├── WeatherDashboard.jsx  # replicate existing weather dashboard
│   │       └── WeatherTrades.jsx     # weather trade history
│   └── package.json
├── server/          # Unified Express backend
│   ├── src/
│   │   ├── index.js          # Express app, mounts route groups
│   │   ├── routes/
│   │   │   ├── btc.js        # Router mounting all BTC endpoints under /api/btc
│   │   │   └── weather.js    # Router mounting all weather endpoints under /api/weather
│   │   └── middleware/
│   │       └── errorHandler.js
│   └── package.json
└── shared/          # Shared utilities (optional, for later)
    └── package.json
```

## Tech Stack
- **Frontend:** React 19, Vite, React Router v7, Tailwind CSS v4, Recharts
- **Backend:** Express 5, Node.js ESM
- **BTC persistence:** Supabase (PostgreSQL) — existing
- **Weather persistence:** SQLite (better-sqlite3) — existing

## Key Rules

### Backend Strategy
The backend is a **thin proxy layer**. Do NOT rewrite any trading logic.

1. Import existing service modules directly from the source repos using relative paths initially
2. Mount BTC routes at `/api/btc/*` and weather routes at `/api/weather/*`
3. Add `/api/health` for combined health check
4. The server should:
   - For BTC: Initialize the trading engine (import from btc-5m-assistant src)
   - For Weather: Initialize the tick loop (import from weather-bot src)

For MVP, the server files in `packages/server/src/routes/` should contain Express Router instances that replicate the endpoint logic from the original servers, importing services from the original project directories.

### Frontend Strategy
1. Use Tailwind for styling — dark theme, clean dashboard look
2. Use Recharts for any charts (P&L over time, trade distribution)
3. React Router for page navigation with sidebar layout
4. API calls go through `packages/client/src/api/` modules
5. Vite dev server proxies `/api` to Express backend

### API Route Mapping

**BTC routes (mount at `/api/btc`):**
- GET /status
- GET /trades
- GET /analytics
- POST /backtest
- GET /live/trades
- GET /live/open-orders
- GET /live/positions
- GET /live/analytics
- GET /markets
- GET /portfolio
- GET /orders
- DELETE /orders/:id
- GET /metrics
- GET /diagnostics
- POST /optimizer
- POST /config
- POST /config/revert
- GET /config/current
- GET /suggestions
- POST /suggestions/apply
- GET /suggestions/tracking
- GET /kill-switch/status
- POST /kill-switch/override
- POST /trading/start
- POST /trading/stop
- POST /trading/kill
- GET /trading/status
- POST /mode

**Weather routes (mount at `/api/weather`):**
- GET /status
- GET /trades
- GET /trades/:id
- GET /summary
- GET /calibration
- POST /tick
- POST /mode
- POST /kill

### Code Style
- ESM imports (`import`/`export`)
- Functional React components with hooks
- No class components
- Consistent JSON responses: `{ ok: true, data }` or `{ ok: false, error: { message } }`
- Handle errors in every route with try/catch

### Commit Convention
```
type(scope): description

Co-Authored-By: Claude Opus 4 <noreply@anthropic.com>
```
