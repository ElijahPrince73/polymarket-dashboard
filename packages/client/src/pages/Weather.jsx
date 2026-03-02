import { useMemo, useState } from 'react';
import { killWeather, setWeatherMode, triggerWeatherTick } from '../api/weather.js';
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

function formatDate(value) {
  if (!value) return '--';
  return new Date(value).toLocaleString('en-US', {
    month: '2-digit',
    day: '2-digit',
    year: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function normalizeCityRows(byCity) {
  if (Array.isArray(byCity)) {
    return byCity.map((entry) => ({
      city: String(entry.city || entry.name || 'Unknown'),
      trades: Number(entry.trades || 0),
      wins: Number(entry.wins || 0),
      losses: Number(entry.losses || 0),
      pnl: Number(entry.pnl || 0),
    }));
  }

  if (byCity && typeof byCity === 'object') {
    return Object.entries(byCity).map(([city, stats]) => ({
      city: String(city),
      trades: Number(stats?.trades || 0),
      wins: Number(stats?.wins || 0),
      losses: Number(stats?.losses || 0),
      pnl: Number(stats?.pnl || 0),
    }));
  }

  return [];
}

export default function Weather() {
  const { data: status, loading, refetch: refetchStatus } = useApi('/api/weather/status');
  const { data: trades, refetch: refetchTrades } = useApi('/api/weather/trades');
  const { data: summary, refetch: refetchSummary } = useApi('/api/weather/summary');

  const [cityFilter, setCityFilter] = useState('ALL');
  const [resultFilter, setResultFilter] = useState('ALL');
  const [pageSize, setPageSize] = useState(20);

  async function refreshAll() {
    await Promise.all([refetchStatus(), refetchTrades(), refetchSummary()]);
  }

  async function changeMode(event) {
    await setWeatherMode(event.target.value);
    await refreshAll();
  }

  async function handleTick() {
    await triggerWeatherTick();
    await refreshAll();
  }

  async function handleKill() {
    await killWeather();
    await refreshAll();
  }

  const rolling = summary?.rolling || {};
  const cityRows = normalizeCityRows(rolling.byCity);

  const openPositions = useMemo(() => {
    return (trades || []).filter((trade) => String(trade.status || '').toUpperCase() === 'OPEN');
  }, [trades]);

  const resolvedTrades = useMemo(() => {
    return (trades || [])
      .filter((trade) => ['WIN', 'LOSS'].includes(String(trade.result || '').toUpperCase()))
      .sort(
        (a, b) =>
          new Date(b.resolved_at || b.created_at || 0).getTime() -
          new Date(a.resolved_at || a.created_at || 0).getTime()
      );
  }, [trades]);

  const filteredResolved = useMemo(() => {
    return resolvedTrades.filter((trade) => {
      const city = String(trade.city || 'Unknown');
      const result = String(trade.result || '').toUpperCase();
      if (cityFilter !== 'ALL' && city !== cityFilter) return false;
      if (resultFilter !== 'ALL' && result !== resultFilter) return false;
      return true;
    });
  }, [resolvedTrades, cityFilter, resultFilter]);

  const visibleResolved = filteredResolved.slice(0, pageSize);
  const allCities = Array.from(
    new Set((trades || []).map((trade) => String(trade.city || 'Unknown')).filter(Boolean))
  ).sort();

  const balance = Number(status?.bankroll || 0);
  const realized = Number(rolling.pnl || 0);
  const openTrades = Number(status?.openTrades || 0);
  const totalTrades = Number(rolling.trades || 0);
  const winRate = totalTrades > 0 ? (Number(rolling.wins || 0) / totalTrades) * 100 : 0;

  return (
    <div className="space-y-6">
      <section className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-700 bg-slate-900 p-4">
        <label className="text-xs uppercase tracking-wide text-slate-400" htmlFor="weather-mode">
          Mode
        </label>
        <select
          id="weather-mode"
          value={String(status?.tradingMode || 'paper').toLowerCase()}
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

        <button
          type="button"
          onClick={handleTick}
          className="rounded-md bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-500"
        >
          Start Tick
        </button>
        <button
          type="button"
          onClick={handleKill}
          className="rounded-md bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-500"
        >
          Kill
        </button>
      </section>

      <section className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-5">
        <StatCard label="Balance" value={formatCurrency(balance)} />
        <StatCard
          label="Realized P&L"
          value={formatCurrency(realized)}
          color={realized >= 0 ? 'profit' : 'loss'}
        />
        <StatCard label="Open Trades" value={String(openTrades)} />
        <StatCard label="Win Rate" value={`${winRate.toFixed(2)}%`} color={winRate >= 50 ? 'profit' : 'neutral'} />
        <StatCard label="Total Trades" value={String(totalTrades)} />
      </section>

      <section>
        <h2 className="mb-3 text-lg font-semibold">City Performance</h2>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
          {cityRows.map((row) => (
            <article key={row.city} className="rounded-lg border border-slate-700 bg-slate-900 p-4">
              <h3 className="text-sm font-semibold text-slate-200">{row.city}</h3>
              <div className="mt-2 grid grid-cols-2 gap-2 text-sm">
                <p className="text-slate-400">Trades</p>
                <p>{String(row.trades)}</p>
                <p className="text-slate-400">Wins</p>
                <p>{String(row.wins)}</p>
                <p className="text-slate-400">Losses</p>
                <p>{String(row.losses)}</p>
                <p className="text-slate-400">P&L</p>
                <p className={row.pnl >= 0 ? 'text-emerald-400' : 'text-red-400'}>{formatCurrency(row.pnl)}</p>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="rounded-lg border border-slate-700 bg-slate-900 p-4">
        <h2 className="mb-3 text-lg font-semibold">Open Positions</h2>
        <div className="space-y-2">
          {openPositions.map((trade, index) => (
            <div
              key={String(trade.id || `${trade.city}-${index}`)}
              className="rounded-md border border-slate-700 bg-slate-950 p-3"
            >
              <p className="font-medium text-slate-100">{String(trade.question || '--')}</p>
              <p className="mt-1 text-sm text-slate-300">
                {String(trade.city || 'Unknown')} | {String(trade.side || '--')} | Entry{' '}
                {formatCurrency(trade.entry_price)} | Stake {formatCurrency(trade.stake_usd)} |{' '}
                {formatDate(trade.event_date)}
              </p>
            </div>
          ))}
          {openPositions.length === 0 ? <p className="text-sm text-slate-400">No open positions.</p> : null}
        </div>
      </section>

      <section className="rounded-lg border border-slate-700 bg-slate-900 p-4">
        <h2 className="mb-3 text-lg font-semibold">Resolved Trades</h2>
        <div className="mb-3 flex flex-wrap gap-2">
          <select
            value={cityFilter}
            onChange={(e) => setCityFilter(e.target.value)}
            className="rounded-md border border-slate-600 bg-slate-800 px-2 py-1 text-sm"
          >
            <option value="ALL">City: ALL</option>
            {allCities.map((city) => (
              <option key={city} value={city}>
                {city}
              </option>
            ))}
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
                <th className="px-3 py-2">City</th>
                <th className="px-3 py-2">Date</th>
                <th className="px-3 py-2">Side</th>
                <th className="px-3 py-2">Result</th>
                <th className="px-3 py-2">P&L</th>
                <th className="px-3 py-2">Entry Price</th>
                <th className="px-3 py-2">Question</th>
                <th className="px-3 py-2">Resolved Date</th>
              </tr>
            </thead>
            <tbody>
              {visibleResolved.map((trade, index) => {
                const pnl = Number(trade.pnl || 0);
                return (
                  <tr key={String(trade.id || `${trade.city}-${index}`)} className={index % 2 === 0 ? 'bg-slate-900' : 'bg-slate-950'}>
                    <td className="px-3 py-2">{String(trade.city || 'Unknown')}</td>
                    <td className="px-3 py-2">{formatDate(trade.event_date || trade.created_at)}</td>
                    <td className="px-3 py-2">{String(trade.side || '--')}</td>
                    <td className="px-3 py-2">{String(trade.result || '--')}</td>
                    <td className={`px-3 py-2 ${pnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                      {formatCurrency(pnl)}
                    </td>
                    <td className="px-3 py-2">{formatCurrency(trade.entry_price)}</td>
                    <td className="max-w-xs truncate px-3 py-2">{String(trade.question || '--')}</td>
                    <td className="px-3 py-2">{formatDate(trade.resolved_at)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
