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

  process.on("SIGINT", () => {
    logger.info("Closing market data and database connections");
    marketClient.stop();
    candleService.stop();
    database.close();
    process.exit(0);
  });

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

  app.listen(config.PORT, () => {
    logger.info(
      { port: config.PORT, dbPath: config.DB_PATH, symbol: config.MARKET_SYMBOL },
      "Server listening"
    );
  });
}

main().catch((error) => {
  console.error("Failed to start server", error);
  process.exit(1);
});
