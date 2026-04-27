import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import type pino from "pino";

import type { AppConfig } from "../config/env.js";
import type { CandleRepository, NewCandle, Candle } from "../db/repositories/candles.js";
import type { MarketDataStore } from "../market/store.js";
import type { StrategyService } from "../strategy/service.js";

export interface ReplayState {
  csvPath: string | null;
  loaded: boolean;
  running: boolean;
  completed: boolean;
  processedCandles: number;
  totalCandles: number;
  currentOpenTime: number | null;
  intervalMs: number;
  lastError: string | null;
}

export class ReplayService {
  private candles: NewCandle[] = [];
  private cursor = 0;
  private timer: ReturnType<typeof setInterval> | null = null;
  private state: ReplayState;

  constructor(
    private readonly config: Pick<
      AppConfig,
      "TRADING_MODE" | "MARKET_SYMBOL" | "REPLAY_CSV_PATH" | "REPLAY_INTERVAL_MS"
    >,
    private readonly logger: pino.Logger,
    private readonly marketStore: MarketDataStore,
    private readonly candleRepository: CandleRepository,
    private readonly strategyService: StrategyService,
    private readonly onCandleClosed?: (candle: Candle) => void
  ) {
    this.state = {
      csvPath: this.config.REPLAY_CSV_PATH || null,
      loaded: false,
      running: false,
      completed: false,
      processedCandles: 0,
      totalCandles: 0,
      currentOpenTime: null,
      intervalMs: this.config.REPLAY_INTERVAL_MS,
      lastError: null
    };
  }

  getState(): ReplayState {
    return { ...this.state };
  }

  start(): ReplayState {
    if (this.config.TRADING_MODE !== "replay") {
      return this.getState();
    }

    try {
      if (!this.state.loaded) {
        this.load();
      }

      if (!this.state.loaded || this.state.lastError) {
        return this.getState();
      }

      if (this.state.running || this.state.completed) {
        return this.getState();
      }

      this.state.running = true;

      if (this.state.totalCandles === 0) {
        this.finish();
        return this.getState();
      }

      if (this.config.REPLAY_INTERVAL_MS === 0) {
        while (this.state.running && this.cursor < this.candles.length) {
          this.processNext();
        }

        return this.getState();
      }

      this.timer = setInterval(() => {
        this.processNext();
      }, this.config.REPLAY_INTERVAL_MS);
    } catch (error) {
      this.fail(error);
    }

    return this.getState();
  }

  stop(): ReplayState {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }

    this.state.running = false;
    return this.getState();
  }

  load(): ReplayState {
    try {
      const csvPath = resolve(this.config.REPLAY_CSV_PATH);
      const content = readFileSync(csvPath, "utf8");

      this.candles = parseReplayCsv(content, this.config.MARKET_SYMBOL);
      this.cursor = 0;
      this.state = {
        ...this.state,
        csvPath,
        loaded: true,
        running: false,
        completed: false,
        processedCandles: 0,
        totalCandles: this.candles.length,
        currentOpenTime: null,
        lastError: null
      };

      this.logger.info(
        { csvPath, candles: this.candles.length, symbol: this.config.MARKET_SYMBOL },
        "Replay CSV loaded"
      );
    } catch (error) {
      this.fail(error);
    }

    return this.getState();
  }

  private processNext() {
    if (!this.state.running) {
      return;
    }

    try {
      const candle = this.candles[this.cursor];

      if (!candle) {
        this.finish();
        return;
      }

      const saved = this.candleRepository.create(candle);

      this.marketStore.update({
        type: "ticker",
        symbol: saved.symbol,
        price: saved.close,
        eventTime: saved.closeTime
      });
      this.onCandleClosed?.(saved);
      this.strategyService.evaluateClosedCandle(saved);

      this.cursor += 1;
      this.state.processedCandles = this.cursor;
      this.state.currentOpenTime = saved.openTime;

      this.logger.info(
        {
          replay: {
            processedCandles: this.state.processedCandles,
            totalCandles: this.state.totalCandles
          },
          candle: saved
        },
        "Replay candle processed"
      );

      if (this.cursor >= this.candles.length) {
        this.finish();
      }
    } catch (error) {
      this.fail(error);
    }
  }

  private finish() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }

    this.state.running = false;
    this.state.completed = true;
  }

  private fail(error: unknown) {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }

    this.state.running = false;
    this.state.completed = false;
    this.state.lastError = error instanceof Error ? error.message : String(error);
    this.logger.error({ err: error }, "Replay service failed");
  }
}

export function parseReplayCsv(content: string, defaultSymbol: string): NewCandle[] {
  const lines = content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  if (lines.length < 2) {
    throw new Error("Replay CSV must contain a header and at least one row");
  }

  const headerIndex = findReplayHeaderIndex(lines);

  if (headerIndex === -1 || headerIndex >= lines.length - 1) {
    throw new Error("Replay CSV must contain a valid header and at least one row");
  }

  const dataLines = lines.slice(headerIndex + 1);
  const headers = lines[headerIndex].split(",").map(normalizeHeader);
  const rows = dataLines.map((line, index) =>
    parseReplayRow(headers, line, defaultSymbol, dataLines[index + 1] ?? null)
  );

  return rows.sort((left, right) => left.openTime - right.openTime);
}

function parseReplayRow(
  headers: string[],
  line: string,
  defaultSymbol: string,
  nextLine: string | null
): NewCandle {
  const values = line.split(",").map((value) => value.trim());
  const row = new Map<string, string>();

  headers.forEach((header, index) => {
    row.set(header, values[index] ?? "");
  });

  const openTimeValue =
    getValue(row, ["opentime", "open_time", "time", "timestamp", "unix", "date"]) ?? "";
  const openTime = parseTimeValue(openTimeValue);
  const timeframe = inferTimeframe(row, nextLine ? parseReplayRowOpenTime(headers, nextLine) : null);
  const closeTimeValue = getValue(row, ["closetime", "close_time"]);
  const closeTime = closeTimeValue
    ? parseTimeValue(closeTimeValue)
    : openTime + getTimeframeDurationMs(timeframe) - 1;

  return {
    symbol: (getValue(row, ["symbol"]) ?? defaultSymbol).toUpperCase(),
    timeframe,
    openTime,
    closeTime,
    open: parseNumber(row.get("open"), "open"),
    high: parseNumber(row.get("high"), "high"),
    low: parseNumber(row.get("low"), "low"),
    close: parseNumber(row.get("close"), "close"),
    volume: parseNumber(
      getValue(row, ["volume", "volumebtc", "volumeeth", "basevolume", "volumebaseasset"]) ??
        undefined,
      "volume"
    )
  };
}

function getValue(row: Map<string, string>, keys: string[]) {
  for (const key of keys) {
    const value = row.get(key);

    if (value) {
      return value;
    }
  }

  return null;
}

function normalizeHeader(value: string) {
  return value.replace(/[^a-z0-9]/gi, "").toLowerCase();
}

function inferTimeframe(row: Map<string, string>, nextOpenTime: number | null) {
  const explicitValue = getValue(row, ["timeframe", "interval"]);

  if (explicitValue) {
    return normalizeTimeframe(explicitValue);
  }

  if (nextOpenTime !== null) {
    const openTimeValue =
      getValue(row, ["opentime", "open_time", "time", "timestamp", "unix", "date"]) ?? "";
    const currentOpenTime = parseTimeValue(openTimeValue);
    const gapMs = Math.abs(nextOpenTime - currentOpenTime);
    const inferredFromGap = inferTimeframeFromGap(gapMs);

    if (inferredFromGap) {
      return inferredFromGap;
    }
  }

  const dateValue = row.get("date");

  if (dateValue && /\d{1,2}:\d{2}/.test(dateValue)) {
    return "1h";
  }

  if (row.has("date")) {
    return "1d";
  }

  return "1m";
}

function parseReplayRowOpenTime(headers: string[], line: string) {
  const values = line.split(",").map((value) => value.trim());
  const row = new Map<string, string>();

  headers.forEach((header, index) => {
    row.set(header, values[index] ?? "");
  });

  const openTimeValue =
    getValue(row, ["opentime", "open_time", "time", "timestamp", "unix", "date"]) ?? "";

  return parseTimeValue(openTimeValue);
}

function inferTimeframeFromGap(gapMs: number) {
  const candidates = [
    { timeframe: "1m", durationMs: 60_000 },
    { timeframe: "5m", durationMs: 300_000 },
    { timeframe: "15m", durationMs: 900_000 },
    { timeframe: "30m", durationMs: 1_800_000 },
    { timeframe: "1h", durationMs: 3_600_000 },
    { timeframe: "4h", durationMs: 14_400_000 },
    { timeframe: "1d", durationMs: 86_400_000 },
    { timeframe: "1w", durationMs: 604_800_000 }
  ];

  return (
    candidates.find((candidate) => Math.abs(candidate.durationMs - gapMs) <= 1000)?.timeframe ??
    null
  );
}

function findReplayHeaderIndex(lines: string[]) {
  return lines.findIndex((line) => {
    const headers = line.split(",").map(normalizeHeader);
    const hasTime = headers.some((header) =>
      ["opentime", "open_time", "time", "timestamp", "unix", "date"].includes(header)
    );

    return hasTime && headers.includes("open") && headers.includes("high") && headers.includes("low") && headers.includes("close");
  });
}

function normalizeTimeframe(value: string) {
  const normalized = value.trim().toLowerCase();

  if (/^\d+[mhdw]$/.test(normalized)) {
    return normalized;
  }

  if (/^[mhdw]$/.test(normalized)) {
    return `1${normalized}`;
  }

  return normalized || "1m";
}

function parseNumber(value: string | undefined, field: string) {
  const parsed = Number(value);

  if (!Number.isFinite(parsed)) {
    throw new Error(`Invalid replay CSV value for ${field}`);
  }

  return parsed;
}

function getTimeframeDurationMs(timeframe: string) {
  const match = timeframe.match(/^(\d+)([mhdw])$/);

  if (!match) {
    return 60_000;
  }

  const amount = Number(match[1]);
  const unit = match[2];
  const multiplier =
    unit === "m"
      ? 60_000
      : unit === "h"
        ? 3_600_000
        : unit === "d"
          ? 86_400_000
          : 604_800_000;

  return amount * multiplier;
}

function parseTimeValue(value: string) {
  const numeric = Number(value);

  if (Number.isFinite(numeric) && value !== "") {
    if (numeric >= 1_000_000_000_000_000) {
      return Math.trunc(numeric / 1000);
    }

    return numeric < 1_000_000_000_000 ? numeric * 1000 : numeric;
  }

  const parsed = Date.parse(value);

  if (Number.isNaN(parsed)) {
    throw new Error("Invalid replay CSV time value");
  }

  return parsed;
}
