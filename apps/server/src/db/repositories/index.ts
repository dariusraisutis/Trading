import type { DatabaseConnection } from "../database.js";

import { createCandleRepository } from "./candles.js";
import { createOrderRepository } from "./orders.js";
import { createPositionControlRepository } from "./position-controls.js";
import { createPositionRepository } from "./positions.js";
import { createSignalRepository } from "./signals.js";
import { createTradeRepository } from "./trades.js";

export function createRepositories(database: DatabaseConnection) {
  return {
    candles: createCandleRepository(database),
    signals: createSignalRepository(database),
    orders: createOrderRepository(database),
    trades: createTradeRepository(database),
    positionControls: createPositionControlRepository(database),
    positions: createPositionRepository(database)
  };
}
