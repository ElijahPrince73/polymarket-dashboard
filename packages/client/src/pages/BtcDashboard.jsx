import { useState } from 'react';
import { Line, LineChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { startBtcTrading, stopBtcTrading } from '../api/btc.js';
import StatCard from '../components/StatCard.jsx';
import StatusBadge from '../components/StatusBadge.jsx';
import { useApi } from '../hooks/useApi.js';

const currency = (value) =>
  new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number(value ?? 0));

const asData = (input) => (input && typeof input === 'object' && input.data ? input.data : input);

export default function BtcDashboard() {
  const statusQuery = useApi('/api/btc/status');
  const tradesQuery = useApi('/api/btc/trades');
  const analyticsQuery = useApi('/api/btc/analytics');
  const [controlError, setControlError] = useState('');

  const handleControl = async (action) => {
    setControlError('');
    try {
      if (action === 'start') {
        await startBtcTrading();
      } else {
        await stopBtcTrading();
      }
      statusQuery.refetch();
    } catch (err) {
      setControlError(err instanceof Error ? err.message : 'Failed to update trading status');
    }
  };

  const status = asData(statusQuery.data) || {};
  const trades = Array.isArray(asData(tradesQuery.data)) ? asData(tradesQuery.data) : [];
  const analytics = asData(analyticsQuery.data) || {};
  const chartSource = Array.isArray(analytics.pnlHistory)
    ? analytics.pnlHistory
    : trades.slice(-50).map((trade) => ({
        time: trade.timestamp || trade.created_at,
        pnl: trade.pnl || trade.profit || 0,
      }));

  const chartData = chartSource.map((point, index) => ({
    name: point.time ? new Date(point.time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : `${index + 1}`,
    pnl: Number(point.pnl ?? 0),
  }));

  const currentPnl = Number(status.pnl ?? status.totalPnl ?? analytics.totalPnl ?? 0);

  if (statusQuery.loading || tradesQuery.loading || analyticsQuery.loading) {
    return <p className="text-slate-300">Loading...</p>;
  }

  if (statusQuery.error || tradesQuery.error || analyticsQuery.error) {
    return <p className="text-red-400">{statusQuery.error || tradesQuery.error || analyticsQuery.error}</p>;
  }

  return (
    <section className="space-y-6">
      <header>
        <h2 className="text-2xl font-semibold">BTC Dashboard</h2>
        <p className="text-slate-400">Live status, position, and analytics for BTC trader.</p>
      </header>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-xl border border-slate-800 bg-slate-900 p-4">
          <p className="mb-2 text-xs uppercase tracking-wide text-slate-400">Trading Status</p>
          <StatusBadge status={status.tradingEnabled ? 'Running' : status.mode || 'Unknown'} />
        </div>
        <StatCard label="Current Position" value={status.position ?? status.currentPosition ?? 'Flat'} />
        <StatCard label="Total P&L" value={currency(currentPnl)} color={currentPnl >= 0 ? 'profit' : 'loss'} />
        <StatCard label="Trades" value={status.tradeCount ?? trades.length ?? 0} />
      </div>

      <div className="rounded-xl border border-slate-800 bg-slate-900 p-4">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-lg font-semibold">P&L Trend</h3>
        </div>
        <div className="h-72">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
              <XAxis dataKey="name" stroke="#94a3b8" />
              <YAxis stroke="#94a3b8" />
              <Tooltip
                contentStyle={{ backgroundColor: '#0f172a', border: '1px solid #334155' }}
                formatter={(value) => currency(value)}
              />
              <Line type="monotone" dataKey="pnl" stroke="#10b981" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-xl border border-slate-800 bg-slate-900 p-4">
          <h3 className="mb-3 text-lg font-semibold">Current Config</h3>
          <pre className="max-h-64 overflow-auto rounded-md bg-slate-950 p-3 text-xs text-slate-300">
            {JSON.stringify(status.config || analytics.config || {}, null, 2)}
          </pre>
        </div>

        <div className="rounded-xl border border-slate-800 bg-slate-900 p-4">
          <h3 className="mb-3 text-lg font-semibold">Trading Controls</h3>
          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              onClick={() => handleControl('start')}
              className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500"
            >
              Start Trading
            </button>
            <button
              type="button"
              onClick={() => handleControl('stop')}
              className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-500"
            >
              Stop Trading
            </button>
          </div>
          {controlError ? <p className="mt-3 text-sm text-red-400">{controlError}</p> : null}
        </div>
      </div>
    </section>
  );
}
