import type { Candle } from "../db/repositories/candles.js";

export type SignalSide = "buy" | "sell" | "hold";
export type SignalIntent = "open" | "close" | "both";

export interface StrategyTradePlan {
  timeframe?: string;
  stopDistance?: number;
  partialExitFraction?: number;
  partialExitAtR?: number;
}

export interface StrategySignal {
  strategy: string;
  symbol: string;
  candleId: number;
  side: SignalSide;
  reason: string;
  intent?: SignalIntent;
  tradePlan?: StrategyTradePlan;
}

export interface Strategy {
  name: string;
  timeframe: string;
  requiredCandles: number;
  evaluate(candles: Candle[]): StrategySignal | null;
}
