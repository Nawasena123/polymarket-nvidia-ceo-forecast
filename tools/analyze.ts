// Conditional future moves: bucket each (market, minute) by its recent move over L minutes and
// report the mean and median move over the next h minutes, split up/down, as a fraction of the recent move.
import { H } from './bt.ts';
const from = Date.parse(process.env.FROM ?? '2026-11-11T00:00:00Z') / 1000;
for (const L of [3, 10, 30, 120, 480]) for (const h of [30, 240]) {
  const acc: Record<string, number[]> = { upBig: [], upSmall: [], dnSmall: [], dnBig: [] };
  for (const m of H) {
    const p = m.prices;
    const i0 = Math.max(L, (from - m.start) / 60);
    for (let i = i0; i + h < p.length; i += 2) {
      const r = p[i] - p[i - L];
      if (r === 0) continue;
      const f = (p[i + h] - p[i]) / r; // fraction of the recent move added (>0) or given back (<0)
      const big = Math.abs(r) > 0.02;
      acc[(r > 0 ? (big ? 'upBig' : 'upSmall') : big ? 'dnBig' : 'dnSmall')].push(Math.max(-3, Math.min(3, f)));
    }
  }
  const s = Object.entries(acc).map(([k, v]) => { const w = v.slice().sort((a, b) => a - b); return `${k} n=${v.length} mean=${(v.reduce((a, b) => a + b, 0) / v.length).toFixed(3)} med=${w[w.length >> 1]?.toFixed(3)}`; });
  console.log(`L=${L} h=${h}:`, s.join(' | '));
}
