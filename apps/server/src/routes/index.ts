import { Router } from "express";

import type { AppServices } from "../app.js";
import type { AppConfig } from "../config/env.js";

import { createExecutionRouter } from "./execution.js";
import { createHealthRouter } from "./health.js";
import { createMarketRouter } from "./market.js";
import { createSignalRouter } from "./signals.js";
import { createStatusRouter } from "./status.js";

export function createApiRouter(config: AppConfig, services: AppServices) {
  const router = Router();

  router.use("/health", createHealthRouter(config));
  router.use("/api/v1/status", createStatusRouter(config));
  router.use(
    "/api/v1/market",
    createMarketRouter(config, services.marketStore, services.candleRepository)
  );
  router.use("/api/v1/signals", createSignalRouter(config, services.signalRepository));
  router.use(
    "/api/v1/execution",
    createExecutionRouter(
      config,
      services.orderRepository,
      services.tradeRepository,
      services.positionRepository
    )
  );
  router.get("/api/v1/error", (_req, _res, next) => {
    next(new Error("Intentional route failure"));
  });

  return router;
}
