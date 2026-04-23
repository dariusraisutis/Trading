import { validatePeriod } from "./moving-averages.js";

export function rollingHigh(values: number[], period: number): Array<number | null> {
  return rollingWindow(values, period, (window) => Math.max(...window));
}

export function rollingLow(values: number[], period: number): Array<number | null> {
  return rollingWindow(values, period, (window) => Math.min(...window));
}

export function rollingStdDev(values: number[], period: number): Array<number | null> {
  return rollingWindow(values, period, (window) => {
    const mean = window.reduce((sum, value) => sum + value, 0) / period;
    const variance =
      window.reduce((sum, value) => sum + (value - mean) ** 2, 0) / period;

    return Math.sqrt(variance);
  });
}

function rollingWindow(
  values: number[],
  period: number,
  calculate: (window: number[]) => number
): Array<number | null> {
  validatePeriod(period);

  return values.map((_, index) => {
    if (index < period - 1) {
      return null;
    }

    return calculate(values.slice(index - period + 1, index + 1));
  });
}
