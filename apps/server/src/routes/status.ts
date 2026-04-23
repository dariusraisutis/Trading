import { Router } from "express";

import type { AppConfig } from "../config/env.js";

export function createStatusRouter(config: AppConfig) {
  const router = Router();

  router.get("/", (_req, res) => {
    res.json({
      status: "ready",
      mode: config.TRADING_MODE,
      liveEnabled: config.ENABLE_LIVE,
      database: {
        path: config.DB_PATH
      },
      market: {
        symbol: config.MARKET_SYMBOL,
        enabled: config.MARKET_DATA_ENABLED
      }
    });
  });

  return router;
}
