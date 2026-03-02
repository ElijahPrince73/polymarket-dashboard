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

const asArray = (value) => (Array.isArray(value) ? value : []);

const resolve = (data) => (data && typeof data === 'object' && data.data ? data.data : data);

export default function Overview() {
  const btc = useApi('/api/btc/status');
  const weather = useApi('/api/weather/status');

  if (btc.loading || weather.loading) return <p className="text-slate-300">Loading...</p>;
  if (btc.error || weather.error) {
    return <p className="text-red-400">{btc.error || weather.error}</p>;
  }

  const btcStatus = resolve(btc.data) || {};
  const weatherStatus = resolve(weather.data) || {};

  const btcTrades = asArray(btcStatus.recentTrades || btcStatus.trades || [])
    .slice(0, 5)
    .map((trade) => ({ ...trade, bot: 'BTC' }));
  const weatherTrades = asArray(weatherStatus.recentTrades || weatherStatus.trades || [])
    .slice(0, 5)
    .map((trade) => ({ ...trade, bot: 'Weather' }));
  const combinedTrades = [...btcTrades, ...weatherTrades]
    .sort((a, b) => new Date(b.timestamp || b.created_at || 0) - new Date(a.timestamp || a.created_at || 0))
    .slice(0, 10);

  return (
    <section className="space-y-6">
      <header>
        <h2 className="text-2xl font-semibold">Overview</h2>
        <p className="text-slate-400">Combined status for BTC and Weather trading bots.</p>
      </header>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <div className="rounded-xl border border-slate-800 bg-slate-900 p-4">
          <p className="mb-2 text-xs uppercase tracking-wide text-slate-400">BTC Bot Status</p>
          <StatusBadge status={btcStatus.tradingEnabled ? 'Running' : btcStatus.mode || 'Unknown'} />
        </div>
        <StatCard
          label="BTC P&L"
          value={currency(btcStatus.pnl ?? btcStatus.totalPnl ?? 0)}
          color={(btcStatus.pnl ?? btcStatus.totalPnl ?? 0) >= 0 ? 'profit' : 'loss'}
        />
        <StatCard label="BTC Trades" value={btcStatus.tradeCount ?? asArray(btcStatus.trades).length ?? 0} />

        <div className="rounded-xl border border-slate-800 bg-slate-900 p-4">
          <p className="mb-2 text-xs uppercase tracking-wide text-slate-400">Weather Bot Status</p>
          <StatusBadge status={weatherStatus.status || weatherStatus.mode || 'Unknown'} />
        </div>
        <StatCard
          label="Weather P&L"
          value={currency(weatherStatus.pnl ?? weatherStatus.totalPnl ?? 0)}
          color={(weatherStatus.pnl ?? weatherStatus.totalPnl ?? 0) >= 0 ? 'profit' : 'loss'}
        />
        <StatCard
          label="Weather Trades"
          value={weatherStatus.tradeCount ?? asArray(weatherStatus.trades).length ?? 0}
        />
      </div>

      <div>
        <h3 className="mb-3 text-lg font-semibold">Recent Combined Trades</h3>
        <TradeTable
          trades={combinedTrades}
          columns={[
            { key: 'bot', label: 'Bot' },
            { key: 'market', label: 'Market' },
            { key: 'side', label: 'Side' },
            { key: 'price', label: 'Price' },
            { key: 'pnl', label: 'P&L' },
            { key: 'timestamp', label: 'Timestamp' },
          ]}
        />
      </div>
    </section>
  );
}
