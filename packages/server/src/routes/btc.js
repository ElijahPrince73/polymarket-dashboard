import { Router } from "express";

import { proxyRequest } from "../lib/proxy.js";

const BTC_BASE_URL = process.env.BTC_TRADER_URL || "http://localhost:3000";

const getRoutes = [
  "/status",
  "/trades",
  "/analytics",
  "/live/trades",
  "/live/open-orders",
  "/live/positions",
  "/live/analytics",
  "/markets",
  "/portfolio",
  "/orders",
  "/metrics",
  "/diagnostics",
  "/config/current",
  "/suggestions",
  "/suggestions/tracking",
  "/kill-switch/status",
  "/trading/status",
];

const postRoutes = [
  "/backtest",
  "/optimizer",
  "/config",
  "/config/revert",
  "/suggestions/apply",
  "/kill-switch/override",
  "/trading/start",
  "/trading/stop",
  "/trading/kill",
  "/mode",
];

const router = Router();

const handler =
  (method) =>
  async (req, res, next) => {
    try {
      const { status, body } = await proxyRequest({
        baseUrl: BTC_BASE_URL,
        path: `/api${req.url}`,
        method,
        body: method === "GET" ? undefined : req.body,
      });

      if (body === null) {
        res.status(status).end();
        return;
      }

      res.status(status).json(body);
    } catch (error) {
      next(error);
    }
  };

for (const route of getRoutes) {
  router.get(route, handler("GET"));
}

for (const route of postRoutes) {
  router.post(route, handler("POST"));
}

router.delete("/orders/:id", handler("DELETE"));

export default router;
