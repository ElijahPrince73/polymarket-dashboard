const API_ENDPOINTS = [
  {
    label: '5m',
    url: 'https://polymarket-dashboard-ip4ea.ondigitalocean.app/api/btc/trades',
  },
  {
    label: '15m',
    url: 'https://polymarket-dashboard-ip4ea.ondigitalocean.app/api/btc15m/trades',
  },
];

const PARAM_GRID = {
  minCheapEntryPrice: [0.15, 0.20, 0.25, 0.30],
  maxCheapEntryPrice: [0.40, 0.45, 0.50],
  rsiBias: [false, true],
  recGating: [false, true],
};

const RSI_BEARISH = 40;
const RSI_BULLISH = 60;

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

async function fetchTrades(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} ${response.statusText}`);
  }

  const json = await response.json();
  const trades = Array.isArray(json)
    ? json
    : Array.isArray(json?.data)
      ? json.data
      : Array.isArray(json?.trades)
        ? json.trades
        : null;

  if (!trades) {
    throw new Error('Unexpected response shape');
  }

  return trades.filter((trade) => String(trade?.status || '').toUpperCase() === 'CLOSED');
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

function getTradeSide(trade) {
  const side = String(trade?.side ?? trade?.entryGateSnapshot?.effectiveSide ?? '').toUpperCase();
  return side === 'UP' || side === 'DOWN' ? side : null;
}

function passesEntryFilter(trade, config) {
  const entryPrice = toNum(trade?.entryPrice);
  if (!isNum(entryPrice)) return false;
  if (entryPrice < config.minCheapEntryPrice || entryPrice > config.maxCheapEntryPrice) {
    return false;
  }

  if (config.rsiBias) {
    const side = getTradeSide(trade);
    const rsi = toNum(trade?.rsiAtEntry);
    if (side === 'UP' && isNum(rsi) && rsi < config.rsiBearish) return false;
    if (side === 'DOWN' && isNum(rsi) && rsi > config.rsiBullish) return false;
  }

  if (config.recGating && trade?.recActionAtEntry !== 'ENTER') {
    return false;
  }

  return true;
}

function summarizeTrades(trades, config) {
  let wins = 0;
  let losses = 0;
  let grossWins = 0;
  let grossLossesAbs = 0;
  let totalPnl = 0;
  let taken = 0;

  for (const trade of trades) {
    if (!passesEntryFilter(trade, config)) continue;

    taken += 1;
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

  const winRate = taken > 0 ? wins / taken : null;
  const avgWin = wins > 0 ? grossWins / wins : null;
  const avgLoss = losses > 0 ? -(grossLossesAbs / losses) : null;
  const profitFactor = grossLossesAbs > 0 ? grossWins / grossLossesAbs : (grossWins > 0 ? Number.POSITIVE_INFINITY : null);

  return {
    config: describeConfig(config),
    tradesTaken: taken,
    wins,
    losses,
    winRate,
    totalPnl,
    avgWin,
    avgLoss,
    profitFactor,
  };
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

async function runForEndpoint(endpoint) {
  const trades = await fetchTrades(endpoint.url);
  const results = Array.from(buildConfigs(), (config) => summarizeTrades(trades, config))
    .sort((a, b) => b.totalPnl - a.totalPnl);

  console.log(`\n=== ${endpoint.label} Backtest ===`);
  console.log(`Closed trades fetched: ${trades.length}`);
  console.log(renderTable(results));
}

async function main() {
  for (const endpoint of API_ENDPOINTS) {
    await runForEndpoint(endpoint);
  }
}

main().catch((error) => {
  console.error('Backtest failed:', error?.message || error);
  process.exitCode = 1;
});
