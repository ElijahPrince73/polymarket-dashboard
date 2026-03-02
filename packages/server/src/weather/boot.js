/**
 * Weather bot boot module.
 * Exports mountRoutes(app) and initialize() for the unified server.
 */
import { Router } from "express";
import db from "./db.js";
import * as config from "./config.js";
import { runMonitor } from "./services/monitor.js";
import { dailySummary, rollingReport } from "./services/reporter.js";
import { runResolver } from "./services/resolver.js";
import { runTradeDiscovery } from "./services/trader.js";
import { cancelOrder, getBalance, getOpenOrders, isLiveMode } from "./services/exchange.js";

let startedAt = null;
let lastTickAt = null;
let lastTickResult = null;
let tickInFlight = null;
let tickTimer = null;
let tradingEnabled = true;

const tickIntervalMs = 30 * 60 * 1000;

async function runTickCycle() {
  if (tickInFlight) return tickInFlight;
  tickInFlight = (async () => {
    const trade = await runTradeDiscovery(db);
    const monitor = await runMonitor(db);
    const resolve = await runResolver(db);
    const summary = {
      daily: await dailySummary(),
      rolling: await rollingReport(db, 30),
    };
    lastTickAt = new Date().toISOString();
    lastTickResult = { trade, monitor, resolve, summary };
    return lastTickResult;
  })().finally(() => {
    tickInFlight = null;
  });
  return tickInFlight;
}

/**
 * Initialize the weather bot (tick loop, etc).
 */
export async function initialize() {
  startedAt = Date.now();
  console.log("[Weather] Initializing...");

  // Run first tick
  runTickCycle().catch((error) => {
    console.error(`[Weather] Startup tick failed:`, error);
  });

  // Start recurring tick timer
  tickTimer = setInterval(() => {
    runTickCycle().catch((error) => {
      console.error(`[Weather] Scheduled tick failed:`, error);
    });
  }, tickIntervalMs);

  console.log("[Weather] Initialized — tick interval: 30 min");
}

/**
 * Mount weather API routes on the given Express app/router.
 */
export function mountRoutes(app) {
  const router = Router();

  router.get("/status", async (_req, res) => {
    const live = isLiveMode();
    const bankroll = await db.getBankroll();
    const liveBalance = live ? await getBalance() : null;
    const openTrades = await db.getOpenTrades();
    res.json({
      tradingEnabled,
      tradingMode: isLiveMode() ? "live" : "paper",
      envTradingMode: live ? "live" : "paper",
      bankroll,
      liveBalance,
      openTrades: openTrades.length,
      uptime: startedAt ? Math.floor((Date.now() - startedAt) / 1000) : 0,
      lastTickAt,
    });
  });

  router.get("/trades", async (req, res) => {
    const status = typeof req.query.status === "string" ? req.query.status : null;
    const trades = await db.getAllTrades(status);
    res.json(trades);
  });

  router.get("/trades/:id", async (req, res) => {
    const id = Number.parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) return res.status(400).json({ error: "Invalid trade id" });
    const row = await db.getTradeById(id);
    if (!row) return res.status(404).json({ error: "Trade not found" });
    res.json(row);
  });

  router.get("/summary", async (_req, res) => {
    res.json({
      daily: await dailySummary(),
      rolling: await rollingReport(db, 30),
    });
  });

  router.get("/calibration", async (_req, res) => {
    // Get all calibration rows via Supabase
    const { createClient } = await import("@supabase/supabase-js");
    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
    const { data, error } = await supabase
      .from("weather_calibration")
      .select("*")
      .order("city")
      .order("market_type");
    if (error) return res.status(500).json({ error: error.message });
    res.json(data ?? []);
  });

  router.post("/tick", async (_req, res) => {
    try {
      const result = await runTickCycle();
      res.json(result);
    } catch (error) {
      res.status(500).json({ error: error?.message || "Tick failed" });
    }
  });

  router.post("/trading/start", (_req, res) => {
    tradingEnabled = true;
    // Restart tick timer if not running
    if (!tickTimer) {
      tickTimer = setInterval(() => {
        if (tradingEnabled) {
          runTickCycle().catch((error) => {
            console.error(`[Weather] Scheduled tick failed:`, error);
          });
        }
      }, tickIntervalMs);
    }
    res.json({ ok: true, tradingEnabled: true });
  });

  router.post("/trading/stop", async (_req, res) => {
    tradingEnabled = false;
    res.json({ ok: true, tradingEnabled: false });
  });

  router.post("/mode", (req, res) => {
    const mode = String(req.body?.mode || "").toLowerCase();
    if (mode !== "paper" && mode !== "live") {
      return res.status(400).json({ error: 'Mode must be "paper" or "live"' });
    }
    res.json({
      ok: true,
      tradingMode: mode,
      envTradingMode: isLiveMode() ? "live" : "paper",
      note: "Display mode updated. Actual trading mode is controlled by TRADING_MODE env.",
    });
  });

  router.post("/kill", async (_req, res) => {
    try {
      const orders = await getOpenOrders();
      const cancelled = [];
      const cancelErrors = [];
      for (const order of orders) {
        const id = order?.id ?? order?.orderID ?? order?.orderId;
        if (!id) continue;
        const result = await cancelOrder(id);
        if (result.success) cancelled.push(id);
        else cancelErrors.push({ id, error: result.error });
      }

      const skipped = await db.markOpenTradesAsSkip();

      res.json({
        ok: true,
        openOrdersFound: orders.length,
        cancelledCount: cancelled.length,
        cancelErrors,
        openTradesMarkedSkip: skipped,
      });
    } catch (error) {
      res.status(500).json({ error: error?.message || "Kill switch failed" });
    }
  });

  app.use("/api/weather", router);
  console.log("[Weather] Routes mounted at /api/weather");
}

/**
 * Graceful shutdown for weather bot.
 */
export function shutdown() {
  if (tickTimer) {
    clearInterval(tickTimer);
    tickTimer = null;
  }
  console.log("[Weather] Shut down");
}
