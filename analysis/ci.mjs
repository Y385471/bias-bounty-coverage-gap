// Addendum: per-region table, bootstrap confidence intervals and a region-stratified (Mantel-Haenszel) risk ratio
// for the "reference holes" finding. Same inputs and definitions as holes2.mjs (hole = < 0.5 Microsoft footprints
// per ACS residential structure; tracts with >= 150 structures).
import fs from "node:fs";
import path from "node:path";
import { DATA, loadTracts, num, median } from "./load.mjs";

const B = new Map();
for (const line of fs.readFileSync(path.join(DATA, "acs-b25024-2023.dat"), "utf8").split("\n")) {
  if (!line.startsWith("1400000US")) continue;
  const f = line.split("|"), e = i => +f[1 + (i - 1) * 2] || 0;
  B.set(f[0].slice(9), { structures: e(2) + e(3) / 2 + e(4) / 2 + e(5) / 3.5 + e(6) / 7 + e(7) / 14.5 + e(8) / 35 + e(9) / 100 + e(10) + e(11) });
}
const T = loadTracts().map(t => {
  const b = B.get(t.GEOID) || {}, ms = num(t.bldg_microsoft);
  return { g: t.GEOID, region: t.region, urban: t.ur_class === "Urban", svi: num(t.svi_overall), pop: num(t.pop_total) || 0,
    bgap: t.building_gap === "" ? NaN : num(t.building_gap), s: b.structures, r: b.structures > 0 ? ms / b.structures : NaN };
}).filter(t => t.s >= 150 && isFinite(t.r) && isFinite(t.svi));
T.forEach(t => { t.hole = t.r < 0.5; });

// seeded RNG for reproducible bootstrap
let seed = 42; const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
const q = (a, p) => { const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };

// ---- 1. per-region table
console.log("region            tracts  holes  people_in_holes  holes_with_building_gap=0  medianSVI(holes/rest)");
for (const reg of [...new Set(T.map(t => t.region))].sort()) {
  const a = T.filter(t => t.region === reg), h = a.filter(t => t.hole);
  console.log(`${reg.padEnd(18)}${String(a.length).padStart(6)}${String(h.length).padStart(7)}${Math.round(h.reduce((s, t) => s + t.pop, 0)).toLocaleString().padStart(17)}` +
    `${String(h.filter(t => t.bgap === 0).length + " / " + h.length).padStart(27)}   ${h.length ? median(h.map(t => t.svi)).toFixed(2) : "—"} / ${median(a.filter(t => !t.hole).map(t => t.svi)).toFixed(2)}`);
}

// ---- 2. SVI terciles (pooled over regions): hole rate top vs bottom tercile, bootstrap CI
const byTercile = arr => { const s = [...arr].sort((x, y) => x.svi - y.svi), n = s.length; return [s.slice(0, Math.floor(n / 3)), s.slice(Math.floor(2 * n / 3))]; };
const rate = a => a.filter(t => t.hole).length / a.length;
const rr = arr => { const [lo, hi] = byTercile(arr); return rate(hi) / Math.max(rate(lo), 1e-9); };
const boot = (arr, f, B = 5000) => { const out = []; for (let i = 0; i < B; i++) { const s = arr.map(() => arr[Math.floor(rnd() * arr.length)]); out.push(f(s)); } return [q(out, .025), q(out, .975)]; };
const [lo, hi] = byTercile(T);
console.log(`\nhole rate, lowest-SVI tercile ${(100 * rate(lo)).toFixed(2)}% vs highest-SVI tercile ${(100 * rate(hi)).toFixed(2)}%  -> ratio ${rr(T).toFixed(2)}, 95% CI [${boot(T, rr).map(v => v.toFixed(2)).join(", ")}]`);

// ---- 3. region-stratified Mantel-Haenszel risk ratio (top vs bottom SVI tercile within each region)
const mh = arr => { let num_ = 0, den = 0;
  for (const reg of new Set(arr.map(t => t.region))) { const a = arr.filter(t => t.region === reg); if (a.length < 30) continue;
    const [l, h] = byTercile(a), n = l.length + h.length; const ah = h.filter(t => t.hole).length, al = l.filter(t => t.hole).length;
    num_ += ah * l.length / n; den += al * h.length / n; }
  return num_ / Math.max(den, 1e-9); };
const strat = arr => { const out = []; const regs = [...new Set(arr.map(t => t.region))]; for (let i = 0; i < 5000; i++) { const s = [];
  for (const reg of regs) { const a = arr.filter(t => t.region === reg); for (let k = 0; k < a.length; k++) s.push(a[Math.floor(rnd() * a.length)]); } out.push(mh(s)); } return [q(out, .025), q(out, .975)]; };
console.log(`region-stratified (MH) risk ratio, top vs bottom SVI tercile: ${mh(T).toFixed(2)}, 95% CI [${strat(T).map(v => v.toFixed(2)).join(", ")}]`);
const U = T.filter(t => t.urban);
console.log(`urban tracts only (n=${U.length}): MH risk ratio ${mh(U).toFixed(2)}, 95% CI [${strat(U).map(v => v.toFixed(2)).join(", ")}]`);

// ---- 4. how often the scorecard says "no building gap" where the reference itself has a hole
const H = T.filter(t => t.hole), blind = a => a.filter(t => t.bgap === 0).length / a.length;
console.log(`\nhole tracts scored building_gap = 0: ${H.filter(t => t.bgap === 0).length}/${H.length} = ${(100 * blind(H)).toFixed(0)}%, 95% CI [${boot(H, blind).map(v => (100 * v).toFixed(0) + "%").join(", ")}]`);
