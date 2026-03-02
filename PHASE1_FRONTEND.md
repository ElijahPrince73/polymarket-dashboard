# Phase 1 Frontend Rewrite

## API Endpoints Available

### GET /api/analytics/combined
Returns pre-computed metrics:
```json
{
  "combined": {
    "metrics": {
      "totalTrades": 414, "wins": 189, "losses": 225, "winRate": 45.65,
      "totalPnl": 89.27, "avgWin": 5.21, "avgLoss": -3.15, "profitFactor": 1.06,
      "maxDrawdown": 12.5, "longestWinStreak": 8, "longestLossStreak": 6,
      "avgRiskPerTrade": 2.1, "roi": 8.12, "equity": 1189.27
    },
    "equitySeries": [{ "date": "...", "equity": 1100, "pnl": 0, "drawdown": 0, "market": "start" }, ...],
    "todayPnl": 3.45,
    "totalExposurePct": 1.2
  },
  "bitcoin": { "metrics": {...}, "equitySeries": [...], "todayPnl": 2.50 },
  "weather": { "metrics": {...}, "equitySeries": [...], "todayPnl": 0.95 }
}
```

### GET /api/analytics/distributions
```json
{
  "pnlDistribution": {
    "all": { "buckets": {"< -$50": 5, "-$50 to -$20": 12, ...}, "mean": -0.21, "median": 0.50, "count": 414 },
    "bitcoin": {...},
    "weather": {...}
  },
  "hourly": {
    "all": [{ "hour": 0, "trades": 15, "winRate": 46.7, "pnl": -2.30 }, ...],
    "bitcoin": [...],
    "weather": [...]
  },
  "dayOfWeek": {
    "all": [{ "day": "Mon", "trades": 60, "winRate": 48.3, "pnl": 12.50 }, ...],
    "bitcoin": [...],
    "weather": [...]
  },
  "sizePerformance": [{ "stake": 10.50, "pnl": 2.30, "win": true, "market": "bitcoin" }, ...]
}
```

### Existing endpoints (unchanged)
- GET /api/btc/status → { success: true, data: { tradingEnabled, mode, balance, ledgerSummary, runtime, guardrails, killSwitch, openTrade, entryDebug, entryThresholds, status._uptimeS } }
- GET /api/btc/kill-switch/status → { success: true, data: { active, overrideActive, todayPnl, limit } }
- GET /api/btc/trades → { success: true, data: [...trades] }
- GET /api/btc/live/open-orders → { success: true, data: [...] }
- GET /api/weather/status → { tradingEnabled, tradingMode, bankroll, openTrades, uptime, lastTickAt }
- GET /api/weather/trades → [...trades with city, side, entry_price, status, result, pnl, resolved_at, created_at, question]
- GET /api/weather/summary → { daily: {...}, rolling: { trades, wins, losses, pnl, byCity: [...] } }

## Navigation (6 items with icons, sidebar desktop, bottom nav mobile)
1. 📊 Portfolio → / (portfolio overview)
2. ⚖️ Compare → /compare (market comparison)
3. ₿ Bitcoin → /btc (bitcoin deep dive — KEEP EXISTING, it's already good)
4. 🌤 Weather → /weather (weather deep dive — KEEP EXISTING, it's already good)
5. 📋 Trades → /trades (unified trade log)
6. 📈 Analytics → /analytics

## Pages to CREATE (new files)

### 1. src/pages/Portfolio.jsx (replaces Overview.jsx)
**Global Status Strip** — horizontal bar with pills:
- Mode (from BTC status), Trading ON/OFF, Kill Switch, Uptime (status._uptimeS formatted)

**Performance Hero** — big numbers:
- Total Equity (combined.metrics.equity) — BIG font
- Net P&L (combined.metrics.totalPnl) — green/red
- ROI % (combined.metrics.roi)
- Today's P&L (combined.todayPnl)
- Total Exposure (combined.totalExposurePct %)

**Equity Chart with Drawdown** — Recharts ComposedChart:
- TOP area: AreaChart of combined.equitySeries equity values
- BOTTOM area: Separate inverted AreaChart of drawdown values (red shaded)
- Use two charts stacked vertically (not overlaid)
- Market contribution: color-code data points by market (orange=btc, cyan=weather)

**Market Split Cards** — two horizontal cards side by side:
- Bitcoin: equity, net P&L, ROI, open positions, exposure
- Weather: equity, net P&L, ROI, open positions, exposure

**Risk Metrics Grid** — 6 stat cards:
- Max Drawdown %, Avg Win, Avg Loss, Profit Factor, Longest Losing Streak, Avg Risk/Trade

**Active Positions Combined** — list open positions from both markets grouped by market

**Recent Trades** — last 15 trades from both markets in unified table

### 2. src/pages/Compare.jsx (NEW)
**KPI Cards** — side-by-side comparison grid:
- 6 metrics: Equity, ROI %, Max Drawdown, Profit Factor, Win Rate, Exposure %
- Each metric has BTC value left, Weather value right, better one highlighted

**Equity Comparison Chart** — Recharts multi-line:
- Two lines: BTC (orange) and Weather (cyan)
- Timeframe selector (all time only for now)
- Normalized toggle: when ON, both start at 100% and show % return

**Drawdown Comparison** — two small area charts side by side, each showing drawdown curve

**PnL Distribution Comparison** — two bar charts side by side with same scale

### 3. src/pages/Trades.jsx (NEW — unified trade log)
**Unified Master Table** with columns:
- Market (badge: "BTC" orange or "Weather" cyan)
- Entry Time
- Exit Time
- Side (UP/DOWN for BTC, YES/NO for weather)
- Stake
- Entry Price
- Exit Price (BTC) or Result (Weather)
- P&L
- Exit Reason (BTC) or City (Weather)

Filters: Market (ALL/BTC/Weather), Result (ALL/WIN/LOSS), Side
Page sizes: 20/50/100/All
Sort by any column header

For weather trades: map fields appropriately:
- entryTime = created_at
- exitTime = resolved_at
- side = side (YES/NO)
- stake = stake_usd
- entryPrice = entry_price
- exitPrice = null (show "--")
- pnl = pnl
- exitReason = city name

### 4. src/pages/Analytics.jsx (NEW)
Tab-based layout with 4 tabs:

**Tab 1: Distribution & Edge**
- PnL Distribution Histogram (Recharts BarChart): buckets on X, count on Y
  - Color bars: green for positive buckets, red for negative
  - Vertical dashed lines for mean and median
  - Filter: ALL / Bitcoin / Weather toggle buttons
- Win/Loss Size comparison: two histograms or box-style display showing avg win vs avg loss

**Tab 2: Timing**
- Hour-of-Day Heatmap: 24 cells (0-23h), color intensity = win rate or PnL
  - Use a grid of colored cells, green for profitable hours, red for losing
  - Show PnL on hover
  - Filter: ALL / Bitcoin / Weather
- Day-of-Week Performance: 7 horizontal bars showing PnL per day
  - Color green/red based on positive/negative

**Tab 3: Trade Size**
- Scatter Plot: X = Stake, Y = PnL
  - Green dots for wins, red for losses
  - Filter: ALL / Bitcoin / Weather
- Win Rate by Size Bucket: small bar chart with size ranges

**Tab 4: Equity Curve**
- Cumulative PnL line chart (same as portfolio but with trade markers)
  - Dots on chart colored by market (orange/cyan)
  - Larger dots for trades with |pnl| > $20 (highlight big wins/losses)
  - Toggle: Combined / BTC Only / Weather Only
  - Normalized toggle

## Pages to KEEP (do not rewrite, they work)
- src/pages/Btc.jsx — KEEP AS-IS, it's good
- src/pages/Weather.jsx — KEEP AS-IS, it's good

## Pages to DELETE
- src/pages/Overview.jsx (replaced by Portfolio.jsx)

## Components to UPDATE

### src/components/Layout.jsx — REWRITE
- Sidebar: 6 nav items with icons (use emoji or simple SVG)
- Active item: emerald accent
- Desktop: sidebar always visible, ~60px wide with icons, expands to ~220px on hover showing labels
- Mobile (< 768px): hide sidebar, show bottom nav bar with 6 icons + labels

### src/hooks/useApi.js — KEEP AS-IS

## Design Rules
- Dark theme: slate-950 bg, slate-900 cards, slate-800 sidebar
- BTC color: orange-500 (charts, badges)
- Weather color: cyan-500 (charts, badges)
- Profit: emerald-400
- Loss: red-400
- All charts: dark backgrounds, grid lines #334155
- Responsive — all pages must work on mobile
- Never render objects as JSX children
