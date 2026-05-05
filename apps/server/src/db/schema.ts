import type Database from "better-sqlite3";

const statements = [
  `CREATE TABLE IF NOT EXISTS candles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    symbol TEXT NOT NULL,
    timeframe TEXT NOT NULL,
    open_time INTEGER NOT NULL,
    close_time INTEGER NOT NULL,
    open REAL NOT NULL,
    high REAL NOT NULL,
    low REAL NOT NULL,
    close REAL NOT NULL,
    volume REAL NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(symbol, timeframe, open_time)
  )`,
  `CREATE TABLE IF NOT EXISTS signals (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    symbol TEXT NOT NULL,
    strategy TEXT NOT NULL,
    candle_id INTEGER,
    side TEXT NOT NULL CHECK(side IN ('buy', 'sell', 'hold')),
    reason TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(strategy, candle_id),
    FOREIGN KEY(candle_id) REFERENCES candles(id)
  )`,
  `CREATE TABLE IF NOT EXISTS orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    symbol TEXT NOT NULL,
    side TEXT NOT NULL CHECK(side IN ('buy', 'sell')),
    type TEXT NOT NULL,
    quantity REAL NOT NULL,
    price REAL,
    exchange_order_id TEXT,
    status TEXT NOT NULL,
    mode TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS trades (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id INTEGER,
    symbol TEXT NOT NULL,
    side TEXT NOT NULL CHECK(side IN ('buy', 'sell')),
    quantity REAL NOT NULL,
    price REAL NOT NULL,
    fee REAL NOT NULL DEFAULT 0,
    executed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(order_id) REFERENCES orders(id)
  )`,
  `CREATE TABLE IF NOT EXISTS positions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    symbol TEXT NOT NULL UNIQUE,
    quantity REAL NOT NULL,
    average_price REAL NOT NULL,
    realized_pnl REAL NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS position_controls (
    symbol TEXT NOT NULL PRIMARY KEY,
    strategy TEXT NOT NULL,
    timeframe TEXT NOT NULL,
    stop_price REAL,
    partial_target_price REAL,
    partial_exit_fraction REAL NOT NULL DEFAULT 0,
    partial_exit_taken INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`
];

const indexes = [
  "CREATE INDEX IF NOT EXISTS idx_candles_symbol_time ON candles(symbol, timeframe, open_time)",
  "CREATE INDEX IF NOT EXISTS idx_signals_symbol_strategy ON signals(symbol, strategy, created_at)",
  "CREATE INDEX IF NOT EXISTS idx_orders_symbol_status ON orders(symbol, status)",
  "CREATE INDEX IF NOT EXISTS idx_trades_symbol_time ON trades(symbol, executed_at)",
  "CREATE INDEX IF NOT EXISTS idx_position_controls_strategy ON position_controls(strategy, timeframe)"
];

export function migrate(database: Database.Database) {
  database.pragma("journal_mode = WAL");
  database.pragma("foreign_keys = ON");

  const runMigration = database.transaction(() => {
    for (const statement of statements) {
      database.prepare(statement).run();
    }

    for (const statement of indexes) {
      database.prepare(statement).run();
    }
  });

  runMigration();
  database
    .prepare("CREATE UNIQUE INDEX IF NOT EXISTS idx_signals_strategy_candle ON signals(strategy, candle_id)")
    .run();
  ensureColumn(database, "orders", "exchange_order_id", "TEXT");
}

function ensureColumn(
  database: Database.Database,
  table: string,
  column: string,
  definition: string
) {
  const columns = database.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;

  if (columns.some((existing) => existing.name === column)) {
    return;
  }

  database.prepare(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`).run();
}
