/**
 * OSM side of the validation backtest (docs/ARCHITECTURE.md §18), as pure functions (no I/O):
 *
 *   Overpass elements → active stores (ATMs, lockers and vacant shops dropped) → point/outline duplicates merged
 *   → 2020 NTA by point-in-polygon (residential NTAs only; points in parks, airports and cemeteries are dropped)
 *   → per-NTA store counts → density-adjusted over-index.
 *
 * The over-index of NTA j is the empirical-Bayes (Poisson–Gamma) estimate of brand share / POI share:
 * expected stores E_j = B·p_j/P from the NTA's commercial POIs p_j (food and drink amenities, shops, and the
 * brand's own stores), then θ̂_j = (b_j + m²/a)/(E_j + m/a) with Marshall's (1991) global moment estimate of the
 * prior variance a. Sparse NTAs shrink toward the city-wide rate m (= 1); θ̂ = 1 means "as many stores as the
 * NTA's commercial density predicts". osm-extract.ts runs this and writes data/raw/osm/targets.json.
 *
 * The prior variance is floored at `minPriorVariance` (prior SD ≥ 0.5). With sparse counts the moment estimate is
 * unreliable: Pearson χ² falls below the number of NTAs and the estimate truncates to 0 (complete pooling, a
 * constant target). Simulated on the 2026-10-26 POI exposure with a true variance of 1, that happened in about half
 * the draws for chains of 20–30 stores (3% at 90 stores, none at 250); in the extract it hit 10 of 22 chains.
 * Decided after the OSM extraction and before any Qloo call, so it cannot be tuned to the result.
 */
import booleanPointInPolygon from '@turf/boolean-point-in-polygon';
import type { BacktestBrand, BrandCategory } from './brands';

export const TARGET_METHOD = Object.freeze({
  version: 'osm-target/2',
  /** A chain needs this many active, de-duplicated OSM stores in NYC to enter the panel. */
  minStores: 15,
  /** A building outline within this distance of a point of the same brand is the same store mapped twice. */
  dedupeMeters: 40,
  /** Floor of the prior variance of the relative rate (at most 1/0.25 = 4 pseudo-stores of shrinkage). */
  minPriorVariance: 0.25,
});

// ---------------------------------------------------------------------------------------------
// Overpass elements
// ---------------------------------------------------------------------------------------------

export interface OsmElement {
  type: 'node' | 'way' | 'relation';
  id: number;
  lat?: number;
  lon?: number;
  /** `out center` for ways and relations. */
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
}

export interface OverpassResponse {
  osm3s?: { timestamp_osm_base?: string };
  /** Overpass reports runtime errors (e.g. a timeout) here, with HTTP 200 and partial elements. */
  remark?: string;
  elements: OsmElement[];
}

export interface OsmPoint {
  /** `node/123`, `way/456`, `relation/789`. */
  key: string;
  lon: number;
  lat: number;
  /** True for a way or relation (its centre), false for a node. */
  area: boolean;
}

/** A node's position or a way's/relation's centre; null without usable coordinates. */
export function elementPoint(e: OsmElement): OsmPoint | null {
  const c = e.type === 'node' ? (e.lat !== undefined && e.lon !== undefined ? { lat: e.lat, lon: e.lon } : null) : (e.center ?? null);
  if (!c || !Number.isFinite(c.lat) || !Number.isFinite(c.lon)) return null;
  return { key: `${e.type}/${e.id}`, lon: c.lon, lat: c.lat, area: e.type !== 'node' };
}

/** Main feature keys of a store-like object. */
const PRIMARY_KEYS = ['amenity', 'shop', 'leisure', 'office', 'craft', 'healthcare', 'tourism'] as const;
/** Brand-tagged objects that are not stores: cash machines, lockers, vending machines, parking, chargers. */
const NOT_A_STORE = new Set([
  'atm',
  'vending_machine',
  'parcel_locker',
  'parking',
  'parking_entrance',
  'parking_space',
  'charging_station',
  'bicycle_rental',
  'post_box',
  'payment_terminal',
]);
/** Values that mark a closed or empty premises. */
const CLOSED = new Set(['vacant', 'no', 'disused', 'closed', 'abandoned']);
/** Food and drink amenities counted as commercial POIs (the density query's amenity list). */
export const FOOD_AMENITIES: ReadonlySet<string> = new Set(['restaurant', 'cafe', 'fast_food', 'bar', 'pub']);

/**
 * A brand-tagged element counts as a store when it has an active main feature (amenity, shop, leisure, office,
 * craft, healthcare or tourism) and none of its main features is a non-store object (ATM, locker, vending
 * machine, parking, charger) or a closed premises (`shop=vacant`). Lifecycle-prefixed tags (`disused:shop`)
 * are not main features, so a closed store without an active tag is not counted.
 */
export function isStore(tags: Readonly<Record<string, string>> | undefined): boolean {
  if (!tags) return false;
  let active = false;
  for (const key of PRIMARY_KEYS) {
    const v = tags[key];
    if (v === undefined || v === '') continue;
    if (NOT_A_STORE.has(v) || CLOSED.has(v)) return false;
    active = true;
  }
  return active;
}

/** A commercial POI for the density adjustment: a food or drink amenity, or an active shop. */
export function isPoi(tags: Readonly<Record<string, string>> | undefined): boolean {
  if (!tags) return false;
  const amenity = tags.amenity;
  const shop = tags.shop;
  return (amenity !== undefined && FOOD_AMENITIES.has(amenity)) || (shop !== undefined && shop !== '' && !CLOSED.has(shop));
}

/** Distance in metres (equirectangular; error far below 0.1% over a few hundred metres at NYC's latitude). */
export function metres(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const rad = Math.PI / 180;
  const x = (b.lon - a.lon) * rad * Math.cos(((a.lat + b.lat) / 2) * rad);
  const y = (b.lat - a.lat) * rad;
  return 6_371_008.8 * Math.hypot(x, y);
}

const byKey = (a: OsmPoint, b: OsmPoint) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0);

/**
 * The same store is sometimes mapped twice, as a point and as a building outline. An outline (way or relation
 * centre) within `radius` metres of a point of the same brand is dropped. Two points, or two outlines, are
 * always kept: neighbouring branches of one chain exist in Midtown.
 */
export function dedupeStores(points: readonly OsmPoint[], radius: number = TARGET_METHOD.dedupeMeters): { kept: OsmPoint[]; merged: number } {
  const nodes = points.filter((p) => !p.area);
  const kept = [...nodes];
  let merged = 0;
  for (const p of points) {
    if (!p.area) continue;
    if (nodes.some((n) => metres(n, p) <= radius)) merged++;
    else kept.push(p);
  }
  return { kept: kept.sort(byKey), merged };
}

// ---------------------------------------------------------------------------------------------
// Neighborhoods (2020 NTAs) and point-in-polygon
// ---------------------------------------------------------------------------------------------

type Position = [number, number] | number[];

export type NtaGeometry = { type: 'Polygon'; coordinates: Position[][] } | { type: 'MultiPolygon'; coordinates: Position[][][] };

export interface NtaArea {
  code: string;
  name: string;
  boro: string;
  /** `ntatype` "0" — the same rule as scripts/build-geo.ts. */
  residential: boolean;
  bbox: [minLon: number, minLat: number, maxLon: number, maxLat: number];
  geometry: NtaGeometry;
}

interface NtaFeature {
  properties?: { nta2020?: string; ntaname?: string; boroname?: string; ntatype?: string };
  geometry?: NtaGeometry | null;
}

function bboxOf(geometry: NtaGeometry): NtaArea['bbox'] {
  const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
  let [minX, minY, maxX, maxY] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const polygon of polygons)
    for (const ring of polygon)
      for (const [x, y] of ring as [number, number][]) {
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
      }
  return [minX, minY, maxX, maxY];
}

/** NTAs from the NYC Open Data GeoJSON (`9nt8-h7nd`), sorted by code. */
export function parseNtaGeoJson(fc: unknown): NtaArea[] {
  const features = (fc as { features?: NtaFeature[] } | null)?.features;
  if (!Array.isArray(features)) throw new Error('NTA GeoJSON has no features');
  return features
    .map((f): NtaArea => {
      const p = f.properties ?? {};
      const g = f.geometry;
      if (!p.nta2020 || !g || (g.type !== 'Polygon' && g.type !== 'MultiPolygon')) throw new Error(`Bad NTA feature ${p.nta2020 ?? '?'}`);
      return { code: p.nta2020, name: p.ntaname ?? p.nta2020, boro: p.boroname ?? '', residential: p.ntatype === '0', bbox: bboxOf(g), geometry: g };
    })
    .sort((a, b) => (a.code < b.code ? -1 : a.code > b.code ? 1 : 0));
}

/**
 * Point-in-polygon lookup over all NTAs (holes and multipart polygons handled by turf). A point on an edge
 * counts as inside, so a point on a shared border goes to the NTA with the lower code; null outside every NTA
 * (water, piers beyond the shoreline).
 */
export function createLocator(areas: readonly NtaArea[]): (lon: number, lat: number) => NtaArea | null {
  const sorted = [...areas].sort((a, b) => (a.code < b.code ? -1 : a.code > b.code ? 1 : 0));
  return (lon, lat) => {
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) return null;
    for (const a of sorted) {
      const [minX, minY, maxX, maxY] = a.bbox;
      if (lon < minX || lon > maxX || lat < minY || lat > maxY) continue;
      if (booleanPointInPolygon([lon, lat], a.geometry as never)) return a;
    }
    return null;
  };
}

export interface Assignment {
  /** Residential NTA code → points inside it. */
  byNta: Map<string, OsmPoint[]>;
  /** Points inside a non-residential NTA (parks, airports, cemeteries); dropped. */
  nonResidential: number;
  /** Points outside every NTA; dropped. */
  outside: number;
}

export function assignPoints(points: readonly OsmPoint[], locate: (lon: number, lat: number) => NtaArea | null): Assignment {
  const byNta = new Map<string, OsmPoint[]>();
  let nonResidential = 0;
  let outside = 0;
  for (const p of points) {
    const nta = locate(p.lon, p.lat);
    if (!nta) outside++;
    else if (!nta.residential) nonResidential++;
    else {
      const list = byNta.get(nta.code);
      if (list) list.push(p);
      else byNta.set(nta.code, [p]);
    }
  }
  return { byNta, nonResidential, outside };
}

// ---------------------------------------------------------------------------------------------
// Density-adjusted over-index (empirical Bayes)
// ---------------------------------------------------------------------------------------------

export interface OverIndex {
  /** Smoothed over-index θ̂ per area; 1 = in line with commercial density. NaN when the brand has no stores. */
  theta: number[];
  /** Expected stores E_j = B·p_j/P. */
  expected: number[];
  /** City-wide rate m = Σb/ΣE over areas with exposure (1 whenever every store has exposure). */
  rate: number;
  /** Marshall's moment estimate s² − m/Ē before any truncation (negative when counts look under-dispersed). */
  momentEstimate: number;
  /** Prior variance a actually used: max(moment estimate, floor, 0); 0 means complete pooling. */
  priorVariance: number;
}

/**
 * Empirical-Bayes over-index of `stores` relative to `exposure` (Marshall 1991, global estimator):
 * E_j = B·p_j/P; m = Σb/ΣE; s² = Σ(b_j − m·E_j)²/E_j / ΣE; a = max(s² − m/Ē, minPriorVariance, 0) with Ē the
 * mean E over areas with exposure; θ̂_j = (b_j + m²/a)/(E_j + m/a), or m everywhere when a = 0. Areas without
 * exposure get m. Exposure must be positive wherever there are stores (callers include the brand's own stores).
 */
export function overIndex(stores: readonly number[], exposure: readonly number[], minPriorVariance = 0): OverIndex {
  if (stores.length !== exposure.length) throw new RangeError(`length mismatch: ${stores.length} vs ${exposure.length}`);
  for (let i = 0; i < stores.length; i++) {
    const b = stores[i]!;
    const p = exposure[i]!;
    if (!(Number.isFinite(b) && b >= 0 && Number.isFinite(p) && p >= 0)) throw new RangeError(`counts must be finite and ≥ 0 (area ${i})`);
    if (b > 0 && p === 0) throw new RangeError(`area ${i} has stores but no exposure`);
  }
  const B = stores.reduce((s, v) => s + v, 0);
  const P = exposure.reduce((s, v) => s + v, 0);
  if (B === 0 || P === 0) {
    return { theta: stores.map(() => NaN), expected: stores.map(() => 0), rate: NaN, momentEstimate: NaN, priorVariance: NaN };
  }
  const expected = exposure.map((p) => (B * p) / P);
  let k = 0;
  let sumE = 0;
  let sumB = 0;
  for (let i = 0; i < expected.length; i++) {
    if (expected[i]! > 0) {
      k++;
      sumE += expected[i]!;
      sumB += stores[i]!;
    }
  }
  const m = sumB / sumE;
  let ss = 0;
  for (let i = 0; i < expected.length; i++) {
    const e = expected[i]!;
    if (e > 0) ss += (stores[i]! - m * e) ** 2 / e;
  }
  const momentEstimate = ss / sumE - m / (sumE / k);
  const a = Math.max(momentEstimate, minPriorVariance, 0);
  const theta = expected.map((e, i) => (a > 0 ? (stores[i]! + (m * m) / a) / (e + m / a) : m));
  return { theta, expected, rate: m, momentEstimate, priorVariance: a };
}

// ---------------------------------------------------------------------------------------------
// Targets file
// ---------------------------------------------------------------------------------------------

export interface PoiSummary {
  osmBase: string | null;
  elements: number;
  active: number;
  residential: number;
  nonResidential: number;
  outside: number;
}

export interface BrandTarget {
  id: string;
  name: string;
  qid: string;
  category: BrandCategory;
  osmBase: string | null;
  counts: {
    /** Elements returned by Overpass. */
    elements: number;
    /** Active stores before de-duplication. */
    active: number;
    /** Outlines merged into a point of the same store. */
    merged: number;
    /** Active, de-duplicated stores in NYC (the panel rule applies to this). */
    stores: number;
    /** Of those, in residential NTAs (used), in non-residential NTAs and outside every NTA (dropped). */
    residential: number;
    nonResidential: number;
    outside: number;
  };
  status: 'ok' | 'excluded';
  reason: string | null;
  /** Marshall's moment estimate of the prior variance (may be ≤ 0 for sparse chains). */
  momentEstimate: number | null;
  /** Prior variance used for the target (the estimate, floored at `minPriorVariance`). */
  priorVariance: number | null;
  /** Stores per residential NTA (non-zero entries only). */
  stores: Record<string, number>;
  /** θ̂ per residential NTA (every one), empty when excluded. */
  target: Record<string, number>;
}

export interface TargetsFile {
  kind: 'stoop-backtest-targets';
  method: typeof TARGET_METHOD;
  builtAt: string;
  notice: string;
  poi: PoiSummary;
  /** Residential NTAs, sorted by code, with their commercial POI count. */
  ntas: { code: string; boro: string; pois: number }[];
  brands: BrandTarget[];
  /** Panel brands whose QID failed the Wikidata check (never queried); set by osm-extract.ts. */
  unverified?: { id: string; name: string; qid: string; reason: string }[];
}

export const ODBL_NOTICE =
  'Contains information from OpenStreetMap, which is made available here under the Open Database License (ODbL).';

export interface BuildTargetsInput {
  areas: readonly NtaArea[];
  poi: OverpassResponse;
  brands: readonly { brand: BacktestBrand; response: OverpassResponse }[];
  builtAt: string;
  minStores?: number;
  dedupeMeters?: number;
  minPriorVariance?: number;
}

/** Runs the whole OSM side: one target vector per brand over the residential NTAs. */
export function buildTargets(input: BuildTargetsInput): TargetsFile {
  const minStores = input.minStores ?? TARGET_METHOD.minStores;
  const radius = input.dedupeMeters ?? TARGET_METHOD.dedupeMeters;
  const floor = input.minPriorVariance ?? TARGET_METHOD.minPriorVariance;
  const locate = createLocator(input.areas);
  const residential = input.areas.filter((a) => a.residential);

  // Commercial POIs, keyed so that a brand's own store is never counted twice in its exposure.
  const poiPoints = input.poi.elements.flatMap((e) => {
    if (!isPoi(e.tags)) return [];
    const p = elementPoint(e);
    return p ? [p] : [];
  });
  const poiAssigned = assignPoints(poiPoints, locate);
  const poiKeys = new Map<string, Set<string>>(residential.map((a) => [a.code, new Set((poiAssigned.byNta.get(a.code) ?? []).map((p) => p.key))]));
  const poi: PoiSummary = {
    osmBase: input.poi.osm3s?.timestamp_osm_base ?? null,
    elements: input.poi.elements.length,
    active: poiPoints.length,
    residential: [...poiAssigned.byNta.values()].reduce((s, l) => s + l.length, 0),
    nonResidential: poiAssigned.nonResidential,
    outside: poiAssigned.outside,
  };

  const brands = input.brands.map(({ brand, response }): BrandTarget => {
    const activePoints = response.elements.flatMap((e) => {
      if (!isStore(e.tags)) return [];
      const p = elementPoint(e);
      return p ? [p] : [];
    });
    const { kept, merged } = dedupeStores(activePoints, radius);
    const assigned = assignPoints(kept, locate);
    const storesByNta: Record<string, number> = {};
    for (const [code, list] of [...assigned.byNta.entries()].sort(([a], [b]) => (a < b ? -1 : 1))) storesByNta[code] = list.length;
    const counts: BrandTarget['counts'] = {
      elements: response.elements.length,
      active: activePoints.length,
      merged,
      stores: kept.length,
      residential: kept.length - assigned.nonResidential - assigned.outside,
      nonResidential: assigned.nonResidential,
      outside: assigned.outside,
    };
    const base = {
      id: brand.id,
      name: brand.name,
      qid: brand.qid,
      category: brand.category,
      osmBase: response.osm3s?.timestamp_osm_base ?? null,
      counts,
      stores: storesByNta,
    };
    if (counts.stores < minStores) {
      return {
        ...base,
        status: 'excluded',
        reason: `${counts.stores} stores in NYC on OSM (minimum ${minStores})`,
        momentEstimate: null,
        priorVariance: null,
        target: {},
      };
    }
    const b = residential.map((a) => storesByNta[a.code] ?? 0);
    const p = residential.map((a) => {
      const keys = poiKeys.get(a.code)!;
      const own = (assigned.byNta.get(a.code) ?? []).filter((s) => !keys.has(s.key)).length;
      return keys.size + own;
    });
    const oi = overIndex(b, p, floor);
    if (!(oi.priorVariance > 0)) {
      // Only reachable with a floor of 0: complete pooling leaves a constant target.
      return {
        ...base,
        status: 'excluded',
        reason: 'complete pooling (prior variance 0) leaves a constant target',
        momentEstimate: oi.momentEstimate,
        priorVariance: 0,
        target: {},
      };
    }
    const target: Record<string, number> = {};
    residential.forEach((a, i) => {
      target[a.code] = oi.theta[i]!;
    });
    return { ...base, status: 'ok', reason: null, momentEstimate: oi.momentEstimate, priorVariance: oi.priorVariance, target };
  });

  return {
    kind: 'stoop-backtest-targets',
    method: TARGET_METHOD,
    builtAt: input.builtAt,
    notice: ODBL_NOTICE,
    poi,
    ntas: residential.map((a) => ({ code: a.code, boro: a.boro, pois: poiKeys.get(a.code)!.size })),
    brands,
  };
}
