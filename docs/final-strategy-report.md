# Final Strategy Report

## Summary

Current champion:
- market: `ETHUSDT`
- timeframe: `4h`
- model: momentum with volatility compression and trend guard

Frozen setup:
- lookback: `60`
- ATR period: `14`
- min ATR percent: `1.0%`
- partial exit: `50%` at `1.25R`
- runner exit: `trend-flip`
- trend guard: `4h EMA200`

## Why This Won

Compared with the earlier baseline, this setup improved both quality and safety:
- profit factor increased
- drawdown decreased
- bad bear-like regime damage improved
- recent out-of-sample remained profitable

## Validation Highlights

Main split:
- PF improved from about `1.53` to about `1.97`
- drawdown improved from about `7.0%` to about `4.5%`

Walk-forward:
- mostly alive across years
- weak year still exists, but damage stayed controlled

Fees and slippage:
- edge survived harsher friction assumptions

Monte Carlo shuffle:
- edge survived trade-order stress
- drawdown tails stayed survivable

Recent-only out-of-sample:
- last `12` months stayed profitable
- last `6` months stayed profitable

## Known Weaknesses

- regime-dependent
- not an always-on money machine
- weaker in 2022-style conditions
- concentration risk was reduced, not eliminated

## Rejected Paths

- BTC for this system
- daily EMA200 guard
- more entry tweaking after champion freeze

## Practical Conclusion

This is a live-ready candidate at small size, not a guarantee.

Best next real-world behavior:
- start tiny
- keep the frozen rules
- respect kill-switches
- measure live execution honestly
