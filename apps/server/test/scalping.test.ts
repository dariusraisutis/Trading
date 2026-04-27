import { describe, expect, it } from "vitest";

import type { Candle } from "../src/db/repositories/candles.js";
import {
  isLongScalpEntry,
  passesActiveHourFilter,
  runScalpingTrainTest
} from "../src/backtest/scalping.js";

function makeScalpCandles(length: number): Candle[] {
  return Array.from({ length }, (_, index) => {
    const trend = 100 + index * 0.6;
    const pullback = index % 7 === 3 ? -1.4 : index % 7 === 4 ? 0.8 : 0;
    const close = trend + pullback;
    const open = close - (index % 7 === 4 ? -0.6 : 0.2);

    return {
      id: index + 1,
      symbol: "ETHUSDT",
      timeframe: "5m",
      openTime: Date.UTC(2024, 0, 1, 0, index * 5),
      closeTime: Date.UTC(2024, 0, 1, 0, index * 5 + 5) - 1,
      open,
      high: Math.max(open, close) + 0.9,
      low: Math.min(open, close) - 1.1,
      close,
      volume: 1
    };
  });
}

describe("scalping backtest", () => {
  it("recognizes a simple long scalp entry shape", () => {
    expect(
      isLongScalpEntry(
        { open: 101, low: 99.8, close: 102.2 },
        100,
        100.5
      )
    ).toBe(true);
    expect(
      isLongScalpEntry(
        { open: 102, low: 101.8, close: 101.7 },
        100,
        100.5
      )
    ).toBe(false);
  });

  it("can limit entries to active UTC hours", () => {
    const noon = Date.UTC(2024, 0, 1, 12, 0);
    const late = Date.UTC(2024, 0, 1, 23, 0);

    expect(passesActiveHourFilter(noon, { activeHoursStartUtc: 8, activeHoursEndUtc: 16 })).toBe(true);
    expect(passesActiveHourFilter(late, { activeHoursStartUtc: 8, activeHoursEndUtc: 16 })).toBe(false);
  });

  it("runs a train/test scalp report on synthetic 5m candles", () => {
    const report = runScalpingTrainTest(
      makeScalpCandles(320),
      {
        BACKTEST_TRAIN_SPLIT: 0.7,
        PAPER_ACCOUNT_SIZE: 1000,
        RISK_PER_TRADE_PCT: 0.01,
        PAPER_FEE_RATE: 0.001,
        SLIPPAGE_PCT: 0.00025
      },
      {
        trendEmaPeriod: 10,
        pullbackEmaPeriod: 5,
        atrPeriod: 14,
        minAtrPct: 0.001,
        stopAtrMultiplier: 1,
        takeProfitR: 1
      }
    );

    expect(report.train.candles).toBeGreaterThan(0);
    expect(report.test.candles).toBeGreaterThan(0);
    expect(report.train.signals).toBeGreaterThan(0);
    expect(report.train.completedTrades).toBeGreaterThan(0);
  });
});
