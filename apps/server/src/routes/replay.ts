import { Router } from "express";

import type { ReplayService } from "../replay/service.js";

export function createReplayRouter(replayService: ReplayService) {
  const router = Router();

  router.get("/", (_req, res) => {
    res.json({
      replay: replayService.getState()
    });
  });

  router.post("/start", (_req, res) => {
    res.json({
      replay: replayService.start()
    });
  });

  router.post("/stop", (_req, res) => {
    res.json({
      replay: replayService.stop()
    });
  });

  return router;
}
