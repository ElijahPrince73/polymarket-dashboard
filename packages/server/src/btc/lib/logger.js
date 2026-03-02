/**
 * BTC bot logger — silences verbose output in unified dashboard mode.
 * Set BTC_VERBOSE=1 to see all logs.
 */
const verbose = process.env.BTC_VERBOSE === '1' || process.env.BTC_VERBOSE === 'true';

const originalLog = console.log;
const originalWarn = console.warn;

let installed = false;

export function installQuietMode() {
  if (installed) return;
  installed = true;

  if (verbose) return; // Don't modify anything in verbose mode

  // Only suppress console.log, keep console.error and console.warn
  console.log = (...args) => {
    const msg = args[0];
    if (typeof msg !== 'string') return originalLog(...args);

    // Always show critical messages
    if (
      msg.includes('[Boot]') ||
      msg.includes('[BTC]') ||
      msg.includes('[Weather]') ||
      msg.includes('=== Dashboard') ||
      msg.includes('=== Polymarket') ||
      msg.includes('TRADE') ||
      msg.includes('ERROR') ||
      msg.includes('FATAL') ||
      msg.includes('RECONCIL') ||
      msg.includes('[TradeStore]')
    ) {
      return originalLog(...args);
    }

    // Suppress everything else
  };
}

export function restoreConsole() {
  console.log = originalLog;
  console.warn = originalWarn;
}
