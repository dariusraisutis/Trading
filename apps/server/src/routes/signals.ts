import { Router } from "express";

import type { AppConfig } from "../config/env.js";
import type { SignalRepository } from "../db/repositories/signals.js";

export function createSignalRouter(config: AppConfig, signalRepository: SignalRepository) {
  const router = Router();

  router.get("/", (req, res) => {
    const symbol =
      typeof req.query.symbol === "string" && req.query.symbol.trim().length > 0
        ? req.query.symbol.trim().toUpperCase()
        : config.MARKET_SYMBOL;
    const limit = readLimit(req.query.limit);

    res.json({
      symbol,
      signals: signalRepository.listRecent(symbol, limit)
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
