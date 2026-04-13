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

async function requestBtcAction(basePath, path, options = {}) {
  const response = await fetch(`${basePath}${path}`, options);
  if (!response.ok) {
    throw new Error(`Request failed (${response.status})`);
  }
  return response.json();
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

  // Entry price for display
  const entryPriceUp = rt.polyPriceUp ?? rt.polyPriceCentsUp;
  const entryPriceDown = rt.polyPriceDown ?? rt.polyPriceCentsDown;
  const maxEntryPx = et.maxEntryPolyPrice ?? 0.60;
  const minPolyPx = et.minPolyPrice ?? 0.40;

  // Trading hours
  const nowPst = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Los_Angeles' }));
  const pstHour = nowPst.getHours();
  const tradingStart = et.tradingHoursStart ?? 6;
  const tradingEnd = et.tradingHoursEnd ?? 17;
  const inHours = pstHour >= tradingStart && pstHour < tradingEnd;

  return [
    // ── SECTION: Requirements ──
    {
      check: '📋 Trading Enabled',
      current: status.tradingEnabled ? 'Yes' : 'No',
      required: 'Yes',
      pass: !!status.tradingEnabled,
    },
    {
      check: '🕐 Trading Hours',
      current: inHours ? `${pstHour}:00 PST ✓` : `${pstHour}:00 PST ✗`,
      required: `${tradingStart} AM – ${tradingEnd > 12 ? tradingEnd - 12 : tradingEnd} PM PST`,
      pass: inHours && !isBlocked('trading hours'),
    },
    {
      check: '📊 Recommendation',
      current: rt.recAction ? `${rt.recAction} ${rt.recSide || ''} (${rt.recPhase || ''})` : 'None',
      required: 'ENTER signal',
      pass: rt.recAction === 'ENTER',
    },
    {
      check: '⏱️ Entry Window',
      current: rt.timeLeftMin != null ? (() => { const m = Number(rt.timeLeftMin); const mins = Math.floor(m); const secs = Math.round((m - mins) * 60); return `${mins}m ${secs}s left`; })() : '--',
      required: `Last ${et.onlyEntryFinalMinutes ?? 2.5}m of market`,
      pass: !isBlocked('early') && !isBlocked('late'),
    },
    {
      check: '🎯 Model Confidence',
      current: rt.modelUp != null ? `Up ${pct(rt.modelUp)} / Down ${pct(rt.modelDown)}` : '--',
      required: `≥ ${pct(et.minModelMaxProb)}`,
      pass: !isBlocked('conviction') && !isBlocked('prob'),
    },
    {
      check: '💰 Entry Price',
      current: entryPriceUp != null ? `Up ${cents(entryPriceUp)} / Down ${cents(entryPriceDown)}` : '--',
      required: `${cents(minPolyPx)} – ${cents(maxEntryPx)}`,
      pass: !isBlocked('price') && !isBlocked('bounds'),
    },
    {
      check: '💵 Kelly Size',
      current: `$${kellySize} (${(clampedKelly * 100).toFixed(1)}%)`,
      required: '$25–$250',
      pass: kellySize >= 25,
    },
    {
      check: '📈 Spread',
      current: rt.spreadUp != null ? `Up ${cents(rt.spreadUp)} / Down ${cents(rt.spreadDown)}` : '--',
      required: `≤ ${cents(et.maxSpread)}`,
      pass: !isBlocked('spread'),
    },
    {
      check: '🏦 Liquidity',
      current: rt.liquidityNum != null ? `$${Number(rt.liquidityNum).toLocaleString()}` : '--',
      required: `≥ $${et.minLiquidity || '--'}`,
      pass: !isBlocked('liquidity'),
    },
    {
      check: '📕 Orderbook',
      current: obLabel,
      required: '—',
      pass: true,
    },
    {
      check: '🤖 LLM Signal',
      current: llmLabel,
      required: 'Shadow only',
      pass: true,
    },
    // ── SECTION: Safeguards ──
    {
      check: '🔄 One Trade/Market',
      current: isBlocked('one trade') ? 'Already traded' : 'Available',
      required: 'Available',
      pass: !isBlocked('one trade'),
    },
    {
      check: '📍 Open Position',
      current: g.hasOpenPosition ? 'Yes' : 'No',
      required: 'No',
      pass: !g.hasOpenPosition,
    },
    {
      check: '⏸️ Loss Cooldown',
      current: isBlocked('cooldown') ? blockers.find(b => b.toLowerCase().includes('cooldown')) || 'Active' : `Clear (${g.consecutiveLosses || 0} losses)`,
      required: 'Clear',
      pass: !isBlocked('cooldown'),
    },
    {
      check: '🛑 Circuit Breaker',
      current: g.circuitBreakerTripped ? `Tripped (${g.consecutiveLosses} losses)` : `Clear`,
      required: 'Clear',
      pass: !g.circuitBreakerTripped,
    },
    {
      check: '📉 Max Drawdown',
      current: bal != null ? `$${Number(bal).toFixed(0)} / $${Number(status.balance?.starting ?? 1000).toFixed(0)}` : '--',
      required: '≥ 85% of starting',
      pass: !isBlocked('drawdown'),
    },
  ];
}

export function BtcDashboard({
  basePath = '/api/btc',
  title = 'Bitcoin',
  marketPrefix = 'btc-updown-5m-',
  marketShortPrefix = '5m-',
} = {}) {
  const [hasOpenTrade, setHasOpenTrade] = useState(false);
  const pollMs = hasOpenTrade ? 1000 : 5000;
  const { data: status, loading, refetch: refetchStatus } = useApi(`${basePath}/status`, { pollMs });

  // Track open trade state for dynamic poll rate
  useEffect(() => {
    setHasOpenTrade(!!status?.openTrade);
  }, [status?.openTrade]);
  // Slow-poll historical/endpoints that rarely change
  const { data: killSwitch, refetch: refetchKill } = useApi(`${basePath}/kill-switch/status`, { pollMs: 30_000 });
  const { data: paperTrades, refetch: refetchTrades } = useApi(`${basePath}/trades`, { pollMs: 60_000 });
  const { data: openOrders, refetch: refetchOpenOrders } = useApi(`${basePath}/live/open-orders`, { pollMs }); // fast when trade open
  const { data: portfolio } = useApi(`${basePath}/portfolio`, { pollMs: 30_000 });
  const { data: liveAnalytics } = useApi(`${basePath}/live/analytics`, { pollMs: 60_000 });
  const { data: liveTrades } = useApi(`${basePath}/live/trades`, { pollMs: 60_000 });

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
    await requestBtcAction(basePath, '/mode', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: String(newMode).toLowerCase() }),
    });
    await refreshAll();
  }

  async function confirmLiveMode() {
    await requestBtcAction(basePath, '/mode', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: 'live' }),
    });
    setShowLiveConfirm(false);
    await refreshAll();
  }

  async function startTrading() {
    await requestBtcAction(basePath, '/trading/start', { method: 'POST' });
    await refreshAll();
  }

  async function stopTrading() {
    await requestBtcAction(basePath, '/trading/stop', { method: 'POST' });
    await refreshAll();
  }

  async function forceCloseTrade() {
    await requestBtcAction(basePath, '/force-close', { method: 'POST' });
    await refreshAll();
  }

  const isLive = String(status?.mode || '').toUpperCase() === 'LIVE';

  // Compute live stats from structured trades in Supabase (same source as paper)
  const liveBtcTrades = useMemo(() => {
    if (!isLive) return [];
    return (paperTrades || []).filter(t => t.mode === 'live' && t.status === 'CLOSED');
  }, [isLive, paperTrades]);

  const liveStats = useMemo(() => {
    if (!liveBtcTrades.length) return { pnl: 0, winRate: 0, total: 0 };
    const wins = liveBtcTrades.filter(t => t.pnl > 0).length;
    const pnl = liveBtcTrades.reduce((s, t) => s + (t.pnl || 0), 0);
    return { pnl, winRate: (wins / liveBtcTrades.length) * 100, total: liveBtcTrades.length };
  }, [liveBtcTrades]);

  // Mode-aware stats
  const balance = isLive
    ? Number(portfolio?.collateral?.balance || 0)
    : Number(status?.balance?.balance || 0);
  const realized = isLive
    ? liveStats.pnl
    : Number(status?.balance?.realized || 0);
  const totalTrades = isLive
    ? liveStats.total
    : Number(status?.ledgerSummary?.totalTrades || 0);
  const winRate = isLive
    ? liveStats.winRate
    : Number(status?.ledgerSummary?.winRate || 0);
  const openTrades = status?.guardrails?.hasOpenPosition ? 1 : 0;

  // Position data (live mode)
  const totalRedeemable = status?.positions?.totalRedeemable || 0;
  const redeemableCount = status?.positions?.redeemableCount || 0;

  // Mode-aware trades for table/chart — must be defined BEFORE sortedTrades
  // Both paper and live trades use the same structured format from /api/btc/trades
  const trades = useMemo(() => {
    const allTrades = paperTrades || [];
    if (!isLive) return allTrades.filter(t => t.mode !== 'live');
    return allTrades.filter(t => t.mode === 'live');
  }, [isLive, paperTrades]);

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
      <section>
        <h1 className="nothing-page-title">{title}</h1>
      </section>
      {/* Live Mode Confirmation Dialog */}
      {showLiveConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80">
          <div className="max-w-sm rounded-xl border border-[var(--warning)] bg-[var(--surface)] p-6 shadow-2xl">
            <h3 className="text-lg font-bold text-[var(--warning)]">⚠️ Switch to Live Trading?</h3>
            <p className="mt-2 text-sm text-[var(--text-primary)]">This will use real money. Current limits:</p>
            <ul className="mt-2 space-y-1 text-sm text-[var(--text-secondary)]">
              <li>• Max per trade: <span className="text-[var(--text-display)] font-medium">${status?.liveTrading?.maxPerTradeUsd || 3}</span></li>
              <li>• Max exposure: <span className="text-[var(--text-display)] font-medium">${status?.liveTrading?.maxOpenExposureUsd || 10}</span></li>
              <li>• Daily loss limit: <span className="text-[var(--text-display)] font-medium">${status?.liveTrading?.maxDailyLossUsd || 30}</span></li>
            </ul>
            <div className="mt-4 flex gap-3">
              <button onClick={confirmLiveMode} className="flex-1 rounded-lg bg-[var(--warning)] px-4 py-2 text-sm font-medium text-[var(--text-display)] hover:bg-[var(--warning)]">
                Yes, Go Live
              </button>
              <button onClick={() => setShowLiveConfirm(false)} className="flex-1 rounded-lg bg-[var(--border-visible)] px-4 py-2 text-sm font-medium text-[var(--text-primary)] hover:bg-[var(--border-visible)]">
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
          bannerColor = 'text-[var(--accent)]'; bannerBg = 'bg-[var(--surface)]'; bannerBorder = 'border-[var(--border-visible)]';
          dotColor = 'bg-[var(--accent)]'; statusText = 'STOPPED'; statusDetail = 'Trading is disabled';
        } else if (hasOpen) {
          bannerColor = 'text-[var(--text-primary)]'; bannerBg = 'bg-[var(--surface)]'; bannerBorder = 'border-[var(--border-visible)]';
          dotColor = 'bg-[var(--text-primary)]'; statusText = 'IN TRADE';
          const ot = status.openTrade;
          statusDetail = `${ot.side} @ ${(Number(ot.entryPrice || 0) * 100).toFixed(1)}¢ | PnL: $${Number(ot.unrealizedPnl || 0).toFixed(2)}`;
        } else if (inCooldown) {
          const match = inCooldown.match(/(\d+)s/);
          const secs = match ? Number(match[1]) : 0;
          const mins = Math.floor(secs / 60);
          const remSecs = secs % 60;
          bannerColor = 'text-[var(--warning)]'; bannerBg = 'bg-[var(--surface)]'; bannerBorder = 'border-[var(--border-visible)]';
          dotColor = 'bg-[var(--warning)]'; statusText = 'COOLDOWN';
          statusDetail = `${mins}:${String(remSecs).padStart(2, '0')} remaining`;
        } else if (outsideHours) {
          bannerColor = 'text-[var(--text-secondary)]'; bannerBg = 'bg-[var(--surface-raised)]/60'; bannerBorder = 'border-[var(--border-visible)]/30';
          dotColor = 'bg-[var(--text-disabled)]'; statusText = 'OUTSIDE HOURS';
          statusDetail = '6 AM – 5 PM PST';
        } else {
          bannerColor = 'text-[var(--success)]'; bannerBg = 'bg-[var(--surface)]'; bannerBorder = 'border-[var(--border)]';
          dotColor = 'bg-[var(--success)]'; statusText = 'TRADING';
          statusDetail = 'Scanning for entries';
        }

        return (
          <section className={`flex flex-wrap items-center gap-2 rounded-lg border ${bannerBorder} ${bannerBg} px-3 py-3 md:gap-3 md:px-4`}>
            <span className="relative flex h-3 w-3">
              <span className={`absolute inline-flex h-full w-full animate-ping rounded-full ${dotColor} opacity-75`} />
              <span className={`relative inline-flex h-3 w-3 rounded-full ${dotColor}`} />
            </span>
            <span className={`text-sm font-bold uppercase tracking-wider ${bannerColor}`}>{statusText}</span>
            <span className="text-xs text-[var(--text-secondary)]">{statusDetail}</span>

            {/* Mode Toggle */}
            <div className="ml-auto flex flex-wrap items-center gap-2 md:gap-3">
              <button
                onClick={() => isLive ? changeMode({ target: { value: 'paper' } }) : setShowLiveConfirm(true)}
                className={`relative inline-flex h-7 w-14 items-center rounded-full transition-colors ${
                  isLive ? 'bg-[var(--warning)]' : 'bg-[var(--text-display)]'
                }`}
              >
                <span className={`inline-block h-5 w-5 transform rounded-full bg-white shadow-md transition-transform ${
                  isLive ? 'translate-x-8' : 'translate-x-1'
                }`} />
              </button>
              <span className={`text-xs font-bold uppercase tracking-wider ${isLive ? 'text-[var(--warning)]' : 'text-[var(--success)]'}`}>
                {isLive ? 'LIVE' : 'PAPER'}
              </span>

              {/* Start/Stop */}
              <button
                type="button"
                onClick={isTrading ? stopTrading : startTrading}
                className={`nothing-button-primary rounded-full px-5 py-1.5 transition-colors ${
                  isTrading
                    ? '!bg-[var(--accent)] !text-[var(--text-display)]'
                    : ''
                }`}
              >
                {isTrading ? 'STOP' : 'START'}
              </button>
              {hasOpen && (
                <button
                  type="button"
                  onClick={forceCloseTrade}
                  className="nothing-button-secondary rounded-full border-[var(--warning)] px-3 py-1.5 text-xs text-[var(--warning)]"
                  title="Force close stuck trade"
                >
                  FORCE CLOSE
                </button>
              )}
            </div>
          </section>
        );
      })()}

      {/* Kill Switch Warning */}
      {killSwitch?.active && (
        <div className="rounded-lg border border-[var(--accent)] bg-[var(--surface)] px-4 py-2 text-sm text-[var(--accent)]">
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
        <StatCard label="Win Rate" value={totalTrades === 0 ? '--' : `${winRate.toFixed(1)}%`} color={winRate >= 50 ? 'profit' : 'neutral'} />
        <StatCard label="Total Trades" value={String(totalTrades)} />
        <StatCard label="Open Trade" value={openTrades > 0 ? 'Yes' : 'No'} color={openTrades > 0 ? 'profit' : 'neutral'} />
      </section>

      {/* Redeemable Warning (if any) */}
      {redeemableCount > 0 && totalRedeemable > 0 && (
        <div className="rounded-lg border border-[var(--accent)] bg-[var(--surface)] p-4 animate-pulse">
          <div className="text-xs text-[var(--accent)] uppercase tracking-wide font-bold">⚠️ Stuck Tokens</div>
          <div className="mt-1 text-lg font-semibold text-[var(--accent)]">
            {formatCurrency(totalRedeemable)}
            <span className="ml-2 text-xs text-[var(--accent)]">({redeemableCount} redeemable)</span>
          </div>
          <div className="mt-1 text-xs text-[var(--accent)]">
            Go to Polymarket UI → Portfolio → Redeem
          </div>
        </div>
      )}

      {/* Active Trade */}
      {status?.openTrade && (
        <section className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4">
          <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-[var(--success)]">Active Trade</h3>
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
              ['Market', String(status.openTrade.marketSlug || status.runtime?.marketSlug || '--').replace(marketPrefix, '')],
              ['Entry Reason', String(status.openTrade.entryReason || '--')],
            ].map(([label, value]) => (
              <div key={label}>
                <p className="text-[var(--text-secondary)]">{label}</p>
                <p className={
                  label === 'Side'
                    ? value === 'UP' ? 'font-semibold text-[var(--success)]' : 'font-semibold text-[var(--accent)]'
                    : label === 'Unrealized P&L'
                      ? value.startsWith('+') ? 'font-semibold text-[var(--success)]' : value.startsWith('-') ? 'font-semibold text-[var(--accent)]' : 'text-[var(--text-primary)]'
                      : 'text-[var(--text-primary)]'
                }>{value}</p>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Live Market Info */}
      {status && (
        <section className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4">
          <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-[var(--text-secondary)]">Market</h3>
          <div className="grid grid-cols-2 gap-x-8 gap-y-2 text-sm sm:grid-cols-3 lg:grid-cols-4">
            <div>
              <p className="text-[var(--text-secondary)]">Market</p>
              <p className="text-[var(--text-primary)]">
                {status.runtime?.marketSlug ? (
                  <a
                    href={`https://polymarket.com/event/${status.runtime.marketSlug}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[var(--text-primary)] hover:underline"
                  >
                    {status.runtime.marketSlug.replace(marketPrefix, marketShortPrefix)}
                  </a>
                ) : '--'}
              </p>
            </div>
            <div>
              <p className="text-[var(--text-secondary)]">Time Left</p>
              <p className="text-[var(--text-primary)]">{status.runtime?.timeLeftMin != null ? (() => { const m = Number(status.runtime.timeLeftMin); const mins = Math.floor(m); const secs = Math.round((m - mins) * 60); return `${mins}m ${secs}s`; })() : '--'}</p>
            </div>
            <div>
              <p className="text-[var(--text-secondary)]">BTC Price</p>
              <p className="text-[var(--text-primary)]">{status.runtime?.btcPrice ? `$${Number(status.runtime.btcPrice).toLocaleString()}` : '--'}</p>
            </div>
            <div>
              <p className="text-[var(--text-secondary)]">Poly Up / Down</p>
              <p className="text-[var(--text-primary)]">
                {status.runtime?.polyUp != null
                  ? `${(Number(status.runtime.polyUp) * 100).toFixed(1)}¢ / ${(Number(status.runtime.polyDown) * 100).toFixed(1)}¢`
                  : '--'}
              </p>
            </div>
            <div>
              <p className="text-[var(--text-secondary)]">Model</p>
              <p className="text-[var(--text-primary)]">
                {status.runtime?.modelUp != null
                  ? `Up ${(Number(status.runtime.modelUp) * 100).toFixed(1)}% / Down ${(Number(status.runtime.modelDown) * 100).toFixed(1)}%`
                  : '--'}
              </p>
            </div>
            <div>
              <p className="text-[var(--text-secondary)]">Session</p>
              <p className="text-[var(--text-primary)]">{(() => {
                const h = new Date().getUTCHours();
                if (h >= 0 && h < 8) return '🌏 Asia';
                if (h >= 8 && h < 13) return '🇬🇧 London';
                if (h >= 13 && h < 17) return '🇬🇧🇺🇸 LDN/NY';
                if (h >= 17 && h < 22) return '🇺🇸 New York';
                return '🌙 After Hours';
              })()}</p>
            </div>
            <div>
              <p className="text-[var(--text-secondary)]">Orderbook</p>
              <p className="text-[var(--text-primary)]">{(() => {
                const ob = status.runtime?.momentumSignals?.orderbookImbalance;
                if (ob == null) return '--';
                if (ob > 0.1) return `🟢 Buyers (${(ob * 100).toFixed(0)}%)`;
                if (ob < -0.1) return `🔴 Sellers (${(ob * 100).toFixed(0)}%)`;
                return `⚪ Neutral (${(ob * 100).toFixed(0)}%)`;
              })()}</p>
            </div>
            <div>
              <p className="text-[var(--text-secondary)]">Candles (1m)</p>
              <p className="text-[var(--text-primary)]">{String(status.runtime?.candleCount ?? '--')}</p>
            </div>
            <div>
              <p className="text-[var(--text-secondary)]">Schedule</p>
              <p className="text-[var(--text-primary)]">
                {status.entryThresholds?.pacificDay ?? '--'} {status.entryThresholds?.pacificHour != null ? `${status.entryThresholds.pacificHour}:00 PT` : ''}
                {status.entryThresholds?.isWeekend ? ' (Weekend)' : ''}
              </p>
            </div>
          </div>
        </section>
      )}

      {/* Gate Status Table */}
      {status && (
        <section className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4">
          <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-[var(--text-secondary)]">Gate Status</h3>
          <div className="overflow-x-auto rounded-md border border-[var(--border)]">
            <table className="nothing-table">
              <thead className="bg-[var(--surface-raised)] text-left text-[var(--text-primary)]">
                <tr>
                  <th className="px-4 py-2 font-medium">Check</th>
                  <th className="px-4 py-2 font-medium">Current</th>
                  <th className="px-4 py-2 font-medium">Required</th>
                </tr>
              </thead>
              <tbody>
                {gateChecks.map((row, i) => (
                  <tr key={row.check} className={i % 2 === 0 ? 'bg-[var(--surface)]' : 'bg-[var(--black)]'}>
                    <td className="px-4 py-2 text-[var(--text-primary)]">{row.check}</td>
                    <td className={`px-4 py-2 font-medium ${row.pass ? 'text-[var(--success)]' : 'text-[var(--accent)]'}`}>
                      {row.current}
                    </td>
                    <td className="px-4 py-2 text-[var(--text-secondary)]">{row.required}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {status.entryDebug?.eligible && (
            <p className="mt-2 text-sm font-medium text-[var(--success)]">✓ Entry gate is open — ready to trade</p>
          )}
        </section>
      )}

      {/* Chart / Trades Tabs */}
      <section className="rounded-lg border border-[var(--border)] bg-[var(--surface)]">
        <div className="flex gap-2 border-b border-[var(--border)] p-3">
          <button
            type="button"
            onClick={() => setActiveTab('dashboard')}
            className={`rounded-md px-3 py-1.5 text-sm font-medium ${
              activeTab === 'dashboard'
                ? 'bg-[var(--surface-raised)] text-[var(--success)] '
                : 'bg-[var(--surface-raised)] text-[var(--text-primary)]'
            }`}
          >
            Dashboard
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('trades')}
            className={`rounded-md px-3 py-1.5 text-sm font-medium ${
              activeTab === 'trades'
                ? 'bg-[var(--surface-raised)] text-[var(--success)] '
                : 'bg-[var(--surface-raised)] text-[var(--text-primary)]'
            }`}
          >
            Trades
          </button>
        </div>

        {activeTab === 'dashboard' ? (
          <div className="h-80 p-4">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData}>
                <CartesianGrid stroke="#222222" strokeDasharray="4 4" />
                <XAxis dataKey="time" stroke="#999999" minTickGap={30} />
                <YAxis stroke="#999999" tickFormatter={(v) => formatCurrency(v)} width={90} />
                <Tooltip
                  contentStyle={{ backgroundColor: '#111111', border: '1px solid #222222', borderRadius: 8 }}
                  formatter={(v) => formatCurrency(v)}
                />
                <Line type="monotone" dataKey="pnl" stroke="#FFFFFF" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <div className="p-4">
            <div className="mb-3 flex flex-wrap gap-2">
              <select
                value={sideFilter}
                onChange={(e) => setSideFilter(e.target.value)}
                className="rounded-md border border-[var(--border-visible)] bg-[var(--surface-raised)] px-2 py-1 text-sm"
              >
                <option value="ALL">Side: ALL</option>
                <option value="UP">Side: UP</option>
                <option value="DOWN">Side: DOWN</option>
              </select>

              <select
                value={resultFilter}
                onChange={(e) => setResultFilter(e.target.value)}
                className="rounded-md border border-[var(--border-visible)] bg-[var(--surface-raised)] px-2 py-1 text-sm"
              >
                <option value="ALL">Result: ALL</option>
                <option value="WIN">Result: WIN</option>
                <option value="LOSS">Result: LOSS</option>
              </select>

              <select
                value={pageSize}
                onChange={(e) => setPageSize(Number(e.target.value))}
                className="rounded-md border border-[var(--border-visible)] bg-[var(--surface-raised)] px-2 py-1 text-sm"
              >
                <option value={20}>Show: 20</option>
                <option value={25}>Show: 25</option>
                <option value={50}>Show: 50</option>
                <option value={100}>Show: 100</option>
              </select>
            </div>

            <div className="overflow-x-auto rounded-md border border-[var(--border)]">
              <table className="nothing-table">
                <thead className="bg-[var(--surface-raised)] text-left text-[var(--text-primary)]">
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
                        className={index % 2 === 0 ? 'bg-[var(--surface)]' : 'bg-[var(--black)]'}
                      >
                        <td className="px-3 py-2">{formatTime(trade.entryTime)}</td>
                        <td className="px-3 py-2">{formatTime(trade.exitTime || trade.timestamp)}</td>
                        <td className="px-3 py-2">{String(trade.side || '--')}</td>
                        <td className="px-3 py-2">{formatCurrency(trade.entryPrice)}</td>
                        <td className="px-3 py-2">{formatCurrency(trade.exitPrice)}</td>
                        <td className={`px-3 py-2 ${pnl >= 0 ? 'text-[var(--success)]' : 'text-[var(--accent)]'}`}>
                          {formatCurrency(pnl)}
                        </td>
                        <td className="px-3 py-2">
                          {trade.settlementSide
                            ? <span className={trade.directionCorrect ? 'text-[var(--success)]' : 'text-[var(--accent)]'}>
                                {trade.settlementSide} {trade.directionCorrect ? '✅' : '❌'}
                              </span>
                            : <span className="text-[var(--text-disabled)]">--</span>
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

export default function Btc() {
  return <BtcDashboard />;
}
