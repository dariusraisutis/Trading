# Live Deployment Checklist

Use this before risking real money.

## Strategy Freeze

- Use the frozen champion from [frozen-champion-config.md](C:/Projects/Trading/Trading/docs/frozen-champion-config.md)
- Do not change entry logic, exits, or filters during live observation

## Capital and Size

- Start with `paper` or dust-size first
- Start live risk at `0.25%` to `0.5%` per trade
- Do not scale until live behavior matches backtest behavior

## Required Env

- `TRADING_MODE=live`
- `ENABLE_LIVE=true`
- `MARKET_SYMBOL=ETHUSDT`
- `KILL_SWITCH_MAX_DRAWDOWN_PCT=0.12` to `0.15`
- `KILL_SWITCH_MAX_CONSECUTIVE_LOSSES=20` to `25`

## Kill-Switch

- Confirm kill-switch thresholds are set before any live trading
- Confirm the bot state exposes `killSwitchActive` and `killSwitchReason`
- If kill-switch trips, do not auto-restart blindly

## Live Tracking

Only track:
- rolling profit factor
- rolling expectancy
- drawdown
- trade count

Ignore:
- social media noise
- one-trade excitement
- temptation to tweak after a small losing patch

## Ramp Plan

Phase 1:
- paper or replay verification
- confirm signals, orders, fills, and logs

Phase 2:
- live with tiny size
- risk `0.25%` to `0.5%`

Phase 3:
- increase only if:
  - live fills look sane
  - slippage is acceptable
  - rolling PF and expectancy stay healthy

## Hard Stops

Pause and review if:
- kill-switch trips
- exchange behavior changes
- live slippage is much worse than assumed
- recent rolling PF drops near or below `1.0`

## Final Rule

Discipline is the edge protector.
Do not break the frozen system while trying to “help” it.
