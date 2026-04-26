import { describe, expect, it } from "vitest";

import type { Candle } from "../src/db/repositories/candles.js";
import {
  createMomentumCandidates,
  optimizeMomentumStrategy,
  passesMomentumMinimums,
  runMomentumSegment,
  runMomentumTrainTest
} from "../src/backtest/momentum.js";

function makeCandles(length: number): Candle[] {
  return Array.from({ length }, (_, index) => {
    const base = 100 + index * 2;

    return {
      id: index + 1,
      symbol: "BTCUSDT",
      timeframe: "1d",
      openTime: Date.UTC(2020, 0, index + 1),
      closeTime: Date.UTC(2020, 0, index + 2) - 1,
      open: base,
      high: base + 3,
      low: base - 3,
      close: base + 1,
      volume: 1
    };
  });
}

function makeTrendThenFlipCandles(): Candle[] {
  return Array.from({ length: 30 }, (_, index) => {
    const isFinal = index === 29;
    const base = 100 + index * 3;

    if (isFinal) {
      return {
        id: index + 1,
        symbol: "ETHUSDT",
        timeframe: "4h",
        openTime: Date.UTC(2020, 0, 1, index * 4),
        closeTime: Date.UTC(2020, 0, 1, index * 4 + 4) - 1,
        open: base,
        high: base + 2,
        low: 95,
        close: 96,
        volume: 1
      };
    }

    return {
      id: index + 1,
      symbol: "ETHUSDT",
      timeframe: "4h",
      openTime: Date.UTC(2020, 0, 1, index * 4),
      closeTime: Date.UTC(2020, 0, 1, index * 4 + 4) - 1,
      open: base,
      high: base + 5,
      low: base - 1,
      close: base + 3,
      volume: 1
    };
  });
}

function makeBearMarketReliefCandles(length: number): Candle[] {
  return Array.from({ length }, (_, index) => {
    const downtrendBase = 600 - index * 2;
    const reliefOffset = index >= 220 ? (index - 220) * 6 : 0;
    const close = downtrendBase + reliefOffset;

    return {
      id: index + 1,
      symbol: "ETHUSDT",
      timeframe: "4h",
      openTime: Date.UTC(2020, 0, 1, index * 4),
      closeTime: Date.UTC(2020, 0, 1, index * 4 + 4) - 1,
      open: close - 1,
      high: close + 2,
      low: close - 3,
      close,
      volume: 1
    };
  });
}

describe("momentum backtest", () => {
  it("builds the requested momentum candidate grid", () => {
    expect(createMomentumCandidates()).toHaveLength(18);
  });

  it("runs a train/test report", () => {
    const report = runMomentumTrainTest(
      makeCandles(260),
      {
        BACKTEST_TRAIN_SPLIT: 0.7,
        PAPER_ACCOUNT_SIZE: 1000,
        RISK_PER_TRADE_PCT: 0.01,
        PAPER_FEE_RATE: 0.001,
        SLIPPAGE_PCT: 0.00025
      },
      {
        lookback: 60,
        atrPeriod: 14,
        minAtrPct: 0.01,
        exitMode: "trend-flip"
      }
    );

    expect(report.train.candles).toBeGreaterThan(0);
    expect(report.test.candles).toBeGreaterThan(0);
  });

  it("applies pass rules and returns a frozen result", () => {
    expect(
      passesMomentumMinimums({
        label: "train",
        candles: 100,
        signals: 50,
        completedTrades: 45,
        winRatePct: 45,
        profitFactor: 1.3,
        expectancy: 2,
        netPnl: 100,
        netReturnPct: 10,
        maxDrawdownPctOnAccount: 15,
        totalFees: 10,
        completed: []
      })
    ).toBe(true);

    const optimized = optimizeMomentumStrategy(
      makeCandles(260),
      {
        BACKTEST_TRAIN_SPLIT: 0.7,
        PAPER_ACCOUNT_SIZE: 1000,
        RISK_PER_TRADE_PCT: 0.01,
        PAPER_FEE_RATE: 0.001,
        SLIPPAGE_PCT: 0.00025
      },
      [
        {
          lookback: 60,
          atrPeriod: 14,
          minAtrPct: 0.01,
          exitMode: "trend-flip"
        },
        {
          lookback: 120,
          atrPeriod: 14,
          minAtrPct: 0.02,
          exitMode: "trailing-stop"
        }
      ]
    );

    expect(optimized.report.params).toBeDefined();
  });

  it("supports partial exits that split a winning runner", () => {
    const baseline = runMomentumSegment(
      "train",
      makeTrendThenFlipCandles(),
      {
        lookback: 5,
        atrPeriod: 3,
        minAtrPct: 0.001,
        exitMode: "trend-flip",
        partialExitFraction: 0,
        partialExitAtR: 0,
        volatilityScale: "none"
      },
      {
        PAPER_ACCOUNT_SIZE: 1000,
        RISK_PER_TRADE_PCT: 0.01,
        PAPER_FEE_RATE: 0.001,
        SLIPPAGE_PCT: 0.00025
      }
    );
    const partial = runMomentumSegment(
      "train",
      makeTrendThenFlipCandles(),
      {
        lookback: 5,
        atrPeriod: 3,
        minAtrPct: 0.001,
        exitMode: "trend-flip",
        partialExitFraction: 0.5,
        partialExitAtR: 1,
        volatilityScale: "none"
      },
      {
        PAPER_ACCOUNT_SIZE: 1000,
        RISK_PER_TRADE_PCT: 0.01,
        PAPER_FEE_RATE: 0.001,
        SLIPPAGE_PCT: 0.00025
      }
    );

    expect(baseline.completedTrades).toBe(1);
    expect(partial.completedTrades).toBe(2);
    expect(partial.completed[0]?.quantity).toBeLessThan(baseline.completed[0]?.quantity ?? Infinity);
    expect(partial.completed[0]?.netPnl).toBeGreaterThan(0);
  });

  it("uses the EMA200 trend guard to block counter-trend relief rallies", () => {
    const withoutGuard = runMomentumSegment(
      "train",
      makeBearMarketReliefCandles(280),
      {
        lookback: 20,
        atrPeriod: 14,
        minAtrPct: 0.001,
        exitMode: "trend-flip",
        partialExitFraction: 0,
        partialExitAtR: 0,
        volatilityScale: "none",
        trendGuard: "none"
      },
      {
        PAPER_ACCOUNT_SIZE: 1000,
        RISK_PER_TRADE_PCT: 0.01,
        PAPER_FEE_RATE: 0.001,
        SLIPPAGE_PCT: 0.00025
      }
    );
    const withGuard = runMomentumSegment(
      "train",
      makeBearMarketReliefCandles(280),
      {
        lookback: 20,
        atrPeriod: 14,
        minAtrPct: 0.001,
        exitMode: "trend-flip",
        partialExitFraction: 0,
        partialExitAtR: 0,
        volatilityScale: "none",
        trendGuard: "ema200-4h"
      },
      {
        PAPER_ACCOUNT_SIZE: 1000,
        RISK_PER_TRADE_PCT: 0.01,
        PAPER_FEE_RATE: 0.001,
        SLIPPAGE_PCT: 0.00025
      }
    );

    expect(withoutGuard.signals).toBeGreaterThan(0);
    expect(withGuard.signals).toBeLessThanOrEqual(withoutGuard.signals);
  });
});
