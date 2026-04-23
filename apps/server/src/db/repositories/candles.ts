import type { DatabaseConnection } from "../database.js";

export interface Candle {
  id: number;
  symbol: string;
  timeframe: string;
  openTime: number;
  closeTime: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export type NewCandle = Omit<Candle, "id">;
export type CandleRepository = ReturnType<typeof createCandleRepository>;

interface CandleRow {
  id: number;
  symbol: string;
  timeframe: string;
  open_time: number;
  close_time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

function mapCandle(row: CandleRow): Candle {
  return {
    id: row.id,
    symbol: row.symbol,
    timeframe: row.timeframe,
    openTime: row.open_time,
    closeTime: row.close_time,
    open: row.open,
    high: row.high,
    low: row.low,
    close: row.close,
    volume: row.volume
  };
}

export function createCandleRepository(database: DatabaseConnection) {
  const insert = database.prepare(`
    INSERT INTO candles (
      symbol, timeframe, open_time, close_time, open, high, low, close, volume
    ) VALUES (
      @symbol, @timeframe, @openTime, @closeTime, @open, @high, @low, @close, @volume
    )
    ON CONFLICT(symbol, timeframe, open_time) DO UPDATE SET
      close_time = excluded.close_time,
      high = excluded.high,
      low = excluded.low,
      close = excluded.close,
      volume = excluded.volume
  `);
  const findById = database.prepare("SELECT * FROM candles WHERE id = ?");
  const findByUniqueKey = database.prepare(`
    SELECT * FROM candles
    WHERE symbol = ? AND timeframe = ? AND open_time = ?
  `);
  const listRecent = database.prepare(`
    SELECT * FROM candles
    WHERE symbol = ? AND timeframe = ?
    ORDER BY open_time DESC
    LIMIT ?
  `);
  const listBeforeOrAt = database.prepare(`
    SELECT * FROM candles
    WHERE symbol = ? AND timeframe = ? AND open_time <= ?
    ORDER BY open_time DESC
    LIMIT ?
  `);

  return {
    create(candle: NewCandle): Candle {
      const result = insert.run(candle);
      if (result.changes > 0 && Number(result.lastInsertRowid) > 0) {
        const inserted = this.findById(Number(result.lastInsertRowid));

        if (inserted) {
          return inserted;
        }
      }

      const row = findByUniqueKey.get(candle.symbol, candle.timeframe, candle.openTime) as
        | CandleRow
        | undefined;

      if (!row) {
        throw new Error("Failed to save candle");
      }

      return mapCandle(row);
    },
    findById(id: number): Candle | null {
      const row = findById.get(id) as CandleRow | undefined;
      return row ? mapCandle(row) : null;
    },
    listRecent(symbol: string, timeframe: string, limit = 100): Candle[] {
      return (listRecent.all(symbol, timeframe, limit) as CandleRow[]).map(mapCandle);
    },
    listBeforeOrAt(symbol: string, timeframe: string, openTime: number, limit = 100): Candle[] {
      return (listBeforeOrAt.all(symbol, timeframe, openTime, limit) as CandleRow[])
        .map(mapCandle)
        .reverse();
    }
  };
}
