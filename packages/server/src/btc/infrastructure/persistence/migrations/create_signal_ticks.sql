CREATE TABLE IF NOT EXISTS signal_ticks (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  timeframe TEXT NOT NULL,
  market_slug TEXT NOT NULL,
  time_left_min REAL,
  poly_up REAL,
  poly_down REAL,
  model_up REAL,
  model_down REAL,
  rsi REAL,
  rec_action TEXT,
  rec_side TEXT,
  rec_phase TEXT,
  rec_edge REAL,
  spread_up REAL,
  spread_down REAL,
  btc_spot REAL,
  spot_delta_1m_pct REAL,
  liquidity REAL,
  volume REAL
);

CREATE INDEX IF NOT EXISTS idx_signal_ticks_slug
  ON signal_ticks(market_slug, created_at);

CREATE INDEX IF NOT EXISTS idx_signal_ticks_timeframe
  ON signal_ticks(timeframe, created_at);
