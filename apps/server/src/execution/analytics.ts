import type { AppConfig } from "../config/env.js";
import type { Trade } from "../db/repositories/trades.js";

export interface CompletedTradeSummary {
  entryTime: string;
  exitTime: string;
  side: "long" | "short";
  quantity: number;
  entryPrice: number;
  exitPrice: number;
  entryNotional: number;
  exitNotional: number;
  grossPnl: number;
  fees: number;
  netPnl: number;
  returnPct: number;
  riskAmount: number;
  rMultiple: number | null;
  durationMinutes: number;
}

export interface ExecutionAnalytics {
  totalTrades: number;
  completedTrades: number;
  winningTrades: number;
  losingTrades: number;
  winRatePct: number;
  totalVolume: number;
  totalFees: number;
  grossPnl: number;
  netPnl: number;
  netReturnPct: number;
  averageWin: number;
  averageLoss: number;
  averageRisk: number;
  profitFactor: number | null;
  maxDrawdown: number;
  maxDrawdownPct: number;
  expectancy: number;
  currentOpenQuantity: number;
  currentAveragePrice: number;
  estimatedOpenRisk: number;
  equityCurve: Array<{ exitTime: string; equity: number }>;
  completed: CompletedTradeSummary[];
}

interface OpenLeg {
  side: "long" | "short";
  quantity: number;
  entryPrice: number;
  entryTime: string;
  entryFee: number;
}

export function buildExecutionAnalytics(
  trades: Trade[],
  config: Pick<AppConfig, "STOP_LOSS_PCT">
): ExecutionAnalytics {
  const orderedTrades = [...trades].sort(compareTradesAscending);
  const completed: CompletedTradeSummary[] = [];
  let openLeg: OpenLeg | null = null;
  let currentQuantity = 0;
  let currentAveragePrice = 0;
  let totalFees = 0;
  let totalVolume = 0;
  let grossPnl = 0;
  let netPnl = 0;
  let peakEquity = 0;
  let maxDrawdown = 0;
  const equityCurve: Array<{ exitTime: string; equity: number }> = [];

  for (const trade of orderedTrades) {
    totalFees += trade.fee;
    totalVolume += trade.price * trade.quantity;

    if (trade.side === "buy") {
      if (currentQuantity >= 0) {
        currentAveragePrice =
          currentQuantity + trade.quantity === 0
            ? 0
            : (currentQuantity * currentAveragePrice + trade.quantity * trade.price) /
              (currentQuantity + trade.quantity);
        currentQuantity += trade.quantity;

        if (currentQuantity > 0) {
          openLeg = {
            side: "long",
            quantity: currentQuantity,
            entryPrice: currentAveragePrice,
            entryTime: resolveEntryTime(openLeg, "long", trade.executedAt),
            entryFee: resolveEntryFee(openLeg, "long", trade.fee)
          };
        }
      } else {
        const closingQuantity = Math.min(trade.quantity, Math.abs(currentQuantity));
        const tradeGross = (currentAveragePrice - trade.price) * closingQuantity;
        const tradeNet = tradeGross - ((openLeg?.entryFee ?? 0) + trade.fee);
        const tradeRisk = calculateRiskAmount(currentAveragePrice, closingQuantity, config.STOP_LOSS_PCT);

        completed.push({
          entryTime: openLeg?.entryTime ?? trade.executedAt,
          exitTime: trade.executedAt,
          side: "short",
          quantity: closingQuantity,
          entryPrice: currentAveragePrice,
          exitPrice: trade.price,
          entryNotional: roundToCents(currentAveragePrice * closingQuantity),
          exitNotional: roundToCents(trade.price * closingQuantity),
          grossPnl: roundToCents(tradeGross),
          fees: roundToCents((openLeg?.entryFee ?? 0) + trade.fee),
          netPnl: roundToCents(tradeNet),
          returnPct: roundToBasisPoints((tradeNet / (currentAveragePrice * closingQuantity)) * 100),
          riskAmount: tradeRisk,
          rMultiple: tradeRisk > 0 ? roundToBasisPoints(tradeNet / tradeRisk) : null,
          durationMinutes: calculateDurationMinutes(openLeg?.entryTime ?? trade.executedAt, trade.executedAt)
        });

        grossPnl += tradeGross;
        netPnl += tradeNet;
        peakEquity = Math.max(peakEquity, netPnl);
        maxDrawdown = Math.max(maxDrawdown, peakEquity - netPnl);
        equityCurve.push({ exitTime: trade.executedAt, equity: roundToCents(netPnl) });
        currentQuantity += trade.quantity;

        if (currentQuantity === 0) {
          currentAveragePrice = 0;
          openLeg = null;
        }
      }
    } else {
      if (currentQuantity <= 0) {
        currentAveragePrice =
          Math.abs(currentQuantity) + trade.quantity === 0
            ? 0
            : (Math.abs(currentQuantity) * currentAveragePrice + trade.quantity * trade.price) /
              (Math.abs(currentQuantity) + trade.quantity);
        currentQuantity -= trade.quantity;

        if (currentQuantity < 0) {
          openLeg = {
            side: "short",
            quantity: Math.abs(currentQuantity),
            entryPrice: currentAveragePrice,
            entryTime: resolveEntryTime(openLeg, "short", trade.executedAt),
            entryFee: resolveEntryFee(openLeg, "short", trade.fee)
          };
        }
      } else {
        const closingQuantity = Math.min(trade.quantity, currentQuantity);
        const tradeGross = (trade.price - currentAveragePrice) * closingQuantity;
        const tradeNet = tradeGross - ((openLeg?.entryFee ?? 0) + trade.fee);
        const tradeRisk = calculateRiskAmount(currentAveragePrice, closingQuantity, config.STOP_LOSS_PCT);

        completed.push({
          entryTime: openLeg?.entryTime ?? trade.executedAt,
          exitTime: trade.executedAt,
          side: "long",
          quantity: closingQuantity,
          entryPrice: currentAveragePrice,
          exitPrice: trade.price,
          entryNotional: roundToCents(currentAveragePrice * closingQuantity),
          exitNotional: roundToCents(trade.price * closingQuantity),
          grossPnl: roundToCents(tradeGross),
          fees: roundToCents((openLeg?.entryFee ?? 0) + trade.fee),
          netPnl: roundToCents(tradeNet),
          returnPct: roundToBasisPoints((tradeNet / (currentAveragePrice * closingQuantity)) * 100),
          riskAmount: tradeRisk,
          rMultiple: tradeRisk > 0 ? roundToBasisPoints(tradeNet / tradeRisk) : null,
          durationMinutes: calculateDurationMinutes(openLeg?.entryTime ?? trade.executedAt, trade.executedAt)
        });

        grossPnl += tradeGross;
        netPnl += tradeNet;
        peakEquity = Math.max(peakEquity, netPnl);
        maxDrawdown = Math.max(maxDrawdown, peakEquity - netPnl);
        equityCurve.push({ exitTime: trade.executedAt, equity: roundToCents(netPnl) });
        currentQuantity -= trade.quantity;

        if (currentQuantity === 0) {
          currentAveragePrice = 0;
          openLeg = null;
        }
      }
    }
  }

  const winningTrades = completed.filter((trade) => trade.netPnl > 0);
  const losingTrades = completed.filter((trade) => trade.netPnl < 0);
  const totalEntryNotional = completed.reduce((sum, trade) => sum + trade.entryNotional, 0);
  const totalRisk = completed.reduce((sum, trade) => sum + trade.riskAmount, 0);
  const averageWinAmount =
    winningTrades.length === 0
      ? 0
      : winningTrades.reduce((sum, trade) => sum + trade.netPnl, 0) / winningTrades.length;
  const averageLossMagnitude =
    losingTrades.length === 0
      ? 0
      : Math.abs(losingTrades.reduce((sum, trade) => sum + trade.netPnl, 0) / losingTrades.length);
  const grossLossMagnitude = Math.abs(
    roundToCents(losingTrades.reduce((sum, trade) => sum + trade.netPnl, 0))
  );
  const winRateRatio = completed.length === 0 ? 0 : winningTrades.length / completed.length;
  const lossRateRatio = completed.length === 0 ? 0 : losingTrades.length / completed.length;

  return {
    totalTrades: orderedTrades.length,
    completedTrades: completed.length,
    winningTrades: winningTrades.length,
    losingTrades: losingTrades.length,
    winRatePct:
      completed.length === 0 ? 0 : roundToBasisPoints((winningTrades.length / completed.length) * 100),
    totalVolume: roundToCents(totalVolume),
    totalFees: roundToCents(totalFees),
    grossPnl: roundToCents(grossPnl),
    netPnl: roundToCents(netPnl),
    netReturnPct:
      totalEntryNotional === 0 ? 0 : roundToBasisPoints((netPnl / totalEntryNotional) * 100),
    averageWin:
      winningTrades.length === 0
        ? 0
        : roundToCents(winningTrades.reduce((sum, trade) => sum + trade.netPnl, 0) / winningTrades.length),
    averageLoss:
      losingTrades.length === 0
        ? 0
        : roundToCents(losingTrades.reduce((sum, trade) => sum + trade.netPnl, 0) / losingTrades.length),
    averageRisk: completed.length === 0 ? 0 : roundToCents(totalRisk / completed.length),
    profitFactor:
      grossLossMagnitude === 0
        ? winningTrades.length > 0
          ? null
          : 0
        : roundToBasisPoints(
            winningTrades.reduce((sum, trade) => sum + trade.netPnl, 0) / grossLossMagnitude
          ),
    maxDrawdown: roundToCents(maxDrawdown),
    maxDrawdownPct:
      peakEquity <= 0 ? 0 : roundToBasisPoints((maxDrawdown / peakEquity) * 100),
    expectancy: roundToCents(winRateRatio * averageWinAmount - lossRateRatio * averageLossMagnitude),
    currentOpenQuantity: roundToBasisPoints(currentQuantity),
    currentAveragePrice: roundToBasisPoints(currentAveragePrice),
    estimatedOpenRisk: roundToCents(
      calculateRiskAmount(currentAveragePrice, Math.abs(currentQuantity), config.STOP_LOSS_PCT)
    ),
    equityCurve,
    completed
  };
}

function compareTradesAscending(left: Trade, right: Trade) {
  const timeDifference = Date.parse(left.executedAt) - Date.parse(right.executedAt);
  if (timeDifference !== 0) {
    return timeDifference;
  }

  return left.id - right.id;
}

function resolveEntryTime(
  openLeg: OpenLeg | null,
  expectedSide: OpenLeg["side"],
  fallbackTime: string
) {
  return openLeg !== null && openLeg.side === expectedSide ? openLeg.entryTime : fallbackTime;
}

function resolveEntryFee(openLeg: OpenLeg | null, expectedSide: OpenLeg["side"], nextFee: number) {
  return (openLeg !== null && openLeg.side === expectedSide ? openLeg.entryFee : 0) + nextFee;
}

function calculateRiskAmount(entryPrice: number, quantity: number, stopLossPct: number) {
  return roundToCents(entryPrice * quantity * stopLossPct);
}

function calculateDurationMinutes(entryTime: string, exitTime: string) {
  return roundToBasisPoints((Date.parse(exitTime) - Date.parse(entryTime)) / 60_000);
}

function roundToCents(value: number) {
  return Math.round(value * 100) / 100;
}

function roundToBasisPoints(value: number) {
  return Math.round(value * 10_000) / 10_000;
}
