// Per-market share of the loss for given params, over a checkpoint set.
import { DEFAULT, forecastMarket, QUANTILES, type Params } from '../main.ts';
import { caseAt, SETS, checkpoints } from './bt.ts';
const P: Params = { ...DEFAULT, ...JSON.parse(process.argv[2] ?? '{}') };
const Ts = process.argv[3] === 'practice' ? SETS.practice : checkpoints('2026-11-12T03:00:00Z', 20);
const acc: Record<string, { s: number; n: number; px: number }> = {};
let S = 0, N = 0;
for (const T of Ts) for (const { m, p, y } of caseAt(T)) {
  const q = forecastMarket(p, 240, P);
  let s = 0;
  for (let h = 0; h < 240; h++) for (let j = 0; j < 5; j++) { const d = y[h] - q[h][j]; s += 100 * Math.max(QUANTILES[j] * d, (QUANTILES[j] - 1) * d); }
  const a = (acc[m.name] ??= { s: 0, n: 0, px: 0 }); a.s += s; a.n += 1200; a.px += p[p.length - 1]; S += s; N += 1200;
}
console.log('total', (S / N).toFixed(6));
for (const [k, a] of Object.entries(acc).sort((x, y) => y[1].s - x[1].s)) console.log(k.padEnd(26), 'share', (a.s / S * 100).toFixed(1).padStart(5) + '%', 'loss', (a.s / a.n).toFixed(4), 'avgpx', (a.px / (a.n / 1200)).toFixed(3));
