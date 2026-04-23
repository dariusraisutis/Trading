import { Router } from "express";

import type { AppConfig } from "../config/env.js";
import type { OrderRepository } from "../db/repositories/orders.js";
import type { PositionRepository } from "../db/repositories/positions.js";
import type { TradeRepository } from "../db/repositories/trades.js";

export function createExecutionRouter(
  config: AppConfig,
  orderRepository: OrderRepository,
  tradeRepository: TradeRepository,
  positionRepository: PositionRepository
) {
  const router = Router();

  router.get("/orders", (req, res) => {
    const symbol = readSymbol(req.query.symbol, config.MARKET_SYMBOL);
    const limit = readLimit(req.query.limit);

    res.json({
      symbol,
      orders: orderRepository.listRecent(symbol, limit)
    });
  });

  router.get("/trades", (req, res) => {
    const symbol = readSymbol(req.query.symbol, config.MARKET_SYMBOL);
    const limit = readLimit(req.query.limit);

    res.json({
      symbol,
      trades: tradeRepository.listRecent(symbol, limit)
    });
  });

  router.get("/positions", (req, res) => {
    const symbol = readSymbol(req.query.symbol, config.MARKET_SYMBOL);

    res.json({
      symbol,
      position: positionRepository.findBySymbol(symbol)
    });
  });

  return router;
}

function readSymbol(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim().length > 0 ? value.trim().toUpperCase() : fallback;
}

function readLimit(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    return 100;
  }

  return Math.min(parsed, 500);
}
