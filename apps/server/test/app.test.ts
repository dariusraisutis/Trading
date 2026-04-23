import request from "supertest";
import { describe, expect, it } from "vitest";

import { createApp } from "../src/app.js";
import { loadConfig } from "../src/config/env.js";
import type { CandleRepository } from "../src/db/repositories/candles.js";
import type { OrderRepository } from "../src/db/repositories/orders.js";
import type { PositionRepository } from "../src/db/repositories/positions.js";
import type { SignalRepository } from "../src/db/repositories/signals.js";
import type { TradeRepository } from "../src/db/repositories/trades.js";
import { createLogger } from "../src/logger.js";
import { MarketDataStore } from "../src/market/store.js";

function buildApp() {
  const config = loadConfig({
    PORT: "3001",
    TRADING_MODE: "paper",
    ENABLE_LIVE: "false",
    LOG_LEVEL: "silent",
    MARKET_DATA_ENABLED: "false"
  });
  const logger = createLogger(config);
  const marketStore = new MarketDataStore();
  marketStore.update({
    type: "ticker",
    symbol: "BTCUSDT",
    price: 100,
    eventTime: 1_766_880_000_000
  });
  const candleRepository = {
    listRecent: () => [
      {
        id: 1,
        symbol: "BTCUSDT",
        timeframe: "1m",
        openTime: 1_766_880_000_000,
        closeTime: 1_766_880_059_999,
        open: 100,
        high: 110,
        low: 95,
        close: 105,
        volume: 1.5
      }
    ]
  } as CandleRepository;
  const signalRepository = {
    listRecent: () => [
      {
        id: 1,
        symbol: "BTCUSDT",
        strategy: "breakout",
        candleId: 1,
        side: "buy",
        reason: "Close broke above 20-candle high",
        createdAt: "2026-04-23 00:00:00"
      }
    ]
  } as SignalRepository;
  const orderRepository = {
    listRecent: () => [
      {
        id: 1,
        symbol: "BTCUSDT",
        side: "buy",
        type: "market",
        quantity: 1,
        price: 100,
        status: "filled",
        mode: "paper",
        createdAt: "2026-04-23 00:00:00",
        updatedAt: "2026-04-23 00:00:00"
      }
    ]
  } as OrderRepository;
  const tradeRepository = {
    listRecent: () => [
      {
        id: 1,
        orderId: 1,
        symbol: "BTCUSDT",
        side: "buy",
        quantity: 1,
        price: 100,
        fee: 0.1,
        executedAt: "2026-04-23 00:00:00"
      }
    ]
  } as TradeRepository;
  const positionRepository = {
    findBySymbol: () => ({
      symbol: "BTCUSDT",
      quantity: 1,
      averagePrice: 100,
      realizedPnl: -0.1
    })
  } as PositionRepository;

  return createApp(config, logger, {
    marketStore,
    candleRepository,
    signalRepository,
    orderRepository,
    tradeRepository,
    positionRepository
  });
}

describe("server app", () => {
  it("returns health status", async () => {
    const response = await request(buildApp()).get("/health");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      status: "OK",
      mode: "paper"
    });
  });

  it("returns base API status", async () => {
    const response = await request(buildApp()).get("/api/v1/status");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      status: "ready",
      mode: "paper",
      liveEnabled: false,
      database: {
        path: "data/trading.sqlite"
      },
      market: {
        symbol: "BTCUSDT",
        enabled: false
      }
    });
  });

  it("returns current market price", async () => {
    const response = await request(buildApp()).get("/api/v1/market/price");

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      symbol: "BTCUSDT",
      price: {
        symbol: "BTCUSDT",
        price: 100,
        source: "ticker",
        eventTime: 1_766_880_000_000
      }
    });
  });

  it("returns recent candles", async () => {
    const response = await request(buildApp()).get("/api/v1/market/candles?limit=1");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      symbol: "BTCUSDT",
      timeframe: "1m",
      candles: [
        {
          id: 1,
          symbol: "BTCUSDT",
          timeframe: "1m",
          openTime: 1_766_880_000_000,
          closeTime: 1_766_880_059_999,
          open: 100,
          high: 110,
          low: 95,
          close: 105,
          volume: 1.5
        }
      ]
    });
  });

  it("returns recent signals", async () => {
    const response = await request(buildApp()).get("/api/v1/signals?limit=1");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      symbol: "BTCUSDT",
      signals: [
        {
          id: 1,
          symbol: "BTCUSDT",
          strategy: "breakout",
          candleId: 1,
          side: "buy",
          reason: "Close broke above 20-candle high",
          createdAt: "2026-04-23 00:00:00"
        }
      ]
    });
  });

  it("returns paper orders", async () => {
    const response = await request(buildApp()).get("/api/v1/execution/orders?limit=1");

    expect(response.status).toBe(200);
    expect(response.body.orders).toHaveLength(1);
    expect(response.body.orders[0]).toMatchObject({
      symbol: "BTCUSDT",
      side: "buy",
      status: "filled",
      mode: "paper"
    });
  });

  it("returns paper trades and positions", async () => {
    const trades = await request(buildApp()).get("/api/v1/execution/trades?limit=1");
    const positions = await request(buildApp()).get("/api/v1/execution/positions");

    expect(trades.status).toBe(200);
    expect(trades.body.trades[0]).toMatchObject({
      symbol: "BTCUSDT",
      fee: 0.1
    });
    expect(positions.status).toBe(200);
    expect(positions.body.position).toEqual({
      symbol: "BTCUSDT",
      quantity: 1,
      averagePrice: 100,
      realizedPnl: -0.1
    });
  });

  it("uses the error handler for failures", async () => {
    const response = await request(buildApp()).get("/api/v1/error");

    expect(response.status).toBe(500);
    expect(response.body).toEqual({
      error: {
        message: "Internal Server Error"
      }
    });
  });
});
