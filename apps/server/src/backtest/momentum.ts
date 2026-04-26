import type { AppConfig } from "../config/env.js";
import type { Candle } from "../db/repositories/candles.js";
import { atr, ema } from "../indicators/index.js";
import { splitCandlesByTrainTest } from "./engine.js";

export type MomentumExitMode = "trend-flip" | "trailing-stop";
export type MomentumTrendGuard = "none" | "ema200-4h" | "ema200-1d";

export interface MomentumParams {
  lookback: number;
  atrPeriod: number;
  minAtrPct: number;
  exitMode: MomentumExitMode;
  partialExitFraction?: number;
  partialExitAtR?: number;
  volatilityScale?: "none" | "compress";
  trendGuard?: MomentumTrendGuard;
}

export interface MomentumCompletedTrade {
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

export interface MomentumSegmentReport {
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
  completed: MomentumCompletedTrade[];
}

export interface MomentumTrainTestReport {
  splitIndex: number;
  splitTime: string;
  params: MomentumParams;
  train: MomentumSegmentReport;
  test: MomentumSegmentReport;
}

export interface MomentumOptimizationResult {
  passed: boolean;
  report: MomentumTrainTestReport;
}

export interface MomentumTrainSelection {
  passed: boolean;
  params: MomentumParams;
  train: MomentumSegmentReport;
}

interface PendingEntry {
  signalTime: string;
  atrValue: number;
}

interface OpenPosition {
  entryTime: string;
  entryPrice: number;
  quantity: number;
  initialQuantity: number;
  riskAmount: number;
  stopDistance: number;
  highestHigh: number;
  partialExitTaken: boolean;
}

export function createMomentumCandidates(): MomentumParams[] {
  const candidates: MomentumParams[] = [];
  const lookbacks = [60, 90, 120];
  const minAtrPcts = [0.01, 0.015, 0.02];
  const exitModes: MomentumExitMode[] = ["trend-flip", "trailing-stop"];

  for (const lookback of lookbacks) {
    for (const minAtrPct of minAtrPcts) {
      for (const exitMode of exitModes) {
        candidates.push({
          lookback,
          atrPeriod: 14,
          minAtrPct,
          exitMode,
          partialExitFraction: 0,
          partialExitAtR: 0,
          volatilityScale: "none",
          trendGuard: "none"
        });
      }
    }
  }

  return candidates;
}

export function optimizeMomentumStrategy(
  candles: Candle[],
  config: Pick<
    AppConfig,
    | "BACKTEST_TRAIN_SPLIT"
    | "PAPER_ACCOUNT_SIZE"
    | "RISK_PER_TRADE_PCT"
    | "PAPER_FEE_RATE"
    | "SLIPPAGE_PCT"
  >,
  candidates: MomentumParams[]
): MomentumOptimizationResult {
  if (candidates.length === 0) {
    throw new Error("At least one momentum candidate is required");
  }

  const split = splitCandlesByTrainTest(candles, config.BACKTEST_TRAIN_SPLIT);
  const best = optimizeMomentumOnTrainSegment(split.trainCandles, config, candidates);

  const finalReport = runMomentumTrainTest(candles, config, best.params);

  return {
    passed: best.passed,
    report: finalReport
  };
}

export function optimizeMomentumOnTrainSegment(
  trainCandles: Candle[],
  config: Pick<AppConfig, "PAPER_ACCOUNT_SIZE" | "RISK_PER_TRADE_PCT" | "PAPER_FEE_RATE" | "SLIPPAGE_PCT">,
  candidates: MomentumParams[]
): MomentumTrainSelection {
  if (candidates.length === 0) {
    throw new Error("At least one momentum candidate is required");
  }

  let best: MomentumTrainSelection | null = null;

  for (const params of candidates) {
    const train = runMomentumSegment("train", trainCandles, params, config);
    const result: MomentumTrainSelection = {
      passed: passesMomentumMinimums(train),
      params,
      train
    };

    if (best === null || isBetterMomentumTrainSelection(result, best)) {
      best = result;
    }
  }

  if (best === null) {
    throw new Error("Momentum optimizer failed to select a result");
  }

  return best;
}

export function runMomentumTrainTest(
  candles: Candle[],
  config: Pick<
    AppConfig,
    | "BACKTEST_TRAIN_SPLIT"
    | "PAPER_ACCOUNT_SIZE"
    | "RISK_PER_TRADE_PCT"
    | "PAPER_FEE_RATE"
    | "SLIPPAGE_PCT"
  >,
  params: MomentumParams
): MomentumTrainTestReport {
  const split = splitCandlesByTrainTest(candles, config.BACKTEST_TRAIN_SPLIT);

  return {
    splitIndex: split.splitIndex,
    splitTime: split.splitTime,
    params,
    train: runMomentumSegment("train", split.trainCandles, params, config),
    test: runMomentumSegment("test", split.testCandles, params, config)
  };
}

export function runMomentumSegment(
  label: "train" | "test",
  candles: Candle[],
  params: MomentumParams,
  config: Pick<AppConfig, "PAPER_ACCOUNT_SIZE" | "RISK_PER_TRADE_PCT" | "PAPER_FEE_RATE" | "SLIPPAGE_PCT">
): MomentumSegmentReport {
  const closes = candles.map((candle) => candle.close);
  const ema200Series = ema(closes, 200);
  const dailyEma200ByOpenTime = buildDailyEma200Lookup(candles);
  const atrSeries = atr(
    candles.map((candle) => candle.high),
    candles.map((candle) => candle.low),
    closes,
    params.atrPeriod
  );
  const completed: MomentumCompletedTrade[] = [];
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
      const stopDistance = pendingEntry.atrValue * 2;
      const atrPercentAtEntry = candle.close === 0 ? 0 : pendingEntry.atrValue / candle.close;
      const sizingMultiplier =
        params.volatilityScale === "compress"
          ? computeVolatilityCompression(params.minAtrPct, atrPercentAtEntry)
          : 1;
      const riskAmount = Math.max(
        (config.PAPER_ACCOUNT_SIZE + equity) * config.RISK_PER_TRADE_PCT * sizingMultiplier,
        0
      );

      if (stopDistance > 0 && riskAmount > 0) {
        const entryPrice = applySlippage("buy", candle.open, config.SLIPPAGE_PCT);
        const quantity = riskAmount / stopDistance;
        const fee = entryPrice * quantity * config.PAPER_FEE_RATE;

        openPosition = {
          entryTime: new Date(candle.openTime).toISOString(),
          entryPrice,
          quantity,
          initialQuantity: quantity,
          riskAmount,
          stopDistance,
          highestHigh: candle.high,
          partialExitTaken: false
        };
        equity -= fee;
        totalFees += fee;
      }

      pendingEntry = null;
    }

    if (openPosition && atrValue !== null) {
      openPosition.highestHigh = Math.max(openPosition.highestHigh, candle.high);

      const partialExitPrice = maybeResolvePartialExitPrice(openPosition, candle, config, params);

      if (partialExitPrice !== null) {
        const partialFraction = params.partialExitFraction ?? 0;
        const partialQuantity = openPosition.quantity * partialFraction;

        if (partialQuantity > 0) {
          const partialRiskAmount =
            openPosition.riskAmount * (partialQuantity / openPosition.initialQuantity);
          const partialTrade = buildMomentumTrade(
            openPosition.entryTime,
            openPosition.entryPrice,
            partialQuantity,
            partialRiskAmount,
            candle.closeTime,
            partialExitPrice,
            config.PAPER_FEE_RATE
          );

          completed.push(partialTrade);
          equity += partialTrade.netPnl;
          totalFees += partialTrade.fees;
          openPosition.quantity -= partialQuantity;
          openPosition.riskAmount -= partialRiskAmount;
          openPosition.partialExitTaken = true;
        }
      }

      const stopLevel =
        params.exitMode === "trailing-stop"
          ? openPosition.highestHigh - 2 * atrValue
          : openPosition.entryPrice - 2 * atrValue;
      const trendFlipped =
        params.exitMode === "trend-flip" &&
        index >= params.lookback &&
        candle.close < closes[index - params.lookback];

      if (candle.open <= stopLevel) {
        const latest = closeMomentumPosition(
          completed,
          openPosition,
          candle,
          applySlippage("sell", candle.open, config.SLIPPAGE_PCT),
          config.PAPER_FEE_RATE
        );
        equity += latest.netPnl;
        totalFees += latest.fees;
        openPosition = null;
      } else if (candle.low <= stopLevel) {
        const latest = closeMomentumPosition(
          completed,
          openPosition,
          candle,
          applySlippage("sell", stopLevel, config.SLIPPAGE_PCT),
          config.PAPER_FEE_RATE
        );
        equity += latest.netPnl;
        totalFees += latest.fees;
        openPosition = null;
      } else if (trendFlipped) {
        const latest = closeMomentumPosition(
          completed,
          openPosition,
          candle,
          applySlippage("sell", candle.close, config.SLIPPAGE_PCT),
          config.PAPER_FEE_RATE
        );
        equity += latest.netPnl;
        totalFees += latest.fees;
        openPosition = null;
      }

      const balance = config.PAPER_ACCOUNT_SIZE + equity;
      peakBalance = Math.max(peakBalance, balance);
      maxDrawdownPctOnAccount = Math.max(
        maxDrawdownPctOnAccount,
        peakBalance <= 0 ? 0 : ((peakBalance - balance) / peakBalance) * 100
      );
    }

    if (index >= candles.length - 1 || index < params.lookback || atrValue === null || openPosition) {
      continue;
    }

    const atrPercent = atrValue / candle.close;

    if (atrPercent < params.minAtrPct) {
      continue;
    }

    if (
      candle.close > closes[index - params.lookback] &&
      passesTrendGuard(candle, index, params.trendGuard ?? "none", ema200Series, dailyEma200ByOpenTime)
    ) {
      pendingEntry = {
        signalTime: new Date(candle.closeTime).toISOString(),
        atrValue
      };
      signals += 1;
    }
  }

  const winningTrades = completed.filter((trade) => trade.netPnl > 0);
  const losingTrades = completed.filter((trade) => trade.netPnl < 0);
  const totalLossMagnitude = Math.abs(
    losingTrades.reduce((sum, trade) => sum + trade.netPnl, 0)
  );
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

export function passesMomentumMinimums(segment: MomentumSegmentReport) {
  return (
    segment.profitFactor > 1.2 &&
    segment.expectancy > 0 &&
    segment.maxDrawdownPctOnAccount < 20 &&
    segment.completedTrades >= 40
  );
}

function closeMomentumPosition(
  completed: MomentumCompletedTrade[],
  position: OpenPosition,
  candle: Candle,
  exitPrice: number,
  feeRate: number
) {
  const trade = buildMomentumTrade(
    position.entryTime,
    position.entryPrice,
    position.quantity,
    position.riskAmount,
    candle.closeTime,
    exitPrice,
    feeRate
  );

  completed.push(trade);

  return trade;
}

function buildMomentumTrade(
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
  } satisfies MomentumCompletedTrade;
}

function maybeResolvePartialExitPrice(
  position: OpenPosition,
  candle: Candle,
  config: Pick<AppConfig, "SLIPPAGE_PCT">,
  params: MomentumParams
) {
  if (
    position.partialExitTaken ||
    !params.partialExitAtR ||
    !params.partialExitFraction ||
    params.partialExitFraction <= 0
  ) {
    return null;
  }

  const targetPrice = position.entryPrice + position.stopDistance * params.partialExitAtR;

  if (candle.open >= targetPrice) {
    return applySlippage("sell", candle.open, config.SLIPPAGE_PCT);
  }

  if (candle.high >= targetPrice) {
    return applySlippage("sell", targetPrice, config.SLIPPAGE_PCT);
  }

  return null;
}

function computeVolatilityCompression(minAtrPct: number, atrPercent: number) {
  if (minAtrPct <= 0 || atrPercent <= 0) {
    return 1;
  }

  return Math.min(1, minAtrPct / atrPercent);
}

function passesTrendGuard(
  candle: Candle,
  index: number,
  trendGuard: MomentumTrendGuard,
  ema200Series: Array<number | null>,
  dailyEma200ByOpenTime: Map<number, number | null>
) {
  if (trendGuard === "none") {
    return true;
  }

  if (trendGuard === "ema200-4h") {
    const emaValue = ema200Series[index];

    return emaValue !== null && candle.close > emaValue;
  }

  const dayOpenTime = floorToDay(candle.openTime);
  const dailyEma = dailyEma200ByOpenTime.get(dayOpenTime) ?? null;

  return dailyEma !== null && candle.close > dailyEma;
}

function buildDailyEma200Lookup(candles: Candle[]) {
  const dailyCandles = aggregateCandlesToDaily(candles);
  const dailyEmaSeries = ema(
    dailyCandles.map((candle) => candle.close),
    200
  );
  const lookup = new Map<number, number | null>();

  dailyCandles.forEach((candle, index) => {
    lookup.set(candle.openTime, dailyEmaSeries[index]);
  });

  return lookup;
}

function aggregateCandlesToDaily(candles: Candle[]) {
  const buckets = new Map<number, Candle>();

  for (const candle of candles) {
    const dayOpenTime = floorToDay(candle.openTime);
    const existing = buckets.get(dayOpenTime);

    if (!existing) {
      buckets.set(dayOpenTime, {
        ...candle,
        openTime: dayOpenTime,
        closeTime: dayOpenTime + 86_400_000 - 1,
        timeframe: "1d"
      });
      continue;
    }

    existing.high = Math.max(existing.high, candle.high);
    existing.low = Math.min(existing.low, candle.low);
    existing.close = candle.close;
    existing.volume += candle.volume;
  }

  return Array.from(buckets.values()).sort((left, right) => left.openTime - right.openTime);
}

function floorToDay(timestamp: number) {
  return Math.floor(timestamp / 86_400_000) * 86_400_000;
}

function isBetterMomentumResult(left: MomentumOptimizationResult, right: MomentumOptimizationResult) {
  if (left.passed !== right.passed) {
    return left.passed;
  }

  if (left.report.train.profitFactor !== right.report.train.profitFactor) {
    return left.report.train.profitFactor > right.report.train.profitFactor;
  }

  if (left.report.train.expectancy !== right.report.train.expectancy) {
    return left.report.train.expectancy > right.report.train.expectancy;
  }

  return left.report.train.maxDrawdownPctOnAccount < right.report.train.maxDrawdownPctOnAccount;
}

function isBetterMomentumTrainSelection(left: MomentumTrainSelection, right: MomentumTrainSelection) {
  if (left.passed !== right.passed) {
    return left.passed;
  }

  if (left.train.profitFactor !== right.train.profitFactor) {
    return left.train.profitFactor > right.train.profitFactor;
  }

  if (left.train.expectancy !== right.train.expectancy) {
    return left.train.expectancy > right.train.expectancy;
  }

  return left.train.maxDrawdownPctOnAccount < right.train.maxDrawdownPctOnAccount;
}

function emptySegment(label: "train" | "test"): MomentumSegmentReport {
  return {
    label,
    candles: 0,
    signals: 0,
    completedTrades: 0,
    winRatePct: 0,
    profitFactor: 0,
    expectancy: 0,
    netPnl: 0,
    netReturnPct: 0,
    maxDrawdownPctOnAccount: 0,
    totalFees: 0,
    completed: []
  };
}

function applySlippage(side: "buy" | "sell", price: number, slippagePct: number) {
  const slipped = side === "buy" ? price * (1 + slippagePct) : price * (1 - slippagePct);

  return roundToPrice(slipped);
}

function roundToPrice(value: number) {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function roundToCents(value: number) {
  return Math.round(value * 100) / 100;
}

function roundToBasisPoints(value: number) {
  return Math.round(value * 10_000) / 10_000;
}
