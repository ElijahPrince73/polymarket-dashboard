/**
 * BTC 5-min trader boot module.
 * Thin wrapper that exports mountRoutes(app), initialize(), and shutdown()
 * for the unified dashboard server.
 */
import { installQuietMode } from './lib/logger.js';
import { mountBtcRoutes } from './ui/server.js';
import { mountBtc15mRoutes } from './ui/server15m.js';
import { startApp } from './index.js';

// Silence BTC verbose logs in unified mode
installQuietMode();

let _engine = null;
let _modeManager = null;
let _engine15m = null;
let _modeManager15m = null;

/**
 * Mount BTC API routes on the given Express app.
 */
export function mountRoutes(app) {
  mountBtcRoutes(app, '/api/btc');
}

export function mountRoutes15m(app) {
  mountBtc15mRoutes(app, '/api/btc15m');
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

  // Belt-and-suspenders auto-start: ensure trading is enabled after boot.
  // The engine constructor sets tradingEnabled=false, and startApp() should flip it,
  // but DO restarts sometimes cause race conditions. This guarantees it.
  const autoStart = (process.env.AUTO_START_TRADING || 'true').toLowerCase() === 'true';
  if (autoStart && _engine && !_engine.tradingEnabled) {
    _engine.tradingEnabled = true;
    console.log("[BTC] Boot auto-start: forced tradingEnabled=true");
  }

  console.log("[BTC] Initialized — trading loop running in background, tradingEnabled:", _engine?.tradingEnabled);

  // Watchdog: check every 60s if trading was unexpectedly disabled.
  // Logs when it re-enables so we can track what's turning it off.
  if (autoStart && _engine) {
    setInterval(() => {
      if (!_engine.tradingEnabled && !_engine._manuallyDisabled) {
        _engine.tradingEnabled = true;
        console.warn("[BTC] Watchdog: trading was disabled unexpectedly — re-enabled");
      }
    }, 60_000);
  }

  return { engine: _engine, modeManager: _modeManager };
}

export async function initialize15m() {
  console.log("[BTC 15m] Initializing...");
  const result = await startApp({ skipServer: true, timeframe: '15m' });
  _engine15m = result?.engine ?? null;
  _modeManager15m = result?.modeManager ?? null;

  const autoStart = (process.env.AUTO_START_TRADING || 'true').toLowerCase() === 'true';
  if (autoStart && _engine15m && !_engine15m.tradingEnabled) {
    _engine15m.tradingEnabled = true;
    console.log("[BTC 15m] Boot auto-start: forced tradingEnabled=true");
  }

  console.log("[BTC 15m] Initialized — trading loop running in background, tradingEnabled:", _engine15m?.tradingEnabled);

  if (autoStart && _engine15m) {
    setInterval(() => {
      if (!_engine15m.tradingEnabled && !_engine15m._manuallyDisabled) {
        _engine15m.tradingEnabled = true;
        console.warn("[BTC 15m] Watchdog: trading was disabled unexpectedly — re-enabled");
      }
    }, 60_000);
  }

  return { engine: _engine15m, modeManager: _modeManager15m };
}

/**
 * Graceful shutdown.
 */
export function shutdown() {
  if (_engine) {
    _engine.tradingEnabled = false;
  }
  if (_engine15m) {
    _engine15m.tradingEnabled = false;
  }
  console.log("[BTC] Shut down");
}
