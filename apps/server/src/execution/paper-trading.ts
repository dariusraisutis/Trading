import type pino from "pino";

import type { AppConfig } from "../config/env.js";
import type { OrderRepository } from "../db/repositories/orders.js";
import type { Position, PositionRepository } from "../db/repositories/positions.js";
import type { TradeRepository } from "../db/repositories/trades.js";
import type { MarketDataStore } from "../market/store.js";
import type { StrategySignal } from "../strategy/types.js";

const PAPER_TRADE_SIZE = 1;
const PAPER_FEE_RATE = 0.001;

export class PaperTradingService {
  constructor(
    private readonly config: Pick<AppConfig, "TRADING_MODE">,
    private readonly marketStore: MarketDataStore,
    private readonly orderRepository: OrderRepository,
    private readonly tradeRepository: TradeRepository,
    private readonly positionRepository: PositionRepository,
    private readonly logger: pino.Logger
  ) {}

  handleSignal(signal: StrategySignal) {
    if (this.config.TRADING_MODE !== "paper") {
      return;
    }

    if (signal.side === "hold") {
      return;
    }

    const priceSnapshot = this.marketStore.getPrice(signal.symbol);

    if (!priceSnapshot) {
      this.logger.warn({ signal }, "Skipping paper trade because no market price is available");
      return;
    }

    const quantity = PAPER_TRADE_SIZE;
    const fee = priceSnapshot.price * quantity * PAPER_FEE_RATE;
    const orderId = this.orderRepository.create({
      symbol: signal.symbol,
      side: signal.side,
      type: "market",
      quantity,
      price: priceSnapshot.price,
      status: "filled",
      mode: "paper"
    });

    const tradeId = this.tradeRepository.create({
      orderId,
      symbol: signal.symbol,
      side: signal.side,
      quantity,
      price: priceSnapshot.price,
      fee
    });

    const currentPosition =
      this.positionRepository.findBySymbol(signal.symbol) ?? createEmptyPosition(signal.symbol);
    const updatedPosition = applyPaperFill(
      currentPosition,
      signal.side,
      quantity,
      priceSnapshot.price,
      fee
    );

    this.positionRepository.upsert(updatedPosition);
    this.logger.info(
      {
        signal,
        orderId,
        tradeId,
        position: updatedPosition
      },
      "Paper trade executed"
    );
  }
}

export function applyPaperFill(
  position: Position,
  side: "buy" | "sell",
  quantity: number,
  price: number,
  fee: number
): Position {
  let nextQuantity = position.quantity;
  let nextAveragePrice = position.averagePrice;
  let nextRealizedPnl = position.realizedPnl;

  if (side === "buy") {
    if (position.quantity >= 0) {
      const totalCost = position.quantity * position.averagePrice + quantity * price;
      nextQuantity = position.quantity + quantity;
      nextAveragePrice = nextQuantity === 0 ? 0 : totalCost / nextQuantity;
      nextRealizedPnl -= fee;
    } else {
      const closingQuantity = Math.min(quantity, Math.abs(position.quantity));
      nextRealizedPnl += (position.averagePrice - price) * closingQuantity - fee;
      nextQuantity = position.quantity + quantity;

      if (nextQuantity > 0) {
        nextAveragePrice = price;
      } else if (nextQuantity === 0) {
        nextAveragePrice = 0;
      }
    }
  } else {
    if (position.quantity <= 0) {
      const totalProceeds =
        Math.abs(position.quantity) * position.averagePrice + quantity * price;
      nextQuantity = position.quantity - quantity;
      nextAveragePrice = nextQuantity === 0 ? 0 : totalProceeds / Math.abs(nextQuantity);
      nextRealizedPnl -= fee;
    } else {
      const closingQuantity = Math.min(quantity, position.quantity);
      nextRealizedPnl += (price - position.averagePrice) * closingQuantity - fee;
      nextQuantity = position.quantity - quantity;

      if (nextQuantity < 0) {
        nextAveragePrice = price;
      } else if (nextQuantity === 0) {
        nextAveragePrice = 0;
      }
    }
  }

  return {
    symbol: position.symbol,
    quantity: nextQuantity,
    averagePrice: nextAveragePrice,
    realizedPnl: roundToCents(nextRealizedPnl)
  };
}

function createEmptyPosition(symbol: string): Position {
  return {
    symbol,
    quantity: 0,
    averagePrice: 0,
    realizedPnl: 0
  };
}

function roundToCents(value: number): number {
  return Math.round(value * 100) / 100;
}
