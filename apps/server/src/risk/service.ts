import type { AppConfig } from "../config/env.js";
import type { Candle } from "../db/repositories/candles.js";
import type { Position } from "../db/repositories/positions.js";
import type { Trade } from "../db/repositories/trades.js";
import type { MarketPriceSnapshot } from "../market/types.js";
import type { StrategySignal } from "../strategy/types.js";

export interface RiskDecision {
  allowed: boolean;
  quantity: number;
  reason?: string;
}

export interface EntryRiskContext {
  accountBalance: number;
  consecutiveLosses: number;
  dailyLossPct: number;
}

export interface ProtectiveExitDecision {
  shouldExit: boolean;
  side?: "buy" | "sell";
  quantity?: number;
  price?: number;
  reason?: string;
}

export class RiskService {
  constructor(
    private readonly config: Pick<
      AppConfig,
      | "PAPER_ACCOUNT_SIZE"
      | "RISK_PER_TRADE_PCT"
      | "STOP_LOSS_PCT"
      | "TAKE_PROFIT_PCT"
      | "MAX_DAILY_LOSS_PCT"
      | "MAX_CONSECUTIVE_LOSSES"
      | "TRADE_COOLDOWN_MS"
    >
  ) {}

  evaluate(
    signal: StrategySignal,
    price: MarketPriceSnapshot,
    position: Position | null,
    lastTrade: Trade | null,
    context: EntryRiskContext
  ): RiskDecision {
    const hasPosition = position !== null && position.quantity !== 0;
    const quantity = hasPosition
      ? Math.abs(position.quantity)
      : this.calculateEntryQuantity(price.price, context.accountBalance);
    const closesPosition =
      hasPosition &&
      ((position.quantity > 0 && signal.side === "sell") ||
        (position.quantity < 0 && signal.side === "buy"));

    if (!signal.reason.trim()) {
      return {
        allowed: false,
        quantity,
        reason: "signal reason required"
      };
    }

    if (!hasPosition && context.accountBalance <= 0) {
      return {
        allowed: false,
        quantity: 0,
        reason: "account depleted"
      };
    }

    if (hasPosition && this.stopLossBreached(position, price.price) && !closesPosition) {
      return {
        allowed: false,
        quantity,
        reason: "stop loss threshold breached"
      };
    }

    if (hasPosition && this.takeProfitBreached(position, price.price) && !closesPosition) {
      return {
        allowed: false,
        quantity,
        reason: "take profit threshold reached"
      };
    }

    if (hasPosition && !closesPosition) {
      return {
        allowed: false,
        quantity,
        reason: "position already open for symbol"
      };
    }

    if (!hasPosition && context.consecutiveLosses >= this.config.MAX_CONSECUTIVE_LOSSES) {
      return {
        allowed: false,
        quantity,
        reason: "max consecutive losses reached"
      };
    }

    if (!hasPosition && context.dailyLossPct >= this.config.MAX_DAILY_LOSS_PCT) {
      return {
        allowed: false,
        quantity,
        reason: "max daily loss reached"
      };
    }

    if (!hasPosition && lastTrade && this.withinCooldown(lastTrade.executedAt, price.receivedAt)) {
      return {
        allowed: false,
        quantity,
        reason: "trade cooldown active"
      };
    }

    return {
      allowed: true,
      quantity
    };
  }

  evaluateProtectiveExit(position: Position | null, candle: Pick<Candle, "open" | "high" | "low">): ProtectiveExitDecision {
    if (position === null || position.quantity === 0) {
      return { shouldExit: false };
    }

    const exit = position.quantity > 0 ? this.longProtectiveExit(position, candle) : this.shortProtectiveExit(position, candle);

    if (exit) {
      return {
        shouldExit: true,
        side: position.quantity > 0 ? "sell" : "buy",
        quantity: Math.abs(position.quantity),
        price: exit.price,
        reason: exit.reason
      };
    }

    return { shouldExit: false };
  }

  private withinCooldown(executedAt: string, receivedAt: string) {
    return Date.parse(receivedAt) - Date.parse(executedAt) < this.config.TRADE_COOLDOWN_MS;
  }

  private calculateEntryQuantity(price: number, accountBalance: number) {
    const riskAmount = accountBalance * this.config.RISK_PER_TRADE_PCT;
    const positionNotional = riskAmount / this.config.STOP_LOSS_PCT;

    return roundToPrecision(positionNotional / price);
  }

  private stopLossBreached(position: Position, price: number) {
    if (position.quantity > 0) {
      return price <= position.averagePrice * (1 - this.config.STOP_LOSS_PCT);
    }

    return price >= position.averagePrice * (1 + this.config.STOP_LOSS_PCT);
  }

  private takeProfitBreached(position: Position, price: number) {
    if (position.quantity > 0) {
      return price >= position.averagePrice * (1 + this.config.TAKE_PROFIT_PCT);
    }

    return price <= position.averagePrice * (1 - this.config.TAKE_PROFIT_PCT);
  }

  private longProtectiveExit(position: Position, candle: Pick<Candle, "open" | "high" | "low">) {
    const stopPrice = position.averagePrice * (1 - this.config.STOP_LOSS_PCT);
    const takeProfitPrice = position.averagePrice * (1 + this.config.TAKE_PROFIT_PCT);

    if (candle.open <= stopPrice) {
      return { price: candle.open, reason: "stop loss threshold breached" };
    }

    if (candle.open >= takeProfitPrice) {
      return { price: candle.open, reason: "take profit threshold reached" };
    }

    if (candle.low <= stopPrice) {
      return { price: stopPrice, reason: "stop loss threshold breached" };
    }

    if (candle.high >= takeProfitPrice) {
      return { price: takeProfitPrice, reason: "take profit threshold reached" };
    }

    return null;
  }

  private shortProtectiveExit(position: Position, candle: Pick<Candle, "open" | "high" | "low">) {
    const stopPrice = position.averagePrice * (1 + this.config.STOP_LOSS_PCT);
    const takeProfitPrice = position.averagePrice * (1 - this.config.TAKE_PROFIT_PCT);

    if (candle.open >= stopPrice) {
      return { price: candle.open, reason: "stop loss threshold breached" };
    }

    if (candle.open <= takeProfitPrice) {
      return { price: candle.open, reason: "take profit threshold reached" };
    }

    if (candle.high >= stopPrice) {
      return { price: stopPrice, reason: "stop loss threshold breached" };
    }

    if (candle.low <= takeProfitPrice) {
      return { price: takeProfitPrice, reason: "take profit threshold reached" };
    }

    return null;
  }
}

function roundToPrecision(value: number) {
  return Math.round(value * 1_000_000) / 1_000_000;
}
