import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { openDatabase } from "../src/db/database.js";
import { createRepositories } from "../src/db/repositories/index.js";

const tempDirs: string[] = [];

function createTempDatabasePath() {
  const dir = mkdtempSync(join(tmpdir(), "trading-db-"));
  tempDirs.push(dir);
  return join(dir, "nested", "trading.sqlite");
}

afterEach(() => {
  while (tempDirs.length > 0) {
    rmSync(tempDirs.pop()!, { recursive: true, force: true });
  }
});

describe("database", () => {
  it("auto-creates required tables", () => {
    const database = openDatabase({ DB_PATH: createTempDatabasePath() });
    const tables = database
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all()
      .map((row) => (row as { name: string }).name);

    database.close();

    expect(tables).toEqual(
      expect.arrayContaining(["candles", "signals", "orders", "trades", "positions"])
    );
  });

  it("persists repository data after restart", () => {
    const dbPath = createTempDatabasePath();
    const firstConnection = openDatabase({ DB_PATH: dbPath });
    const firstRepositories = createRepositories(firstConnection);

    const created = firstRepositories.candles.create({
      symbol: "BTC/USDT",
      timeframe: "1m",
      openTime: 1_766_880_000_000,
      closeTime: 1_766_880_059_999,
      open: 100,
      high: 110,
      low: 95,
      close: 105,
      volume: 12.5
    });
    firstRepositories.signals.create({
      symbol: "BTC/USDT",
      strategy: "test",
      candleId: created.id,
      side: "buy",
      reason: "repository test"
    });
    firstRepositories.positions.upsert({
      symbol: "BTC/USDT",
      quantity: 0.1,
      averagePrice: 105,
      realizedPnl: 0
    });
    firstConnection.close();

    const secondConnection = openDatabase({ DB_PATH: dbPath });
    const secondRepositories = createRepositories(secondConnection);
    const candles = secondRepositories.candles.listRecent("BTC/USDT", "1m", 10);
    const position = secondRepositories.positions.findBySymbol("BTC/USDT");
    secondConnection.close();

    expect(candles).toHaveLength(1);
    expect(candles[0]).toMatchObject({
      symbol: "BTC/USDT",
      close: 105
    });
    expect(position).toEqual({
      symbol: "BTC/USDT",
      quantity: 0.1,
      averagePrice: 105,
      realizedPnl: 0
    });
  });

  it("updates an existing candle when the same symbol and open time are saved again", () => {
    const dbPath = createTempDatabasePath();
    const connection = openDatabase({ DB_PATH: dbPath });
    const repositories = createRepositories(connection);

    repositories.candles.create({
      symbol: "BTC/USDT",
      timeframe: "1m",
      openTime: 1,
      closeTime: 60_000,
      open: 100,
      high: 100,
      low: 100,
      close: 100,
      volume: 1
    });
    repositories.candles.create({
      symbol: "BTC/USDT",
      timeframe: "1m",
      openTime: 1,
      closeTime: 60_000,
      open: 100,
      high: 110,
      low: 90,
      close: 105,
      volume: 2
    });

    const candles = repositories.candles.listRecent("BTC/USDT", "1m", 10);
    connection.close();

    expect(candles).toHaveLength(1);
    expect(candles[0]).toMatchObject({
      open: 100,
      high: 110,
      low: 90,
      close: 105,
      volume: 2
    });
  });

  it("does not duplicate signals for the same strategy and candle", () => {
    const dbPath = createTempDatabasePath();
    const connection = openDatabase({ DB_PATH: dbPath });
    const repositories = createRepositories(connection);
    const candle = repositories.candles.create({
      symbol: "BTC/USDT",
      timeframe: "1m",
      openTime: 1,
      closeTime: 60_000,
      open: 100,
      high: 110,
      low: 90,
      close: 105,
      volume: 2
    });

    const first = repositories.signals.create({
      symbol: "BTC/USDT",
      strategy: "breakout",
      candleId: candle.id,
      side: "buy",
      reason: "first"
    });
    const second = repositories.signals.create({
      symbol: "BTC/USDT",
      strategy: "breakout",
      candleId: candle.id,
      side: "buy",
      reason: "duplicate"
    });
    const signals = repositories.signals.listRecent("BTC/USDT", 10);
    connection.close();

    expect(first).toEqual(expect.any(Number));
    expect(second).toBeNull();
    expect(signals).toHaveLength(1);
    expect(signals[0]).toMatchObject({
      strategy: "breakout",
      candleId: candle.id,
      reason: "first"
    });
  });
});
