import { fetchPolymarketOutcome } from './settlementService.js';

function toFiniteNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function deriveWinnerFromTrade(trade) {
  const settlementSide = String(trade?.settlementSide || '').toUpperCase();
  if (settlementSide === 'UP' || settlementSide === 'DOWN') return settlementSide;

  const btcEntry = toFiniteNumber(trade?.btcSpotAtEntry);
  const btcSettlement = toFiniteNumber(trade?.btcAtSettlement);
  if (btcEntry === null || btcSettlement === null) return null;

  return btcSettlement > btcEntry ? 'UP' : 'DOWN';
}

function computeSettledPnl(trade, winner) {
  if (!trade || (winner !== 'UP' && winner !== 'DOWN')) return null;

  const shares = toFiniteNumber(trade.shares);
  const entryPrice = toFiniteNumber(trade.entryPrice);
  const contractSize = toFiniteNumber(trade.contractSize);
  if (shares === null || entryPrice === null || contractSize === null) return null;

  const won = winner === trade.side;
  return {
    pnl: won
      ? Number((shares * (1.0 - entryPrice)).toFixed(2))
      : Number((-contractSize).toFixed(2)),
    exitReason: won ? 'Market Settlement (Win)' : 'Market Settlement (Loss)',
    source: won ? 'win' : 'loss',
  };
}

async function loadCandidateTrades(store) {
  if (!store) return [];

  if (typeof store.getZeroPnlAutoHealTrades === 'function') {
    return await store.getZeroPnlAutoHealTrades();
  }

  if (typeof store.getAllTrades !== 'function') return [];

  const trades = await store.getAllTrades();
  return trades.filter((trade) => (
    trade?.status === 'CLOSED' &&
    toFiniteNumber(trade?.pnl) === 0 &&
    /auto-heal/i.test(String(trade?.exitReason || ''))
  ));
}

export async function repairZeroPnlTrades(store) {
  if (!store || typeof store.updateTrade !== 'function') {
    console.warn('[TradeRepair] Store unavailable, skipping zero-PnL repair');
    return 0;
  }

  let trades;
  try {
    trades = await loadCandidateTrades(store);
  } catch (error) {
    console.warn(`[TradeRepair] Failed to load candidate trades: ${error?.message}`);
    return 0;
  }

  if (!Array.isArray(trades) || trades.length === 0) {
    return 0;
  }

  let repaired = 0;

  for (const trade of trades) {
    if (!trade?.id || !trade?.marketSlug || !trade?.side) continue;

    let winner = null;
    try {
      winner = await fetchPolymarketOutcome(trade.marketSlug);
    } catch (error) {
      console.warn(`[TradeRepair] Outcome fetch failed for ${trade.marketSlug}: ${error?.message}`);
    }

    const derivedWinner = winner || deriveWinnerFromTrade(trade);
    if (!derivedWinner) {
      console.warn(`[TradeRepair] Skipping ${trade.id}: no settlement outcome available`);
      continue;
    }

    const repairedTrade = computeSettledPnl(trade, derivedWinner);
    if (!repairedTrade) {
      console.warn(`[TradeRepair] Skipping ${trade.id}: incomplete trade data for PnL repair`);
      continue;
    }

    try {
      await store.updateTrade(trade.id, {
        pnl: repairedTrade.pnl,
        exitReason: repairedTrade.exitReason,
      });
      repaired++;
      console.log(
        `[TradeRepair] Repaired ${trade.id} (${trade.marketSlug}) -> ${derivedWinner} ` +
        `PnL: $${repairedTrade.pnl.toFixed(2)}`
      );
    } catch (error) {
      console.warn(`[TradeRepair] Failed to update ${trade.id}: ${error?.message}`);
    }
  }

  return repaired;
}

export function startRepairInterval(store, intervalMs = 30 * 60 * 1000) {
  if (!store) {
    console.warn('[TradeRepair] Store unavailable, interval not started');
    return null;
  }

  const timer = setInterval(() => {
    repairZeroPnlTrades(store).catch((error) => {
      console.warn(`[TradeRepair] Interval repair failed: ${error?.message}`);
    });
  }, intervalMs);

  timer.unref?.();
  console.log(`[TradeRepair] Repair interval started (${Math.round(intervalMs / 60_000)} min)`);
  return timer;
}
