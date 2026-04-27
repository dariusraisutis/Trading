import { createApp } from "./app.js";
import { BotControlService } from "./bot/control-service.js";
import { loadConfig } from "./config/env.js";
import { openDatabase } from "./db/database.js";
import { createRepositories } from "./db/repositories/index.js";
import { CcxtLiveExchangeAdapter, LiveTradingService } from "./execution/live-trading.js";
import { PaperTradingService } from "./execution/paper-trading.js";
import { createLogger } from "./logger.js";
import { CandleService } from "./market/candle-service.js";
import { ExchangeWebSocketClient } from "./market/exchange-websocket-client.js";
import { MarketDataStore } from "./market/store.js";
import { ReplayService } from "./replay/service.js";
import { recoverRuntimeState } from "./runtime-state.js";
import { StrategyService } from "./strategy/service.js";

async function main() {
  const config = loadConfig();
  const logger = createLogger(config);
  const database = openDatabase(config);
  const repositories = createRepositories(database);
  const botControlService = new BotControlService();
  const marketStore = new MarketDataStore();
  const executionService =
    config.TRADING_MODE === "live"
      ? new LiveTradingService(
          config,
          new CcxtLiveExchangeAdapter(config, logger),
          marketStore,
          repositories.orders,
          repositories.trades,
          repositories.positions,
          logger,
          botControlService
        )
      : new PaperTradingService(
          config,
          marketStore,
          repositories.orders,
          repositories.trades,
          repositories.positions,
          logger,
          botControlService
        );
  const strategyService = new StrategyService(
    repositories.candles,
    repositories.signals,
    logger,
    undefined,
    botControlService,
    (signal) => executionService.handleSignal(signal)
  );
  const candleService = new CandleService(repositories.candles, logger, (candle) => {
    executionService.handleProtectiveExit(candle);
    strategyService.evaluateClosedCandle(candle);
  });
  const replayService = new ReplayService(
    config,
    logger,
    marketStore,
    repositories.candles,
    strategyService,
    (candle) => executionService.handleProtectiveExit(candle)
  );
  const marketClient = new ExchangeWebSocketClient({
    config,
    logger,
    store: marketStore,
    onMarketEvent: (event) => candleService.handleMarketEvent(event)
  });
  const app = createApp(config, logger, {
    botControlService,
    marketStore,
    candleRepository: repositories.candles,
    signalRepository: repositories.signals,
    orderRepository: repositories.orders,
    tradeRepository: repositories.trades,
    positionRepository: repositories.positions,
    replayService
  });
  const recoveredState = recoverRuntimeState(config.MARKET_SYMBOL, {
    candleRepository: repositories.candles,
    tradeRepository: repositories.trades,
    positionRepository: repositories.positions,
    marketStore,
    logger
  });
  let shuttingDown = false;
  let httpServer: ReturnType<typeof app.listen> | null = null;

  const shutdown = (reason: string, exitCode = 0, error?: unknown) => {
    if (shuttingDown) {
      return;
    }

    shuttingDown = true;

    if (error) {
      logger.error({ err: error, reason }, "Server shutting down after runtime failure");
    } else {
      logger.info({ reason }, "Server shutting down gracefully");
    }

    replayService.stop();
    marketClient.stop();
    candleService.stop();
    let finalized = false;

    const finish = () => {
      if (finalized) {
        return;
      }

      finalized = true;

      try {
        database.close();
      } finally {
        process.exit(exitCode);
      }
    };

    if (httpServer) {
      httpServer.close(() => finish());
      setTimeout(() => finish(), 5_000).unref();
      return;
    }

    finish();
  };

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("unhandledRejection", (error) => shutdown("unhandledRejection", 1, error));
  process.on("uncaughtException", (error) => shutdown("uncaughtException", 1, error));

  candleService.start();

  if (config.TRADING_MODE === "replay") {
    logger.info(
      { csvPath: config.REPLAY_CSV_PATH, intervalMs: config.REPLAY_INTERVAL_MS },
      "Replay mode enabled"
    );

    if (config.REPLAY_AUTO_START) {
      replayService.start();
    }
  } else if (config.MARKET_DATA_ENABLED) {
    marketClient.start();
  } else {
    logger.info("Market data WebSocket startup disabled");
  }

  httpServer = app.listen(config.PORT, () => {
    logger.info(
      {
        port: config.PORT,
        dbPath: config.DB_PATH,
        symbol: config.MARKET_SYMBOL,
        recoveredRuntimeState: recoveredState
      },
      "Server listening"
    );
  });
}

main().catch((error) => {
  console.error("Failed to start server", error);
  process.exit(1);
});
