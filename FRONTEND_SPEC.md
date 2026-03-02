# Frontend Rewrite Spec

## API Response Shapes (EXACT — use these field names)

### GET /api/btc/status → { success: true, data: { ... } }
```
data.status.ok (boolean)
data.status._uptimeS (number, seconds)
data.mode ("LIVE" | "PAPER")
data.tradingEnabled (boolean)
data.killSwitch — NOT in this response, use /api/btc/kill-switch/status
data.ledgerSummary.totalTrades (number)
data.ledgerSummary.wins (number)
data.ledgerSummary.losses (number)
data.ledgerSummary.totalPnL (number)
data.ledgerSummary.winRate (number, e.g. 45.52)
data.balance.starting (number)
data.balance.realized (number)
data.balance.balance (number, total equity)
```

### GET /api/btc/kill-switch/status → { success: true, data: { ... } }
```
data.active (boolean)
data.overrideActive (boolean)
data.todayPnl (number)
data.limit (number)
```

### GET /api/btc/trades → { success: true, data: [...] }
Each trade:
```
id, timestamp, status, side ("UP"|"DOWN"), entryPrice, exitPrice,
shares, contractSize, pnl, entryTime, exitTime, exitReason,
entryPhase, instrument
```

### GET /api/btc/live/open-orders → { success: true, data: [...] }
Array of open orders (may be empty).

### POST /api/btc/trading/start → starts trading
### POST /api/btc/trading/stop → stops trading
### POST /api/btc/mode → { mode: "paper" | "live" } — switch mode

### GET /api/weather/status
```
tradingEnabled (boolean)
tradingMode ("paper"|"live")
bankroll (number)
liveBalance (number|null)
openTrades (number)
uptime (number, seconds)
lastTickAt (string|null)
```

### GET /api/weather/trades → array of trades
```
id, city, station, question, market_url, event_date, side ("YES"|"NO"|null),
entry_price, model_prob, edge, size_pct, stake_usd, status ("OPEN"|"SKIP"|"SWITCHED"|"STOP"|"RESOLVED"),
result ("PENDING"|"WIN"|"LOSS"), pnl, notes, token_id, order_id, resolved_at, created_at
```

### GET /api/weather/summary → { daily: {...}, rolling: {...} }
```
daily.trades, daily.byCity
rolling.windowDays, rolling.trades, rolling.wins, rolling.losses, rolling.pnl, rolling.byCity
```

### POST /api/weather/tick — trigger manual tick
### POST /api/weather/kill — kill switch
### POST /api/weather/mode → { mode: "paper" | "live" }

---

## Pages Required (3 pages only)

### 1. Overview (/)
**Status Row** across the top — small horizontal badges/pills:
- Mode (LIVE/PAPER), Trading (ON/OFF), Kill Switch (Active/Inactive), Supabase (Connected), Uptime (Xh Ym)

**Stats Grid** — 4 cards:
- Total Balance (BTC balance.balance + weather bankroll)
- Total Realized P&L (BTC balance.realized + weather rolling.pnl)
- ROI % ((total realized / total starting) * 100)
- Total Trades (BTC ledgerSummary.totalTrades + weather rolling.trades)

**Equity Chart** — Recharts AreaChart showing combined equity over time. Build from BTC trades cumulative PnL + weather trades cumulative PnL. X axis = date, Y axis = dollar value. Start from starting balance (1000 + 100).

**Bot Sections** — two columns:
Left: BTC bot card with balance, P&L, win rate, trade count, start/stop buttons
Right: Weather bot card with balance, P&L, open trades, start tick/kill buttons

### 2. BTC (/btc)
**Status Row**: Mode toggle (paper/live dropdown), Trading status badge, Kill switch badge, Start/Stop buttons

**Stats Grid** — 5 cards:
- Balance (balance.balance)
- Realized P&L (balance.realized, green/red)
- Win Rate (ledgerSummary.winRate%)
- Total Trades (ledgerSummary.totalTrades)
- Open Trades (from /api/btc/live/open-orders count)

**Tab View**: "Dashboard" tab (P&L chart) and "Trades" tab (trade table)

Dashboard tab: P&L trend chart (Recharts LineChart from trades cumulative PnL)

Trades tab: Table with columns: Entry Time, Exit Time, Side, Entry Price, Exit Price, PnL, Exit Reason.
- Default show last 20, dropdown to show 25/50/100
- Filter by side (ALL/UP/DOWN), filter by result (ALL/WIN/LOSS based on pnl > 0 or < 0)
- Sort by time descending
- PnL colored green if positive, red if negative
- Format prices as $X.XX, times as MM/DD HH:mm

### 3. Weather (/weather)
**Status Row**: Mode toggle (paper/live dropdown), Trading status badge, Start Tick button, Kill button

**Stats Grid** — 5 cards:
- Balance (bankroll)
- Realized P&L (from rolling.pnl)
- Open Trades (openTrades count)
- Win Rate (rolling.wins / rolling.trades * 100 if trades > 0)
- Total Trades (rolling.trades)

**City Grid**: Group weather trades by city. For each city show a small card with city name, number of trades, wins, losses, P&L. Use a 3-col or 4-col grid. Data comes from rolling.byCity in /api/weather/summary.

**Open Positions**: List of trades with status="OPEN". Show: City, Side, Entry Price, Stake, Question, Date.

**Resolved Trades Table**: Filterable table of resolved trades (result="WIN" or "LOSS").
Columns: City, Date, Side, Result, P&L, Entry Price, Question, Resolved Date.
- Filter by city (dropdown of all cities), filter by result (ALL/WIN/LOSS)
- Default last 20, dropdown for 25/50/100
- PnL colored green/red

---

## Sidebar
3 items only with icons (use simple SVG or unicode):
- 📊 Overview → /
- ₿ BTC → /btc
- 🌤 Weather → /weather

Active item highlighted with emerald accent.

## Design
- Dark theme: bg-slate-950 main, bg-slate-900 cards, bg-slate-800 sidebar
- Emerald-500 for positive, red-500 for negative
- Status pills: green for active/running, red for stopped/error, yellow for override
- Tables: striped rows with slate-900/slate-950 alternating
- Responsive

## Data Unwrapping
BTC endpoints return `{ success: true, data: ... }` — always unwrap `.data`
Weather endpoints return the data directly (no wrapper)
