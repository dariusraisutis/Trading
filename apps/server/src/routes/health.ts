import { Router } from "express";

import type { AppConfig } from "../config/env.js";

export function createHealthRouter(config: AppConfig) {
  const router = Router();

  router.get("/", (_req, res) => {
    res.json({
      status: "OK",
      mode: config.TRADING_MODE
    });
  });

  return router;
}
