import type { NewCandle } from "../db/repositories/candles.js";
import type { NormalizedTrade } from "./types.js";

const ONE_MINUTE_MS = 60_000;

interface WorkingCandle extends NewCandle {}

export class CandleBuilder {
  private readonly openCandles = new Map<string, WorkingCandle>();

  ingestTrade(trade: NormalizedTrade): NewCandle[] {
    const openTime = floorToMinute(trade.eventTime);
    const closeTime = openTime + ONE_MINUTE_MS - 1;
    const key = createKey(trade.symbol, "1m");
    const current = this.openCandles.get(key);
    const closed: NewCandle[] = [];

    if (!current || openTime > current.openTime) {
      if (current) {
        closed.push({ ...current });
      }

      this.openCandles.set(key, {
        symbol: trade.symbol,
        timeframe: "1m",
        openTime,
        closeTime,
        open: trade.price,
        high: trade.price,
        low: trade.price,
        close: trade.price,
        volume: trade.quantity
      });

      return closed;
    }

    if (openTime < current.openTime) {
      return closed;
    }

    current.high = Math.max(current.high, trade.price);
    current.low = Math.min(current.low, trade.price);
    current.close = trade.price;
    current.volume += trade.quantity;

    return closed;
  }

  closeDue(now: number): NewCandle[] {
    const closed: NewCandle[] = [];

    for (const [key, candle] of this.openCandles.entries()) {
      if (now > candle.closeTime) {
        closed.push({ ...candle });
        this.openCandles.delete(key);
      }
    }

    return closed;
  }
}

function floorToMinute(timestamp: number): number {
  return Math.floor(timestamp / ONE_MINUTE_MS) * ONE_MINUTE_MS;
}

function createKey(symbol: string, timeframe: string): string {
  return `${symbol}:${timeframe}`;
}
