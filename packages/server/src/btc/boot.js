/**
 * BTC 5-min trader boot module.
 * Thin wrapper that exports mountRoutes(app), initialize(), and shutdown()
 * for the unified dashboard server.
 */
import { installQuietMode } from './lib/logger.js';
import { mountBtcRoutes } from './ui/server.js';
import { startApp } from './index.js';

// Silence BTC verbose logs in unified mode
installQuietMode();

let _engine = null;
let _modeManager = null;

/**
 * Mount BTC API routes on the given Express app.
 */
export function mountRoutes(app) {
  mountBtcRoutes(app, '/api/btc');
}

/**
 * Initialize the BTC trading engine (Chainlink streams, trading loop, etc).
 * The trading loop runs in the background — this returns immediately.
 */
export async function initialize() {
  console.log("[BTC] Initializing...");
  const result = await startApp({ skipServer: true });
  _engine = result?.engine ?? null;
  _modeManager = result?.modeManager ?? null;
  console.log("[BTC] Initialized — trading loop running in background");
  return { engine: _engine, modeManager: _modeManager };
}

/**
 * Graceful shutdown.
 */
export function shutdown() {
  if (_engine) {
    _engine.tradingEnabled = false;
  }
  console.log("[BTC] Shut down");
}
