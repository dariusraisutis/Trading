# Frozen Champion Config

This is the current frozen strategy champion from the ETH 4h research run.

Status:
- frozen
- do not tweak core logic casually
- use as the reference configuration for future validation

Market:
- `ETHUSDT`

Timeframe:
- `4h`

Core:
- momentum / time-series momentum

Entry:
- momentum lookback: `60`
- ATR period: `14`
- minimum ATR percent: `1.0%`
- trade only when price is above `4h EMA 200`

Exit:
- partial exit: `50%` at `1.25R`
- remainder: `trend-flip`

Sizing:
- account-risk based
- volatility compression: `ON`

Execution assumptions used in validation:
- fee per side: `0.10%`
- slippage per side: `0.025%`

Risk layer:
- start account used in tests: `1000`
- risk per trade used in tests: `1%`
- recommended live starting risk: `0.5%` max

Rejected variants:
- BTC market for this system
- daily EMA200 guard
- extra entry tweaking

Current deployment read:
- real candidate
- conditional edge
- strongest known setup in this repo
