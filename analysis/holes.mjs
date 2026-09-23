// "Reference holes": tracts whose housing is mostly low-rise (so footprints should roughly track housing units)
// but where the Microsoft reference holds far fewer footprints than homes. building_gap = 1 - min(1, OV/MS)
// cannot see a hole in MS: it reads 0 (or undefined when MS = 0) no matter how much is missing.
import { loadTracts, num, median, mean } from "./load.mjs";

const T = loadTracts().map(t => {
  const hu = num(t.housing_units), ms = num(t.bldg_microsoft), ov = num(t.bldg_overture);
  const munit = num(t.cdc_EP_MUNIT);            // % of housing units in 10+ unit buildings
  const lowRiseHU = hu * (1 - (isFinite(munit) ? munit : 0) / 100);
  return { ...t, hu, ms, ov, munit, lowRiseHU, pctMobile: num(t.cdc_EP_MOBILE), svi: num(t.svi_overall),
    cvi: num(t.cvi_overall), pop: num(t.pop_total), noVeh: num(t.cdc_EP_NOVEH), limEng: num(t.cdc_EP_LIMENG),
    age65: num(t.cdc_EP_AGE65), noInt: num(t.cdc_EP_NOINT), bgap: t.building_gap === "" ? NaN : num(t.building_gap),
    msCover: lowRiseHU > 0 ? ms / lowRiseHU : NaN, ovCover: lowRiseHU > 0 ? ov / lowRiseHU : NaN };
}).filter(t => t.lowRiseHU >= 200 && isFinite(t.msCover));

const HOLE = 0.35;   // Microsoft holds < 35 footprints per 100 low-rise homes
const holes = T.filter(t => t.msCover < HOLE), rest = T.filter(t => t.msCover >= HOLE);
const fmt = (a, k, d = 2) => { const v = a.map(t => t[k]).filter(Number.isFinite); return v.length ? median(v).toFixed(d) : "—"; };

console.log(`low-rise tracts (>=200 low-rise homes): ${T.length}; reference holes (MS/low-rise HU < ${HOLE}): ${holes.length}`);
console.log("\n                     holes     rest");
for (const [k, lab] of [["svi", "SVI overall"], ["cvi", "CVI overall"], ["pctMobile", "% mobile homes"], ["noVeh", "% no vehicle"],
  ["limEng", "% limited English"], ["noInt", "% no internet"], ["age65", "% age 65+"], ["msCover", "MS per low-rise home"], ["ovCover", "OV per low-rise home"], ["bgap", "building_gap"]])
  console.log(`${lab.padEnd(21)}${fmt(holes, k).padStart(6)}  ${fmt(rest, k).padStart(7)}`);

const popH = holes.reduce((a, t) => a + (t.pop || 0), 0);
console.log(`\npeople living in hole tracts: ${Math.round(popH).toLocaleString()}; their building_gap: ` +
  `${holes.filter(t => !isFinite(t.bgap)).length} undefined, ${holes.filter(t => t.bgap === 0).length} exactly 0, ` +
  `${holes.filter(t => t.bgap > 0).length} > 0`);

console.log("\nby region / urban-rural:");
for (const r of [...new Set(T.map(t => t.region))]) {
  const a = T.filter(t => t.region === r), h = a.filter(t => t.msCover < HOLE);
  console.log(`  ${r.padEnd(17)} ${String(h.length).padStart(4)} / ${a.length}   rural holes ${h.filter(t => t.ur_class === "Rural").length}`);
}

console.log("\nholes, sorted by SVI:");
for (const t of holes.sort((a, b) => b.svi - a.svi).slice(0, 25))
  console.log(`  ${t.GEOID} ${t.region.padEnd(16)} ${t.ur_class.padEnd(5)} lowRiseHU=${String(Math.round(t.lowRiseHU)).padEnd(5)} MS=${String(t.ms).padEnd(5)} OV=${String(t.ov).padEnd(5)} mobile%=${String(t.pctMobile).padEnd(5)} SVI=${t.svi} bgap=${t.bgap}`);
