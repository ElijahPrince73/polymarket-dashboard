# Polymarket Dashboard

A unified monorepo combining two Polymarket trading bots with a React dashboard for monitoring and control.

**Live:** https://polymarket-dashboard-ip4ea.ondigitalocean.app

## Bots

### BTC 5-Minute Trader
Automated trading bot for Polymarket's 5-minute BTC price prediction markets. Predicts whether BTC will be higher or lower in 5 minutes and trades binary options.

**Architecture:**
- **Momentum model** with 8 weighted signals: BTC spot deltas (5s/15s/60s), Polymarket price momentum, price level, tick acceleration, orderbook imbalance, settlement trend
- **Fractional Kelly sizing** — position size scales with model confidence (quarter Kelly, α=0.25)
- **Percentage-based exits** — 15% take profit, 20% stop loss, 250s force exit (all scale with position size)
- **Entry delay** — waits until 2.5 minutes left in market for direction to establish

**Key Files:**
```
packages/server/src/btc/
├── engines/
│   ├── momentum.js          # 8-signal momentum scoring model
│   ├── orderbookImbalance.js # Polymarket orderbook analysis
│   └── edge.js              # Edge-based entry decisions
├── domain/
│   ├── entryGate.js         # Entry validation (23 gates)
│   └── exitEvaluator.js     # Exit logic (TP/SL/force exit)
├── application/
│   ├── TradingEngine.js     # Core orchestration + trajectory tracking
│   └── TradingState.js      # Balance, daily P&L, state management
├── paper_trading/
│   └── trader.js            # Paper trade execution + Kelly sizing
├── infrastructure/
│   └── persistence/
│       └── tradeArchive.js  # Version-tagged trade archiving
├── config.js                # All configuration (hardcoded, no env overrides for critical values)
├── index.js                 # Main tick loop, signal aggregation
└── boot.js                  # Auto-start, quiet mode
```

### Weather Bot
Temperature prediction bot for 30+ cities worldwide. Uses multi-model blending (HRRR, NAM, ECMWF, GFS) with multinomial bucket normalization and fractional Kelly sizing.

**Strategy:**
- **YES-first approach** — find buckets containing forecast temperature, buy YES if underpriced
- **NO bets** only on extreme mispricings (>25% edge) on far-from-forecast buckets  
- **Multi-model blending** — HRRR/NAM (short-range), ECMWF/GFS/ICON (global), JMA (Asia), with 3°C forecast uncertainty
- **Multinomial normalization** — proper probability distribution across all market buckets
- **Fractional Kelly sizing** — position size scales with edge (4% max bankroll per trade)

**Cities:** London, Dallas, Atlanta, NYC, Seoul, Chicago, Miami, Houston, Phoenix, Denver, LA, SF, Seattle, Minneapolis, Portland, Nashville, Detroit, Las Vegas, Austin, Paris, Berlin, Madrid, Tokyo, Mumbai, Bangkok, Singapore, Sydney, Wellington, Toronto, São Paulo, Mexico City

**Key Features:**
- **Paper/Live mode separation** — independent trading histories and bankroll tracking
- **Real-time position tracking** — separate "Open Positions" (filled shares) vs "Pending Orders" (on book)
- **Smart order management** — uses live CLOB data to show accurate fill status
- **Risk management** — daily exposure limits (25%), per-city caps (4%), stop-loss on 5% drawdown

## Tech Stack

- **Frontend:** React 19 + Vite + Tailwind CSS v4 + Recharts
- **Backend:** Express 5 + Node.js ESM
- **Database:** Supabase (PostgreSQL)
- **Deployment:** DigitalOcean App Platform (auto-deploy from main)
- **Price Feed:** Chainlink BTC/USD via Polygon WebSocket

## Pages

| Page | Description |
|------|-------------|
| Portfolio | Combined P&L overview |
| Compare | Side-by-side bot comparison |
| Bitcoin | Live BTC trading dashboard with gate status, signals, P&L |
| Weather | Weather bot monitoring and control |
| Trades | Full trade history with filters |
| Analytics | Performance charts and distribution analysis |

## Development

```bash
# Install all workspaces
npm install --workspaces

# Run dev (client + server)
npm run dev

# Build for production
npm run build

# Start production server
npm start
```

## API

**BTC:** `/api/btc/*` — status, trades, analytics, config, trading start/stop, archive
**Weather:** `/api/weather/*` — status, trades, calibration, tick
**Health:** `/api/health` — combined health check for both bots

## Configuration

Critical trading parameters are hardcoded in `packages/server/src/btc/config.js` to prevent env var overrides from silently changing behavior. Key settings:

| Parameter | Value | Description |
|-----------|-------|-------------|
| `takeProfitPct` | 0.15 | 15% of position |
| `dynamicStopLossPct` | 0.20 | 20% of position |
| `kellyFraction` | 0.25 | Quarter Kelly sizing |
| `onlyEntryFinalMinutes` | 2.5 | Wait until halfway through market |
| `oneTradePerMarket` | true | No doubling down |
| `weekendTighteningEnabled` | false | Disabled for paper data collection |

## Trade Archive

Historical trades are preserved across config changes with version tagging:

```bash
# Archive current trades
POST /api/btc/archive { "version": "v1.2-test", "note": "description" }

# List versions
GET /api/btc/archive/versions

# Retrieve archived trades
GET /api/btc/archive/trades/:version
```

## Environment Variables

**Required:** `PRIVATE_KEY`, `CLOB_API_KEY`, `CLOB_SECRET`, `CLOB_PASSPHRASE`, `CLOB_HOST`, `CHAIN_ID`, `SIGNATURE_TYPE`, `FUNDER_ADDRESS`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `POLYGON_WSS_URLS`

**Optional:** `AUTO_START_TRADING` (default: true)

## License

Private — not for distribution.
