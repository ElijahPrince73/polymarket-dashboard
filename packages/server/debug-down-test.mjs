// Read fixture directly
import { readFileSync } from 'fs';
const FIXTURE = JSON.parse(readFileSync('./tests/fixtures/btc-5m-real.json', 'utf8'));

import { TradingEngine } from './src/btc/application/TradingEngine.js';
import { buildTradingConfig, CONFIG } from './src/btc/config.js';

function liveConfig(overrides = {}) {
  return {
    ...buildTradingConfig(CONFIG, 'live', '5m'),
    dynamicStopLossPct: 0.30,
    slGraceMin: 0,
    ...overrides,
  };
}

const ALL_CANDLES = FIXTURE.candles.up;
const OSCC_CANDLES = ALL_CANDLES.slice(1425, 1437);

class ReplayExecutor {
  constructor(opts) {
    this.candles = opts.candleSlice ?? [];
    this.entryPrice = opts.entryPrice ?? 0.45;
    this.shares = opts.shares ?? 100;
    this.side = opts.side ?? 'UP';
    this.marketSlug = opts.marketSlug ?? 'btc-updown-5m-1776224400';
    this.mode = opts.mode ?? 'live';
    this.contractSize = this.entryPrice * this.shares;
    this._position = null;
    this.closeCalls = [];
  }
  async initialize() {}
  getMode() { return this.mode; }
  async getBalance() { return { balance: 1000, available: 1000, currency: 'USD' }; }
  setNow(timestampMs) { this._nowMs = timestampMs; }
  _now() { return this._nowMs ?? Date.now(); }
  async getOpenPositions(signals) {
    if (!this._position) return [];
    const now = this._now();
    if (this._position.marketSlug) {
      const slugMatch = this._position.marketSlug.match(/(\d+)$/);
      if (slugMatch) {
        const durationSec = this._position.marketSlug.includes('15m') ? 900 : 300;
        const posSettlementMs = (Number(slugMatch[1]) + durationSec) * 1000;
        console.log(`  [getOpenPositions] now=${new Date(now).toISOString()} posSettlementMs=${new Date(posSettlementMs).toISOString()} settled=${posSettlementMs <= now}`);
        if (posSettlementMs <= now) {
          const pos = this._position;
          const pnl = pos.unrealizedPnl ?? this._computePnl(pos.mark ?? this.entryPrice);
          this.closeCalls.push({ tradeId: pos.id, side: pos.side, shares: pos.shares, reason: 'Market Settled', tokenID: pos.tokenID, pnl });
          console.log(`  [getOpenPositions] AUTO-CLOSED (Market Settled) pnl=${pnl}`);
          this._position = null;
          return [];
        }
      }
    }
    console.log(`  [getOpenPositions] returning position: mark=${this._position?.mark} unrealizedPnl=${this._position?.unrealizedPnl}`);
    return [{ ...this._position }];
  }
  async markPositions(positions, signals) {
    const upCents = signals?.polyPricesCents?.UP;
    if (upCents != null) {
      const mark = upCents / 100;
      for (const p of positions) {
        const posSlug = p.marketSlug;
        const currentSlug = signals?.market?.slug;
        if (currentSlug && posSlug && posSlug !== currentSlug) { console.log(`  [markPositions] SKIP: posSlug=${posSlug} currentSlug=${currentSlug}`); continue; }
        p.mark = mark;
        p.unrealizedPnl = this._computePnl(mark);
        console.log(`  [markPositions] mark=${mark} unrealizedPnl=${p.unrealizedPnl}`);
      }
    }
    return positions;
  }
  async closePosition({ tradeId, side, shares, reason, tokenID }) {
    console.log(`  [closePosition] tradeId=${tradeId} reason=${reason}`);
    const pos = this._position;
    let pnl = 0;
    if (pos && pos.id === tradeId) {
      pnl = pos.unrealizedPnl ?? this._computePnl(pos.mark ?? this.entryPrice);
      console.log(`  [closePosition] FOUND: pos.unrealizedPnl=${pos?.unrealizedPnl} computed=${pnl}`);
    } else {
      console.log(`  [closePosition] NO MATCH: pos.id=${pos?.id} vs tradeId=${tradeId}`);
    }
    this.closeCalls.push({ tradeId, side, shares, reason, tokenID, pnl });
    this._position = null;
    return { closed: true, pnl };
  }
  _computePnl(markPrice) {
    if (this.side === 'UP') return this.shares * (markPrice - this.entryPrice);
    else return this.shares * (this.entryPrice - markPrice);
  }
  openPositionSync(overrides = {}) {
    const now = this._now();
    this._position = {
      id: overrides.id ?? 'replay-trade-pre',
      side: overrides.side ?? this.side, tokenID: '0xtestreplaypre', shares: overrides.shares ?? this.shares,
      contractSize: overrides.contractSize ?? this.contractSize,
      entryPrice: overrides.entryPrice ?? this.entryPrice,
      mark: overrides.mark ?? this.entryPrice,
      unrealizedPnl: 0, marketSlug: overrides.marketSlug ?? this.marketSlug,
      maxUnrealizedPnl: 0, minUnrealizedPnl: 0, outcome: overrides.side ?? this.side,
      entryTime: overrides.entryTime ?? new Date(now).toISOString(),
      lastTradeTime: overrides.lastTradeTime ?? Math.floor(now / 1000),
      ...overrides,
    };
  }
}

async function runDOWNTest() {
  console.log('\n=== DOWN TEST ===');
  const ENTRY = 0.505, SHARES = 100, SL_PCT = 0.30;
  const marketSlug = FIXTURE.currentMarket.slug;
  const slugEpoch = 1776224400;
  const marketSettlementMs = (slugEpoch + 300) * 1000;
  const testNow = marketSettlementMs - (60 * 60 * 1000);
  console.log(`testNow=${new Date(testNow).toISOString()}`);
  console.log(`settlement=${new Date(marketSettlementMs).toISOString()}`);
  console.log(`Date.now()=${new Date(Date.now()).toISOString()}`);

  const executor = new ReplayExecutor({ candleSlice: OSCC_CANDLES, entryPrice: ENTRY, shares: SHARES, side: 'DOWN', slPct: SL_PCT, mode: 'live' });
  executor.setNow(testNow);
  executor.openPositionSync({ contractSize: ENTRY * SHARES, mark: ENTRY, side: 'DOWN' });
  console.log(`_position.marketSlug=${executor._position.marketSlug} id=${executor._position.id}`);

  const engine = new TradingEngine({ executor, config: liveConfig({ dynamicStopLossPct: SL_PCT, slGraceMin: 0 }) });
  engine.tradingEnabled = true;
  const posId = executor._position.id;

  for (let i = 0; i < OSCC_CANDLES.length; i++) {
    const candle = OSCC_CANDLES[i];
    const nowMs = testNow + i * 60_000;
    const candleTimeMs = candle.t * 1000;
    const timeLeftMin = Math.max(0, (marketSettlementMs - nowMs) / 60000);
    const signals = {
      market: { slug: marketSlug, endDate: new Date(candleTimeMs + 300_000).toISOString(), liquidityNum: 50000 },
      polyPricesCents: { UP: Math.round(candle.p * 100), DOWN: Math.round((1 - candle.p) * 100) },
      polyMarketSnapshot: { orderbook: { up: { bestAsk: Math.round(candle.p * 100) }, down: { bestAsk: Math.round((1 - candle.p) * 100) } } },
      timeLeftMin, modelUp: 0.50, modelDown: 0.50,
    };
    console.log(`\n[TICK ${i}] price=${candle.p} now=${new Date(nowMs).toISOString()} timeLeftMin=${timeLeftMin.toFixed(2)}`);
    await engine.processSignals(signals, [], nowMs);
  }

  console.log(`\n=== AFTER LOOP ===`);
  console.log(`closeCalls.length=${executor.closeCalls.length}`);
  executor.closeCalls.forEach(c => console.log(`  closeCall: ${c.reason} pnl=${c.pnl}`));
  const openPos = await executor.getOpenPositions();
  console.log(`openPos.length=${openPos.length}`);
  if (openPos.length > 0) console.log(`openPos[0].mark=${openPos[0].mark} unrealizedPnl=${openPos[0].unrealizedPnl}`);
}

await runDOWNTest();
