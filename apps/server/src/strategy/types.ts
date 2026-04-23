import type { Candle } from "../db/repositories/candles.js";

export type SignalSide = "buy" | "sell" | "hold";

export interface StrategySignal {
  strategy: string;
  symbol: string;
  candleId: number;
  side: SignalSide;
  reason: string;
}

export interface Strategy {
  name: string;
  evaluate(candles: Candle[]): StrategySignal | null;
}
