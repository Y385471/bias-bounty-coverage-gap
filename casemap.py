"""Case-study figures: satellite imagery of a tract with Microsoft and Overture footprints on top.

    python casemap.py 48201550404 04013422218 ...

For each GEOID it writes case-<GEOID>.png. Imagery: Esri World Imagery tiles (attribution printed on the
figure). Footprints: the challenge's Microsoft and Overture layers, read from the public bucket with DuckDB.
"""
import io, math, sys
import duckdb, requests
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.collections import PolyCollection
from PIL import Image
import shapely.wkb

B = "s3://us-west-2.opendata.source.coop/humane-intelligence/bias-bounty-mapping-equity-challenge"
REGION = {"04": "maricopa-az", "35": "maricopa-az", "06": "northern-ca", "40": "eastern-ok", "48": "south-central-tx"}
TILE = "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"

con = duckdb.connect()
for s in ["INSTALL httpfs", "LOAD httpfs", "INSTALL spatial", "LOAD spatial", "SET s3_region='us-west-2'", "SET s3_url_style='path'"]:
    con.sql(s)


def lonlat_to_px(lon, lat, z):
    n = 256 * 2 ** z
    x = (lon + 180) / 360 * n
    y = (1 - math.log(math.tan(math.radians(lat)) + 1 / math.cos(math.radians(lat))) / math.pi) / 2 * n
    return x, y


def mosaic(xmin, ymin, xmax, ymax, z):
    x0, y1 = lonlat_to_px(xmin, ymin, z)
    x1, y0 = lonlat_to_px(xmax, ymax, z)
    tx0, tx1, ty0, ty1 = int(x0 // 256), int(x1 // 256), int(y0 // 256), int(y1 // 256)
    img = Image.new("RGB", ((tx1 - tx0 + 1) * 256, (ty1 - ty0 + 1) * 256))
    s = requests.Session()
    s.headers["User-Agent"] = "bias-bounty-casemap/1.0"
    for tx in range(tx0, tx1 + 1):
        for ty in range(ty0, ty1 + 1):
            r = s.get(TILE.format(z=z, x=tx, y=ty), timeout=30)
            if r.ok:
                img.paste(Image.open(io.BytesIO(r.content)).convert("RGB"), ((tx - tx0) * 256, (ty - ty0) * 256))
    return img, tx0 * 256, ty0 * 256


def polys(sql):
    out = []
    for (w,) in con.sql(sql).fetchall():
        g = shapely.wkb.loads(bytes(w))
        for p in getattr(g, "geoms", [g]):
            if p.geom_type == "Polygon":
                out.append(list(p.exterior.coords))
    return out


def figure(geoid):
    region = REGION[geoid[:2]]
    tract_wkb, = con.sql(f"SELECT ST_AsWKB(geometry) FROM '{B}/strata/{region}/{region}-census-tracts.parquet' WHERE GEOID = '{geoid}'").fetchone()
    tract = shapely.wkb.loads(bytes(tract_wkb))
    xmin, ymin, xmax, ymax = tract.bounds
    bbox = f"bbox.xmin <= {xmax} AND bbox.xmax >= {xmin} AND bbox.ymin <= {ymax} AND bbox.ymax >= {ymin}"
    ms = polys(f"SELECT ST_AsWKB(geometry) FROM '{B}/reference/{region}/{region}-microsoft-buildings.parquet' WHERE {bbox}")
    ov = polys(f"SELECT ST_AsWKB(geometry) FROM '{B}/reference/{region}/{region}-overture-buildings.parquet' WHERE {bbox}")

    span = max(xmax - xmin, (ymax - ymin) * 1.2)
    z = max(12, min(18, int(math.log2(360 / span * 1.6))))
    img, ox, oy = mosaic(xmin, ymin, xmax, ymax, z)
    px = lambda coords: [(lambda p: (p[0] - ox, p[1] - oy))(lonlat_to_px(x, y, z)) for x, y in coords]

    fig, axes = plt.subplots(1, 2, figsize=(16, 8.6), dpi=110)
    for ax, (title, layer, colour) in zip(axes, [("Microsoft footprints (the reference)", ms, "#ff3b30"),
                                                 ("Overture footprints (the map being scored)", ov, "#00e5ff")]):
        ax.imshow(img)
        ax.add_collection(PolyCollection([px(c) for c in layer], facecolor=colour, edgecolor=colour, alpha=0.55, linewidth=0.4))
        ax.add_collection(PolyCollection([px(tract.exterior.coords)] if tract.geom_type == "Polygon" else
                                         [px(p.exterior.coords) for p in tract.geoms], facecolor="none", edgecolor="yellow", linewidth=2))
        (x0, y0), (x1, y1) = px([(xmin, ymax)])[0], px([(xmax, ymin)])[0]
        pad = 0.04 * (x1 - x0)
        ax.set_xlim(x0 - pad, x1 + pad); ax.set_ylim(y1 + pad, y0 - pad)
        inside = sum(1 for c in layer if tract.contains(shapely.geometry.Polygon(c).envelope.centroid))
        ax.set_title(f"{title}: {inside:,} in tract", fontsize=13)
        ax.axis("off")
    fig.suptitle(f"Census tract {geoid} (yellow outline)", fontsize=15, y=0.98)
    fig.text(0.5, 0.015, "Imagery: Esri World Imagery (Esri, Maxar, Earthstar Geographics). Footprints: challenge data (Microsoft GlobalML Feb 2026; Overture 2026-08-19.0).",
             ha="center", fontsize=9, color="#444")
    fig.tight_layout(rect=(0, 0.03, 1, 0.95))
    fig.savefig(f"case-{geoid}.png")
    print(geoid, "zoom", z, "MS", len(ms), "OV", len(ov), "->", f"case-{geoid}.png", flush=True)


if __name__ == "__main__":
    import shapely.geometry  # noqa: F401
    for g in sys.argv[1:]:
        figure(g)
