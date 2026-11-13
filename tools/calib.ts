// Calibration: share of prices below each quantile level, by horizon bucket, on a checkpoint set.
import { DEFAULT, forecastMarket } from '../main.ts';
import { caseAt, SETS } from './bt.ts';
const set = (process.argv[2] ?? 'all') as keyof typeof SETS;
const B = [[1, 15], [16, 60], [61, 150], [151, 240]];
const cnt = B.map(() => [0, 0, 0, 0, 0]); const tot = B.map(() => 0);
for (const T of SETS[set]) {
  const cs = caseAt(T); const ctx = { sum: cs.reduce((a, { p }) => a + p[p.length - 1], 0) };
  for (const { p, y } of cs) {
    const q = forecastMarket(p, 240, DEFAULT, ctx);
    for (let h = 1; h <= 240; h++) { const b = B.findIndex(([a, z]) => h >= a && h <= z); tot[b]++; for (let j = 0; j < 5; j++) if (y[h - 1] < q[h - 1][j]) cnt[b][j]++; }
  }
}
B.forEach(([a, z], b) => console.log(`h ${a}-${z}`.padEnd(10), cnt[b].map((c) => (c / tot[b]).toFixed(3)).join('  ')));
