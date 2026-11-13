// Coordinate-descent tuner over the forecaster's parameters on a training set of checkpoints,
// reporting the held-out loss too. Usage: node tools/tune.ts [startParamsJSON] [rounds]
import { DEFAULT, forecastMarket, type Params } from '../main.ts';
import { checkpoints, evalSet, SETS } from './bt.ts';

const train = process.env.TRAIN ? SETS[process.env.TRAIN as keyof typeof SETS] : checkpoints('2026-11-12T03:00:00Z', 20).filter((T) => T < Date.parse('2026-11-12T23:00:00Z') / 1000);
const test = SETS.late;
const loss = (P: Params, Ts: number[]) => evalSet(Ts, (p, ctx) => forecastMarket(p, 240, P, ctx));

let P: Params = { ...DEFAULT, ...(process.argv[2] ? JSON.parse(process.argv[2]) : {}) };
const rounds = Number(process.argv[3] ?? 3);
const keys = (process.env.KEYS ? process.env.KEYS.split(',') : Object.keys(DEFAULT)) as (keyof Params)[];
let best = loss(P, train);
console.log('start train', best.toFixed(6), 'test', loss(P, test).toFixed(6));
for (let r = 0; r < rounds; r++) {
  for (const k of keys) {
    const v0 = P[k] as number;
    const signed = ['a05', 'a25', 'dW', 'sumW'].includes(k);
    const cands = v0 === 0 ? [0.05, 0.1, 0.2, -0.05, -0.1, -0.2] : [0.5, 0.7, 0.85, 1.15, 1.4, 2].map((f) => v0 * f);
    if (signed && v0 !== 0) cands.push(v0 + 0.05, v0 - 0.05, v0 + 0.15, v0 - 0.15);
    for (const v of cands) {
      const Q = { ...P, [k]: Number.isInteger(DEFAULT[k]) && Math.abs(v0) >= 1 ? Math.max(1, Math.round(v)) : v } as Params;
      const l = loss(Q, train);
      if (l < best - 1e-7) { best = l; P = Q; }
    }
  }
  console.log('round', r, 'train', best.toFixed(6), 'test', loss(P, test).toFixed(6), 'practice', loss(P, SETS.practice).toFixed(6), JSON.stringify(P));
}
