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
    MARKET_SYMBOL: z.string().min(1).default("BTCUSDT"),
    MARKET_WS_URL: z.string().url().default("wss://stream.binance.com:9443/ws"),
    MARKET_RECONNECT_MS: z.coerce.number().int().min(100).default(5000),
    MARKET_DATA_ENABLED: z
      .enum(["true", "false"])
      .default("true")
      .transform((value) => value === "true")
  })
  .superRefine((env, ctx) => {
    if (env.TRADING_MODE === "live" && !env.ENABLE_LIVE) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "ENABLE_LIVE must be true when TRADING_MODE is live",
        path: ["ENABLE_LIVE"]
      });
    }
  });

export type AppConfig = z.infer<typeof envSchema>;

export function loadConfig(source: NodeJS.ProcessEnv = process.env): AppConfig {
  return envSchema.parse(source);
}
