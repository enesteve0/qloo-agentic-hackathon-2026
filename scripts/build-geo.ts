/**
 * Builds Stoop's static geo data from NYC Open Data downloads in data/raw/ (git-ignored):
 *   - src/data/kiosks.json      live, ad-capable LinkNYC kiosks assigned to 2020 NTAs by coordinates
 *   - src/data/nta2020.json     neighborhood info incl. a Qloo-ready WKT polygon (≤80 vertices)
 *   - src/data/grid-gh6.json    geohash-6 analysis grid with per-NTA land weights
 *   - src/data/nyc-study.wkt    NYC study area (MULTIPOLYGON of simplified boroughs) for heatmaps
 *   - src/data/nyc-hull.wkt     convex-hull fallback POLYGON
 *   - public/geo/nta2020.min.geojson  simplified display polygons for the map
 *   - public/geo/kiosks.min.json      compact kiosk coordinates for the map
 *
 * Usage: download the three raw files (see data/README.md), then `pnpm geo:build`.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import area from '@turf/area';
import booleanPointInPolygon from '@turf/boolean-point-in-polygon';
import { point } from '@turf/helpers';
import ngeohash from 'ngeohash';

type Ring = [number, number][];
type PolygonCoords = Ring[];
interface PolyGeom {
  type: 'Polygon' | 'MultiPolygon';
  coordinates: PolygonCoords | PolygonCoords[];
}
interface Feature<P> {
  type: 'Feature';
  properties: P;
  geometry: PolyGeom;
}
interface NtaProps {
  nta2020: string;
  ntaname: string;
  ntaabbrev: string;
  boroname: string;
  ntatype: string;
}
interface RawKiosk {
  link_site_id?: string;
  planned_kiosk_type?: string;
  link_installation_status?: string;
  boro?: string;
  street_address?: string;
  cross_street_1?: string;
  cross_street_2?: string;
  latitude?: string;
  longitude?: string;
}

const ROOT = path.resolve(import.meta.dirname, '..');
const RAW = path.join(ROOT, 'data/raw');
const OUT_DATA = path.join(ROOT, 'src/data');
const OUT_PUBLIC = path.join(ROOT, 'public/geo');
const EXPECTED_KIOSKS = 2183;
const MAX_NTA_VERTICES = 80;
const MAX_BORO_VERTICES = 24;
const MAX_WKT_ENCODED = 4000;

const readJson = <T>(file: string): T => JSON.parse(fs.readFileSync(path.join(RAW, file), 'utf8')) as T;
const round5 = (n: number) => Math.round(n * 1e5) / 1e5;

/** Curated short names for neighborhoods whose official 2020 names are long or hyphen-lists. */
const SHORT_OVERRIDES: Record<string, string> = {
  'Bedford-Stuyvesant': 'Bed-Stuy',
  'Downtown Brooklyn-DUMBO-Boerum Hill': 'Downtown Brooklyn',
  'Chinatown-Two Bridges': 'Chinatown',
  'SoHo-Little Italy-Hudson Square': 'SoHo',
  'Tribeca-Civic Center': 'Tribeca',
  'Financial District-Battery Park City': 'FiDi',
  'Chelsea-Hudson Yards': 'Chelsea',
  'Midtown South-Flatiron-Union Square': 'Flatiron',
  'Midtown-Times Square': 'Midtown',
  'Upper East Side-Carnegie Hill': 'Carnegie Hill',
  'Upper East Side-Lenox Hill-Roosevelt Island': 'Lenox Hill',
  'Upper East Side-Yorkville': 'Yorkville',
  'Long Island City-Hunters Point': 'Long Island City',
  'Flushing-Willets Point': 'Flushing',
  'Prospect Lefferts Gardens-Wingate': 'Prospect Lefferts',
  'Morningside Heights': 'Morningside Heights',
  "Hell's Kitchen": "Hell's Kitchen",
  'East Midtown-Turtle Bay': 'Turtle Bay',
  'Murray Hill-Kips Bay': 'Kips Bay',
  'Gramercy': 'Gramercy',
  'Stuyvesant Town-Peter Cooper Village': 'Stuy Town',
  'Windsor Terrace-South Slope': 'Windsor Terrace',
  'Carroll Gardens-Cobble Hill-Gowanus-Red Hook': 'Carroll Gardens',
  'Sunset Park (Central)': 'Sunset Park',
};

function shortName(name: string): string {
  const base = name.replace(/\s*\([^)]*\)\s*/g, ' ').trim();
  if (SHORT_OVERRIDES[name]) return SHORT_OVERRIDES[name];
  if (SHORT_OVERRIDES[base]) return SHORT_OVERRIDES[base];
  // Hyphen lists ("A-B-C") keep the first place name; hyphenated single names are in the overrides.
  const first = base.split('-')[0]?.trim() ?? base;
  return first.length >= 3 ? first : base;
}

function bboxOf(rings: Ring[]): [number, number, number, number] {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const ring of rings)
    for (const [x, y] of ring) {
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  return [minX, minY, maxX, maxY];
}

function polygonsOf(geom: PolyGeom): PolygonCoords[] {
  return geom.type === 'Polygon' ? [geom.coordinates as PolygonCoords] : (geom.coordinates as PolygonCoords[]);
}

function largestPolygon(geom: PolyGeom): PolygonCoords {
  let best: PolygonCoords | undefined;
  let bestArea = -1;
  for (const poly of polygonsOf(geom)) {
    const a = area({ type: 'Polygon', coordinates: poly });
    if (a > bestArea) {
      bestArea = a;
      best = poly;
    }
  }
  if (!best) throw new Error('empty geometry');
  return best;
}

/** Perpendicular distance from p to segment ab, in scaled-degree units (lon scaled by cos(lat)). */
function segDist(p: [number, number], a: [number, number], b: [number, number], kx: number): number {
  const px = p[0] * kx;
  const ax = a[0] * kx;
  const bx = b[0] * kx;
  const dx = bx - ax;
  const dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  let t = len2 === 0 ? 0 : ((px - ax) * dx + (p[1] - a[1]) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  const cx = ax + t * dx - px;
  const cy = a[1] + t * dy - p[1];
  return Math.hypot(cx, cy);
}

function douglasPeucker(points: Ring, eps: number, kx: number): Ring {
  if (points.length <= 3) return points.slice();
  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;
  const stack: [number, number][] = [[0, points.length - 1]];
  while (stack.length) {
    const [s, e] = stack.pop()!;
    let maxD = -1;
    let idx = -1;
    for (let i = s + 1; i < e; i++) {
      const d = segDist(points[i]!, points[s]!, points[e]!, kx);
      if (d > maxD) {
        maxD = d;
        idx = i;
      }
    }
    if (maxD > eps && idx > 0) {
      keep[idx] = 1;
      stack.push([s, idx], [idx, e]);
    }
  }
  return points.filter((_, i) => keep[i]);
}

/** Simplify a closed ring to at most maxVertices (closing point included) with a tolerance search. */
function simplifyRing(ring: Ring, maxVertices: number): Ring {
  const open = ring.slice(0, -1);
  const kx = Math.cos(((open[0]?.[1] ?? 40.7) * Math.PI) / 180);
  if (open.length + 1 <= maxVertices) return ring.map(([x, y]) => [round5(x), round5(y)] as [number, number]);
  // Split the ring in two so DP has fixed endpoints on both halves.
  const half = Math.floor(open.length / 2);
  let lo = 0;
  let hi = 0.05;
  let best: Ring = [];
  for (let iter = 0; iter < 40; iter++) {
    const eps = (lo + hi) / 2;
    const a = douglasPeucker(open.slice(0, half + 1), eps, kx);
    const b = douglasPeucker([...open.slice(half), open[0]!], eps, kx);
    const merged = [...a.slice(0, -1), ...b.slice(0, -1)];
    if (merged.length + 1 > maxVertices) {
      lo = eps; // too detailed: raise the tolerance
    } else if (merged.length < 4) {
      hi = eps; // collapsed: lower the tolerance
    } else {
      best = merged; // valid; try a smaller tolerance to keep more detail
      hi = eps;
    }
  }
  if (best.length < 4) throw new Error('simplification failed');
  const closed = [...best, best[0]!].map(([x, y]) => [round5(x), round5(y)] as [number, number]);
  return closed;
}

const ringWkt = (ring: Ring) => `(${ring.map(([x, y]) => `${x} ${y}`).join(', ')})`;

function convexHull(pts: [number, number][]): Ring {
  const p = [...pts].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o: [number, number], a: [number, number], b: [number, number]) =>
    (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower: [number, number][] = [];
  for (const pt of p) {
    while (lower.length >= 2 && cross(lower[lower.length - 2]!, lower[lower.length - 1]!, pt) <= 0) lower.pop();
    lower.push(pt);
  }
  const upper: [number, number][] = [];
  for (const pt of p.reverse()) {
    while (upper.length >= 2 && cross(upper[upper.length - 2]!, upper[upper.length - 1]!, pt) <= 0) upper.pop();
    upper.push(pt);
  }
  const hull = [...lower.slice(0, -1), ...upper.slice(0, -1)];
  return [...hull, hull[0]!];
}

/** Approximate distance (degrees, lon scaled) from a point to the nearest edge of a geometry. */
function distanceToGeom(lon: number, lat: number, geom: PolyGeom): number {
  const kx = Math.cos((lat * Math.PI) / 180);
  let best = Infinity;
  for (const poly of polygonsOf(geom))
    for (const ring of poly)
      for (let i = 0; i < ring.length - 1; i++) {
        const d = segDist([lon, lat], ring[i]!, ring[i + 1]!, kx);
        if (d < best) best = d;
      }
  return best;
}

function main() {
  fs.mkdirSync(OUT_DATA, { recursive: true });
  fs.mkdirSync(OUT_PUBLIC, { recursive: true });
  const retrievedAt = fs.existsSync(path.join(RAW, 'RETRIEVED_AT'))
    ? fs.readFileSync(path.join(RAW, 'RETRIEVED_AT'), 'utf8').trim()
    : 'unknown';

  // ---------------- Neighborhoods ----------------
  const ntaFc = readJson<{ features: Feature<NtaProps>[] }>('nta2020.geojson');
  const ntaFeatures = ntaFc.features.map((f) => ({
    code: f.properties.nta2020,
    name: f.properties.ntaname,
    boro: f.properties.boroname,
    residential: f.properties.ntatype === '0',
    geom: f.geometry,
    bbox: bboxOf(polygonsOf(f.geometry).flat()),
  }));
  console.log(`neighborhoods: ${ntaFeatures.length} (${ntaFeatures.filter((n) => n.residential).length} residential)`);

  const findNta = (lon: number, lat: number) => {
    const pt = point([lon, lat]);
    return ntaFeatures.find(
      (n) =>
        lon >= n.bbox[0] && lon <= n.bbox[2] && lat >= n.bbox[1] && lat <= n.bbox[3] && booleanPointInPolygon(pt, n.geom as never),
    );
  };
  const nearestResidential = (lon: number, lat: number) => {
    let best: (typeof ntaFeatures)[number] | undefined;
    let bestD = Infinity;
    for (const n of ntaFeatures) {
      if (!n.residential) continue;
      const d = distanceToGeom(lon, lat, n.geom);
      if (d < bestD) {
        bestD = d;
        best = n;
      }
    }
    return best!;
  };

  // ---------------- Kiosks ----------------
  const raw = readJson<RawKiosk[]>('linknyc.json');
  const kiosks = [];
  let reassigned = 0;
  for (const r of raw) {
    const type = (r.planned_kiosk_type ?? '').toUpperCase();
    if (r.link_installation_status !== 'Live') continue;
    if (type !== 'LINK1.0' && type !== 'LINK5G_AD') continue;
    const lat = Number(r.latitude);
    const lon = Number(r.longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || lat === 0 || lon === 0) continue;
    let nta = findNta(lon, lat);
    let ntaReassigned = false;
    if (!nta || !nta.residential) {
      nta = nearestResidential(lon, lat);
      ntaReassigned = true;
      reassigned++;
    }
    kiosks.push({
      i: kiosks.length,
      siteId: r.link_site_id ?? `kiosk-${kiosks.length}`,
      lat: Math.round(lat * 1e6) / 1e6,
      lon: Math.round(lon * 1e6) / 1e6,
      type: type as 'LINK1.0' | 'LINK5G_AD',
      boro: r.boro ?? nta.boro,
      address: (r.street_address ?? '').trim(),
      cross1: r.cross_street_1?.trim() || null,
      cross2: r.cross_street_2?.trim() || null,
      nta: nta.code,
      gh6: ngeohash.encode(lat, lon, 6),
      ntaReassigned,
    });
  }
  console.log(`kiosks: ${kiosks.length} live ad-capable (${reassigned} reassigned to the nearest residential NTA)`);
  if (Math.abs(kiosks.length - EXPECTED_KIOSKS) > 5) {
    throw new Error(`Expected ${EXPECTED_KIOSKS} ± 5 kiosks, got ${kiosks.length} — inspect the source data`);
  }

  // ---------------- Display polygons (topology-preserving simplification via mapshaper) ----------------
  const displayPath = path.join(OUT_PUBLIC, 'nta2020.min.geojson');
  const tmpPath = path.join(RAW, 'nta2020.simplified.geojson');
  execFileSync(
    path.join(ROOT, 'node_modules/.bin/mapshaper'),
    [path.join(RAW, 'nta2020.geojson'), '-simplify', '15%', 'keep-shapes', '-o', 'format=geojson', 'precision=0.00001', tmpPath],
    { stdio: 'inherit' },
  );
  const simplified = JSON.parse(fs.readFileSync(tmpPath, 'utf8')) as { features: Feature<NtaProps>[] };

  // ---------------- NTA info with Qloo WKT ----------------
  const adCount = new Map<string, number>();
  for (const k of kiosks) adCount.set(k.nta, (adCount.get(k.nta) ?? 0) + 1);
  const ntaInfo = ntaFeatures.map((n) => {
    const poly = largestPolygon(n.geom);
    const outer = simplifyRing(poly[0]!, MAX_NTA_VERTICES);
    const wkt = `POLYGON(${ringWkt(outer)})`;
    if (encodeURIComponent(wkt).length > MAX_WKT_ENCODED) throw new Error(`WKT too long for ${n.code}`);
    const bbox = bboxOf([poly[0]!]);
    let cx = 0;
    let cy = 0;
    for (const [x, y] of outer.slice(0, -1)) {
      cx += x;
      cy += y;
    }
    const m = outer.length - 1;
    return {
      code: n.code,
      name: n.name,
      short: shortName(n.name),
      boro: n.boro,
      centroid: [round5(cx / m), round5(cy / m)] as [number, number],
      bbox: bbox.map(round5) as [number, number, number, number],
      wkt,
      adKiosks: adCount.get(n.code) ?? 0,
      residential: n.residential,
    };
  });

  const display = {
    type: 'FeatureCollection',
    features: simplified.features.map((f) => ({
      type: 'Feature',
      properties: {
        code: f.properties.nta2020,
        name: f.properties.ntaname,
        short: shortName(f.properties.ntaname),
        boro: f.properties.boroname,
        residential: f.properties.ntatype === '0',
      },
      geometry: f.geometry,
    })),
  };
  fs.writeFileSync(displayPath, JSON.stringify(display));

  // ---------------- Analysis grid (gh6) with land weights from gh7 sub-cells ----------------
  const simplifiedNtas = simplified.features.map((f) => ({
    code: f.properties.nta2020,
    geom: f.geometry,
    bbox: bboxOf(polygonsOf(f.geometry).flat()),
  }));
  const [minX, minY, maxX, maxY] = bboxOf(simplifiedNtas.flatMap((n) => polygonsOf(n.geom).flat()));
  const gh7 = ngeohash.bboxes(minY, minX, maxY, maxX, 7);
  const cellIndex = new Map<string, number>();
  const cells: string[] = [];
  const weights = new Map<string, Map<number, number>>();
  for (const h of gh7) {
    const { latitude, longitude } = ngeohash.decode(h);
    const pt = point([longitude, latitude]);
    const hit = simplifiedNtas.find(
      (n) =>
        longitude >= n.bbox[0] &&
        longitude <= n.bbox[2] &&
        latitude >= n.bbox[1] &&
        latitude <= n.bbox[3] &&
        booleanPointInPolygon(pt, n.geom as never),
    );
    if (!hit) continue;
    const g6 = h.slice(0, 6);
    let ci = cellIndex.get(g6);
    if (ci === undefined) {
      ci = cells.length;
      cells.push(g6);
      cellIndex.set(g6, ci);
    }
    let w = weights.get(hit.code);
    if (!w) weights.set(hit.code, (w = new Map()));
    w.set(ci, (w.get(ci) ?? 0) + 1);
  }
  const kioskCell = kiosks.map((k) => {
    let ci = cellIndex.get(k.gh6);
    if (ci === undefined) {
      ci = cells.length;
      cells.push(k.gh6);
      cellIndex.set(k.gh6, ci);
    }
    return ci;
  });
  const ntaWeights: Record<string, [number, number][]> = {};
  for (const [code, w] of [...weights.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    ntaWeights[code] = [...w.entries()].sort(([a], [b]) => a - b);
  }
  console.log(`grid: ${cells.length} gh6 cells from ${gh7.length} gh7 candidates`);

  // ---------------- NYC study area ----------------
  const boroFc = readJson<{ features: Feature<{ boroname: string }>[] }>('boroughs.geojson');
  const boroRings = boroFc.features.map((f) => simplifyRing(largestPolygon(f.geometry)[0]!, MAX_BORO_VERTICES));
  const study = `MULTIPOLYGON(${boroRings.map((r) => `(${ringWkt(r)})`).join(', ')})`;
  const hull = `POLYGON(${ringWkt(simplifyRing(convexHull(boroFc.features.flatMap((f) => polygonsOf(f.geometry).flatMap((p) => p[0]!))), 60))})`;
  for (const [label, wkt] of [
    ['study', study],
    ['hull', hull],
  ] as const) {
    const len = encodeURIComponent(wkt).length;
    console.log(`${label} WKT: ${len} encoded chars`);
    if (len > MAX_WKT_ENCODED) throw new Error(`${label} WKT too long`);
  }

  // ---------------- Write outputs ----------------
  fs.writeFileSync(path.join(OUT_DATA, 'kiosks.json'), JSON.stringify(kiosks));
  fs.writeFileSync(path.join(OUT_DATA, 'nta2020.json'), JSON.stringify(ntaInfo));
  fs.writeFileSync(path.join(OUT_DATA, 'grid-gh6.json'), JSON.stringify({ precision: 6, cells, ntaWeights, kioskCell }));
  fs.writeFileSync(path.join(OUT_DATA, 'nyc-study.wkt'), study + '\n');
  fs.writeFileSync(path.join(OUT_DATA, 'nyc-hull.wkt'), hull + '\n');
  fs.writeFileSync(
    path.join(OUT_PUBLIC, 'kiosks.min.json'),
    JSON.stringify({ v: 1, retrievedAt, k: kiosks.map((k) => [k.lon, k.lat, k.type === 'LINK5G_AD' ? 1 : 0]) }),
  );
  fs.writeFileSync(
    path.join(OUT_DATA, 'meta.json'),
    JSON.stringify(
      {
        retrievedAt,
        sources: {
          kiosks: 'NYC Open Data s4kf-3yrf (LinkNYC Locations)',
          ntas: 'NYC Open Data 9nt8-h7nd (2020 Neighborhood Tabulation Areas)',
          boroughs: 'NYC Open Data gthc-hcne (Borough Boundaries, water excluded)',
        },
        counts: {
          kiosks: kiosks.length,
          kiosksReassigned: reassigned,
          link5gAd: kiosks.filter((k) => k.type === 'LINK5G_AD').length,
          ntas: ntaInfo.length,
          residentialNtas: ntaInfo.filter((n) => n.residential).length,
          eligibleNtas: ntaInfo.filter((n) => n.residential && n.adKiosks >= 2).length,
          gridCells: cells.length,
        },
      },
      null,
      2,
    ) + '\n',
  );
  fs.rmSync(tmpPath, { force: true });
  console.log('done');
}

main();
