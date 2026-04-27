import { describe, expect, it } from "vitest";

import type { Candle } from "../src/db/repositories/candles.js";
import {
  isLongBreakoutCandle,
  isRetestEntryCandle,
  runScalpBreakoutRetestTrainTest
} from "../src/backtest/scalp-breakout-retest.js";

function makeBreakoutRetestCandles(length: number): Candle[] {
  return Array.from({ length }, (_, index) => {
    const base = 100 + Math.floor(index / 10) * 0.4;
    const isBreakout = index % 10 === 5;
    const isRetest = index % 10 === 6;
    const open = base + (isBreakout ? 0.1 : isRetest ? 0.2 : -0.1);
    const close = base + (isBreakout ? 1.6 : isRetest ? 1.0 : 0.2);
    const low = isRetest ? base - 0.3 : Math.min(open, close) - 0.2;

    return {
      id: index + 1,
      symbol: "ETHUSDT",
      timeframe: "15m",
      openTime: Date.UTC(2024, 0, 1, 0, index * 15),
      closeTime: Date.UTC(2024, 0, 1, 0, index * 15 + 15) - 1,
      open,
      high: Math.max(open, close) + 0.4,
      low,
      close,
      volume: 1
    };
  });
}

describe("scalp breakout retest backtest", () => {
  it("recognizes breakout and retest candles", () => {
    expect(isLongBreakoutCandle({ open: 100.5, close: 102 }, 101.2, 0.8)).toBe(true);
    expect(isRetestEntryCandle({ low: 101, open: 101.3, close: 101.8 }, 101.2)).toBe(true);
    expect(isRetestEntryCandle({ low: 101.4, open: 101.5, close: 101.1 }, 101.2)).toBe(false);
    expect(isLongBreakoutCandle({ open: 101.2, close: 101.9 }, 101.5, 1.0)).toBe(false);
  });

  it("runs a train/test breakout-retest report on synthetic 15m candles", () => {
    const report = runScalpBreakoutRetestTrainTest(
      makeBreakoutRetestCandles(240),
      {
        BACKTEST_TRAIN_SPLIT: 0.7,
        PAPER_ACCOUNT_SIZE: 1000,
        RISK_PER_TRADE_PCT: 0.01,
        PAPER_FEE_RATE: 0.001,
        SLIPPAGE_PCT: 0.00025
      },
      {
        breakoutLookback: 4,
        breakoutBodyLookback: 5,
        trendEmaPeriod: 10,
        atrPeriod: 14,
        minAtrPct: 0.001,
        takeProfitR: 1.25,
        retestExpiryCandles: 3,
        activeHoursStartUtc: 8,
        activeHoursEndUtc: 20
      }
    );

    expect(report.train.candles).toBeGreaterThan(0);
    expect(report.test.candles).toBeGreaterThan(0);
    expect(report.train.signals + report.test.signals).toBeGreaterThan(0);
  });
});
