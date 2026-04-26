import { describe, expect, it } from "vitest";

import { atr, ema, rollingHigh, rollingLow, rollingStdDev, rsi, sma, zScore } from "../src/indicators/index.js";

function roundSeries(values: Array<number | null>, digits = 4): Array<number | null> {
  return values.map((value) => (value === null ? null : Number(value.toFixed(digits))));
}

describe("indicators", () => {
  it("calculates SMA", () => {
    expect(sma([1, 2, 3, 4, 5], 3)).toEqual([null, null, 2, 3, 4]);
  });

  it("calculates EMA seeded from the first SMA", () => {
    expect(roundSeries(ema([1, 2, 3, 4, 5], 3))).toEqual([null, null, 2, 3, 4]);
    expect(roundSeries(ema([10, 11, 13, 12, 14], 3))).toEqual([
      null,
      null,
      11.3333,
      11.6667,
      12.8333
    ]);
  });

  it("calculates rolling highs and lows", () => {
    const values = [5, 3, 7, 6, 2];

    expect(rollingHigh(values, 3)).toEqual([null, null, 7, 7, 7]);
    expect(rollingLow(values, 3)).toEqual([null, null, 3, 3, 2]);
  });

  it("calculates population standard deviation", () => {
    expect(roundSeries(rollingStdDev([2, 4, 4, 4, 5], 3))).toEqual([
      null,
      null,
      0.9428,
      0,
      0.4714
    ]);
  });

  it("calculates z-score and returns null when deviation is zero", () => {
    expect(roundSeries(zScore([1, 2, 3, 4, 5], 3))).toEqual([
      null,
      null,
      1.2247,
      1.2247,
      1.2247
    ]);
    expect(zScore([4, 4, 4], 3)).toEqual([null, null, null]);
  });

  it("calculates RSI", () => {
    expect(roundSeries(rsi([100, 102, 101, 103, 102, 104], 3))).toEqual([
      null,
      null,
      null,
      80,
      61.5385,
      77.2727
    ]);
  });

  it("calculates ATR", () => {
    expect(roundSeries(atr([10, 12, 11], [8, 9, 9], [9, 11, 10], 2))).toEqual([
      null,
      2.5,
      2.25
    ]);
  });

  it("rejects invalid periods", () => {
    expect(() => sma([1, 2, 3], 0)).toThrow("positive integer");
    expect(() => ema([1, 2, 3], 1.5)).toThrow("positive integer");
    expect(() => rsi([1, 2, 3], 0)).toThrow("positive integer");
    expect(() => atr([1], [0], [1], 0)).toThrow("positive integer");
  });
});
