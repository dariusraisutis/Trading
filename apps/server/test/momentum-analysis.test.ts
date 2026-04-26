import { describe, expect, it } from "vitest";

import type { Candle } from "../src/db/repositories/candles.js";
import {
  analyzeTradeConcentration,
  buildBtcDateRegimeBreakdown,
  runMomentumWalkForward
} from "../src/backtest/momentum-analysis.js";
import { createMomentumCandidates } from "../src/backtest/momentum.js";

function makeCandles(length: number): Candle[] {
  return Array.from({ length }, (_, index) => {
    const date = new Date(Date.UTC(2017 + Math.floor(index / 40), 0, (index % 28) + 1));
    const base = 100 + index * 2;

    return {
      id: index + 1,
      symbol: "BTCUSDT",
      timeframe: "1d",
      openTime: date.getTime(),
      closeTime: date.getTime() + 86_400_000 - 1,
      open: base,
      high: base + 3,
      low: base - 3,
      close: base + 1,
      volume: 1
    };
  });
}

describe("momentum analysis", () => {
  it("measures concentration of top winning trades", () => {
    const report = analyzeTradeConcentration(
      {
        label: "train",
        candles: 0,
        signals: 0,
        completedTrades: 4,
        winRatePct: 50,
        profitFactor: 2,
        expectancy: 1,
        netPnl: 15,
        netReturnPct: 1,
        maxDrawdownPctOnAccount: 1,
        totalFees: 1,
        completed: [
          {
            entryTime: "2020-01-01T00:00:00.000Z",
            exitTime: "2020-01-02T00:00:00.000Z",
            quantity: 1,
            entryPrice: 100,
            exitPrice: 110,
            grossPnl: 10,
            fees: 1,
            netPnl: 9,
            returnPct: 9,
            riskAmount: 5,
            rMultiple: 1.8
          },
          {
            entryTime: "2020-01-03T00:00:00.000Z",
            exitTime: "2020-01-04T00:00:00.000Z",
            quantity: 1,
            entryPrice: 100,
            exitPrice: 108,
            grossPnl: 8,
            fees: 1,
            netPnl: 7,
            returnPct: 7,
            riskAmount: 5,
            rMultiple: 1.4
          },
          {
            entryTime: "2020-01-05T00:00:00.000Z",
            exitTime: "2020-01-06T00:00:00.000Z",
            quantity: 1,
            entryPrice: 100,
            exitPrice: 95,
            grossPnl: -5,
            fees: 1,
            netPnl: -6,
            returnPct: -6,
            riskAmount: 5,
            rMultiple: -1.2
          },
          {
            entryTime: "2020-01-07T00:00:00.000Z",
            exitTime: "2020-01-08T00:00:00.000Z",
            quantity: 1,
            entryPrice: 100,
            exitPrice: 107,
            grossPnl: 7,
            fees: 1,
            netPnl: 6,
            returnPct: 6,
            riskAmount: 5,
            rMultiple: 1.2
          }
        ]
      },
      2
    );

    expect(report.topProfitSum).toBe(16);
    expect(report.shareOfWinningProfitPct).toBeCloseTo(72.7272, 3);
  });

  it("splits finished trades into BTC date regimes", () => {
    const breakdown = buildBtcDateRegimeBreakdown({
      label: "train",
      candles: 0,
      signals: 0,
      completedTrades: 3,
      winRatePct: 0,
      profitFactor: 0,
      expectancy: 0,
      netPnl: 0,
      netReturnPct: 0,
      maxDrawdownPctOnAccount: 0,
      totalFees: 0,
      completed: [
        {
          entryTime: "2017-06-01T00:00:00.000Z",
          exitTime: "2017-06-02T00:00:00.000Z",
          quantity: 1,
          entryPrice: 100,
          exitPrice: 110,
          grossPnl: 10,
          fees: 1,
          netPnl: 9,
          returnPct: 9,
          riskAmount: 5,
          rMultiple: 1.8
        },
        {
          entryTime: "2018-06-01T00:00:00.000Z",
          exitTime: "2018-06-02T00:00:00.000Z",
          quantity: 1,
          entryPrice: 100,
          exitPrice: 95,
          grossPnl: -5,
          fees: 1,
          netPnl: -6,
          returnPct: -6,
          riskAmount: 5,
          rMultiple: -1.2
        },
        {
          entryTime: "2019-06-01T00:00:00.000Z",
          exitTime: "2019-06-02T00:00:00.000Z",
          quantity: 1,
          entryPrice: 100,
          exitPrice: 101,
          grossPnl: 1,
          fees: 1,
          netPnl: 0,
          returnPct: 0,
          riskAmount: 5,
          rMultiple: 0
        }
      ]
    });

    expect(breakdown.bull.netPnl).toBe(9);
    expect(breakdown.bear.netPnl).toBe(-6);
    expect(breakdown.sideways.completedTrades).toBe(1);
  });

  it("runs walk-forward windows", () => {
    const results = runMomentumWalkForward(
      makeCandles(360),
      {
        BACKTEST_TRAIN_SPLIT: 0.7,
        PAPER_ACCOUNT_SIZE: 1000,
        RISK_PER_TRADE_PCT: 0.01,
        PAPER_FEE_RATE: 0.001,
        SLIPPAGE_PCT: 0.00025
      },
      createMomentumCandidates().slice(0, 2),
      [
        {
          trainStart: "2017-01-01",
          trainEnd: "2020-12-31",
          testStart: "2021-01-01",
          testEnd: "2021-12-31"
        }
      ]
    );

    expect(results).toHaveLength(1);
    expect(results[0].frozenParams).toBeDefined();
  });
});
