import type { Strategy, StrategySignal } from "./types.js";

export function createBreakoutStrategy(period = 20): Strategy {
  return {
    name: "breakout",
    evaluate(candles) {
      if (candles.length < period + 1) {
        return null;
      }

      const latest = candles[candles.length - 1];
      const previousWindow = candles.slice(candles.length - period - 1, candles.length - 1);
      const high = Math.max(...previousWindow.map((candle) => candle.high));
      const low = Math.min(...previousWindow.map((candle) => candle.low));

      if (latest.close > high) {
        return createSignal(latest, "buy", `Close broke above ${period}-candle high`);
      }

      if (latest.close < low) {
        return createSignal(latest, "sell", `Close broke below ${period}-candle low`);
      }

      return null;
    }
  };
}

function createSignal(candle: { id: number; symbol: string }, side: "buy" | "sell", reason: string): StrategySignal {
  return {
    strategy: "breakout",
    symbol: candle.symbol,
    candleId: candle.id,
    side,
    reason
  };
}
