
---

# 📄 `docs/implementation-plan.md`

```md
# Implementation Plan (Codex Execution Guide)

Follow phases strictly in order.
Do NOT skip ahead.

---

# Phase 0 — Project Bootstrap

## Goal
Create working monorepo with server + web.

## Tasks
- init pnpm workspace
- create:
  - apps/server
  - apps/web
- configure TypeScript
- add Express server
- add React app (Vite)
- create `.env.example`
- create basic README

## Acceptance Criteria
- `pnpm install` works
- `pnpm dev` runs both apps
- backend `/health` returns OK
- frontend loads in browser

---

# Phase 1 — Core Backend

## Goal
Set up config, logging, and API base.

## Tasks
- env validation (zod)
- logger (pino)
- express structure
- error handler
- base routes

## Acceptance Criteria
- invalid env fails cleanly
- logs are structured
- API responds correctly

---

# Phase 2 — Database (SQLite)

## Goal
Persist data locally.

## Tasks
- setup SQLite
- create tables:
  - candles
  - signals
  - orders
  - trades
  - positions
- create repository layer

## Acceptance Criteria
- DB auto-creates
- data persists after restart

---

# Phase 3 — Market Data

## Goal
Get live market prices.

## Tasks
- implement exchange WS client
- subscribe to ticker/trades
- normalize events
- store current price in memory

## Acceptance Criteria
- live price updates visible via API
- reconnect works after disconnect

---

# Phase 4 — Candle Builder

## Goal
Create 1-minute candles.

## Tasks
- aggregate OHLCV
- close candles every minute
- persist to DB

## Acceptance Criteria
- candles are correct
- API returns recent candles

---

# Phase 5 — Indicators

## Goal
Add basic indicators.

## Tasks
- SMA
- EMA
- rolling high/low
- std dev
- z-score

## Acceptance Criteria
- indicator functions tested

---

# Phase 6 — Strategies

## Goal
Generate signals.

## Implement:

### MA Crossover
- fast: 9
- slow: 21

### Breakout
- 20 candle high/low

### Mean Reversion
- z-score threshold = 2

## Acceptance Criteria
- signals saved in DB
- no duplicate signals per candle

---

# Phase 7 — Paper Trading

## Goal
Simulate trades.

## Tasks
- fake order execution
- update:
  - trades
  - positions
  - PnL
- simulate fees

## Acceptance Criteria
- trades execute logically
- PnL updates correctly

---

# Phase 8 — Risk Engine

## Goal
Prevent bad trades.

## Rules
- 1 position per symbol
- fixed trade size
- stop loss
- take profit
- cooldown

## Acceptance Criteria
- invalid trades blocked

---

# Phase 9 — Dashboard (React)

## Goal
Visualize bot.

## Show:
- price
- candles chart
- signals
- trades
- positions
- PnL

## Controls:
- start/stop bot
- select strategy

## Acceptance Criteria
- usable UI without reading logs

---

# Phase 10 — Replay Mode

## Goal
Run bot without exchange.

## Tasks
- load CSV candles
- replay data
- run strategies

## Acceptance Criteria
- bot works offline

---

# Phase 11 — Live Trading

## Goal
Enable real orders.

## Tasks
- connect CCXT
- place market orders
- validate precision
- store exchange order IDs

## Safety
- require ENABLE_LIVE=true

## Acceptance Criteria
- small live trade works

---

# Phase 12 — Stability

## Goal
Make bot reliable.

## Tasks
- reconnect logic
- graceful shutdown
- error handling
- state recovery

## Acceptance Criteria
- runs for hours without crash

---

# Execution Instructions

For each phase:

1. Implement tasks
2. Run app
3. Verify acceptance criteria
4. Fix issues
5. Summarize
6. STOP

---

END OF FILE
