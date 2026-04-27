import { mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { describe, expect, it } from "vitest";

import { BotControlService } from "../src/bot/control-service.js";
import { loadConfig } from "../src/config/env.js";
import { openDatabase } from "../src/db/database.js";
import { createRepositories } from "../src/db/repositories/index.js";
import { PaperTradingService } from "../src/execution/paper-trading.js";
import { createLogger } from "../src/logger.js";
import { MarketDataStore } from "../src/market/store.js";
import { parseReplayCsv, ReplayService } from "../src/replay/service.js";
import { StrategyService } from "../src/strategy/service.js";

describe("replay mode", () => {
  it("loads CSV candles and runs the bot offline", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "trading-replay-"));
    const csvPath = join(tempDir, "candles.csv");
    const dbPath = join(tempDir, "trading.sqlite");

    writeFileSync(
      csvPath,
      [
        "openTime,open,high,low,close,volume",
        "2026-01-01T00:00:00Z,100,101,99,100,1",
        "2026-01-01T00:01:00Z,100,101,99,100,1",
        "2026-01-01T00:02:00Z,100,101,99,100,1",
        "2026-01-01T00:03:00Z,100,101,99,100,1",
        "2026-01-01T00:04:00Z,100,101,99,100,1",
        "2026-01-01T00:05:00Z,100,101,99,100,1",
        "2026-01-01T00:06:00Z,100,101,99,100,1",
        "2026-01-01T00:07:00Z,100,101,99,100,1",
        "2026-01-01T00:08:00Z,100,101,99,100,1",
        "2026-01-01T00:09:00Z,100,101,99,100,1",
        "2026-01-01T00:10:00Z,100,101,99,100,1",
        "2026-01-01T00:11:00Z,100,101,99,100,1",
        "2026-01-01T00:12:00Z,100,101,99,100,1",
        "2026-01-01T00:13:00Z,100,101,99,100,1",
        "2026-01-01T00:14:00Z,100,101,99,100,1",
        "2026-01-01T00:15:00Z,100,101,99,100,1",
        "2026-01-01T00:16:00Z,100,101,99,100,1",
        "2026-01-01T00:17:00Z,100,101,99,100,1",
        "2026-01-01T00:18:00Z,100,101,99,100,1",
        "2026-01-01T00:19:00Z,100,101,99,100,1",
        "2026-01-01T00:20:00Z,105,106,104,105,3"
      ].join("\n")
    );

    const config = loadConfig({
      PORT: "3001",
      TRADING_MODE: "replay",
      ENABLE_LIVE: "false",
      LOG_LEVEL: "silent",
      DB_PATH: dbPath,
      MARKET_SYMBOL: "BTCUSDT",
      MARKET_DATA_ENABLED: "false",
      REPLAY_CSV_PATH: csvPath,
      REPLAY_INTERVAL_MS: "0",
      REPLAY_AUTO_START: "false"
    });
    const logger = createLogger(config);
    const database = openDatabase(config);
    const repositories = createRepositories(database);
    const marketStore = new MarketDataStore();
    const botControlService = new BotControlService();
    const paperTradingService = new PaperTradingService(
      config,
      marketStore,
      repositories.orders,
      repositories.trades,
      repositories.positions,
      logger
    );
    const strategyService = new StrategyService(
      repositories.candles,
      repositories.signals,
      logger,
      undefined,
      botControlService,
      (signal) => paperTradingService.handleSignal(signal)
    );
    const replayService = new ReplayService(
      config,
      logger,
      marketStore,
      repositories.candles,
      strategyService
    );

    const state = replayService.start();

    expect(state.completed).toBe(true);
    expect(state.processedCandles).toBe(21);
    expect(repositories.candles.listRecent("BTCUSDT", "1m", 25)).toHaveLength(21);
    expect(repositories.signals.listRecent("BTCUSDT", 10)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          strategy: "breakout",
          side: "buy"
        })
      ])
    );
    expect(
      repositories
        .signals
        .listRecent("BTCUSDT", 10)
        .filter((signal) => signal.candleId === 21 && signal.side === "sell")
    ).toHaveLength(0);
    expect(repositories.orders.listRecent("BTCUSDT", 10)).toEqual([
      expect.objectContaining({
        side: "buy",
        mode: "replay",
        status: "filled"
      })
    ]);
    expect(repositories.trades.listRecent("BTCUSDT", 10)).toEqual([
      expect.objectContaining({
        side: "buy",
        price: 105.02625
      })
    ]);
    expect(repositories.positions.findBySymbol("BTCUSDT")).toEqual(
      expect.objectContaining({
        quantity: 4.761905,
        averagePrice: 105.02625
      })
    );
    expect(marketStore.getPrice("BTCUSDT")).toMatchObject({
      price: 105,
      source: "ticker"
    });

    database.close();
  });

  it("loads Binance daily CSV files with 1d candles and BTC volume", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "trading-replay-daily-"));
    const csvPath = join(tempDir, "binance-daily.csv");
    const dbPath = join(tempDir, "trading.sqlite");

    const rows = Array.from({ length: 21 }, (_, index) => {
      const dayOffset = 20 - index;
      const date = new Date(Date.UTC(2026, 0, 1 + dayOffset));
      const unix = date.getTime();
      const isoDate = date.toISOString().slice(0, 10);
      const open = 100 + dayOffset;
      const high = open + 2;
      const low = open - 2;
      const close = index === 20 ? 150 : open + 0.5;
      const volumeBtc = (1 + dayOffset / 10).toFixed(5);
      const volumeUsdt = (close * Number(volumeBtc)).toFixed(2);

      return `${unix},${isoDate},BTCUSDT,${open},${high},${low},${close},${volumeBtc},${volumeUsdt},${1000 + dayOffset}`;
    });

    writeFileSync(
      csvPath,
      [
        "Unix,Date,Symbol,Open,High,Low,Close,Volume BTC,Volume USDT,tradecount",
        ...rows
      ].join("\n")
    );

    const config = loadConfig({
      PORT: "3001",
      TRADING_MODE: "replay",
      ENABLE_LIVE: "false",
      LOG_LEVEL: "silent",
      DB_PATH: dbPath,
      MARKET_SYMBOL: "BTCUSDT",
      MARKET_DATA_ENABLED: "false",
      REPLAY_CSV_PATH: csvPath,
      REPLAY_INTERVAL_MS: "0",
      REPLAY_AUTO_START: "false"
    });
    const logger = createLogger(config);
    const database = openDatabase(config);
    const repositories = createRepositories(database);
    const marketStore = new MarketDataStore();
    const botControlService = new BotControlService();
    const paperTradingService = new PaperTradingService(
      config,
      marketStore,
      repositories.orders,
      repositories.trades,
      repositories.positions,
      logger
    );
    const strategyService = new StrategyService(
      repositories.candles,
      repositories.signals,
      logger,
      undefined,
      botControlService,
      (signal) => paperTradingService.handleSignal(signal)
    );
    const replayService = new ReplayService(
      config,
      logger,
      marketStore,
      repositories.candles,
      strategyService
    );

    const state = replayService.start();
    const candles = repositories.candles.listRecent("BTCUSDT", "1d", 25);

    expect(state.completed).toBe(true);
    expect(state.processedCandles).toBe(21);
    expect(candles).toHaveLength(21);
    expect(candles[0]).toMatchObject({
      timeframe: "1d",
      openTime: Date.UTC(2026, 0, 21),
      closeTime: Date.UTC(2026, 0, 21) + 86_400_000 - 1,
      volume: 3
    });
    expect(marketStore.getPrice("BTCUSDT")).toMatchObject({
      price: 120.5,
      source: "ticker"
    });

    database.close();
  });

  it("parses CryptoDataDownload hourly CSV files with metadata headers", () => {
    const candles = parseReplayCsv(
      [
        "https://www.CryptoDataDownload.com",
        "Unix,Date,Symbol,Open,High,Low,Close,Volume BTC,Volume USDT,tradecount",
        "1777158000000,2026-04-25 23:00:00,BTCUSDT,77557.01,77650.0,77530.0,77625.0,362.30872,28106981.4981678,31415",
        "1739318400000000,2025-02-12 00:00:00,BTCUSDT,95778.21,96120.0,95672.56,96060.0,576.62562,55288334.4821753,136856",
        "1777154400000,2026-04-25 22:00:00,BTCUSDT,77525.83,77634.77,77498.81,77557.01,242.12513,18778275.3183511,29672"
      ].join("\n"),
      "BTCUSDT"
    );

    expect(candles).toEqual([
      expect.objectContaining({
        symbol: "BTCUSDT",
        timeframe: "1h",
        openTime: 1739318400000,
        closeTime: 1739318400000 + 3_600_000 - 1,
        volume: 576.62562
      }),
      expect.objectContaining({
        symbol: "BTCUSDT",
        timeframe: "1h",
        openTime: 1777154400000,
        closeTime: 1777154400000 + 3_600_000 - 1,
        volume: 242.12513
      }),
      expect.objectContaining({
        symbol: "BTCUSDT",
        timeframe: "1h",
        openTime: 1777158000000,
        closeTime: 1777158000000 + 3_600_000 - 1,
        volume: 362.30872
      })
    ]);
  });

  it("captures replay startup errors without crashing process state", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "trading-replay-missing-"));
    const dbPath = join(tempDir, "trading.sqlite");
    const csvPath = join(tempDir, "missing.csv");
    const config = loadConfig({
      PORT: "3001",
      TRADING_MODE: "replay",
      ENABLE_LIVE: "false",
      LOG_LEVEL: "silent",
      DB_PATH: dbPath,
      MARKET_SYMBOL: "BTCUSDT",
      MARKET_DATA_ENABLED: "false",
      REPLAY_CSV_PATH: csvPath,
      REPLAY_INTERVAL_MS: "0",
      REPLAY_AUTO_START: "false"
    });
    const logger = createLogger(config);
    const database = openDatabase(config);
    const repositories = createRepositories(database);
    const marketStore = new MarketDataStore();
    const botControlService = new BotControlService();
    const strategyService = new StrategyService(
      repositories.candles,
      repositories.signals,
      logger,
      undefined,
      botControlService
    );
    const replayService = new ReplayService(
      config,
      logger,
      marketStore,
      repositories.candles,
      strategyService
    );

    const state = replayService.start();

    expect(state.loaded).toBe(false);
    expect(state.running).toBe(false);
    expect(state.completed).toBe(false);
    expect(state.lastError).toContain("ENOENT");

    database.close();
  });
});
