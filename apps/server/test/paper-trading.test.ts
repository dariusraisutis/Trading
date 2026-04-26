import { describe, expect, it, vi } from "vitest";

import { BotControlService } from "../src/bot/control-service.js";
import { createLogger } from "../src/logger.js";
import { MarketDataStore } from "../src/market/store.js";
import { applyPaperFill, PaperTradingService } from "../src/execution/paper-trading.js";

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
  REPLAY_AUTO_START: false,
  BACKTEST_TRAIN_SPLIT: 0.7,
  PAPER_ACCOUNT_SIZE: 1000,
  RISK_PER_TRADE_PCT: 0.01,
  PAPER_FEE_RATE: 0.001,
  SLIPPAGE_PCT: 0.00025,
  STOP_LOSS_PCT: 0.02,
  TAKE_PROFIT_PCT: 0.04,
  MAX_DAILY_LOSS_PCT: 0.03,
  MAX_CONSECUTIVE_LOSSES: 3,
  KILL_SWITCH_MAX_DRAWDOWN_PCT: 0.15,
  KILL_SWITCH_MAX_CONSECUTIVE_LOSSES: 25,
  TRADE_COOLDOWN_MS: 300000
};

describe("paper trading", () => {
  it("updates positions and realized pnl logically for buys and sells", () => {
    const bought = applyPaperFill(
      { symbol: "BTCUSDT", quantity: 0, averagePrice: 0, realizedPnl: 0 },
      "buy",
      1,
      100,
      0.1
    );
    const sold = applyPaperFill(bought, "sell", 1, 110, 0.11);

    expect(bought).toEqual({
      symbol: "BTCUSDT",
      quantity: 1,
      averagePrice: 100,
      realizedPnl: -0.1
    });
    expect(sold).toEqual({
      symbol: "BTCUSDT",
      quantity: 0,
      averagePrice: 0,
      realizedPnl: 9.79
    });
  });

  it("creates paper order, trade, and position updates", () => {
    const marketStore = new MarketDataStore();
    marketStore.update({
      type: "trade",
      symbol: "BTCUSDT",
      price: 100,
      quantity: 0.5,
      tradeId: 1,
      eventTime: 1
    });
    const orderRepository = { create: vi.fn(() => 10) };
    const tradeRepository = { create: vi.fn(() => 20) };
    const tradeRepositoryWithLookup = {
      create: tradeRepository.create,
      findMostRecent: vi.fn(() => null),
      listAll: vi.fn(() => [])
    };
    const positionRepository = {
      findBySymbol: vi.fn(() => null),
      upsert: vi.fn()
    };
    const service = new PaperTradingService(
      config,
      marketStore,
      orderRepository as never,
      tradeRepositoryWithLookup as never,
      positionRepository as never,
      createLogger(config)
    );

    service.handleSignal({
      strategy: "breakout",
      symbol: "BTCUSDT",
      candleId: 1,
      side: "buy",
      reason: "test"
    });

    expect(orderRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        symbol: "BTCUSDT",
        side: "buy",
        type: "market",
        quantity: 5,
        price: 100.025,
        status: "filled",
        mode: "paper"
      })
    );
    expect(tradeRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        orderId: 10,
        symbol: "BTCUSDT",
        side: "buy",
        quantity: 5,
        price: 100.025,
        fee: 0.500125,
        executedAt: "1970-01-01T00:00:00.001Z"
      })
    );
    expect(positionRepository.upsert).toHaveBeenCalledWith({
      symbol: "BTCUSDT",
      quantity: 5,
      averagePrice: 100.025,
      realizedPnl: -0.5
    });
  });

  it("blocks invalid paper trades through the risk engine", () => {
    const marketStore = new MarketDataStore();
    marketStore.update({
      type: "trade",
      symbol: "BTCUSDT",
      price: 101,
      quantity: 0.5,
      tradeId: 1,
      eventTime: 1
    });
    const orderRepository = { create: vi.fn() };
    const tradeRepository = {
      create: vi.fn(),
      findMostRecent: vi.fn(() => null),
      listAll: vi.fn(() => [])
    };
    const positionRepository = {
      findBySymbol: vi.fn(() => ({
        symbol: "BTCUSDT",
        quantity: 1,
        averagePrice: 100,
        realizedPnl: 0
      })),
      upsert: vi.fn()
    };
    const service = new PaperTradingService(
      config,
      marketStore,
      orderRepository as never,
      tradeRepository as never,
      positionRepository as never,
      createLogger(config)
    );

    service.handleSignal({
      strategy: "breakout",
      symbol: "BTCUSDT",
      candleId: 1,
      side: "buy",
      reason: "test"
    });

    expect(orderRepository.create).not.toHaveBeenCalled();
    expect(tradeRepository.create).not.toHaveBeenCalled();
    expect(positionRepository.upsert).not.toHaveBeenCalled();
  });

  it("resets the loss streak on a new day instead of freezing the bot forever", () => {
    const marketStore = new MarketDataStore();
    marketStore.update({
      type: "trade",
      symbol: "BTCUSDT",
      price: 100,
      quantity: 0.5,
      tradeId: 1,
      eventTime: Date.parse("2026-04-26T10:00:00.000Z")
    });
    const orderRepository = { create: vi.fn(() => 10) };
    const tradeRepository = {
      create: vi.fn(() => 20),
      findMostRecent: vi.fn(() => null),
      listAll: vi.fn(() => [
        {
          id: 1,
          orderId: 1,
          symbol: "BTCUSDT",
          side: "buy",
          quantity: 5,
          price: 100,
          fee: 0.5,
          executedAt: "2026-04-25T08:00:00.000Z"
        },
        {
          id: 2,
          orderId: 2,
          symbol: "BTCUSDT",
          side: "sell",
          quantity: 5,
          price: 98,
          fee: 0.49,
          executedAt: "2026-04-25T08:05:00.000Z"
        },
        {
          id: 3,
          orderId: 3,
          symbol: "BTCUSDT",
          side: "buy",
          quantity: 4.95,
          price: 100,
          fee: 0.495,
          executedAt: "2026-04-25T09:00:00.000Z"
        },
        {
          id: 4,
          orderId: 4,
          symbol: "BTCUSDT",
          side: "sell",
          quantity: 4.95,
          price: 98,
          fee: 0.4851,
          executedAt: "2026-04-25T09:05:00.000Z"
        },
        {
          id: 5,
          orderId: 5,
          symbol: "BTCUSDT",
          side: "buy",
          quantity: 4.9,
          price: 100,
          fee: 0.49,
          executedAt: "2026-04-25T10:00:00.000Z"
        },
        {
          id: 6,
          orderId: 6,
          symbol: "BTCUSDT",
          side: "sell",
          quantity: 4.9,
          price: 98,
          fee: 0.4802,
          executedAt: "2026-04-25T10:05:00.000Z"
        }
      ])
    };
    const positionRepository = {
      findBySymbol: vi.fn(() => null),
      upsert: vi.fn()
    };
    const service = new PaperTradingService(
      config,
      marketStore,
      orderRepository as never,
      tradeRepository as never,
      positionRepository as never,
      createLogger(config)
    );

    service.handleSignal({
      strategy: "caveman-trend-pullback",
      symbol: "BTCUSDT",
      candleId: 7,
      side: "buy",
      reason: "new day trend pullback"
    });

    expect(orderRepository.create).toHaveBeenCalled();
    expect(tradeRepository.create).toHaveBeenCalled();
  });

  it("still blocks new entries after three losses on the same day", () => {
    const marketStore = new MarketDataStore();
    marketStore.update({
      type: "trade",
      symbol: "BTCUSDT",
      price: 100,
      quantity: 0.5,
      tradeId: 1,
      eventTime: Date.parse("2026-04-25T11:00:00.000Z")
    });
    const orderRepository = { create: vi.fn(() => 10) };
    const tradeRepository = {
      create: vi.fn(() => 20),
      findMostRecent: vi.fn(() => null),
      listAll: vi.fn(() => [
        {
          id: 1,
          orderId: 1,
          symbol: "BTCUSDT",
          side: "buy",
          quantity: 5,
          price: 100,
          fee: 0.5,
          executedAt: "2026-04-25T08:00:00.000Z"
        },
        {
          id: 2,
          orderId: 2,
          symbol: "BTCUSDT",
          side: "sell",
          quantity: 5,
          price: 98,
          fee: 0.49,
          executedAt: "2026-04-25T08:05:00.000Z"
        },
        {
          id: 3,
          orderId: 3,
          symbol: "BTCUSDT",
          side: "buy",
          quantity: 4.95,
          price: 100,
          fee: 0.495,
          executedAt: "2026-04-25T09:00:00.000Z"
        },
        {
          id: 4,
          orderId: 4,
          symbol: "BTCUSDT",
          side: "sell",
          quantity: 4.95,
          price: 98,
          fee: 0.4851,
          executedAt: "2026-04-25T09:05:00.000Z"
        },
        {
          id: 5,
          orderId: 5,
          symbol: "BTCUSDT",
          side: "buy",
          quantity: 4.9,
          price: 100,
          fee: 0.49,
          executedAt: "2026-04-25T10:00:00.000Z"
        },
        {
          id: 6,
          orderId: 6,
          symbol: "BTCUSDT",
          side: "sell",
          quantity: 4.9,
          price: 98,
          fee: 0.4802,
          executedAt: "2026-04-25T10:05:00.000Z"
        }
      ])
    };
    const positionRepository = {
      findBySymbol: vi.fn(() => null),
      upsert: vi.fn()
    };
    const service = new PaperTradingService(
      config,
      marketStore,
      orderRepository as never,
      tradeRepository as never,
      positionRepository as never,
      createLogger(config)
    );

    service.handleSignal({
      strategy: "caveman-trend-pullback",
      symbol: "BTCUSDT",
      candleId: 7,
      side: "buy",
      reason: "same day trend pullback"
    });

    expect(orderRepository.create).not.toHaveBeenCalled();
    expect(tradeRepository.create).not.toHaveBeenCalled();
  });

  it("executes a protective stop loss exit for an open position", () => {
    const marketStore = new MarketDataStore();
    const orderRepository = { create: vi.fn(() => 30) };
    const tradeRepository = {
      create: vi.fn(() => 40),
      findMostRecent: vi.fn(() => null),
      listAll: vi.fn(() => [])
    };
    const positionRepository = {
      findBySymbol: vi.fn(() => ({
        symbol: "BTCUSDT",
        quantity: 1,
        averagePrice: 100,
        realizedPnl: -0.1
      })),
      upsert: vi.fn()
    };
    const service = new PaperTradingService(
      config,
      marketStore,
      orderRepository as never,
      tradeRepository as never,
      positionRepository as never,
      createLogger(config)
    );

    service.handleProtectiveExit({
      symbol: "BTCUSDT",
      open: 100,
      high: 101,
      low: 97,
      closeTime: 60_000
    });

    expect(orderRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        symbol: "BTCUSDT",
        side: "sell",
        quantity: 1,
        price: 97.9755,
        status: "filled",
        mode: "paper"
      })
    );
    expect(tradeRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        orderId: 30,
        symbol: "BTCUSDT",
        side: "sell",
        quantity: 1,
        price: 97.9755,
        fee: 0.0979755,
        executedAt: "1970-01-01T00:01:00.000Z"
      })
    );
    expect(positionRepository.upsert).toHaveBeenCalledWith({
      symbol: "BTCUSDT",
      quantity: 0,
      averagePrice: 0,
      realizedPnl: -2.22
    });
  });

  it("trips the kill-switch after too many global consecutive losses", () => {
    const marketStore = new MarketDataStore();
    marketStore.update({
      type: "trade",
      symbol: "BTCUSDT",
      price: 100,
      quantity: 0.5,
      tradeId: 1,
      eventTime: Date.parse("2026-04-26T10:00:00.000Z")
    });
    const orderRepository = { create: vi.fn(() => 10) };
    const tradeRepository = {
      create: vi.fn(() => 20),
      findMostRecent: vi.fn(() => null),
      listAll: vi
        .fn()
        .mockReturnValueOnce([
          {
            id: 1,
            orderId: 1,
            symbol: "BTCUSDT",
            side: "buy",
            quantity: 1,
            price: 100,
            fee: 0.1,
            executedAt: "2026-04-24T09:00:00.000Z"
          },
          {
            id: 2,
            orderId: 2,
            symbol: "BTCUSDT",
            side: "sell",
            quantity: 1,
            price: 95,
            fee: 0.095,
            executedAt: "2026-04-24T10:00:00.000Z"
          }
        ])
        .mockReturnValueOnce([
          {
            id: 1,
            orderId: 1,
            symbol: "BTCUSDT",
            side: "buy",
            quantity: 1,
            price: 100,
            fee: 0.1,
            executedAt: "2026-04-24T09:00:00.000Z"
          },
          {
            id: 2,
            orderId: 2,
            symbol: "BTCUSDT",
            side: "sell",
            quantity: 1,
            price: 95,
            fee: 0.095,
            executedAt: "2026-04-24T10:00:00.000Z"
          },
          {
            id: 3,
            orderId: 10,
            symbol: "BTCUSDT",
            side: "buy",
            quantity: 5,
            price: 100.025,
            fee: 0.500125,
            executedAt: "2026-04-26T10:00:00.000Z"
          }
        ])
    };
    const positionRepository = {
      findBySymbol: vi.fn(() => null),
      upsert: vi.fn()
    };
    const botControlService = new BotControlService();
    const service = new PaperTradingService(
      {
        ...config,
        KILL_SWITCH_MAX_CONSECUTIVE_LOSSES: 1
      },
      marketStore,
      orderRepository as never,
      tradeRepository as never,
      positionRepository as never,
      createLogger(config),
      botControlService
    );

    service.handleSignal({
      strategy: "breakout",
      symbol: "BTCUSDT",
      candleId: 1,
      side: "buy",
      reason: "test"
    });

    expect(botControlService.getState()).toMatchObject({
      running: false,
      killSwitchActive: true
    });
    expect(botControlService.getState().killSwitchReason).toContain("consecutive losses");
  });
});
