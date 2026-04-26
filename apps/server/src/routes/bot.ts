import { Router } from "express";

import type { BotControlService } from "../bot/control-service.js";
import type { ReplayService } from "../replay/service.js";

export function createBotRouter(
  botControlService: BotControlService,
  replayService?: ReplayService
) {
  const router = Router();

  router.get("/", (_req, res) => {
    res.json({
      bot: botControlService.getState(),
      strategies: botControlService.listStrategies()
    });
  });

  router.post("/start", (_req, res) => {
    const bot = botControlService.start();
    const replay = replayService?.start();

    res.json({
      bot,
      ...(replay ? { replay } : {})
    });
  });

  router.post("/stop", (_req, res) => {
    const replay = replayService?.stop();

    res.json({
      bot: botControlService.stop(),
      ...(replay ? { replay } : {})
    });
  });

  router.post("/strategy", (req, res) => {
    const strategy = typeof req.body?.strategy === "string" ? req.body.strategy : "";

    if (!botControlService.isValidStrategy(strategy)) {
      res.status(400).json({
        error: {
          message: "Invalid strategy"
        }
      });
      return;
    }

    res.json({
      bot: botControlService.setStrategy(strategy)
    });
  });

  return router;
}
