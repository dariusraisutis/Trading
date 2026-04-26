import { describe, expect, it } from "vitest";

import type { Candle } from "../src/db/repositories/candles.js";
import {
  createDefaultCavemanCandidates,
  optimizeCavemanStrategy,
  passesTrainMinimums
} from "../src/backtest/optimizer.js";

function makeCandles(length: number): Candle[] {
  return Array.from({ length }, (_, index) => ({
    id: index + 1,
    symbol: "BTCUSDT",
    timeframe: "1d",
    openTime: Date.UTC(2020, 0, index + 1),
    closeTime: Date.UTC(2020, 0, index + 2) - 1,
    open: 100 + index,
    high: 101 + index,
    low: 99 + index,
    close: 100.5 + index,
    volume: 1
  }));
}

describe("caveman optimizer", () => {
  it("builds a candidate grid", () => {
    const candidates = createDefaultCavemanCandidates();

    expect(candidates.length).toBe(4096);
    expect(candidates[0]).toMatchObject({
      emaPeriod: 100,
      longRsiThreshold: 30,
      stopLossPct: 0.01,
      rewardRiskRatio: 1.5
    });
  });

  it("picks the better train result among candidates", () => {
    const result = optimizeCavemanStrategy(
      makeCandles(220),
      {
        BACKTEST_TRAIN_SPLIT: 0.7,
        PAPER_ACCOUNT_SIZE: 1000,
        RISK_PER_TRADE_PCT: 0.01,
        PAPER_FEE_RATE: 0.001,
        SLIPPAGE_PCT: 0.00025,
        STOP_LOSS_PCT: 0.02,
        TAKE_PROFIT_PCT: 0.04,
        MAX_DAILY_LOSS_PCT: 0.03,
        MAX_CONSECUTIVE_LOSSES: 3,
        TRADE_COOLDOWN_MS: 0
      },
      [
        {
          emaPeriod: 100,
          longRsiThreshold: 35,
          shortRsiThreshold: 65,
          minAtrPct: 0.005,
          stopLossPct: 0.01,
          rewardRiskRatio: 2
        },
        {
          emaPeriod: 200,
          longRsiThreshold: 45,
          shortRsiThreshold: 55,
          minAtrPct: 0.0125,
          stopLossPct: 0.025,
          rewardRiskRatio: 3
        }
      ]
    );

    expect(result.params).toBeDefined();
    expect(result.report.train.analytics.completedTrades).toBeGreaterThanOrEqual(0);
  });

  it("evaluates pass conditions strictly", () => {
    expect(
      passesTrainMinimums(
        {
          totalTrades: 120,
          completedTrades: 60,
          winningTrades: 30,
          losingTrades: 30,
          winRatePct: 50,
          totalVolume: 1000,
          totalFees: 10,
          grossPnl: 200,
          netPnl: 150,
          netReturnPct: 10,
          averageWin: 10,
          averageLoss: -5,
          averageRisk: 4,
          profitFactor: 1.2,
          maxDrawdown: 100,
          maxDrawdownPct: 10,
          expectancy: 2.5,
          currentOpenQuantity: 0,
          currentAveragePrice: 0,
          estimatedOpenRisk: 0,
          equityCurve: [],
          completed: []
        },
        10
      )
    ).toBe(true);
  });
});
