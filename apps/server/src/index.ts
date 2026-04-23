import { createApp } from "./app.js";
import { loadConfig } from "./config/env.js";
import { openDatabase } from "./db/database.js";
import { createRepositories } from "./db/repositories/index.js";
import { PaperTradingService } from "./execution/paper-trading.js";
import { createLogger } from "./logger.js";
import { CandleService } from "./market/candle-service.js";
import { ExchangeWebSocketClient } from "./market/exchange-websocket-client.js";
import { MarketDataStore } from "./market/store.js";
import { StrategyService } from "./strategy/service.js";

async function main() {
  const config = loadConfig();
  const logger = createLogger(config);
  const database = openDatabase(config);
  const repositories = createRepositories(database);
  const marketStore = new MarketDataStore();
  const paperTradingService = new PaperTradingService(
    config,
    marketStore,
    repositories.orders,
    repositories.trades,
    repositories.positions,
    logger
  );
  const strategyService = new StrategyService(
    repositories.candles,
    repositories.signals,
    logger,
    undefined,
    (signal) => paperTradingService.handleSignal(signal)
  );
  const candleService = new CandleService(repositories.candles, logger, (candle) =>
    strategyService.evaluateClosedCandle(candle)
  );
  const marketClient = new ExchangeWebSocketClient({
    config,
    logger,
    store: marketStore,
    onMarketEvent: (event) => candleService.handleMarketEvent(event)
  });
  const app = createApp(config, logger, {
    marketStore,
    candleRepository: repositories.candles,
    signalRepository: repositories.signals,
    orderRepository: repositories.orders,
    tradeRepository: repositories.trades,
    positionRepository: repositories.positions
  });

  process.on("SIGINT", () => {
    logger.info("Closing market data and database connections");
    marketClient.stop();
    candleService.stop();
    database.close();
    process.exit(0);
  });

  candleService.start();

  if (config.MARKET_DATA_ENABLED) {
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
