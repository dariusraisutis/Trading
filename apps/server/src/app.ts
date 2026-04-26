import express from "express";

import type { BotControlService } from "./bot/control-service.js";
import type { AppConfig } from "./config/env.js";
import type { CandleRepository } from "./db/repositories/candles.js";
import type { OrderRepository } from "./db/repositories/orders.js";
import type { PositionRepository } from "./db/repositories/positions.js";
import type { SignalRepository } from "./db/repositories/signals.js";
import type { TradeRepository } from "./db/repositories/trades.js";
import type { MarketDataStore } from "./market/store.js";
import type { ReplayService } from "./replay/service.js";
import type pino from "pino";

import { createErrorHandler } from "./middleware/error-handler.js";
import { corsMiddleware } from "./middleware/cors.js";
import { createRequestLogger } from "./middleware/request-logger.js";
import { createApiRouter } from "./routes/index.js";

export interface AppServices {
  botControlService: BotControlService;
  marketStore: MarketDataStore;
  candleRepository: CandleRepository;
  signalRepository: SignalRepository;
  orderRepository: OrderRepository;
  tradeRepository: TradeRepository;
  positionRepository: PositionRepository;
  replayService?: ReplayService;
}

export function createApp(config: AppConfig, logger: pino.Logger, services: AppServices) {
  const app = express();

  app.use(express.json());
  app.use(corsMiddleware);
  app.options("*", corsMiddleware);
  app.use(createRequestLogger(logger));
  app.use(createApiRouter(config, services));
  app.use(createErrorHandler(logger));

  return app;
}
