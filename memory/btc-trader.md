# BTC 5-Minute Trader — Project Memory

## Overview
- **Repo:** `~/Dev/polymarket-dashboard/packages/server/src/btc/` (source of truth)
- **Old repo:** `~/Dev/polymarket-btc-5m-assistant` (archived, do not modify)
- **Live:** https://polymarket-dashboard-ip4ea.ondigitalocean.app/btc
- **Dashboard:** Part of unified Polymarket Dashboard (Express + React + Supabase)
- **Status:** LIVE trading (paper mode disabled as of v2.2, 2026-03-20)
- **Architecture:** Clean layers — domain (pure functions) / application (orchestration) / infrastructure (I/O) / services / UI
- **ALWAYS read CLAUDE.md** in the project root before making changes

## Architecture

### Code Paths
- **TradingEngine** (`application/TradingEngine.js`) — main loop, calls entryGate + exitEvaluator
- **EntryGate** (`domain/entryGate.js`) — decides whether to enter a trade
- **ExitEvaluator** (`domain/exitEvaluator.js`) — decides when to exit
- **TradingState** (`application/TradingState.js`) — tracks positions, cooldowns, grace periods
- **LiveExecutor** (`infrastructure/executors/LiveExecutor.js`) — CLOB order execution for live mode
- **PaperExecutor** (`infrastructure/executors/PaperExecutor.js`) — simulated execution for paper mode
- **Momentum Model** (`engines/momentum.js`) — 8 signals, weight 18

### Key Lesson: TradingEngine vs Paper Trader
- TradingEngine (via entryGate.js + TradingState.js) is what actually runs
- Paper trader's inline processSignals entry/skip logic is dead code when TradingEngine active
- ALL config/behavior changes must go through entryGate.js and TradingState.js
- One-trade-per-market required fixes in entryGate.js, TradingState.js, AND config.js

### Infrastructure
- **Supabase:** Source of truth for trades. Local JSON ledger is ephemeral on DO deploys.
- **Chainlink WS:** Needs `POLYGON_WSS_URLS` env var (Alchemy Polygon PoS WSS endpoint)
- **Aggregator rotation:** Bot auto-resolves current Chainlink aggregator from proxy contract on boot
- **Deploy:** DO App Platform, auto-deploy from main. Trading auto-starts on boot.
- **Health:** `/api/health` returns `version` field for deploy verification
- **API routes:** `/api/btc/*` (status, trades, analytics, config, trading/start, trading/stop)

## Current Config (v1.0.7 base, v2.2 live fixes)
- startingBalance=1000, stakePct=0.08 (~$80 paper positions), minTradeUsd=25, maxTradeUsd=250
- Live: maxPerTradeUsd=$3 (scaling up as strategy proves out)
- Trailing TP: enabled, start $3, drawdown $2.50. Fixed TP: disabled.
- dynamicStopLossPct=0.10, minMaxLossUsd=8, maxMaxLossUsd=20
- oneTradePerMarket=true, exitBeforeEndMinutes=1.0
- minProbEarly=0.57, mid=0.58, late=0.60; edgeEarly=0.015, mid=0.03, late=0.05
- minPolyPrice=0.40, maxEntryPolyPrice=0.65, maxSpread=0.012
- RSI: overbought 78, oversold 22, bearish 40, bullish 60
- 30s cooldowns, 12 candle warmup, 1.5min no-entry-final
- Trading hours: 6 AM - 5 PM PST only (overnight was -$200+)
- Loss cooldown: 5 min after a loss (34% WR after a loss)
- SL grace: 20s before SL can fire
- Early cut: exit if not green by 45s (winners avg 18s)
- FOK orders (not GTC) for both entry and exit
- Fill verification: waits up to 6s to confirm fill via getTrades()
- Signal-based marking (not per-token orderbook)
- Exit cooldown: 5s (down from 30s)
- Auto-heal: outcome-aware, fetches winner from gamma API

## Version History

### v2.2 — Live Trading Reliability Overhaul (2026-03-20)
- Fixed 5 interconnected bugs preventing live exits from firing
- Root cause chain: GTC orders → assumed fill → null marks → blind exit evaluator → 30s retry cooldown → $0 auto-heal
- Fixes: FOK orders, fill verification, signal-based marking, 5s exit cooldown, outcome-aware auto-heal
- Paper trading DISABLED — live-only mode now default
- Backfilled 35 real live trades: 15W / 20L, 42.9% WR, -$2.02 PnL
- Key commits: `8e5e004`, `c27b813`, `7b813e8`, `8fab12e`, `0d59050`, `2d769b9`, `5bd580a`, `cfd092c`

### v2.1 — Trading Hours + Loss Management (2026-03-10)
- Trading hours: 6 AM - 5 PM PST only
- Loss cooldown: 5 min after a loss
- SL grace: 20s before SL can fire
- Early cut: exit if not green by 45s
- Settlement bug fix: slug epoch is market START, settlement = slug + 300s

### v1.10 — Tiered Take Profit (2026-03-06)
- Simulated +$794 improvement over 120 trades vs settlement-only
- Tiers: $15+ immediately, $10+ after 60s, $5+ after 120s, $2+ after 180s, force exit at 250s
- Force exit at 250s saves $428 on losers
- 86% of trades go green — problem was giving profits back, not bad entries
- All 25+ legacy entry filters removed — only 3 gates remain
- PnL trajectory tracking added: samples every 2s

### v1.0.7 — Proven Baseline (2026-03-04)
- PF 1.50 at $120 positions — the best-performing config
- Restored after config churn showed diminishing returns

## Key Analyses

### 84-Trade Analysis (2026-02-25)
- DOWN trades more profitable than UP trades historically
- Entries at >60¢ (higher conviction) perform much better than <40¢
- Trailing TP is the profit engine (+$243 net). Max Loss is the problem (-$368 net)
- Trade duration averages 21 seconds — max loss hits almost instantly on bad entries

### 234-Trade Analysis (2026-02-26)
- v1.0.5: 46% WR, PF 0.97, -$19.60 (near breakeven)
- Trailing TP: 81% WR, +$599 net — the profit engine works
- Max Loss: 0% WR, -$618 net — still the whole problem
- Entries <40¢: 29% WR — need to raise floor to 40¢

### 101-Trade Analysis (2026-03-03, post-wipe)
- 49.5% WR, PF 0.95, -$37.30 total
- 75% of max losses NEVER went green — bad entries, not bad exits
- Direction correct: 55.4%
- Key fix: tighten stop loss from 18% to 12%

### Bot Identity: Scalper, Not Directional Predictor
- Direction accuracy: ~34-42% (old model 31%, momentum model 42-52%)
- Still profitable because trailing TP captures short-term volatility
- Holding losers longer would be catastrophic (tested: -$2,361 vs -$458 actual)
- Stop loss saves 10x more than it costs — most important feature
- UP direction much worse than DOWN (32% vs 52% with momentum model)

## Hard Lessons
- Don't churn config — each change resets the dataset. Need 100+ trades minimum.
- Buying both sides on Polymarket = guaranteed loss (UP+DOWN > $1 due to vig)
- Late-entry high-conviction (85¢+) markets don't reach 85¢ often enough
- Multiple hidden RSI filter layers — always check ALL of them when disabling
- When nothing works, go back to what DID work (v1.0.7 = PF 1.50)
- Path to more money: better entry filters + tiered exits on winners, NOT holding longer
- DON'T loosen all filters at once — aggressive loosening dropped WR to garbage
- GTC orders unreliable at small sizes — use FOK (Fill-Or-Kill)
- CLOB SDK `orderID` ≠ filled — always verify fill via `getTrades()`
- Per-token orderbook fetch is fragile — use signal prices for PnL tracking
- DO auto-deploy can silently stall — add version tags for verification
- Debug live trading end-to-end: entry → fill → tracking → mark → exit eval → exit exec → settlement
- Minimum viable balance ~$200-500 — $50 doesn't work, spread kills tiny positions
- Quick stop needs fixed-dollar floor — % thresholds break at small positions
- One trade per market is essential — multiple trades in same 5m = giving back gains
- v1.0.7 at $120 positions = PF 1.50 — proven sweet spot
- Stale candle blocker based on candle timestamps doesn't work — use live tick timestamps
- Chainlink aggregator addresses rotate — always resolve from proxy dynamically

## Wallet Info
- **Proxy wallet:** `0x46cdebdFa7A3F94D8d352C99125324994Fd2Bb68` (trades, needs MATIC for gas)
- **EOA wallet:** `0x77D10517E382E6B9b5B10bd317AC57ff8EF627aC` (holds MATIC)
- **"Redeemable" ≠ valuable:** Polymarket `redeemable` flag means "market resolved, tokens burnable" — NOT "tokens have value"
- The 39 "stuck tokens" ($560 reported) were actually worthless losing positions
