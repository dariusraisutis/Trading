# AGENTS.md

## Project Goal
Build a **local crypto trading bot** using Node.js + TypeScript.

The bot must:
- read market data
- build candles
- detect simple patterns
- simulate or place trades
- expose a local API
- show results in a simple React dashboard

Keep everything simple, local, and safe.

---

## Core Principles

- Start simple. Do NOT over-engineer.
- Build in small phases. STOP after each phase.
- Default to **paper trading mode**.
- Everything must run locally.
- Prefer clarity over abstraction.
- One exchange, one strategy at a time.

---

## Tech Stack (MANDATORY unless blocked)

### Backend
- Node.js
- TypeScript
- Express
- SQLite (better-sqlite3 or sqlite3)
- CCXT (for exchange REST)
- WebSocket client (native or lightweight)
- Zod (env validation)
- Pino (logging)

### Frontend
- React
- TypeScript
- Vite
- Recharts (charts)

---

## Modes

The bot must support:

1. `replay` → historical data
2. `paper` → live data, fake trades (DEFAULT)
3. `live` → real trades (requires explicit enable)

⚠️ NEVER default to live mode.

---

## Safety Rules

- Never hardcode API keys
- Never enable live trading without env flag
- Always log:
  - signals
  - orders
  - fills
  - errors
- Validate all trades before sending
- Block trades if:
  - data is stale
  - config invalid
  - risk limits exceeded

---

## Coding Rules

- Use TypeScript everywhere
- Strong typing for all interfaces
- Small files, clear names
- Avoid unnecessary libraries
- Prefer explicit logic over abstractions
- Add tests for:
  - candle builder
  - indicators
  - strategies

---

## Architecture Rules

Use modular structure:

- market (data ingestion)
- strategy (signal logic)
- risk (validation)
- execution (orders)
- db (storage)
- api (routes)

Do NOT:
- create microservices
- add message queues
- add distributed systems

---

## Execution Rules for Codex

For EVERY phase:

1. Read `docs/implementation-plan.md`
2. Identify current phase
3. Implement ONLY that phase
4. Run:
   - install
   - build
   - tests (if present)
5. Fix errors
6. Summarize:
   - what was built
   - files changed
   - how to run
7. STOP

---

## Definition of Done (per phase)

A phase is complete ONLY if:
- Code compiles
- App runs locally
- Tests pass (if required)
- Acceptance criteria met
- README updated if needed

---

## Forbidden Actions

DO NOT:
- switch language (must stay Node.js)
- add Docker (not needed)
- add authentication (local only)
- implement futures trading
- implement ML/AI strategies
- support multiple exchanges initially
- refactor working code unnecessarily

---

## When Blocked

If stuck:
- choose simplest working solution
- continue forward
- note limitation in summary

---

## Logging Requirements

Use structured logs:

- market events (optional sampling)
- signals (required)
- orders (required)
- fills (required)
- errors (required)

---

## Final Goal

A developer should be able to:

```bash
pnpm install
pnpm dev
