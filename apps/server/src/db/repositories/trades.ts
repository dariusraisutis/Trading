import type { DatabaseConnection } from "../database.js";

export interface NewTrade {
  orderId?: number | null;
  symbol: string;
  side: "buy" | "sell";
  quantity: number;
  price: number;
  fee?: number;
}

export interface Trade extends NewTrade {
  id: number;
  orderId: number | null;
  fee: number;
  executedAt: string;
}

interface TradeRow {
  id: number;
  order_id: number | null;
  symbol: string;
  side: "buy" | "sell";
  quantity: number;
  price: number;
  fee: number;
  executed_at: string;
}

function mapTrade(row: TradeRow): Trade {
  return {
    id: row.id,
    orderId: row.order_id,
    symbol: row.symbol,
    side: row.side,
    quantity: row.quantity,
    price: row.price,
    fee: row.fee,
    executedAt: row.executed_at
  };
}

export function createTradeRepository(database: DatabaseConnection) {
  const insert = database.prepare(`
    INSERT INTO trades (order_id, symbol, side, quantity, price, fee)
    VALUES (@orderId, @symbol, @side, @quantity, @price, @fee)
  `);
  const listRecent = database.prepare(`
    SELECT * FROM trades
    WHERE symbol = ?
    ORDER BY executed_at DESC, id DESC
    LIMIT ?
  `);

  return {
    create(trade: NewTrade): number {
      const result = insert.run({
        ...trade,
        orderId: trade.orderId ?? null,
        fee: trade.fee ?? 0
      });
      return Number(result.lastInsertRowid);
    },
    listRecent(symbol: string, limit = 100): Trade[] {
      return (listRecent.all(symbol, limit) as TradeRow[]).map(mapTrade);
    }
  };
}

export type TradeRepository = ReturnType<typeof createTradeRepository>;
