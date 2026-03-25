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
import { cancelOrder, getBalance, getOpenOrders, getTokenBalance, isLiveMode, setLiveMode } from "./services/exchange.js";

let startedAt = null;
let lastTickAt = null;
let lastTickResult = null;
let tickInFlight = null;
let tickTimer = null;
let tradingEnabled = true;

const tickIntervalMs = 10 * 60 * 1000;

function toFiniteNumber(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function getOrderId(order) {
  const id = order?.id ?? order?.orderID ?? order?.orderId;
  return id == null ? null : String(id);
}

function getRemainingOrderSize(order, fillSize = 0) {
  const explicitRemaining = [
    order?.remaining_size,
    order?.remainingSize,
    order?.unfilled_size,
    order?.unfilledSize,
  ]
    .map(toFiniteNumber)
    .find((value) => value != null);

  if (explicitRemaining != null) {
    return Math.max(0, explicitRemaining);
  }

  const originalSize = [
    order?.original_size,
    order?.originalSize,
    order?.initial_size,
    order?.initialSize,
  ]
    .map(toFiniteNumber)
    .find((value) => value != null);

  if (originalSize != null) {
    return Math.max(0, originalSize - fillSize);
  }

  const fallbackSize = toFiniteNumber(order?.size);
  return Math.max(0, (fallbackSize ?? 0) - fillSize);
}

function enrichTradesWithOpenOrders(trades, openOrders) {
  const orderMap = new Map(
    (openOrders || [])
      .map((order) => [getOrderId(order), order])
      .filter(([id]) => !!id)
  );

  return (trades || []).map((trade) => {
    const liveOrder = trade.order_id ? orderMap.get(String(trade.order_id)) ?? null : null;
    
    if (liveOrder) {
      // Use live order data as truth
      const originalSize = toFiniteNumber(liveOrder.original_size) ?? toFiniteNumber(liveOrder.size) ?? 0;
      const matchedSize = toFiniteNumber(liveOrder.size_matched) ?? 0;
      const actualPosition = Math.max(0, matchedSize);
      const pendingOrderSize = Math.max(0, originalSize - matchedSize);
      
      return {
        ...trade,
        actualPosition,
        pendingOrderSize,
        orderStillActive: true,
        liveOrder,
        unrealizedPnl: null,
      };
    } else {
      // No live order found - use database fill_size as fallback
      const fillSize = Math.max(0, toFiniteNumber(trade.fill_size) ?? 0);
      return {
        ...trade,
        actualPosition: fillSize,
        pendingOrderSize: 0,
        orderStillActive: false,
        liveOrder: null,
        unrealizedPnl: null,
      };
    }
  });
}

async function runTickCycle() {
  if (tickInFlight) return tickInFlight;
  tickInFlight = (async () => {
    try {
      console.log(`[Weather] Starting tick cycle at ${new Date().toISOString()}`);
      const trade = await runTradeDiscovery(db);
      const monitor = await runMonitor(db);
      const resolve = await runResolver(db);
      const summary = {
        daily: await dailySummary(),
        rolling: await rollingReport(db, 30),
      };
      lastTickAt = new Date().toISOString();
      lastTickResult = { trade, monitor, resolve, summary };
      console.log(`[Weather] Tick completed: ${trade.logs?.length || 0} discoveries, ${monitor.updated || 0} monitored, ${resolve.resolved || 0} resolved`);
      return lastTickResult;
    } catch (error) {
      console.error(`[Weather] Tick cycle failed:`, error);
      lastTickAt = new Date().toISOString(); // Still update timestamp so we know tick attempted
      throw error; // Re-throw so the catch in initialize() handles it
    }
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

  console.log(`[Weather] Initialized — tick interval: ${tickIntervalMs / 60000} min`);
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
      tradingMode: live ? "live" : "paper",
      bankroll,
      liveBalance,
      openTrades: openTrades.length,
      uptime: startedAt ? Math.floor((Date.now() - startedAt) / 1000) : 0,
      lastTickAt,
    });
  });

  router.get("/trades", async (req, res) => {
    const status = typeof req.query.status === "string" ? req.query.status : null;
    const [trades, openOrders] = await Promise.all([db.getAllTrades(status), getOpenOrders()]);
    res.json(enrichTradesWithOpenOrders(trades, openOrders));
  });

  router.post("/sync-database", async (_req, res) => {
    try {
      // Get live orders and database trades
      const [liveOrders, dbTrades] = await Promise.all([getOpenOrders(), db.getAllTrades()]);
      
      const dbTradeMap = new Map();
      dbTrades.forEach(trade => {
        if (trade.order_id) {
          dbTradeMap.set(trade.order_id, trade);
        }
      });

      const conditionIdMap = new Map();
      dbTrades.forEach(trade => {
        if (trade.condition_id) {
          conditionIdMap.set(trade.condition_id, trade);
        }
      });
      
      let synced = 0;
      let errors = [];
      
      for (const order of liveOrders) {
        const dbTrade = dbTradeMap.get(order.id) || conditionIdMap.get(order.market);
        if (!dbTrade) continue; // Skip orders not in our database
        
        const liveSize = parseFloat(order.size_matched || 0);
        const dbSize = parseFloat(dbTrade.fill_size || 0);
        const liveStatus = (liveSize > 0 && parseFloat(order.original_size || 0) - liveSize < 0.01) ? 'FILLED' : 'OPEN';
        
        // Update if size_matched or status differs
        if (Math.abs(liveSize - dbSize) > 0.001 || dbTrade.status !== liveStatus) {
          try {
            await db.updateTrade(order.id, {
              fill_size: liveSize,
              status: liveStatus,
              actual_position: liveSize,
              synced_at: new Date().toISOString()
            });
            synced += 1;
          } catch (err) {
            errors.push(`${order.id}: ${err.message}`);
          }
        }
      }
      
      res.json({
        success: true,
        synced,
        totalLiveOrders: liveOrders.length,
        totalDbTrades: dbTrades.length,
        errors: errors.length > 0 ? errors : undefined
      });
    } catch (error) {
      res.status(500).json({ error: error?.message || "Failed to sync database" });
    }
  });

  router.get("/live-positions", async (_req, res) => {
    try {
      // Get actual positions and orders from Polymarket + database for enrichment
      const [liveOrders, dbTrades] = await Promise.all([getOpenOrders(), db.getAllTrades()]);
      
      // Create maps for quick lookup
      const dbTradeMap = new Map();
      dbTrades.forEach(trade => {
        if (trade.order_id) {
          dbTradeMap.set(trade.order_id, trade);
        }
      });

      const conditionIdMap = new Map();
      dbTrades.forEach(trade => {
        if (trade.condition_id) {
          conditionIdMap.set(trade.condition_id, trade);
        }
      });
      
      // Process live orders to separate positions from pending orders
      const positions = [];
      const pendingOrders = [];
      
      for (const order of liveOrders) {
        const sizeMatched = parseFloat(order.size_matched || 0);
        const originalSize = parseFloat(order.original_size || 0);
        const pendingSize = originalSize - sizeMatched;
        
        // Get enriched info from database if available, otherwise use live data
        const dbTrade = dbTradeMap.get(order.id) || conditionIdMap.get(order.market);
        
        const baseOrderData = {
          id: order.id,
          city: dbTrade?.city || 'Unknown',
          side: order.outcome === 'Yes' ? 'YES' : 'NO', 
          question: dbTrade?.question || 'Unknown market',
          market_url: dbTrade?.market_url || null,
          event_date: dbTrade?.event_date || null,
          entry_price: parseFloat(order.price),
          created_at: order.created_at ? new Date(order.created_at * 1000).toISOString() : null,
          isLive: true
        };
        
        // If there are filled shares, it's a position
        if (sizeMatched > 0) {
          positions.push({
            ...baseOrderData,
            actualPosition: sizeMatched,
            value: sizeMatched * parseFloat(order.price)
          });
        }
        
        // If there's pending size, it's a pending order  
        if (pendingSize > 0.01) { // Small threshold to avoid floating point issues
          pendingOrders.push({
            ...baseOrderData,
            pendingSize: pendingSize,
            value: pendingSize * parseFloat(order.price)
          });
        }
      }
      
      res.json({
        positions: positions.sort((a, b) => (b.created_at || '').localeCompare(a.created_at || '')),
        pendingOrders: pendingOrders.sort((a, b) => (a.event_date || '').localeCompare(b.event_date || '')),
        summary: {
          totalPositions: positions.length,
          totalValue: positions.reduce((sum, p) => sum + p.value, 0),
          totalPendingOrders: pendingOrders.length,
          totalPendingValue: pendingOrders.reduce((sum, p) => sum + p.value, 0)
        }
      });
    } catch (error) {
      res.status(500).json({ error: error?.message || "Failed to get live positions" });
    }
  });

  router.get("/open-orders", async (_req, res) => {
    res.json(await getOpenOrders());
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

  router.post("/sync-orders", async (_req, res) => {
    try {
      const [dbTrades, liveOrders] = await Promise.all([
        db.getAllTrades("OPEN"),
        getOpenOrders()
      ]);
      
      const liveOrderMap = new Map(liveOrders.map(o => [o.id, o]));
      let updated = 0;
      let restored = 0;
      
      // Update database trades that were marked SKIP but still have live orders
      for (const trade of await db.getAllTrades("SKIP")) {
        if (trade.order_id && liveOrderMap.has(trade.order_id)) {
          await db.updateTrade(trade.id, { status: "OPEN" });
          restored++;
        }
      }
      
      // Update live order data
      for (const trade of [...dbTrades, ...(await db.getAllTrades("OPEN"))]) {
        if (trade.order_id && liveOrderMap.has(trade.order_id)) {
          const liveOrder = liveOrderMap.get(trade.order_id);
          const sizeMatched = parseFloat(liveOrder.size_matched || 0);
          
          if (Math.abs(sizeMatched - (trade.fill_size || 0)) > 0.001) {
            await db.updateTrade(trade.id, { 
              fill_size: sizeMatched,
              notes: (trade.notes || "") + " | Synced with live order" 
            });
            updated++;
          }
        }
      }
      
      res.json({
        ok: true,
        liveOrdersFound: liveOrders.length,
        tradesRestored: restored,
        tradesUpdated: updated
      });
    } catch (error) {
      res.status(500).json({ error: error?.message || "Sync failed" });
    }
  });

  router.post("/mode", (req, res) => {
    const mode = String(req.body?.mode || "").toLowerCase();
    if (mode !== "paper" && mode !== "live") {
      return res.status(400).json({ error: 'Mode must be "paper" or "live"' });
    }
    const nowLive = setLiveMode(mode === "live");
    console.log(`[Weather] Trading mode switched to ${nowLive ? "LIVE" : "PAPER"}`);
    res.json({
      ok: true,
      tradingMode: nowLive ? "live" : "paper",
    });
  });

  router.post("/cancel-selective", async (req, res) => {
    try {
      const { tradeIds, orderIds, reason } = req.body;
      const cancelled = [];
      const cancelErrors = [];
      const dbUpdated = [];
      
      // Cancel by trade IDs
      if (tradeIds && Array.isArray(tradeIds)) {
        const trades = await Promise.all(tradeIds.map(id => db.getTradeById(id)));
        for (const trade of trades.filter(Boolean)) {
          if (trade.order_id) {
            const result = await cancelOrder(trade.order_id);
            if (result.success) {
              cancelled.push(trade.order_id);
              await db.updateTrade(trade.id, { 
                status: "SKIP", 
                notes: (trade.notes || "") + ` | CANCELLED: ${reason || "city threshold adjustment"}` 
              });
              dbUpdated.push(trade.id);
            } else {
              cancelErrors.push({ tradeId: trade.id, orderId: trade.order_id, error: result.error });
            }
          }
        }
      }
      
      // Cancel by order IDs directly
      if (orderIds && Array.isArray(orderIds)) {
        for (const orderId of orderIds) {
          const result = await cancelOrder(orderId);
          if (result.success) cancelled.push(orderId);
          else cancelErrors.push({ orderId, error: result.error });
        }
      }

      res.json({
        ok: true,
        reason: reason || "city threshold adjustment",
        cancelled: cancelled.length,
        cancelErrors: cancelErrors.length,
        dbUpdated: dbUpdated.length,
        details: { cancelled, cancelErrors, dbUpdated }
      });
    } catch (error) {
      res.status(500).json({ error: error?.message || "Selective cancel failed" });
    }
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

      // Only mark as SKIP if cancellation actually succeeded
      let skipped = 0;
      if (cancelled.length === orders.length && cancelErrors.length === 0) {
        skipped = await db.markOpenTradesAsSkip();
      }

      res.json({
        ok: true,
        openOrdersFound: orders.length,
        cancelledCount: cancelled.length,
        cancelErrors,
        openTradesMarkedSkip: skipped,
        warning: cancelErrors.length > 0 ? "Some orders failed to cancel" : null
      });
    } catch (error) {
      res.status(500).json({ error: error?.message || "Kill switch failed" });
    }
  });

  router.post("/dedup-trades", async (_req, res) => {
    try {
      const { createClient } = await import("@supabase/supabase-js");
      const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
      const { data: all } = await supabase.from("weather_trades").select("id,city,question,event_date").order("id");
      const seen = new Map();
      const dupeIds = [];
      for (const row of (all || [])) {
        const key = `${row.city}|${row.question}|${row.event_date}`;
        if (seen.has(key)) dupeIds.push(row.id);
        else seen.set(key, row.id);
      }
      if (dupeIds.length) {
        const { error } = await supabase.from("weather_trades").delete().in("id", dupeIds);
        if (error) throw error;
      }
      res.json({ ok: true, deleted: dupeIds.length });
    } catch (error) {
      res.status(500).json({ error: error?.message || "Dedup failed" });
    }
  });

  router.post("/reset-trades", async (_req, res) => {
    try {
      const { createClient } = await import("@supabase/supabase-js");
      const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
      const { data, error } = await supabase
        .from("weather_trades")
        .delete()
        .neq("status", "OPEN")
        .select("id");
      if (error) throw error;
      res.json({ ok: true, deleted: data?.length ?? 0 });
    } catch (error) {
      res.status(500).json({ error: error?.message || "Reset failed" });
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
