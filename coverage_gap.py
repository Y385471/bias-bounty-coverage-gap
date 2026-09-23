"""Coverage-gap scoring for the Zindi Bias Bounty Mapping Equity Challenge.

Reads every layer straight from the public Source Cooperative bucket with DuckDB
(no download), computes the three components per Census tract exactly as the
challenge defines them, and writes one CSV per region plus a combined submission.

    python coverage_gap.py [region ...]      # default: all four regions

Every intermediate count is kept in the output (not only the gaps), so the
bias analysis can be rerun without touching the map layers again.
"""
import sys, time
import duckdb
import pandas as pd

B = "s3://us-west-2.opendata.source.coop/humane-intelligence/bias-bounty-mapping-equity-challenge"
REGIONS = ["northern-ca", "eastern-ok", "maricopa-az", "south-central-tx"]

OVERTURE_ROAD_CLASSES = ("motorway", "trunk", "primary", "secondary")
TIGER_ROAD_MTFCC = ("S1100", "S1200")
POI_TYPES = {
    "fire": ("fire-stations", ["fire_department"]),
    "ems": ("ems-stations", ["ambulance_and_ems_services"]),
    "schools": ("schools", ["elementary_school", "middle_school", "high_school",
                            "school", "private_school", "public_school"]),
}


def ref(region, layer):
    return f"{B}/reference/{region}/{region}-{layer}.parquet"


def connect():
    con = duckdb.connect()
    for s in ["INSTALL httpfs", "LOAD httpfs", "INSTALL spatial", "LOAD spatial",
              "SET s3_region='us-west-2'", "SET s3_url_style='path'"]:
        con.sql(s)
    return con


def log(msg, t0=[time.time()]):
    print(f"[{time.time() - t0[0]:7.1f}s] {msg}", flush=True)


def gap(o, r):
    """1 - min(1, overture/reference); undefined (NaN) when there is no reference."""
    return (1 - (o / r).clip(upper=1)).where(r > 0)


def region_counts(con, region):
    con.sql(f"""
        CREATE OR REPLACE TABLE tracts AS
        SELECT GEOID, geometry AS geom
        FROM '{B}/strata/{region}/{region}-census-tracts.parquet'
    """)
    scored = pd.read_csv(f"https://data.source.coop/humane-intelligence/bias-bounty-mapping-equity-challenge/reference/{region}/{region}-sample-submission.csv",
                         dtype={"GEOID": str})[["GEOID"]]
    out = scored.copy()

    def per_tract(sql, name):
        df = con.sql(sql).df()
        df["GEOID"] = df["GEOID"].astype(str)
        return df.rename(columns={"v": name})

    # --- roads: length (km, EPSG:5070) of the named-highway classes inside each tract
    L = "ST_Length(ST_Transform(ST_Intersection(x.geometry, t.geom), 'EPSG:4326', 'EPSG:5070', always_xy := true)) / 1000"
    for name, src, where in [
        ("road_km_overture", ref(region, "overture-roads"), f"x.class IN {OVERTURE_ROAD_CLASSES}"),
        ("road_km_tiger", ref(region, "census-tiger-roads"), f"x.MTFCC IN {TIGER_ROAD_MTFCC}"),
    ]:
        log(f"{region}: {name}")
        out = out.merge(per_tract(f"""
            SELECT t.GEOID, sum({L}) AS v
            FROM '{src}' x JOIN tracts t ON ST_Intersects(x.geometry, t.geom)
            WHERE {where} GROUP BY 1""", name), on="GEOID", how="left")

    # --- buildings: footprints whose centroid falls in the tract
    for name, layer in [("bldg_overture", "overture-buildings"), ("bldg_microsoft", "microsoft-buildings")]:
        log(f"{region}: {name}")
        out = out.merge(per_tract(f"""
            SELECT t.GEOID, count(*) AS v
            FROM '{ref(region, layer)}' x JOIN tracts t ON ST_Contains(t.geom, ST_Centroid(x.geometry))
            GROUP BY 1""", name), on="GEOID", how="left")

    # --- POIs: Overture places by category vs USGS/HIFLD facility points
    log(f"{region}: overture places")
    con.sql(f"""
        CREATE OR REPLACE TABLE places AS
        SELECT t.GEOID, x.categories.primary AS cat
        FROM '{ref(region, "overture-pois")}' x JOIN tracts t ON ST_Contains(t.geom, x.geometry)
    """)
    out = out.merge(per_tract("SELECT GEOID, count(*) AS v FROM places GROUP BY 1", "places_all"), on="GEOID", how="left")
    for key, (layer, cats) in POI_TYPES.items():
        cat_list = ", ".join(f"'{c}'" for c in cats)
        out = out.merge(per_tract(f"SELECT GEOID, count(*) AS v FROM places WHERE cat IN ({cat_list}) GROUP BY 1",
                                  f"{key}_overture"), on="GEOID", how="left")
        out = out.merge(per_tract(f"""
            SELECT t.GEOID, count(*) AS v
            FROM '{ref(region, "hifld-" + layer)}' x JOIN tracts t ON ST_Contains(t.geom, x.geometry)
            GROUP BY 1""", f"{key}_hifld"), on="GEOID", how="left")

    cbp = con.sql(f"SELECT GEOID, cbp_estab FROM '{ref(region, 'census-cbp')}'").df()
    cbp["GEOID"] = cbp["GEOID"].astype(str)
    out = out.merge(cbp, on="GEOID", how="left")

    count_cols = [c for c in out.columns if c != "GEOID"]
    out[count_cols] = out[count_cols].fillna(0)
    out.insert(1, "region", region)
    return out


def score(df):
    d = df.copy()
    d["transport_gap"] = gap(d.road_km_overture, d.road_km_tiger)
    d["building_gap"] = gap(d.bldg_overture, d.bldg_microsoft)
    for k in POI_TYPES:
        d[f"poi_gap_{k}"] = gap(d[f"{k}_overture"], d[f"{k}_hifld"])
    d["poi_gap_hifld"] = d[[f"poi_gap_{k}" for k in POI_TYPES]].mean(axis=1, skipna=True)
    d["poi_gap_cbp"] = gap(d.places_all, d.cbp_estab)
    d["poi_gap"] = d[["poi_gap_hifld", "poi_gap_cbp"]].mean(axis=1, skipna=True)
    d["coverage_gap_score"] = d[["transport_gap", "building_gap", "poi_gap"]].mean(axis=1, skipna=True)
    return d


def submission(d):
    s = pd.DataFrame({"GEOID": d.GEOID, "coverage_gap_score": d.coverage_gap_score, "region": d.region})
    for comp, flag in [("transport_gap", "transport_defined"), ("building_gap", "building_defined"),
                       ("poi_gap", "poi_defined"), ("poi_gap_fire", "poi_defined_fire"),
                       ("poi_gap_ems", "poi_defined_ems"), ("poi_gap_schools", "poi_defined_schools"),
                       ("poi_gap_cbp", "poi_defined_cbp")]:
        s[comp] = d[comp].fillna(0).round(6)
        s[flag] = d[comp].notna().map({True: "TRUE", False: "FALSE"})
    s["coverage_gap_score"] = s["coverage_gap_score"].fillna(0).round(6)
    return s


if __name__ == "__main__":
    regions = sys.argv[1:] or REGIONS
    con = connect()
    parts = []
    for r in regions:
        counts = region_counts(con, r)
        counts.to_csv(f"counts-{r}.csv", index=False)
        parts.append(score(counts))
        log(f"{r}: done, {len(counts)} tracts")
    full = pd.concat(parts, ignore_index=True)
    full.to_csv("scored-all.csv", index=False)
    submission(full).to_csv("submission.csv", index=False)
    print(full.groupby("region")[["transport_gap", "building_gap", "poi_gap", "coverage_gap_score"]].describe().T.round(4).to_string())
