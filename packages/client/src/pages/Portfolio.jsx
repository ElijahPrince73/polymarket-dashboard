import { useMemo } from 'react';
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import StatCard from '../components/StatCard.jsx';
import StatusPill from '../components/StatusPill.jsx';
import useApi from '../hooks/useApi.js';

const currencyFormatter = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

function formatCurrency(value) {
  return currencyFormatter.format(Number(value || 0));
}

function formatPercent(value) {
  return `${Number(value || 0).toFixed(2)}%`;
}

function formatDateTime(value) {
  if (!value) return '--';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '--';
  return date.toLocaleString('en-US', {
    month: '2-digit',
    day: '2-digit',
    year: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

function formatShortDate(value) {
  if (!value) return '--';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '--';
  return date.toLocaleDateString('en-US', { month: '2-digit', day: '2-digit' });
}

function formatUptime(seconds) {
  const total = Number(seconds || 0);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  return `${hours}h ${minutes}m`;
}

function extractBtcOpenPosition(status) {
  const openTrade = status?.openTrade;
  if (!openTrade || typeof openTrade !== 'object') return [];

  return [
    {
      id: String(openTrade.id || openTrade.orderId || `btc-open-${openTrade.entryTime || '1'}`),
      market: 'bitcoin',
      question: String(openTrade.question || openTrade.marketTitle || 'BTC Position'),
      side: String(openTrade.side || '--'),
      stake: Number(openTrade.stakeUsd || openTrade.stake || 0),
      entryPrice: Number(openTrade.entryPrice || openTrade.entryPolyPrice || openTrade.price || 0),
      createdAt: openTrade.entryTime || openTrade.timestamp || null,
    },
  ];
}

function normalizeWeatherOpenPositions(weatherTrades) {
  return (weatherTrades || [])
    .filter((trade) => String(trade?.status || '').toUpperCase() === 'OPEN')
    .map((trade, index) => ({
      id: String(trade?.id || `weather-open-${index}`),
      market: 'weather',
      question: String(trade?.question || 'Weather Position'),
      side: String(trade?.side || '--'),
      stake: Number(trade?.stake_usd || 0),
      entryPrice: Number(trade?.entry_price || 0),
      createdAt: trade?.created_at || trade?.event_date || null,
    }));
}

function normalizeBtcTrades(btcTrades) {
  return (btcTrades || []).map((trade, index) => ({
    id: String(trade?.id || `btc-trade-${index}`),
    market: 'bitcoin',
    side: String(trade?.side || '--'),
    entryTime: trade?.entryTime || trade?.timestamp || null,
    exitTime: trade?.exitTime || trade?.timestamp || null,
    stake: Number(trade?.stakeUsd || trade?.stake || trade?.stake_usd || 0),
    entryPrice: Number(trade?.entryPrice || trade?.entry_price || trade?.entryPolyPrice || 0),
    exitValue:
      trade?.exitPrice != null
        ? Number(trade.exitPrice)
        : trade?.exit_price != null
          ? Number(trade.exit_price)
          : null,
    pnl: Number(trade?.pnl || 0),
    reason: String(trade?.exitReason || trade?.reason || '--'),
    sortTime:
      new Date(trade?.exitTime || trade?.timestamp || trade?.entryTime || 0).getTime() ||
      0,
  }));
}

function normalizeWeatherTrades(weatherTrades) {
  return (weatherTrades || []).map((trade, index) => ({
    id: String(trade?.id || `weather-trade-${index}`),
    market: 'weather',
    side: String(trade?.side || '--'),
    entryTime: trade?.created_at || null,
    exitTime: trade?.resolved_at || null,
    stake: Number(trade?.stake_usd || 0),
    entryPrice: Number(trade?.entry_price || 0),
    exitValue: trade?.result != null ? String(trade.result) : '--',
    pnl: Number(trade?.pnl || 0),
    reason: String(trade?.city || '--'),
    sortTime: new Date(trade?.resolved_at || trade?.created_at || 0).getTime() || 0,
  }));
}

function drawdownDomain(series) {
  const min = Math.min(
    ...series.map((item) => Number(item?.drawdown || 0)),
    -0.1
  );
  return [Math.floor(min * 1.2), 0];
}

function MarketDot({ cx, cy, payload }) {
  const market = String(payload?.market || 'combined').toLowerCase();
  const fill = market === 'bitcoin' ? '#f97316' : market === 'weather' ? '#06b6d4' : '#10b981';
  return <circle cx={cx} cy={cy} r={2.2} fill={fill} stroke="none" />;
}

export default function Portfolio() {
  const { data: combinedAnalytics, loading } = useApi('/api/analytics/combined');
  const { data: btcStatus } = useApi('/api/btc/status');
  const { data: weatherStatus } = useApi('/api/weather/status');
  const { data: btcTrades } = useApi('/api/btc/trades');
  const { data: weatherTrades } = useApi('/api/weather/trades');

  const combined = combinedAnalytics?.combined || {};
  const bitcoin = combinedAnalytics?.bitcoin || {};
  const weather = combinedAnalytics?.weather || {};

  const combinedMetrics = combined?.metrics || {};
  const btcMetrics = bitcoin?.metrics || {};
  const weatherMetrics = weather?.metrics || {};

  const equitySeries = useMemo(() => {
    return (combined?.equitySeries || []).map((point) => ({
      date: formatShortDate(point?.date),
      equity: Number(point?.equity || 0),
      drawdown: Number(point?.drawdown || 0),
      market: String(point?.market || 'combined').toLowerCase(),
    }));
  }, [combined?.equitySeries]);

  const openPositions = useMemo(() => {
    const btc = extractBtcOpenPosition(btcStatus);
    const weatherOpen = normalizeWeatherOpenPositions(weatherTrades);
    return [...btc, ...weatherOpen];
  }, [btcStatus, weatherTrades]);

  const recentTrades = useMemo(() => {
    const merged = [...normalizeBtcTrades(btcTrades), ...normalizeWeatherTrades(weatherTrades)];
    return merged.sort((a, b) => b.sortTime - a.sortTime).slice(0, 15);
  }, [btcTrades, weatherTrades]);

  const btcOpenCount = extractBtcOpenPosition(btcStatus).length;
  const weatherOpenCount = normalizeWeatherOpenPositions(weatherTrades).length;
  const btcExposure =
    Number(btcStatus?.openTrade?.stakeUsd || btcStatus?.openTrade?.stake || 0) /
    Math.max(Number(btcMetrics?.equity || 1), 1) *
    100;
  const weatherExposure =
    normalizeWeatherOpenPositions(weatherTrades).reduce((sum, trade) => sum + trade.stake, 0) /
    Math.max(Number(weatherMetrics?.equity || 1), 1) *
    100;

  const killSwitchActive =
    Boolean(btcStatus?.killSwitch?.active) ||
    Boolean(btcStatus?.guardrails?.circuitBreakerTripped);

  return (
    <div className="space-y-6">
      <section className="flex flex-wrap gap-2">
        <StatusPill
          label="Mode"
          value={String(btcStatus?.mode || 'PAPER')}
          variant={String(btcStatus?.mode || 'PAPER').toUpperCase() === 'LIVE' ? 'warning' : 'neutral'}
        />
        <StatusPill
          label="Trading"
          value={btcStatus?.tradingEnabled ? 'ON' : 'OFF'}
          variant={btcStatus?.tradingEnabled ? 'success' : 'danger'}
        />
        <StatusPill
          label="Kill Switch"
          value={killSwitchActive ? 'Active' : 'Inactive'}
          variant={killSwitchActive ? 'danger' : 'success'}
        />
        <StatusPill
          label="Uptime"
          value={formatUptime(btcStatus?.status?._uptimeS || weatherStatus?.uptime || 0)}
          variant="neutral"
        />
      </section>

      <section className="rounded-lg border border-slate-700 bg-slate-900 p-5">
        <p className="text-xs uppercase tracking-wide text-slate-400">Performance Hero</p>
        <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
          <div className="md:col-span-2">
            <p className="text-xs uppercase tracking-wide text-slate-400">Total Equity</p>
            <p className="mt-1 text-4xl font-bold tracking-tight text-slate-100">
              {formatCurrency(combinedMetrics?.equity)}
            </p>
          </div>
          <div>
            <p className="text-xs uppercase tracking-wide text-slate-400">Net P&amp;L</p>
            <p
              className={`mt-1 text-2xl font-semibold ${
                Number(combinedMetrics?.totalPnl || 0) >= 0 ? 'text-emerald-400' : 'text-red-400'
              }`}
            >
              {formatCurrency(combinedMetrics?.totalPnl)}
            </p>
          </div>
          <div>
            <p className="text-xs uppercase tracking-wide text-slate-400">ROI</p>
            <p className="mt-1 text-2xl font-semibold text-slate-100">{formatPercent(combinedMetrics?.roi)}</p>
          </div>
          <div>
            <p className="text-xs uppercase tracking-wide text-slate-400">Today P&amp;L / Exposure</p>
            <p
              className={`mt-1 text-xl font-semibold ${
                Number(combined?.todayPnl || 0) >= 0 ? 'text-emerald-400' : 'text-red-400'
              }`}
            >
              {formatCurrency(combined?.todayPnl)}
            </p>
            <p className="mt-1 text-sm text-slate-300">Exposure: {formatPercent(combined?.totalExposurePct)}</p>
          </div>
        </div>
      </section>

      <section className="rounded-lg border border-slate-700 bg-slate-900 p-4">
        <h2 className="mb-3 text-lg font-semibold">Equity &amp; Drawdown</h2>
        <div className="grid grid-cols-1 gap-2">
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={equitySeries} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid stroke="#334155" strokeDasharray="4 4" />
                <XAxis dataKey="date" hide />
                <YAxis
                  stroke="#94a3b8"
                  tickFormatter={(value) => formatCurrency(value)}
                  width={88}
                  domain={['dataMin - 5', 'dataMax + 5']}
                />
                <Tooltip
                  contentStyle={{ backgroundColor: '#020617', border: '1px solid #334155', borderRadius: 8 }}
                  labelStyle={{ color: '#cbd5e1' }}
                  formatter={(value) => formatCurrency(value)}
                />
                <Area
                  type="monotone"
                  dataKey="equity"
                  stroke="#10b981"
                  fill="#10b981"
                  fillOpacity={0.18}
                  dot={<MarketDot />}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>

          <div className="h-44">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={equitySeries} margin={{ top: 0, right: 8, left: 0, bottom: 4 }}>
                <CartesianGrid stroke="#334155" strokeDasharray="4 4" />
                <XAxis dataKey="date" stroke="#94a3b8" />
                <YAxis
                  stroke="#94a3b8"
                  tickFormatter={(value) => `${Number(value).toFixed(1)}%`}
                  width={72}
                  domain={drawdownDomain(equitySeries)}
                />
                <Tooltip
                  contentStyle={{ backgroundColor: '#020617', border: '1px solid #334155', borderRadius: 8 }}
                  labelStyle={{ color: '#cbd5e1' }}
                  formatter={(value) => `${Number(value).toFixed(2)}%`}
                />
                <Area
                  type="monotone"
                  dataKey="drawdown"
                  stroke="#f87171"
                  fill="#ef4444"
                  fillOpacity={0.16}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>
      </section>

      <section className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <article className="rounded-lg border border-orange-500/40 bg-slate-900 p-4">
          <h3 className="text-base font-semibold text-orange-400">Bitcoin</h3>
          <div className="mt-3 grid grid-cols-2 gap-3 text-sm">
            <p className="text-slate-400">Equity</p>
            <p>{formatCurrency(btcMetrics?.equity)}</p>
            <p className="text-slate-400">Net P&amp;L</p>
            <p className={Number(btcMetrics?.totalPnl || 0) >= 0 ? 'text-emerald-400' : 'text-red-400'}>
              {formatCurrency(btcMetrics?.totalPnl)}
            </p>
            <p className="text-slate-400">ROI</p>
            <p>{formatPercent(btcMetrics?.roi)}</p>
            <p className="text-slate-400">Open Positions</p>
            <p>{String(btcOpenCount)}</p>
            <p className="text-slate-400">Exposure</p>
            <p>{formatPercent(btcExposure)}</p>
          </div>
        </article>

        <article className="rounded-lg border border-cyan-500/40 bg-slate-900 p-4">
          <h3 className="text-base font-semibold text-cyan-400">Weather</h3>
          <div className="mt-3 grid grid-cols-2 gap-3 text-sm">
            <p className="text-slate-400">Equity</p>
            <p>{formatCurrency(weatherMetrics?.equity)}</p>
            <p className="text-slate-400">Net P&amp;L</p>
            <p className={Number(weatherMetrics?.totalPnl || 0) >= 0 ? 'text-emerald-400' : 'text-red-400'}>
              {formatCurrency(weatherMetrics?.totalPnl)}
            </p>
            <p className="text-slate-400">ROI</p>
            <p>{formatPercent(weatherMetrics?.roi)}</p>
            <p className="text-slate-400">Open Positions</p>
            <p>{String(weatherOpenCount)}</p>
            <p className="text-slate-400">Exposure</p>
            <p>{formatPercent(weatherExposure)}</p>
          </div>
        </article>
      </section>

      <section className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        <StatCard label="Max Drawdown" value={formatPercent(combinedMetrics?.maxDrawdown)} color="loss" />
        <StatCard label="Avg Win" value={formatCurrency(combinedMetrics?.avgWin)} color="profit" />
        <StatCard label="Avg Loss" value={formatCurrency(combinedMetrics?.avgLoss)} color="loss" />
        <StatCard label="Profit Factor" value={Number(combinedMetrics?.profitFactor || 0).toFixed(2)} />
        <StatCard label="Longest Losing Streak" value={String(combinedMetrics?.longestLossStreak || 0)} />
        <StatCard label="Avg Risk / Trade" value={formatPercent(combinedMetrics?.avgRiskPerTrade)} />
      </section>

      <section className="rounded-lg border border-slate-700 bg-slate-900 p-4">
        <h2 className="mb-3 text-lg font-semibold">Active Positions Combined</h2>
        <div className="space-y-2">
          {openPositions.map((position) => (
            <article
              key={position.id}
              className="rounded-md border border-slate-700 bg-slate-950 p-3 text-sm"
            >
              <div className="flex items-center gap-2">
                <span
                  className={`rounded px-2 py-0.5 text-xs font-semibold ${
                    position.market === 'bitcoin'
                      ? 'bg-orange-500/20 text-orange-300'
                      : 'bg-cyan-500/20 text-cyan-300'
                  }`}
                >
                  {position.market === 'bitcoin' ? 'BTC' : 'Weather'}
                </span>
                <p className="font-medium text-slate-100">{position.question}</p>
              </div>
              <p className="mt-1 text-slate-300">
                Side {position.side} | Stake {formatCurrency(position.stake)} | Entry {formatCurrency(position.entryPrice)}{' '}
                | Opened {formatDateTime(position.createdAt)}
              </p>
            </article>
          ))}
          {!loading && openPositions.length === 0 ? (
            <p className="text-sm text-slate-400">No active positions.</p>
          ) : null}
        </div>
      </section>

      <section className="rounded-lg border border-slate-700 bg-slate-900 p-4">
        <h2 className="mb-3 text-lg font-semibold">Recent Trades</h2>
        <div className="overflow-x-auto rounded-md border border-slate-700">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-800 text-left text-slate-200">
              <tr>
                <th className="px-3 py-2">Market</th>
                <th className="px-3 py-2">Exit Time</th>
                <th className="px-3 py-2">Side</th>
                <th className="px-3 py-2">Stake</th>
                <th className="px-3 py-2">P&amp;L</th>
                <th className="px-3 py-2">Detail</th>
              </tr>
            </thead>
            <tbody>
              {recentTrades.map((trade) => (
                <tr key={trade.id} className="border-t border-slate-700 bg-slate-950">
                  <td className="px-3 py-2">
                    <span
                      className={`rounded px-2 py-0.5 text-xs font-semibold ${
                        trade.market === 'bitcoin'
                          ? 'bg-orange-500/20 text-orange-300'
                          : 'bg-cyan-500/20 text-cyan-300'
                      }`}
                    >
                      {trade.market === 'bitcoin' ? 'BTC' : 'Weather'}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-slate-300">{formatDateTime(trade.exitTime || trade.entryTime)}</td>
                  <td className="px-3 py-2">{trade.side}</td>
                  <td className="px-3 py-2 text-slate-300">{formatCurrency(trade.stake)}</td>
                  <td
                    className={`px-3 py-2 font-medium ${
                      Number(trade.pnl || 0) >= 0 ? 'text-emerald-400' : 'text-red-400'
                    }`}
                  >
                    {formatCurrency(trade.pnl)}
                  </td>
                  <td className="px-3 py-2 text-slate-300">{trade.reason}</td>
                </tr>
              ))}
              {recentTrades.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-3 py-4 text-center text-slate-400">
                    No trades available.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
