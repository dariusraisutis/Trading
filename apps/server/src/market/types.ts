export interface NormalizedTicker {
  type: "ticker";
  symbol: string;
  price: number;
  eventTime: number;
}

export interface NormalizedTrade {
  type: "trade";
  symbol: string;
  price: number;
  quantity: number;
  tradeId: number;
  eventTime: number;
}

export type NormalizedMarketEvent = NormalizedTicker | NormalizedTrade;

export interface MarketPriceSnapshot {
  symbol: string;
  price: number;
  source: NormalizedMarketEvent["type"];
  eventTime: number;
  receivedAt: string;
}
