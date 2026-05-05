import type pino from "pino";

import type { BotControlService } from "../bot/control-service.js";
import type { AppConfig } from "../config/env.js";
import type { Candle } from "../db/repositories/candles.js";
import type { OrderRepository } from "../db/repositories/orders.js";
import type { PositionControl, PositionControlRepository } from "../db/repositories/position-controls.js";
import type { Position, PositionRepository } from "../db/repositories/positions.js";
import type { TradeRepository } from "../db/repositories/trades.js";
import type { MarketDataStore } from "../market/store.js";
import { RiskService } from "../risk/service.js";
import type { StrategySignal } from "../strategy/types.js";
import { buildExecutionAnalytics } from "./analytics.js";

export class PaperTradingService {
  private readonly riskService: RiskService;

  constructor(
    private readonly config: Pick<
      AppConfig,
      | "TRADING_MODE"
      | "PAPER_ACCOUNT_SIZE"
      | "RISK_PER_TRADE_PCT"
      | "PAPER_FEE_RATE"
      | "SLIPPAGE_PCT"
      | "STOP_LOSS_PCT"
      | "TAKE_PROFIT_PCT"
      | "MAX_DAILY_LOSS_PCT"
      | "MAX_CONSECUTIVE_LOSSES"
      | "KILL_SWITCH_MAX_DRAWDOWN_PCT"
      | "KILL_SWITCH_MAX_CONSECUTIVE_LOSSES"
      | "TRADE_COOLDOWN_MS"
    >,
    private readonly marketStore: MarketDataStore,
    private readonly orderRepository: OrderRepository,
    private readonly tradeRepository: TradeRepository,
    private readonly positionControlRepository: PositionControlRepository,
    private readonly positionRepository: PositionRepository,
    private readonly logger: pino.Logger,
    private readonly botControlService?: BotControlService
  ) {
    this.riskService = new RiskService(config);
  }

  handleSignal(signal: StrategySignal) {
    if (this.config.TRADING_MODE === "live") {
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

    const currentPosition =
      this.positionRepository.findBySymbol(signal.symbol) ?? createEmptyPosition(signal.symbol);
    if (this.killSwitchActive()) {
      this.logger.warn({ signal }, "Paper trade blocked because kill-switch is active");
      return;
    }

    const lastTrade = this.tradeRepository.findMostRecent(signal.symbol);
    const tradeHistory = this.tradeRepository.listAll(signal.symbol);
    const accountBalance = this.calculateAccountBalance(currentPosition.realizedPnl);
    const decision = this.riskService.evaluate(
      signal,
      priceSnapshot,
      currentPosition.quantity === 0 ? null : currentPosition,
      lastTrade,
      {
        accountBalance,
        consecutiveLosses: this.calculateConsecutiveLosses(tradeHistory, priceSnapshot.receivedAt),
        dailyLossPct: this.calculateDailyLossPct(tradeHistory, priceSnapshot.receivedAt, accountBalance)
      }
    );

    if (!decision.allowed) {
      this.logger.warn({ signal, reason: decision.reason }, "Paper trade blocked by risk engine");
      return;
    }

    const quantity = decision.quantity;
    const executionPrice = applySlippage(signal.side, priceSnapshot.price, this.config.SLIPPAGE_PCT);
    const fee = executionPrice * quantity * this.config.PAPER_FEE_RATE;
    const orderId = this.orderRepository.create({
      symbol: signal.symbol,
      side: signal.side,
      type: "market",
      quantity,
      price: executionPrice,
      status: "filled",
      mode: this.config.TRADING_MODE
    });

    const tradeId = this.tradeRepository.create({
      orderId,
      symbol: signal.symbol,
      side: signal.side,
      quantity,
      price: executionPrice,
      fee,
      executedAt: priceSnapshot.receivedAt
    });

    const updatedPosition = applyPaperFill(
      currentPosition,
      signal.side,
      quantity,
      executionPrice,
      fee
    );

    this.positionRepository.upsert(updatedPosition);
    this.updatePositionControlAfterSignal(signal, executionPrice, updatedPosition);
    this.applyKillSwitchIfNeeded(signal.symbol);
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

  handleProtectiveExit(candle: Pick<Candle, "symbol" | "timeframe" | "open" | "high" | "low" | "closeTime">) {
    if (this.config.TRADING_MODE === "live") {
      return;
    }

    const currentPosition = this.positionRepository.findBySymbol(candle.symbol);
    const control = this.positionControlRepository.findBySymbol(candle.symbol);

    if (control && currentPosition && currentPosition.quantity > 0) {
      if (candle.timeframe === control.timeframe) {
        this.handleChampionProtectiveExit(candle, currentPosition, control);
      }
      return;
    }

    const decision = this.riskService.evaluateProtectiveExit(currentPosition, candle);

    if (!decision.shouldExit || !decision.side || !decision.quantity || !decision.price || !currentPosition) {
      return;
    }

    const executedAt = new Date(candle.closeTime).toISOString();
    const executionPrice = applySlippage(decision.side, decision.price, this.config.SLIPPAGE_PCT);
    const fee = executionPrice * decision.quantity * this.config.PAPER_FEE_RATE;
    const orderId = this.orderRepository.create({
      symbol: candle.symbol,
      side: decision.side,
      type: "market",
      quantity: decision.quantity,
      price: executionPrice,
      status: "filled",
      mode: this.config.TRADING_MODE
    });
    const tradeId = this.tradeRepository.create({
      orderId,
      symbol: candle.symbol,
      side: decision.side,
      quantity: decision.quantity,
      price: executionPrice,
      fee,
      executedAt
    });
    const updatedPosition = applyPaperFill(
      currentPosition,
      decision.side,
      decision.quantity,
      executionPrice,
      fee
    );

    this.positionRepository.upsert(updatedPosition);
    this.applyKillSwitchIfNeeded(candle.symbol);
    this.logger.info(
      {
        symbol: candle.symbol,
        reason: decision.reason,
        orderId,
        tradeId,
        position: updatedPosition
      },
      "Protective exit executed"
    );
  }

  private calculateAccountBalance(realizedPnl: number) {
    return roundToCents(Math.max(this.config.PAPER_ACCOUNT_SIZE + realizedPnl, 0));
  }

  private calculateConsecutiveLosses(
    symbolTrades: ReturnType<TradeRepository["listAll"]>,
    referenceTime: string
  ) {
    const analytics = buildExecutionAnalytics(symbolTrades, this.config);
    const referenceDay = referenceTime.slice(0, 10);
    const sameDayCompleted = analytics.completed.filter(
      (trade) => trade.exitTime.slice(0, 10) === referenceDay
    );
    let consecutiveLosses = 0;

    for (let index = sameDayCompleted.length - 1; index >= 0; index -= 1) {
      if (sameDayCompleted[index].netPnl < 0) {
        consecutiveLosses += 1;
        continue;
      }

      break;
    }

    return consecutiveLosses;
  }

  private calculateDailyLossPct(
    symbolTrades: ReturnType<TradeRepository["listAll"]>,
    referenceTime: string,
    accountBalance: number
  ) {
    const analytics = buildExecutionAnalytics(symbolTrades, this.config);
    const referenceDay = referenceTime.slice(0, 10);
    const dailyLossAmount = analytics.completed
      .filter((trade) => trade.exitTime.slice(0, 10) === referenceDay && trade.netPnl < 0)
      .reduce((sum, trade) => sum + Math.abs(trade.netPnl), 0);

    if (accountBalance === 0) {
      return 1;
    }

    return dailyLossAmount / accountBalance;
  }

  private killSwitchActive() {
    return this.botControlService?.getState().killSwitchActive ?? false;
  }

  private applyKillSwitchIfNeeded(symbol: string) {
    if (!this.botControlService) {
      return;
    }

    const trades = this.tradeRepository.listAll(symbol);
    const analytics = buildExecutionAnalytics(trades, this.config);
    const consecutiveLosses = this.calculateGlobalConsecutiveLosses(analytics.completed);
    const drawdownPct = this.calculatePeakDrawdownPct(analytics.equityCurve);

    if (consecutiveLosses >= this.config.KILL_SWITCH_MAX_CONSECUTIVE_LOSSES) {
      const reason = `kill-switch: ${consecutiveLosses} consecutive losses`;
      this.botControlService.tripKillSwitch(reason);
      this.logger.error({ symbol, consecutiveLosses }, "Kill-switch triggered");
      return;
    }

    if (drawdownPct >= this.config.KILL_SWITCH_MAX_DRAWDOWN_PCT) {
      const reason = `kill-switch: ${(drawdownPct * 100).toFixed(2)}% peak drawdown`;
      this.botControlService.tripKillSwitch(reason);
      this.logger.error({ symbol, drawdownPct }, "Kill-switch triggered");
    }
  }

  private calculateGlobalConsecutiveLosses(completed: ReturnType<typeof buildExecutionAnalytics>["completed"]) {
    let consecutiveLosses = 0;

    for (let index = completed.length - 1; index >= 0; index -= 1) {
      if (completed[index].netPnl < 0) {
        consecutiveLosses += 1;
        continue;
      }

      break;
    }

    return consecutiveLosses;
  }

  private calculatePeakDrawdownPct(
    equityCurve: ReturnType<typeof buildExecutionAnalytics>["equityCurve"]
  ) {
    let peakBalance = this.config.PAPER_ACCOUNT_SIZE;
    let maxDrawdownPct = 0;

    for (const point of equityCurve) {
      const balance = this.config.PAPER_ACCOUNT_SIZE + point.equity;
      peakBalance = Math.max(peakBalance, balance);

      if (peakBalance <= 0) {
        continue;
      }

      maxDrawdownPct = Math.max(maxDrawdownPct, (peakBalance - balance) / peakBalance);
    }

    return maxDrawdownPct;
  }

  private updatePositionControlAfterSignal(
    signal: StrategySignal,
    executionPrice: number,
    updatedPosition: Position
  ) {
    if (signal.strategy !== "momentum-champion") {
      return;
    }

    if (updatedPosition.quantity <= 0) {
      this.positionControlRepository.removeBySymbol(signal.symbol);
      return;
    }

    if (signal.side !== "buy" || signal.intent === "close") {
      return;
    }

    const stopDistance = signal.tradePlan?.stopDistance ?? 0;
    const partialExitFraction = signal.tradePlan?.partialExitFraction ?? 0;
    const partialExitAtR = signal.tradePlan?.partialExitAtR ?? 0;

    this.positionControlRepository.upsert({
      symbol: signal.symbol,
      strategy: signal.strategy,
      timeframe: signal.tradePlan?.timeframe ?? "4h",
      stopPrice: stopDistance > 0 ? roundToPrice(executionPrice - stopDistance) : null,
      partialTargetPrice:
        stopDistance > 0 && partialExitFraction > 0 && partialExitAtR > 0
          ? roundToPrice(executionPrice + stopDistance * partialExitAtR)
          : null,
      partialExitFraction,
      partialExitTaken: false
    });
  }

  private handleChampionProtectiveExit(
    candle: Pick<Candle, "symbol" | "timeframe" | "open" | "high" | "low" | "closeTime">,
    currentPosition: Position,
    control: PositionControl
  ) {
    let position = currentPosition;
    let latestControl = control;

    if (
      !latestControl.partialExitTaken &&
      latestControl.partialTargetPrice !== null &&
      latestControl.partialExitFraction > 0
    ) {
      const partialExitPrice = resolveLongLimitLikeExitPrice(
        candle.open,
        candle.high,
        latestControl.partialTargetPrice
      );

      if (partialExitPrice !== null) {
        const partialQuantity = roundToQuantity(position.quantity * latestControl.partialExitFraction);

        if (partialQuantity > 0 && partialQuantity < position.quantity) {
          position = this.executePaperExit(
            candle.symbol,
            "sell",
            partialQuantity,
            partialExitPrice,
            new Date(candle.closeTime).toISOString(),
            position,
            "Champion partial exit executed"
          );
          latestControl = {
            ...latestControl,
            partialExitTaken: true
          };
          this.positionControlRepository.upsert(latestControl);
        }
      }
    }

    if (latestControl.stopPrice === null) {
      return;
    }

    const stopExitPrice = resolveLongStopExitPrice(candle.open, candle.low, latestControl.stopPrice);

    if (stopExitPrice === null) {
      return;
    }

    const updatedPosition = this.executePaperExit(
      candle.symbol,
      "sell",
      position.quantity,
      stopExitPrice,
      new Date(candle.closeTime).toISOString(),
      position,
      "Champion stop exit executed"
    );

    if (updatedPosition.quantity <= 0) {
      this.positionControlRepository.removeBySymbol(candle.symbol);
    }
  }

  private executePaperExit(
    symbol: string,
    side: "buy" | "sell",
    quantity: number,
    rawPrice: number,
    executedAt: string,
    currentPosition: Position,
    logMessage: string
  ) {
    const executionPrice = applySlippage(side, rawPrice, this.config.SLIPPAGE_PCT);
    const fee = executionPrice * quantity * this.config.PAPER_FEE_RATE;
    const orderId = this.orderRepository.create({
      symbol,
      side,
      type: "market",
      quantity,
      price: executionPrice,
      status: "filled",
      mode: this.config.TRADING_MODE
    });
    const tradeId = this.tradeRepository.create({
      orderId,
      symbol,
      side,
      quantity,
      price: executionPrice,
      fee,
      executedAt
    });
    const updatedPosition = applyPaperFill(currentPosition, side, quantity, executionPrice, fee);

    this.positionRepository.upsert(updatedPosition);
    this.applyKillSwitchIfNeeded(symbol);
    this.logger.info({ symbol, orderId, tradeId, position: updatedPosition }, logMessage);

    return updatedPosition;
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

function roundToQuantity(value: number) {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function applySlippage(side: "buy" | "sell", price: number, slippagePct: number) {
  if (side === "buy") {
    return roundToPrice(price * (1 + slippagePct));
  }

  return roundToPrice(price * (1 - slippagePct));
}

function roundToPrice(value: number) {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function resolveLongLimitLikeExitPrice(open: number, high: number, targetPrice: number) {
  if (open >= targetPrice) {
    return open;
  }

  if (high >= targetPrice) {
    return targetPrice;
  }

  return null;
}

function resolveLongStopExitPrice(open: number, low: number, stopPrice: number) {
  if (open <= stopPrice) {
    return open;
  }

  if (low <= stopPrice) {
    return stopPrice;
  }

  return null;
}
