// Loss per time block for several parameter sets: node tools/blocks.ts '<json>' '<json>' ...
import { DEFAULT, forecastMarket, type Params } from '../main.ts';
import { evalSet, SETS } from './bt.ts';
const sets = process.argv.slice(2).map((s) => ({ ...DEFAULT, ...JSON.parse(s) }) as Params);
const all = SETS.all; const nb = 6; const sz = Math.ceil(all.length / nb);
for (let b = 0; b < nb; b++) {
  const Ts = all.slice(b * sz, (b + 1) * sz); if (!Ts.length) continue;
  console.log(new Date(Ts[0] * 1000).toISOString().slice(5, 16), sets.map((P) => evalSet(Ts, (p, ctx) => forecastMarket(p, 240, P, ctx)).toFixed(5)).join('  '));
}
