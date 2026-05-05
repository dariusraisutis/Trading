import { atr, ema } from "../indicators/index.js";
import type { Strategy, StrategySignal } from "./types.js";

const DEFAULT_LOOKBACK = 60;
const DEFAULT_ATR_PERIOD = 14;
const DEFAULT_MIN_ATR_PCT = 0.01;
const DEFAULT_PARTIAL_EXIT_FRACTION = 0.5;
const DEFAULT_PARTIAL_EXIT_AT_R = 1.25;
const DEFAULT_TREND_EMA_PERIOD = 200;

export function createMomentumChampionStrategy(
  lookback = DEFAULT_LOOKBACK,
  atrPeriod = DEFAULT_ATR_PERIOD,
  minAtrPct = DEFAULT_MIN_ATR_PCT,
  trendEmaPeriod = DEFAULT_TREND_EMA_PERIOD,
  partialExitFraction = DEFAULT_PARTIAL_EXIT_FRACTION,
  partialExitAtR = DEFAULT_PARTIAL_EXIT_AT_R
): Strategy {
  return {
    name: "momentum-champion",
    timeframe: "4h",
    requiredCandles: Math.max(lookback + 1, atrPeriod + 1, trendEmaPeriod),
    evaluate(candles) {
      const latest = candles[candles.length - 1];

      if (!latest || latest.timeframe !== "4h") {
        return null;
      }

      const closes = candles.map((candle) => candle.close);
      const highs = candles.map((candle) => candle.high);
      const lows = candles.map((candle) => candle.low);
      const trendSeries = ema(closes, trendEmaPeriod);
      const atrSeries = atr(highs, lows, closes, atrPeriod);
      const atrValue = atrSeries[atrSeries.length - 1];
      const trendValue = trendSeries[trendSeries.length - 1];

      if (atrValue === null || trendValue === null) {
        return null;
      }

      const atrPercent = latest.close === 0 ? 0 : atrValue / latest.close;

      if (atrPercent < minAtrPct) {
        return null;
      }

      const momentumReference = closes[closes.length - 1 - lookback];

      if (momentumReference === undefined) {
        return null;
      }

      if (latest.close > momentumReference && latest.close > trendValue) {
        return {
          strategy: "momentum-champion",
          symbol: latest.symbol,
          candleId: latest.id,
          side: "buy",
          intent: "open",
          reason: `4h momentum above ${lookback}-candle close and EMA ${trendEmaPeriod}`,
          tradePlan: {
            timeframe: "4h",
            stopDistance: roundToPrice(atrValue * 2),
            partialExitFraction,
            partialExitAtR
          }
        };
      }

      if (latest.close < momentumReference) {
        return {
          strategy: "momentum-champion",
          symbol: latest.symbol,
          candleId: latest.id,
          side: "sell",
          intent: "close",
          reason: `4h momentum flipped below ${lookback}-candle close`,
          tradePlan: {
            timeframe: "4h"
          }
        };
      }

      return null;
    }
  };
}

function roundToPrice(value: number) {
  return Math.round(value * 1_000_000) / 1_000_000;
}
