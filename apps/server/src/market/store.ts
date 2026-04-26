import type { MarketPriceSnapshot, NormalizedMarketEvent } from "./types.js";

export class MarketDataStore {
  private readonly prices = new Map<string, MarketPriceSnapshot>();

  update(event: NormalizedMarketEvent): MarketPriceSnapshot {
    const snapshot: MarketPriceSnapshot = {
      symbol: event.symbol,
      price: event.price,
      source: event.type,
      eventTime: event.eventTime,
      receivedAt: new Date(event.eventTime).toISOString()
    };

    this.prices.set(event.symbol, snapshot);
    return snapshot;
  }

  getPrice(symbol: string): MarketPriceSnapshot | null {
    return this.prices.get(symbol.toUpperCase()) ?? null;
  }
}
