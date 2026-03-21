import { useMemo } from 'react';
import { Link, useParams } from 'react-router-dom';
import StatCard from '../components/StatCard.jsx';

function ArrowLeftIcon({ className }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className={className}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5 3 12m0 0 7.5-7.5M3 12h18" />
    </svg>
  );
}
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
  try {
    return new Date(value).toLocaleDateString('en-US', { 
      month: 'short', 
      day: 'numeric',
      year: 'numeric'
    });
  } catch {
    return '--';
  }
}

function formatDateTime(value) {
  if (!value) return '--';
  try {
    return new Date(value).toLocaleDateString('en-US', { 
      month: 'short', 
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  } catch {
    return '--';
  }
}

export default function WeatherCity() {
  const { city } = useParams();
  const { data: trades } = useApi('/api/weather/trades');
  const { data: summary } = useApi('/api/weather/summary');
  const { data: liveData } = useApi('/api/weather/live-positions');

  // Filter trades for this specific city
  const cityTrades = useMemo(() => {
    if (!trades) return [];
    return trades.filter(trade => 
      String(trade.city || '').toLowerCase() === String(city || '').toLowerCase()
    );
  }, [trades, city]);

  // Get city performance from summary
  const cityStats = useMemo(() => {
    if (!summary?.rolling?.byCity) return null;
    
    const cityData = summary.rolling.byCity[city];
    if (!cityData) return null;
    
    return {
      trades: cityData.trades || 0,
      wins: cityData.wins || 0,
      losses: cityData.losses || 0,
      winrate: cityData.wins / (cityData.trades || 1),
      pnl: cityData.pnl || 0,
      stake: cityData.stake || 0,
      roi: cityData.roi || 0
    };
  }, [summary, city]);

  // Get live positions for this city
  const livePositions = useMemo(() => {
    if (!liveData) return [];
    const allOrders = [
      ...(liveData.positions || []),
      ...(liveData.pendingOrders || [])
    ];
    return allOrders.filter(order => 
      String(order.city || '').toLowerCase() === String(city || '').toLowerCase()
    );
  }, [liveData, city]);

  // Separate resolved trades by result
  const resolvedTrades = useMemo(() => {
    return cityTrades.filter(trade => ['WIN', 'LOSS'].includes(String(trade.result || '').toUpperCase()));
  }, [cityTrades]);

  const wins = useMemo(() => {
    return resolvedTrades.filter(trade => String(trade.result || '').toUpperCase() === 'WIN');
  }, [resolvedTrades]);

  const losses = useMemo(() => {
    return resolvedTrades.filter(trade => String(trade.result || '').toUpperCase() === 'LOSS');
  }, [resolvedTrades]);

  if (!cityStats && cityTrades.length === 0 && livePositions.length === 0) {
    return (
      <div className="min-h-screen bg-slate-950 p-4">
        <div className="mx-auto max-w-6xl">
          <Link 
            to="/weather" 
            className="mb-6 inline-flex items-center gap-2 text-slate-400 hover:text-slate-300"
          >
            <ArrowLeftIcon className="h-4 w-4" />
            Back to Weather Overview
          </Link>
          
          <div className="rounded-lg border border-slate-800 bg-slate-900 p-8 text-center">
            <h1 className="text-2xl font-bold text-slate-100 mb-4">
              {city} Weather Trading
            </h1>
            <p className="text-slate-400">
              No trading data found for {city}. This city may not be actively traded or the name might be misspelled.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-950 p-4">
      <div className="mx-auto max-w-6xl">
        {/* Header */}
        <div className="mb-6 flex items-center gap-4">
          <Link 
            to="/weather" 
            className="inline-flex items-center gap-2 text-slate-400 hover:text-slate-300"
          >
            <ArrowLeftIcon className="h-4 w-4" />
            Back to Weather Overview
          </Link>
        </div>

        {/* City Title & Stats */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-slate-100 mb-6">
            {city} Weather Trading
          </h1>

          {cityStats && (
            <section className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-6">
              <StatCard 
                label="Total Trades" 
                value={String(cityStats.trades)} 
              />
              <StatCard 
                label="Win Rate" 
                value={`${(cityStats.winrate * 100).toFixed(1)}%`} 
                color={cityStats.winrate >= 0.5 ? 'profit' : 'loss'}
              />
              <StatCard 
                label="Total P&L" 
                value={formatCurrency(cityStats.pnl)} 
                color={cityStats.pnl >= 0 ? 'profit' : 'loss'}
              />
              <StatCard 
                label="ROI" 
                value={`${(cityStats.roi * 100).toFixed(1)}%`} 
                color={cityStats.roi >= 0 ? 'profit' : 'loss'}
              />
              <StatCard 
                label="Total Stake" 
                value={formatCurrency(cityStats.stake)} 
              />
              <StatCard 
                label="Avg Trade" 
                value={formatCurrency(cityStats.stake / (cityStats.trades || 1))} 
              />
            </section>
          )}
        </div>

        {/* Live Positions */}
        {livePositions.length > 0 && (
          <section className="mb-8">
            <h2 className="text-xl font-semibold text-slate-100 mb-4">
              Live Orders ({livePositions.length})
            </h2>
            <div className="space-y-3">
              {livePositions.map((order, index) => (
                <div
                  key={order.id || index}
                  className="rounded-lg border border-slate-700 bg-slate-800 p-4"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1">
                      <div className="flex items-center gap-3 mb-2">
                        <span className={`px-2 py-1 rounded text-xs font-medium ${
                          order.side === 'YES' ? 'bg-green-900 text-green-300' : 'bg-red-900 text-red-300'
                        }`}>
                          {order.side}
                        </span>
                        <span className="text-slate-400 text-sm">
                          @ {(order.entry_price * 100).toFixed(0)}¢
                        </span>
                        <span className="text-slate-500 text-sm">
                          {formatDate(order.event_date)}
                        </span>
                      </div>
                      <p className="text-slate-200 text-sm mb-1">
                        {order.question || 'Unknown market'}
                      </p>
                      <p className="text-slate-400 text-xs">
                        {order.pendingSize ? 
                          `${order.pendingSize.toFixed(1)} shares pending` : 
                          `${order.actualPosition?.toFixed(1)} shares filled`
                        }
                        {' • '}
                        Value: {formatCurrency(order.value)}
                      </p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Trade History */}
        <section className="grid grid-cols-1 gap-6 xl:grid-cols-2">
          {/* Winning Trades */}
          <div className="rounded-lg border border-emerald-700/40 bg-slate-900 p-4">
            <h3 className="text-lg font-semibold text-emerald-300 mb-4">
              Winning Trades ({wins.length})
            </h3>
            {wins.length > 0 ? (
              <div className="space-y-3">
                {wins.slice(0, 10).map((trade, index) => (
                  <div 
                    key={trade.id || index}
                    className="rounded-md border border-slate-800 bg-slate-950/70 px-3 py-2"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                            trade.side === 'YES' ? 'bg-green-900 text-green-300' : 'bg-red-900 text-red-300'
                          }`}>
                            {trade.side}
                          </span>
                          <span className="text-emerald-400 text-sm font-medium">
                            {formatCurrency(trade.pnl)}
                          </span>
                        </div>
                        <p className="text-xs text-slate-300 mb-1">
                          {trade.question || 'Unknown market'}
                        </p>
                        <p className="text-xs text-slate-500">
                          {formatDate(trade.event_date)} • {(trade.entry_price * 100).toFixed(0)}¢
                        </p>
                      </div>
                    </div>
                  </div>
                ))}
                {wins.length > 10 && (
                  <p className="text-xs text-slate-500 text-center pt-2">
                    ... and {wins.length - 10} more winning trades
                  </p>
                )}
              </div>
            ) : (
              <p className="text-slate-500 text-sm">No winning trades yet.</p>
            )}
          </div>

          {/* Losing Trades */}
          <div className="rounded-lg border border-red-700/40 bg-slate-900 p-4">
            <h3 className="text-lg font-semibold text-red-300 mb-4">
              Losing Trades ({losses.length})
            </h3>
            {losses.length > 0 ? (
              <div className="space-y-3">
                {losses.slice(0, 10).map((trade, index) => (
                  <div 
                    key={trade.id || index}
                    className="rounded-md border border-slate-800 bg-slate-950/70 px-3 py-2"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                            trade.side === 'YES' ? 'bg-green-900 text-green-300' : 'bg-red-900 text-red-300'
                          }`}>
                            {trade.side}
                          </span>
                          <span className="text-red-400 text-sm font-medium">
                            {formatCurrency(trade.pnl)}
                          </span>
                        </div>
                        <p className="text-xs text-slate-300 mb-1">
                          {trade.question || 'Unknown market'}
                        </p>
                        <p className="text-xs text-slate-500">
                          {formatDate(trade.event_date)} • {(trade.entry_price * 100).toFixed(0)}¢
                        </p>
                      </div>
                    </div>
                  </div>
                ))}
                {losses.length > 10 && (
                  <p className="text-xs text-slate-500 text-center pt-2">
                    ... and {losses.length - 10} more losing trades
                  </p>
                )}
              </div>
            ) : (
              <p className="text-slate-500 text-sm">No losing trades yet.</p>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}