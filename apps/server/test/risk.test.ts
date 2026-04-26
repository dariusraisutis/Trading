import { describe, expect, it } from "vitest";

import { RiskService } from "../src/risk/service.js";

const service = new RiskService({
  PAPER_ACCOUNT_SIZE: 1000,
  RISK_PER_TRADE_PCT: 0.01,
  STOP_LOSS_PCT: 0.02,
  TAKE_PROFIT_PCT: 0.04,
  MAX_DAILY_LOSS_PCT: 0.03,
  MAX_CONSECUTIVE_LOSSES: 3,
  TRADE_COOLDOWN_MS: 300000
});

describe("risk engine", () => {
  it("blocks same-direction trades when a position is already open", () => {
    const decision = service.evaluate(
      {
        strategy: "breakout",
        symbol: "BTCUSDT",
        candleId: 1,
        side: "buy",
        reason: "test"
      },
      {
        symbol: "BTCUSDT",
        price: 100,
        source: "trade",
        eventTime: 1,
        receivedAt: "2026-04-25T10:00:00.000Z"
      },
      {
        symbol: "BTCUSDT",
        quantity: 1,
        averagePrice: 100,
        realizedPnl: 0
      },
      null,
      { accountBalance: 1000, consecutiveLosses: 0, dailyLossPct: 0 }
    );

    expect(decision).toEqual({
      allowed: false,
      quantity: 1,
      reason: "position already open for symbol"
    });
  });

  it("blocks trades during cooldown for new entries", () => {
    const decision = service.evaluate(
      {
        strategy: "breakout",
        symbol: "BTCUSDT",
        candleId: 1,
        side: "buy",
        reason: "test"
      },
      {
        symbol: "BTCUSDT",
        price: 100,
        source: "trade",
        eventTime: 1,
        receivedAt: "2026-04-25T10:02:00.000Z"
      },
      null,
      {
        id: 1,
        orderId: 1,
        symbol: "BTCUSDT",
        side: "buy",
        quantity: 1,
        price: 100,
        fee: 0.1,
        executedAt: "2026-04-25T10:00:00.000Z"
      },
      { accountBalance: 1000, consecutiveLosses: 0, dailyLossPct: 0 }
    );

    expect(decision).toEqual({
      allowed: false,
      quantity: 5,
      reason: "trade cooldown active"
    });
  });

  it("blocks entries after stop loss or take profit thresholds are breached", () => {
    const stopLoss = service.evaluate(
      {
        strategy: "breakout",
        symbol: "BTCUSDT",
        candleId: 1,
        side: "buy",
        reason: "test"
      },
      {
        symbol: "BTCUSDT",
        price: 97,
        source: "trade",
        eventTime: 1,
        receivedAt: "2026-04-25T10:10:00.000Z"
      },
      {
        symbol: "BTCUSDT",
        quantity: 1,
        averagePrice: 100,
        realizedPnl: 0
      },
      null,
      { accountBalance: 1000, consecutiveLosses: 0, dailyLossPct: 0 }
    );
    const takeProfit = service.evaluate(
      {
        strategy: "breakout",
        symbol: "BTCUSDT",
        candleId: 1,
        side: "buy",
        reason: "test"
      },
      {
        symbol: "BTCUSDT",
        price: 104.5,
        source: "trade",
        eventTime: 1,
        receivedAt: "2026-04-25T10:10:00.000Z"
      },
      {
        symbol: "BTCUSDT",
        quantity: 1,
        averagePrice: 100,
        realizedPnl: 0
      },
      null,
      { accountBalance: 1000, consecutiveLosses: 0, dailyLossPct: 0 }
    );

    expect(stopLoss.reason).toBe("stop loss threshold breached");
    expect(takeProfit.reason).toBe("take profit threshold reached");
  });

  it("allows valid closing trades", () => {
    const decision = service.evaluate(
      {
        strategy: "breakout",
        symbol: "BTCUSDT",
        candleId: 1,
        side: "sell",
        reason: "test"
      },
      {
        symbol: "BTCUSDT",
        price: 100,
        source: "trade",
        eventTime: 1,
        receivedAt: "2026-04-25T10:10:00.000Z"
      },
      {
        symbol: "BTCUSDT",
        quantity: 1,
        averagePrice: 100,
        realizedPnl: 0
      },
      {
        id: 1,
        orderId: 1,
        symbol: "BTCUSDT",
        side: "buy",
        quantity: 1,
        price: 100,
        fee: 0.1,
        executedAt: "2026-04-25T10:09:00.000Z"
      },
      { accountBalance: 1000, consecutiveLosses: 0, dailyLossPct: 0 }
    );

    expect(decision).toEqual({
      allowed: true,
      quantity: 1
    });
  });

  it("sizes a new trade from account risk instead of fixed BTC", () => {
    const decision = service.evaluate(
      {
        strategy: "breakout",
        symbol: "BTCUSDT",
        candleId: 1,
        side: "buy",
        reason: "trend breakout"
      },
      {
        symbol: "BTCUSDT",
        price: 100,
        source: "trade",
        eventTime: 1,
        receivedAt: "2026-04-25T10:15:00.000Z"
      },
      null,
      null,
      { accountBalance: 1000, consecutiveLosses: 0, dailyLossPct: 0 }
    );

    expect(decision).toEqual({
      allowed: true,
      quantity: 5
    });
  });

  it("blocks fresh entries after too many losses or too much daily damage", () => {
    const lossStreakDecision = service.evaluate(
      {
        strategy: "breakout",
        symbol: "BTCUSDT",
        candleId: 1,
        side: "buy",
        reason: "trend breakout"
      },
      {
        symbol: "BTCUSDT",
        price: 100,
        source: "trade",
        eventTime: 1,
        receivedAt: "2026-04-25T10:15:00.000Z"
      },
      null,
      null,
      { accountBalance: 1000, consecutiveLosses: 3, dailyLossPct: 0 }
    );
    const dailyLossDecision = service.evaluate(
      {
        strategy: "breakout",
        symbol: "BTCUSDT",
        candleId: 1,
        side: "buy",
        reason: "trend breakout"
      },
      {
        symbol: "BTCUSDT",
        price: 100,
        source: "trade",
        eventTime: 1,
        receivedAt: "2026-04-25T10:15:00.000Z"
      },
      null,
      null,
      { accountBalance: 1000, consecutiveLosses: 0, dailyLossPct: 0.03 }
    );

    expect(lossStreakDecision.reason).toBe("max consecutive losses reached");
    expect(dailyLossDecision.reason).toBe("max daily loss reached");
  });

  it("returns a protective exit when stop loss or take profit is breached", () => {
    const stopLoss = service.evaluateProtectiveExit(
      {
        symbol: "BTCUSDT",
        quantity: 1,
        averagePrice: 100,
        realizedPnl: 0
      },
      {
        open: 100,
        high: 101,
        low: 97
      }
    );
    const takeProfit = service.evaluateProtectiveExit(
      {
        symbol: "BTCUSDT",
        quantity: -1,
        averagePrice: 100,
        realizedPnl: 0
      },
      {
        open: 100,
        high: 101,
        low: 95.5
      }
    );

    expect(stopLoss).toEqual({
      shouldExit: true,
      side: "sell",
      quantity: 1,
      price: 98,
      reason: "stop loss threshold breached"
    });
    expect(takeProfit).toEqual({
      shouldExit: true,
      side: "buy",
      quantity: 1,
      price: 96,
      reason: "take profit threshold reached"
    });
  });

  it("uses the candle open when price gaps beyond the protective threshold", () => {
    const longGapStop = service.evaluateProtectiveExit(
      {
        symbol: "BTCUSDT",
        quantity: 1,
        averagePrice: 100,
        realizedPnl: 0
      },
      {
        open: 95,
        high: 99,
        low: 94
      }
    );
    const shortGapTakeProfit = service.evaluateProtectiveExit(
      {
        symbol: "BTCUSDT",
        quantity: -1,
        averagePrice: 100,
        realizedPnl: 0
      },
      {
        open: 94,
        high: 95,
        low: 90
      }
    );

    expect(longGapStop).toEqual({
      shouldExit: true,
      side: "sell",
      quantity: 1,
      price: 95,
      reason: "stop loss threshold breached"
    });
    expect(shortGapTakeProfit).toEqual({
      shouldExit: true,
      side: "buy",
      quantity: 1,
      price: 94,
      reason: "take profit threshold reached"
    });
  });
});
