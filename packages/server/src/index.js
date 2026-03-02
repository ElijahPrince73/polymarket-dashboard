import path from "node:path";
import { fileURLToPath } from "node:url";

import cors from "cors";
import dotenv from "dotenv";
import express from "express";

import { proxyRequest } from "./lib/proxy.js";
import { errorHandler } from "./middleware/errorHandler.js";
import btcRoutes from "./routes/btc.js";
import weatherRoutes from "./routes/weather.js";

dotenv.config();

const app = express();
const port = Number(process.env.PORT) || 4000;
const btcBaseUrl = process.env.BTC_TRADER_URL || "http://localhost:3000";
const weatherBaseUrl = process.env.WEATHER_BOT_URL || "http://localhost:3001";

app.use(cors());
app.use(express.json());

app.get("/api/health", async (_req, res, next) => {
  try {
    const [btcResult, weatherResult] = await Promise.allSettled([
      proxyRequest({ baseUrl: btcBaseUrl, path: "/api/status" }),
      proxyRequest({ baseUrl: weatherBaseUrl, path: "/api/status" }),
    ]);

    const btc = {
      ok: btcResult.status === "fulfilled",
      status: btcResult.status === "fulfilled" ? btcResult.value.status : 503,
      data: btcResult.status === "fulfilled" ? btcResult.value.body : null,
      error: btcResult.status === "rejected" ? btcResult.reason.message : null,
    };

    const weather = {
      ok: weatherResult.status === "fulfilled",
      status: weatherResult.status === "fulfilled" ? weatherResult.value.status : 503,
      data: weatherResult.status === "fulfilled" ? weatherResult.value.body : null,
      error: weatherResult.status === "rejected" ? weatherResult.reason.message : null,
    };

    const ok = btc.ok && weather.ok;

    res.status(ok ? 200 : 503).json({
      ok,
      services: {
        btc,
        weather,
      },
    });
  } catch (error) {
    next(error);
  }
});

app.use("/api/btc", btcRoutes);
app.use("/api/weather", weatherRoutes);

if (process.env.NODE_ENV === "production") {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  const clientDistPath = path.resolve(__dirname, "../../client/dist");

  app.use(express.static(clientDistPath));

  app.get("*", (_req, res) => {
    res.sendFile(path.join(clientDistPath, "index.html"));
  });
}

app.use(errorHandler);

app.listen(port, () => {
  console.log(`Unified server listening on port ${port}`);
});

