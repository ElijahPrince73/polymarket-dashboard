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

/** Build gate status rows: [check, current, required, pass] */
function buildGateChecks(status) {
  if (!status) return [];
  const rt = status.runtime || {};
  const et = status.entryThresholds || {};
  const g = status.guardrails || {};
  const blockers = status.entryDebug?.blockers || [];
  const isBlocked = (keyword) => blockers.some(b => b.toLowerCase().includes(keyword.toLowerCase()));

  const pct = (v) => `${(Number(v || 0) * 100).toFixed(1)}%`;
  const cents = (v) => `${(Number(v || 0) * 100).toFixed(1)}¢`;

  return [
    {
      check: 'Trading Enabled',
      current: status.tradingEnabled ? 'Yes' : 'No',
      required: 'Yes',
      pass: !!status.tradingEnabled,
    },
    {
      check: 'Recommendation',
      current: rt.recAction ? `${rt.recAction} ${rt.recSide || ''} (${rt.recPhase || ''})` : 'None',
      required: 'BUY signal',
      pass: rt.recAction === 'BUY',
    },
    {
      check: 'Model Probability',
      current: rt.modelUp != null ? `Up ${pct(rt.modelUp)} / Down ${pct(rt.modelDown)}` : '--',
      required: `≥ ${pct(et.minModelMaxProb)}`,
      pass: !isBlocked('strong signal') && !isBlocked('prob') && !isBlocked('conviction'),
    },
    {
      check: 'RSI',
      current: rt.rsiNow != null ? Number(rt.rsiNow).toFixed(1) : '--',
      required: et.noTradeRsiMin != null ? `Outside [${et.noTradeRsiMin}, ${et.noTradeRsiMax}]` : '--',
      pass: !isBlocked('rsi'),
    },
    {
      check: 'Spread',
      current: rt.spreadUp != null ? `Up ${cents(rt.spreadUp)} / Down ${cents(rt.spreadDown)}` : '--',
      required: `≤ ${cents(et.maxSpread)}`,
      pass: !isBlocked('spread'),
    },
    {
      check: 'Entry Price',
      current: rt.polyUp != null ? `Up ${cents(rt.polyUp)} / Down ${cents(rt.polyDown)}` : '--',
      required: `≤ ${cents(et.maxEntryPolyPrice)}`,
      pass: !isBlocked('entry price'),
    },
    {
      check: 'Opposite Price',
      current: '--',
      required: `≥ ${cents(et.minOppositePolyPrice)}`,
      pass: !isBlocked('opposite price'),
    },
    {
      check: 'Liquidity',
      current: rt.liquidityNum != null ? String(Number(rt.liquidityNum).toFixed(0)) : '--',
      required: `≥ ${et.minLiquidity || '--'}`,
      pass: !isBlocked('liquidity'),
    },
    {
      check: 'Range (20-candle)',
      current: rt.rangePct20 != null ? pct(rt.rangePct20) : '--',
      required: `≥ ${pct(et.minRangePct20)}`,
      pass: !isBlocked('choppy') && !isBlocked('range'),
    },
    {
      check: 'BTC Impulse (1m)',
      current: '--',
      required: `≥ ${pct(et.minBtcImpulsePct1m)}`,
      pass: !isBlocked('impulse'),
    },
    {
      check: 'Candles',
      current: String(rt.candleCount ?? '--'),
      required: `≥ ${et.minCandlesForEntry || '--'}`,
      pass: !isBlocked('candle'),
    },
    {
      check: 'Time to Settlement',
      current: rt.timeLeftMin != null ? `${Number(rt.timeLeftMin).toFixed(1)}m` : '--',
      required: `> ${et.noEntryFinalMinutes || 1.5}m`,
      pass: !isBlocked('too late'),
    },
    {
      check: 'Loss Cooldown',
      current: g.lossCooldownActive ? `${Math.ceil((g.lossCooldownRemainingMs || 0) / 1000)}s remaining` : 'Clear',
      required: 'Clear',
      pass: !g.lossCooldownActive,
    },
    {
      check: 'Win Cooldown',
      current: g.winCooldownActive ? `${Math.ceil((g.winCooldownRemainingMs || 0) / 1000)}s remaining` : 'Clear',
      required: 'Clear',
      pass: !g.winCooldownActive,
    },
    {
      check: 'Circuit Breaker',
      current: g.circuitBreakerTripped ? `Tripped (${g.consecutiveLosses} losses)` : `Clear (${g.consecutiveLosses || 0} losses)`,
      required: 'Clear',
      pass: !g.circuitBreakerTripped,
    },
    {
      check: 'Open Position',
      current: g.hasOpenPosition ? 'Yes' : 'No',
      required: 'No',
      pass: !g.hasOpenPosition,
    },
  ];
}

export default function Btc() {
  const { data: status, loading, refetch: refetchStatus } = useApi('/api/btc/status');
  const { data: killSwitch, refetch: refetchKill } = useApi('/api/btc/kill-switch/status');
  const { data: trades, refetch: refetchTrades } = useApi('/api/btc/trades');
  const { data: openOrders, refetch: refetchOpenOrders } = useApi('/api/btc/live/open-orders');
  const { data: portfolio } = useApi('/api/btc/portfolio');

  const [activeTab, setActiveTab] = useState('dashboard');
  const [sideFilter, setSideFilter] = useState('ALL');
  const [resultFilter, setResultFilter] = useState('ALL');
  const [pageSize, setPageSize] = useState(20);

  const isTrading = !!status?.tradingEnabled;

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

  const isLive = String(status?.mode || '').toUpperCase() === 'LIVE';
  const balance = isLive
    ? Number(portfolio?.collateral?.balance || status?.balance?.balance || 0)
    : Number(status?.balance?.balance || 0);
  const realized = Number(status?.balance?.realized || 0);
  const winRate = Number(status?.ledgerSummary?.winRate || 0);
  const totalTrades = Number(status?.ledgerSummary?.totalTrades || 0);
  const openTrades = status?.guardrails?.hasOpenPosition ? 1 : Number(openOrders?.length || 0);

  const gateChecks = useMemo(() => buildGateChecks(status), [status]);

  return (
    <div className="space-y-6">
      {/* Controls Bar */}
      <section className="flex flex-wrap items-center gap-3 rounded-lg border border-slate-700 bg-slate-900 p-4">
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
          value={loading ? 'Loading' : isTrading ? 'ON' : 'OFF'}
          variant={isTrading ? 'success' : 'danger'}
        />
        <StatusPill
          label="Kill Switch"
          value={killSwitch?.active ? 'Active' : 'Inactive'}
          variant={killSwitch?.active ? 'danger' : killSwitch?.overrideActive ? 'warning' : 'success'}
        />

        <div className="ml-auto flex gap-2">
          <button
            type="button"
            onClick={startTrading}
            disabled={isTrading}
            className={`rounded-md px-4 py-1.5 text-sm font-medium text-white ${
              isTrading
                ? 'cursor-not-allowed bg-slate-600 opacity-50'
                : 'bg-emerald-600 hover:bg-emerald-500'
            }`}
          >
            Start
          </button>
          <button
            type="button"
            onClick={stopTrading}
            disabled={!isTrading}
            className={`rounded-md px-4 py-1.5 text-sm font-medium text-white ${
              !isTrading
                ? 'cursor-not-allowed bg-slate-600 opacity-50'
                : 'bg-red-600 hover:bg-red-500'
            }`}
          >
            Stop
          </button>
        </div>
      </section>

      {/* Stats */}
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

      {/* Active Trade */}
      {status?.openTrade && (
        <section className="rounded-lg border border-emerald-700/50 bg-emerald-950/20 p-4">
          <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-emerald-400">Active Trade</h3>
          <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-3 lg:grid-cols-6">
            {[
              ['Side', String(status.openTrade.side || '--')],
              ['Entry Price', formatCurrency(status.openTrade.entryPrice)],
              ['Shares', String(Number(status.openTrade.shares || 0).toFixed(2))],
              ['Contract Size', formatCurrency(status.openTrade.contractSize)],
              ['Entry Time', formatTime(status.openTrade.entryTime || status.openTrade.timestamp)],
              ['Entry Phase', String(status.openTrade.entryPhase || '--')],
              ['Unrealized P&L', (() => {
                const mfe = Number(status.openTrade.maxUnrealizedPnl || 0);
                const mae = Number(status.openTrade.minUnrealizedPnl || 0);
                return `MFE $${mfe.toFixed(2)} / MAE $${mae.toFixed(2)}`;
              })()],
              ['Market', String(status.openTrade.marketSlug || status.runtime?.marketSlug || '--').replace('btc-updown-5m-', '')],
              ['Entry Reason', String(status.openTrade.entryReason || '--')],
            ].map(([label, value]) => (
              <div key={label}>
                <p className="text-slate-400">{label}</p>
                <p className={
                  label === 'Side'
                    ? value === 'UP' ? 'font-semibold text-emerald-400' : 'font-semibold text-red-400'
                    : 'text-slate-200'
                }>{value}</p>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Live Market Info */}
      {status && (
        <section className="rounded-lg border border-slate-700 bg-slate-900 p-4">
          <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-400">Market</h3>
          <div className="grid grid-cols-2 gap-x-8 gap-y-2 text-sm sm:grid-cols-3 lg:grid-cols-4">
            <div>
              <p className="text-slate-400">Market</p>
              <p className="text-slate-200">
                {status.runtime?.marketSlug ? (
                  <a
                    href={`https://polymarket.com/event/${status.runtime.marketSlug}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-blue-400 hover:underline"
                  >
                    {status.runtime.marketSlug.replace('btc-updown-5m-', '5m-')}
                  </a>
                ) : '--'}
              </p>
            </div>
            <div>
              <p className="text-slate-400">Time Left</p>
              <p className="text-slate-200">{status.runtime?.timeLeftMin != null ? `${Number(status.runtime.timeLeftMin).toFixed(1)}m` : '--'}</p>
            </div>
            <div>
              <p className="text-slate-400">BTC Price</p>
              <p className="text-slate-200">{status.runtime?.btcPrice ? `$${Number(status.runtime.btcPrice).toLocaleString()}` : '--'}</p>
            </div>
            <div>
              <p className="text-slate-400">Poly Up / Down</p>
              <p className="text-slate-200">
                {status.runtime?.polyUp != null
                  ? `${(Number(status.runtime.polyUp) * 100).toFixed(1)}¢ / ${(Number(status.runtime.polyDown) * 100).toFixed(1)}¢`
                  : '--'}
              </p>
            </div>
            <div>
              <p className="text-slate-400">Model</p>
              <p className="text-slate-200">
                {status.runtime?.modelUp != null
                  ? `Up ${(Number(status.runtime.modelUp) * 100).toFixed(1)}% / Down ${(Number(status.runtime.modelDown) * 100).toFixed(1)}%`
                  : '--'}
              </p>
            </div>
            <div>
              <p className="text-slate-400">RSI</p>
              <p className="text-slate-200">{status.runtime?.rsiNow != null ? Number(status.runtime.rsiNow).toFixed(1) : '--'}</p>
            </div>
            <div>
              <p className="text-slate-400">Candles (1m)</p>
              <p className="text-slate-200">{String(status.runtime?.candleCount ?? '--')}</p>
            </div>
            <div>
              <p className="text-slate-400">Schedule</p>
              <p className="text-slate-200">
                {status.entryThresholds?.pacificDay ?? '--'} {status.entryThresholds?.pacificHour != null ? `${status.entryThresholds.pacificHour}:00 PT` : ''}
                {status.entryThresholds?.isWeekend ? ' (Weekend)' : ''}
              </p>
            </div>
          </div>
        </section>
      )}

      {/* Gate Status Table */}
      {status && (
        <section className="rounded-lg border border-slate-700 bg-slate-900 p-4">
          <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-400">Gate Status</h3>
          <div className="overflow-x-auto rounded-md border border-slate-700">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-800 text-left text-slate-200">
                <tr>
                  <th className="px-4 py-2 font-medium">Check</th>
                  <th className="px-4 py-2 font-medium">Current</th>
                  <th className="px-4 py-2 font-medium">Required</th>
                </tr>
              </thead>
              <tbody>
                {gateChecks.map((row, i) => (
                  <tr key={row.check} className={i % 2 === 0 ? 'bg-slate-900' : 'bg-slate-950'}>
                    <td className="px-4 py-2 text-slate-300">{row.check}</td>
                    <td className={`px-4 py-2 font-medium ${row.pass ? 'text-emerald-400' : 'text-red-400'}`}>
                      {row.current}
                    </td>
                    <td className="px-4 py-2 text-slate-400">{row.required}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {status.entryDebug?.eligible && (
            <p className="mt-2 text-sm font-medium text-emerald-400">✓ Entry gate is open — ready to trade</p>
          )}
        </section>
      )}

      {/* Chart / Trades Tabs */}
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
