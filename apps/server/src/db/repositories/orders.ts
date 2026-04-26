import type { DatabaseConnection } from "../database.js";

export interface NewOrder {
  symbol: string;
  side: "buy" | "sell";
  type: string;
  quantity: number;
  price?: number | null;
  exchangeOrderId?: string | null;
  status: string;
  mode: string;
}

export interface Order extends NewOrder {
  id: number;
  price: number | null;
  exchangeOrderId: string | null;
  createdAt: string;
  updatedAt: string;
}

interface OrderRow {
  id: number;
  symbol: string;
  side: "buy" | "sell";
  type: string;
  quantity: number;
  price: number | null;
  exchange_order_id: string | null;
  status: string;
  mode: string;
  created_at: string;
  updated_at: string;
}

function mapOrder(row: OrderRow): Order {
  return {
    id: row.id,
    symbol: row.symbol,
    side: row.side,
    type: row.type,
    quantity: row.quantity,
    price: row.price,
    exchangeOrderId: row.exchange_order_id,
    status: row.status,
    mode: row.mode,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export function createOrderRepository(database: DatabaseConnection) {
  const insert = database.prepare(`
    INSERT INTO orders (symbol, side, type, quantity, price, exchange_order_id, status, mode)
    VALUES (@symbol, @side, @type, @quantity, @price, @exchangeOrderId, @status, @mode)
  `);
  const listRecent = database.prepare(`
    SELECT * FROM orders
    WHERE symbol = ?
    ORDER BY created_at DESC, id DESC
    LIMIT ?
  `);

  return {
    create(order: NewOrder): number {
      const result = insert.run({
        ...order,
        price: order.price ?? null,
        exchangeOrderId: order.exchangeOrderId ?? null
      });
      return Number(result.lastInsertRowid);
    },
    listRecent(symbol: string, limit = 100): Order[] {
      return (listRecent.all(symbol, limit) as OrderRow[]).map(mapOrder);
    }
  };
}

export type OrderRepository = ReturnType<typeof createOrderRepository>;
