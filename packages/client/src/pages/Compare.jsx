import { useMemo, useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
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
    equity: (point.equity / base) * 100,
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

function chartFrameProps() {
  return {
    stroke: 'var(--border-visible)',
    vertical: false,
  };
}

function chartAxisProps() {
  return {
    stroke: 'var(--text-secondary)',
    tickLine: false,
    axisLine: false,
  };
}

function tooltipStyle() {
  return {
    backgroundColor: 'var(--surface)',
    border: '1px solid var(--border-visible)',
    borderRadius: 16,
    color: 'var(--text-primary)',
  };
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
    { key: 'roi', label: 'ROI', fmt: formatPercent, btc: btcMetrics?.roi, weather: weatherMetrics?.roi },
    { key: 'maxDrawdown', label: 'Max Drawdown', fmt: formatPercent, btc: btcMetrics?.maxDrawdown, weather: weatherMetrics?.maxDrawdown },
    { key: 'profitFactor', label: 'Profit Factor', fmt: (v) => Number(v || 0).toFixed(2), btc: btcMetrics?.profitFactor, weather: weatherMetrics?.profitFactor },
    { key: 'winRate', label: 'Win Rate', fmt: formatPercent, btc: btcMetrics?.winRate, weather: weatherMetrics?.winRate },
    { key: 'exposure', label: 'Exposure', fmt: formatPercent, btc: btcOpenExposure, weather: weatherOpenExposure },
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
    <div className="space-y-8">
      <section className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="nothing-section-title">Strategy Compare</p>
          <h1 className="nothing-page-title mt-3">Bitcoin vs Weather</h1>
        </div>
        <label className="flex items-center gap-3">
          <span className="nothing-label">Normalized</span>
          <button
            type="button"
            onClick={() => setNormalized((current) => !current)}
            className="nothing-toggle"
            data-active={normalized}
            aria-pressed={normalized}
          >
            <span className="nothing-toggle-thumb" />
          </button>
        </label>
      </section>

      <section className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        {comparisonMetrics.map((metric) => {
          const btcScore = valueForComparison(metric.key, metric.btc);
          const weatherScore = valueForComparison(metric.key, metric.weather);
          const btcBetter = btcScore > weatherScore;
          const weatherBetter = weatherScore > btcScore;

          return (
            <article key={metric.key} className="nothing-card p-5">
              <p className="nothing-label">{metric.label}</p>
              <div className="mt-5 space-y-4">
                <div className="flex items-center justify-between gap-4 border-b border-[var(--border)] pb-4">
                  <span className="nothing-meta">BTC</span>
                  <span className={btcBetter ? 'text-[var(--text-display)]' : 'text-[var(--text-primary)]'}>
                    {metric.fmt(metric.btc)}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-4">
                  <span className="nothing-meta">Weather</span>
                  <span className={weatherBetter ? 'text-[var(--text-display)]' : 'text-[var(--text-primary)]'}>
                    {metric.fmt(metric.weather)}
                  </span>
                </div>
              </div>
            </article>
          );
        })}
      </section>

      <section className="nothing-card p-5">
        <div className="mb-4 flex items-center justify-between gap-3">
          <div>
            <p className="nothing-section-title">Equity</p>
            <h2 className="mt-2 text-xl font-medium text-[var(--text-display)]">Comparative Curve</h2>
          </div>
          <span className="nothing-meta">{normalized ? 'Base 100' : 'Absolute USD'}</span>
        </div>
        <div className="nothing-chart h-80">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={equityComparisonData}>
              <CartesianGrid {...chartFrameProps()} />
              <XAxis dataKey="date" {...chartAxisProps()} />
              <YAxis
                {...chartAxisProps()}
                tickFormatter={(value) => (normalized ? `${Number(value).toFixed(1)}%` : formatCurrency(value))}
              />
              <Tooltip
                contentStyle={tooltipStyle()}
                formatter={(value) => (normalized ? `${Number(value).toFixed(2)}%` : formatCurrency(value))}
              />
              <Line type="monotone" dataKey="btc" stroke="var(--text-display)" strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey="weather" stroke="var(--text-secondary)" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </section>

      <section className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <article className="nothing-card p-5">
          <p className="nothing-section-title">BTC Drawdown</p>
          <div className="nothing-chart mt-4 h-52">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={btcDrawdown}>
                <CartesianGrid {...chartFrameProps()} />
                <XAxis dataKey="date" {...chartAxisProps()} />
                <YAxis {...chartAxisProps()} tickFormatter={(value) => `${Number(value).toFixed(1)}%`} />
                <Tooltip contentStyle={tooltipStyle()} formatter={(value) => `${Number(value).toFixed(2)}%`} />
                <Line type="monotone" dataKey="drawdown" stroke="var(--text-display)" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </article>

        <article className="nothing-card p-5">
          <p className="nothing-section-title">Weather Drawdown</p>
          <div className="nothing-chart mt-4 h-52">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={weatherDrawdown}>
                <CartesianGrid {...chartFrameProps()} />
                <XAxis dataKey="date" {...chartAxisProps()} />
                <YAxis {...chartAxisProps()} tickFormatter={(value) => `${Number(value).toFixed(1)}%`} />
                <Tooltip contentStyle={tooltipStyle()} formatter={(value) => `${Number(value).toFixed(2)}%`} />
                <Line type="monotone" dataKey="drawdown" stroke="var(--text-secondary)" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </article>
      </section>

      <section className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <article className="nothing-card p-5">
          <p className="nothing-section-title">BTC Distribution</p>
          <div className="nothing-chart mt-4 h-72">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={btcDistribution}>
                <CartesianGrid {...chartFrameProps()} />
                <XAxis dataKey="bucket" {...chartAxisProps()} interval={0} angle={-15} textAnchor="end" height={60} />
                <YAxis {...chartAxisProps()} domain={[0, maxDistributionY]} />
                <Tooltip contentStyle={tooltipStyle()} />
                <Bar dataKey="count" fill="var(--text-display)" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </article>

        <article className="nothing-card p-5">
          <p className="nothing-section-title">Weather Distribution</p>
          <div className="nothing-chart mt-4 h-72">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={weatherDistribution}>
                <CartesianGrid {...chartFrameProps()} />
                <XAxis dataKey="bucket" {...chartAxisProps()} interval={0} angle={-15} textAnchor="end" height={60} />
                <YAxis {...chartAxisProps()} domain={[0, maxDistributionY]} />
                <Tooltip contentStyle={tooltipStyle()} />
                <Bar dataKey="count" fill="var(--text-secondary)" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </article>
      </section>
    </div>
  );
}
