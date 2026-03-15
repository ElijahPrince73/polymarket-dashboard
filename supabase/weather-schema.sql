-- Migration: ALTER TABLE weather_trades ADD COLUMN IF NOT EXISTS trading_mode TEXT DEFAULT 'paper';
-- Weather trades table (mirrors SQLite schema)
CREATE TABLE IF NOT EXISTS weather_trades (
  id BIGSERIAL PRIMARY KEY,
  city TEXT,
  station TEXT,
  question TEXT,
  market_url TEXT,
  event_date TEXT,
  side TEXT CHECK (side IN ('YES', 'NO') OR side IS NULL),
  entry_price DOUBLE PRECISION,
  model_prob DOUBLE PRECISION,
  edge DOUBLE PRECISION,
  size_pct DOUBLE PRECISION,
  stake_usd DOUBLE PRECISION,
  status TEXT CHECK (status IN ('OPEN', 'SKIP', 'SWITCHED', 'STOP', 'RESOLVED')),
  result TEXT CHECK (result IN ('PENDING', 'WIN', 'LOSS')),
  pnl DOUBLE PRECISION,
  notes TEXT,
  token_id TEXT,
  order_id TEXT,
  fill_size INTEGER,
  condition_id TEXT,
  neg_risk INTEGER DEFAULT 0,
  trading_mode TEXT DEFAULT 'paper',
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Weather calibration table
CREATE TABLE IF NOT EXISTS weather_calibration (
  id BIGSERIAL PRIMARY KEY,
  city TEXT NOT NULL,
  market_type TEXT NOT NULL,
  bias DOUBLE PRECISION,
  updated_at TIMESTAMPTZ,
  UNIQUE(city, market_type)
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_weather_trades_status ON weather_trades(status);
CREATE INDEX IF NOT EXISTS idx_weather_trades_city_date ON weather_trades(city, event_date);
CREATE INDEX IF NOT EXISTS idx_weather_trades_result ON weather_trades(result);
