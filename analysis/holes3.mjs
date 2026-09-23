// Split reference holes into (A) "stale reference" (Overture has the homes, Microsoft doesn't) and
// (B) "double miss" (neither source has them) — and test whether holes are new construction (ACS B25034).
import fs from "node:fs";
import path from "node:path";
import { DATA, loadTracts, num, median } from "./load.mjs";

const readDat = (file, fn) => { const m = new Map(); for (const line of fs.readFileSync(path.join(DATA, file), "utf8").split("\n")) {
  if (!line.startsWith("1400000US")) continue; const f = line.split("|"); const e = i => +f[1 + (i - 1) * 2] || 0; m.set(f[0].slice(9), fn(e)); } return m; };
const U = readDat("acs-b25024-2023.dat", e => ({ hu: e(1), det: e(2), mobile: e(10),
  structures: e(2) + e(3) / 2 + e(4) / 2 + e(5) / 3.5 + e(6) / 7 + e(7) / 14.5 + e(8) / 35 + e(9) / 100 + e(10) + e(11) }));
const Y = readDat("acs-b25034-2023.dat", e => ({ yrTot: e(1), y2020: e(2), y2010: e(3) }));

const T = loadTracts().map(t => {
  const u = U.get(t.GEOID) || {}, y = Y.get(t.GEOID) || {};
  const ms = num(t.bldg_microsoft), ov = num(t.bldg_overture);
  return { ...t, ...u, ...y, ms, ov, svi: num(t.svi_overall), pop: num(t.pop_total),
    new10: y.yrTot ? 100 * (y.y2020 + y.y2010) / y.yrTot : NaN, new20: y.yrTot ? 100 * y.y2020 / y.yrTot : NaN,
    noVeh: num(t.cdc_EP_NOVEH), limEng: num(t.cdc_EP_LIMENG), pov: num(t.cdc_EP_POV150),
    bgap: t.building_gap === "" ? NaN : num(t.building_gap), osm: num(t.bldg_ov_osm), msml: num(t.bldg_ov_msml), goog: num(t.bldg_ov_google),
    msR: u.structures > 0 ? ms / u.structures : NaN, ovR: u.structures > 0 ? ov / u.structures : NaN };
}).filter(t => t.structures >= 150 && isFinite(t.msR));

const holes = T.filter(t => t.msR < 0.5);
const A = holes.filter(t => t.ovR >= 0.8), Bm = holes.filter(t => t.ovR < 0.5), mid = holes.filter(t => t.ovR >= 0.5 && t.ovR < 0.8), rest = T.filter(t => t.msR >= 0.5);
const md = (a, k, d = 1) => { const v = a.map(t => t[k]).filter(Number.isFinite); return v.length ? median(v).toFixed(d) : "—"; };
const pop = a => Math.round(a.reduce((s, t) => s + (t.pop || 0), 0)).toLocaleString();
console.log("group                      tracts  people     %built2010+  %built2020+  SVI   %noVeh  %limEng  %pov<150  MS/str  OV/str  bgap=0");
for (const [lab, g] of [["A stale reference", A], ["B double miss", Bm], ["  in between", mid], ["all other tracts", rest]])
  console.log(`${lab.padEnd(26)} ${String(g.length).padStart(5)}  ${pop(g).padStart(9)}  ${md(g, "new10").padStart(10)}  ${md(g, "new20").padStart(10)}  ${md(g, "svi", 2)}  ${md(g, "noVeh").padStart(6)}  ${md(g, "limEng").padStart(7)}  ${md(g, "pov").padStart(8)}  ${md(g, "msR", 2).padStart(6)}  ${md(g, "ovR", 2).padStart(6)}  ${g.filter(t => t.bgap === 0).length}/${g.length}`);

console.log("\nB — double-miss tracts (both sources hold < half a footprint per residential structure):");
for (const t of Bm.sort((a, b) => a.ovR - b.ovR))
  console.log(`  ${t.GEOID} ${t.region.padEnd(16)} ${t.ur_class.padEnd(5)} struct=${t.structures.toFixed(0).padEnd(5)} det=${String(t.det).padEnd(5)} MS=${String(t.ms).padEnd(5)} OV=${String(t.ov).padEnd(5)} (osm ${t.osm}, msml ${t.msml}, google ${t.goog}) built2010+=${t.new10.toFixed(0)}% SVI=${t.svi} pop=${t.pop} bgap=${t.bgap}`);

console.log("\nA — stale-reference tracts, Overture source mix:");
const sum = (a, k) => a.reduce((s, t) => s + (t[k] || 0), 0);
console.log(`  Overture buildings ${sum(A, "ov")}: OSM ${sum(A, "osm")}, Microsoft-ML ${sum(A, "msml")}, Google ${sum(A, "goog")}`);
fs.writeFileSync(path.join(DATA, "holes-v3.json"), JSON.stringify({ A: A.map(t => t.GEOID), B: Bm.map(t => t.GEOID), mid: mid.map(t => t.GEOID) }));
