# Trading

Local crypto trading bot monorepo built with Node.js and TypeScript.

## Apps

- `apps/server` - Express API
- `apps/web` - React dashboard

## Current Status

Phases 0 through 12 are implemented. The backend supports paper, replay, and
live execution paths, includes a frozen validated ETH 4h strategy candidate,
and now includes Phase 12 stability hardening such as graceful shutdown,
replay failure containment, reconnect cleanup, and startup state recovery.

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
- `EXCHANGE_ID` - CCXT exchange id, defaults to `binance`
- `EXCHANGE_API_KEY` - exchange API key for live trading
- `EXCHANGE_API_SECRET` - exchange API secret for live trading
- `EXCHANGE_SANDBOX` - enables exchange sandbox mode when supported
- `MARKET_SYMBOL` - market symbol to subscribe to, defaults to `BTCUSDT`
- `MARKET_WS_URL` - exchange WebSocket URL, defaults to Binance public WS
- `MARKET_RECONNECT_MS` - reconnect delay after disconnect, defaults to `5000`
- `MARKET_DATA_ENABLED` - set to `false` to disable live market WebSocket startup
- `REPLAY_CSV_PATH` - CSV file used in replay mode, defaults to the included sample
- `REPLAY_INTERVAL_MS` - delay between replay candles, defaults to `0` for instant replay
- `REPLAY_AUTO_START` - auto-start replay mode on boot, defaults to `true`
- `BACKTEST_TRAIN_SPLIT` - train/test split for historical backtests, defaults to `0.7`
- `PAPER_ACCOUNT_SIZE` - starting paper account balance, defaults to `1000`
- `RISK_PER_TRADE_PCT` - risk per trade as account percent, defaults to `0.01`
- `PAPER_FEE_RATE` - paper trading fee rate, defaults to `0.001`
- `SLIPPAGE_PCT` - execution slippage per fill, defaults to `0.00025`
- `STOP_LOSS_PCT` - stop loss threshold, defaults to `0.02`
- `TAKE_PROFIT_PCT` - take profit threshold, defaults to `0.04`
- `MAX_DAILY_LOSS_PCT` - stop new entries after this much daily damage, defaults to `0.03`
- `MAX_CONSECUTIVE_LOSSES` - stop new entries after this many losses in a row, defaults to `3`
- `KILL_SWITCH_MAX_DRAWDOWN_PCT` - hard-stop the bot after this peak drawdown, defaults to `0.15`
- `KILL_SWITCH_MAX_CONSECUTIVE_LOSSES` - hard-stop the bot after this many consecutive losses, defaults to `25`
- `TRADE_COOLDOWN_MS` - cooldown between new entries, defaults to `300000`

In paper and replay modes, position size is now based on account risk:

```text
position notional = (account balance * risk per trade) / stop loss pct
```

With the defaults, a `1000` account risking `1%` with a `2%` stop opens a
`500` notional position. Take profit must stay at least `2x` the stop loss, so
the default setup preserves the minimum `1:2` reward/risk rule.

Stop loss and take profit thresholds trigger protective exits using candle OHLC
data, and the risk engine blocks fresh entries after too many consecutive losses
or too much loss in one day.

The paper execution layer now also includes a kill-switch that stops new entries
if global drawdown or global consecutive loss streak breaches configured limits.

Live mode now uses a CCXT execution path that:

- validates `ENABLE_LIVE=true`
- requires exchange API credentials
- validates quantity precision and minimums against exchange market metadata
- places market orders
- stores exchange order IDs locally

Phase 12 stability hardening adds:

- graceful shutdown on `SIGINT` and `SIGTERM`
- shutdown on `unhandledRejection` and `uncaughtException`
- replay startup/runtime failure capture in replay state
- startup recovery of last known price, latest trade metadata, and open position state
- reconnect timer cleanup for the market WebSocket client

## Replay Mode

Replay mode works fully offline and uses the included sample CSV by default.
It also supports Binance-style historical exports, including daily files with
headers like `Unix`, `Date`, `Symbol`, `Volume BTC`, and `Volume USDT`.

```bash
TRADING_MODE=replay
MARKET_DATA_ENABLED=false
REPLAY_AUTO_START=true
corepack pnpm dev
```

Optional overrides:

```bash
REPLAY_CSV_PATH=apps/server/replay/sample-btcusdt-1m.csv
REPLAY_INTERVAL_MS=250
```

For a longer practice run with many more candles, signals, and trades, use:

```bash
REPLAY_CSV_PATH=apps/server/replay/practice-btcusdt-1m-rich.csv
```

For larger historical backtests, you can also point `REPLAY_CSV_PATH` at a
Binance export such as `C:\Users\dariu\Downloads\Binance_BTCUSDT_d.csv`.

If you want to rerun the same replay from the beginning, use a fresh `DB_PATH`
or remove the previous replay database first so signal uniqueness does not skip
already processed candles.

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
- `GET /api/v1/execution/analytics`
- `GET /api/v1/replay`
- `POST /api/v1/replay/start`
- `POST /api/v1/replay/stop`

## Live Trading

Phase 11 adds a live execution service for spot market orders. Live mode still
defaults off and must be explicitly enabled:

```bash
TRADING_MODE=live
ENABLE_LIVE=true
EXCHANGE_ID=binance
EXCHANGE_API_KEY=your_key
EXCHANGE_API_SECRET=your_secret
```

Important:

- keep order size very small at first
- validate your exchange account permissions before running
- the code stores exchange order IDs in the local `orders` table
- this repo has tests for the live execution path, but no real exchange order
  was placed during local verification here

## Local Data

The server creates the SQLite database automatically at `data/trading.sqlite`
unless `DB_PATH` is set. Local database files are ignored by Git.

## Strategies

- `ma-crossover`
- `breakout`
- `mean-reversion`
- `caveman-trend-pullback` - trend follows EMA 200 and waits for RSI pullbacks

## Backtesting

The server now includes a historical train/test backtest engine with:

- next-candle-open entries
- fee and slippage modeling
- expectancy
- equity curve tracking
- account-based drawdown
- market regime counts
- train/test split reporting

The caveman strategy also uses an ATR volatility filter to avoid dead markets.

## Frozen Champion Docs

- [Frozen Champion Config](C:/Projects/Trading/Trading/docs/frozen-champion-config.md)
- [Live Deployment Checklist](C:/Projects/Trading/Trading/docs/live-deployment-checklist.md)
- [Final Strategy Report](C:/Projects/Trading/Trading/docs/final-strategy-report.md)

There are also separate experimental intraday modules in [apps/server/src/backtest/scalping.ts](C:/Projects/Trading/Trading/apps/server/src/backtest/scalping.ts) and [apps/server/src/backtest/scalp-breakout.ts](C:/Projects/Trading/Trading/apps/server/src/backtest/scalp-breakout.ts). They are intentionally separate from the ETH 4h champion and are used for faster research tracks such as `5m`/`15m` pullback and breakout testing against genuine `ETHUSDT` lower-timeframe CSV data.
