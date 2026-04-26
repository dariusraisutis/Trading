import { describe, expect, it, vi } from "vitest";

import type { Candle } from "../src/db/repositories/candles.js";
import { createLogger } from "../src/logger.js";
import {
  createBreakoutStrategy,
  createCavemanTrendPullbackStrategy,
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

  it("generates caveman trend-pullback signals", () => {
    const strategy = createCavemanTrendPullbackStrategy(5, 2, 70, 30, 2, 0);
    const buy = strategy.evaluate(makeCandles([10, 20, 30, 40, 100, 90, 80]));
    const sell = strategy.evaluate(makeCandles([100, 90, 80, 70, 10, 20, 30]));

    expect(buy).toMatchObject({
      strategy: "caveman-trend-pullback",
      side: "buy",
      candleId: 7
    });
    expect(sell).toMatchObject({
      strategy: "caveman-trend-pullback",
      side: "sell",
      candleId: 7
    });
  });

  it("saves generated signals through the strategy service", () => {
    const candles = makeCandles([10, 11, 12, 13]);
    const candleRepository = {
      listBeforeOrAt: vi.fn(() => candles)
    };
    const signalRepository = {
      create: vi.fn(() => 1),
      listByCandleId: vi.fn(() => [])
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
      MARKET_DATA_ENABLED: false,
      REPLAY_CSV_PATH: "apps/server/replay/sample-btcusdt-1m.csv",
      REPLAY_INTERVAL_MS: 0,
      REPLAY_AUTO_START: false
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

  it("skips opposite-side signals on the same candle", () => {
    const candles = makeCandles([10, 11, 12]);
    const candleRepository = {
      listBeforeOrAt: vi.fn(() => candles)
    };
    const signalRepository = {
      create: vi
        .fn()
        .mockReturnValueOnce(1)
        .mockReturnValueOnce(2),
      listByCandleId: vi.fn(() => [])
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
      MARKET_DATA_ENABLED: false,
      REPLAY_CSV_PATH: "apps/server/replay/sample-btcusdt-1m.csv",
      REPLAY_INTERVAL_MS: 0,
      REPLAY_AUTO_START: false
    };
    const service = new StrategyService(
      candleRepository as never,
      signalRepository as never,
      createLogger(config),
      [
        {
          name: "first",
          requiredCandles: 1,
          evaluate: () => ({
            strategy: "first",
            symbol: "BTCUSDT",
            candleId: 3,
            side: "buy",
            reason: "first"
          })
        },
        {
          name: "second",
          requiredCandles: 1,
          evaluate: () => ({
            strategy: "second",
            symbol: "BTCUSDT",
            candleId: 3,
            side: "sell",
            reason: "second"
          })
        }
      ]
    );

    service.evaluateClosedCandle(candles[candles.length - 1]);

    expect(signalRepository.create).toHaveBeenCalledTimes(1);
    expect(signalRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        strategy: "first",
        side: "buy",
        candleId: 3
      })
    );
  });
});
