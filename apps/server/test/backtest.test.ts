import { describe, expect, it } from "vitest";

import type { Candle } from "../src/db/repositories/candles.js";
import { runTrainTestBacktest } from "../src/backtest/engine.js";

function makeCandles(prices: Array<{ open: number; close: number }>): Candle[] {
  return prices.map((price, index) => ({
    id: index + 1,
    symbol: "BTCUSDT",
    timeframe: "1d",
    openTime: Date.UTC(2026, 0, index + 1),
    closeTime: Date.UTC(2026, 0, index + 2) - 1,
    open: price.open,
    high: Math.max(price.open, price.close) + 1,
    low: Math.min(price.open, price.close) - 1,
    close: price.close,
    volume: 1
  }));
}

describe("backtest engine", () => {
  it("uses next-candle-open execution and splits train/test", () => {
    const candles = makeCandles([
      { open: 100, close: 101 },
      { open: 110, close: 111 },
      { open: 120, close: 119 },
      { open: 130, close: 131 },
      { open: 140, close: 141 },
      { open: 150, close: 149 }
    ]);
    const strategy = {
      name: "test",
      requiredCandles: 1,
      evaluate(segment: Candle[]) {
        const latest = segment[segment.length - 1];

        if (latest.id === 1 || latest.id === 4) {
          return {
            strategy: "test",
            symbol: latest.symbol,
            candleId: latest.id,
            side: "buy" as const,
            reason: "entry"
          };
        }

        if (latest.id === 2 || latest.id === 5) {
          return {
            strategy: "test",
            symbol: latest.symbol,
            candleId: latest.id,
            side: "sell" as const,
            reason: "exit"
          };
        }

        return null;
      }
    };

    const report = runTrainTestBacktest(candles, strategy, {
      BACKTEST_TRAIN_SPLIT: 0.5,
      PAPER_ACCOUNT_SIZE: 1000,
      RISK_PER_TRADE_PCT: 0.01,
      PAPER_FEE_RATE: 0,
      SLIPPAGE_PCT: 0.001,
      STOP_LOSS_PCT: 0.02,
      TAKE_PROFIT_PCT: 0.04,
      MAX_DAILY_LOSS_PCT: 0.03,
      MAX_CONSECUTIVE_LOSSES: 3,
      TRADE_COOLDOWN_MS: 0
    });

    expect(report.splitIndex).toBe(3);
    expect(report.train.analytics.completedTrades).toBe(1);
    expect(report.test.analytics.completedTrades).toBe(1);
    expect(report.train.analytics.completed[0]).toMatchObject({
      entryPrice: 110.11,
      exitPrice: 119.88
    });
    expect(report.test.analytics.completed[0]).toMatchObject({
      entryPrice: 140.14,
      exitPrice: 149.85
    });
  });
});
