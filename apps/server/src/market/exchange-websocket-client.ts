import type pino from "pino";

import type { AppConfig } from "../config/env.js";
import type { MarketDataStore } from "./store.js";
import type { NormalizedMarketEvent } from "./types.js";

interface WebSocketLike {
  onopen: ((event?: unknown) => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
  onclose: ((event?: unknown) => void) | null;
  onerror: ((error: unknown) => void) | null;
  send(data: string): void;
  close(): void;
}

type WebSocketConstructor = new (url: string) => WebSocketLike;

interface ExchangeWebSocketClientOptions {
  config: Pick<AppConfig, "MARKET_SYMBOL" | "MARKET_WS_URL" | "MARKET_RECONNECT_MS">;
  logger: pino.Logger;
  store: MarketDataStore;
  onMarketEvent?: (event: NormalizedMarketEvent) => void;
  webSocketFactory?: WebSocketConstructor;
}

export class ExchangeWebSocketClient {
  private socket: WebSocketLike | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private stopped = true;

  constructor(private readonly options: ExchangeWebSocketClientOptions) {}

  start() {
    if (!this.stopped) {
      return;
    }

    this.stopped = false;
    this.connect();
  }

  stop() {
    this.stopped = true;

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    this.socket?.close();
    this.socket = null;
  }

  private connect() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    const SocketFactory = (this.options.webSocketFactory ??
      globalThis.WebSocket) as WebSocketConstructor | undefined;

    if (!SocketFactory) {
      this.options.logger.warn("No WebSocket implementation is available");
      return;
    }

    const socket = new SocketFactory(this.options.config.MARKET_WS_URL);
    this.socket = socket;

    socket.onopen = () => {
      this.reconnectTimer = null;
      const symbol = this.options.config.MARKET_SYMBOL.toLowerCase();
      socket.send(
        JSON.stringify({
          method: "SUBSCRIBE",
          params: [`${symbol}@ticker`, `${symbol}@trade`],
          id: 1
        })
      );
      this.options.logger.info(
        { symbol: this.options.config.MARKET_SYMBOL },
        "Subscribed to market data"
      );
    };

    socket.onmessage = (event) => {
      const message = typeof event.data === "string" ? event.data : String(event.data);
      const marketEvent = normalizeMarketMessage(message);

      if (!marketEvent) {
        return;
      }

      const snapshot = this.options.store.update(marketEvent);
      this.options.onMarketEvent?.(marketEvent);
      this.options.logger.debug({ marketEvent: snapshot }, "Market price updated");
    };

    socket.onerror = (error) => {
      this.options.logger.error({ err: error }, "Market data WebSocket error");
    };

    socket.onclose = () => {
      this.socket = null;
      this.options.logger.warn("Market data WebSocket disconnected");

      if (!this.stopped) {
        this.reconnectTimer = setTimeout(
          () => this.connect(),
          this.options.config.MARKET_RECONNECT_MS
        );
      }
    };
  }
}

export function normalizeMarketMessage(rawMessage: string): NormalizedMarketEvent | null {
  let parsed: unknown;

  try {
    parsed = JSON.parse(rawMessage);
  } catch {
    return null;
  }

  if (!isRecord(parsed)) {
    return null;
  }

  const payload = isRecord(parsed.data) ? parsed.data : parsed;
  const eventType = typeof payload.e === "string" ? payload.e : null;

  if (eventType === "24hrTicker") {
    return normalizeTicker(payload);
  }

  if (eventType === "trade") {
    return normalizeTrade(payload);
  }

  return null;
}

function normalizeTicker(payload: Record<string, unknown>): NormalizedMarketEvent | null {
  const symbol = readSymbol(payload);
  const price = readNumber(payload.c);
  const eventTime = readNumber(payload.E);

  if (!symbol || price === null || eventTime === null) {
    return null;
  }

  return {
    type: "ticker",
    symbol,
    price,
    eventTime
  };
}

function normalizeTrade(payload: Record<string, unknown>): NormalizedMarketEvent | null {
  const symbol = readSymbol(payload);
  const price = readNumber(payload.p);
  const quantity = readNumber(payload.q);
  const tradeId = readNumber(payload.t);
  const eventTime = readNumber(payload.E);

  if (!symbol || price === null || quantity === null || tradeId === null || eventTime === null) {
    return null;
  }

  return {
    type: "trade",
    symbol,
    price,
    quantity,
    tradeId,
    eventTime
  };
}

function readSymbol(payload: Record<string, unknown>): string | null {
  return typeof payload.s === "string" ? payload.s.toUpperCase() : null;
}

function readNumber(value: unknown): number | null {
  const numberValue = typeof value === "number" ? value : Number(value);
  return Number.isFinite(numberValue) ? numberValue : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
