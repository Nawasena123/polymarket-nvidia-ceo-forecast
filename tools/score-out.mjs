// Validate and score .out files against the fetched history: node tools/score-out.mjs <inputDir> <outDir> <history.json>
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
const [inDir, outDir, hist] = process.argv.slice(2);
const H = JSON.parse(readFileSync(hist, 'utf8')).markets;
const Q = [0.05, 0.25, 0.5, 0.75, 0.95];
let S = 0, N = 0, cov = 0, M = 0;
for (const f of readdirSync(inDir).filter((f) => f.endsWith('.in')).sort()) {
  const c = JSON.parse(readFileSync(join(inDir, f), 'utf8'));
  const raw = readFileSync(join(outDir, f.replace(/\.in$/, '.out')), 'utf8');
  if (raw.length > 1048576) throw new Error('too big ' + f);
  const o = JSON.parse(raw);
  if (Object.keys(o).join() !== 'forecasts') throw new Error('keys');
  const ids = new Set(c.markets.map((m) => m.id));
  if (o.forecasts.length !== ids.size) throw new Error('count');
  const at = Date.parse(c.at) / 1000;
  for (const r of o.forecasts) {
    if (Object.keys(r).sort().join() !== 'id,q' || !ids.has(r.id)) throw new Error('row');
    ids.delete(r.id);
    if (r.q.length !== c.horizon_minutes) throw new Error('rows');
    const hm = H.find((m) => m.id === r.id);
    const i0 = (at - hm.start) / 60;
    r.q.forEach((q, h) => {
      if (q.length !== 5 || q.some((v, j) => !Number.isFinite(v) || v < 0 || v > 1 || (j && v < q[j - 1]))) throw new Error('bad row');
      const y = hm.prices[i0 + 1 + h];
      if (y === undefined) return;
      q.forEach((v, j) => { const d = y - v; S += 100 * Math.max(Q[j] * d, (Q[j] - 1) * d); N++; });
      M++; if (q[0] <= y && y <= q[4]) cov++;
    });
  }
}
console.log('valid; loss', (S / N).toFixed(6), 'coverage90', (cov / M).toFixed(4));
