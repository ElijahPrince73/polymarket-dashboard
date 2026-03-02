import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { startBtcTrading, stopBtcTrading } from '../api/btc.js';
import { killWeather, triggerWeatherTick } from '../api/weather.js';
import StatCard from '../components/StatCard.jsx';
import StatusPill from '../components/StatusPill.jsx';
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

function formatUptime(seconds) {
  const total = Number(seconds || 0);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  return `${hours}h ${minutes}m`;
}

function shortDate(value) {
  if (!value) return '--';
  return new Date(value).toLocaleDateString();
}

function buildEquitySeries(btcTrades, weatherTrades) {
  const points = [];

  for (const trade of btcTrades || []) {
    points.push({
      date: trade.exitTime || trade.timestamp || trade.entryTime,
      pnl: Number(trade.pnl || 0),
    });
  }

  for (const trade of weatherTrades || []) {
    points.push({
      date: trade.resolved_at || trade.created_at || trade.event_date,
      pnl: Number(trade.pnl || 0),
    });
  }

  points.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

  let running = 1100;
  return points.map((point) => {
    running += point.pnl;
    return {
      date: shortDate(point.date),
      equity: Number(running.toFixed(2)),
    };
  });
}

export default function Overview() {
  const { data: btcStatus, loading: btcLoading, refetch: refetchBtc } = useApi('/api/btc/status');
  const { data: btcKill, refetch: refetchKill } = useApi('/api/btc/kill-switch/status');
  const { data: btcTrades } = useApi('/api/btc/trades');

  const { data: weatherStatus, loading: weatherLoading, refetch: refetchWeatherStatus } = useApi(
    '/api/weather/status'
  );
  const { data: weatherSummary } = useApi('/api/weather/summary');
  const { data: weatherTrades, refetch: refetchWeatherTrades } = useApi('/api/weather/trades');

  const btcBalance = Number(btcStatus?.balance?.balance || 0);
  const btcRealized = Number(btcStatus?.balance?.realized || 0);
  const btcTotalTrades = Number(btcStatus?.ledgerSummary?.totalTrades || 0);

  const weatherBalance = Number(weatherStatus?.bankroll || 0);
  const weatherRealized = Number(weatherSummary?.rolling?.pnl || 0);
  const weatherTotalTrades = Number(weatherSummary?.rolling?.trades || 0);

  const totalBalance = btcBalance + weatherBalance;
  const totalRealized = btcRealized + weatherRealized;
  const totalStarting = 1100;
  const roi = totalStarting > 0 ? (totalRealized / totalStarting) * 100 : 0;
  const totalTrades = btcTotalTrades + weatherTotalTrades;

  const equityData = buildEquitySeries(btcTrades || [], weatherTrades || []);

  async function runAndRefresh(action) {
    await action();
    refetchBtc();
    refetchKill();
    refetchWeatherStatus();
    refetchWeatherTrades();
  }

  return (
    <div className="space-y-6">
      <section className="flex flex-wrap gap-2">
        <StatusPill
          label="Mode"
          value={String(btcStatus?.mode || 'PAPER')}
          variant={String(btcStatus?.mode || 'PAPER') === 'LIVE' ? 'warning' : 'neutral'}
        />
        <StatusPill
          label="Trading"
          value={btcStatus?.tradingEnabled ? 'ON' : 'OFF'}
          variant={btcStatus?.tradingEnabled ? 'success' : 'danger'}
        />
        <StatusPill
          label="Kill Switch"
          value={btcKill?.active ? 'Active' : 'Inactive'}
          variant={btcKill?.active ? 'danger' : btcKill?.overrideActive ? 'warning' : 'success'}
        />
        <StatusPill
          label="Supabase"
          value={btcStatus?.status?.ok ? 'Connected' : 'Disconnected'}
          variant={btcStatus?.status?.ok ? 'success' : 'danger'}
        />
        <StatusPill
          label="Uptime"
          value={formatUptime(btcStatus?.status?._uptimeS || weatherStatus?.uptime || 0)}
          variant="neutral"
        />
      </section>

      <section className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Total Balance" value={formatCurrency(totalBalance)} />
        <StatCard
          label="Total Realized P&L"
          value={formatCurrency(totalRealized)}
          color={totalRealized >= 0 ? 'profit' : 'loss'}
        />
        <StatCard
          label="ROI %"
          value={`${roi.toFixed(2)}%`}
          color={roi >= 0 ? 'profit' : 'loss'}
          subtitle={`Starting ${formatCurrency(totalStarting)}`}
        />
        <StatCard label="Total Trades" value={String(totalTrades)} />
      </section>

      <section className="rounded-lg border border-slate-700 bg-slate-900 p-4">
        <h2 className="mb-4 text-lg font-semibold">Combined Equity</h2>
        <div className="h-72">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={equityData}>
              <CartesianGrid stroke="#334155" strokeDasharray="4 4" />
              <XAxis dataKey="date" stroke="#94a3b8" />
              <YAxis stroke="#94a3b8" tickFormatter={(v) => formatCurrency(v)} width={88} />
              <Tooltip
                contentStyle={{ backgroundColor: '#0f172a', border: '1px solid #334155', borderRadius: 8 }}
                labelStyle={{ color: '#cbd5e1' }}
                formatter={(v) => formatCurrency(v)}
              />
              <Area type="monotone" dataKey="equity" stroke="#10b981" fill="#10b981" fillOpacity={0.2} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </section>

      <section className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <article className="rounded-lg border border-slate-700 bg-slate-900 p-4">
          <div className="flex items-center justify-between">
            <h3 className="text-base font-semibold">BTC Bot</h3>
            <StatusPill
              label="Status"
              value={btcLoading ? 'Loading' : btcStatus?.tradingEnabled ? 'Running' : 'Stopped'}
              variant={btcStatus?.tradingEnabled ? 'success' : 'danger'}
            />
          </div>
          <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
            <div>
              <p className="text-slate-400">Balance</p>
              <p>{formatCurrency(btcBalance)}</p>
            </div>
            <div>
              <p className="text-slate-400">P&L</p>
              <p className={btcRealized >= 0 ? 'text-emerald-400' : 'text-red-400'}>{formatCurrency(btcRealized)}</p>
            </div>
            <div>
              <p className="text-slate-400">Win Rate</p>
              <p>{`${Number(btcStatus?.ledgerSummary?.winRate || 0).toFixed(2)}%`}</p>
            </div>
            <div>
              <p className="text-slate-400">Trades</p>
              <p>{String(btcTotalTrades)}</p>
            </div>
          </div>
          <div className="mt-4 flex gap-2">
            <button
              type="button"
              onClick={() => runAndRefresh(startBtcTrading)}
              className="rounded-md bg-emerald-600 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-500"
            >
              Start
            </button>
            <button
              type="button"
              onClick={() => runAndRefresh(stopBtcTrading)}
              className="rounded-md bg-red-600 px-3 py-2 text-sm font-medium text-white hover:bg-red-500"
            >
              Stop
            </button>
          </div>
        </article>

        <article className="rounded-lg border border-slate-700 bg-slate-900 p-4">
          <div className="flex items-center justify-between">
            <h3 className="text-base font-semibold">Weather Bot</h3>
            <StatusPill
              label="Status"
              value={weatherLoading ? 'Loading' : weatherStatus?.tradingEnabled ? 'Running' : 'Stopped'}
              variant={weatherStatus?.tradingEnabled ? 'success' : 'danger'}
            />
          </div>
          <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
            <div>
              <p className="text-slate-400">Balance</p>
              <p>{formatCurrency(weatherBalance)}</p>
            </div>
            <div>
              <p className="text-slate-400">P&L</p>
              <p className={weatherRealized >= 0 ? 'text-emerald-400' : 'text-red-400'}>
                {formatCurrency(weatherRealized)}
              </p>
            </div>
            <div>
              <p className="text-slate-400">Open Trades</p>
              <p>{String(Number(weatherStatus?.openTrades || 0))}</p>
            </div>
            <div>
              <p className="text-slate-400">Last Tick</p>
              <p>{weatherStatus?.lastTickAt ? shortDate(weatherStatus.lastTickAt) : '--'}</p>
            </div>
          </div>
          <div className="mt-4 flex gap-2">
            <button
              type="button"
              onClick={() => runAndRefresh(triggerWeatherTick)}
              className="rounded-md bg-emerald-600 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-500"
            >
              Start Tick
            </button>
            <button
              type="button"
              onClick={() => runAndRefresh(killWeather)}
              className="rounded-md bg-red-600 px-3 py-2 text-sm font-medium text-white hover:bg-red-500"
            >
              Kill
            </button>
          </div>
        </article>
      </section>
    </div>
  );
}
