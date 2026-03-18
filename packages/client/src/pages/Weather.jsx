import { useMemo, useState } from 'react';
import { killWeather, setWeatherMode, startWeatherTrading, stopWeatherTrading, triggerWeatherTick } from '../api/weather.js';
import StatCard from '../components/StatCard.jsx';
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

function formatShareCount(value) {
  const amount = Number(value || 0);
  if (!Number.isFinite(amount)) return '0 shares';
  const rounded = Number.isInteger(amount) ? String(amount) : amount.toFixed(2).replace(/\.?0+$/, '');
  return `${rounded} ${Math.abs(amount) === 1 ? 'share' : 'shares'}`;
}

function formatPriceCents(value) {
  const cents = Number(value || 0) * 100;
  if (!Number.isFinite(cents)) return '--';
  return `${cents.toFixed(Number.isInteger(cents) ? 0 : 1)}¢`;
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
  const { data: status, refetch: refetchStatus } = useApi('/api/weather/status');
  const { data: trades, refetch: refetchTrades } = useApi('/api/weather/trades');
  const { data: openOrders, refetch: refetchOpenOrders } = useApi('/api/weather/open-orders');
  const { data: summary, refetch: refetchSummary } = useApi('/api/weather/summary');

  const [cityFilter, setCityFilter] = useState('ALL');
  const [resultFilter, setResultFilter] = useState('ALL');
  const [pageSize, setPageSize] = useState(20);
  const [showLiveConfirm, setShowLiveConfirm] = useState(false);

  async function refreshAll() {
    await Promise.all([refetchStatus(), refetchTrades(), refetchOpenOrders(), refetchSummary()]);
  }

  async function changeMode(newMode) {
    if (newMode === 'live' && !isLive) {
      setShowLiveConfirm(true);
      return;
    }
    await setWeatherMode(newMode);
    await refreshAll();
  }

  async function confirmLiveMode() {
    await setWeatherMode('live');
    setShowLiveConfirm(false);
    await refreshAll();
  }

  async function handleStart() {
    await startWeatherTrading();
    await refreshAll();
  }

  async function handleStop() {
    await stopWeatherTrading();
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
    return (trades || [])
      .filter((trade) => {
        // Show positions where we actually own shares (regardless of status)
        const position = Number(trade.actualPosition || 0);
        const status = String(trade.status || '').toUpperCase();
        // Include positions > 0 that aren't explicitly skipped
        return position > 0 && status !== 'SKIP';
      })
      .sort((a, b) => {
        const dateA = a.event_date || a.created_at || '';
        const dateB = b.event_date || b.created_at || '';
        return dateB.localeCompare(dateA);
      });
  }, [trades]);

  const pendingOrders = useMemo(() => {
    return (trades || [])
      .filter((trade) => String(trade.status || '').toUpperCase() === 'OPEN' && Number(trade.pendingOrderSize || 0) > 0 && trade.orderStillActive)
      .sort((a, b) => {
        const dateA = a.event_date || a.created_at || '';
        const dateB = b.event_date || b.created_at || '';
        return dateB.localeCompare(dateA);
      });
  }, [trades]);

  const resolvedTrades = useMemo(() => {
    return (trades || [])
      .filter((trade) => ['WIN', 'LOSS'].includes(String(trade.result || '').toUpperCase()))
      .sort((a, b) => {
        const dateA = a.event_date || '';
        const dateB = b.event_date || '';
        if (dateA !== dateB) return dateB.localeCompare(dateA);
        return new Date(b.resolved_at || b.created_at || 0).getTime() -
          new Date(a.resolved_at || a.created_at || 0).getTime();
      });
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

  const isTrading = !!status?.tradingEnabled;
  const isLive = String(status?.tradingMode || 'paper').toUpperCase() === 'LIVE';
  const balance = Number(status?.bankroll || 0);
  const realized = Number(rolling.pnl || 0);
  const openOrderCount = Array.isArray(openOrders) ? openOrders.length : 0;
  const totalTrades = Number(rolling.trades || 0);
  const winRate = totalTrades > 0 ? (Number(rolling.wins || 0) / totalTrades) * 100 : 0;

  return (
    <div className="space-y-6">
      {/* Live Mode Confirmation Dialog */}
      {showLiveConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
          <div className="max-w-sm rounded-xl border border-orange-500/50 bg-slate-900 p-6 shadow-2xl">
            <h3 className="text-lg font-bold text-orange-400">⚠️ Switch to Live Trading?</h3>
            <p className="mt-2 text-sm text-slate-300">This will use real USDC from your Polymarket wallet.</p>
            <ul className="mt-2 space-y-1 text-sm text-slate-400">
              <li>• Max per trade: <span className="text-white font-medium">4% of bankroll</span></li>
              <li>• Max daily exposure: <span className="text-white font-medium">25%</span></li>
              <li>• Daily loss stop: <span className="text-white font-medium">5%</span></li>
            </ul>
            <div className="mt-4 flex gap-3">
              <button onClick={confirmLiveMode} className="flex-1 rounded-lg bg-orange-600 px-4 py-2 text-sm font-medium text-white hover:bg-orange-500">
                Yes, Go Live
              </button>
              <button onClick={() => setShowLiveConfirm(false)} className="flex-1 rounded-lg bg-slate-700 px-4 py-2 text-sm font-medium text-slate-300 hover:bg-slate-600">
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Trading Status Banner */}
      {(() => {
        let bannerColor, bannerBg, bannerBorder, dotColor, statusText, statusDetail;

        if (!isTrading) {
          bannerColor = 'text-red-400'; bannerBg = 'bg-red-950/40'; bannerBorder = 'border-red-500/30';
          dotColor = 'bg-red-500'; statusText = 'STOPPED'; statusDetail = 'Trading is disabled';
        } else {
          bannerColor = 'text-emerald-400'; bannerBg = 'bg-emerald-950/40'; bannerBorder = 'border-emerald-500/30';
          dotColor = 'bg-emerald-500'; statusText = 'TRADING';
          statusDetail = status?.lastTickAt
            ? `Last tick: ${new Date(status.lastTickAt).toLocaleTimeString()}`
            : 'Scanning for entries';
        }

        return (
          <section className={`flex flex-wrap items-center gap-2 rounded-lg border ${bannerBorder} ${bannerBg} px-3 py-3 md:gap-3 md:px-4`}>
            <span className="relative flex h-3 w-3">
              <span className={`absolute inline-flex h-full w-full animate-ping rounded-full ${dotColor} opacity-75`} />
              <span className={`relative inline-flex h-3 w-3 rounded-full ${dotColor}`} />
            </span>
            <span className={`text-sm font-bold uppercase tracking-wider ${bannerColor}`}>{statusText}</span>
            <span className="text-xs text-slate-400">{statusDetail}</span>

            <div className="ml-auto flex flex-wrap items-center gap-2 md:gap-3">
              {/* Paper/Live Toggle Switch */}
              <button
                onClick={() => isLive ? changeMode('paper') : setShowLiveConfirm(true)}
                className={`relative inline-flex h-7 w-14 items-center rounded-full transition-colors ${
                  isLive ? 'bg-orange-600' : 'bg-emerald-600'
                }`}
              >
                <span className={`inline-block h-5 w-5 transform rounded-full bg-white shadow-md transition-transform ${
                  isLive ? 'translate-x-8' : 'translate-x-1'
                }`} />
              </button>
              <span className={`text-xs font-bold uppercase tracking-wider ${isLive ? 'text-orange-400' : 'text-emerald-400'}`}>
                {isLive ? 'LIVE' : 'PAPER'}
              </span>

              {/* Start/Stop */}
              <button
                type="button"
                onClick={isTrading ? handleStop : handleStart}
                className={`rounded-lg px-4 py-1.5 text-sm font-medium text-white transition-colors ${
                  isTrading
                    ? 'bg-red-600 hover:bg-red-500'
                    : 'bg-emerald-600 hover:bg-emerald-500'
                }`}
              >
                {isTrading ? 'Stop' : 'Start'}
              </button>

              {/* Run Tick (weather-specific) */}
              <button
                type="button"
                onClick={handleTick}
                className="rounded-lg bg-slate-700 px-4 py-1.5 text-sm font-medium text-white hover:bg-slate-600"
              >
                Run Tick
              </button>
            </div>
          </section>
        );
      })()}

      <section className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <StatCard label="Balance" value={formatCurrency(balance)} />
        <StatCard
          label="Realized P&L"
          value={formatCurrency(realized)}
          color={realized >= 0 ? 'profit' : 'loss'}
        />
        <StatCard label="Open Positions" value={String(openPositions.length)} />
        <StatCard label="Pending Orders" value={String(pendingOrders.length)} />
        <StatCard label="Win Rate" value={`${winRate.toFixed(2)}%`} color={winRate >= 50 ? 'profit' : 'neutral'} />
        <StatCard label="Total Trades" value={String(totalTrades)} />
      </section>

      <section className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <article className="rounded-lg border border-emerald-700/40 bg-slate-900 p-4">
          <div className="mb-3 flex items-center justify-between">
            <div>
              <h2 className="text-lg font-semibold text-slate-100">Open Positions</h2>
              <p className="text-xs text-slate-400">Filled shares with real market exposure.</p>
            </div>
            <span className="rounded-full bg-emerald-500/15 px-2.5 py-1 text-xs font-medium text-emerald-300">
              {openPositions.length} live
            </span>
          </div>
          <div className="space-y-2">
            {openPositions.length > 0 ? openPositions.map((trade, index) => (
              <div
                key={String(trade.id || trade.order_id || `open-position-${index}`)}
                className="rounded-md border border-slate-800 bg-slate-950/70 px-3 py-2"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium text-slate-200">
                      {formatShareCount(trade.actualPosition)} {String(trade.city || 'Unknown')} {String(trade.side || '--')} @ {formatPriceCents(trade.entry_price)}
                    </p>
                    <p className="mt-1 text-xs text-slate-400">{String(trade.question || '--')}</p>
                  </div>
                  <div className="text-right text-xs text-slate-400">
                    <p>{formatDate(trade.event_date || trade.created_at)}</p>
                  </div>
                </div>
              </div>
            )) : (
              <p className="text-sm text-slate-500">No filled positions right now.</p>
            )}
          </div>
        </article>

        <article className="rounded-lg border border-amber-700/40 bg-slate-900 p-4">
          <div className="mb-3 flex items-center justify-between">
            <div>
              <h2 className="text-lg font-semibold text-slate-100">Pending Orders</h2>
              <p className="text-xs text-slate-400">Resting orders on the book. Collateral is reserved, but exposure is not filled yet.</p>
            </div>
            <span className="rounded-full bg-amber-500/15 px-2.5 py-1 text-xs font-medium text-amber-300">
              {pendingOrders.length} active
            </span>
          </div>
          <div className="space-y-2">
            {pendingOrders.length > 0 ? pendingOrders.map((trade, index) => (
              <div
                key={String(trade.order_id || trade.id || `pending-order-${index}`)}
                className="rounded-md border border-slate-800 bg-slate-950/70 px-3 py-2"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium text-slate-200">
                      {formatShareCount(trade.pendingOrderSize)} pending {String(trade.city || 'Unknown')} {String(trade.side || '--')} @ {formatPriceCents(trade.entry_price)}
                    </p>
                    <p className="mt-1 text-xs text-slate-400">{String(trade.question || '--')}</p>
                  </div>
                  <div className="text-right text-xs text-slate-400">
                    <p>{formatDate(trade.event_date || trade.created_at)}</p>
                    <p>{trade.order_id ? `Order ${String(trade.order_id).slice(0, 10)}` : `Live orders ${openOrderCount}`}</p>
                  </div>
                </div>
              </div>
            )) : (
              <p className="text-sm text-slate-500">No active resting orders.</p>
            )}
          </div>
        </article>
      </section>

      <section>
        <h2 className="mb-3 text-lg font-semibold">Cities</h2>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          {(() => {
            // Merge city performance + open positions into unified cards
            const openByCity = {};
            openPositions.forEach((t) => {
              const c = String(t.city || 'Unknown');
              if (!openByCity[c]) openByCity[c] = [];
              openByCity[c].push(t);
            });

            // Build combined city list (cities with data OR open positions)
            const cityMap = {};
            cityRows.forEach((r) => { cityMap[r.city] = r; });
            Object.keys(openByCity).forEach((c) => {
              if (!cityMap[c]) cityMap[c] = { city: c, trades: 0, wins: 0, losses: 0, pnl: 0 };
            });

            // Sort: cities with open positions first, then by PnL descending
            const sorted = Object.values(cityMap).sort((a, b) => {
              const aOpen = (openByCity[a.city] || []).length;
              const bOpen = (openByCity[b.city] || []).length;
              if (aOpen && !bOpen) return -1;
              if (!aOpen && bOpen) return 1;
              return b.pnl - a.pnl;
            });

            return sorted.map((row) => {
              const cityOpen = openByCity[row.city] || [];
              const wr = row.trades > 0 ? ((row.wins / row.trades) * 100).toFixed(0) : '--';
              const hasTrades = row.trades > 0;

              return (
                <article
                  key={row.city}
                  className={`rounded-lg border bg-slate-900 p-4 ${
                    cityOpen.length > 0 ? 'border-emerald-700/50' : 'border-slate-700'
                  }`}
                >
                  {/* City header row */}
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-semibold text-slate-200">{row.city}</h3>
                    <div className="flex items-center gap-3 text-xs">
                      {cityOpen.length > 0 && (
                        <span className="rounded-full bg-emerald-500/20 px-2 py-0.5 text-emerald-400">
                          {cityOpen.length} open
                        </span>
                      )}
                      {hasTrades && (
                        <span className={row.pnl >= 0 ? 'font-semibold text-emerald-400' : 'font-semibold text-red-400'}>
                          {formatCurrency(row.pnl)}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Stats row */}
                  {hasTrades && (
                    <div className="mt-2 flex gap-4 text-xs text-slate-400">
                      <span>{row.wins}W / {row.losses}L</span>
                      <span>WR: {wr}%</span>
                      <span>{row.trades} trades</span>
                    </div>
                  )}

                  {/* Open positions for this city */}
                  {cityOpen.length > 0 && (
                    <div className="mt-3 space-y-1.5 border-t border-slate-700/50 pt-2">
                      {cityOpen.map((trade, i) => {
                        const q = String(trade.question || '').replace(/Will the (highest|lowest) temperature in \w[\w\s]* be /i, '');
                        return (
                          <div key={String(trade.id || `${row.city}-${i}`)} className="flex items-center justify-between text-xs">
                            <span className="text-slate-300 truncate max-w-[60%]" title={trade.question}>{q || '--'}</span>
                            <div className="flex items-center gap-2 text-slate-400">
                              <span className={trade.side === 'YES' ? 'text-emerald-400' : 'text-red-400'}>{trade.side}</span>
                              <span>@{Number(trade.entry_price || 0).toFixed(2)}</span>
                              <span>{formatCurrency(trade.stake_usd)}</span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {/* No data state */}
                  {!hasTrades && cityOpen.length === 0 && (
                    <p className="mt-2 text-xs text-slate-500">No trades yet</p>
                  )}
                </article>
              );
            });
          })()}
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
