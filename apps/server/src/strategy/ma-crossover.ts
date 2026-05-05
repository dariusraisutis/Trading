import { ema } from "../indicators/index.js";
import type { Strategy, StrategySignal } from "./types.js";

export function createMaCrossoverStrategy(fastPeriod = 9, slowPeriod = 21): Strategy {
  return {
    name: "ma-crossover",
    timeframe: "1m",
    requiredCandles: slowPeriod + 1,
    evaluate(candles) {
      if (candles.length < slowPeriod + 1) {
        return null;
      }

      const closes = candles.map((candle) => candle.close);
      const fast = ema(closes, fastPeriod);
      const slow = ema(closes, slowPeriod);
      const previousIndex = candles.length - 2;
      const currentIndex = candles.length - 1;
      const previousFast = fast[previousIndex];
      const previousSlow = slow[previousIndex];
      const currentFast = fast[currentIndex];
      const currentSlow = slow[currentIndex];

      if (
        previousFast === null ||
        previousSlow === null ||
        currentFast === null ||
        currentSlow === null
      ) {
        return null;
      }

      const latest = candles[currentIndex];

      if (previousFast <= previousSlow && currentFast > currentSlow) {
        return createSignal(latest, "buy", `Fast EMA ${fastPeriod} crossed above slow EMA ${slowPeriod}`);
      }

      if (previousFast >= previousSlow && currentFast < currentSlow) {
        return createSignal(latest, "sell", `Fast EMA ${fastPeriod} crossed below slow EMA ${slowPeriod}`);
      }

      return null;
    }
  };
}

function createSignal(candle: { id: number; symbol: string }, side: "buy" | "sell", reason: string): StrategySignal {
  return {
    strategy: "ma-crossover",
    symbol: candle.symbol,
    candleId: candle.id,
    side,
    reason
  };
}
