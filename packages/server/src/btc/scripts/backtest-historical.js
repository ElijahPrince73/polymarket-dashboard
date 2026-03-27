import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const TABLE_NAME = 'signal_ticks';
const PAGE_SIZE = 1000;

const PARAM_GRID = {
  minCheapEntryPrice: [0.15, 0.20, 0.25, 0.30],
  maxCheapEntryPrice: [0.40, 0.45, 0.50],
  rsiBias: [false, true],
  recGating: [false, true],
};

const RSI_BEARISH = 40;
const RSI_BULLISH = 60;
const CONTRACT_SIZE = 80;
const STOP_LOSS_PCT = 0.20;

function isNum(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

function toNum(value) {
  if (isNum(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function pct(value, digits = 1) {
  return value == null ? 'N/A' : `${(value * 100).toFixed(digits)}%`;
}

function usd(value) {
  if (value == null) return 'N/A';
  return `${value < 0 ? '-' : ''}$${Math.abs(value).toFixed(2)}`;
}

function ratio(value) {
  if (value == null) return 'N/A';
  if (!Number.isFinite(value)) return 'Inf';
  return value.toFixed(2);
}

function pad(value, width, align = 'left') {
  const text = String(value);
  if (text.length >= width) return text;
  return align === 'right'
    ? `${' '.repeat(width - text.length)}${text}`
    : `${text}${' '.repeat(width - text.length)}`;
}

function renderTable(rows) {
  const columns = [
    { key: 'config', label: 'Config', align: 'left' },
    { key: 'tradesTaken', label: 'Trades', align: 'right' },
    { key: 'wins', label: 'Wins', align: 'right' },
    { key: 'losses', label: 'Losses', align: 'right' },
    { key: 'winRate', label: 'Win Rate', align: 'right', format: (value) => pct(value) },
    { key: 'totalPnl', label: 'Total PnL', align: 'right', format: (value) => usd(value) },
    { key: 'avgWin', label: 'Avg Win', align: 'right', format: (value) => usd(value) },
    { key: 'avgLoss', label: 'Avg Loss', align: 'right', format: (value) => usd(value) },
    { key: 'profitFactor', label: 'PF', align: 'right', format: (value) => ratio(value) },
  ];

  const formattedRows = rows.map((row) => {
    const out = {};
    for (const column of columns) {
      out[column.key] = column.format ? column.format(row[column.key]) : String(row[column.key]);
    }
    return out;
  });

  const widths = Object.fromEntries(columns.map((column) => {
    const values = [column.label, ...formattedRows.map((row) => row[column.key])];
    return [column.key, Math.max(...values.map((value) => String(value).length))];
  }));

  const header = columns
    .map((column) => pad(column.label, widths[column.key], column.align))
    .join('  ');
  const divider = columns
    .map((column) => '-'.repeat(widths[column.key]))
    .join('  ');
  const body = formattedRows.map((row) => (
    columns.map((column) => pad(row[column.key], widths[column.key], column.align)).join('  ')
  ));

  return [header, divider, ...body].join('\n');
}

function parseArgs(argv) {
  const args = { timeframe: '5m' };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--timeframe') args.timeframe = argv[i + 1];
    if (arg === '--from') args.from = argv[i + 1];
    if (arg === '--to') args.to = argv[i + 1];
  }

  return args;
}

function startOfDay(date) {
  const out = new Date(date);
  out.setHours(0, 0, 0, 0);
  return out;
}

function endOfDay(date) {
  const out = new Date(date);
  out.setHours(23, 59, 59, 999);
  return out;
}

function parseDateArg(value, mode) {
  if (!value) return null;
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Invalid ${mode} date: ${value}`);
  }
  return mode === 'from' ? startOfDay(date) : endOfDay(date);
}

function formatDateOnly(date) {
  return date.toISOString().slice(0, 10);
}

function getDateRange(args) {
  const today = new Date();
  const defaultTo = endOfDay(today);
  const defaultFrom = startOfDay(new Date(today.getTime() - (7 * 24 * 60 * 60 * 1000)));

  const from = parseDateArg(args.from, 'from') ?? defaultFrom;
  const to = parseDateArg(args.to, 'to') ?? defaultTo;

  if (from > to) {
    throw new Error(`Invalid date range: from ${formatDateOnly(from)} is after to ${formatDateOnly(to)}`);
  }

  return { from, to };
}

function getThresholds(timeframe) {
  return timeframe === '15m'
    ? { noEntryFinalMinutes: 3.0, exitBeforeEndMinutes: 2.0 }
    : { noEntryFinalMinutes: 1.5, exitBeforeEndMinutes: 1.0 };
}

function getClient() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set');
  }

  return createClient(url, key, {
    auth: { persistSession: false },
  });
}

async function fetchTicks(client, timeframe, from, to) {
  const rows = [];
  let page = 0;

  while (true) {
    const start = page * PAGE_SIZE;
    const end = start + PAGE_SIZE - 1;
    const { data, error } = await client
      .from(TABLE_NAME)
      .select('*')
      .eq('timeframe', timeframe)
      .gte('created_at', from.toISOString())
      .lte('created_at', to.toISOString())
      .order('created_at', { ascending: true })
      .range(start, end);

    if (error) {
      throw new Error(`Supabase fetch failed: ${error.message}`);
    }

    if (!Array.isArray(data) || data.length === 0) break;
    rows.push(...data);
    if (data.length < PAGE_SIZE) break;
    page += 1;
  }

  return rows;
}

function groupByMarket(rows) {
  const markets = new Map();

  for (const row of rows) {
    if (!row?.market_slug) continue;
    const bucket = markets.get(row.market_slug);
    if (bucket) {
      bucket.push(row);
    } else {
      markets.set(row.market_slug, [row]);
    }
  }

  return markets;
}

function* buildConfigs() {
  for (const minCheapEntryPrice of PARAM_GRID.minCheapEntryPrice) {
    for (const maxCheapEntryPrice of PARAM_GRID.maxCheapEntryPrice) {
      if (minCheapEntryPrice > maxCheapEntryPrice) continue;
      for (const rsiBias of PARAM_GRID.rsiBias) {
        for (const recGating of PARAM_GRID.recGating) {
          yield {
            minCheapEntryPrice,
            maxCheapEntryPrice,
            rsiBias,
            recGating,
            rsiBearish: rsiBias ? RSI_BEARISH : null,
            rsiBullish: rsiBias ? RSI_BULLISH : null,
            contractSize: CONTRACT_SIZE,
            stopLossPct: STOP_LOSS_PCT,
          };
        }
      }
    }
  }
}

function describeConfig(config) {
  const range = `${Math.round(config.minCheapEntryPrice * 100)}-${Math.round(config.maxCheapEntryPrice * 100)}c`;
  const rsi = config.rsiBias ? `RSI on (${config.rsiBearish}/${config.rsiBullish})` : 'RSI off';
  const rec = config.recGating ? 'Rec on' : 'Rec off';
  return `${range} | ${rsi} | ${rec}`;
}

function passesRsiBias(side, rsi, config) {
  if (!config.rsiBias) return true;
  if (!isNum(rsi)) return false;
  if (side === 'UP') return rsi >= config.rsiBearish;
  if (side === 'DOWN') return rsi <= config.rsiBullish;
  return false;
}

function pickEntryCandidate(tick, config) {
  if (config.recGating && tick.rec_action !== 'ENTER') return null;
  if (!isNum(tick.time_left_min)) return null;

  const candidates = [];
  const prices = [
    { side: 'UP', price: toNum(tick.poly_up) },
    { side: 'DOWN', price: toNum(tick.poly_down) },
  ];

  for (const { side, price } of prices) {
    if (!isNum(price)) continue;
    if (price < config.minCheapEntryPrice || price > config.maxCheapEntryPrice) continue;
    if (!passesRsiBias(side, toNum(tick.rsi), config)) continue;
    candidates.push({ side, price });
  }

  if (candidates.length === 0) return null;

  candidates.sort((a, b) => {
    if (a.price !== b.price) return a.price - b.price;
    if (tick.rec_side === a.side) return -1;
    if (tick.rec_side === b.side) return 1;
    return a.side.localeCompare(b.side);
  });

  return candidates[0];
}

function getMarketPrice(tick, side) {
  return side === 'UP' ? toNum(tick.poly_up) : toNum(tick.poly_down);
}

function settleExitPrice(openPosition, tick) {
  const winner = toNum(tick.poly_up) > 0.5 ? 'UP' : 'DOWN';
  return winner === openPosition.side ? 1.0 : 0.0;
}

function simulateMarket(ticks, config, thresholds) {
  const trades = [];
  let openPosition = null;

  for (const tick of ticks) {
    if (!openPosition) {
      if (!isNum(tick.time_left_min) || tick.time_left_min <= thresholds.noEntryFinalMinutes) continue;

      const candidate = pickEntryCandidate(tick, config);
      if (!candidate) continue;

      openPosition = {
        marketSlug: tick.market_slug,
        side: candidate.side,
        entryPrice: candidate.price,
        entryTime: tick.created_at,
        shares: config.contractSize / candidate.price,
        contractSize: config.contractSize,
      };
      continue;
    }

    const currentPrice = getMarketPrice(tick, openPosition.side);
    const unrealizedPnl = isNum(currentPrice)
      ? (currentPrice - openPosition.entryPrice) * openPosition.shares
      : null;
    const stopLoss = openPosition.contractSize * config.stopLossPct;

    if (isNum(tick.time_left_min) && tick.time_left_min <= 0) {
      const exitPrice = settleExitPrice(openPosition, tick);
      trades.push({
        ...openPosition,
        exitTime: tick.created_at,
        exitPrice,
        pnl: (exitPrice - openPosition.entryPrice) * openPosition.shares,
        exitReason: 'SETTLEMENT',
      });
      openPosition = null;
      continue;
    }

    if (isNum(unrealizedPnl) && unrealizedPnl <= -stopLoss) {
      trades.push({
        ...openPosition,
        exitTime: tick.created_at,
        exitPrice: currentPrice,
        pnl: unrealizedPnl,
        exitReason: 'STOP_LOSS',
      });
      openPosition = null;
      continue;
    }

    if (isNum(tick.time_left_min) && tick.time_left_min < thresholds.exitBeforeEndMinutes && isNum(currentPrice)) {
      trades.push({
        ...openPosition,
        exitTime: tick.created_at,
        exitPrice: currentPrice,
        pnl: unrealizedPnl ?? 0,
        exitReason: 'PRE_SETTLEMENT',
      });
      openPosition = null;
    }
  }

  if (openPosition) {
    const lastTick = ticks[ticks.length - 1];
    const exitPrice = getMarketPrice(lastTick, openPosition.side);
    trades.push({
      ...openPosition,
      exitTime: lastTick?.created_at ?? null,
      exitPrice,
      pnl: isNum(exitPrice) ? (exitPrice - openPosition.entryPrice) * openPosition.shares : 0,
      exitReason: 'DATA_END',
    });
  }

  return trades;
}

function summarizeTrades(trades, config) {
  let wins = 0;
  let losses = 0;
  let grossWins = 0;
  let grossLossesAbs = 0;
  let totalPnl = 0;

  for (const trade of trades) {
    const pnl = toNum(trade?.pnl) ?? 0;
    totalPnl += pnl;

    if (pnl > 0) {
      wins += 1;
      grossWins += pnl;
    } else if (pnl < 0) {
      losses += 1;
      grossLossesAbs += Math.abs(pnl);
    }
  }

  const tradesTaken = trades.length;
  const winRate = tradesTaken > 0 ? wins / tradesTaken : null;
  const avgWin = wins > 0 ? grossWins / wins : null;
  const avgLoss = losses > 0 ? -(grossLossesAbs / losses) : null;
  const profitFactor = grossLossesAbs > 0 ? grossWins / grossLossesAbs : (grossWins > 0 ? Number.POSITIVE_INFINITY : null);

  return {
    config: describeConfig(config),
    tradesTaken,
    wins,
    losses,
    winRate,
    totalPnl,
    avgWin,
    avgLoss,
    profitFactor,
  };
}

function runBacktest(markets, timeframe) {
  const thresholds = getThresholds(timeframe);

  return Array.from(buildConfigs(), (config) => {
    const trades = [];

    for (const ticks of markets.values()) {
      trades.push(...simulateMarket(ticks, config, thresholds));
    }

    return summarizeTrades(trades, config);
  }).sort((a, b) => b.totalPnl - a.totalPnl);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const timeframe = String(args.timeframe || '5m').toLowerCase();

  if (timeframe !== '5m' && timeframe !== '15m') {
    throw new Error(`Invalid --timeframe value: ${args.timeframe}`);
  }

  const { from, to } = getDateRange(args);
  const client = getClient();
  const ticks = await fetchTicks(client, timeframe, from, to);

  console.log(`Historical backtest | timeframe=${timeframe} | range=${formatDateOnly(from)} to ${formatDateOnly(to)}`);
  console.log(`Ticks processed: ${ticks.length}`);

  if (ticks.length === 0) {
    console.log('No ticks found for the selected range.');
    return;
  }

  const markets = groupByMarket(ticks);
  const results = runBacktest(markets, timeframe);

  console.log(`Markets analyzed: ${markets.size}`);
  console.log(renderTable(results));
}

main().catch((error) => {
  console.error('Historical backtest failed:', error?.message || error);
  process.exitCode = 1;
});
