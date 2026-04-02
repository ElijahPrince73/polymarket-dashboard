import { useMemo, useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
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
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '--';
  return date.toLocaleDateString('en-US', { month: '2-digit', day: '2-digit' });
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

function buildDistributionBars(bucketMap) {
  return Object.entries(bucketMap || {}).map(([bucket, count], index) => ({
    index,
    bucket,
    count: Number(count || 0),
    center: parseBucketCenter(bucket),
  }));
}

function findClosestBucketIndex(rows, target) {
  if (!rows.length) return 0;
  let best = rows[0];
  let bestDelta = Math.abs(rows[0].center - Number(target || 0));

  for (const row of rows) {
    const delta = Math.abs(row.center - Number(target || 0));
    if (delta < bestDelta) {
      best = row;
      bestDelta = delta;
    }
  }
  return best.index;
}

function toHourMap(hourlyRows) {
  const map = new Map();
  for (const row of hourlyRows || []) {
    map.set(Number(row?.hour || 0), {
      hour: Number(row?.hour || 0),
      pnl: Number(row?.pnl || 0),
      trades: Number(row?.trades || 0),
      winRate: Number(row?.winRate || 0),
    });
  }

  return Array.from({ length: 24 }, (_, hour) => {
    const item = map.get(hour);
    return item || { hour, pnl: 0, trades: 0, winRate: 0 };
  });
}

function heatCellClass(value, maxAbs) {
  if (maxAbs <= 0) return 'border-[var(--border)] text-[var(--text-primary)]';
  const intensity = Math.min(Math.abs(value) / maxAbs, 1);
  if (intensity > 0.66) return 'border-[var(--border-visible)] text-[var(--text-display)]';
  if (intensity > 0.33) return 'border-[var(--border)] text-[var(--text-primary)]';
  return 'border-[var(--border)] text-[var(--text-secondary)]';
}

function sizeBuckets(rows) {
  if (!rows.length) return [];
  const stakes = rows.map((row) => Number(row.stake || 0));
  const maxStake = Math.max(...stakes, 1);
  const bucketCount = 6;
  const step = Math.max(Math.ceil(maxStake / bucketCount), 1);

  const buckets = Array.from({ length: bucketCount }, (_, idx) => ({
    min: idx * step,
    max: (idx + 1) * step,
    wins: 0,
    total: 0,
  }));

  for (const row of rows) {
    const stake = Number(row.stake || 0);
    const index = Math.min(Math.floor(stake / step), bucketCount - 1);
    const bucket = buckets[index];
    bucket.total += 1;
    if (row.win) bucket.wins += 1;
  }

  return buckets.map((bucket) => ({
    label: `${bucket.min}-${bucket.max}`,
    winRate: bucket.total > 0 ? (bucket.wins / bucket.total) * 100 : 0,
    trades: bucket.total,
  }));
}

function normalizeEquity(series, normalized) {
  const rows = (series || []).map((point) => ({
    date: formatDate(point?.date),
    equity: Number(point?.equity || 0),
    pnl: Number(point?.pnl || 0),
    market: String(point?.market || 'combined').toLowerCase(),
  }));

  if (!normalized || rows.length === 0) return rows;
  const base = rows[0].equity || 1;
  return rows.map((row) => ({
    ...row,
    equity: (row.equity / base) * 100,
  }));
}

const tabList = [
  { id: 'distribution', label: 'Distribution' },
  { id: 'timing', label: 'Timing' },
  { id: 'size', label: 'Trade Size' },
  { id: 'equity', label: 'Equity Curve' },
];

function chartGridProps() {
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

export default function Analytics() {
  const { data: distributions } = useApi('/api/analytics/distributions');
  const { data: combinedAnalytics } = useApi('/api/analytics/combined');

  const [activeTab, setActiveTab] = useState('distribution');
  const [distributionFilter, setDistributionFilter] = useState('all');
  const [timingFilter, setTimingFilter] = useState('all');
  const [sizeFilter, setSizeFilter] = useState('all');
  const [equityFilter, setEquityFilter] = useState('combined');
  const [normalizedEquity, setNormalizedEquity] = useState(false);

  const pnlDist = distributions?.pnlDistribution?.[distributionFilter] || { buckets: {}, mean: 0, median: 0 };
  const histogramData = buildDistributionBars(pnlDist.buckets || {});
  const meanIndex = findClosestBucketIndex(histogramData, pnlDist.mean);
  const medianIndex = findClosestBucketIndex(histogramData, pnlDist.median);

  const metricsSource =
    distributionFilter === 'bitcoin'
      ? combinedAnalytics?.bitcoin?.metrics
      : distributionFilter === 'weather'
        ? combinedAnalytics?.weather?.metrics
        : combinedAnalytics?.combined?.metrics;

  const timingHourlyRows = toHourMap(distributions?.hourly?.[timingFilter] || []);
  const hourlyMaxAbs = Math.max(...timingHourlyRows.map((row) => Math.abs(row.pnl)), 1);
  const dayRows = (distributions?.dayOfWeek?.[timingFilter] || []).map((row) => ({
    day: String(row?.day || '--'),
    pnl: Number(row?.pnl || 0),
    trades: Number(row?.trades || 0),
    winRate: Number(row?.winRate || 0),
  }));

  const filteredSizes = (distributions?.sizePerformance || []).filter((row) => {
    if (sizeFilter === 'all') return true;
    return String(row?.market || '').toLowerCase() === sizeFilter;
  });

  const scatterWins = filteredSizes
    .filter((row) => Boolean(row?.win))
    .map((row) => ({ x: Number(row?.stake || 0), y: Number(row?.pnl || 0) }));

  const scatterLosses = filteredSizes
    .filter((row) => !Boolean(row?.win))
    .map((row) => ({ x: Number(row?.stake || 0), y: Number(row?.pnl || 0) }));

  const sizeWinRateBars = sizeBuckets(
    filteredSizes.map((row) => ({
      stake: Number(row?.stake || 0),
      win: Boolean(row?.win),
    }))
  );

  const rawEquitySeries =
    equityFilter === 'bitcoin'
      ? combinedAnalytics?.bitcoin?.equitySeries
      : equityFilter === 'weather'
        ? combinedAnalytics?.weather?.equitySeries
        : combinedAnalytics?.combined?.equitySeries;

  const equityRows = normalizeEquity(rawEquitySeries || [], normalizedEquity);

  return (
    <div className="space-y-6">
      <section className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="nothing-section-title">Analytics</p>
          <h1 className="nothing-page-title mt-3">Edge Diagnostics</h1>
        </div>
        <div className="nothing-segmented">
          {tabList.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              data-active={activeTab === tab.id}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </section>

      {activeTab === 'distribution' ? (
        <section className="grid grid-cols-1 gap-4 xl:grid-cols-3">
          <article className="nothing-card p-5 xl:col-span-2">
            <div className="mb-4 flex items-center justify-between gap-3">
              <div>
                <p className="nothing-section-title">Histogram</p>
                <h2 className="mt-2 text-xl font-medium text-[var(--text-display)]">PnL Distribution</h2>
              </div>
              <div className="nothing-segmented">
                {['all', 'bitcoin', 'weather'].map((key) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setDistributionFilter(key)}
                    data-active={distributionFilter === key}
                  >
                    {key === 'all' ? 'All' : key}
                  </button>
                ))}
              </div>
            </div>
            <div className="nothing-chart h-80">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={histogramData} margin={{ top: 12, right: 8, left: 0, bottom: 56 }}>
                  <CartesianGrid {...chartGridProps()} />
                  <XAxis
                    dataKey="index"
                    type="number"
                    {...chartAxisProps()}
                    tickFormatter={(value) => histogramData[value]?.bucket || ''}
                    domain={[0, Math.max(histogramData.length - 1, 1)]}
                    ticks={histogramData.map((row) => row.index)}
                    interval={0}
                    angle={-20}
                    textAnchor="end"
                    height={62}
                  />
                  <YAxis {...chartAxisProps()} />
                  <Tooltip
                    contentStyle={tooltipStyle()}
                    formatter={(value) => [String(value), 'Count']}
                    labelFormatter={(value) => histogramData[value]?.bucket || '--'}
                  />
                  <ReferenceLine x={meanIndex} stroke="var(--text-secondary)" strokeDasharray="6 4" />
                  <ReferenceLine x={medianIndex} stroke="var(--text-display)" strokeDasharray="3 3" />
                  <Bar dataKey="count" fill="var(--text-display)" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </article>

          <article className="nothing-card p-5">
            <p className="nothing-section-title">Summary</p>
            <div className="mt-5 space-y-4">
              <div className="border-b border-[var(--border)] pb-4">
                <p className="nothing-label">Avg Win</p>
                <p className="mt-2 text-2xl text-[var(--success)]">{formatCurrency(metricsSource?.avgWin)}</p>
              </div>
              <div className="border-b border-[var(--border)] pb-4">
                <p className="nothing-label">Avg Loss</p>
                <p className="mt-2 text-2xl text-[var(--accent)]">{formatCurrency(metricsSource?.avgLoss)}</p>
              </div>
              <div className="flex items-center justify-between">
                <span className="nothing-label">Profit Factor</span>
                <span className="font-['Space_Mono'] text-sm">{Number(metricsSource?.profitFactor || 0).toFixed(2)}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="nothing-label">Win Rate</span>
                <span className="font-['Space_Mono'] text-sm">{formatPercent(metricsSource?.winRate)}</span>
              </div>
            </div>
          </article>
        </section>
      ) : null}

      {activeTab === 'timing' ? (
        <section className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          <article className="nothing-card p-5">
            <div className="mb-4 flex items-center justify-between">
              <div>
                <p className="nothing-section-title">Timing</p>
                <h2 className="mt-2 text-xl font-medium text-[var(--text-display)]">Hour Map</h2>
              </div>
              <div className="nothing-segmented">
                {['all', 'bitcoin', 'weather'].map((key) => (
                  <button key={key} type="button" onClick={() => setTimingFilter(key)} data-active={timingFilter === key}>
                    {key === 'all' ? 'All' : key}
                  </button>
                ))}
              </div>
            </div>
            <div className="grid grid-cols-4 gap-2 sm:grid-cols-6 lg:grid-cols-4">
              {timingHourlyRows.map((row) => (
                <div
                  key={row.hour}
                  className={`rounded-xl border bg-[var(--surface-raised)] p-3 text-center ${heatCellClass(row.pnl, hourlyMaxAbs)}`}
                  title={`Hour ${row.hour}: ${formatCurrency(row.pnl)} | Trades ${row.trades}`}
                >
                  <p className="nothing-label">{String(row.hour).padStart(2, '0')}</p>
                  <p className={`mt-2 font-['Space_Mono'] text-sm ${row.pnl >= 0 ? 'text-[var(--success)]' : 'text-[var(--accent)]'}`}>
                    {formatCurrency(row.pnl)}
                  </p>
                </div>
              ))}
            </div>
          </article>

          <article className="nothing-card p-5">
            <p className="nothing-section-title">Day Of Week</p>
            <div className="nothing-chart mt-4 h-80">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={dayRows} layout="vertical" margin={{ top: 8, right: 8, left: 8, bottom: 8 }}>
                  <CartesianGrid {...chartGridProps()} />
                  <XAxis type="number" {...chartAxisProps()} />
                  <YAxis type="category" dataKey="day" width={42} {...chartAxisProps()} />
                  <Tooltip contentStyle={tooltipStyle()} formatter={(value) => formatCurrency(value)} />
                  <Bar dataKey="pnl" fill="var(--text-display)" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </article>
        </section>
      ) : null}

      {activeTab === 'size' ? (
        <section className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          <article className="nothing-card p-5">
            <div className="mb-4 flex items-center justify-between">
              <div>
                <p className="nothing-section-title">Sizing</p>
                <h2 className="mt-2 text-xl font-medium text-[var(--text-display)]">Stake vs PnL</h2>
              </div>
              <div className="nothing-segmented">
                {['all', 'bitcoin', 'weather'].map((key) => (
                  <button key={key} type="button" onClick={() => setSizeFilter(key)} data-active={sizeFilter === key}>
                    {key === 'all' ? 'All' : key}
                  </button>
                ))}
              </div>
            </div>
            <div className="nothing-chart h-80">
              <ResponsiveContainer width="100%" height="100%">
                <ScatterChart>
                  <CartesianGrid {...chartGridProps()} />
                  <XAxis type="number" dataKey="x" name="Stake" {...chartAxisProps()} />
                  <YAxis type="number" dataKey="y" name="PnL" {...chartAxisProps()} />
                  <Tooltip
                    cursor={{ strokeDasharray: '4 4', stroke: 'var(--border-visible)' }}
                    contentStyle={tooltipStyle()}
                    formatter={(value, name) => [formatCurrency(value), name === 'y' ? 'PnL' : 'Stake']}
                  />
                  <Scatter name="Wins" data={scatterWins} fill="var(--text-display)" />
                  <Scatter name="Losses" data={scatterLosses} fill="var(--text-secondary)" />
                </ScatterChart>
              </ResponsiveContainer>
            </div>
          </article>

          <article className="nothing-card p-5">
            <p className="nothing-section-title">Bucketed Win Rate</p>
            <div className="nothing-chart mt-4 h-80">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={sizeWinRateBars}>
                  <CartesianGrid {...chartGridProps()} />
                  <XAxis dataKey="label" {...chartAxisProps()} />
                  <YAxis {...chartAxisProps()} tickFormatter={(value) => `${Number(value).toFixed(0)}%`} />
                  <Tooltip
                    contentStyle={tooltipStyle()}
                    formatter={(value, name) =>
                      name === 'winRate' ? `${Number(value).toFixed(2)}%` : String(Number(value || 0))
                    }
                  />
                  <Bar dataKey="winRate" fill="var(--text-display)" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </article>
        </section>
      ) : null}

      {activeTab === 'equity' ? (
        <section className="nothing-card p-5">
          <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div>
              <p className="nothing-section-title">Equity</p>
              <h2 className="mt-2 text-xl font-medium text-[var(--text-display)]">Curve Study</h2>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <div className="nothing-segmented">
                {['combined', 'bitcoin', 'weather'].map((key) => (
                  <button key={key} type="button" onClick={() => setEquityFilter(key)} data-active={equityFilter === key}>
                    {key === 'combined' ? 'Combined' : key}
                  </button>
                ))}
              </div>
              <label className="flex items-center gap-3">
                <span className="nothing-label">Normalized</span>
                <button
                  type="button"
                  onClick={() => setNormalizedEquity((current) => !current)}
                  className="nothing-toggle"
                  data-active={normalizedEquity}
                  aria-pressed={normalizedEquity}
                >
                  <span className="nothing-toggle-thumb" />
                </button>
              </label>
            </div>
          </div>
          <div className="nothing-chart h-96">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={equityRows}>
                <CartesianGrid {...chartGridProps()} />
                <XAxis dataKey="date" {...chartAxisProps()} />
                <YAxis
                  {...chartAxisProps()}
                  tickFormatter={(value) =>
                    normalizedEquity ? `${Number(value).toFixed(1)}%` : formatCurrency(value)
                  }
                />
                <Tooltip
                  contentStyle={tooltipStyle()}
                  formatter={(value, name) => {
                    if (name === 'equity') {
                      return [normalizedEquity ? `${Number(value).toFixed(2)}%` : formatCurrency(value), 'Equity'];
                    }
                    return [formatCurrency(value), 'PnL'];
                  }}
                />
                <Line type="monotone" dataKey="equity" stroke="var(--text-display)" strokeWidth={2} dot={false} />
                <Scatter dataKey="equity" fill="var(--text-secondary)" />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </section>
      ) : null}
    </div>
  );
}
