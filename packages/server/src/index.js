/**
 * Unified Polymarket Dashboard Server
 * 
 * Single Express process hosting:
 * - BTC 5-min trader (routes + trading engine)
 * - Weather bot (routes + tick loop)
 * - React dashboard (static build in production)
 */
import 'dotenv/config';
import path from "node:path";
import { fileURLToPath } from "node:url";
import cors from "cors";
import express from "express";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const port = Number(process.env.PORT) || 4000;

app.use(cors());
app.use(express.json());

// ── Health check (combined) ────────────────────────────────────────────

app.get("/api/health", (_req, res) => {
  const engine = globalThis.__tradingEngine;
  const uptime = process.uptime();
  const memMb = Math.round(process.memoryUsage().heapUsed / 1024 / 1024 * 100) / 100;

  res.json({
    ok: true,
    timestamp: new Date().toISOString(),
    uptime: Math.round(uptime),
    memoryMb: memMb,
    services: {
      btc: {
        tradingEnabled: engine?.tradingEnabled ?? false,
        lastTick: globalThis.__uiStatus?.lastUpdate ?? null,
      },
      weather: {
        initialized: true,
      },
    },
  });
});

// ── Analytics routes (standalone, no bot dependency) ───────────────────
import analyticsRouter from './routes/analytics.js';
app.use('/api/analytics', analyticsRouter);

// ── Boot sequence ──────────────────────────────────────────────────────

async function boot() {
  console.log("=== Polymarket Dashboard ===");
  console.log(`Starting on port ${port}...`);

  // 1. Mount ALL routes first (before any engine initialization)
  let btc, weather;
  try {
    btc = await import("./btc/boot.js");
    btc.mountRoutes(app);
  } catch (err) {
    console.error("[Boot] BTC route mounting failed:", err.message);
  }
  try {
    weather = await import("./weather/boot.js");
    weather.mountRoutes(app);
  } catch (err) {
    console.error("[Boot] Weather route mounting failed:", err.message);
  }

  // 2. Serve React build (must be AFTER API routes, BEFORE engine init)
  const clientDistPath = path.resolve(__dirname, "../../client/dist");
  app.use(express.static(clientDistPath));
  app.get("/{*path}", (_req, res) => {
    res.sendFile(path.join(clientDistPath, "index.html"));
  });

  // 3. Start listening
  const server = app.listen(port, "0.0.0.0", () => {
    console.log(`\n=== Dashboard running on http://localhost:${port} ===\n`);
  });

  // 4. Initialize trading engines (after server is listening, routes are ready)
  if (btc) {
    try {
      await btc.initialize();
      console.log("[Boot] BTC trader initialized");
    } catch (err) {
      console.error("[Boot] BTC trader failed to initialize:", err.message);
    }
  }
  if (weather) {
    try {
      await weather.initialize();
      console.log("[Boot] Weather bot initialized");
    } catch (err) {
      console.error("[Boot] Weather bot failed to initialize:", err.message);
    }
  }

  // 5. Graceful shutdown
  async function handleShutdown(signal) {
    console.log(`\n[${signal}] Shutting down...`);
    try {
      const btc = await import("./btc/boot.js");
      btc.shutdown?.();
    } catch {}
    try {
      const weather = await import("./weather/boot.js");
      weather.shutdown?.();
    } catch {}
    server.close(() => {
      console.log("Server closed");
      process.exit(0);
    });
    // Force exit after 10s
    setTimeout(() => process.exit(1), 10000);
  }

  process.on("SIGINT", () => handleShutdown("SIGINT"));
  process.on("SIGTERM", () => handleShutdown("SIGTERM"));
}

boot().catch((err) => {
  console.error("Fatal boot error:", err);
  process.exit(1);
});
