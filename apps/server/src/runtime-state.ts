import type pino from "pino";

import type { CandleRepository } from "./db/repositories/candles.js";
import type { PositionRepository } from "./db/repositories/positions.js";
import type { TradeRepository } from "./db/repositories/trades.js";
import type { MarketDataStore } from "./market/store.js";

export interface RecoveredRuntimeState {
  recoveredPrice: number | null;
  recoveredPriceTime: number | null;
  openPositionQuantity: number | null;
  lastTradeExecutedAt: string | null;
}

export function recoverRuntimeState(
  symbol: string,
  dependencies: {
    candleRepository: CandleRepository;
    tradeRepository: TradeRepository;
    positionRepository: PositionRepository;
    marketStore: MarketDataStore;
    logger: pino.Logger;
  }
): RecoveredRuntimeState {
  const latestCandle = dependencies.candleRepository.findLatestBySymbol(symbol);
  const position = dependencies.positionRepository.findBySymbol(symbol);
  const lastTrade = dependencies.tradeRepository.findMostRecent(symbol);

  if (latestCandle) {
    dependencies.marketStore.update({
      type: "ticker",
      symbol: latestCandle.symbol,
      price: latestCandle.close,
      eventTime: latestCandle.closeTime
    });
  }

  const recovered: RecoveredRuntimeState = {
    recoveredPrice: latestCandle?.close ?? null,
    recoveredPriceTime: latestCandle?.closeTime ?? null,
    openPositionQuantity: position?.quantity ?? null,
    lastTradeExecutedAt: lastTrade?.executedAt ?? null
  };

  dependencies.logger.info(
    {
      symbol,
      recoveredRuntimeState: recovered
    },
    "Recovered runtime state from local storage"
  );

  return recovered;
}
