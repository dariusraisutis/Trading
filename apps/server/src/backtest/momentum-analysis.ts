import type { AppConfig } from "../config/env.js";
import type { Candle } from "../db/repositories/candles.js";
import type { MomentumCompletedTrade, MomentumOptimizationResult, MomentumParams, MomentumSegmentReport } from "./momentum.js";
import { optimizeMomentumOnTrainSegment, optimizeMomentumStrategy, runMomentumSegment } from "./momentum.js";

export interface TradeConcentrationReport {
  topTrades: MomentumCompletedTrade[];
  topProfitSum: number;
  grossWinningProfit: number;
  shareOfWinningProfitPct: number;
}

export interface RegimeBreakdownReport {
  bull: RegimeTradeSummary;
  bear: RegimeTradeSummary;
  sideways: RegimeTradeSummary;
}

export interface WalkForwardWindow {
  trainStart: string;
  trainEnd: string;
  testStart: string;
  testEnd: string;
}

export interface WalkForwardResult {
  window: WalkForwardWindow;
  frozenParams: MomentumParams;
  trainQualified: boolean;
  train: MomentumSegmentReport;
  test: MomentumSegmentReport;
}

export interface RegimeTradeSummary {
  label: "bull" | "bear" | "sideways";
  completedTrades: number;
  winRatePct: number;
  profitFactor: number;
  expectancy: number;
  netPnl: number;
  netReturnPct: number;
  totalFees: number;
  completed: MomentumCompletedTrade[];
}

export function analyzeTradeConcentration(
  segment: MomentumSegmentReport,
  topN = 5
): TradeConcentrationReport {
  const topTrades = [...segment.completed]
    .filter((trade) => trade.netPnl > 0)
    .sort((left, right) => right.netPnl - left.netPnl)
    .slice(0, topN);
  const topProfitSum = roundToCents(topTrades.reduce((sum, trade) => sum + trade.netPnl, 0));
  const grossWinningProfit = roundToCents(
    segment.completed.filter((trade) => trade.netPnl > 0).reduce((sum, trade) => sum + trade.netPnl, 0)
  );

  return {
    topTrades,
    topProfitSum,
    grossWinningProfit,
    shareOfWinningProfitPct:
      grossWinningProfit === 0 ? 0 : roundToBasisPoints((topProfitSum / grossWinningProfit) * 100)
  };
}

export function buildBtcDateRegimeBreakdown(
  segment: MomentumSegmentReport
): RegimeBreakdownReport {
  return {
    bull: summarizeTradeSubset(
      "bull",
      segment.completed.filter(
        (trade) =>
          inRange(trade.exitTime, "2017-01-01", "2017-12-31") ||
          inRange(trade.exitTime, "2020-01-01", "2021-12-31")
      )
    ),
    bear: summarizeTradeSubset(
      "bear",
      segment.completed.filter(
        (trade) =>
          inRange(trade.exitTime, "2018-01-01", "2018-12-31") ||
          inRange(trade.exitTime, "2022-01-01", "2022-12-31")
      )
    ),
    sideways: summarizeTradeSubset(
      "sideways",
      segment.completed.filter(
        (trade) =>
          inRange(trade.exitTime, "2019-01-01", "2019-12-31") ||
          inRange(trade.exitTime, "2023-01-01", "2023-12-31")
      )
    )
  };
}

export function runMomentumWalkForward(
  candles: Candle[],
  config: Pick<
    AppConfig,
    | "BACKTEST_TRAIN_SPLIT"
    | "PAPER_ACCOUNT_SIZE"
    | "RISK_PER_TRADE_PCT"
    | "PAPER_FEE_RATE"
    | "SLIPPAGE_PCT"
  >,
  candidates: MomentumParams[],
  windows: WalkForwardWindow[]
): WalkForwardResult[] {
  return windows.map((window) => {
    const trainCandles = candles.filter((candle) =>
      inRange(candle.openTime, window.trainStart, window.trainEnd)
    );
    const testCandles = candles.filter((candle) =>
      inRange(candle.openTime, window.testStart, window.testEnd)
    );
    const optimization = optimizeMomentumOnTrainSegment(
      trainCandles,
      config,
      candidates
    );

    return {
      window,
      frozenParams: optimization.params,
      trainQualified: optimization.passed,
      train: optimization.train,
      test: runMomentumSegment("test", testCandles, optimization.params, config)
    };
  });
}

function summarizeTradeSubset(
  label: "bull" | "bear" | "sideways",
  trades: MomentumCompletedTrade[]
): RegimeTradeSummary {
  const winningTrades = trades.filter((trade) => trade.netPnl > 0);
  const losingTrades = trades.filter((trade) => trade.netPnl < 0);
  const totalLossMagnitude = Math.abs(losingTrades.reduce((sum, trade) => sum + trade.netPnl, 0));
  const totalEntryNotional = trades.reduce((sum, trade) => sum + trade.entryPrice * trade.quantity, 0);
  const averageWin =
    winningTrades.length === 0 ? 0 : winningTrades.reduce((sum, trade) => sum + trade.netPnl, 0) / winningTrades.length;
  const averageLossMagnitude =
    losingTrades.length === 0 ? 0 : Math.abs(losingTrades.reduce((sum, trade) => sum + trade.netPnl, 0) / losingTrades.length);
  const winRateRatio = trades.length === 0 ? 0 : winningTrades.length / trades.length;
  const lossRateRatio = trades.length === 0 ? 0 : losingTrades.length / trades.length;

  return {
    label,
    completedTrades: trades.length,
    winRatePct: roundToBasisPoints(winRateRatio * 100),
    profitFactor:
      totalLossMagnitude === 0
        ? winningTrades.length > 0
          ? Number.POSITIVE_INFINITY
          : 0
        : roundToBasisPoints(
            winningTrades.reduce((sum, trade) => sum + trade.netPnl, 0) / totalLossMagnitude
          ),
    expectancy: roundToCents(winRateRatio * averageWin - lossRateRatio * averageLossMagnitude),
    netPnl: roundToCents(trades.reduce((sum, trade) => sum + trade.netPnl, 0)),
    netReturnPct:
      totalEntryNotional === 0
        ? 0
        : roundToBasisPoints((trades.reduce((sum, trade) => sum + trade.netPnl, 0) / totalEntryNotional) * 100),
    totalFees: roundToCents(trades.reduce((sum, trade) => sum + trade.fees, 0)),
    completed: trades
  };
}

function inRange(value: number | string, startDate: string, endDate: string) {
  const timestamp = typeof value === "number" ? value : Date.parse(value);
  const start = Date.parse(`${startDate}T00:00:00.000Z`);
  const end = Date.parse(`${endDate}T23:59:59.999Z`);

  return timestamp >= start && timestamp <= end;
}

function roundToCents(value: number) {
  return Math.round(value * 100) / 100;
}

function roundToBasisPoints(value: number) {
  return Math.round(value * 10_000) / 10_000;
}
