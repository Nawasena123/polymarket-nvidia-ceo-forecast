# Polymarket "Next CEO of NVIDIA?" minute-by-minute quantile forecaster

Entry for make.fun's `polymarket-nvidia-ceo-forecast-01`. `main.ts` (Node 22, standard library only)
reads each case in `/input` and writes 5 quantiles x 240 minutes per market to `/output`.

Model (per market):
- **Centre**: last price, with a small pull toward a 9-minute median (flash spikes), a slow EMA pull,
  a pull that brings the event's prices back toward summing to 1, and an **asymmetric give-back**:
  a recent rise above the 51-minute EMA is expected to fade (~78% over a couple of hours), a fall mostly stays.
- **Spread**: robust per-market scale (mean absolute 3-minute moves, long 17 h window mixed with a short 71 min
  window), growing like h^0.44 (h^0.38 for the 5/95% tails, which are fat: 2.6 scale units).
- **Bounds**: clamped to [0, 1], slight upward skew for long shots near 0.

`tools/` holds the local backtest (`bt.ts`), tuner (`tune.ts`), history fetcher and output checker.

Run locally: `MAKEFUN_INPUT_DIR=input MAKEFUN_OUTPUT_DIR=out node main.ts`
