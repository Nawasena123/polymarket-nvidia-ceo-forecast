// Local backtest: cut causal cases from the fetched history at many checkpoints, run the
// forecaster, and score the pinball loss exactly as RULES.txt describes it.
// Usage: node tools/bt.ts <history.json> [paramsJSON]
import { readFileSync } from 'node:fs';
import { DEFAULT, forecastMarket, QUANTILES, type Ctx, type Params } from '../main.ts';

export interface HM { id: string; name: string; start: number; prices: number[] }
export const H: HM[] = JSON.parse(readFileSync(process.env.HIST ?? 'F:/MAKEFUN/poly-data/history.json', 'utf8')).markets;
const END = Math.min(...H.map((m) => m.start + 60 * (m.prices.length - 1)));

const HOR = 240;
const iso = (s: number) => new Date(s * 1000).toISOString().slice(0, 16);

/** Pinball loss sum and item count of one market-forecast against the truth. */
function pin(q: number[][], y: number[]): number {
  let s = 0;
  for (let h = 0; h < y.length; h++)
    for (let j = 0; j < 5; j++) {
      const d = y[h] - q[h][j];
      s += 100 * Math.max(QUANTILES[j] * d, (QUANTILES[j] - 1) * d);
    }
  return s;
}

export function caseAt(T: number) {
  const out: { m: HM; p: number[]; y: number[] }[] = [];
  for (const m of H) {
    if (m.start > T) continue;
    const iT = (T - m.start) / 60;
    const p = m.prices.slice(Math.max(0, iT - 4319), iT + 1);
    const y = m.prices.slice(iT + 1, iT + 1 + HOR);
    if (y.length < HOR) continue;
    out.push({ m, p, y });
  }
  return out;
}

export type F = (p: number[], ctx: Ctx) => number[][];
export function scoreAt(T: number, f: F) {
  let s = 0, n = 0;
  const cs = caseAt(T);
  const ctx = { sum: cs.reduce((a, { p }) => a + p[p.length - 1], 0) };
  for (const { p, y } of cs) { s += pin(f(p, ctx), y); n += y.length * 5; }
  return { s, n };
}

export function checkpoints(from: string, step: number): number[] {
  const t0 = Date.parse(from) / 1000;
  const r: number[] = [];
  for (let T = t0; T + HOR * 60 <= END; T += step * 60) r.push(T);
  return r;
}

export function evalSet(Ts: number[], f: F): number {
  let s = 0, n = 0;
  for (const T of Ts) { const r = scoreAt(T, f); s += r.s; n += r.n; }
  return s / n;
}

const base = (p: number[]) => forecastMarket(p, HOR, { ...DEFAULT, floor: 0.0025, volWin: 0, spikeW: 0, alpha: 0.5, alphaT: 0.5, k25: 0.67449, k05: 1.644854, revW: 0, sumW: 0, uW: 0, dW: 0, skew: 0, shortW: 0, a05: 0, a25: 0, jumpW: 0, u2W: 0, trimCap: 0, inMul: 1 });

export const SETS = {
  practice: [0, 1, 2, 3, 4, 5].map((i) => Date.parse('2026-11-12T06:00:00Z') / 1000 + i * 4 * 3600),
  all: checkpoints('2026-11-12T03:00:00Z', 20),
  late: checkpoints('2026-11-13T00:00:00Z', 20),
  recent: checkpoints('2026-11-12T19:00:00Z', 20),
  mix: checkpoints('2026-11-12T03:00:00Z', 20).concat(checkpoints('2026-11-12T19:00:00Z', 20)),
};

if (import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/').split('/').pop()!)) {
  const P: Params = { ...DEFAULT, ...(process.argv[2] ? JSON.parse(process.argv[2]) : {}) };
  const f: F = (p, ctx) => forecastMarket(p, HOR, P, ctx);
  console.log('history end', iso(END));
  for (const [k, Ts] of Object.entries(SETS)) console.log(k.padEnd(9), Ts.length, 'base', evalSet(Ts, base).toFixed(6), 'model', evalSet(Ts, f).toFixed(6));
}
