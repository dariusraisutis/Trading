import { describe, expect, it } from "vitest";
import { ZodError } from "zod";

import { loadConfig } from "../src/config/env.js";

describe("loadConfig", () => {
  it("applies safe defaults", () => {
    const config = loadConfig({});

    expect(config).toEqual({
      PORT: 3001,
      TRADING_MODE: "paper",
      ENABLE_LIVE: false,
      LOG_LEVEL: "info",
      DB_PATH: "data/trading.sqlite",
      EXCHANGE_ID: "binance",
      EXCHANGE_API_KEY: "",
      EXCHANGE_API_SECRET: "",
      EXCHANGE_SANDBOX: false,
      MARKET_SYMBOL: "BTCUSDT",
      MARKET_WS_URL: "wss://stream.binance.com:9443/ws",
      MARKET_RECONNECT_MS: 5000,
      MARKET_DATA_ENABLED: true,
      REPLAY_CSV_PATH: "apps/server/replay/sample-btcusdt-1m.csv",
      REPLAY_INTERVAL_MS: 0,
      REPLAY_AUTO_START: true,
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
    });
  });

  it("fails cleanly for invalid live trading configuration", () => {
    expect(() =>
      loadConfig({
        TRADING_MODE: "live",
        ENABLE_LIVE: "false"
      })
    ).toThrowError(ZodError);
  });

  it("fails when live mode is enabled without exchange credentials", () => {
    expect(() =>
      loadConfig({
        TRADING_MODE: "live",
        ENABLE_LIVE: "true",
        EXCHANGE_API_KEY: "",
        EXCHANGE_API_SECRET: ""
      })
    ).toThrowError(ZodError);
  });

  it("fails when take profit is below the minimum 1:2 reward/risk rule", () => {
    expect(() =>
      loadConfig({
        STOP_LOSS_PCT: "0.02",
        TAKE_PROFIT_PCT: "0.03"
      })
    ).toThrowError(ZodError);
  });
});
