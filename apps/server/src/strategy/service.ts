import type pino from "pino";

import type { Candle, CandleRepository } from "../db/repositories/candles.js";
import type { SignalRepository } from "../db/repositories/signals.js";
import { createBreakoutStrategy } from "./breakout.js";
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
      createMeanReversionStrategy()
    ],
    private readonly onSignalCreated?: (signal: {
      strategy: string;
      symbol: string;
      candleId: number;
      side: "buy" | "sell" | "hold";
      reason: string;
    }) => void
  ) {}

  evaluateClosedCandle(candle: Candle) {
    const candles = this.candleRepository.listBeforeOrAt(
      candle.symbol,
      candle.timeframe,
      candle.openTime,
      50
    );

    for (const strategy of this.strategies) {
      const signal = strategy.evaluate(candles);

      if (!signal) {
        continue;
      }

      const id = this.signalRepository.create(signal);

      if (id !== null) {
        this.logger.info({ signal: { id, ...signal } }, "Signal generated");
        this.onSignalCreated?.(signal);
      }
    }
  }
}
