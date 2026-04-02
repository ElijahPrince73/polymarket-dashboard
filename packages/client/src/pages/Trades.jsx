import { useMemo, useState } from 'react';
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

function toTimestamp(value) {
  if (!value) return 0;
  const time = new Date(value).getTime();
  return Number.isNaN(time) ? 0 : time;
}

function normalizeBtcTrades(trades) {
  return (trades || []).map((trade, index) => ({
    id: String(trade?.id || `btc-${index}`),
    market: 'BTC',
    entryTime: trade?.entryTime || trade?.timestamp || null,
    exitTime: trade?.exitTime || trade?.timestamp || null,
    side: String(trade?.side || '--').toUpperCase(),
    stake: Number(trade?.stakeUsd || trade?.stake || trade?.stake_usd || 0),
    entryPrice: Number(trade?.entryPrice || trade?.entry_price || trade?.entryPolyPrice || 0),
    exitDisplay:
      trade?.exitPrice != null
        ? Number(trade.exitPrice)
        : trade?.exit_price != null
          ? Number(trade.exit_price)
          : null,
    pnl: Number(trade?.pnl || 0),
    exitMeta: String(trade?.exitReason || trade?.reason || '--'),
    session: String(trade?.tradingSession || '--'),
    result:
      trade?.result != null
        ? String(trade.result).toUpperCase()
        : Number(trade?.pnl || 0) >= 0
          ? 'WIN'
          : 'LOSS',
  }));
}

function normalizeWeatherTrades(trades) {
  return (trades || []).map((trade, index) => ({
    id: String(trade?.id || `weather-${index}`),
    market: 'Weather',
    entryTime: trade?.created_at || null,
    exitTime: trade?.resolved_at || null,
    side: String(trade?.side || '--').toUpperCase(),
    stake: Number(trade?.stake_usd || 0),
    entryPrice: Number(trade?.entry_price || 0),
    exitDisplay: '--',
    pnl: Number(trade?.pnl || 0),
    exitMeta: String(trade?.city || '--'),
    result:
      trade?.result != null
        ? String(trade.result).toUpperCase()
        : Number(trade?.pnl || 0) >= 0
          ? 'WIN'
          : 'LOSS',
  }));
}

const sortableColumns = {
  market: (row) => row.market,
  entryTime: (row) => toTimestamp(row.entryTime),
  exitTime: (row) => toTimestamp(row.exitTime),
  side: (row) => row.side,
  stake: (row) => Number(row.stake || 0),
  entryPrice: (row) => Number(row.entryPrice || 0),
  exitDisplay: (row) => (typeof row.exitDisplay === 'number' ? row.exitDisplay : Number.NEGATIVE_INFINITY),
  pnl: (row) => Number(row.pnl || 0),
  exitMeta: (row) => row.exitMeta,
  session: (row) => row.session,
};

function filterClass() {
  return 'nothing-input px-4 py-2';
}

export default function Trades() {
  const { data: btcTrades } = useApi('/api/btc/trades');
  const { data: weatherTrades } = useApi('/api/weather/trades');

  const [marketFilter, setMarketFilter] = useState('ALL');
  const [resultFilter, setResultFilter] = useState('ALL');
  const [sideFilter, setSideFilter] = useState('ALL');
  const [pageSize, setPageSize] = useState('20');
  const [sortBy, setSortBy] = useState('exitTime');
  const [sortDir, setSortDir] = useState('desc');

  const unifiedTrades = useMemo(() => {
    return [...normalizeBtcTrades(btcTrades), ...normalizeWeatherTrades(weatherTrades)];
  }, [btcTrades, weatherTrades]);

  const filteredTrades = useMemo(() => {
    return unifiedTrades.filter((row) => {
      if (marketFilter !== 'ALL' && row.market !== marketFilter) return false;
      if (resultFilter !== 'ALL' && row.result !== resultFilter) return false;
      if (sideFilter !== 'ALL' && row.side !== sideFilter) return false;
      return true;
    });
  }, [unifiedTrades, marketFilter, resultFilter, sideFilter]);

  const sortedTrades = useMemo(() => {
    const getter = sortableColumns[sortBy] || sortableColumns.exitTime;
    const direction = sortDir === 'asc' ? 1 : -1;

    return [...filteredTrades].sort((a, b) => {
      const av = getter(a);
      const bv = getter(b);

      if (typeof av === 'string' || typeof bv === 'string') {
        return String(av).localeCompare(String(bv)) * direction;
      }
      return (Number(av || 0) - Number(bv || 0)) * direction;
    });
  }, [filteredTrades, sortBy, sortDir]);

  const visibleTrades = useMemo(() => {
    if (pageSize === 'ALL') return sortedTrades;
    const limit = Number(pageSize || 20);
    return sortedTrades.slice(0, limit);
  }, [sortedTrades, pageSize]);

  const uniqueSides = useMemo(() => {
    const values = new Set(unifiedTrades.map((trade) => trade.side));
    return Array.from(values).filter(Boolean).sort();
  }, [unifiedTrades]);

  function toggleSort(column) {
    if (sortBy === column) {
      setSortDir((current) => (current === 'asc' ? 'desc' : 'asc'));
      return;
    }
    setSortBy(column);
    setSortDir('desc');
  }

  function SortHeader({ column, label }) {
    const active = sortBy === column;
    return (
      <button
        type="button"
        onClick={() => toggleSort(column)}
        className="font-['Space_Mono'] text-[11px] tracking-[0.08em] uppercase text-[var(--text-secondary)]"
      >
        {label} {active ? (sortDir === 'asc' ? '↑' : '↓') : '↕'}
      </button>
    );
  }

  return (
    <div className="space-y-6">
      <section className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="nothing-section-title">Trade Ledger</p>
          <h1 className="nothing-page-title mt-3">Unified Trades</h1>
        </div>
        <p className="nothing-meta">{filteredTrades.length} matching rows</p>
      </section>

      <section className="nothing-card p-5">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
          <select value={marketFilter} onChange={(event) => setMarketFilter(event.target.value)} className={filterClass()}>
            <option value="ALL">Market: All</option>
            <option value="BTC">Market: BTC</option>
            <option value="Weather">Market: Weather</option>
          </select>

          <select value={resultFilter} onChange={(event) => setResultFilter(event.target.value)} className={filterClass()}>
            <option value="ALL">Result: All</option>
            <option value="WIN">Result: Win</option>
            <option value="LOSS">Result: Loss</option>
          </select>

          <select value={sideFilter} onChange={(event) => setSideFilter(event.target.value)} className={filterClass()}>
            <option value="ALL">Side: All</option>
            {uniqueSides.map((side) => (
              <option key={side} value={side}>
                Side: {side}
              </option>
            ))}
          </select>

          <select value={pageSize} onChange={(event) => setPageSize(event.target.value)} className={filterClass()}>
            <option value="20">Show: 20</option>
            <option value="50">Show: 50</option>
            <option value="100">Show: 100</option>
            <option value="ALL">Show: All</option>
          </select>
        </div>
      </section>

      <section className="nothing-card overflow-x-auto">
        <table className="nothing-table min-w-full">
          <thead>
            <tr>
              <th><SortHeader column="market" label="Market" /></th>
              <th><SortHeader column="entryTime" label="Entry Time" /></th>
              <th><SortHeader column="exitTime" label="Exit Time" /></th>
              <th><SortHeader column="side" label="Side" /></th>
              <th><SortHeader column="stake" label="Stake" /></th>
              <th><SortHeader column="entryPrice" label="Entry Price" /></th>
              <th><SortHeader column="exitDisplay" label="Exit Price / Result" /></th>
              <th><SortHeader column="pnl" label="P&L" /></th>
              <th><SortHeader column="session" label="Session" /></th>
              <th><SortHeader column="exitMeta" label="Exit Reason / City" /></th>
            </tr>
          </thead>
          <tbody>
            {visibleTrades.map((row) => (
              <tr key={`${row.market}-${row.id}`}>
                <td data-mono="true">
                  <span className="nothing-tag inline-flex px-3 py-1">{row.market}</span>
                </td>
                <td data-mono="true" className="text-[var(--text-secondary)]">{formatDateTime(row.entryTime)}</td>
                <td data-mono="true" className="text-[var(--text-secondary)]">{formatDateTime(row.exitTime)}</td>
                <td data-mono="true">{row.side}</td>
                <td data-mono="true">{formatCurrency(row.stake)}</td>
                <td data-mono="true">{formatCurrency(row.entryPrice)}</td>
                <td data-mono="true">
                  {typeof row.exitDisplay === 'number' ? formatCurrency(row.exitDisplay) : row.exitDisplay}
                </td>
                <td data-mono="true" className={row.pnl >= 0 ? 'text-[var(--success)]' : 'text-[var(--accent)]'}>
                  {formatCurrency(row.pnl)}
                </td>
                <td data-mono="true" className="text-[var(--text-secondary)]">{row.session}</td>
                <td>{row.exitMeta}</td>
              </tr>
            ))}
            {visibleTrades.length === 0 ? (
              <tr>
                <td colSpan={10} className="py-8 text-center text-[var(--text-secondary)]">
                  No trades match filters.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </section>
    </div>
  );
}
