// Shared loader: joins the scored tracts with the strata table, CDC SVI 2022 detail and ACS housing.
// Plain CSV parsing so it runs on stock Node with no packages.
import fs from "node:fs";
import path from "node:path";

export const DATA = path.resolve(import.meta.dirname, "../../data");
export const REGIONS = ["northern-ca", "eastern-ok", "maricopa-az", "south-central-tx"];
const SVI_STATES = { "04": "Arizona", "06": "California", "35": "NewMexico", "40": "Oklahoma", "48": "Texas" };

export function readCsv(file) {
  const text = fs.readFileSync(file, "utf8").replace(/^﻿/, "");
  const rows = [];
  let row = [], field = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') q = false;
      else field += c;
    } else if (c === '"') q = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field); field = "";
      if (row.length > 1 || row[0] !== "") rows.push(row);
      row = [];
    } else field += c;
  }
  if (field !== "" || row.length) { row.push(field); rows.push(row); }
  const [head, ...body] = rows;
  return body.map(r => Object.fromEntries(head.map((h, i) => [h, r[i]])));
}

export const num = v => (v === undefined || v === "" || v === "NA" || v === "nan" || v === "None" ? NaN : +v);

let sviCache;
function svi() {
  if (sviCache) return sviCache;
  sviCache = new Map();
  for (const st of Object.values(SVI_STATES)) {
    for (const r of readCsv(path.join(DATA, `svi2022-${st}.csv`))) sviCache.set(r.FIPS.padStart(11, "0"), r);
  }
  return sviCache;
}

/** One object per scored tract, with every source merged on GEOID. */
export function loadTracts(scoredFile = path.join(DATA, "scored-all.csv")) {
  const scored = readCsv(scoredFile);
  const strata = new Map(), acs = new Map();
  for (const r of REGIONS) {
    for (const s of readCsv(path.join(DATA, `${r}-strata.csv`))) strata.set(s.GEOID, s);
    for (const a of readCsv(path.join(DATA, `${r}-acs.csv`))) acs.set(a.GEOID, a);
  }
  const S = svi();
  return scored.map(t => {
    const g = t.GEOID.padStart(11, "0");
    const s = strata.get(g) || {}, v = S.get(g) || {}, a = acs.get(g) || {};
    const o = { ...s, ...t, GEOID: g };
    for (const k of Object.keys(v)) if (/^(E_|EP_|RPL_|AREA_SQMI)/.test(k)) o["cdc_" + k] = v[k];
    o.housing_units = a.housing_units;
    return o;
  });
}

// ---- small stats helpers
export const mean = a => a.reduce((x, y) => x + y, 0) / a.length;
export const median = a => { const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
export function quantiles(a, qs) { const s = [...a].sort((x, y) => x - y); return qs.map(q => s[Math.min(s.length - 1, Math.floor(q * s.length))]); }
export function spearman(x, y) {
  const rank = a => { const idx = a.map((v, i) => [v, i]).sort((p, q) => p[0] - q[0]); const r = Array(a.length); idx.forEach(([, i], k) => (r[i] = k)); return r; };
  const rx = rank(x), ry = rank(y), mx = mean(rx), my = mean(ry);
  let n = 0, dx = 0, dy = 0;
  for (let i = 0; i < x.length; i++) { n += (rx[i] - mx) * (ry[i] - my); dx += (rx[i] - mx) ** 2; dy += (ry[i] - my) ** 2; }
  return n / Math.sqrt(dx * dy);
}
