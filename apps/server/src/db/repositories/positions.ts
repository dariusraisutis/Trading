import type { DatabaseConnection } from "../database.js";

export interface Position {
  symbol: string;
  quantity: number;
  averagePrice: number;
  realizedPnl: number;
}

export function createPositionRepository(database: DatabaseConnection) {
  const upsert = database.prepare(`
    INSERT INTO positions (symbol, quantity, average_price, realized_pnl)
    VALUES (@symbol, @quantity, @averagePrice, @realizedPnl)
    ON CONFLICT(symbol) DO UPDATE SET
      quantity = excluded.quantity,
      average_price = excluded.average_price,
      realized_pnl = excluded.realized_pnl,
      updated_at = CURRENT_TIMESTAMP
  `);
  const findBySymbol = database.prepare(`
    SELECT symbol, quantity, average_price as averagePrice, realized_pnl as realizedPnl
    FROM positions
    WHERE symbol = ?
  `);

  return {
    upsert(position: Position): void {
      upsert.run(position);
    },
    findBySymbol(symbol: string): Position | null {
      return (findBySymbol.get(symbol) as Position | undefined) ?? null;
    }
  };
}

export type PositionRepository = ReturnType<typeof createPositionRepository>;
