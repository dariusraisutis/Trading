import { describe, expect, it } from "vitest";

import { buildExecutionAnalytics } from "../src/execution/analytics.js";

describe("execution analytics", () => {
  it("calculates net performance, fees, and risk for completed trades", () => {
    const analytics = buildExecutionAnalytics(
      [
        {
          id: 1,
          orderId: 1,
          symbol: "BTCUSDT",
          side: "buy",
          quantity: 1,
          price: 100,
          fee: 0.1,
          executedAt: "2026-01-01T00:00:00.000Z"
        },
        {
          id: 2,
          orderId: 2,
          symbol: "BTCUSDT",
          side: "sell",
          quantity: 1,
          price: 110,
          fee: 0.11,
          executedAt: "2026-01-01T00:05:00.000Z"
        }
      ],
      {
        STOP_LOSS_PCT: 0.02
      }
    );

    expect(analytics).toMatchObject({
      totalTrades: 2,
      completedTrades: 1,
      winningTrades: 1,
      losingTrades: 0,
      totalFees: 0.21,
      grossPnl: 10,
      netPnl: 9.79,
      netReturnPct: 9.79,
      averageRisk: 2,
      maxDrawdown: 0,
      maxDrawdownPct: 0,
      expectancy: 9.79,
      currentOpenQuantity: 0,
      estimatedOpenRisk: 0
    });
    expect(analytics.completed[0]).toMatchObject({
      side: "long",
      entryPrice: 100,
      exitPrice: 110,
      grossPnl: 10,
      fees: 0.21,
      netPnl: 9.79,
      riskAmount: 2,
      rMultiple: 4.895
    });
  });

  it("tracks open risk and drawdown when a position is still open", () => {
    const analytics = buildExecutionAnalytics(
      [
        {
          id: 1,
          orderId: 1,
          symbol: "BTCUSDT",
          side: "buy",
          quantity: 1,
          price: 100,
          fee: 0.1,
          executedAt: "2026-01-01T00:00:00.000Z"
        },
        {
          id: 2,
          orderId: 2,
          symbol: "BTCUSDT",
          side: "sell",
          quantity: 1,
          price: 95,
          fee: 0.095,
          executedAt: "2026-01-01T00:03:00.000Z"
        },
        {
          id: 3,
          orderId: 3,
          symbol: "BTCUSDT",
          side: "buy",
          quantity: 1,
          price: 90,
          fee: 0.09,
          executedAt: "2026-01-01T00:10:00.000Z"
        }
      ],
      {
        STOP_LOSS_PCT: 0.02
      }
    );

    expect(analytics).toMatchObject({
      totalTrades: 3,
      completedTrades: 1,
      winningTrades: 0,
      losingTrades: 1,
      netPnl: -5.19,
      maxDrawdown: 5.2,
      maxDrawdownPct: 0,
      expectancy: -5.19,
      currentOpenQuantity: 1,
      currentAveragePrice: 90,
      estimatedOpenRisk: 1.8
    });
    expect(analytics.equityCurve).toEqual([
      {
        exitTime: "2026-01-01T00:03:00.000Z",
        equity: -5.19
      }
    ]);
  });
});
