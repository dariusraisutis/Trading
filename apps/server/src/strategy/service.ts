import type pino from "pino";

import type { BotControlService } from "../bot/control-service.js";
import type { Candle, CandleRepository } from "../db/repositories/candles.js";
import type { SignalRepository } from "../db/repositories/signals.js";
import { createBreakoutStrategy } from "./breakout.js";
import { createCavemanTrendPullbackStrategy } from "./caveman-trend-pullback.js";
import { createMaCrossoverStrategy } from "./ma-crossover.js";
import { createMeanReversionStrategy } from "./mean-reversion.js";
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
      createCavemanTrendPullbackStrategy()
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
    const lookback = Math.max(...this.strategies.map((strategy) => strategy.requiredCandles), 50);
    const candles = this.candleRepository.listBeforeOrAt(
      candle.symbol,
      candle.timeframe,
      candle.openTime,
      lookback
    );
    const existingSignals = this.signalRepository.listByCandleId(candle.symbol, candle.id);
    const existingDirectionalSignal = existingSignals.find(
      (signal): signal is typeof signal & { side: "buy" | "sell" } =>
        signal.side === "buy" || signal.side === "sell"
    );
    let acceptedSide: "buy" | "sell" | null = existingDirectionalSignal?.side ?? null;

    for (const strategy of this.strategies) {
      if (this.botControlService && !this.botControlService.allowsStrategy(strategy.name)) {
        continue;
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
