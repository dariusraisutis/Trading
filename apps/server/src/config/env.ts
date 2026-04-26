import { z } from "zod";

const envSchema = z
  .object({
    PORT: z.coerce.number().int().min(1).max(65535).default(3001),
    TRADING_MODE: z.enum(["replay", "paper", "live"]).default("paper"),
    ENABLE_LIVE: z
      .enum(["true", "false"])
      .default("false")
      .transform((value) => value === "true"),
    LOG_LEVEL: z
      .enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"])
      .default("info"),
    DB_PATH: z.string().min(1).default("data/trading.sqlite"),
    EXCHANGE_ID: z.string().min(1).default("binance"),
    EXCHANGE_API_KEY: z.string().default(""),
    EXCHANGE_API_SECRET: z.string().default(""),
    EXCHANGE_SANDBOX: z
      .enum(["true", "false"])
      .default("false")
      .transform((value) => value === "true"),
    MARKET_SYMBOL: z.string().min(1).default("BTCUSDT"),
    MARKET_WS_URL: z.string().url().default("wss://stream.binance.com:9443/ws"),
    MARKET_RECONNECT_MS: z.coerce.number().int().min(100).default(5000),
    MARKET_DATA_ENABLED: z
      .enum(["true", "false"])
      .default("true")
      .transform((value) => value === "true"),
    REPLAY_CSV_PATH: z.string().min(1).default("apps/server/replay/sample-btcusdt-1m.csv"),
    REPLAY_INTERVAL_MS: z.coerce.number().int().min(0).default(0),
    REPLAY_AUTO_START: z
      .enum(["true", "false"])
      .default("true")
      .transform((value) => value === "true"),
    BACKTEST_TRAIN_SPLIT: z.coerce.number().gt(0).lt(1).default(0.7),
    PAPER_ACCOUNT_SIZE: z.coerce.number().positive().default(1000),
    RISK_PER_TRADE_PCT: z.coerce.number().positive().max(0.02).default(0.01),
    PAPER_FEE_RATE: z.coerce.number().min(0).default(0.001),
    SLIPPAGE_PCT: z.coerce.number().min(0).max(0.01).default(0.00025),
    STOP_LOSS_PCT: z.coerce.number().min(0).max(1).default(0.02),
    TAKE_PROFIT_PCT: z.coerce.number().min(0).max(1).default(0.04),
    MAX_DAILY_LOSS_PCT: z.coerce.number().positive().max(1).default(0.03),
    MAX_CONSECUTIVE_LOSSES: z.coerce.number().int().min(1).max(10).default(3),
    KILL_SWITCH_MAX_DRAWDOWN_PCT: z.coerce.number().positive().max(1).default(0.15),
    KILL_SWITCH_MAX_CONSECUTIVE_LOSSES: z.coerce.number().int().min(1).max(100).default(25),
    TRADE_COOLDOWN_MS: z.coerce.number().int().min(0).default(300000)
  })
  .superRefine((env, ctx) => {
    if (env.TRADING_MODE === "live" && !env.ENABLE_LIVE) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "ENABLE_LIVE must be true when TRADING_MODE is live",
        path: ["ENABLE_LIVE"]
      });
    }

    if (env.TRADING_MODE === "live" && (!env.EXCHANGE_API_KEY || !env.EXCHANGE_API_SECRET)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "EXCHANGE_API_KEY and EXCHANGE_API_SECRET are required when TRADING_MODE is live",
        path: ["EXCHANGE_API_KEY"]
      });
    }

    if (env.TAKE_PROFIT_PCT < env.STOP_LOSS_PCT * 2) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "TAKE_PROFIT_PCT must be at least 2x STOP_LOSS_PCT",
        path: ["TAKE_PROFIT_PCT"]
      });
    }
  });

export type AppConfig = z.infer<typeof envSchema>;

export function loadConfig(source: NodeJS.ProcessEnv = process.env): AppConfig {
  return envSchema.parse(source);
}
