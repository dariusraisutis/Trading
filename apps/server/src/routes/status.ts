import { Router } from "express";

import type { BotControlService } from "../bot/control-service.js";
import type { AppConfig } from "../config/env.js";
import type { ReplayService } from "../replay/service.js";

export function createStatusRouter(
  config: AppConfig,
  botControlService: BotControlService,
  replayService?: ReplayService
) {
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
        enabled: config.TRADING_MODE === "replay" ? false : config.MARKET_DATA_ENABLED
      },
      bot: botControlService.getState(),
      strategies: botControlService.listStrategies(),
      ...(replayService
        ? {
            replay: replayService.getState()
          }
        : {})
    });
  });

  return router;
}
