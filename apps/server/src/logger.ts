import pino from "pino";

import type { AppConfig } from "./config/env.js";

export function createLogger(config: AppConfig) {
  return pino({
    level: config.LOG_LEVEL,
    base: {
      service: "trading-server",
      mode: config.TRADING_MODE
    }
  });
}
