import { describe, expect, it, vi } from "vitest";

import type { Candle } from "../src/db/repositories/candles.js";
import { createLogger } from "../src/logger.js";
import {
  createBreakoutStrategy,
  createMaCrossoverStrategy,
  createMeanReversionStrategy,
  StrategyService
} from "../src/strategy/index.js";

function makeCandles(closes: number[]): Candle[] {
  return closes.map((close, index) => ({
    id: index + 1,
    symbol: "BTCUSDT",
    timeframe: "1m",
    openTime: index * 60_000,
    closeTime: index * 60_000 + 59_999,
    open: close,
    high: close,
    low: close,
    close,
    volume: 1
  }));
}

describe("strategies", () => {
  it("generates MA crossover signals", () => {
    const strategy = createMaCrossoverStrategy(2, 3);
    const signal = strategy.evaluate(makeCandles([5, 4, 3, 4, 5]));

    expect(signal).toMatchObject({
      strategy: "ma-crossover",
      side: "buy",
      candleId: 5
    });
  });

  it("generates breakout signals", () => {
    const strategy = createBreakoutStrategy(3);
    const signal = strategy.evaluate(makeCandles([10, 11, 12, 13]));

    expect(signal).toMatchObject({
      strategy: "breakout",
      side: "buy",
      candleId: 4
    });
  });

  it("generates mean reversion signals", () => {
    const strategy = createMeanReversionStrategy(5, 1);
    const sell = strategy.evaluate(makeCandles([10, 10, 10, 10, 20]));
    const buy = strategy.evaluate(makeCandles([10, 10, 10, 10, 1]));

    expect(sell).toMatchObject({
      strategy: "mean-reversion",
      side: "sell",
      candleId: 5
    });
    expect(buy).toMatchObject({
      strategy: "mean-reversion",
      side: "buy",
      candleId: 5
    });
  });

  it("saves generated signals through the strategy service", () => {
    const candles = makeCandles([10, 11, 12, 13]);
    const candleRepository = {
      listBeforeOrAt: vi.fn(() => candles)
    };
    const signalRepository = {
      create: vi.fn(() => 1)
    };
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
    const service = new StrategyService(
      candleRepository as never,
      signalRepository as never,
      createLogger(config),
      [createBreakoutStrategy(3)],
      undefined
    );

    service.evaluateClosedCandle(candles[candles.length - 1]);

    expect(signalRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        strategy: "breakout",
        side: "buy",
        candleId: 4
      })
    );
  });
});
