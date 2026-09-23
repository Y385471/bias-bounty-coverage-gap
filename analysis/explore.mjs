// First look: does the building reference (Microsoft footprints) itself under-count homes where
// mobile homes and informal housing concentrate? If so, building_gap reads ~0 exactly where homes are missing.
import { loadTracts, num, median, quantiles, spearman } from "./load.mjs";

const T = loadTracts().map(t => {
  const hu = num(t.housing_units), ms = num(t.bldg_microsoft), ov = num(t.bldg_overture);
  const mobile = num(t.cdc_E_MOBILE), munit = num(t.cdc_EP_MUNIT);
  return {
    ...t, hu, ms, ov, mobile, munit,
    pctMobile: num(t.cdc_EP_MOBILE), svi: num(t.svi_overall), rural: t.ur_class,
    msPerHu: hu > 0 ? ms / hu : NaN,
    ovPerHu: hu > 0 ? ov / hu : NaN,
    bgap: num(t.building_gap), caravan: num(t.bldg_ov_caravan), osmShare: ov > 0 ? num(t.bldg_ov_osm) / ov : NaN,
  };
}).filter(t => t.hu >= 50);

console.log("tracts with >=50 housing units:", T.length);
console.log("ur_class values:", [...new Set(T.map(t => t.rural))].join(", "));

const bands = [[0, 2], [2, 10], [10, 25], [25, 50], [50, 101]];
console.log("\n% mobile homes  | n    | median MS/HU | median OV/HU | median building_gap | share of tracts with MS/HU<0.5");
for (const [lo, hi] of bands) {
  const g = T.filter(t => t.pctMobile >= lo && t.pctMobile < hi && isFinite(t.msPerHu));
  if (!g.length) continue;
  const low = g.filter(t => t.msPerHu < 0.5).length / g.length;
  console.log(`${String(lo).padStart(3)}–${String(hi).padEnd(3)}%       | ${String(g.length).padEnd(4)} | ${median(g.map(t => t.msPerHu)).toFixed(2).padStart(12)} | ${median(g.map(t => t.ovPerHu)).toFixed(2).padStart(12)} | ${median(g.map(t => t.bgap)).toFixed(4).padStart(19)} | ${(100 * low).toFixed(1)}%`);
}

// within each region and urban/rural class, is MS/HU lower where mobile homes are common?
console.log("\nSpearman(pctMobile, MS/HU) by region × urban/rural:");
for (const r of [...new Set(T.map(t => t.region))]) for (const u of [...new Set(T.map(t => t.rural))]) {
  const g = T.filter(t => t.region === r && t.rural === u && isFinite(t.msPerHu) && isFinite(t.pctMobile));
  if (g.length < 30) continue;
  console.log(`  ${r.padEnd(17)} ${String(u).padEnd(10)} n=${String(g.length).padEnd(5)} rho=${spearman(g.map(t => t.pctMobile), g.map(t => t.msPerHu)).toFixed(3)}`);
}

// how many mobile homes does Overture tag explicitly?
const totMobile = T.reduce((a, t) => a + (t.mobile || 0), 0), totCaravan = T.reduce((a, t) => a + (t.caravan || 0), 0);
console.log(`\nACS mobile homes (SVI E_MOBILE) across scored tracts: ${totMobile.toLocaleString()}  | Overture buildings tagged static_caravan/caravan: ${totCaravan.toLocaleString()}`);

// quick look at the tracts where the reference looks thinnest relative to homes
const worst = T.filter(t => isFinite(t.msPerHu)).sort((a, b) => a.msPerHu - b.msPerHu).slice(0, 15);
console.log("\nLowest Microsoft-footprints-per-housing-unit tracts:");
for (const t of worst) console.log(`  ${t.GEOID} ${t.region.padEnd(17)} HU=${String(t.hu).padEnd(6)} MS=${String(t.ms).padEnd(6)} OV=${String(t.ov).padEnd(6)} MS/HU=${t.msPerHu.toFixed(2)} mobile%=${t.pctMobile} munit%=${t.munit} svi=${t.svi} ${t.rural} bgap=${t.bgap}`);
