import type { DatabaseConnection } from "../database.js";

export interface NewTrade {
  orderId?: number | null;
  symbol: string;
  side: "buy" | "sell";
  quantity: number;
  price: number;
  fee?: number;
  executedAt?: string;
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
    INSERT INTO trades (order_id, symbol, side, quantity, price, fee, executed_at)
    VALUES (@orderId, @symbol, @side, @quantity, @price, @fee, COALESCE(@executedAt, CURRENT_TIMESTAMP))
  `);
  const listRecent = database.prepare(`
    SELECT * FROM trades
    WHERE symbol = ?
    ORDER BY executed_at DESC, id DESC
    LIMIT ?
  `);
  const listAll = database.prepare(`
    SELECT * FROM trades
    WHERE symbol = ?
    ORDER BY executed_at ASC, id ASC
  `);
  const findMostRecent = database.prepare(`
    SELECT * FROM trades
    WHERE symbol = ?
    ORDER BY executed_at DESC, id DESC
    LIMIT 1
  `);

  return {
    create(trade: NewTrade): number {
      const result = insert.run({
        ...trade,
        orderId: trade.orderId ?? null,
        fee: trade.fee ?? 0,
        executedAt: trade.executedAt ?? null
      });
      return Number(result.lastInsertRowid);
    },
    listRecent(symbol: string, limit = 100): Trade[] {
      return (listRecent.all(symbol, limit) as TradeRow[]).map(mapTrade);
    },
    listAll(symbol: string): Trade[] {
      return (listAll.all(symbol) as TradeRow[]).map(mapTrade);
    },
    findMostRecent(symbol: string): Trade | null {
      const row = findMostRecent.get(symbol) as TradeRow | undefined;
      return row ? mapTrade(row) : null;
    }
  };
}

export type TradeRepository = ReturnType<typeof createTradeRepository>;
