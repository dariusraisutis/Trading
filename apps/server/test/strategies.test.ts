import { describe, expect, it, vi } from "vitest";

import type { Candle } from "../src/db/repositories/candles.js";
import { createLogger } from "../src/logger.js";
import {
  createBreakoutStrategy,
  createCavemanTrendPullbackStrategy,
  createMaCrossoverStrategy,
  createMeanReversionStrategy,
  createMomentumChampionStrategy,
  StrategyService
} from "../src/strategy/index.js";

function makeCandles(closes: number[], timeframe = "1m", startTime = 0, intervalMs = 60_000): Candle[] {
  return closes.map((close, index) => ({
    id: index + 1,
    symbol: "BTCUSDT",
    timeframe,
    openTime: startTime + index * intervalMs,
    closeTime: startTime + (index + 1) * intervalMs - 1,
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

  it("generates champion momentum entry and close-only exit signals on 4h candles", () => {
    const strategy = createMomentumChampionStrategy();
    const rising = makeCandles(
      Array.from({ length: 220 }, (_, index) => 100 + index),
      "4h",
      0,
      4 * 60 * 60_000
    ).map((candle, index) => ({
      ...candle,
      high: candle.close + 5,
      low: candle.close - 5
    }));
    const entry = strategy.evaluate(rising);
    const flipped = rising.map((candle, index) =>
      index === rising.length - 1
        ? {
            ...candle,
            close: rising[rising.length - 61].close - 10,
            high: rising[rising.length - 61].close - 5,
            low: rising[rising.length - 61].close - 15
          }
        : candle
    );
    const exit = strategy.evaluate(flipped);

    expect(entry).toMatchObject({
      strategy: "momentum-champion",
      side: "buy",
      intent: "open",
      candleId: rising.length
    });
    expect(entry?.tradePlan?.timeframe).toBe("4h");
    expect(exit).toMatchObject({
      strategy: "momentum-champion",
      side: "sell",
      intent: "close",
      candleId: rising.length
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
          timeframe: "1m",
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
          timeframe: "1m",
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
