import type pino from "pino";

import type { BotControlService } from "../bot/control-service.js";
import type { Candle, CandleRepository } from "../db/repositories/candles.js";
import type { SignalRepository } from "../db/repositories/signals.js";
import { createBreakoutStrategy } from "./breakout.js";
import { createCavemanTrendPullbackStrategy } from "./caveman-trend-pullback.js";
import { createMaCrossoverStrategy } from "./ma-crossover.js";
import { createMeanReversionStrategy } from "./mean-reversion.js";
import { createMomentumChampionStrategy } from "./momentum-champion.js";
import type { Strategy } from "./types.js";

export class StrategyService {
  constructor(
    private readonly candleRepository: CandleRepository,
    private readonly signalRepository: SignalRepository,
    private readonly logger: pino.Logger,
    private readonly strategies: Strategy[] = [
      createMaCrossoverStrategy(),
      createBreakoutStrategy(),
      createMeanReversionStrategy(),
      createCavemanTrendPullbackStrategy(),
      createMomentumChampionStrategy()
    ],
    private readonly botControlService?: BotControlService,
    private readonly onSignalCreated?: (signal: {
      strategy: string;
      symbol: string;
      candleId: number;
      side: "buy" | "sell" | "hold";
      reason: string;
    }) => void
  ) {}

  evaluateClosedCandle(candle: Candle) {
    const candleCache = new Map<string, Candle[]>();
    const existingSignals = this.signalRepository.listByCandleId(candle.symbol, candle.id);
    const existingDirectionalSignal = existingSignals.find(
      (signal): signal is typeof signal & { side: "buy" | "sell" } =>
        signal.side === "buy" || signal.side === "sell"
    );
    let acceptedSide: "buy" | "sell" | null = existingDirectionalSignal?.side ?? null;

    for (const strategy of this.strategies) {
      if (strategy.timeframe !== candle.timeframe) {
        continue;
      }

      if (this.botControlService && !this.botControlService.allowsStrategy(strategy.name)) {
        continue;
      }

      let candles = candleCache.get(strategy.timeframe);

      if (!candles) {
        const lookback = Math.max(strategy.requiredCandles, 50);
        candles = this.candleRepository.listBeforeOrAt(
          candle.symbol,
          strategy.timeframe,
          candle.openTime,
          lookback
        );
        candleCache.set(strategy.timeframe, candles);
      }

      const signal = strategy.evaluate(candles);

      if (!signal) {
        continue;
      }

      if (
        acceptedSide !== null &&
        signal.side !== "hold" &&
        signal.side !== acceptedSide
      ) {
        this.logger.warn(
          {
            signal,
            acceptedSide,
            candleId: candle.id
          },
          "Skipping conflicting same-candle signal"
        );
        continue;
      }

      const id = this.signalRepository.create(signal);

      if (id !== null) {
        if (signal.side !== "hold") {
          acceptedSide = signal.side;
        }
        this.logger.info({ signal: { id, ...signal } }, "Signal generated");
        this.onSignalCreated?.(signal);
      }
    }
  }
}
