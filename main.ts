// Polymarket "Next CEO of NVIDIA?" quantile forecaster (Node 22, standard library only).
//
// For each market it forecasts five quantiles (5/25/50/75/95%) of the Yes price at each of the
// 240 minutes after the checkpoint:
//   centre  = last price; a recent rise above the 51-minute EMA is expected to fade (two-thirds of
//             it over ~80 minutes) and the part above a 7-minute EMA faster still, while a recent
//             fall slightly continues; plus a pull that brings the event's prices back to sum 1;
//   spread  = a per-market scale of 3-minute moves (17-hour window mixed with a 71-minute one),
//             growing like h^0.44 for the 25/75% band and h^0.38 for the fat 5/95% tails, widened
//             after a fresh jump, the lower side a little wider than the upper;
//   bounds  = clamped to [0, 1], non-decreasing, rounded to 6 decimals.
//
// MAKEFUN_INPUT_DIR / MAKEFUN_OUTPUT_DIR override /input and /output for local runs.

import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';

export const QUANTILES = [0.05, 0.25, 0.5, 0.75, 0.95];

export interface Params {
  volWin: number; // minutes of history used for the long-window scale
  volLag: number; // lag (minutes) of the moves the scale is measured on
  alpha: number; // spread exponent in h of the 25/75% band
  k25: number; // standardized offset of the 25/75% quantiles
  k05: number; // standardized offset of the 5/95% quantiles
  floor: number; // minimum scale
  sumW: number; // weight of the pull that brings the event's prices back to summing to 1
  sumT: number; // minutes over which the sum pull builds up
  shortWin: number; // minutes of the short volatility window
  shortW: number; // weight of the short-window scale in the mix
  alphaT: number; // spread exponent in h of the 5/95% tails
  skew: number; // upward skew of the spread for prices well below skewP
  skewP: number; // price under which the skew applies, growing toward 0
  uL: number; // minutes of the EMA a recent rise or fall is measured from
  uW: number; // share of a recent rise expected to be given back
  uT: number; // minutes over which the give-back (and the bounce) builds up
  dW: number; // share of a recent fall expected to bounce back (negative: to keep falling)
  a05: number; // asymmetry of the 5/95% tails (+ widens the upper one)
  a25: number; // asymmetry of the 25/75% band
  jumpW: number; // extra spread per unit of a recent rise or fall
  u2L: number; // minutes of the short EMA of the fast give-back
  u2W: number; // share of the rise above it that fades
  u2T: number; // minutes over which the fast give-back builds up
  trimCap: number; // cap (in mean moves) on a move for the inner band's scale (0 = untrimmed)
  inMul: number; // multiplier on the inner band's scale
}

// Tuned by tools/tune.ts on rolling 20-minute checkpoints from 2026-11-12T03:00Z to 2026-11-13T09:20Z,
// the last 14 hours counted twice (TRAIN=mix), every case cut causally from Polymarket's public history.
export const DEFAULT: Params = {
  volWin: 1159,
  volLag: 3,
  alpha: 0.437,
  k25: 0.354,
  k05: 2.589,
  floor: 0.000067,
  sumW: 1,
  sumT: 193,
  shortWin: 71,
  shortW: 0.5,
  alphaT: 0.3795,
  skew: 0.006,
  skewP: 0.025,
  uL: 51,
  uW: 0.666,
  uT: 79,
  dW: -0.075,
  a05: -0.089,
  a25: -0.194,
  jumpW: 0.06,
  u2L: 7,
  u2W: 0.278,
  u2T: 13,
  trimCap: 12,
  inMul: 1.1,
};

/** x clamped to [0,1] and rounded to 6 decimals (0, never -0). */
const price6 = (x: number): number => Math.round(Math.min(1, Math.max(0, x)) * 1e6) / 1e6 + 0;

/** Mean absolute lag-L move over the last `win` minutes, as a scale per sqrt(minute). */
function scale(p: number[], win: number, lag: number): number {
  const n = p.length;
  const from = Math.max(0, n - 1 - win);
  let s = 0;
  let c = 0;
  for (let t = from; t + lag < n; t++) {
    s += Math.abs(p[t + lag] - p[t]);
    c++;
  }
  if (!c) return 0;
  // mean |N(0, s^2 L)| = s * sqrt(2L/pi)
  return s / c / Math.sqrt((2 * lag) / Math.PI);
}

/** Exponential moving average of the last 6*L minutes with time constant L. */
function ema(p: number[], L: number): number {
  const n = p.length;
  let e = p[Math.max(0, n - 1 - 6 * L)];
  const a = 1 / L;
  for (let t = Math.max(0, n - 6 * L); t < n; t++) e += a * (p[t] - e);
  return e;
}

export interface Ctx {
  sum: number; // sum of every market's last price in the case
}

/** Like scale(), but each move is capped at `cap` times the window's mean move first (jumps trimmed). */
function trimmedScale(p: number[], win: number, lag: number, cap: number): number {
  const n = p.length;
  const from = Math.max(0, n - 1 - win);
  const d: number[] = [];
  for (let t = from; t + lag < n; t++) d.push(Math.abs(p[t + lag] - p[t]));
  if (!d.length) return 0;
  const m = d.reduce((a, b) => a + b, 0) / d.length;
  let s = 0;
  for (const v of d) s += Math.min(v, cap * m);
  return s / d.length / Math.sqrt((2 * lag) / Math.PI);
}

export function forecastMarket(p: number[], horizon: number, P: Params, ctx: Ctx = { sum: 1 }): number[][] {
  const n = p.length;
  const x = p[n - 1];
  const c0 = x;
  // Capped, so an odd case (a market missing, or one that already won) cannot drag every price far.
  const sumGap = ctx.sum > 0 ? (x / ctx.sum) * Math.max(-0.15, Math.min(0.15, 1 - ctx.sum)) : 0;
  const ref = P.uW || P.dW ? ema(p, P.uL) : x;
  const rise = Math.max(0, c0 - ref);
  const fall = Math.max(0, ref - c0);
  // A second, faster give-back: the part of a rise above a short EMA fades within minutes.
  const rise2 = P.u2W ? Math.max(0, c0 - ema(p, P.u2L)) : 0;
  const sLong = scale(p, P.volWin, P.volLag);
  const sShort = P.shortW ? scale(p, P.shortWin, P.volLag) : sLong;
  const s = Math.max(P.floor, (1 - P.shortW) * sLong + P.shortW * sShort);
  // The inner band reads the market's ordinary moves, its jumps trimmed; the tails keep them.
  const sIn = P.trimCap > 0 ? Math.max(P.floor, (1 - P.shortW) * trimmedScale(p, P.volWin, P.volLag, P.trimCap) + P.shortW * trimmedScale(p, P.shortWin, P.volLag, P.trimCap)) : s;
  // Long shots are bounded below by 0, so their moves skew upward.
  const up = 1 + P.skew * Math.max(0, 1 - x / P.skewP);
  const dn = 1 / up;
  const rows: number[][] = [];
  for (let h = 1; h <= horizon; h++) {
    // Rises fade (a pump on a thin book gives most of itself back); falls mostly stay.
    const c =
      c0 +
      P.sumW * (1 - Math.exp(-h / P.sumT)) * sumGap -
      P.uW * (1 - Math.exp(-h / P.uT)) * rise +
      P.dW * (1 - Math.exp(-h / P.uT)) * fall -
      P.u2W * (1 - Math.exp(-h / P.u2T)) * rise2;
    const w = sIn * P.inMul * Math.pow(h, P.alpha);
    const wt = s * Math.pow(h, P.alphaT) * P.k05;
    // A fresh rise may give back more than expected (or not at all): widen by part of it.
    const jw = P.jumpW * (1 - Math.exp(-h / P.uT)) * (rise + fall);
    const par = [
      -(wt * (1 - P.a05) + jw) * dn,
      -(P.k25 * w * (1 - P.a25) + 0.5 * jw) * dn,
      0,
      (P.k25 * w * (1 + P.a25) + 0.5 * jw) * up,
      (wt * (1 + P.a05) + jw) * up,
    ];
    const q = par.map((v) => price6(c + v));
    for (let j = 1; j < 5; j++) if (q[j] < q[j - 1]) q[j] = q[j - 1];
    rows.push(q);
  }
  return rows;
}

export interface CaseMarket {
  id: string;
  prices: number[];
}
export interface Case {
  horizon_minutes: number;
  quantiles: number[];
  markets: CaseMarket[];
}

export function forecastCase(c: Case, P: Params = DEFAULT): { id: string; q: number[][] }[] {
  const ctx: Ctx = { sum: c.markets.reduce((a, m) => a + m.prices[m.prices.length - 1], 0) };
  return c.markets.map((m) => ({ id: m.id, q: forecastMarket(m.prices, c.horizon_minutes, P, ctx) }));
}

function main(): void {
  const INPUT_DIR = process.env.MAKEFUN_INPUT_DIR ?? '/input';
  const OUTPUT_DIR = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';
  mkdirSync(OUTPUT_DIR, { recursive: true });
  const inputs = readdirSync(INPUT_DIR).filter((f) => f.endsWith('.in')).sort();
  for (const file of inputs) {
    const id = file.slice(0, -'.in'.length);
    const c = JSON.parse(readFileSync(join(INPUT_DIR, file), 'utf8')) as Case;
    writeFileSync(join(OUTPUT_DIR, `${id}.out`), `${JSON.stringify({ forecasts: forecastCase(c) })}\n`);
  }
}

// Run as the entry (node /bot/main.ts); the tools/ scripts import this file and skip it. The test
// is on the script's file name, not its full path, so a symlinked /bot still runs.
if (basename(process.argv[1] ?? 'main.ts') === 'main.ts') main();
