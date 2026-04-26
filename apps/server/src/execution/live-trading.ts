import type pino from "pino";

import type { BotControlService } from "../bot/control-service.js";
import type { AppConfig } from "../config/env.js";
import type { OrderRepository } from "../db/repositories/orders.js";
import type { Position, PositionRepository } from "../db/repositories/positions.js";
import type { TradeRepository } from "../db/repositories/trades.js";
import type { Candle } from "../db/repositories/candles.js";
import type { MarketDataStore } from "../market/store.js";
import { RiskService } from "../risk/service.js";
import type { StrategySignal } from "../strategy/types.js";

import { applyPaperFill } from "./paper-trading.js";

export interface LiveExchangeMarket {
  symbol: string;
  amountPrecision: number | null;
  minAmount: number | null;
  minCost: number | null;
}

export interface LiveExchangeOrder {
  exchangeOrderId: string;
  symbol: string;
  side: "buy" | "sell";
  type: string;
  status: string;
  quantity: number;
  filled: number;
  averagePrice: number | null;
  feeCost: number;
  executedAt: string;
}

export interface LiveExchangeAdapter {
  loadMarket(symbol: string): Promise<LiveExchangeMarket>;
  createMarketOrder(
    symbol: string,
    side: "buy" | "sell",
    quantity: number
  ): Promise<LiveExchangeOrder>;
}

export class LiveTradingService {
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
      | "TRADE_COOLDOWN_MS"
    >,
    private readonly exchangeAdapter: LiveExchangeAdapter,
    private readonly marketStore: MarketDataStore,
    private readonly orderRepository: OrderRepository,
    private readonly tradeRepository: TradeRepository,
    private readonly positionRepository: PositionRepository,
    private readonly logger: pino.Logger,
    private readonly botControlService?: BotControlService
  ) {
    this.riskService = new RiskService(config);
  }

  async handleSignal(signal: StrategySignal) {
    if (this.config.TRADING_MODE !== "live" || signal.side === "hold") {
      return;
    }

    const priceSnapshot = this.marketStore.getPrice(signal.symbol);

    if (!priceSnapshot) {
      this.logger.warn({ signal }, "Skipping live trade because no market price is available");
      return;
    }

    const currentPosition =
      this.positionRepository.findBySymbol(signal.symbol) ?? createEmptyPosition(signal.symbol);
    const lastTrade = this.tradeRepository.findMostRecent(signal.symbol);
    const decision = this.riskService.evaluate(
      signal,
      priceSnapshot,
      currentPosition.quantity === 0 ? null : currentPosition,
      lastTrade,
      {
        accountBalance: this.config.PAPER_ACCOUNT_SIZE + currentPosition.realizedPnl,
        consecutiveLosses: 0,
        dailyLossPct: 0
      }
    );

    if (!decision.allowed) {
      this.logger.warn({ signal, reason: decision.reason }, "Live trade blocked by risk engine");
      return;
    }

    const market = await this.exchangeAdapter.loadMarket(signal.symbol);
    const quantity = validateLiveQuantity(decision.quantity, market, priceSnapshot.price);
    const order = await this.exchangeAdapter.createMarketOrder(signal.symbol, signal.side, quantity);
    const orderId = this.orderRepository.create({
      symbol: signal.symbol,
      side: signal.side,
      type: order.type,
      quantity: order.quantity,
      price: order.averagePrice,
      exchangeOrderId: order.exchangeOrderId,
      status: order.status,
      mode: "live"
    });

    if (order.filled > 0 && order.averagePrice !== null) {
      const tradeId = this.tradeRepository.create({
        orderId,
        symbol: signal.symbol,
        side: signal.side,
        quantity: order.filled,
        price: order.averagePrice,
        fee: order.feeCost,
        executedAt: order.executedAt
      });
      const updatedPosition = applyPaperFill(
        currentPosition,
        signal.side,
        order.filled,
        order.averagePrice,
        order.feeCost
      );

      this.positionRepository.upsert(updatedPosition);
      this.logger.info(
        {
          signal,
          orderId,
          tradeId,
          exchangeOrderId: order.exchangeOrderId,
          position: updatedPosition
        },
        "Live trade executed"
      );
      return;
    }

    this.logger.info(
      {
        signal,
        orderId,
        exchangeOrderId: order.exchangeOrderId,
        status: order.status
      },
      "Live order placed without immediate fill details"
    );
  }

  async handleProtectiveExit(candle: Pick<Candle, "symbol" | "open" | "high" | "low" | "closeTime">) {
    if (this.config.TRADING_MODE !== "live") {
      return;
    }

    const currentPosition = this.positionRepository.findBySymbol(candle.symbol);
    const decision = this.riskService.evaluateProtectiveExit(currentPosition, candle);

    if (!decision.shouldExit || !decision.side || !currentPosition) {
      return;
    }

    const market = await this.exchangeAdapter.loadMarket(candle.symbol);
    const quantity = validateLiveQuantity(decision.quantity ?? Math.abs(currentPosition.quantity), market, decision.price ?? candle.open);
    const order = await this.exchangeAdapter.createMarketOrder(candle.symbol, decision.side, quantity);
    const orderId = this.orderRepository.create({
      symbol: candle.symbol,
      side: decision.side,
      type: order.type,
      quantity: order.quantity,
      price: order.averagePrice,
      exchangeOrderId: order.exchangeOrderId,
      status: order.status,
      mode: "live"
    });

    if (order.filled > 0 && order.averagePrice !== null) {
      const tradeId = this.tradeRepository.create({
        orderId,
        symbol: candle.symbol,
        side: decision.side,
        quantity: order.filled,
        price: order.averagePrice,
        fee: order.feeCost,
        executedAt: order.executedAt
      });
      const updatedPosition = applyPaperFill(
        currentPosition,
        decision.side,
        order.filled,
        order.averagePrice,
        order.feeCost
      );

      this.positionRepository.upsert(updatedPosition);
      this.logger.info(
        {
          symbol: candle.symbol,
          reason: decision.reason,
          orderId,
          tradeId,
          exchangeOrderId: order.exchangeOrderId,
          position: updatedPosition
        },
        "Live protective exit executed"
      );
    }
  }
}

export class CcxtLiveExchangeAdapter implements LiveExchangeAdapter {
  private exchangePromise: Promise<any> | null = null;

  constructor(
    private readonly config: Pick<
      AppConfig,
      "EXCHANGE_ID" | "EXCHANGE_API_KEY" | "EXCHANGE_API_SECRET" | "EXCHANGE_SANDBOX"
    >,
    private readonly logger: pino.Logger
  ) {}

  async loadMarket(symbol: string): Promise<LiveExchangeMarket> {
    const exchange = await this.getExchange();
    const ccxtSymbol = normalizeCcxtSymbol(symbol);
    const market = exchange.market(ccxtSymbol);

    return {
      symbol: ccxtSymbol,
      amountPrecision:
        typeof market?.precision?.amount === "number" ? market.precision.amount : null,
      minAmount: typeof market?.limits?.amount?.min === "number" ? market.limits.amount.min : null,
      minCost: typeof market?.limits?.cost?.min === "number" ? market.limits.cost.min : null
    };
  }

  async createMarketOrder(
    symbol: string,
    side: "buy" | "sell",
    quantity: number
  ): Promise<LiveExchangeOrder> {
    const exchange = await this.getExchange();
    const ccxtSymbol = normalizeCcxtSymbol(symbol);
    const result = await exchange.createOrder(ccxtSymbol, "market", side, quantity);
    const feeCost =
      typeof result?.fee?.cost === "number"
        ? result.fee.cost
        : Array.isArray(result?.fees)
          ? result.fees.reduce(
              (sum: number, fee: { cost?: number }) => sum + (typeof fee?.cost === "number" ? fee.cost : 0),
              0
            )
          : 0;

    return {
      exchangeOrderId: String(result.id),
      symbol,
      side,
      type: result.type ?? "market",
      status: result.status ?? "open",
      quantity: typeof result.amount === "number" ? result.amount : quantity,
      filled: typeof result.filled === "number" ? result.filled : quantity,
      averagePrice:
        typeof result.average === "number"
          ? result.average
          : typeof result.price === "number"
            ? result.price
            : null,
      feeCost,
      executedAt: new Date(typeof result.timestamp === "number" ? result.timestamp : Date.now()).toISOString()
    };
  }

  private async getExchange() {
    if (!this.exchangePromise) {
      this.exchangePromise = (async () => {
        const ccxtModule = (await import("ccxt")) as Record<string, any>;
        const Exchange = ccxtModule[this.config.EXCHANGE_ID];

        if (!Exchange) {
          throw new Error(`Unsupported exchange: ${this.config.EXCHANGE_ID}`);
        }

        const exchange = new Exchange({
          apiKey: this.config.EXCHANGE_API_KEY,
          secret: this.config.EXCHANGE_API_SECRET,
          enableRateLimit: true,
          options: {
            defaultType: "spot"
          }
        });

        if (typeof exchange.setSandboxMode === "function") {
          exchange.setSandboxMode(this.config.EXCHANGE_SANDBOX);
        }

        await exchange.loadMarkets();
        this.logger.info({ exchange: this.config.EXCHANGE_ID }, "Live exchange connected");
        return exchange;
      })();
    }

    return this.exchangePromise;
  }
}

export function normalizeCcxtSymbol(symbol: string) {
  if (symbol.includes("/")) {
    return symbol;
  }

  if (symbol.endsWith("USDT")) {
    return `${symbol.slice(0, -4)}/USDT`;
  }

  if (symbol.endsWith("USD")) {
    return `${symbol.slice(0, -3)}/USD`;
  }

  return symbol;
}

export function validateLiveQuantity(
  requestedQuantity: number,
  market: LiveExchangeMarket,
  referencePrice: number
) {
  const precision = market.amountPrecision ?? 8;
  const factor = 10 ** precision;
  const quantity = Math.floor(requestedQuantity * factor) / factor;

  if (quantity <= 0) {
    throw new Error("Validated live order quantity is zero");
  }

  if (market.minAmount !== null && quantity < market.minAmount) {
    throw new Error(`Live order quantity ${quantity} is below min amount ${market.minAmount}`);
  }

  if (market.minCost !== null && quantity * referencePrice < market.minCost) {
    throw new Error(
      `Live order notional ${quantity * referencePrice} is below min cost ${market.minCost}`
    );
  }

  return Number(quantity.toFixed(precision));
}

function createEmptyPosition(symbol: string): Position {
  return {
    symbol,
    quantity: 0,
    averagePrice: 0,
    realizedPnl: 0
  };
}
