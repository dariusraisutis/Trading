import type { NewCandle } from "../db/repositories/candles.js";
import type { NormalizedTrade } from "./types.js";

const TIMEFRAMES = [
  { label: "1m", intervalMs: 60_000 },
  { label: "4h", intervalMs: 4 * 60 * 60_000 }
] as const;

interface WorkingCandle extends NewCandle {}

export class CandleBuilder {
  private readonly openCandles = new Map<string, WorkingCandle>();

  ingestTrade(trade: NormalizedTrade): NewCandle[] {
    const closed: NewCandle[] = [];

    for (const timeframe of TIMEFRAMES) {
      const openTime = floorToInterval(trade.eventTime, timeframe.intervalMs);
      const closeTime = openTime + timeframe.intervalMs - 1;
      const key = createKey(trade.symbol, timeframe.label);
      const current = this.openCandles.get(key);

      if (!current || openTime > current.openTime) {
        if (current) {
          closed.push({ ...current });
        }

        this.openCandles.set(key, {
          symbol: trade.symbol,
          timeframe: timeframe.label,
          openTime,
          closeTime,
          open: trade.price,
          high: trade.price,
          low: trade.price,
          close: trade.price,
          volume: trade.quantity
        });
        continue;
      }

      if (openTime < current.openTime) {
        continue;
      }

      current.high = Math.max(current.high, trade.price);
      current.low = Math.min(current.low, trade.price);
      current.close = trade.price;
      current.volume += trade.quantity;
    }

    return sortCandles(closed);
  }

  closeDue(now: number): NewCandle[] {
    const closed: NewCandle[] = [];

    for (const [key, candle] of this.openCandles.entries()) {
      if (now > candle.closeTime) {
        closed.push({ ...candle });
        this.openCandles.delete(key);
      }
    }

    return sortCandles(closed);
  }
}

function floorToInterval(timestamp: number, intervalMs: number) {
  return Math.floor(timestamp / intervalMs) * intervalMs;
}

function createKey(symbol: string, timeframe: string): string {
  return `${symbol}:${timeframe}`;
}

function sortCandles(candles: NewCandle[]) {
  return [...candles].sort((left, right) => {
    if (left.openTime !== right.openTime) {
      return left.openTime - right.openTime;
    }

    return timeframeRank(left.timeframe) - timeframeRank(right.timeframe);
  });
}

function timeframeRank(timeframe: string) {
  if (timeframe === "1m") {
    return 0;
  }

  if (timeframe === "4h") {
    return 1;
  }

  return 99;
}
