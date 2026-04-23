import { sma } from "./moving-averages.js";
import { rollingStdDev } from "./rolling.js";

export function zScore(values: number[], period: number): Array<number | null> {
  const means = sma(values, period);
  const deviations = rollingStdDev(values, period);

  return values.map((value, index) => {
    const mean = means[index];
    const deviation = deviations[index];

    if (mean === null || deviation === null || deviation === 0) {
      return null;
    }

    return (value - mean) / deviation;
  });
}
