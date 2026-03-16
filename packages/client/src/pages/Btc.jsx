import { useEffect, useMemo, useState } from 'react';
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
// StatusPill removed — replaced by inline Trading Status Banner
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
    hour12: true,
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

  // Kelly position size calculation
  const modelProb = Math.max(Number(rt.modelUp || 0), Number(rt.modelDown || 0));
  const kellyAlpha = 0.25;
  const kellyPct = modelProb > 0.5 ? kellyAlpha * (2 * modelProb - 1) : 0;
  const clampedKelly = Math.max(0.02, Math.min(0.25, kellyPct));
  const bal = status.balance?.balance ?? 1000;
  const kellySize = Math.floor(bal * clampedKelly);

  // Orderbook
  const obImb = rt.momentumSignals?.orderbookImbalance;
  const obLabel = obImb != null
    ? (obImb > 0.1 ? `🟢 Buyers (${(obImb * 100).toFixed(0)}%)` : obImb < -0.1 ? `🔴 Sellers (${(obImb * 100).toFixed(0)}%)` : `⚪ Neutral (${(obImb * 100).toFixed(0)}%)`)
    : '--';

  // LLM
  const llm = rt.llmPrediction;
  const llmLabel = llm ? `${llm.direction === 'UP' ? '🟢' : '🔴'} ${llm.direction} (${(llm.confidence * 100).toFixed(0)}%)` : 'Waiting for next market...';

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
      required: 'ENTER signal',
      pass: rt.recAction === 'ENTER',
    },
    {
      check: 'Model Confidence',
      current: rt.modelUp != null ? `Up ${pct(rt.modelUp)} / Down ${pct(rt.modelDown)}` : '--',
      required: `≥ ${pct(et.minModelMaxProb)}`,
      pass: !isBlocked('conviction') && !isBlocked('prob'),
    },
    {
      check: 'Kelly Size',
      current: `$${kellySize} (${(clampedKelly * 100).toFixed(1)}%)`,
      required: '$25–$250',
      pass: kellySize >= 25,
    },
    {
      check: 'Orderbook',
      current: obLabel,
      required: '—',
      pass: true,
    },
    {
      check: 'LLM Signal',
      current: llmLabel,
      required: 'Shadow',
      pass: true,
    },
    {
      check: 'Spread',
      current: rt.spreadUp != null ? `Up ${cents(rt.spreadUp)} / Down ${cents(rt.spreadDown)}` : '--',
      required: `≤ ${cents(et.maxSpread)}`,
      pass: !isBlocked('spread'),
    },
    {
      check: 'Liquidity',
      current: rt.liquidityNum != null ? `$${Number(rt.liquidityNum).toLocaleString()}` : '--',
      required: `≥ $${et.minLiquidity || '--'}`,
      pass: !isBlocked('liquidity'),
    },
    {
      check: 'Time to Settlement',
      current: rt.timeLeftMin != null ? (() => { const m = Number(rt.timeLeftMin); const mins = Math.floor(m); const secs = Math.round((m - mins) * 60); return `${mins}m ${secs}s`; })() : '--',
      required: '—',
      pass: true,
    },
    {
      check: 'Circuit Breaker',
      current: g.circuitBreakerTripped ? `Tripped (${g.consecutiveLosses} losses)` : `Clear (${g.consecutiveLosses || 0} losses)`,
      required: 'Clear',
      pass: !g.circuitBreakerTripped,
    },
    {
      check: 'Max Drawdown',
      current: bal != null ? `$${Number(bal).toFixed(0)} / $${Number(status.balance?.starting ?? 1000).toFixed(0)}` : '--',
      required: '≥ 85%',
      pass: !isBlocked('drawdown'),
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
  const [hasOpenTrade, setHasOpenTrade] = useState(false);
  const pollMs = hasOpenTrade ? 1000 : 5000;
  const { data: status, loading, refetch: refetchStatus } = useApi('/api/btc/status', { pollMs });

  // Track open trade state for dynamic poll rate
  useEffect(() => {
    setHasOpenTrade(!!status?.openTrade);
  }, [status?.openTrade]);
  const { data: killSwitch, refetch: refetchKill } = useApi('/api/btc/kill-switch/status');
  const { data: paperTrades, refetch: refetchTrades } = useApi('/api/btc/trades');
  const { data: openOrders, refetch: refetchOpenOrders } = useApi('/api/btc/live/open-orders');
  const { data: portfolio } = useApi('/api/btc/portfolio');
  const { data: liveAnalytics } = useApi('/api/btc/live/analytics');
  const { data: liveTrades } = useApi('/api/btc/live/trades');

  const [activeTab, setActiveTab] = useState('dashboard');
  const [sideFilter, setSideFilter] = useState('ALL');
  const [resultFilter, setResultFilter] = useState('ALL');
  const [pageSize, setPageSize] = useState(20);

  const isTrading = !!status?.tradingEnabled;

  async function refreshAll() {
    await Promise.all([refetchStatus(), refetchKill(), refetchTrades(), refetchOpenOrders()]);
  }

  const [showLiveConfirm, setShowLiveConfirm] = useState(false);

  async function changeMode(event) {
    const newMode = event.target.value;
    if (newMode === 'live' && !isLive) {
      setShowLiveConfirm(true);
      return;
    }
    await setBtcMode(newMode);
    await refreshAll();
  }

  async function confirmLiveMode() {
    await setBtcMode('live');
    setShowLiveConfirm(false);
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

  const isLive = String(status?.mode || '').toUpperCase() === 'LIVE';

  // Mode-aware stats
  const balance = isLive
    ? Number(portfolio?.collateral?.balance || 0)
    : Number(status?.balance?.balance || 0);
  const realized = isLive
    ? Number(liveAnalytics?.realizedTotal || 0)
    : Number(status?.balance?.realized || 0);
  const totalTrades = isLive
    ? Number(liveAnalytics?.tradesCount || 0)
    : Number(status?.ledgerSummary?.totalTrades || 0);
  const winRate = isLive
    ? 0
    : Number(status?.ledgerSummary?.winRate || 0);
  const openTrades = status?.guardrails?.hasOpenPosition ? 1 : Number(openOrders?.length || 0);

  // Position data (live mode — shows available cash vs value in positions)
  const positions = status?.positions;
  const totalInPositions = positions?.totalInPositions || 0;
  const totalRedeemable = positions?.totalRedeemable || 0;
  const redeemableCount = positions?.redeemableCount || 0;

  // Mode-aware trades for table/chart — must be defined BEFORE sortedTrades
  const trades = useMemo(() => {
    if (!isLive) return paperTrades || [];
    return (liveTrades || []).map((t, i) => ({
      id: t.id || `live-${i}`,
      entryTime: t.match_time || t.last_update,
      exitTime: t.match_time || t.last_update,
      timestamp: t.match_time || t.last_update,
      side: String(t.trader_side || t.side || '--').toUpperCase(),
      entryPrice: Number(t.price || 0),
      exitPrice: Number(t.price || 0),
      pnl: null,
      exitReason: t.status || '--',
      contractSize: Number(t.size || 0) * Number(t.price || 0),
    }));
  }, [isLive, paperTrades, liveTrades]);

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

  const gateChecks = useMemo(() => buildGateChecks(status), [status]);

  return (
    <div className="space-y-6">
      {/* Live Mode Confirmation Dialog */}
      {showLiveConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
          <div className="max-w-sm rounded-xl border border-orange-500/50 bg-slate-900 p-6 shadow-2xl">
            <h3 className="text-lg font-bold text-orange-400">⚠️ Switch to Live Trading?</h3>
            <p className="mt-2 text-sm text-slate-300">This will use real money. Current limits:</p>
            <ul className="mt-2 space-y-1 text-sm text-slate-400">
              <li>• Max per trade: <span className="text-white font-medium">${status?.liveTrading?.maxPerTradeUsd || 3}</span></li>
              <li>• Max exposure: <span className="text-white font-medium">${status?.liveTrading?.maxOpenExposureUsd || 10}</span></li>
              <li>• Daily loss limit: <span className="text-white font-medium">${status?.liveTrading?.maxDailyLossUsd || 30}</span></li>
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
        const blockers = status?.entryDebug?.blockers || [];
        const inCooldown = blockers.find(b => b.toLowerCase().includes('cooldown'));
        const outsideHours = blockers.find(b => b.toLowerCase().includes('outside trading'));
        const hasOpen = !!status?.openTrade;

        let bannerColor, bannerBg, bannerBorder, dotColor, statusText, statusDetail;

        if (!isTrading) {
          bannerColor = 'text-red-400'; bannerBg = 'bg-red-950/40'; bannerBorder = 'border-red-500/30';
          dotColor = 'bg-red-500'; statusText = 'STOPPED'; statusDetail = 'Trading is disabled';
        } else if (hasOpen) {
          bannerColor = 'text-blue-400'; bannerBg = 'bg-blue-950/40'; bannerBorder = 'border-blue-500/30';
          dotColor = 'bg-blue-500'; statusText = 'IN TRADE';
          const ot = status.openTrade;
          statusDetail = `${ot.side} @ ${(Number(ot.entryPrice || 0) * 100).toFixed(1)}¢ | PnL: $${Number(ot.unrealizedPnl || 0).toFixed(2)}`;
        } else if (inCooldown) {
          const match = inCooldown.match(/(\d+)s/);
          const secs = match ? Number(match[1]) : 0;
          const mins = Math.floor(secs / 60);
          const remSecs = secs % 60;
          bannerColor = 'text-yellow-400'; bannerBg = 'bg-yellow-950/40'; bannerBorder = 'border-yellow-500/30';
          dotColor = 'bg-yellow-500'; statusText = 'COOLDOWN';
          statusDetail = `${mins}:${String(remSecs).padStart(2, '0')} remaining`;
        } else if (outsideHours) {
          bannerColor = 'text-slate-400'; bannerBg = 'bg-slate-800/60'; bannerBorder = 'border-slate-600/30';
          dotColor = 'bg-slate-500'; statusText = 'OUTSIDE HOURS';
          statusDetail = '6 AM – 5 PM PST';
        } else {
          bannerColor = 'text-emerald-400'; bannerBg = 'bg-emerald-950/40'; bannerBorder = 'border-emerald-500/30';
          dotColor = 'bg-emerald-500'; statusText = 'TRADING';
          statusDetail = 'Scanning for entries';
        }

        return (
          <section className={`flex flex-wrap items-center gap-2 rounded-lg border ${bannerBorder} ${bannerBg} px-3 py-3 md:gap-3 md:px-4`}>
            <span className="relative flex h-3 w-3">
              <span className={`absolute inline-flex h-full w-full animate-ping rounded-full ${dotColor} opacity-75`} />
              <span className={`relative inline-flex h-3 w-3 rounded-full ${dotColor}`} />
            </span>
            <span className={`text-sm font-bold uppercase tracking-wider ${bannerColor}`}>{statusText}</span>
            <span className="text-xs text-slate-400">{statusDetail}</span>

            {/* Mode Toggle */}
            <div className="ml-auto flex flex-wrap items-center gap-2 md:gap-3">
              <button
                onClick={() => isLive ? changeMode({ target: { value: 'paper' } }) : setShowLiveConfirm(true)}
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
                onClick={isTrading ? stopTrading : startTrading}
                className={`rounded-lg px-4 py-1.5 text-sm font-medium text-white transition-colors ${
                  isTrading
                    ? 'bg-red-600 hover:bg-red-500'
                    : 'bg-emerald-600 hover:bg-emerald-500'
                }`}
              >
                {isTrading ? 'Stop' : 'Start'}
              </button>
            </div>
          </section>
        );
      })()}

      {/* Kill Switch Warning */}
      {killSwitch?.active && (
        <div className="rounded-lg border border-red-500/50 bg-red-950/30 px-4 py-2 text-sm text-red-400">
          ⚠️ Kill switch active — trading halted due to daily loss limit
        </div>
      )}

      {/* Stats */}
      <section className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
        <StatCard label={isLive ? "Available USDC" : "Balance"} value={formatCurrency(balance)} />
        <StatCard
          label="Realized P&L"
          value={formatCurrency(realized)}
          color={realized >= 0 ? 'profit' : 'loss'}
        />
        <StatCard label="Win Rate" value={isLive && winRate === 0 ? '--' : `${winRate.toFixed(2)}%`} color={winRate >= 50 ? 'profit' : 'neutral'} />
        <StatCard label="Total Trades" value={String(totalTrades)} />
        <StatCard label="Open Trades" value={String(openTrades)} />
      </section>

      {/* Position Balances (live mode only) + Redeemable Warning (always) */}
      {((isLive && positions) || redeemableCount > 0) && (
        <section className="grid grid-cols-1 gap-4 md:grid-cols-3">
          {isLive && (
            <>
              <div className="rounded-lg border border-zinc-700 bg-zinc-800/50 p-4">
                <div className="text-xs text-zinc-400 uppercase tracking-wide">In Positions</div>
                <div className="mt-1 text-lg font-semibold text-zinc-100">
                  {formatCurrency(totalInPositions)}
                  {positions?.positionCount > 0 && (
                    <span className="ml-2 text-xs text-zinc-400">({positions.positionCount} positions)</span>
                  )}
                </div>
              </div>
              <div className="rounded-lg border border-zinc-700 bg-zinc-800/50 p-4">
                <div className="text-xs text-zinc-400 uppercase tracking-wide">Total Value</div>
                <div className="mt-1 text-lg font-semibold text-zinc-100">
                  {formatCurrency(balance + totalInPositions)}
                </div>
              </div>
            </>
          )}
          {redeemableCount > 0 && totalRedeemable > 0 && (
            <div className="rounded-lg border border-red-500/50 bg-red-950/30 p-4 animate-pulse">
              <div className="text-xs text-red-400 uppercase tracking-wide font-bold">⚠️ Stuck Tokens</div>
              <div className="mt-1 text-lg font-semibold text-red-300">
                {formatCurrency(totalRedeemable)}
                <span className="ml-2 text-xs text-red-400">({redeemableCount} redeemable)</span>
              </div>
              <div className="mt-1 text-xs text-red-400">
                Go to Polymarket UI → Portfolio → Redeem
              </div>
            </div>
          )}
        </section>
      )}

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
                // Prefer server-computed value, fall back to client-side calc
                let pnl = status.openTrade.unrealizedPnl ?? status.openTrade.pnlNow ?? null;
                if (pnl == null) {
                  // Compute from current poly price and entry
                  const side = status.openTrade.side;
                  const entry = Number(status.openTrade.entryPrice || 0);
                  const size = Number(status.openTrade.contractSize || 0);
                  const shares = entry > 0 ? size / entry : 0;
                  const currentPrice = side === 'UP'
                    ? Number(status.runtime?.polyUp || 0)
                    : Number(status.runtime?.polyDown || 0);
                  if (shares > 0 && currentPrice > 0) {
                    pnl = (currentPrice * shares) - size;
                  }
                }
                if (pnl == null) return '--';
                const val = Number(pnl);
                return `${val >= 0 ? '+' : ''}$${val.toFixed(2)}`;
              })()],
              ['Market', String(status.openTrade.marketSlug || status.runtime?.marketSlug || '--').replace('btc-updown-5m-', '')],
              ['Entry Reason', String(status.openTrade.entryReason || '--')],
            ].map(([label, value]) => (
              <div key={label}>
                <p className="text-slate-400">{label}</p>
                <p className={
                  label === 'Side'
                    ? value === 'UP' ? 'font-semibold text-emerald-400' : 'font-semibold text-red-400'
                    : label === 'Unrealized P&L'
                      ? value.startsWith('+') ? 'font-semibold text-emerald-400' : value.startsWith('-') ? 'font-semibold text-red-400' : 'text-slate-200'
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
              <p className="text-slate-200">{status.runtime?.timeLeftMin != null ? (() => { const m = Number(status.runtime.timeLeftMin); const mins = Math.floor(m); const secs = Math.round((m - mins) * 60); return `${mins}m ${secs}s`; })() : '--'}</p>
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
              <p className="text-slate-400">Session</p>
              <p className="text-slate-200">{(() => {
                const h = new Date().getUTCHours();
                if (h >= 0 && h < 8) return '🌏 Asia';
                if (h >= 8 && h < 13) return '🇬🇧 London';
                if (h >= 13 && h < 17) return '🇬🇧🇺🇸 LDN/NY';
                if (h >= 17 && h < 22) return '🇺🇸 New York';
                return '🌙 After Hours';
              })()}</p>
            </div>
            <div>
              <p className="text-slate-400">Orderbook</p>
              <p className="text-slate-200">{(() => {
                const ob = status.runtime?.momentumSignals?.orderbookImbalance;
                if (ob == null) return '--';
                if (ob > 0.1) return `🟢 Buyers (${(ob * 100).toFixed(0)}%)`;
                if (ob < -0.1) return `🔴 Sellers (${(ob * 100).toFixed(0)}%)`;
                return `⚪ Neutral (${(ob * 100).toFixed(0)}%)`;
              })()}</p>
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
                    <th className="px-3 py-2">Settlement</th>
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
                        <td className="px-3 py-2">
                          {trade.settlementSide
                            ? <span className={trade.directionCorrect ? 'text-emerald-400' : 'text-red-400'}>
                                {trade.settlementSide} {trade.directionCorrect ? '✅' : '❌'}
                              </span>
                            : <span className="text-slate-500">--</span>
                          }
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
