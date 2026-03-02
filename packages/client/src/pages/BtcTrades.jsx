import { useState } from 'react';
import TradeTable from '../components/TradeTable.jsx';
import { useApi } from '../hooks/useApi.js';

const asArray = (value) => {
  if (Array.isArray(value)) return value;
  if (value && typeof value === 'object' && Array.isArray(value.data)) return value.data;
  return [];
};

export default function BtcTrades() {
  const { data, loading, error } = useApi('/api/btc/trades');
  const [query, setQuery] = useState('');

  const trades = asArray(data);
  const filtered = (() => {
    const text = query.trim().toLowerCase();
    if (!text) return trades;

    return trades.filter((trade) => JSON.stringify(trade).toLowerCase().includes(text));
  })();

  if (loading) return <p className="text-slate-300">Loading...</p>;
  if (error) return <p className="text-red-400">{error}</p>;

  return (
    <section className="space-y-4">
      <header>
        <h2 className="text-2xl font-semibold">BTC Trades</h2>
        <p className="text-slate-400">Full BTC trade history with quick filtering.</p>
      </header>

      <input
        type="text"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="Filter by market, side, id..."
        className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 outline-none ring-emerald-500 focus:ring"
      />

      <TradeTable trades={filtered} />
    </section>
  );
}
