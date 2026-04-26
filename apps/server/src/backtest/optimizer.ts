import type { AppConfig } from "../config/env.js";
import type { Candle } from "../db/repositories/candles.js";
import type { Trade } from "../db/repositories/trades.js";
import { buildExecutionAnalytics, type ExecutionAnalytics } from "../execution/analytics.js";
import { applyPaperFill } from "../execution/paper-trading.js";
import { atr, ema, rsi } from "../indicators/index.js";
import { RiskService } from "../risk/service.js";
import { createCavemanTrendPullbackStrategy } from "../strategy/caveman-trend-pullback.js";
import {
  runBacktestSegment,
  runTrainTestBacktest,
  splitCandlesByTrainTest,
  type BacktestReport
} from "./engine.js";

export interface CavemanStrategyParams {
  emaPeriod: number;
  longRsiThreshold: number;
  shortRsiThreshold: number;
  minAtrPct: number;
  stopLossPct: number;
  rewardRiskRatio: number;
}

export interface CavemanOptimizationResult {
  params: CavemanStrategyParams;
  report: BacktestReport;
  trainAnalytics: ExecutionAnalytics;
  trainMaxDrawdownPctOnAccount: number;
  score: number;
  passed: boolean;
}

export function optimizeCavemanStrategy(
  candles: Candle[],
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
  >,
  candidates: CavemanStrategyParams[]
): CavemanOptimizationResult {
  if (candidates.length === 0) {
    throw new Error("At least one candidate is required");
  }

  const split = splitCandlesByTrainTest(candles, config.BACKTEST_TRAIN_SPLIT);
  let best: CavemanOptimizationResult | null = null;

  for (const params of candidates) {
    const candidateConfig = {
      ...config,
      STOP_LOSS_PCT: params.stopLossPct,
      TAKE_PROFIT_PCT: roundToPrecision(params.stopLossPct * params.rewardRiskRatio)
    };
    const trainResult = evaluateCavemanTrainSegment(split.trainCandles, params, candidateConfig);
    const score = scoreTrainSegment(trainResult.analytics, trainResult.maxDrawdownPctOnAccount);
    const passed = passesTrainMinimums(trainResult.analytics, trainResult.maxDrawdownPctOnAccount);
    const result: CavemanOptimizationResult = {
      params,
      report: {
        splitIndex: split.splitIndex,
        splitTime: split.splitTime,
        train: emptyTestSegment(split.splitTime),
        test: emptyTestSegment(split.splitTime)
      },
      trainAnalytics: trainResult.analytics,
      trainMaxDrawdownPctOnAccount: trainResult.maxDrawdownPctOnAccount,
      score,
      passed
    };

    if (best === null || isBetterResult(result, best)) {
      best = result;
    }
  }

  if (best === null) {
    throw new Error("Optimizer failed to select a result");
  }

  const frozenStrategy = createCavemanTrendPullbackStrategy(
    best.params.emaPeriod,
    14,
    best.params.longRsiThreshold,
    best.params.shortRsiThreshold,
    14,
    best.params.minAtrPct
  );
  const frozenReport = runTrainTestBacktest(candles, frozenStrategy, {
    ...config,
    STOP_LOSS_PCT: best.params.stopLossPct,
    TAKE_PROFIT_PCT: roundToPrecision(best.params.stopLossPct * best.params.rewardRiskRatio)
  });

  return {
    ...best,
    report: frozenReport,
    trainAnalytics: frozenReport.train.analytics,
    trainMaxDrawdownPctOnAccount: frozenReport.train.maxDrawdownPctOnAccount,
    passed: passesTrainMinimums(
      frozenReport.train.analytics,
      frozenReport.train.maxDrawdownPctOnAccount
    ),
    score: scoreTrainSegment(
      frozenReport.train.analytics,
      frozenReport.train.maxDrawdownPctOnAccount
    )
  };
}

export function createDefaultCavemanCandidates(): CavemanStrategyParams[] {
  const candidates: CavemanStrategyParams[] = [];
  const emaPeriods = [100, 150, 200, 250];
  const longThresholds = [30, 35, 40, 45];
  const shortThresholds = [55, 60, 65, 70];
  const minAtrPcts = [0.005, 0.0075, 0.01, 0.0125];
  const stopLossPcts = [0.01, 0.015, 0.02, 0.025];
  const rewardRiskRatios = [1.5, 2, 2.5, 3];

  for (const emaPeriod of emaPeriods) {
    for (const longRsiThreshold of longThresholds) {
      for (const shortRsiThreshold of shortThresholds) {
        for (const minAtrPct of minAtrPcts) {
          for (const stopLossPct of stopLossPcts) {
            for (const rewardRiskRatio of rewardRiskRatios) {
              candidates.push({
                emaPeriod,
                longRsiThreshold,
                shortRsiThreshold,
                minAtrPct,
                stopLossPct,
                rewardRiskRatio
              });
            }
          }
        }
      }
    }
  }

  return candidates;
}

export function passesTrainMinimums(
  analytics: ExecutionAnalytics,
  maxDrawdownPctOnAccount: number
) {
  return (
    (analytics.profitFactor ?? 0) > 1.15 &&
    analytics.expectancy > 0 &&
    maxDrawdownPctOnAccount < 20 &&
    analytics.completedTrades >= 40
  );
}

function scoreTrainSegment(
  analytics: ExecutionAnalytics,
  maxDrawdownPctOnAccount: number
) {
  return (
    (analytics.profitFactor ?? 0) * 10_000 +
    analytics.expectancy * 100 +
    analytics.completedTrades -
    maxDrawdownPctOnAccount * 50
  );
}

function isBetterResult(left: CavemanOptimizationResult, right: CavemanOptimizationResult) {
  if (left.passed !== right.passed) {
    return left.passed;
  }

  if (left.score !== right.score) {
    return left.score > right.score;
  }

  if (left.trainAnalytics.expectancy !== right.trainAnalytics.expectancy) {
    return left.trainAnalytics.expectancy > right.trainAnalytics.expectancy;
  }

  return left.trainAnalytics.netPnl > right.trainAnalytics.netPnl;
}

function roundToPrecision(value: number) {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function emptyTestSegment(splitTime: string): BacktestReport["test"] {
  return {
    label: "test",
    startTime: splitTime,
    endTime: splitTime,
    candles: 0,
    signals: 0,
    maxDrawdownPctOnAccount: 0,
    marketRegimes: { bull: 0, bear: 0, sideways: 0 },
    analytics: {
      totalTrades: 0,
      completedTrades: 0,
      winningTrades: 0,
      losingTrades: 0,
      winRatePct: 0,
      totalVolume: 0,
      totalFees: 0,
      grossPnl: 0,
      netPnl: 0,
      netReturnPct: 0,
      averageWin: 0,
      averageLoss: 0,
      averageRisk: 0,
      profitFactor: 0,
      maxDrawdown: 0,
      maxDrawdownPct: 0,
      expectancy: 0,
      currentOpenQuantity: 0,
      currentAveragePrice: 0,
      estimatedOpenRisk: 0,
      equityCurve: [],
      completed: []
    }
  };
}

function evaluateCavemanTrainSegment(
  candles: Candle[],
  params: CavemanStrategyParams,
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
) {
  const closes = candles.map((candle) => candle.close);
  const highs = candles.map((candle) => candle.high);
  const lows = candles.map((candle) => candle.low);
  const emaSeries = ema(closes, params.emaPeriod);
  const rsiSeries = rsi(closes, 14);
  const atrSeries = atr(highs, lows, closes, 14);
  const riskService = new RiskService(config);
  const trades: Trade[] = [];
  let position = createEmptyPosition(candles[0]?.symbol ?? "BTCUSDT");
  let pendingSignal: { side: "buy" | "sell"; candleId: number } | null = null;
  let tradeId = 1;
  let orderId = 1;

  for (let index = 0; index < candles.length; index += 1) {
    const candle = candles[index];

    if (pendingSignal !== null) {
      const accountBalance = calculateAccountBalance(config.PAPER_ACCOUNT_SIZE, position.realizedPnl);
      const analytics = buildExecutionAnalytics(trades, config);
      const decision = riskService.evaluate(
        {
          strategy: "caveman-trend-pullback",
          symbol: candle.symbol,
          candleId: pendingSignal.candleId,
          side: pendingSignal.side,
          reason: "optimized train entry"
        },
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
          id: tradeId,
          orderId,
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
        tradeId += 1;
        orderId += 1;
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
        id: tradeId,
        orderId,
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
      tradeId += 1;
      orderId += 1;
    }

    if (index >= candles.length - 1) {
      continue;
    }

    const latestEma = emaSeries[index];
    const latestRsi = rsiSeries[index];
    const latestAtr = atrSeries[index];

    if (latestEma === null || latestRsi === null || latestAtr === null) {
      continue;
    }

    if (latestAtr / candle.close < params.minAtrPct) {
      continue;
    }

    if (candle.close > latestEma && latestRsi < params.longRsiThreshold) {
      pendingSignal = { side: "buy", candleId: candle.id };
      continue;
    }

    if (candle.close < latestEma && latestRsi > params.shortRsiThreshold) {
      pendingSignal = { side: "sell", candleId: candle.id };
    }
  }

  const analytics = buildExecutionAnalytics(trades, config);

  return {
    analytics,
    maxDrawdownPctOnAccount: calculateAccountDrawdownPct(
      analytics.equityCurve,
      config.PAPER_ACCOUNT_SIZE
    )
  };
}

function createEmptyPosition(symbol: string) {
  return {
    symbol,
    quantity: 0,
    averagePrice: 0,
    realizedPnl: 0
  };
}

function calculateAccountBalance(startingBalance: number, realizedPnl: number) {
  return Math.max(startingBalance + realizedPnl, 0);
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

function applySlippage(side: "buy" | "sell", price: number, slippagePct: number) {
  const slipped = side === "buy" ? price * (1 + slippagePct) : price * (1 - slippagePct);

  return Math.round(slipped * 1_000_000) / 1_000_000;
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
