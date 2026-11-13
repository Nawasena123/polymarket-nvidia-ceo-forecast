# Polymarket "Next CEO of NVIDIA?" minute-by-minute quantile forecaster

Entry for make.fun's `polymarket-nvidia-ceo-forecast-01`. `main.ts` (Node 22, standard library only)
reads each case in `/input` and writes 5 quantiles x 240 minutes per market to `/output`.

## Model (per market, x = price at the checkpoint)

- **Centre**: x, with an **asymmetric give-back**. In this event a rise is mostly a pump on a thin
  book and fades, while a fall mostly stays (measured with `tools/analyze.ts`: a 3-10 minute rise
  gives back 60-95% of itself within 4 hours, a fall bounces back 0-40%). So two-thirds of the rise
  above the 51-minute EMA is expected to fade over ~80 minutes, plus a faster fade of the part above
  the 7-minute EMA; a fall slightly continues. A small pull brings the event's prices back toward
  summing to 1.
- **Spread**: a per-market scale of 3-minute moves (17-hour window mixed half and half with a
  71-minute one so it adapts to calm and busy spells), growing like h^0.44 for the 25/75% band and
  h^0.38 for the fat 5/95% tails (2.6 scale units). The band is widened after a fresh jump; the lower
  side is a little wider than the upper.
- **Bounds**: clamped to [0, 1], non-decreasing, rounded to 6 decimals.

## Validation

`tools/fetch.mjs` pulls Polymarket's public 1-minute price history and puts it on the house's grid
(it matches the kit's practice cases exactly). `tools/bt.ts` cuts causal cases at every 20 minutes
and scores the pinball loss as RULES.txt defines it (it reproduces the house baseline's practice
loss, 0.363589, exactly). On 92 checkpoints from 2026-11-12T03:00Z to 2026-11-13T09:20Z the model
scores 0.247 against the baseline's 0.369; on the six practice cases 0.252 against 0.364.
`tools/tune.ts` is the coordinate-descent tuner; `tools/blocks.ts` checks a parameter set block by
block in time so a change is kept only if it holds up across regimes.

Run locally: `MAKEFUN_INPUT_DIR=input MAKEFUN_OUTPUT_DIR=out node main.ts`
