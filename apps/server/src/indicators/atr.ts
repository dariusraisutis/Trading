export function atr(
  highs: number[],
  lows: number[],
  closes: number[],
  period: number
): Array<number | null> {
  if (!Number.isInteger(period) || period <= 0) {
    throw new Error("ATR period must be a positive integer");
  }

  if (highs.length !== lows.length || lows.length !== closes.length) {
    throw new Error("ATR inputs must have the same length");
  }

  if (highs.length === 0) {
    return [];
  }

  const trueRanges = highs.map((high, index) => {
    if (index === 0) {
      return high - lows[index];
    }

    const previousClose = closes[index - 1];

    return Math.max(
      high - lows[index],
      Math.abs(high - previousClose),
      Math.abs(lows[index] - previousClose)
    );
  });
  const result: Array<number | null> = Array.from({ length: highs.length }, () => null);

  if (trueRanges.length < period) {
    return result;
  }

  let currentAtr =
    trueRanges.slice(0, period).reduce((sum, value) => sum + value, 0) / period;
  result[period - 1] = currentAtr;

  for (let index = period; index < trueRanges.length; index += 1) {
    currentAtr = (currentAtr * (period - 1) + trueRanges[index]) / period;
    result[index] = currentAtr;
  }

  return result;
}
