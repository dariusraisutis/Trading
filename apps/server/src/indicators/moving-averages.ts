export function sma(values: number[], period: number): Array<number | null> {
  validatePeriod(period);

  const result: Array<number | null> = [];
  let sum = 0;

  for (let index = 0; index < values.length; index += 1) {
    sum += values[index];

    if (index >= period) {
      sum -= values[index - period];
    }

    result.push(index >= period - 1 ? sum / period : null);
  }

  return result;
}

export function ema(values: number[], period: number): Array<number | null> {
  validatePeriod(period);

  const result: Array<number | null> = Array(values.length).fill(null);

  if (values.length < period) {
    return result;
  }

  const multiplier = 2 / (period + 1);
  let previousEma = values.slice(0, period).reduce((sum, value) => sum + value, 0) / period;
  result[period - 1] = previousEma;

  for (let index = period; index < values.length; index += 1) {
    previousEma = (values[index] - previousEma) * multiplier + previousEma;
    result[index] = previousEma;
  }

  return result;
}

export function validatePeriod(period: number) {
  if (!Number.isInteger(period) || period <= 0) {
    throw new Error("Indicator period must be a positive integer");
  }
}
