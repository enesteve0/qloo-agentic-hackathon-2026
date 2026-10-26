# Data sources

Stoop's committed geo data is derived from public NYC Open Data. Raw downloads live in `data/raw/`
(git-ignored) and are processed by `scripts/build-geo.ts` (`pnpm geo:build`). No Qloo data is stored
in this repository.

| Dataset | ID | Publisher | Retrieved | Used for |
|---|---|---|---|---|
| LinkNYC Locations | [`s4kf-3yrf`](https://data.cityofnewyork.us/d/s4kf-3yrf) | NYC Office of Technology and Innovation | 2026-10-26 (dataset updated 2026-04-02) | street-screen inventory |
| 2020 Neighborhood Tabulation Areas | [`9nt8-h7nd`](https://data.cityofnewyork.us/d/9nt8-h7nd) | NYC Department of City Planning | 2026-10-26 | neighborhoods, Qloo location polygons, analysis grid |
| Borough Boundaries (water excluded) | [`gthc-hcne`](https://data.cityofnewyork.us/d/gthc-hcne) | NYC Department of City Planning | 2026-10-26 | NYC study area for Qloo heatmaps |

Download commands (send a descriptive User-Agent):

```sh
curl -A "stoop-data-build" "https://data.cityofnewyork.us/resource/s4kf-3yrf.json?\$limit=5000" -o data/raw/linknyc.json
curl -A "stoop-data-build" "https://data.cityofnewyork.us/api/geospatial/9nt8-h7nd?method=export&format=GeoJSON" -o data/raw/nta2020.geojson
curl -A "stoop-data-build" "https://data.cityofnewyork.us/resource/gthc-hcne.geojson" -o data/raw/boroughs.geojson
```

## Modifications

- **Kiosks** (`src/data/kiosks.json`, `public/geo/kiosks.min.json`): kept only rows with installation
  status `Live` and kiosk type `Link1.0` or `Link5G_Ad` (2,183 of 2,255 rows; payphones, non-ad
  Link5G units and removed units excluded); kiosk type casing normalized; each kiosk assigned to a
  2020 NTA by point-in-polygon on its coordinates (the dataset's own neighborhood field uses 2010
  names and is not used); 6 kiosks inside non-residential areas were reassigned to the nearest
  residential NTA and flagged; geohash (precision 6) added.
- **Neighborhoods** (`src/data/nta2020.json`): per NTA, the largest polygon part simplified with
  Douglas–Peucker to ≤80 vertices as a WKT polygon (lon-lat), centroid, bounding box, a curated short
  display name and the count of ad-capable kiosks.
- **Display polygons** (`public/geo/nta2020.min.geojson`): simplified with mapshaper (15%,
  keep-shapes); properties reduced to code, name, short name, borough and a residential flag.
- **Analysis grid** (`src/data/grid-gh6.json`): geohash-6 cells whose geohash-7 sub-cells fall on
  NTA land, with per-NTA weights equal to the number of land sub-cells.
- **Study area** (`src/data/nyc-study.wkt`, `src/data/nyc-hull.wkt`): the largest part of each
  borough simplified to ≤24 vertices (MULTIPOLYGON), plus a convex-hull fallback polygon.

## Validation data (OpenStreetMap, not committed)

The validation backtest (`scripts/backtest/`, `pnpm backtest:osm`) reads chain store locations and a
point-of-interest density count from OpenStreetMap through the Overpass API
(`https://overpass-api.de/api/interpreter`, descriptive User-Agent, one query at a time). Snapshot:
2026-10-26, 19:10–19:36 UTC. Brand identifiers are Wikidata QIDs (CC0), verified against Wikidata. Raw
responses and the derived per-neighborhood targets stay in git-ignored `data/raw/osm/`. Only summary
statistics (`src/content/validation.json`, written by a live run) and the scripts are published, with
the notice: "Contains information from OpenStreetMap, which is made available here under the Open
Database License (ODbL)."

## Terms

NYC Open Data has no use restrictions; the City asks users to identify the source and version and to
describe modifications (above). The data is provided without warranty. Stoop is not affiliated with
or endorsed by the City of New York, LinkNYC, Intersection or CityBridge.
