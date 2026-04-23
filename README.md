# Trading

Local crypto trading bot monorepo built with Node.js and TypeScript.

## Apps

- `apps/server` - Express API
- `apps/web` - React dashboard

## Current Status

Phase 7 is implemented. The backend now includes validated environment loading,
structured logging, base API routes, centralized error handling, and a local
SQLite database with repository helpers. It also starts a Binance-compatible
public WebSocket market data client, keeps the latest price in memory, builds
1-minute candles from trade events, persists closed candles to SQLite, and has
tested indicator helpers plus basic signal strategies. Paper trading now
simulates orders, trades, fees, positions, and realized PnL.

## Commands

```bash
corepack pnpm install
corepack pnpm dev
corepack pnpm build
corepack pnpm test
```

## Environment

Copy `.env.example` to `.env` when you want to override defaults.

- `PORT` - backend port, defaults to `3001`
- `TRADING_MODE` - `paper`, `replay`, or `live`
- `ENABLE_LIVE` - must stay `false` unless live trading is explicitly enabled
- `LOG_LEVEL` - Pino log level, defaults to `info`
- `DB_PATH` - SQLite database path, defaults to `data/trading.sqlite`
- `MARKET_SYMBOL` - market symbol to subscribe to, defaults to `BTCUSDT`
- `MARKET_WS_URL` - exchange WebSocket URL, defaults to Binance public WS
- `MARKET_RECONNECT_MS` - reconnect delay after disconnect, defaults to `5000`
- `MARKET_DATA_ENABLED` - set to `false` to disable live market WebSocket startup

## Local URLs

- API health check: `http://localhost:3001/health`
- Web app: `http://localhost:5173`

## API Routes

- `GET /health`
- `GET /api/v1/status`
- `GET /api/v1/market/price`
- `GET /api/v1/market/candles`
- `GET /api/v1/signals`
- `GET /api/v1/execution/orders`
- `GET /api/v1/execution/trades`
- `GET /api/v1/execution/positions`

## Local Data

The server creates the SQLite database automatically at `data/trading.sqlite`
unless `DB_PATH` is set. Local database files are ignored by Git.
