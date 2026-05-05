import type { DatabaseConnection } from "../database.js";

export interface PositionControl {
  symbol: string;
  strategy: string;
  timeframe: string;
  stopPrice: number | null;
  partialTargetPrice: number | null;
  partialExitFraction: number;
  partialExitTaken: boolean;
}

interface PositionControlRow {
  symbol: string;
  strategy: string;
  timeframe: string;
  stop_price: number | null;
  partial_target_price: number | null;
  partial_exit_fraction: number;
  partial_exit_taken: number;
}

function mapPositionControl(row: PositionControlRow): PositionControl {
  return {
    symbol: row.symbol,
    strategy: row.strategy,
    timeframe: row.timeframe,
    stopPrice: row.stop_price,
    partialTargetPrice: row.partial_target_price,
    partialExitFraction: row.partial_exit_fraction,
    partialExitTaken: row.partial_exit_taken === 1
  };
}

export function createPositionControlRepository(database: DatabaseConnection) {
  const upsert = database.prepare(`
    INSERT INTO position_controls (
      symbol, strategy, timeframe, stop_price, partial_target_price, partial_exit_fraction, partial_exit_taken
    ) VALUES (
      @symbol, @strategy, @timeframe, @stopPrice, @partialTargetPrice, @partialExitFraction, @partialExitTaken
    )
    ON CONFLICT(symbol) DO UPDATE SET
      strategy = excluded.strategy,
      timeframe = excluded.timeframe,
      stop_price = excluded.stop_price,
      partial_target_price = excluded.partial_target_price,
      partial_exit_fraction = excluded.partial_exit_fraction,
      partial_exit_taken = excluded.partial_exit_taken,
      updated_at = CURRENT_TIMESTAMP
  `);
  const findBySymbol = database.prepare(`
    SELECT symbol, strategy, timeframe, stop_price, partial_target_price, partial_exit_fraction, partial_exit_taken
    FROM position_controls
    WHERE symbol = ?
  `);
  const removeBySymbol = database.prepare("DELETE FROM position_controls WHERE symbol = ?");

  return {
    upsert(control: PositionControl) {
      upsert.run({
        ...control,
        partialExitTaken: control.partialExitTaken ? 1 : 0
      });
    },
    findBySymbol(symbol: string): PositionControl | null {
      const row = findBySymbol.get(symbol) as PositionControlRow | undefined;
      return row ? mapPositionControl(row) : null;
    },
    removeBySymbol(symbol: string) {
      removeBySymbol.run(symbol);
    }
  };
}

export type PositionControlRepository = ReturnType<typeof createPositionControlRepository>;
