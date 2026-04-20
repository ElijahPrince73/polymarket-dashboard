# Polymarket Dashboard — Unified Monorepo

## Overview
Monorepo combining two Polymarket trading bots with a React dashboard:
- **BTC 5-Min Trader** — momentum-based direction prediction for 5-minute BTC markets
- **Weather Bot** — temperature prediction across 12 cities

**Live:** https://polymarket-dashboard-ip4ea.ondigitalocean.app

## Architecture

```
packages/
├── client/                    # React 19 + Vite + Tailwind v4 + Recharts
│   └── src/
│       ├── pages/
│       │   ├── Btc.jsx        # Main BTC dashboard (gate status, signals, P&L)
│       │   ├── Trades.jsx     # Trade history table
│       │   └── Analytics.jsx  # Performance charts
│       ├── hooks/useApi.js    # Fetch hook (5s poll, no loading flash)
│       └── api/               # Fetch wrappers for /api/*
├── server/
│   └── src/
│       ├── index.js           # Express app, mounts routes, serves static
│       ├── btc/
│       │   ├── index.js       # Main tick loop (~1s), signal aggregation
│       │   ├── boot.js        # Auto-start trading, quiet mode
│       │   ├── config.js      # ALL config (hardcoded critical values)
│       │   ├── engines/
│       │   │   ├── momentum.js          # 8-signal weighted model (primary)
│       │   │   ├── orderbookImbalance.js # Polymarket orderbook
│       │   │   └── edge.js              # Edge-based entry decisions
│       │   ├── domain/
│       │   │   ├── entryGate.js         # Entry validation gates
│       │   │   └── exitEvaluator.js     # TP/SL/force exit logic
│       │   ├── application/
│       │   │   ├── TradingEngine.js     # Core orchestration
│       │   │   └── TradingState.js      # Balance + state management
│       │   ├── paper_trading/
│       │   │   └── trader.js            # Paper execution + Kelly sizing
│       │   └── infrastructure/
│       │       └── persistence/
│       │           └── tradeArchive.js  # Version-tagged archiving
│       └── weather/                     # Weather bot (Supabase)
└── shared/
```

## Tech Stack
- **Frontend:** React 19, Vite, React Router v7, Tailwind CSS v4, Recharts
- **Backend:** Express 5, Node.js ESM
- **Database:** Supabase (PostgreSQL) — source of truth for both bots
- **Price Feed:** Chainlink BTC/USD via Polygon WebSocket
- **Deploy:** DigitalOcean App Platform, auto-deploy from main

## Current BTC Trading Config (v2.0)

| Parameter | Value | Notes |
|-----------|-------|-------|
| Model | Momentum (8 signals) | BTC spot 5s/15s/60s, Poly momentum/level, tick accel, orderbook, settlement |
| Position Sizing | Quarter Kelly (α=0.25) | 55%→$25, 60%→$50, 65%→$75, 70%→$100, 80%→$150 |
| Take Profit | 15% of position | Hardcoded, no env override |
| Stop Loss | 20% of position | Dynamic, floor $3, ceiling $50 |
| Force Exit | 250 seconds | Don't ride losses to settlement |
| Entry Delay | 2.5 min left | Wait for direction to establish |
| Entry Filters | Minimal | One trade/market, no open position, valid data |
| Starting Balance | $1,000 (paper) | Kelly sizes positions from this |

## Key Rules

### DO NOT
- Override critical config via env vars (hardcode in config.js)
- Trade multiple times in the same 5-minute market
- Use trailing TP (Polymarket has $5-19 slippage)
- Trust weekend data (wider spreads, thinner liquidity)
- Churn config — need 100+ trades to evaluate changes

### ALWAYS
- Archive trades before config changes (`POST /api/btc/archive`)
- Hardcode critical values in config.js
- Co-author commits: `Co-Authored-By: Claude Opus 4 <noreply@anthropic.com>`
- Check that TP% ≥ SL% (otherwise guaranteed loss at any WR)
- Resolve Chainlink aggregator dynamically from proxy

## API Routes

### BTC (`/api/btc/*`)
- `GET /status` — current state, signals, gate status
- `GET /trades` — trade history from Supabase
- `POST /trading/start` / `/trading/stop` — enable/disable
- `POST /archive` — archive trades with version tag
- `GET /archive/versions` — list archived versions
- `GET /archive/trades/:version` — retrieve archived trades
- `GET /config/current` — current config values

### Weather (`/api/weather/*`)
- `GET /status` — bot state, active positions
- `GET /trades` — trade history
- `POST /trading/start` / `/trading/stop`
- `POST /tick` — manual tick trigger

### System
- `GET /api/health` — combined health check
- `GET /api/analytics/combined` — cross-bot analytics

## Development

```bash
npm install --workspaces    # Install all
npm run dev                 # Dev mode (client + server)
npm run build               # Production build
npm start                   # Production server on :4000
```

## Deploy
DO App Platform auto-deploys from `main`:
```
Build: npm install --workspaces && npm run build
Run:   npm start
```

Required env vars: `PRIVATE_KEY`, `CLOB_API_KEY`, `CLOB_SECRET`, `CLOB_PASSPHRASE`, `CLOB_HOST`, `CHAIN_ID`, `SIGNATURE_TYPE`, `FUNDER_ADDRESS`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `POLYGON_WSS_URLS`


## Code Style
- ESM imports (`import`/`export`)
- Functional React with hooks
- Consistent JSON responses: `{ ok: true, data }` or `{ ok: false, error: { message } }`
- Commit convention: `type(scope): description`
