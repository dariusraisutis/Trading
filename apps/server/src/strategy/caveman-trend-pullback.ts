import { atr, ema, rsi } from "../indicators/index.js";
import type { Strategy, StrategySignal } from "./types.js";

export function createCavemanTrendPullbackStrategy(
  emaPeriod = 200,
  rsiPeriod = 14,
  longRsiThreshold = 40,
  shortRsiThreshold = 60,
  atrPeriod = 14,
  minAtrPct = 0.015
): Strategy {
  return {
    name: "caveman-trend-pullback",
    requiredCandles: Math.max(emaPeriod, rsiPeriod + 1),
    evaluate(candles) {
      const minimumCandles = Math.max(emaPeriod, rsiPeriod + 1);

      if (candles.length < minimumCandles) {
        return null;
      }

      const closes = candles.map((candle) => candle.close);
      const highs = candles.map((candle) => candle.high);
      const lows = candles.map((candle) => candle.low);
      const trend = ema(closes, emaPeriod);
      const pullback = rsi(closes, rsiPeriod);
      const volatility = atr(highs, lows, closes, atrPeriod);
      const latest = candles[candles.length - 1];
      const latestTrend = trend[trend.length - 1];
      const latestRsi = pullback[pullback.length - 1];
      const latestAtr = volatility[volatility.length - 1];

      if (latestTrend === null || latestRsi === null || latestAtr === null) {
        return null;
      }

      if (latestAtr / latest.close < minAtrPct) {
        return null;
      }

      if (latest.close > latestTrend && latestRsi < longRsiThreshold) {
        return createSignal(
          latest,
          "buy",
          `Trend up above EMA ${emaPeriod} with RSI ${latestRsi.toFixed(2)} below ${longRsiThreshold}`
        );
      }

      if (latest.close < latestTrend && latestRsi > shortRsiThreshold) {
        return createSignal(
          latest,
          "sell",
          `Trend down below EMA ${emaPeriod} with RSI ${latestRsi.toFixed(2)} above ${shortRsiThreshold}`
        );
      }

      return null;
    }
  };
}

function createSignal(candle: { id: number; symbol: string }, side: "buy" | "sell", reason: string): StrategySignal {
  return {
    strategy: "caveman-trend-pullback",
    symbol: candle.symbol,
    candleId: candle.id,
    side,
    reason
  };
}
