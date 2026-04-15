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
  const engine15m = globalThis.__tradingEngine15m;
  const uptime = process.uptime();
  const memMb = Math.round(process.memoryUsage().heapUsed / 1024 / 1024 * 100) / 100;

  res.json({
    ok: true,
    version: '3.0.0',
    timestamp: new Date().toISOString(),
    uptime: Math.round(uptime),
    memoryMb: memMb,
    services: {
      btc: {
        tradingEnabled: engine?.tradingEnabled ?? false,
        lastTick: globalThis.__uiStatus?.lastUpdate ?? null,
      },
      btc15m: {
        tradingEnabled: engine15m?.tradingEnabled ?? false,
        lastTick: globalThis.__uiStatus15m?.lastUpdate ?? null,
      },
      weather: {
        initialized: true,
      },
      routes: {
        btc: !!globalThis.__btcMounted,
        btc15m: !!globalThis.__btc15mMounted,
      },
    },
  });
});

// ── BTC diagnostics: mount a test route directly in index.js ────────
// This runs regardless of boot.js state, to isolate the issue.
app.get("/api/btc/diag", (_req, res) => {
  console.log('[DIAG] /api/btc/diag called — globalThis keys:', Object.keys(globalThis).filter(k => k.startsWith('__')).join(', '));
  res.json({
    ok: true,
    diag: true,
    globalThis: Object.keys(globalThis).filter(k => k.startsWith('__')),
  });
});

// ── Standalone BTC status (no module dependency) ─────────────────────────
// This endpoint is mounted BEFORE the full BTC boot so we can diagnose
// whether the issue is route mounting or trading loop initialization.
app.get("/api/btc/status", (_req, res) => {
  console.log('[DIAG] /api/btc/status called at', new Date().toISOString());
  const engine = globalThis.__tradingEngine;
  console.log('[DIAG] globalThis.__tradingEngine:', !!engine, 'btcMounted:', globalThis.__btcMounted);
  res.json({
    ok: true,
    mode: 'live',
    tradingEnabled: engine?.tradingEnabled ?? false,
    lastTick: globalThis.__uiStatus?.lastUpdate ?? null,
    mounted: globalThis.__btcMounted ?? false,
    engineAvailable: !!engine,
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
    console.log("[Boot] Importing ./btc/boot.js at", new Date().toISOString());
    btc = await import("./btc/boot.js");
    console.log("[Boot] BTC boot imported, exports:", Object.keys(btc), 'mountRoutes type:', typeof btc.mountRoutes);
    btc.mountRoutes(app);
    btc.mountRoutes15m(app);
    console.log("[Boot] BTC routes mounted successfully");
  } catch (err) {
    console.error("[Boot] BTC route mounting failed:", err.message, err.stack);
  }
  try {
    weather = await import("./weather/boot.js");
    weather.mountRoutes(app);
  } catch (err) {
    console.error("[Boot] Weather route mounting failed:", err.message);
  }

  // 2. Serve React build (must be AFTER API routes, BEFORE engine init)
  const clientDistPath = path.resolve(__dirname, "../../client/dist");
  console.log("[Boot] Static path:", clientDistPath);

  try {
    const { existsSync, readdirSync } = await import("node:fs");
    if (existsSync(clientDistPath)) {
      const files = readdirSync(clientDistPath);
      console.log("[Boot] Dist files:", files.join(", "));
      if (existsSync(path.join(clientDistPath, "assets"))) {
        const assetFiles = readdirSync(path.join(clientDistPath, "assets"));
        console.log("[Boot] Asset files:", assetFiles.join(", "));
      }
    } else {
      console.error("[Boot] WARNING: dist directory NOT FOUND at", clientDistPath);
      // Try alternate paths
      const altPath1 = path.resolve(process.cwd(), "packages/client/dist");
      const altPath2 = path.resolve(process.cwd(), "dist");
      console.log("[Boot] CWD:", process.cwd());
      console.log("[Boot] Alt path 1 exists:", existsSync(altPath1), altPath1);
      console.log("[Boot] Alt path 2 exists:", existsSync(altPath2), altPath2);
    }
  } catch (e) {
    console.error("[Boot] FS check error:", e.message);
  }

  // Try multiple paths for the client dist
  const { existsSync: fsExists } = await import("node:fs");
  const candidates = [
    clientDistPath,
    path.resolve(process.cwd(), "packages/client/dist"),
    path.resolve(process.cwd(), "dist"),
  ];
  let staticPath = clientDistPath;
  for (const candidate of candidates) {
    if (fsExists(candidate) && fsExists(path.join(candidate, "index.html"))) {
      staticPath = candidate;
      console.log("[Boot] Using static path:", staticPath);
      break;
    }
  }

  app.use(express.static(staticPath, { maxAge: '1h' }));
  app.get("/{*path}", (_req, res) => {
    res.sendFile(path.join(staticPath, "index.html"));
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
    try {
      await btc.initialize15m();
      console.log("[Boot] BTC 15m trader initialized");
    } catch (err) {
      console.error("[Boot] BTC 15m trader failed to initialize:", err.message);
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
