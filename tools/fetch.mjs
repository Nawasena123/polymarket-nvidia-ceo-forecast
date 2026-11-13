// Fetch 1-minute Yes price history for every market of a practice case from Polymarket's
// public prices-history endpoint, and put it on the house's 1-minute grid.
// Usage: node tools/fetch.mjs <case.in> <outdir> <startIso> <endIso>
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const [caseFile, outDir, startIso, endIso] = process.argv.slice(2);
const c = JSON.parse(readFileSync(caseFile, 'utf8'));
mkdirSync(outDir, { recursive: true });
const start = Math.floor(Date.parse(startIso) / 1000);
const end = Math.floor(Date.parse(endIso) / 1000);
const WIN = 6 * 86400;

const markets = [];
for (const m of c.markets) {
  const pts = [];
  for (let s = start; s < end; s += WIN) {
    const e = Math.min(end, s + WIN);
    const url = `https://clob.polymarket.com/prices-history?market=${m.yes_token}&startTs=${s}&endTs=${e}&fidelity=1`;
    const r = await fetch(url);
    if (!r.ok) { console.error(m.name, r.status); continue; }
    const j = await r.json();
    for (const p of j.history ?? []) pts.push(p);
  }
  pts.sort((a, b) => a.t - b.t);
  if (!pts.length) { console.error('no points', m.name); continue; }
  // grid: minute m holds last point with t <= m; start at first whole minute >= first point
  const first = Math.ceil(pts[0].t / 60) * 60;
  const lastMin = Math.floor(end / 60) * 60;
  const prices = [];
  let k = 0, cur = null;
  for (let t = first; t <= lastMin; t += 60) {
    while (k < pts.length && pts[k].t <= t) { cur = pts[k].p; k++; }
    prices.push(cur);
  }
  markets.push({ id: m.id, name: m.name, start: first, prices });
  console.error(m.name, pts.length, prices.length, prices[prices.length - 1]);
}
writeFileSync(join(outDir, 'history.json'), JSON.stringify({ markets }));
