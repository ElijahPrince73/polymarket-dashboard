/**
 * Analytics API — pre-computed metrics for the dashboard.
 * All heavy computation happens server-side.
 */
import { Router } from 'express';
import { createClient } from '@supabase/supabase-js';

const router = Router();

function getSupabase() {
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
}

// ── Helpers ────────────────────────────────────────────────────────────

function computeDrawdown(equitySeries) {
  let peak = equitySeries[0]?.equity ?? 0;
  return equitySeries.map((point) => {
    if (point.equity > peak) peak = point.equity;
    const dd = peak > 0 ? ((peak - point.equity) / peak) * 100 : 0;
    return { ...point, drawdown: Number(dd.toFixed(2)) };
  });
}

function computeStreaks(trades) {
  let currentStreak = 0;
  let longestWin = 0;
  let longestLoss = 0;
  let currentType = null;

  for (const t of trades) {
    const pnl = Number(t.pnl || 0);
    const type = pnl >= 0 ? 'win' : 'loss';
    if (type === currentType) {
      currentStreak++;
    } else {
      currentStreak = 1;
      currentType = type;
    }
    if (type === 'win' && currentStreak > longestWin) longestWin = currentStreak;
    if (type === 'loss' && currentStreak > longestLoss) longestLoss = currentStreak;
  }
  return { longestWin, longestLoss };
}

function computeMetrics(trades, startingBalance) {
  const closed = trades.filter((t) => t.pnl != null && t.pnl !== undefined);
  if (closed.length === 0) {
    return {
      totalTrades: 0, wins: 0, losses: 0, winRate: 0,
      totalPnl: 0, avgWin: 0, avgLoss: 0, profitFactor: 0,
      maxDrawdown: 0, longestWinStreak: 0, longestLossStreak: 0,
      avgRiskPerTrade: 0, roi: 0, equity: startingBalance,
    };
  }

  const wins = closed.filter((t) => Number(t.pnl) > 0);
  const losses = closed.filter((t) => Number(t.pnl) < 0);
  const totalPnl = closed.reduce((s, t) => s + Number(t.pnl || 0), 0);
  const grossWins = wins.reduce((s, t) => s + Number(t.pnl), 0);
  const grossLosses = Math.abs(losses.reduce((s, t) => s + Number(t.pnl), 0));
  const avgWin = wins.length > 0 ? grossWins / wins.length : 0;
  const avgLoss = losses.length > 0 ? grossLosses / losses.length : 0;
  const profitFactor = grossLosses > 0 ? grossWins / grossLosses : grossWins > 0 ? Infinity : 0;

  // Equity curve for drawdown
  let running = startingBalance;
  let peak = startingBalance;
  let maxDd = 0;
  for (const t of closed) {
    running += Number(t.pnl || 0);
    if (running > peak) peak = running;
    const dd = peak > 0 ? ((peak - running) / peak) * 100 : 0;
    if (dd > maxDd) maxDd = dd;
  }

  const streaks = computeStreaks(closed);
  const avgStake = closed.reduce((s, t) => s + Number(t.contractSize || t.stake_usd || 0), 0) / closed.length;
  const avgRiskPerTrade = startingBalance > 0 ? (avgStake / startingBalance) * 100 : 0;

  return {
    totalTrades: closed.length,
    wins: wins.length,
    losses: losses.length,
    winRate: (wins.length / closed.length) * 100,
    totalPnl: Number(totalPnl.toFixed(2)),
    avgWin: Number(avgWin.toFixed(2)),
    avgLoss: Number(avgLoss.toFixed(2)),
    profitFactor: Number(profitFactor.toFixed(2)),
    maxDrawdown: Number(maxDd.toFixed(2)),
    longestWinStreak: streaks.longestWin,
    longestLossStreak: streaks.longestLoss,
    avgRiskPerTrade: Number(avgRiskPerTrade.toFixed(2)),
    roi: startingBalance > 0 ? Number(((totalPnl / startingBalance) * 100).toFixed(2)) : 0,
    equity: Number((startingBalance + totalPnl).toFixed(2)),
  };
}

function buildEquitySeries(trades, startingBalance) {
  let running = startingBalance;
  const series = [{ date: null, equity: startingBalance, pnl: 0, market: 'start' }];
  for (const t of trades) {
    const pnl = Number(t.pnl || 0);
    running += pnl;
    series.push({
      date: t.exitTime || t.resolved_at || t.exittime || t.created_at || t.timestamp,
      equity: Number(running.toFixed(2)),
      pnl: Number(pnl.toFixed(2)),
      market: t._market || 'unknown',
    });
  }
  return computeDrawdown(series);
}

function buildPnlBuckets(trades) {
  const buckets = {
    '< -$50': 0, '-$50 to -$20': 0, '-$20 to -$5': 0, '-$5 to $0': 0,
    '$0 to $5': 0, '$5 to $20': 0, '$20 to $50': 0, '> $50': 0,
  };
  const pnls = [];
  for (const t of trades) {
    const pnl = Number(t.pnl || 0);
    pnls.push(pnl);
    if (pnl < -50) buckets['< -$50']++;
    else if (pnl < -20) buckets['-$50 to -$20']++;
    else if (pnl < -5) buckets['-$20 to -$5']++;
    else if (pnl < 0) buckets['-$5 to $0']++;
    else if (pnl < 5) buckets['$0 to $5']++;
    else if (pnl < 20) buckets['$5 to $20']++;
    else if (pnl < 50) buckets['$20 to $50']++;
    else buckets['> $50']++;
  }
  pnls.sort((a, b) => a - b);
  const mean = pnls.length > 0 ? pnls.reduce((s, v) => s + v, 0) / pnls.length : 0;
  const median = pnls.length > 0 ? pnls[Math.floor(pnls.length / 2)] : 0;
  return { buckets, mean: Number(mean.toFixed(2)), median: Number(median.toFixed(2)), count: pnls.length };
}

function buildHourlyPerformance(trades) {
  const hours = {};
  for (let h = 0; h < 24; h++) {
    hours[h] = { trades: 0, wins: 0, totalPnl: 0 };
  }
  for (const t of trades) {
    const ts = t.entryTime || t.timestamp || t.created_at;
    if (!ts) continue;
    const hour = new Date(ts).getUTCHours();
    hours[hour].trades++;
    hours[hour].totalPnl += Number(t.pnl || 0);
    if (Number(t.pnl || 0) > 0) hours[hour].wins++;
  }
  return Object.entries(hours).map(([hour, data]) => ({
    hour: Number(hour),
    trades: data.trades,
    winRate: data.trades > 0 ? Number(((data.wins / data.trades) * 100).toFixed(1)) : 0,
    pnl: Number(data.totalPnl.toFixed(2)),
  }));
}

function buildDayOfWeekPerformance(trades) {
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const dayData = {};
  for (const d of days) dayData[d] = { trades: 0, wins: 0, totalPnl: 0 };
  for (const t of trades) {
    const ts = t.entryTime || t.timestamp || t.created_at;
    if (!ts) continue;
    const day = days[new Date(ts).getUTCDay()];
    dayData[day].trades++;
    dayData[day].totalPnl += Number(t.pnl || 0);
    if (Number(t.pnl || 0) > 0) dayData[day].wins++;
  }
  return days.map((d) => ({
    day: d,
    trades: dayData[d].trades,
    winRate: dayData[d].trades > 0 ? Number(((dayData[d].wins / dayData[d].trades) * 100).toFixed(1)) : 0,
    pnl: Number(dayData[d].totalPnl.toFixed(2)),
  }));
}

function buildSizePerformance(trades) {
  return trades
    .filter((t) => t.pnl != null)
    .map((t) => ({
      stake: Number(t.contractSize || t.stake_usd || 0),
      pnl: Number(t.pnl || 0),
      win: Number(t.pnl || 0) > 0,
      market: t._market || 'unknown',
    }));
}

// ── Routes ─────────────────────────────────────────────────────────────

router.get('/combined', async (_req, res) => {
  try {
    const supabase = getSupabase();

    // Fetch BTC trades from Supabase trade store
    const { data: btcRaw, error: btcErr } = await supabase
      .from('trades')
      .select('*')
      .order('timestamp', { ascending: true });

    const { data: weatherRaw, error: weatherErr } = await supabase
      .from('weather_trades')
      .select('*')
      .order('created_at', { ascending: true });

    if (btcErr) console.error('[Analytics] BTC fetch error:', btcErr.message);
    if (weatherErr) console.error('[Analytics] Weather fetch error:', weatherErr.message);

    const btcTrades = (btcRaw || [])
      .filter((t) => t.pnl != null)
      .map((t) => ({ ...t, _market: 'bitcoin', exitTime: t.exit_time || t.exittime || t.timestamp }));

    const weatherTrades = (weatherRaw || [])
      .filter((t) => t.result === 'WIN' || t.result === 'LOSS')
      .map((t) => ({ ...t, _market: 'weather', exitTime: t.resolved_at || t.created_at }));

    const btcMetrics = computeMetrics(btcTrades, 1000);
    const weatherMetrics = computeMetrics(weatherTrades, 100);

    // Combined sorted trades
    const allTrades = [...btcTrades, ...weatherTrades].sort(
      (a, b) => new Date(a.exitTime || 0).getTime() - new Date(b.exitTime || 0).getTime()
    );

    const combinedMetrics = computeMetrics(allTrades, 1100);
    const equitySeries = buildEquitySeries(allTrades, 1100);

    // BTC-only equity
    const btcEquity = buildEquitySeries(btcTrades, 1000);
    const weatherEquity = buildEquitySeries(weatherTrades, 100);

    // Today's PnL
    const today = new Date().toISOString().slice(0, 10);
    const todayBtc = btcTrades
      .filter((t) => (t.exitTime || '').startsWith(today))
      .reduce((s, t) => s + Number(t.pnl || 0), 0);
    const todayWeather = weatherTrades
      .filter((t) => (t.exitTime || '').startsWith(today))
      .reduce((s, t) => s + Number(t.pnl || 0), 0);

    // Exposure
    const btcOpenExposure = 0; // computed from open positions if available
    const weatherOpenStakes = (weatherRaw || [])
      .filter((t) => t.status === 'OPEN')
      .reduce((s, t) => s + Number(t.stake_usd || 0), 0);

    res.json({
      combined: {
        metrics: combinedMetrics,
        equitySeries,
        todayPnl: Number((todayBtc + todayWeather).toFixed(2)),
        totalExposurePct: Number(
          (((btcOpenExposure + weatherOpenStakes) / (btcMetrics.equity + weatherMetrics.equity)) * 100).toFixed(2)
        ),
      },
      bitcoin: {
        metrics: btcMetrics,
        equitySeries: btcEquity,
        todayPnl: Number(todayBtc.toFixed(2)),
      },
      weather: {
        metrics: weatherMetrics,
        equitySeries: weatherEquity,
        todayPnl: Number(todayWeather.toFixed(2)),
      },
    });
  } catch (err) {
    console.error('[Analytics] Error:', err);
    res.status(500).json({ error: err.message });
  }
});

router.get('/distributions', async (_req, res) => {
  try {
    const supabase = getSupabase();

    const { data: btcRaw } = await supabase
      .from('trades')
      .select('*')
      .order('timestamp', { ascending: true });

    const { data: weatherRaw } = await supabase
      .from('weather_trades')
      .select('*')
      .order('created_at', { ascending: true });

    const btcTrades = (btcRaw || [])
      .filter((t) => t.pnl != null)
      .map((t) => ({ ...t, _market: 'bitcoin', entryTime: t.entry_time || t.entrytime || t.timestamp }));

    const weatherTrades = (weatherRaw || [])
      .filter((t) => t.result === 'WIN' || t.result === 'LOSS')
      .map((t) => ({ ...t, _market: 'weather', entryTime: t.created_at }));

    const allTrades = [...btcTrades, ...weatherTrades];

    res.json({
      pnlDistribution: {
        all: buildPnlBuckets(allTrades),
        bitcoin: buildPnlBuckets(btcTrades),
        weather: buildPnlBuckets(weatherTrades),
      },
      hourly: {
        all: buildHourlyPerformance(allTrades),
        bitcoin: buildHourlyPerformance(btcTrades),
        weather: buildHourlyPerformance(weatherTrades),
      },
      dayOfWeek: {
        all: buildDayOfWeekPerformance(allTrades),
        bitcoin: buildDayOfWeekPerformance(btcTrades),
        weather: buildDayOfWeekPerformance(weatherTrades),
      },
      sizePerformance: buildSizePerformance(allTrades),
    });
  } catch (err) {
    console.error('[Analytics] Distribution error:', err);
    res.status(500).json({ error: err.message });
  }
});

export default router;
