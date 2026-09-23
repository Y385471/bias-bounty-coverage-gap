// Robustness of the volunteer-patching finding: vary the hole threshold, the patched/unpatched cut-off and the
// multi-unit structure weights; test SVI(patched) < SVI(unpatched) with a permutation test on the difference in medians.
import fs from "node:fs";
import path from "node:path";
import { DATA, loadTracts, num, median } from "./load.mjs";

const rows = new Map();
for (const line of fs.readFileSync(path.join(DATA, "acs-b25024-2023.dat"), "utf8").split("\n")) {
  if (!line.startsWith("1400000US")) continue;
  const f = line.split("|"); const e = i => +f[1 + (i - 1) * 2] || 0;
  rows.set(f[0].slice(9), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].map(e));
}
const base = loadTracts().map(t => ({ g: t.GEOID, ms: num(t.bldg_microsoft), ov: num(t.bldg_overture), svi: num(t.svi_overall),
  pov: num(t.cdc_EP_POV150), noVeh: num(t.cdc_EP_NOVEH), pop: num(t.pop_total), u: rows.get(t.GEOID) })).filter(t => t.u && isFinite(t.svi));

const WEIGHTS = {
  midpoint: [1, 1 / 2, 1 / 2, 1 / 3.5, 1 / 7, 1 / 14.5, 1 / 35, 1 / 100, 1, 1],
  conservative: [1, 1, 1 / 2, 1 / 3, 1 / 5, 1 / 10, 1 / 20, 1 / 50, 1, 1],   // more structures per unit → easier to be a "hole"? no: more expected structures
  lenient: [1, 1 / 4, 1 / 2, 1 / 4, 1 / 9, 1 / 19, 1 / 49, 1 / 150, 0.8, 0.5],   // fewer expected structures → fewer holes
};
function structures(u, w) { return u[1] * w[0] + u[2] * w[1] + u[3] * w[2] + u[4] * w[3] + u[5] * w[4] + u[6] * w[5] + u[7] * w[6] + u[8] * w[7] + u[9] * w[8] + u[10] * w[9]; }

let seed = 42; const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
function permTest(a, b, iters = 5000) {
  const obs = median(b) - median(a), all = a.concat(b); let ge = 0;
  for (let i = 0; i < iters; i++) {
    for (let j = all.length - 1; j > 0; j--) { const k = Math.floor(rnd() * (j + 1)); [all[j], all[k]] = [all[k], all[j]]; }
    if (median(all.slice(a.length)) - median(all.slice(0, a.length)) >= obs) ge++;
  }
  return { obs, p: (ge + 1) / (iters + 1) };
}

console.log("weights       hole<  patched>=  n_holes  n_patched  n_unpatched  SVI_p  SVI_u  pov_p  pov_u  noVeh_p noVeh_u   perm p (SVI)");
for (const [wn, w] of Object.entries(WEIGHTS)) for (const hole of [0.4, 0.5, 0.6]) for (const cut of [0.7, 0.8]) {
  const T = base.map(t => { const s = structures(t.u, w); return { ...t, s, msR: s >= 150 ? t.ms / s : NaN, ovR: s >= 150 ? t.ov / s : NaN }; }).filter(t => isFinite(t.msR));
  const H = T.filter(t => t.msR < hole), P = H.filter(t => t.ovR >= cut), U = H.filter(t => t.ovR < cut);
  if (P.length < 5 || U.length < 5) { console.log(`${wn.padEnd(13)} ${hole}   ${cut}   too few`); continue; }
  const { p } = permTest(P.map(t => t.svi), U.map(t => t.svi));
  const m = (a, k) => median(a.map(t => t[k]).filter(Number.isFinite)).toFixed(2);
  console.log(`${wn.padEnd(13)} ${hole.toFixed(1)}   ${cut.toFixed(1)}       ${String(H.length).padStart(5)}  ${String(P.length).padStart(9)}  ${String(U.length).padStart(11)}  ${m(P, "svi")}   ${m(U, "svi")}   ${m(P, "pov").padStart(5)}  ${m(U, "pov").padStart(5)}  ${m(P, "noVeh").padStart(6)}  ${m(U, "noVeh").padStart(6)}   ${p.toFixed(4)}`);
}
