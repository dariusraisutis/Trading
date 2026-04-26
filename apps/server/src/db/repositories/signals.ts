import type { DatabaseConnection } from "../database.js";

export interface NewSignal {
  symbol: string;
  strategy: string;
  candleId?: number | null;
  side: "buy" | "sell" | "hold";
  reason: string;
}

export interface Signal extends NewSignal {
  id: number;
  candleId: number | null;
  createdAt: string;
}

interface SignalRow {
  id: number;
  symbol: string;
  strategy: string;
  candle_id: number | null;
  side: "buy" | "sell" | "hold";
  reason: string;
  created_at: string;
}

function mapSignal(row: SignalRow): Signal {
  return {
    id: row.id,
    symbol: row.symbol,
    strategy: row.strategy,
    candleId: row.candle_id,
    side: row.side,
    reason: row.reason,
    createdAt: row.created_at
  };
}

export function createSignalRepository(database: DatabaseConnection) {
  const insert = database.prepare(`
    INSERT INTO signals (symbol, strategy, candle_id, side, reason)
    VALUES (@symbol, @strategy, @candleId, @side, @reason)
    ON CONFLICT(strategy, candle_id) DO NOTHING
  `);
  const listRecent = database.prepare(`
    SELECT * FROM signals
    WHERE symbol = ?
    ORDER BY created_at DESC, id DESC
    LIMIT ?
  `);
  const listByCandleId = database.prepare(`
    SELECT * FROM signals
    WHERE symbol = ? AND candle_id = ?
    ORDER BY id ASC
  `);

  return {
    create(signal: NewSignal): number | null {
      const result = insert.run({ ...signal, candleId: signal.candleId ?? null });
      if (result.changes === 0) {
        return null;
      }

      return Number(result.lastInsertRowid);
    },
    listRecent(symbol: string, limit = 100): Signal[] {
      return (listRecent.all(symbol, limit) as SignalRow[]).map(mapSignal);
    },
    listByCandleId(symbol: string, candleId: number): Signal[] {
      return (listByCandleId.all(symbol, candleId) as SignalRow[]).map(mapSignal);
    }
  };
}

export type SignalRepository = ReturnType<typeof createSignalRepository>;
