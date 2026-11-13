// Polymarket "Next CEO of NVIDIA?" quantile forecaster (Node 22, standard library only).
//
// For each market it forecasts five quantiles (5/25/50/75/95%) of the Yes price at each of the
// 240 minutes after the checkpoint:
//   centre  = last price, pulled part of the way back toward a short robust anchor when the
//             last few minutes look like a transient spike (books on Polymarket often flash);
//   spread  = a per-market robust scale of recent multi-minute moves, growing like h^alpha;
//   shape   = fixed standardized offsets per quantile level (fat tails at 5%/95%);
//   bounds  = clamped to [0, 1], tighter near 0 because a long shot cannot fall below 0.
//
// MAKEFUN_INPUT_DIR / MAKEFUN_OUTPUT_DIR override /input and /output for local runs.

import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const QUANTILES = [0.05, 0.25, 0.5, 0.75, 0.95];

export interface Params {
  spikeK: number; // minutes in the short anchor window
  spikeW: number; // weight of the pull toward the short anchor
  volWin: number; // minutes of history used for the scale
  volLag: number; // lag (minutes) of the moves the scale is measured on
  alpha: number; // spread exponent in h
  k25: number; // standardized offset of the 25/75% quantiles
  k05: number; // standardized offset of the 5/95% quantiles
  floor: number; // minimum scale per sqrt(minute)
  lam: number; // weight of the market's own empirical quantiles of lag-h moves (0 = parametric only)
  empWin: number; // minutes of history the empirical quantiles are read from
  empMul: number; // multiplier on the empirical offsets
  emaL: number; // minutes of the slow EMA the price reverts toward
  revW: number; // full weight of the pull toward the slow EMA, reached as h grows
  revT: number; // minutes over which that pull builds up
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
  dW: number; // share of a recent fall expected to bounce back
}

// Tuned by tools/tune.ts on rolling 20-minute checkpoints from 2026-11-12T03:00Z to 2026-11-13T09:00Z.
export const DEFAULT: Params = {
  spikeK: 9,
  spikeW: 0.053,
  volWin: 1008,
  volLag: 3,
  alpha: 0.437,
  k25: 0.362,
  k05: 2.589,
  floor: 0.000081,
  lam: 0,
  empWin: 2880,
  empMul: 1,
  emaL: 10,
  revW: 0.079,
  revT: 204,
  sumW: 1,
  sumT: 138,
  shortWin: 71,
  shortW: 0.588,
  alphaT: 0.3795,
  skew: 0.025,
  skewP: 0.025,
  uL: 51,
  uW: 0.784,
  uT: 69,
  dW: 0.025,
};

/** Horizons at which the empirical quantiles are measured; others are interpolated in log h. */
const EMP_H = [1, 2, 4, 8, 15, 30, 60, 120, 180, 240];

/** The value at level tau of a sorted array (linear interpolation between order statistics). */
function qsorted(s: number[], tau: number): number {
  const r = tau * (s.length - 1);
  const i = Math.floor(r);
  return i + 1 < s.length ? s[i] + (r - i) * (s[i + 1] - s[i]) : s[i];
}

/** Empirical quantile offsets (5 levels, own median removed) of lag-h moves, for each h in EMP_H. */
function empirical(p: number[], win: number): number[][] | null {
  const n = p.length;
  const from = Math.max(0, n - 1 - win);
  const out: number[][] = [];
  for (const h of EMP_H) {
    const d: number[] = [];
    for (let t = from; t + h < n; t++) d.push(p[t + h] - p[t]);
    if (d.length < 60) return null;
    d.sort((a, b) => a - b);
    const m = qsorted(d, 0.5);
    out.push(QUANTILES.map((tau) => qsorted(d, tau) - m));
  }
  return out;
}

/** Empirical offsets at horizon h, interpolated in log h between the measured horizons. */
function empAt(E: number[][], h: number): number[] {
  let k = 0;
  while (k + 1 < EMP_H.length && EMP_H[k + 1] < h) k++;
  if (h <= EMP_H[0]) return E[0];
  if (k + 1 >= EMP_H.length) return E[EMP_H.length - 1];
  const a = Math.log(EMP_H[k]), b = Math.log(EMP_H[k + 1]);
  const w = (Math.log(h) - a) / (b - a);
  return E[k].map((v, j) => v + w * (E[k + 1][j] - v));
}

const price6 = (x: number): number => Math.round(Math.min(1, Math.max(0, x)) * 1e6) / 1e6 + 0;

function median(a: number[]): number {
  const s = a.slice().sort((x, y) => x - y);
  const n = s.length;
  return n % 2 ? s[(n - 1) >> 1] : (s[n / 2 - 1] + s[n / 2]) / 2;
}

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

export function forecastMarket(p: number[], horizon: number, P: Params, ctx: Ctx = { sum: 1 }): number[][] {
  const n = p.length;
  const x = p[n - 1];
  const anchor = median(p.slice(Math.max(0, n - P.spikeK)));
  const c0 = x + P.spikeW * (anchor - x);
  const slow = P.revW ? ema(p, P.emaL) : x;
  const sumGap = ctx.sum > 0 ? (x / ctx.sum) * (1 - ctx.sum) : 0;
  const ref = P.uW || P.dW ? ema(p, P.uL) : x;
  const rise = Math.max(0, c0 - ref);
  const fall = Math.max(0, ref - c0);
  const sLong = scale(p, P.volWin, P.volLag);
  const sShort = P.shortW ? scale(p, P.shortWin, P.volLag) : sLong;
  const s = Math.max(P.floor, (1 - P.shortW) * sLong + P.shortW * sShort);
  // Long shots are bounded below by 0, so their moves skew upward.
  const up = 1 + P.skew * Math.max(0, 1 - x / P.skewP);
  const dn = 1 / up;
  const E = P.lam > 0 ? empirical(p, P.empWin) : null;
  const lam = E ? P.lam : 0;
  const rows: number[][] = [];
  for (let h = 1; h <= horizon; h++) {
    // Rises fade (a pump on a thin book gives most of itself back); falls mostly stay.
    const c =
      c0 +
      P.revW * (1 - Math.exp(-h / P.revT)) * (slow - c0) +
      P.sumW * (1 - Math.exp(-h / P.sumT)) * sumGap -
      P.uW * (1 - Math.exp(-h / P.uT)) * rise +
      P.dW * (1 - Math.exp(-h / P.uT)) * fall;
    const w = s * Math.pow(h, P.alpha);
    const wt = s * Math.pow(h, P.alphaT) * P.k05;
    const par = [-wt * dn, -P.k25 * w * dn, 0, P.k25 * w * up, wt * up];
    const emp = E ? empAt(E, h) : par;
    const q = par.map((v, j) => price6(c + (1 - lam) * v + lam * P.empMul * emp[j]));
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

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
