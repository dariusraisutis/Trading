import type pino from "pino";

import type { CandleRepository, NewCandle, Candle } from "../db/repositories/candles.js";
import type { NormalizedMarketEvent } from "./types.js";

import { CandleBuilder } from "./candle-builder.js";

export class CandleService {
  private readonly builder = new CandleBuilder();
  private closeTimer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly candleRepository: CandleRepository,
    private readonly logger: pino.Logger,
    private readonly onCandleClosed?: (candle: Candle) => void
  ) {}

  start() {
    if (this.closeTimer) {
      return;
    }

    this.closeTimer = setInterval(() => {
      this.persistCandles(this.builder.closeDue(Date.now()));
    }, 1_000);
  }

  stop() {
    if (this.closeTimer) {
      clearInterval(this.closeTimer);
      this.closeTimer = null;
    }

    this.persistCandles(this.builder.closeDue(Number.POSITIVE_INFINITY));
  }

  handleMarketEvent(event: NormalizedMarketEvent) {
    if (event.type !== "trade") {
      return;
    }

    this.persistCandles(this.builder.ingestTrade(event));
  }

  private persistCandles(candles: NewCandle[]) {
    for (const candle of candles) {
      const saved = this.candleRepository.create(candle);
      this.logger.info({ candle: saved }, "Candle closed");
      this.onCandleClosed?.(saved);
    }
  }
}
