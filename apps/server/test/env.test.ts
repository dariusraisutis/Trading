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
      MARKET_SYMBOL: "BTCUSDT",
      MARKET_WS_URL: "wss://stream.binance.com:9443/ws",
      MARKET_RECONNECT_MS: 5000,
      MARKET_DATA_ENABLED: true
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
});
