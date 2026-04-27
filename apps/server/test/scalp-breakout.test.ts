import { describe, expect, it } from "vitest";

import type { Candle } from "../src/db/repositories/candles.js";
import {
  isLongBreakoutEntry,
  runScalpBreakoutTrainTest
} from "../src/backtest/scalp-breakout.js";

function makeBreakoutCandles(length: number): Candle[] {
  return Array.from({ length }, (_, index) => {
    const base = 100 + Math.floor(index / 12) * 0.9;
    const breakout = index % 12 === 9 ? 2.2 : index % 12 === 10 ? 1.5 : 0;
    const open = base + breakout - 0.4;
    const close = base + breakout + (index % 12 === 9 ? 1.2 : 0.3);

    return {
      id: index + 1,
      symbol: "ETHUSDT",
      timeframe: "15m",
      openTime: Date.UTC(2024, 0, 1, 0, index * 15),
      closeTime: Date.UTC(2024, 0, 1, 0, index * 15 + 15) - 1,
      open,
      high: Math.max(open, close) + 0.8,
      low: Math.min(open, close) - 0.5,
      close,
      volume: 1
    };
  });
}

describe("scalp breakout backtest", () => {
  it("recognizes a bullish breakout close above range", () => {
    expect(isLongBreakoutEntry({ open: 101, close: 103.5 }, 102.8)).toBe(true);
    expect(isLongBreakoutEntry({ open: 103.5, close: 103.2 }, 103)).toBe(false);
  });

  it("runs a train/test breakout report on synthetic 15m candles", () => {
    const report = runScalpBreakoutTrainTest(
      makeBreakoutCandles(240),
      {
        BACKTEST_TRAIN_SPLIT: 0.7,
        PAPER_ACCOUNT_SIZE: 1000,
        RISK_PER_TRADE_PCT: 0.01,
        PAPER_FEE_RATE: 0.001,
        SLIPPAGE_PCT: 0.00025
      },
      {
        breakoutLookback: 8,
        atrPeriod: 14,
        minAtrPct: 0.001,
        takeProfitR: 1.25,
        activeHoursStartUtc: 8,
        activeHoursEndUtc: 20
      }
    );

    expect(report.train.candles).toBeGreaterThan(0);
    expect(report.test.candles).toBeGreaterThan(0);
    expect(report.train.signals + report.test.signals).toBeGreaterThan(0);
  });
});
