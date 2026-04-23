import { zScore } from "../indicators/index.js";
import type { Strategy, StrategySignal } from "./types.js";

export function createMeanReversionStrategy(period = 20, threshold = 2): Strategy {
  return {
    name: "mean-reversion",
    evaluate(candles) {
      if (candles.length < period) {
        return null;
      }

      const closes = candles.map((candle) => candle.close);
      const scores = zScore(closes, period);
      const latest = candles[candles.length - 1];
      const latestScore = scores[scores.length - 1];

      if (latestScore === null) {
        return null;
      }

      if (latestScore <= -threshold) {
        return createSignal(latest, "buy", `Z-score ${latestScore.toFixed(2)} below -${threshold}`);
      }

      if (latestScore >= threshold) {
        return createSignal(latest, "sell", `Z-score ${latestScore.toFixed(2)} above ${threshold}`);
      }

      return null;
    }
  };
}

function createSignal(candle: { id: number; symbol: string }, side: "buy" | "sell", reason: string): StrategySignal {
  return {
    strategy: "mean-reversion",
    symbol: candle.symbol,
    candleId: candle.id,
    side,
    reason
  };
}
