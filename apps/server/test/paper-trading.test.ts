import { describe, expect, it, vi } from "vitest";

import { createLogger } from "../src/logger.js";
import { MarketDataStore } from "../src/market/store.js";
import { applyPaperFill, PaperTradingService } from "../src/execution/paper-trading.js";

const config = {
  PORT: 3001,
  TRADING_MODE: "paper" as const,
  ENABLE_LIVE: false,
  LOG_LEVEL: "silent" as const,
  DB_PATH: "data/trading.sqlite",
  MARKET_SYMBOL: "BTCUSDT",
  MARKET_WS_URL: "wss://stream.binance.com:9443/ws",
  MARKET_RECONNECT_MS: 5000,
  MARKET_DATA_ENABLED: false
};

describe("paper trading", () => {
  it("updates positions and realized pnl logically for buys and sells", () => {
    const bought = applyPaperFill(
      { symbol: "BTCUSDT", quantity: 0, averagePrice: 0, realizedPnl: 0 },
      "buy",
      1,
      100,
      0.1
    );
    const sold = applyPaperFill(bought, "sell", 1, 110, 0.11);

    expect(bought).toEqual({
      symbol: "BTCUSDT",
      quantity: 1,
      averagePrice: 100,
      realizedPnl: -0.1
    });
    expect(sold).toEqual({
      symbol: "BTCUSDT",
      quantity: 0,
      averagePrice: 0,
      realizedPnl: 9.79
    });
  });

  it("creates paper order, trade, and position updates", () => {
    const marketStore = new MarketDataStore();
    marketStore.update({
      type: "trade",
      symbol: "BTCUSDT",
      price: 100,
      quantity: 0.5,
      tradeId: 1,
      eventTime: 1
    });
    const orderRepository = { create: vi.fn(() => 10) };
    const tradeRepository = { create: vi.fn(() => 20) };
    const positionRepository = {
      findBySymbol: vi.fn(() => null),
      upsert: vi.fn()
    };
    const service = new PaperTradingService(
      config,
      marketStore,
      orderRepository as never,
      tradeRepository as never,
      positionRepository as never,
      createLogger(config)
    );

    service.handleSignal({
      strategy: "breakout",
      symbol: "BTCUSDT",
      candleId: 1,
      side: "buy",
      reason: "test"
    });

    expect(orderRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        symbol: "BTCUSDT",
        side: "buy",
        type: "market",
        quantity: 1,
        price: 100,
        status: "filled",
        mode: "paper"
      })
    );
    expect(tradeRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        orderId: 10,
        symbol: "BTCUSDT",
        side: "buy",
        quantity: 1,
        price: 100,
        fee: 0.1
      })
    );
    expect(positionRepository.upsert).toHaveBeenCalledWith({
      symbol: "BTCUSDT",
      quantity: 1,
      averagePrice: 100,
      realizedPnl: -0.1
    });
  });
});
