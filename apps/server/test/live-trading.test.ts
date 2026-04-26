import { describe, expect, it, vi } from "vitest";

import { createLogger } from "../src/logger.js";
import { MarketDataStore } from "../src/market/store.js";
import {
  LiveTradingService,
  type LiveExchangeAdapter,
  normalizeCcxtSymbol,
  validateLiveQuantity
} from "../src/execution/live-trading.js";

const config = {
  TRADING_MODE: "live" as const,
  PAPER_ACCOUNT_SIZE: 1000,
  RISK_PER_TRADE_PCT: 0.01,
  PAPER_FEE_RATE: 0.001,
  SLIPPAGE_PCT: 0.00025,
  STOP_LOSS_PCT: 0.02,
  TAKE_PROFIT_PCT: 0.04,
  MAX_DAILY_LOSS_PCT: 0.03,
  MAX_CONSECUTIVE_LOSSES: 3,
  TRADE_COOLDOWN_MS: 300000
};

describe("live trading", () => {
  it("normalizes internal symbols to CCXT format", () => {
    expect(normalizeCcxtSymbol("ETHUSDT")).toBe("ETH/USDT");
    expect(normalizeCcxtSymbol("BTC/USD")).toBe("BTC/USD");
  });

  it("validates quantity against precision and exchange minimums", () => {
    expect(
      validateLiveQuantity(
        1.234567,
        {
          symbol: "ETH/USDT",
          amountPrecision: 3,
          minAmount: 0.001,
          minCost: 10
        },
        100
      )
    ).toBe(1.234);

    expect(() =>
      validateLiveQuantity(
        0.0014,
        {
          symbol: "ETH/USDT",
          amountPrecision: 3,
          minAmount: 0.002,
          minCost: 10
        },
        100
      )
    ).toThrow("below min amount");
  });

  it("stores exchange order ids and live fills locally", async () => {
    const marketStore = new MarketDataStore();
    marketStore.update({
      type: "ticker",
      symbol: "ETHUSDT",
      price: 2000,
      eventTime: 1
    });
    const exchangeAdapter: LiveExchangeAdapter = {
      loadMarket: vi.fn(async () => ({
        symbol: "ETH/USDT",
        amountPrecision: 3,
        minAmount: 0.001,
        minCost: 10
      })),
      createMarketOrder: vi.fn(async (_symbol, side, quantity) => ({
        exchangeOrderId: "abc123",
        symbol: "ETHUSDT",
        side,
        type: "market",
        status: "closed",
        quantity,
        filled: quantity,
        averagePrice: 2001,
        feeCost: 0.5,
        executedAt: "2026-04-26T12:00:00.000Z"
      }))
    };
    const orderRepository = { create: vi.fn(() => 10) };
    const tradeRepository = {
      create: vi.fn(() => 20),
      findMostRecent: vi.fn(() => null),
      listAll: vi.fn(() => [])
    };
    const positionRepository = {
      findBySymbol: vi.fn(() => null),
      upsert: vi.fn()
    };
    const service = new LiveTradingService(
      config,
      exchangeAdapter,
      marketStore,
      orderRepository as never,
      tradeRepository as never,
      positionRepository as never,
      createLogger({
        PORT: 3001,
        ENABLE_LIVE: true,
        LOG_LEVEL: "silent",
        DB_PATH: "data/trading.sqlite",
        EXCHANGE_ID: "binance",
        EXCHANGE_API_KEY: "",
        EXCHANGE_API_SECRET: "",
        EXCHANGE_SANDBOX: false,
        MARKET_SYMBOL: "ETHUSDT",
        MARKET_WS_URL: "wss://stream.binance.com:9443/ws",
        MARKET_RECONNECT_MS: 5000,
        MARKET_DATA_ENABLED: true,
        REPLAY_CSV_PATH: "apps/server/replay/sample-btcusdt-1m.csv",
        REPLAY_INTERVAL_MS: 0,
        REPLAY_AUTO_START: true,
        BACKTEST_TRAIN_SPLIT: 0.7,
        KILL_SWITCH_MAX_DRAWDOWN_PCT: 0.15,
        KILL_SWITCH_MAX_CONSECUTIVE_LOSSES: 25,
        ...config
      })
    );

    await service.handleSignal({
      strategy: "breakout",
      symbol: "ETHUSDT",
      candleId: 1,
      side: "buy",
      reason: "test"
    });

    expect(orderRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        symbol: "ETHUSDT",
        side: "buy",
        type: "market",
        exchangeOrderId: "abc123",
        status: "closed",
        mode: "live"
      })
    );
    expect(tradeRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        orderId: 10,
        symbol: "ETHUSDT",
        side: "buy",
        price: 2001,
        executedAt: "2026-04-26T12:00:00.000Z"
      })
    );
    expect(positionRepository.upsert).toHaveBeenCalled();
  });
});
