import StatCard from '../components/StatCard.jsx';
import StatusBadge from '../components/StatusBadge.jsx';
import TradeTable from '../components/TradeTable.jsx';
import { useApi } from '../hooks/useApi.js';

const currency = (value) =>
  new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number(value ?? 0));

const asData = (input) => (input && typeof input === 'object' && input.data ? input.data : input);

export default function WeatherDashboard() {
  const statusQuery = useApi('/api/weather/status');
  const tradesQuery = useApi('/api/weather/trades');
  const summaryQuery = useApi('/api/weather/summary');

  if (statusQuery.loading || tradesQuery.loading || summaryQuery.loading) {
    return <p className="text-slate-300">Loading...</p>;
  }

  if (statusQuery.error || tradesQuery.error || summaryQuery.error) {
    return <p className="text-red-400">{statusQuery.error || tradesQuery.error || summaryQuery.error}</p>;
  }

  const status = asData(statusQuery.data) || {};
  const tradesData = asData(tradesQuery.data);
  const trades = Array.isArray(tradesData) ? tradesData : [];
  const summary = asData(summaryQuery.data) || {};

  const activeMarkets = summary.activeMarkets ?? status.activeMarkets ?? 0;
  const cities = Array.isArray(summary.cities)
    ? summary.cities
    : Array.isArray(status.cities)
      ? status.cities
      : [];
  const pnl = Number(summary.pnl ?? status.pnl ?? summary.totalPnl ?? 0);

  return (
    <section className="space-y-6">
      <header>
        <h2 className="text-2xl font-semibold">Weather Dashboard</h2>
        <p className="text-slate-400">Monitor weather bot status, city markets, and performance.</p>
      </header>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-xl border border-slate-800 bg-slate-900 p-4">
          <p className="mb-2 text-xs uppercase tracking-wide text-slate-400">Bot Status</p>
          <StatusBadge status={status.status || status.mode || 'Unknown'} />
        </div>
        <StatCard label="Active Markets" value={activeMarkets} />
        <StatCard label="Total P&L" value={currency(pnl)} color={pnl >= 0 ? 'profit' : 'loss'} />
        <StatCard label="Trade Count" value={status.tradeCount ?? trades.length ?? 0} />
      </div>

      <div className="rounded-xl border border-slate-800 bg-slate-900 p-4">
        <h3 className="mb-3 text-lg font-semibold">City Grid</h3>
        {cities.length ? (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {cities.map((city, index) => (
              <div key={city.name ?? city.city ?? index} className="rounded-lg border border-slate-700 bg-slate-950 p-3">
                <p className="font-medium">{city.name ?? city.city ?? `City ${index + 1}`}</p>
                <p className="text-sm text-slate-400">Markets: {city.marketCount ?? city.markets ?? 0}</p>
                <p className="text-sm text-slate-400">P&L: {currency(city.pnl ?? 0)}</p>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-slate-400">No city data available.</p>
        )}
      </div>

      <div>
        <h3 className="mb-3 text-lg font-semibold">Recent Trades</h3>
        <TradeTable trades={trades.slice(0, 20)} />
      </div>
    </section>
  );
}
