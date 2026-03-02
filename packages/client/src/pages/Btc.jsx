import { useMemo, useState } from 'react';
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { setBtcMode, startBtcTrading, stopBtcTrading } from '../api/btc.js';
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

function formatTime(value) {
  if (!value) return '--';
  return new Date(value).toLocaleString('en-US', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

function parseTimestamp(trade) {
  return new Date(trade.exitTime || trade.timestamp || trade.entryTime || 0).getTime();
}

function buildPnlSeries(trades) {
  const sorted = [...(trades || [])].sort((a, b) => parseTimestamp(a) - parseTimestamp(b));
  let running = 0;
  return sorted.map((trade) => {
    running += Number(trade.pnl || 0);
    return {
      time: formatTime(trade.exitTime || trade.timestamp || trade.entryTime),
      pnl: Number(running.toFixed(2)),
    };
  });
}

export default function Btc() {
  const { data: status, loading, refetch: refetchStatus } = useApi('/api/btc/status');
  const { data: killSwitch, refetch: refetchKill } = useApi('/api/btc/kill-switch/status');
  const { data: trades, refetch: refetchTrades } = useApi('/api/btc/trades');
  const { data: openOrders, refetch: refetchOpenOrders } = useApi('/api/btc/live/open-orders');

  const [activeTab, setActiveTab] = useState('dashboard');
  const [sideFilter, setSideFilter] = useState('ALL');
  const [resultFilter, setResultFilter] = useState('ALL');
  const [pageSize, setPageSize] = useState(20);

  async function refreshAll() {
    await Promise.all([refetchStatus(), refetchKill(), refetchTrades(), refetchOpenOrders()]);
  }

  async function changeMode(event) {
    await setBtcMode(event.target.value);
    await refreshAll();
  }

  async function startTrading() {
    await startBtcTrading();
    await refreshAll();
  }

  async function stopTrading() {
    await stopBtcTrading();
    await refreshAll();
  }

  const sortedTrades = useMemo(() => {
    return [...(trades || [])].sort((a, b) => parseTimestamp(b) - parseTimestamp(a));
  }, [trades]);

  const filteredTrades = useMemo(() => {
    return sortedTrades.filter((trade) => {
      if (sideFilter !== 'ALL' && String(trade.side || '').toUpperCase() !== sideFilter) {
        return false;
      }
      const pnl = Number(trade.pnl || 0);
      if (resultFilter === 'WIN' && pnl <= 0) return false;
      if (resultFilter === 'LOSS' && pnl >= 0) return false;
      return true;
    });
  }, [sortedTrades, sideFilter, resultFilter]);

  const visibleTrades = filteredTrades.slice(0, pageSize);
  const chartData = buildPnlSeries(sortedTrades);

  const balance = Number(status?.balance?.balance || 0);
  const realized = Number(status?.balance?.realized || 0);
  const winRate = Number(status?.ledgerSummary?.winRate || 0);
  const totalTrades = Number(status?.ledgerSummary?.totalTrades || 0);
  const openTrades = Number(openOrders?.length || 0);

  return (
    <div className="space-y-6">
      <section className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-700 bg-slate-900 p-4">
        <label className="text-xs uppercase tracking-wide text-slate-400" htmlFor="btc-mode">
          Mode
        </label>
        <select
          id="btc-mode"
          value={String(status?.mode || 'PAPER').toLowerCase()}
          onChange={changeMode}
          className="rounded-md border border-slate-600 bg-slate-800 px-2 py-1 text-sm"
        >
          <option value="paper">Paper</option>
          <option value="live">Live</option>
        </select>

        <StatusPill
          label="Trading"
          value={loading ? 'Loading' : status?.tradingEnabled ? 'ON' : 'OFF'}
          variant={status?.tradingEnabled ? 'success' : 'danger'}
        />
        <StatusPill
          label="Kill"
          value={killSwitch?.active ? 'Active' : 'Inactive'}
          variant={killSwitch?.active ? 'danger' : killSwitch?.overrideActive ? 'warning' : 'success'}
        />

        <button
          type="button"
          onClick={startTrading}
          className="rounded-md bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-500"
        >
          Start
        </button>
        <button
          type="button"
          onClick={stopTrading}
          className="rounded-md bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-500"
        >
          Stop
        </button>
      </section>

      <section className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-5">
        <StatCard label="Balance" value={formatCurrency(balance)} />
        <StatCard
          label="Realized P&L"
          value={formatCurrency(realized)}
          color={realized >= 0 ? 'profit' : 'loss'}
        />
        <StatCard label="Win Rate" value={`${winRate.toFixed(2)}%`} color={winRate >= 50 ? 'profit' : 'neutral'} />
        <StatCard label="Total Trades" value={String(totalTrades)} />
        <StatCard label="Open Trades" value={String(openTrades)} />
      </section>

      {/* Live Trading Status */}
      {status && <section className="rounded-lg border border-slate-700 bg-slate-900 p-4">
        <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-400">Live Status</h3>
        <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-3 lg:grid-cols-4">
          {[
            ['Mode', String(status?.mode || '--')],
            ['Market', String(status?.runtime?.marketSlug || '--').replace('btc-updown-5m-', '').slice(0, 12)],
            ['Time Left', status?.runtime?.timeLeftMin != null ? `${Number(status.runtime.timeLeftMin).toFixed(1)}m` : '--'],
            ['BTC', status?.runtime?.btcPrice ? `$${Number(status.runtime.btcPrice).toLocaleString()}` : '--'],
            ['Poly UP / DOWN', status?.runtime?.polyUp != null ? `${Number(status.runtime.polyUp).toFixed(2)}¢ / ${Number(status.runtime.polyDown).toFixed(2)}¢` : '--'],
            ['Model', status?.runtime?.modelUp != null ? `U ${(Number(status.runtime.modelUp) * 100).toFixed(1)}% / D ${(Number(status.runtime.modelDown) * 100).toFixed(1)}%` : '--'],
            ['RSI', status?.runtime?.rsiNow != null ? Number(status.runtime.rsiNow).toFixed(1) : '--'],
            ['Candles (1m)', String(status?.runtime?.candleCount ?? '--')],
            ['Price Feed', status?.runtime?.lastTickAt ? 'Active' : 'Inactive'],
            ['Entry Gate', status?.entryDebug?.eligible ? 'Open' : 'Blocked'],
            ['Schedule', status?.entryThresholds?.isWeekend ? `Weekend (${status.entryThresholds.pacificDay})` : `Weekday (${status.entryThresholds.pacificDay ?? '--'})`],
            ['Gate Status', status?.entryDebug?.blockers?.length ? status.entryDebug.blockers.join(', ') : 'Clear'],
            ['Guardrails', (() => {
              const g = status?.guardrails;
              if (!g) return '--';
              const items = [];
              if (g.lossCooldownActive) items.push(`Loss CD ${Math.ceil(g.lossCooldownRemainingMs / 1000)}s`);
              if (g.winCooldownActive) items.push(`Win CD ${Math.ceil(g.winCooldownRemainingMs / 1000)}s`);
              if (g.circuitBreakerTripped) items.push('Circuit Breaker');
              if (g.hasOpenPosition) items.push('Open Position');
              return items.length ? items.join(', ') : 'Clear';
            })()],
            ['Kill Switch', status?.killSwitch?.active ? `Active (PnL $${Number(status.killSwitch.todayPnl).toFixed(2)} / -$${Number(status.killSwitch.limit).toFixed(0)})` : 'Inactive'],
            ['Rec', status?.runtime?.recAction ? `${status.runtime.recAction} ${status.runtime.recSide ?? ''} (${status.runtime.recPhase ?? ''})` : 'None'],
            ['Spread UP/DN', status?.runtime?.spreadUp != null ? `${Number(status.runtime.spreadUp).toFixed(1)}¢ / ${Number(status.runtime.spreadDown).toFixed(1)}¢` : '--'],
          ].map(([label, value]) => (
            <div key={label} className="flex justify-between border-b border-slate-800 py-1">
              <span className="text-slate-400">{label}</span>
              <span className={
                value === 'Active' || value === 'Open' || value === 'Clear'
                  ? 'text-emerald-400'
                  : value === 'Blocked' || value === 'Inactive' || value.startsWith('Active (')
                    ? 'text-amber-400'
                    : 'text-slate-200'
              }>{value}</span>
            </div>
          ))}
        </div>
      </section>}

      <section className="rounded-lg border border-slate-700 bg-slate-900">
        <div className="flex gap-2 border-b border-slate-700 p-3">
          <button
            type="button"
            onClick={() => setActiveTab('dashboard')}
            className={`rounded-md px-3 py-1.5 text-sm font-medium ${
              activeTab === 'dashboard'
                ? 'bg-emerald-500/20 text-emerald-300 ring-1 ring-emerald-500/40'
                : 'bg-slate-800 text-slate-300'
            }`}
          >
            Dashboard
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('trades')}
            className={`rounded-md px-3 py-1.5 text-sm font-medium ${
              activeTab === 'trades'
                ? 'bg-emerald-500/20 text-emerald-300 ring-1 ring-emerald-500/40'
                : 'bg-slate-800 text-slate-300'
            }`}
          >
            Trades
          </button>
        </div>

        {activeTab === 'dashboard' ? (
          <div className="h-80 p-4">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData}>
                <CartesianGrid stroke="#334155" strokeDasharray="4 4" />
                <XAxis dataKey="time" stroke="#94a3b8" minTickGap={30} />
                <YAxis stroke="#94a3b8" tickFormatter={(v) => formatCurrency(v)} width={90} />
                <Tooltip
                  contentStyle={{ backgroundColor: '#0f172a', border: '1px solid #334155', borderRadius: 8 }}
                  formatter={(v) => formatCurrency(v)}
                />
                <Line type="monotone" dataKey="pnl" stroke="#10b981" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <div className="p-4">
            <div className="mb-3 flex flex-wrap gap-2">
              <select
                value={sideFilter}
                onChange={(e) => setSideFilter(e.target.value)}
                className="rounded-md border border-slate-600 bg-slate-800 px-2 py-1 text-sm"
              >
                <option value="ALL">Side: ALL</option>
                <option value="UP">Side: UP</option>
                <option value="DOWN">Side: DOWN</option>
              </select>

              <select
                value={resultFilter}
                onChange={(e) => setResultFilter(e.target.value)}
                className="rounded-md border border-slate-600 bg-slate-800 px-2 py-1 text-sm"
              >
                <option value="ALL">Result: ALL</option>
                <option value="WIN">Result: WIN</option>
                <option value="LOSS">Result: LOSS</option>
              </select>

              <select
                value={pageSize}
                onChange={(e) => setPageSize(Number(e.target.value))}
                className="rounded-md border border-slate-600 bg-slate-800 px-2 py-1 text-sm"
              >
                <option value={20}>Show: 20</option>
                <option value={25}>Show: 25</option>
                <option value={50}>Show: 50</option>
                <option value={100}>Show: 100</option>
              </select>
            </div>

            <div className="overflow-x-auto rounded-md border border-slate-700">
              <table className="min-w-full text-sm">
                <thead className="bg-slate-800 text-left text-slate-200">
                  <tr>
                    <th className="px-3 py-2">Entry Time</th>
                    <th className="px-3 py-2">Exit Time</th>
                    <th className="px-3 py-2">Side</th>
                    <th className="px-3 py-2">Entry Price</th>
                    <th className="px-3 py-2">Exit Price</th>
                    <th className="px-3 py-2">PnL</th>
                    <th className="px-3 py-2">Exit Reason</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleTrades.map((trade, index) => {
                    const pnl = Number(trade.pnl || 0);
                    return (
                      <tr
                        key={String(trade.id || `${trade.entryTime}-${index}`)}
                        className={index % 2 === 0 ? 'bg-slate-900' : 'bg-slate-950'}
                      >
                        <td className="px-3 py-2">{formatTime(trade.entryTime)}</td>
                        <td className="px-3 py-2">{formatTime(trade.exitTime || trade.timestamp)}</td>
                        <td className="px-3 py-2">{String(trade.side || '--')}</td>
                        <td className="px-3 py-2">{formatCurrency(trade.entryPrice)}</td>
                        <td className="px-3 py-2">{formatCurrency(trade.exitPrice)}</td>
                        <td className={`px-3 py-2 ${pnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                          {formatCurrency(pnl)}
                        </td>
                        <td className="px-3 py-2">{String(trade.exitReason || '--')}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
