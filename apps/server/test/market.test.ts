import { describe, expect, it, vi } from "vitest";

import { loadConfig } from "../src/config/env.js";
import { createLogger } from "../src/logger.js";
import {
  ExchangeWebSocketClient,
  normalizeMarketMessage
} from "../src/market/exchange-websocket-client.js";
import { MarketDataStore } from "../src/market/store.js";

class FakeWebSocket {
  static instances: FakeWebSocket[] = [];

  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: ((error: unknown) => void) | null = null;
  sent: string[] = [];

  constructor(readonly url: string) {
    FakeWebSocket.instances.push(this);
  }

  send(data: string) {
    this.sent.push(data);
  }

  close() {
    this.onclose?.();
  }

  open() {
    this.onopen?.();
  }

  message(data: string) {
    this.onmessage?.({ data });
  }

  disconnect() {
    this.onclose?.();
  }
}

function createClient(store: MarketDataStore) {
  const config = loadConfig({
    MARKET_SYMBOL: "BTCUSDT",
    MARKET_WS_URL: "wss://example.test/ws",
    MARKET_RECONNECT_MS: "100",
    MARKET_DATA_ENABLED: "false",
    LOG_LEVEL: "silent"
  });

  return new ExchangeWebSocketClient({
    config,
    logger: createLogger(config),
    store,
    webSocketFactory: FakeWebSocket
  });
}

describe("market data", () => {
  it("normalizes Binance ticker and trade events", () => {
    expect(
      normalizeMarketMessage(
        JSON.stringify({
          e: "24hrTicker",
          E: 1,
          s: "btcusdt",
          c: "101.50"
        })
      )
    ).toEqual({
      type: "ticker",
      symbol: "BTCUSDT",
      price: 101.5,
      eventTime: 1
    });

    expect(
      normalizeMarketMessage(
        JSON.stringify({
          stream: "btcusdt@trade",
          data: {
            e: "trade",
            E: 2,
            s: "BTCUSDT",
            t: 42,
            p: "102.25",
            q: "0.5"
          }
        })
      )
    ).toEqual({
      type: "trade",
      symbol: "BTCUSDT",
      price: 102.25,
      quantity: 0.5,
      tradeId: 42,
      eventTime: 2
    });
  });

  it("subscribes and stores the current price in memory", () => {
    FakeWebSocket.instances = [];
    const store = new MarketDataStore();
    const client = createClient(store);

    client.start();
    const socket = FakeWebSocket.instances[0];
    socket.open();
    socket.message(
      JSON.stringify({
        e: "trade",
        E: 1_766_880_000_000,
        s: "BTCUSDT",
        t: 10,
        p: "123.45",
        q: "0.1"
      })
    );

    expect(JSON.parse(socket.sent[0])).toEqual({
      method: "SUBSCRIBE",
      params: ["btcusdt@ticker", "btcusdt@trade"],
      id: 1
    });
    expect(store.getPrice("BTCUSDT")).toMatchObject({
      symbol: "BTCUSDT",
      price: 123.45,
      source: "trade"
    });

    client.stop();
  });

  it("reconnects after disconnect", async () => {
    vi.useFakeTimers();
    FakeWebSocket.instances = [];
    const store = new MarketDataStore();
    const client = createClient(store);

    client.start();
    FakeWebSocket.instances[0].disconnect();
    await vi.advanceTimersByTimeAsync(100);

    expect(FakeWebSocket.instances).toHaveLength(2);

    client.stop();
    vi.useRealTimers();
  });
});
