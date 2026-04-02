import { useMemo } from 'react';
import {
  CartesianGrid,
  Line,
  LineChart,
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
      new Date(trade?.exitTime || trade?.timestamp || trade?.entryTime || 0).getTime() || 0,
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
  const min = Math.min(...series.map((item) => Number(item?.drawdown || 0)), -0.1);
  return [Math.floor(min * 1.2), 0];
}

function chartGridProps() {
  return {
    stroke: 'var(--border-visible)',
    vertical: false,
  };
}

function chartAxisProps() {
  return {
    stroke: 'var(--text-secondary)',
    tickLine: false,
    axisLine: false,
  };
}

function tooltipStyle() {
  return {
    backgroundColor: 'var(--surface)',
    border: '1px solid var(--border-visible)',
    borderRadius: 16,
    color: 'var(--text-primary)',
  };
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
    (Number(btcStatus?.openTrade?.stakeUsd || btcStatus?.openTrade?.stake || 0) /
      Math.max(Number(btcMetrics?.equity || 1), 1)) *
    100;
  const weatherExposure =
    (normalizeWeatherOpenPositions(weatherTrades).reduce((sum, trade) => sum + trade.stake, 0) /
      Math.max(Number(weatherMetrics?.equity || 1), 1)) *
    100;

  const killSwitchActive =
    Boolean(btcStatus?.killSwitch?.active) ||
    Boolean(btcStatus?.guardrails?.circuitBreakerTripped);

  return (
    <div className="space-y-8">
      <section className="flex flex-col gap-6 xl:flex-row xl:items-end xl:justify-between">
        <div>
          <p className="nothing-section-title">Combined Portfolio</p>
          <h1 className="nothing-page-title mt-3">System Balance</h1>
          <p className="nothing-display mt-4 text-[48px] md:text-[64px]">
            {loading ? '[LOADING...]' : formatCurrency(combinedMetrics?.equity)}
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
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
            value={killSwitchActive ? 'ON' : 'OFF'}
            variant={killSwitchActive ? 'danger' : 'success'}
          />
          <StatusPill
            label="Uptime"
            value={formatUptime(btcStatus?.status?._uptimeS || weatherStatus?.uptime || 0)}
            variant="neutral"
          />
        </div>
      </section>

      <section className="grid grid-cols-2 gap-3 md:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Net P&L" value={formatCurrency(combinedMetrics?.totalPnl)} color={Number(combinedMetrics?.totalPnl || 0) >= 0 ? 'profit' : 'loss'} />
        <StatCard label="ROI" value={formatPercent(combinedMetrics?.roi)} />
        <StatCard label="Today P&L" value={formatCurrency(combined?.todayPnl)} color={Number(combined?.todayPnl || 0) >= 0 ? 'profit' : 'loss'} />
        <StatCard label="Exposure" value={formatPercent(combined?.totalExposurePct)} />
      </section>

      <section className="nothing-card p-5">
        <div className="mb-4">
          <p className="nothing-section-title">Equity Line</p>
          <h2 className="mt-2 text-xl font-medium text-[var(--text-display)]">Equity & Drawdown</h2>
        </div>
        <div className="grid grid-cols-1 gap-4">
          <div className="nothing-chart h-72">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={equitySeries} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid {...chartGridProps()} />
                <XAxis dataKey="date" hide />
                <YAxis
                  {...chartAxisProps()}
                  tickFormatter={(value) => formatCurrency(value)}
                  width={88}
                  domain={['dataMin - 5', 'dataMax + 5']}
                />
                <Tooltip contentStyle={tooltipStyle()} formatter={(value) => formatCurrency(value)} />
                <Line type="monotone" dataKey="equity" stroke="var(--text-display)" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>

          <div className="nothing-chart h-48">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={equitySeries} margin={{ top: 0, right: 8, left: 0, bottom: 4 }}>
                <CartesianGrid {...chartGridProps()} />
                <XAxis dataKey="date" {...chartAxisProps()} />
                <YAxis
                  {...chartAxisProps()}
                  tickFormatter={(value) => `${Number(value).toFixed(1)}%`}
                  width={72}
                  domain={drawdownDomain(equitySeries)}
                />
                <Tooltip contentStyle={tooltipStyle()} formatter={(value) => `${Number(value).toFixed(2)}%`} />
                <Line type="monotone" dataKey="drawdown" stroke="var(--text-secondary)" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      </section>

      <section className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <article className="nothing-card p-5">
          <p className="nothing-section-title">Bitcoin</p>
          <div className="mt-4 space-y-3">
            <div className="flex items-center justify-between"><span className="nothing-label">Equity</span><span>{formatCurrency(btcMetrics?.equity)}</span></div>
            <div className="flex items-center justify-between"><span className="nothing-label">Net P&L</span><span className={Number(btcMetrics?.totalPnl || 0) >= 0 ? 'text-[var(--success)]' : 'text-[var(--accent)]'}>{formatCurrency(btcMetrics?.totalPnl)}</span></div>
            <div className="flex items-center justify-between"><span className="nothing-label">ROI</span><span>{formatPercent(btcMetrics?.roi)}</span></div>
            <div className="flex items-center justify-between"><span className="nothing-label">Open Positions</span><span className="font-['Space_Mono']">{String(btcOpenCount)}</span></div>
            <div className="flex items-center justify-between"><span className="nothing-label">Exposure</span><span>{formatPercent(btcExposure)}</span></div>
          </div>
        </article>

        <article className="nothing-card p-5">
          <p className="nothing-section-title">Weather</p>
          <div className="mt-4 space-y-3">
            <div className="flex items-center justify-between"><span className="nothing-label">Equity</span><span>{formatCurrency(weatherMetrics?.equity)}</span></div>
            <div className="flex items-center justify-between"><span className="nothing-label">Net P&L</span><span className={Number(weatherMetrics?.totalPnl || 0) >= 0 ? 'text-[var(--success)]' : 'text-[var(--accent)]'}>{formatCurrency(weatherMetrics?.totalPnl)}</span></div>
            <div className="flex items-center justify-between"><span className="nothing-label">ROI</span><span>{formatPercent(weatherMetrics?.roi)}</span></div>
            <div className="flex items-center justify-between"><span className="nothing-label">Open Positions</span><span className="font-['Space_Mono']">{String(weatherOpenCount)}</span></div>
            <div className="flex items-center justify-between"><span className="nothing-label">Exposure</span><span>{formatPercent(weatherExposure)}</span></div>
          </div>
        </article>
      </section>

      <section className="grid grid-cols-2 gap-3 md:grid-cols-3">
        <StatCard label="Max Drawdown" value={formatPercent(combinedMetrics?.maxDrawdown)} color="loss" />
        <StatCard label="Avg Win" value={formatCurrency(combinedMetrics?.avgWin)} color="profit" />
        <StatCard label="Avg Loss" value={formatCurrency(combinedMetrics?.avgLoss)} color="loss" />
        <StatCard label="Profit Factor" value={Number(combinedMetrics?.profitFactor || 0).toFixed(2)} />
        <StatCard label="Losing Streak" value={String(combinedMetrics?.longestLossStreak || 0)} />
        <StatCard label="Avg Risk / Trade" value={formatPercent(combinedMetrics?.avgRiskPerTrade)} />
      </section>

      <section className="nothing-card p-5">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <p className="nothing-section-title">Open Risk</p>
            <h2 className="mt-2 text-xl font-medium text-[var(--text-display)]">Active Positions</h2>
          </div>
          <span className="nothing-meta">{openPositions.length} open</span>
        </div>
        <div className="space-y-3">
          {openPositions.map((position) => (
            <article key={position.id} className="rounded-xl border border-[var(--border)] bg-[var(--surface-raised)] p-4">
              <div className="flex flex-wrap items-center gap-3">
                <span className="nothing-tag inline-flex px-3 py-1">{position.market === 'bitcoin' ? 'BTC' : 'WEATHER'}</span>
                <p className="text-[var(--text-display)]">{position.question}</p>
              </div>
              <p className="mt-3 font-['Space_Mono'] text-xs uppercase tracking-[0.08em] text-[var(--text-secondary)]">
                Side {position.side} / Stake {formatCurrency(position.stake)} / Entry {formatCurrency(position.entryPrice)} / Opened {formatDateTime(position.createdAt)}
              </p>
            </article>
          ))}
          {!loading && openPositions.length === 0 ? (
            <p className="font-['Space_Mono'] text-xs uppercase tracking-[0.08em] text-[var(--text-secondary)]">No active positions.</p>
          ) : null}
        </div>
      </section>

      <section className="nothing-card overflow-x-auto">
        <div className="border-b border-[var(--border)] p-5">
          <p className="nothing-section-title">Trades</p>
          <h2 className="mt-2 text-xl font-medium text-[var(--text-display)]">Recent Activity</h2>
        </div>
        <table className="nothing-table min-w-full">
          <thead>
            <tr>
              <th>Market</th>
              <th>Exit Time</th>
              <th>Side</th>
              <th>Stake</th>
              <th>P&L</th>
              <th>Detail</th>
            </tr>
          </thead>
          <tbody>
            {recentTrades.map((trade) => (
              <tr key={trade.id}>
                <td data-mono="true"><span className="nothing-tag inline-flex px-3 py-1">{trade.market === 'bitcoin' ? 'BTC' : 'WEATHER'}</span></td>
                <td data-mono="true" className="text-[var(--text-secondary)]">{formatDateTime(trade.exitTime || trade.entryTime)}</td>
                <td data-mono="true">{trade.side}</td>
                <td data-mono="true">{formatCurrency(trade.stake)}</td>
                <td data-mono="true" className={Number(trade.pnl || 0) >= 0 ? 'text-[var(--success)]' : 'text-[var(--accent)]'}>{formatCurrency(trade.pnl)}</td>
                <td>{trade.reason}</td>
              </tr>
            ))}
            {recentTrades.length === 0 ? (
              <tr>
                <td colSpan={6} className="py-8 text-center text-[var(--text-secondary)]">No trades available.</td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </section>
    </div>
  );
}
