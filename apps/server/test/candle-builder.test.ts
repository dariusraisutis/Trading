import { describe, expect, it } from "vitest";

import { CandleBuilder } from "../src/market/candle-builder.js";

describe("CandleBuilder", () => {
  it("aggregates trade events into correct 1-minute OHLCV candles", () => {
    const builder = new CandleBuilder();
    const firstMinute = 1_766_880_000_000;

    expect(
      builder.ingestTrade({
        type: "trade",
        symbol: "BTCUSDT",
        price: 100,
        quantity: 0.5,
        tradeId: 1,
        eventTime: firstMinute + 1_000
      })
    ).toEqual([]);
    expect(
      builder.ingestTrade({
        type: "trade",
        symbol: "BTCUSDT",
        price: 110,
        quantity: 0.25,
        tradeId: 2,
        eventTime: firstMinute + 30_000
      })
    ).toEqual([]);
    expect(
      builder.ingestTrade({
        type: "trade",
        symbol: "BTCUSDT",
        price: 95,
        quantity: 1,
        tradeId: 3,
        eventTime: firstMinute + 59_000
      })
    ).toEqual([]);

    const closed = builder.ingestTrade({
      type: "trade",
      symbol: "BTCUSDT",
      price: 105,
      quantity: 0.75,
      tradeId: 4,
      eventTime: firstMinute + 60_000
    });

    expect(closed).toEqual([
      {
        symbol: "BTCUSDT",
        timeframe: "1m",
        openTime: firstMinute,
        closeTime: firstMinute + 59_999,
        open: 100,
        high: 110,
        low: 95,
        close: 95,
        volume: 1.75
      }
    ]);
  });

  it("closes due candles when the minute has elapsed without another trade", () => {
    const builder = new CandleBuilder();
    const firstMinute = 1_766_880_000_000;

    builder.ingestTrade({
      type: "trade",
      symbol: "BTCUSDT",
      price: 100,
      quantity: 1,
      tradeId: 1,
      eventTime: firstMinute
    });

    expect(builder.closeDue(firstMinute + 60_000)).toEqual([
      {
        symbol: "BTCUSDT",
        timeframe: "1m",
        openTime: firstMinute,
        closeTime: firstMinute + 59_999,
        open: 100,
        high: 100,
        low: 100,
        close: 100,
        volume: 1
      }
    ]);
  });

  it("keeps 4h candle open until the 4h interval truly ends", () => {
    const builder = new CandleBuilder();
    const firstWindow = 1_766_880_000_000;

    builder.ingestTrade({
      type: "trade",
      symbol: "BTCUSDT",
      price: 100,
      quantity: 1,
      tradeId: 1,
      eventTime: firstWindow
    });

    expect(builder.closeDue(firstWindow + 60_000)).toEqual([
      {
        symbol: "BTCUSDT",
        timeframe: "1m",
        openTime: firstWindow,
        closeTime: firstWindow + 59_999,
        open: 100,
        high: 100,
        low: 100,
        close: 100,
        volume: 1
      }
    ]);

    expect(builder.closeDue(firstWindow + 4 * 60 * 60_000)).toEqual([
      {
        symbol: "BTCUSDT",
        timeframe: "4h",
        openTime: firstWindow,
        closeTime: firstWindow + 4 * 60 * 60_000 - 1,
        open: 100,
        high: 100,
        low: 100,
        close: 100,
        volume: 1
      }
    ]);
  });
});
