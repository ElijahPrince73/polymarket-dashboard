import { useMemo, useState } from 'react';

const numberFormatter = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const dateFormatter = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
});

const formatCell = (key, value) => {
  if (value == null) return '-';

  if (['pnl', 'profit', 'amount', 'price', 'value', 'size'].includes(key) && typeof value === 'number') {
    return numberFormatter.format(value);
  }

  if (key.toLowerCase().includes('time') || key.toLowerCase().includes('date')) {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) {
      return dateFormatter.format(parsed);
    }
  }

  return String(value);
};

const toComparable = (value) => {
  if (value == null) return '';
  if (typeof value === 'number') return value;

  const asDate = new Date(value);
  if (!Number.isNaN(asDate.getTime())) return asDate.getTime();

  const asNumber = Number(value);
  if (!Number.isNaN(asNumber)) return asNumber;

  return String(value).toLowerCase();
};

export default function TradeTable({ trades = [], columns }) {
  const inferredColumns = useMemo(() => {
    if (columns?.length) return columns;
    const sample = trades[0] || {};
    return Object.keys(sample).slice(0, 8).map((key) => ({
      key,
      label: key.replace(/_/g, ' '),
    }));
  }, [columns, trades]);

  const [sortKey, setSortKey] = useState(inferredColumns[0]?.key || '');
  const [sortDirection, setSortDirection] = useState('desc');

  const sortedTrades = useMemo(() => {
    if (!sortKey) return trades;

    return [...trades].sort((a, b) => {
      const aValue = toComparable(a?.[sortKey]);
      const bValue = toComparable(b?.[sortKey]);

      if (aValue === bValue) return 0;
      const order = aValue > bValue ? 1 : -1;
      return sortDirection === 'asc' ? order : -order;
    });
  }, [sortDirection, sortKey, trades]);

  const handleSort = (key) => {
    if (sortKey === key) {
      setSortDirection((prev) => (prev === 'asc' ? 'desc' : 'asc'));
      return;
    }

    setSortKey(key);
    setSortDirection('desc');
  };

  if (!trades.length) {
    return <p className="rounded-xl border border-slate-800 bg-slate-900 p-4 text-slate-400">No trades found.</p>;
  }

  return (
    <div className="overflow-hidden rounded-xl border border-slate-800 bg-slate-900">
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-slate-800 text-left text-sm text-slate-200">
          <thead className="bg-slate-800/70 text-xs uppercase tracking-wide text-slate-400">
            <tr>
              {inferredColumns.map((column) => (
                <th key={column.key} className="px-4 py-3">
                  <button
                    type="button"
                    className="inline-flex items-center gap-1 hover:text-slate-200"
                    onClick={() => handleSort(column.key)}
                  >
                    {column.label}
                    {sortKey === column.key ? (sortDirection === 'asc' ? '↑' : '↓') : ''}
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800/80">
            {sortedTrades.map((trade, index) => (
              <tr key={trade.id ?? `${trade.timestamp ?? 'trade'}-${index}`} className="hover:bg-slate-800/40">
                {inferredColumns.map((column) => (
                  <td key={`${column.key}-${index}`} className="whitespace-nowrap px-4 py-3">
                    {formatCell(column.key, trade?.[column.key])}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
