import { Router } from "express";

import { proxyRequest } from "../lib/proxy.js";

const WEATHER_BASE_URL = process.env.WEATHER_BOT_URL || "http://localhost:3001";

const getRoutes = ["/status", "/trades", "/trades/:id", "/summary", "/calibration"];
const postRoutes = ["/tick", "/mode", "/kill"];

const router = Router();

const handler =
  (method) =>
  async (req, res, next) => {
    try {
      const { status, body } = await proxyRequest({
        baseUrl: WEATHER_BASE_URL,
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

export default router;
