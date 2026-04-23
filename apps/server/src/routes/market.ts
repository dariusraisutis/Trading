import { Router } from "express";

import type { AppConfig } from "../config/env.js";
import type { CandleRepository } from "../db/repositories/candles.js";
import type { MarketDataStore } from "../market/store.js";

export function createMarketRouter(
  config: AppConfig,
  marketStore: MarketDataStore,
  candleRepository: CandleRepository
) {
  const router = Router();

  router.get("/price", (req, res) => {
    const symbol =
      typeof req.query.symbol === "string" && req.query.symbol.trim().length > 0
        ? req.query.symbol.trim().toUpperCase()
        : config.MARKET_SYMBOL;

    const price = marketStore.getPrice(symbol);

    res.json({
      symbol,
      price
    });
  });

  router.get("/candles", (req, res) => {
    const symbol =
      typeof req.query.symbol === "string" && req.query.symbol.trim().length > 0
        ? req.query.symbol.trim().toUpperCase()
        : config.MARKET_SYMBOL;
    const timeframe =
      typeof req.query.timeframe === "string" && req.query.timeframe.trim().length > 0
        ? req.query.timeframe.trim()
        : "1m";
    const limit = readLimit(req.query.limit);

    res.json({
      symbol,
      timeframe,
      candles: candleRepository.listRecent(symbol, timeframe, limit)
    });
  });

  return router;
}

function readLimit(value: unknown): number {
  const parsed = Number(value);

  if (!Number.isInteger(parsed) || parsed < 1) {
    return 100;
  }

  return Math.min(parsed, 500);
}
