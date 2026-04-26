import type { AppConfig } from "../config/env.js";
import type { Candle } from "../db/repositories/candles.js";
import type { Trade } from "../db/repositories/trades.js";
import { buildExecutionAnalytics, type ExecutionAnalytics } from "../execution/analytics.js";
import { applyPaperFill } from "../execution/paper-trading.js";
import { ema } from "../indicators/index.js";
import { RiskService } from "../risk/service.js";
import type { Strategy, StrategySignal } from "../strategy/types.js";

type DirectionalSignal = StrategySignal & { side: "buy" | "sell" };

interface BacktestTradeState {
  tradeId: number;
  orderId: number;
}

export interface MarketRegimeSummary {
  bull: number;
  bear: number;
  sideways: number;
}

export interface BacktestSegmentReport {
  label: "train" | "test";
  startTime: string;
  endTime: string;
  candles: number;
  signals: number;
  analytics: ExecutionAnalytics;
  maxDrawdownPctOnAccount: number;
  marketRegimes: MarketRegimeSummary;
}

export interface BacktestReport {
  splitIndex: number;
  splitTime: string;
  train: BacktestSegmentReport;
  test: BacktestSegmentReport;
}

export interface TrainTestSplit {
  splitIndex: number;
  splitTime: string;
  trainCandles: Candle[];
  testCandles: Candle[];
}

export function runTrainTestBacktest(
  candles: Candle[],
  strategy: Strategy,
  config: Pick<
    AppConfig,
    | "BACKTEST_TRAIN_SPLIT"
    | "PAPER_ACCOUNT_SIZE"
    | "RISK_PER_TRADE_PCT"
    | "PAPER_FEE_RATE"
    | "SLIPPAGE_PCT"
    | "STOP_LOSS_PCT"
    | "TAKE_PROFIT_PCT"
    | "MAX_DAILY_LOSS_PCT"
    | "MAX_CONSECUTIVE_LOSSES"
    | "TRADE_COOLDOWN_MS"
  >
): BacktestReport {
  const split = splitCandlesByTrainTest(candles, config.BACKTEST_TRAIN_SPLIT);

  return {
    splitIndex: split.splitIndex,
    splitTime: split.splitTime,
    train: runBacktestSegment("train", split.trainCandles, strategy, config),
    test: runBacktestSegment("test", split.testCandles, strategy, config)
  };
}

export function splitCandlesByTrainTest(candles: Candle[], trainSplit: number): TrainTestSplit {
  if (candles.length < 2) {
    throw new Error("Backtest requires at least two candles");
  }

  const splitIndex = Math.min(
    Math.max(Math.floor(candles.length * trainSplit), 1),
    candles.length - 1
  );

  return {
    splitIndex,
    splitTime: new Date(candles[splitIndex].openTime).toISOString(),
    trainCandles: candles.slice(0, splitIndex),
    testCandles: candles.slice(splitIndex)
  };
}

export function runBacktestSegment(
  label: "train" | "test",
  candles: Candle[],
  strategy: Strategy,
  config: Pick<
    AppConfig,
    | "PAPER_ACCOUNT_SIZE"
    | "RISK_PER_TRADE_PCT"
    | "PAPER_FEE_RATE"
    | "SLIPPAGE_PCT"
    | "STOP_LOSS_PCT"
    | "TAKE_PROFIT_PCT"
    | "MAX_DAILY_LOSS_PCT"
    | "MAX_CONSECUTIVE_LOSSES"
    | "TRADE_COOLDOWN_MS"
  >
): BacktestSegmentReport {
  const riskService = new RiskService(config);
  const trades: Trade[] = [];
  let position = createEmptyPosition(candles[0].symbol);
  let pendingSignal: DirectionalSignal | null = null;
  let signals = 0;
  const state: BacktestTradeState = { tradeId: 1, orderId: 1 };

  for (let index = 0; index < candles.length; index += 1) {
    const candle = candles[index];

    if (pendingSignal !== null) {
      const accountBalance = calculateAccountBalance(config.PAPER_ACCOUNT_SIZE, position.realizedPnl);
      const analytics = buildExecutionAnalytics(trades, config);
      const decision = riskService.evaluate(
        pendingSignal,
        {
          symbol: candle.symbol,
          price: candle.open,
          source: "ticker",
          eventTime: candle.openTime,
          receivedAt: new Date(candle.openTime).toISOString()
        },
        position.quantity === 0 ? null : position,
        trades.at(-1) ?? null,
        {
          accountBalance,
          consecutiveLosses: calculateConsecutiveLossesForDay(analytics, candle.openTime),
          dailyLossPct: calculateDailyLossPct(analytics, candle.openTime, accountBalance)
        }
      );

      if (decision.allowed && decision.quantity > 0) {
        const executionPrice = applySlippage(pendingSignal.side, candle.open, config.SLIPPAGE_PCT);
        const fee = executionPrice * decision.quantity * config.PAPER_FEE_RATE;

        trades.push({
          id: state.tradeId,
          orderId: state.orderId,
          symbol: candle.symbol,
          side: pendingSignal.side,
          quantity: decision.quantity,
          price: executionPrice,
          fee,
          executedAt: new Date(candle.openTime).toISOString()
        });
        position = applyPaperFill(
          position,
          pendingSignal.side,
          decision.quantity,
          executionPrice,
          fee
        );
        state.tradeId += 1;
        state.orderId += 1;
      }

      pendingSignal = null;
    }

    const protectiveExit = riskService.evaluateProtectiveExit(
      position.quantity === 0 ? null : position,
      candle
    );

    if (
      protectiveExit.shouldExit &&
      protectiveExit.side &&
      protectiveExit.quantity &&
      protectiveExit.price
    ) {
      const executionPrice = applySlippage(
        protectiveExit.side,
        protectiveExit.price,
        config.SLIPPAGE_PCT
      );
      const fee = executionPrice * protectiveExit.quantity * config.PAPER_FEE_RATE;

      trades.push({
        id: state.tradeId,
        orderId: state.orderId,
        symbol: candle.symbol,
        side: protectiveExit.side,
        quantity: protectiveExit.quantity,
        price: executionPrice,
        fee,
        executedAt: new Date(candle.closeTime).toISOString()
      });
      position = applyPaperFill(
        position,
        protectiveExit.side,
        protectiveExit.quantity,
        executionPrice,
        fee
      );
      state.tradeId += 1;
      state.orderId += 1;
    }

    const signal = strategy.evaluate(candles.slice(0, index + 1));

    if (isDirectionalSignal(signal)) {
      pendingSignal = signal;
      signals += 1;
    }
  }

  const analytics = buildExecutionAnalytics(trades, config);

  return {
    label,
    startTime: new Date(candles[0].openTime).toISOString(),
    endTime: new Date(candles[candles.length - 1].closeTime).toISOString(),
    candles: candles.length,
    signals,
    analytics,
    maxDrawdownPctOnAccount: calculateAccountDrawdownPct(analytics.equityCurve, config.PAPER_ACCOUNT_SIZE),
    marketRegimes: classifyMarketRegimes(candles)
  };
}

function classifyMarketRegimes(candles: Candle[]): MarketRegimeSummary {
  const closes = candles.map((candle) => candle.close);
  const trend = ema(closes, 200);
  const summary: MarketRegimeSummary = { bull: 0, bear: 0, sideways: 0 };

  for (let index = 1; index < candles.length; index += 1) {
    const currentTrend = trend[index];
    const previousTrend = trend[index - 1];

    if (currentTrend === null || previousTrend === null) {
      summary.sideways += 1;
      continue;
    }

    if (candles[index].close > currentTrend && currentTrend >= previousTrend) {
      summary.bull += 1;
      continue;
    }

    if (candles[index].close < currentTrend && currentTrend <= previousTrend) {
      summary.bear += 1;
      continue;
    }

    summary.sideways += 1;
  }

  return summary;
}

function calculateConsecutiveLossesForDay(
  analytics: ExecutionAnalytics,
  openTime: number
) {
  const tradingDay = new Date(openTime).toISOString().slice(0, 10);
  const sameDayTrades = analytics.completed.filter(
    (trade) => trade.exitTime.slice(0, 10) === tradingDay
  );
  let losses = 0;

  for (let index = sameDayTrades.length - 1; index >= 0; index -= 1) {
    if (sameDayTrades[index].netPnl < 0) {
      losses += 1;
      continue;
    }

    break;
  }

  return losses;
}

function calculateDailyLossPct(
  analytics: ExecutionAnalytics,
  openTime: number,
  accountBalance: number
) {
  if (accountBalance <= 0) {
    return 1;
  }

  const tradingDay = new Date(openTime).toISOString().slice(0, 10);
  const dailyLoss = analytics.completed
    .filter((trade) => trade.exitTime.slice(0, 10) === tradingDay && trade.netPnl < 0)
    .reduce((sum, trade) => sum + Math.abs(trade.netPnl), 0);

  return dailyLoss / accountBalance;
}

function calculateAccountBalance(startingBalance: number, realizedPnl: number) {
  return Math.max(startingBalance + realizedPnl, 0);
}

function createEmptyPosition(symbol: string) {
  return {
    symbol,
    quantity: 0,
    averagePrice: 0,
    realizedPnl: 0
  };
}

function applySlippage(side: "buy" | "sell", price: number, slippagePct: number) {
  const slipped = side === "buy" ? price * (1 + slippagePct) : price * (1 - slippagePct);

  return Math.round(slipped * 1_000_000) / 1_000_000;
}

function isDirectionalSignal(signal: StrategySignal | null): signal is DirectionalSignal {
  return signal !== null && (signal.side === "buy" || signal.side === "sell");
}

function calculateAccountDrawdownPct(
  equityCurve: Array<{ exitTime: string; equity: number }>,
  startingBalance: number
) {
  let peakBalance = startingBalance;
  let maxDrawdownPct = 0;

  for (const point of equityCurve) {
    const balance = startingBalance + point.equity;
    peakBalance = Math.max(peakBalance, balance);

    if (peakBalance <= 0) {
      continue;
    }

    maxDrawdownPct = Math.max(maxDrawdownPct, ((peakBalance - balance) / peakBalance) * 100);
  }

  return Math.round(maxDrawdownPct * 10_000) / 10_000;
}
