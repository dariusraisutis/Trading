import type { AppConfig } from "../config/env.js";
import type { Candle } from "../db/repositories/candles.js";
import { atr, ema } from "../indicators/index.js";
import { splitCandlesByTrainTest } from "./engine.js";
import { passesActiveHourFilter } from "./scalping.js";

export interface ScalpBreakoutRetestParams {
  breakoutLookback: number;
  breakoutBodyLookback?: number;
  trendEmaPeriod: number;
  atrPeriod: number;
  minAtrPct: number;
  takeProfitR: number;
  retestExpiryCandles: number;
  atrStopFloorMultiplier?: number;
  activeHoursStartUtc?: number;
  activeHoursEndUtc?: number;
}

export interface ScalpBreakoutRetestCompletedTrade {
  entryTime: string;
  exitTime: string;
  quantity: number;
  entryPrice: number;
  exitPrice: number;
  grossPnl: number;
  fees: number;
  netPnl: number;
  returnPct: number;
  riskAmount: number;
  rMultiple: number;
}

export interface ScalpBreakoutRetestSegmentReport {
  label: "train" | "test";
  candles: number;
  signals: number;
  completedTrades: number;
  winRatePct: number;
  profitFactor: number;
  expectancy: number;
  netPnl: number;
  netReturnPct: number;
  maxDrawdownPctOnAccount: number;
  totalFees: number;
  completed: ScalpBreakoutRetestCompletedTrade[];
}

export interface ScalpBreakoutRetestTrainTestReport {
  splitIndex: number;
  splitTime: string;
  params: ScalpBreakoutRetestParams;
  train: ScalpBreakoutRetestSegmentReport;
  test: ScalpBreakoutRetestSegmentReport;
}

interface PendingRetest {
  breakoutLevel: number;
  expiryIndex: number;
}

interface PendingEntry {
  stopReferenceLow: number;
  atrValue: number;
}

interface OpenPosition {
  entryTime: string;
  entryPrice: number;
  quantity: number;
  riskAmount: number;
  stopDistance: number;
}

export function runScalpBreakoutRetestTrainTest(
  candles: Candle[],
  config: Pick<
    AppConfig,
    | "BACKTEST_TRAIN_SPLIT"
    | "PAPER_ACCOUNT_SIZE"
    | "RISK_PER_TRADE_PCT"
    | "PAPER_FEE_RATE"
    | "SLIPPAGE_PCT"
  >,
  params: ScalpBreakoutRetestParams
): ScalpBreakoutRetestTrainTestReport {
  const split = splitCandlesByTrainTest(candles, config.BACKTEST_TRAIN_SPLIT);

  return {
    splitIndex: split.splitIndex,
    splitTime: split.splitTime,
    params,
    train: runScalpBreakoutRetestSegment("train", split.trainCandles, params, config),
    test: runScalpBreakoutRetestSegment("test", split.testCandles, params, config)
  };
}

export function runScalpBreakoutRetestSegment(
  label: "train" | "test",
  candles: Candle[],
  params: ScalpBreakoutRetestParams,
  config: Pick<AppConfig, "PAPER_ACCOUNT_SIZE" | "RISK_PER_TRADE_PCT" | "PAPER_FEE_RATE" | "SLIPPAGE_PCT">
): ScalpBreakoutRetestSegmentReport {
  const closes = candles.map((candle) => candle.close);
  const trendEma = ema(closes, params.trendEmaPeriod);
  const atrSeries = atr(
    candles.map((candle) => candle.high),
    candles.map((candle) => candle.low),
    closes,
    params.atrPeriod
  );
  const completed: ScalpBreakoutRetestCompletedTrade[] = [];
  let pendingRetest: PendingRetest | null = null;
  let pendingEntry: PendingEntry | null = null;
  let openPosition: OpenPosition | null = null;
  let equity = 0;
  let peakBalance = config.PAPER_ACCOUNT_SIZE;
  let maxDrawdownPctOnAccount = 0;
  let totalFees = 0;
  let signals = 0;

  for (let index = 0; index < candles.length; index += 1) {
    const candle = candles[index];
    const atrValue = atrSeries[index];

    if (pendingEntry && openPosition === null) {
      const entryPrice = applySlippage("buy", candle.open, config.SLIPPAGE_PCT);
      const retestStopDistance = entryPrice - pendingEntry.stopReferenceLow;
      const atrStopDistance =
        params.atrStopFloorMultiplier && params.atrStopFloorMultiplier > 0
          ? pendingEntry.atrValue * params.atrStopFloorMultiplier
          : 0;
      const stopDistance = Math.max(retestStopDistance, atrStopDistance);
      const riskAmount = Math.max((config.PAPER_ACCOUNT_SIZE + equity) * config.RISK_PER_TRADE_PCT, 0);

      if (stopDistance > 0 && riskAmount > 0) {
        const quantity = riskAmount / stopDistance;
        const fee = entryPrice * quantity * config.PAPER_FEE_RATE;

        openPosition = {
          entryTime: new Date(candle.openTime).toISOString(),
          entryPrice,
          quantity,
          riskAmount,
          stopDistance
        };
        equity -= fee;
        totalFees += fee;
      }

      pendingEntry = null;
    }

    if (openPosition) {
      const stopLevel = openPosition.entryPrice - openPosition.stopDistance;
      const targetLevel = openPosition.entryPrice + openPosition.stopDistance * params.takeProfitR;
      let exitPrice: number | null = null;

      if (candle.open <= stopLevel) {
        exitPrice = applySlippage("sell", candle.open, config.SLIPPAGE_PCT);
      } else if (candle.low <= stopLevel) {
        exitPrice = applySlippage("sell", stopLevel, config.SLIPPAGE_PCT);
      } else if (candle.high >= targetLevel) {
        exitPrice = applySlippage("sell", targetLevel, config.SLIPPAGE_PCT);
      } else if (index === candles.length - 1) {
        exitPrice = applySlippage("sell", candle.close, config.SLIPPAGE_PCT);
      }

      if (exitPrice !== null) {
        const trade = buildTrade(
          openPosition.entryTime,
          openPosition.entryPrice,
          openPosition.quantity,
          openPosition.riskAmount,
          candle.closeTime,
          exitPrice,
          config.PAPER_FEE_RATE
        );

        completed.push(trade);
        equity += trade.netPnl;
        totalFees += trade.fees;
        openPosition = null;
      }

      const balance = config.PAPER_ACCOUNT_SIZE + equity;
      peakBalance = Math.max(peakBalance, balance);
      maxDrawdownPctOnAccount = Math.max(
        maxDrawdownPctOnAccount,
        peakBalance <= 0 ? 0 : ((peakBalance - balance) / peakBalance) * 100
      );
    }

    if (pendingRetest && index > pendingRetest.expiryIndex) {
      pendingRetest = null;
    }

    if (
      index >= candles.length - 1 ||
      index < Math.max(params.breakoutLookback, params.breakoutBodyLookback ?? 0) ||
      atrValue === null ||
      openPosition
    ) {
      continue;
    }

    const trendValue = trendEma[index];

    if (trendValue === null || candle.close <= trendValue) {
      continue;
    }

    if (!passesActiveHourFilter(candle.openTime, params)) {
      continue;
    }

    const atrPercent = candle.close === 0 ? 0 : atrValue / candle.close;

    if (atrPercent < params.minAtrPct) {
      continue;
    }

    const activeRetest = pendingRetest;

    if (activeRetest && isRetestEntryCandle(candle, activeRetest.breakoutLevel)) {
      pendingEntry = { stopReferenceLow: candle.low, atrValue };
      pendingRetest = null;
      signals += 1;
      continue;
    }

    const previousRangeHigh = highestHigh(candles, index - params.breakoutLookback, index - 1);
    const averageBody =
      params.breakoutBodyLookback && params.breakoutBodyLookback > 0
        ? averageBodySize(candles, index - params.breakoutBodyLookback, index - 1)
        : null;

    if (isLongBreakoutCandle(candle, previousRangeHigh, averageBody)) {
      pendingRetest = {
        breakoutLevel: previousRangeHigh,
        expiryIndex: index + params.retestExpiryCandles
      };
    }
  }

  const winningTrades = completed.filter((trade) => trade.netPnl > 0);
  const losingTrades = completed.filter((trade) => trade.netPnl < 0);
  const totalLossMagnitude = Math.abs(losingTrades.reduce((sum, trade) => sum + trade.netPnl, 0));
  const totalEntryNotional = completed.reduce((sum, trade) => sum + trade.entryPrice * trade.quantity, 0);
  const averageWin =
    winningTrades.length === 0
      ? 0
      : winningTrades.reduce((sum, trade) => sum + trade.netPnl, 0) / winningTrades.length;
  const averageLossMagnitude =
    losingTrades.length === 0
      ? 0
      : Math.abs(losingTrades.reduce((sum, trade) => sum + trade.netPnl, 0) / losingTrades.length);
  const winRateRatio = completed.length === 0 ? 0 : winningTrades.length / completed.length;
  const lossRateRatio = completed.length === 0 ? 0 : losingTrades.length / completed.length;

  return {
    label,
    candles: candles.length,
    signals,
    completedTrades: completed.length,
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
    netPnl: roundToCents(completed.reduce((sum, trade) => sum + trade.netPnl, 0)),
    netReturnPct:
      totalEntryNotional === 0
        ? 0
        : roundToBasisPoints(
            (completed.reduce((sum, trade) => sum + trade.netPnl, 0) / totalEntryNotional) * 100
          ),
    maxDrawdownPctOnAccount: roundToBasisPoints(maxDrawdownPctOnAccount),
    totalFees: roundToCents(totalFees),
    completed
  };
}

export function isLongBreakoutCandle(
  candle: Pick<Candle, "open" | "close">,
  previousRangeHigh: number,
  averageBody: number | null
) {
  return (
    candle.close > previousRangeHigh &&
    candle.close > candle.open &&
    (averageBody === null || bodySize(candle) > averageBody)
  );
}

export function isRetestEntryCandle(
  candle: Pick<Candle, "low" | "open" | "close">,
  breakoutLevel: number
) {
  const rangeMidpoint = (candle.low + Math.max(candle.open, candle.close)) / 2;

  return (
    candle.low <= breakoutLevel &&
    candle.close > breakoutLevel &&
    candle.close > candle.open &&
    candle.close > rangeMidpoint
  );
}

function highestHigh(candles: Candle[], startIndex: number, endIndex: number) {
  let highest = Number.NEGATIVE_INFINITY;

  for (let index = startIndex; index <= endIndex; index += 1) {
    highest = Math.max(highest, candles[index].high);
  }

  return highest;
}

function averageBodySize(candles: Candle[], startIndex: number, endIndex: number) {
  let total = 0;
  let count = 0;

  for (let index = startIndex; index <= endIndex; index += 1) {
    total += bodySize(candles[index]);
    count += 1;
  }

  return count === 0 ? 0 : total / count;
}

function bodySize(candle: Pick<Candle, "open" | "close">) {
  return Math.abs(candle.close - candle.open);
}

function buildTrade(
  entryTime: string,
  entryPrice: number,
  quantity: number,
  riskAmount: number,
  exitTime: number,
  exitPrice: number,
  feeRate: number
) {
  const fee = exitPrice * quantity * feeRate;
  const grossPnl = (exitPrice - entryPrice) * quantity;
  const netPnl = grossPnl - fee;

  return {
    entryTime,
    exitTime: new Date(exitTime).toISOString(),
    quantity: roundToBasisPoints(quantity),
    entryPrice: roundToPrice(entryPrice),
    exitPrice: roundToPrice(exitPrice),
    grossPnl: roundToCents(grossPnl),
    fees: roundToCents(fee),
    netPnl: roundToCents(netPnl),
    returnPct: roundToBasisPoints((netPnl / (entryPrice * quantity)) * 100),
    riskAmount: roundToCents(riskAmount),
    rMultiple: riskAmount === 0 ? 0 : roundToBasisPoints(netPnl / riskAmount)
  } satisfies ScalpBreakoutRetestCompletedTrade;
}

function applySlippage(side: "buy" | "sell", price: number, slippagePct: number) {
  const slipped = side === "buy" ? price * (1 + slippagePct) : price * (1 - slippagePct);

  return roundToPrice(slipped);
}

function roundToPrice(value: number) {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function roundToBasisPoints(value: number) {
  return Math.round(value * 10_000) / 10_000;
}

function roundToCents(value: number) {
  return Math.round(value * 100) / 100;
}
