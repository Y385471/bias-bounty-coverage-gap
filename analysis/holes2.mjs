// Reference holes, v2: compare Microsoft footprints with the number of residential *structures* the ACS implies
// (table B25024 units-in-structure, 2019-2023 5-year). A 4-plex is one building, a detached house is one building.
import fs from "node:fs";
import path from "node:path";
import { DATA, loadTracts, num, median, quantiles } from "./load.mjs";

// structures implied by units-in-structure (divide multi-unit counts by the band midpoint)
const B = new Map();
for (const line of fs.readFileSync(path.join(DATA, "acs-b25024-2023.dat"), "utf8").split("\n")) {
  if (!line.startsWith("1400000US")) continue;
  const f = line.split("|");
  const e = i => +f[1 + (i - 1) * 2] || 0;  // estimate columns E001..E011
  B.set(f[0].slice(9), {
    hu: e(1), det: e(2), att: e(3), u2: e(4), u34: e(5), u59: e(6), u1019: e(7), u2049: e(8), u50: e(9), mobile: e(10), rv: e(11),
    structures: e(2) + e(3) / 2 + e(4) / 2 + e(5) / 3.5 + e(6) / 7 + e(7) / 14.5 + e(8) / 35 + e(9) / 100 + e(10) + e(11),
  });
}

const T = loadTracts().map(t => {
  const b = B.get(t.GEOID) || {};
  const ms = num(t.bldg_microsoft), ov = num(t.bldg_overture);
  return { ...t, ...b, ms, ov, svi: num(t.svi_overall), pop: num(t.pop_total), noVeh: num(t.cdc_EP_NOVEH),
    limEng: num(t.cdc_EP_LIMENG), age65: num(t.cdc_EP_AGE65), pctMobile: b.hu ? 100 * b.mobile / b.hu : NaN,
    bgap: t.building_gap === "" ? NaN : num(t.building_gap),
    msPerStruct: b.structures > 0 ? ms / b.structures : NaN, ovPerStruct: b.structures > 0 ? ov / b.structures : NaN };
}).filter(t => t.structures >= 150 && isFinite(t.msPerStruct));

const med = median(T.map(t => t.msPerStruct));
console.log(`tracts: ${T.length}; ACS-matched: ${T.filter(t => t.hu).length}; median Microsoft footprints per ACS residential structure: ${med.toFixed(2)}`);
console.log("deciles of MS/structure:", quantiles(T.map(t => t.msPerStruct), [0.01, 0.05, 0.1, 0.25, 0.5, 0.75, 0.9]).map(v => v.toFixed(2)).join("  "));

const HOLE = 0.5;  // fewer than half a footprint per residential structure
const holes = T.filter(t => t.msPerStruct < HOLE), rest = T.filter(t => t.msPerStruct >= HOLE);
const m = (a, k, d = 2) => { const v = a.map(t => t[k]).filter(Number.isFinite); return v.length ? median(v).toFixed(d) : "—"; };
console.log(`\nholes (MS < ${HOLE} per structure): ${holes.length} tracts, ${Math.round(holes.reduce((a, t) => a + (t.pop || 0), 0)).toLocaleString()} people`);
console.log("                       holes     rest");
for (const [k, lab] of [["svi", "SVI overall"], ["noVeh", "% no vehicle"], ["limEng", "% limited English"], ["age65", "% 65+"], ["pctMobile", "% mobile homes"],
  ["msPerStruct", "MS per structure"], ["ovPerStruct", "OV per structure"], ["bgap", "building_gap"]])
  console.log(`${lab.padEnd(23)}${m(holes, k).padStart(6)}  ${m(rest, k).padStart(7)}`);
console.log(`building_gap in holes: ${holes.filter(t => !isFinite(t.bgap)).length} undefined, ${holes.filter(t => t.bgap === 0).length} = 0, ${holes.filter(t => t.bgap > 0).length} > 0`);

// SVI gradient of MS/structure, within urban tracts of each region
console.log("\nmedian MS per structure by SVI quintile (urban only):");
for (const r of [...new Set(T.map(t => t.region))]) {
  const a = T.filter(t => t.region === r && t.ur_class === "Urban" && isFinite(t.svi)).sort((x, y) => x.svi - y.svi);
  const q = [0, 1, 2, 3, 4].map(i => a.slice(Math.floor(i * a.length / 5), Math.floor((i + 1) * a.length / 5)));
  console.log(`  ${r.padEnd(17)} ` + q.map(g => median(g.map(t => t.msPerStruct)).toFixed(2)).join("  ") + `   (n=${a.length})`);
}

fs.writeFileSync(path.join(DATA, "holes-v2.csv"), ["GEOID,region,ur_class,structures,hu,ms,ov,msPerStruct,svi,pop,pctMobile,noVeh,limEng,bgap"]
  .concat(holes.sort((a, b) => a.msPerStruct - b.msPerStruct).map(t => [t.GEOID, t.region, t.ur_class, t.structures.toFixed(0), t.hu, t.ms, t.ov,
    t.msPerStruct.toFixed(3), t.svi, t.pop, t.pctMobile.toFixed(1), t.noVeh, t.limEng, t.bgap].join(","))).join("\n"));
console.log("\nworst 12:");
for (const t of holes.slice(0, 12)) console.log(`  ${t.GEOID} ${t.region.padEnd(16)} struct=${t.structures.toFixed(0).padEnd(5)} det=${String(t.det).padEnd(5)} MS=${String(t.ms).padEnd(5)} OV=${String(t.ov).padEnd(5)} ratio=${t.msPerStruct.toFixed(2)} SVI=${t.svi} mobile%=${t.pctMobile.toFixed(1)}`);
