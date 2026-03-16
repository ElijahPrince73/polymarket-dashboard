import { useMemo, useState } from 'react';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
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

function formatPercent(value) {
  return `${Number(value || 0).toFixed(2)}%`;
}

function formatDate(value) {
  if (!value) return '--';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '--';
  return d.toLocaleDateString('en-US', { month: '2-digit', day: '2-digit' });
}

function toNumber(value) {
  return Number(value || 0);
}

function normalizeSeries(rawSeries, normalized) {
  const series = (rawSeries || []).map((row) => ({
    date: formatDate(row?.date),
    equity: toNumber(row?.equity),
    drawdown: toNumber(row?.drawdown),
  }));

  if (!normalized || series.length === 0) return series;
  const base = series[0].equity || 1;
  return series.map((point) => ({
    ...point,
    equity: ((point.equity / base) * 100),
  }));
}

function parseBucketCenter(label) {
  const text = String(label || '');
  const nums = text.match(/-?\$?\d+(?:\.\d+)?/g) || [];
  const values = nums.map((n) => Number(String(n).replace('$', '')));

  if (values.length >= 2) return (values[0] + values[1]) / 2;
  if (values.length === 1) {
    if (text.includes('<')) return values[0] - 10;
    if (text.includes('>')) return values[0] + 10;
    return values[0];
  }
  return 0;
}

function distributionToBars(bucketMap) {
  return Object.entries(bucketMap || {}).map(([bucket, count]) => ({
    bucket,
    count: Number(count || 0),
    center: parseBucketCenter(bucket),
  }));
}

function valueForComparison(metric, value) {
  if (metric === 'maxDrawdown') return -Math.abs(toNumber(value));
  return toNumber(value);
}

export default function Compare() {
  const { data: combinedAnalytics } = useApi('/api/analytics/combined');
  const { data: distributions } = useApi('/api/analytics/distributions');
  const { data: btcTrades } = useApi('/api/btc/trades');
  const { data: weatherTrades } = useApi('/api/weather/trades');

  const [normalized, setNormalized] = useState(false);

  const btc = combinedAnalytics?.bitcoin || {};
  const weather = combinedAnalytics?.weather || {};
  const btcMetrics = btc?.metrics || {};
  const weatherMetrics = weather?.metrics || {};

  const btcOpenExposure = useMemo(() => {
    const openStake = (btcTrades || [])
      .filter((trade) => Boolean(trade?.open) || String(trade?.status || '').toUpperCase() === 'OPEN')
      .reduce((sum, trade) => sum + Number(trade?.stakeUsd || trade?.stake || trade?.stake_usd || 0), 0);
    const equity = Math.max(toNumber(btcMetrics?.equity), 1);
    return (openStake / equity) * 100;
  }, [btcTrades, btcMetrics?.equity]);

  const weatherOpenExposure = useMemo(() => {
    const openStake = (weatherTrades || [])
      .filter((trade) => String(trade?.status || '').toUpperCase() === 'OPEN')
      .reduce((sum, trade) => sum + Number(trade?.stake_usd || 0), 0);
    const equity = Math.max(toNumber(weatherMetrics?.equity), 1);
    return (openStake / equity) * 100;
  }, [weatherTrades, weatherMetrics?.equity]);

  const comparisonMetrics = [
    { key: 'equity', label: 'Equity', fmt: formatCurrency, btc: btcMetrics?.equity, weather: weatherMetrics?.equity },
    { key: 'roi', label: 'ROI %', fmt: formatPercent, btc: btcMetrics?.roi, weather: weatherMetrics?.roi },
    {
      key: 'maxDrawdown',
      label: 'Max Drawdown',
      fmt: formatPercent,
      btc: btcMetrics?.maxDrawdown,
      weather: weatherMetrics?.maxDrawdown,
    },
    {
      key: 'profitFactor',
      label: 'Profit Factor',
      fmt: (v) => Number(v || 0).toFixed(2),
      btc: btcMetrics?.profitFactor,
      weather: weatherMetrics?.profitFactor,
    },
    {
      key: 'winRate',
      label: 'Win Rate',
      fmt: formatPercent,
      btc: btcMetrics?.winRate,
      weather: weatherMetrics?.winRate,
    },
    { key: 'exposure', label: 'Exposure %', fmt: formatPercent, btc: btcOpenExposure, weather: weatherOpenExposure },
  ];

  const equityComparisonData = useMemo(() => {
    const btcSeries = normalizeSeries(btc?.equitySeries, normalized);
    const weatherSeries = normalizeSeries(weather?.equitySeries, normalized);
    const maxLen = Math.max(btcSeries.length, weatherSeries.length);

    return Array.from({ length: maxLen }, (_, index) => ({
      date: btcSeries[index]?.date || weatherSeries[index]?.date || `#${index + 1}`,
      btc: toNumber(btcSeries[index]?.equity),
      weather: toNumber(weatherSeries[index]?.equity),
    }));
  }, [btc?.equitySeries, weather?.equitySeries, normalized]);

  const btcDrawdown = normalizeSeries(btc?.equitySeries, false).map((point) => ({
    date: point.date,
    drawdown: toNumber(point.drawdown),
  }));
  const weatherDrawdown = normalizeSeries(weather?.equitySeries, false).map((point) => ({
    date: point.date,
    drawdown: toNumber(point.drawdown),
  }));

  const btcDistribution = distributionToBars(distributions?.pnlDistribution?.bitcoin?.buckets || {});
  const weatherDistribution = distributionToBars(distributions?.pnlDistribution?.weather?.buckets || {});
  const maxDistributionY = Math.max(
    ...btcDistribution.map((row) => row.count),
    ...weatherDistribution.map((row) => row.count),
    5
  );

  return (
    <div className="space-y-6">
      <section className="grid grid-cols-2 gap-3 md:grid-cols-2 xl:grid-cols-3">
        {comparisonMetrics.map((metric) => {
          const btcScore = valueForComparison(metric.key, metric.btc);
          const weatherScore = valueForComparison(metric.key, metric.weather);
          const btcBetter = btcScore > weatherScore;
          const weatherBetter = weatherScore > btcScore;

          return (
            <article key={metric.key} className="rounded-lg border border-slate-700 bg-slate-900 p-4">
              <p className="text-xs uppercase tracking-wide text-slate-400">{metric.label}</p>
              <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
                <div className={`rounded border p-2 ${btcBetter ? 'border-orange-500/60 bg-orange-500/10' : 'border-slate-700'}`}>
                  <p className="text-xs text-orange-300">BTC</p>
                  <p className="font-semibold text-slate-100">{metric.fmt(metric.btc)}</p>
                </div>
                <div
                  className={`rounded border p-2 ${
                    weatherBetter ? 'border-cyan-500/60 bg-cyan-500/10' : 'border-slate-700'
                  }`}
                >
                  <p className="text-xs text-cyan-300">Weather</p>
                  <p className="font-semibold text-slate-100">{metric.fmt(metric.weather)}</p>
                </div>
              </div>
            </article>
          );
        })}
      </section>

      <section className="rounded-lg border border-slate-700 bg-slate-900 p-4">
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 className="text-lg font-semibold">Equity Comparison</h2>
          <label className="inline-flex items-center gap-2 text-sm text-slate-300">
            <input
              type="checkbox"
              checked={normalized}
              onChange={(event) => setNormalized(event.target.checked)}
              className="h-4 w-4 accent-emerald-500"
            />
            Normalized (start at 100)
          </label>
        </div>
        <div className="h-72">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={equityComparisonData}>
              <CartesianGrid stroke="#334155" strokeDasharray="4 4" />
              <XAxis dataKey="date" stroke="#94a3b8" />
              <YAxis
                stroke="#94a3b8"
                tickFormatter={(value) => (normalized ? `${Number(value).toFixed(1)}%` : formatCurrency(value))}
              />
              <Tooltip
                contentStyle={{ backgroundColor: '#020617', border: '1px solid #334155', borderRadius: 8 }}
                labelStyle={{ color: '#cbd5e1' }}
                formatter={(value) => (normalized ? `${Number(value).toFixed(2)}%` : formatCurrency(value))}
              />
              <Line type="monotone" dataKey="btc" stroke="#f97316" strokeWidth={2.5} dot={false} />
              <Line type="monotone" dataKey="weather" stroke="#06b6d4" strokeWidth={2.5} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </section>

      <section className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <article className="rounded-lg border border-orange-500/40 bg-slate-900 p-4">
          <h3 className="mb-2 text-sm font-semibold text-orange-300">BTC Drawdown</h3>
          <div className="h-44">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={btcDrawdown}>
                <CartesianGrid stroke="#334155" strokeDasharray="4 4" />
                <XAxis dataKey="date" stroke="#94a3b8" />
                <YAxis stroke="#94a3b8" tickFormatter={(value) => `${Number(value).toFixed(1)}%`} />
                <Tooltip
                  contentStyle={{ backgroundColor: '#020617', border: '1px solid #334155', borderRadius: 8 }}
                  formatter={(value) => `${Number(value).toFixed(2)}%`}
                />
                <Area dataKey="drawdown" type="monotone" stroke="#f97316" fill="#f97316" fillOpacity={0.15} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </article>

        <article className="rounded-lg border border-cyan-500/40 bg-slate-900 p-4">
          <h3 className="mb-2 text-sm font-semibold text-cyan-300">Weather Drawdown</h3>
          <div className="h-44">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={weatherDrawdown}>
                <CartesianGrid stroke="#334155" strokeDasharray="4 4" />
                <XAxis dataKey="date" stroke="#94a3b8" />
                <YAxis stroke="#94a3b8" tickFormatter={(value) => `${Number(value).toFixed(1)}%`} />
                <Tooltip
                  contentStyle={{ backgroundColor: '#020617', border: '1px solid #334155', borderRadius: 8 }}
                  formatter={(value) => `${Number(value).toFixed(2)}%`}
                />
                <Area dataKey="drawdown" type="monotone" stroke="#06b6d4" fill="#06b6d4" fillOpacity={0.15} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </article>
      </section>

      <section className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <article className="rounded-lg border border-slate-700 bg-slate-900 p-4">
          <h3 className="mb-2 text-sm font-semibold text-orange-300">BTC P&amp;L Distribution</h3>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={btcDistribution}>
                <CartesianGrid stroke="#334155" strokeDasharray="4 4" />
                <XAxis dataKey="bucket" stroke="#94a3b8" tick={{ fontSize: 11 }} interval={0} angle={-15} textAnchor="end" height={60} />
                <YAxis stroke="#94a3b8" domain={[0, maxDistributionY]} />
                <Tooltip contentStyle={{ backgroundColor: '#020617', border: '1px solid #334155', borderRadius: 8 }} />
                <Bar dataKey="count">
                  {btcDistribution.map((entry) => (
                    <Cell key={`btc-${entry.bucket}`} fill={entry.center >= 0 ? '#34d399' : '#f87171'} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </article>

        <article className="rounded-lg border border-slate-700 bg-slate-900 p-4">
          <h3 className="mb-2 text-sm font-semibold text-cyan-300">Weather P&amp;L Distribution</h3>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={weatherDistribution}>
                <CartesianGrid stroke="#334155" strokeDasharray="4 4" />
                <XAxis dataKey="bucket" stroke="#94a3b8" tick={{ fontSize: 11 }} interval={0} angle={-15} textAnchor="end" height={60} />
                <YAxis stroke="#94a3b8" domain={[0, maxDistributionY]} />
                <Tooltip contentStyle={{ backgroundColor: '#020617', border: '1px solid #334155', borderRadius: 8 }} />
                <Bar dataKey="count">
                  {weatherDistribution.map((entry) => (
                    <Cell key={`weather-${entry.bucket}`} fill={entry.center >= 0 ? '#34d399' : '#f87171'} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </article>
      </section>
    </div>
  );
}
