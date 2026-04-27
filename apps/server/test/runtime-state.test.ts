import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { describe, expect, it } from "vitest";

import { loadConfig } from "../src/config/env.js";
import { openDatabase } from "../src/db/database.js";
import { createRepositories } from "../src/db/repositories/index.js";
import { createLogger } from "../src/logger.js";
import { MarketDataStore } from "../src/market/store.js";
import { recoverRuntimeState } from "../src/runtime-state.js";

describe("runtime state recovery", () => {
  it("restores last known price, position, and trade metadata from local storage", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "trading-runtime-state-"));
    const dbPath = join(tempDir, "trading.sqlite");
    const config = loadConfig({
      LOG_LEVEL: "silent",
      DB_PATH: dbPath,
      MARKET_SYMBOL: "ETHUSDT"
    });
    const logger = createLogger(config);
    const database = openDatabase(config);
    const repositories = createRepositories(database);
    const marketStore = new MarketDataStore();

    repositories.candles.create({
      symbol: "ETHUSDT",
      timeframe: "4h",
      openTime: Date.UTC(2026, 0, 1, 0, 0),
      closeTime: Date.UTC(2026, 0, 1, 3, 59, 59, 999),
      open: 100,
      high: 110,
      low: 99,
      close: 108,
      volume: 1
    });
    const orderId = repositories.orders.create({
      symbol: "ETHUSDT",
      side: "buy",
      type: "market",
      quantity: 1,
      price: 108,
      status: "filled",
      mode: "paper"
    });
    repositories.trades.create({
      orderId,
      symbol: "ETHUSDT",
      side: "buy",
      quantity: 1,
      price: 108,
      fee: 0.1,
      executedAt: "2026-01-01T04:00:00.000Z"
    });
    repositories.positions.upsert({
      symbol: "ETHUSDT",
      quantity: 1,
      averagePrice: 108,
      realizedPnl: 0
    });

    const recovered = recoverRuntimeState("ETHUSDT", {
      candleRepository: repositories.candles,
      tradeRepository: repositories.trades,
      positionRepository: repositories.positions,
      marketStore,
      logger
    });

    expect(recovered).toEqual({
      recoveredPrice: 108,
      recoveredPriceTime: Date.UTC(2026, 0, 1, 3, 59, 59, 999),
      openPositionQuantity: 1,
      lastTradeExecutedAt: "2026-01-01T04:00:00.000Z"
    });
    expect(marketStore.getPrice("ETHUSDT")).toMatchObject({
      price: 108,
      source: "ticker",
      eventTime: Date.UTC(2026, 0, 1, 3, 59, 59, 999)
    });

    database.close();
  });
});
