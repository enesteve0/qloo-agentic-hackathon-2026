import 'server-only';
import ngeohash from 'ngeohash';
import type { EntityType } from '@/shared/types';
import { wktDigest } from './keys';

/**
 * Deterministic synthetic Qloo data (ARCHITECTURE §16). Shapes mirror the real API; values are
 * generated from hashes of the request, never from Qloo. Heatmaps are a density field plus 2–3
 * Gaussian "taste bumps" per signal, so the lift engine has known ground truth to recover.
 */

export const SYNTHETIC_UUID_PREFIX = '5157E7C0-0000-4000-8000-';
/** Entity IDs with this prefix all return one identical density-only map (planted default map). */
export const NODATA_PREFIX = 'nodata-';
/** Entity IDs with this prefix return a sparse map (~20% of cells) to exercise THIN handling. */
export const THIN_PREFIX = 'thin-';
export const SYNTHETIC_ID_PREFIX = 'synthetic_';

type Json = Record<string, unknown>;

// ---------------------------------------------------------------------------------------------
// Hashing (pure integer math: identical on every platform)
// ---------------------------------------------------------------------------------------------

export function hash32(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  // murmur3 finalizer for better bit mixing than FNV alone
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

/** Uniform [0, 1) from the joined parts. */
export function unit(...parts: (string | number)[]): number {
  return hash32(parts.join('|')) / 4_294_967_296;
}

/** Standard normal from the joined parts (Box–Muller). */
export function gauss(...parts: (string | number)[]): number {
  const u1 = Math.max(unit(...parts, 'g1'), 1e-12);
  const u2 = unit(...parts, 'g2');
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

export function syntheticUuid(seed: string): string {
  const hex = hash32(`uuid|${seed}`).toString(16).padStart(8, '0') + hash32(`uuid2|${seed}`).toString(16).padStart(8, '0');
  return SYNTHETIC_UUID_PREFIX + hex.slice(0, 12).toUpperCase();
}

const round = (v: number, d = 6) => Math.round(v * 10 ** d) / 10 ** d;
const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/** Accent- and punctuation-insensitive form used to match planted catalog names. */
export function fold(s: string): string {
  return s
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/['’`]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

function slug(s: string): string {
  return fold(s).replace(/\s+/g, '_');
}

// ---------------------------------------------------------------------------------------------
// Geometry
// ---------------------------------------------------------------------------------------------

/** [lon, lat] */
export type Ring = [number, number][];

/** Every ring of a WKT (multi)polygon; holes and parts are handled by the even-odd rule. */
export function parseWktRings(wkt: string): Ring[] {
  const rings: Ring[] = [];
  for (const m of wkt.matchAll(/\(([^()]+)\)/g)) {
    const ring: Ring = [];
    for (const pair of (m[1] ?? '').split(',')) {
      const [x, y] = pair.trim().split(/\s+/).map(Number);
      if (x !== undefined && y !== undefined && Number.isFinite(x) && Number.isFinite(y)) ring.push([x, y]);
    }
    if (ring.length >= 3) rings.push(ring);
  }
  return rings;
}

export function pointInRings(lon: number, lat: number, rings: readonly Ring[]): boolean {
  let inside = false;
  for (const ring of rings) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i] as [number, number];
      const [xj, yj] = ring[j] as [number, number];
      if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
    }
  }
  return inside;
}

function ringsBBox(rings: readonly Ring[]): [number, number, number, number] {
  let [minX, minY, maxX, maxY] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const ring of rings) {
    for (const [x, y] of ring) {
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }
  return [minX, minY, maxX, maxY];
}

/** Approximate area of the outer rings in km² (shoelace at NYC latitude). */
function ringsAreaKm2(rings: readonly Ring[]): number {
  let total = 0;
  for (const ring of rings) {
    let a = 0;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i] as [number, number];
      const [xj, yj] = ring[j] as [number, number];
      a += xj * yi - xi * yj;
    }
    total += Math.abs(a / 2);
  }
  return total * 111.32 * 111.32 * Math.cos((40.7 * Math.PI) / 180);
}

/**
 * A polygon filter keeps cells that touch the polygon (centre or a corner inside), the plausible
 * reading for coastal cells of a simplified borough outline.
 */
export function cellTouches(gh: string, rings: readonly Ring[]): boolean {
  const [minLat, minLon, maxLat, maxLon] = ngeohash.decode_bbox(gh);
  const points: [number, number][] = [
    [(minLon + maxLon) / 2, (minLat + maxLat) / 2],
    [minLon, minLat],
    [minLon, maxLat],
    [maxLon, minLat],
    [maxLon, maxLat],
  ];
  return points.some(([lon, lat]) => pointInRings(lon, lat, rings));
}

const LON_SCALE = Math.cos((40.7 * Math.PI) / 180);

function kernel(lat: number, lon: number, lat0: number, lon0: number, sigma: number): number {
  const dx = (lon - lon0) * LON_SCALE;
  const dy = lat - lat0;
  return Math.exp(-(dx * dx + dy * dy) / (2 * sigma * sigma));
}

/** Rough Manhattan outline (lon, lat): good enough to decide where the mock emits precision 7. */
const MANHATTAN: Ring = [
  [-74.022, 40.698],
  [-73.968, 40.708],
  [-73.943, 40.775],
  [-73.927, 40.797],
  [-73.907, 40.873],
  [-73.926, 40.881],
  [-74.012, 40.758],
];

export type MockRegion = 'manhattan' | 'staten_island' | 'other';

export function regionOf(lat: number, lon: number): MockRegion {
  if (lon < -74.04 && lat < 40.652) return 'staten_island';
  return pointInRings(lon, lat, [MANHATTAN]) ? 'manhattan' : 'other';
}

// ---------------------------------------------------------------------------------------------
// Grid and density
// ---------------------------------------------------------------------------------------------

const BASE32 = '0123456789bcdefghjkmnpqrstuvwxyz';

/** Anything shaped like src/data/grid-gh6.json (`kioskCell[k]` = index of kiosk k's cell). */
export interface MockGridInput {
  cells: readonly string[];
  kioskCell?: readonly number[];
}

export interface EmitCell {
  gh: string;
  lat: number;
  lon: number;
  kiosks: number;
}

export interface PreparedGrid {
  /** Analysis-grid cell centres. */
  centres: { gh: string; lat: number; lon: number }[];
  /** Where taste bumps may be centred: cells with street screens when kiosks are known, else all. */
  bumpCentres: { gh: string; lat: number; lon: number }[];
  /** Cells a synthetic heatmap reports: gh7 in Manhattan, gh5 on Staten Island, gh6 elsewhere. */
  emitted: EmitCell[];
}

/** A few New Jersey cells that `filter.location.query=NYC` also returns (outside the grid). */
const NJ_POINTS: [number, number][] = [
  [40.744, -74.0324],
  [40.7178, -74.0431],
  [40.7282, -74.0776],
];

export function prepareGrid(input: MockGridInput): PreparedGrid {
  const counts = new Map<string, number>();
  for (const idx of input.kioskCell ?? []) {
    const gh = input.cells[idx];
    if (gh) counts.set(gh, (counts.get(gh) ?? 0) + 1);
  }
  const centres = input.cells.map((gh) => {
    const p = ngeohash.decode(gh);
    return { gh, lat: p.latitude, lon: p.longitude };
  });
  const gh5Kiosks = new Map<string, { sum: number; n: number }>();
  for (const c of centres) {
    const k = c.gh.slice(0, 5);
    const agg = gh5Kiosks.get(k) ?? { sum: 0, n: 0 };
    agg.sum += counts.get(c.gh) ?? 0;
    agg.n += 1;
    gh5Kiosks.set(k, agg);
  }
  const emitted: EmitCell[] = [];
  const seen5 = new Set<string>();
  for (const c of centres) {
    // Coverage holes shared by every map (real heatmaps do not cover every cell).
    if (unit('hole', c.gh) < 0.025) continue;
    const region = regionOf(c.lat, c.lon);
    if (region === 'staten_island') {
      const gh5 = c.gh.slice(0, 5);
      if (seen5.has(gh5)) continue;
      seen5.add(gh5);
      const p = ngeohash.decode(gh5);
      const agg = gh5Kiosks.get(gh5) ?? { sum: 0, n: 1 };
      emitted.push({ gh: gh5, lat: p.latitude, lon: p.longitude, kiosks: agg.sum / Math.max(1, agg.n) });
    } else if (region === 'manhattan') {
      const first = hash32(`c7a|${c.gh}`) % 32;
      const second = (first + 1 + (hash32(`c7b|${c.gh}`) % 31)) % 32;
      for (const idx of [first, second]) {
        const gh7 = c.gh + BASE32.charAt(idx);
        const p = ngeohash.decode(gh7);
        emitted.push({ gh: gh7, lat: p.latitude, lon: p.longitude, kiosks: counts.get(c.gh) ?? 0 });
      }
    } else {
      emitted.push({ gh: c.gh, lat: c.lat, lon: c.lon, kiosks: counts.get(c.gh) ?? 0 });
    }
  }
  // Bumps sit on "neighborhoods with screens" so mock runs surface plannable neighborhoods.
  const withKiosks = centres.filter((c) => counts.has(c.gh));
  return { centres, bumpCentres: withKiosks.length > 0 ? withKiosks : centres, emitted };
}

/** [lat, lon, weight, sigma°] activity hubs; together with kiosks they make the density field D. */
const HUBS: [number, number, number, number][] = [
  [40.754, -73.984, 2.2, 0.025], // Midtown
  [40.709, -74.009, 1.2, 0.012], // Financial District
  [40.728, -73.995, 1.0, 0.015], // Greenwich Village
  [40.693, -73.987, 0.9, 0.015], // Downtown Brooklyn
  [40.714, -73.958, 0.7, 0.012], // Williamsburg
  [40.744, -73.949, 0.5, 0.01], // Long Island City
  [40.759, -73.83, 0.8, 0.012], // Flushing
  [40.702, -73.789, 0.5, 0.012], // Jamaica
  [40.861, -73.89, 0.6, 0.015], // Fordham
  [40.811, -73.946, 0.8, 0.018], // Harlem
  [40.643, -74.077, 0.3, 0.01], // St. George
];

export function syntheticDensity(c: { lat: number; lon: number; kiosks: number }): number {
  const region = regionOf(c.lat, c.lon);
  let d = region === 'manhattan' ? 0.8 : region === 'staten_island' ? 0.2 : 0.3;
  for (const [lat, lon, w, s] of HUBS) d += w * kernel(c.lat, c.lon, lat, lon, s);
  return d + 0.35 * Math.log1p(c.kiosks);
}

export interface TasteBump {
  lat: number;
  lon: number;
  sigma: number;
  amp: number;
  /** Grid cell the bump is centred on (ground truth for lift-engine tests). */
  gh: string;
}

/** The 2–3 planted, neighborhood-sized taste bumps for one signal (entity id, tag id or demographic value). */
export function plantedBumps(seed: string, grid: PreparedGrid, weight = 1): TasteBump[] {
  const pool = grid.bumpCentres;
  if (pool.length === 0) return [];
  const n = 2 + (hash32(`nb|${seed}`) % 2);
  const bumps: TasteBump[] = [];
  for (let i = 0; i < n; i++) {
    const c = pool[hash32(`bc|${seed}|${i}`) % pool.length];
    if (!c) continue;
    bumps.push({ lat: c.lat, lon: c.lon, gh: c.gh, sigma: 0.012 + 0.012 * unit('bs', seed, i), amp: weight * (0.8 + 0.8 * unit('ba', seed, i)) });
  }
  return bumps;
}

function zscores(values: readonly number[]): number[] {
  const n = values.length;
  if (n === 0) return [];
  const mean = values.reduce((a, b) => a + b, 0) / n;
  const sd = Math.sqrt(values.reduce((a, b) => a + (b - mean) ** 2, 0) / n);
  return sd > 1e-12 ? values.map((v) => (v - mean) / sd) : values.map(() => 0);
}

/** Average-rank percentile in (0, 1): (rank − 0.5) / n with ties sharing their mean rank. */
function percentiles(values: readonly number[]): number[] {
  const n = values.length;
  const order = values.map((v, i) => [v, i] as const).sort((a, b) => a[0] - b[0]);
  const out = new Array<number>(n).fill(0);
  let i = 0;
  while (i < n) {
    let j = i;
    while (j + 1 < n && order[j + 1]?.[0] === order[i]?.[0]) j++;
    const p = ((i + j) / 2 + 1 - 0.5) / n;
    for (let k = i; k <= j; k++) out[order[k]?.[1] ?? 0] = p;
    i = j + 1;
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Heatmaps
// ---------------------------------------------------------------------------------------------

export interface HeatmapSeeds {
  entities: readonly string[];
  tags: readonly string[];
  /** Demographic signal values, e.g. `age:35_and_younger`. */
  demographics: readonly string[];
}

export type MockLocation = { kind: 'wkt'; wkt: string } | { kind: 'query'; query: string };

const NYC_LOCALITY: Json = {
  entity_id: syntheticUuid('locality|new-york-city'),
  name: 'New York City',
  disambiguation: 'New York, United States',
  type: 'urn:entity',
  subtype: 'urn:entity:locality',
};

export interface SyntheticHeatmap {
  cells: Json[];
  /** Locality echo: an object for `NYC`, an array for other names, null for polygons. */
  locality: Json | Json[] | null;
}

export function syntheticHeatmap(grid: PreparedGrid, seeds: HeatmapSeeds, location: MockLocation): SyntheticHeatmap {
  let cells: EmitCell[];
  let locality: SyntheticHeatmap['locality'] = null;
  if (location.kind === 'wkt') {
    const rings = parseWktRings(location.wkt);
    cells = grid.emitted.filter((c) => cellTouches(c.gh, rings));
  } else {
    const q = fold(location.query);
    if (q === 'nyc' || q === 'new york city') {
      locality = q === 'nyc' ? NYC_LOCALITY : [NYC_LOCALITY];
      const emitted = new Set(grid.emitted.map((c) => c.gh));
      const extras = NJ_POINTS.map(([lat, lon]) => ({ gh: ngeohash.encode(lat, lon, 6), lat, lon, kiosks: 0 })).filter(
        (c) => !emitted.has(c.gh), // a cell is reported once
      );
      cells = [...grid.emitted, ...extras];
    } else if (q === 'new york') {
      // The trap ARCHITECTURE §6 warns about: "New York" is the state.
      locality = [{ ...NYC_LOCALITY, entity_id: syntheticUuid('locality|new-york-state'), name: 'New York', disambiguation: 'State, United States' }];
      cells = grid.emitted;
    } else {
      locality = [{ ...NYC_LOCALITY, entity_id: syntheticUuid(`locality|${q}`), name: location.query.trim(), disambiguation: null }];
      cells = [];
    }
  }

  const realEntities = seeds.entities.filter((e) => !e.startsWith(NODATA_PREFIX));
  const nodataOnly = realEntities.length === 0 && seeds.tags.length === 0 && seeds.demographics.length === 0;
  if (seeds.entities.length > 0 && seeds.entities.every((e) => e.startsWith(THIN_PREFIX))) {
    cells = cells.filter((c) => unit('thin', c.gh) < 0.2);
  }
  if (cells.length === 0) return { cells: [], locality };

  const bumps = [
    ...realEntities.flatMap((e) => plantedBumps(e, grid)),
    ...seeds.tags.flatMap((t) => plantedBumps(`tag:${t}`, grid)),
    // Demographic signals are broad: weak bumps on top of density.
    ...seeds.demographics.flatMap((d) => plantedBumps(`demo:${d}`, grid, 0.3)),
  ];
  const D = cells.map(syntheticDensity);
  const T = cells.map((c) => bumps.reduce((acc, b) => acc + b.amp * kernel(c.lat, c.lon, b.lat, b.lon, b.sigma), 0));
  const zD = zscores(D);
  const zT = zscores(T);
  const noiseKey = nodataOnly
    ? 'nodata-default'
    : [...realEntities].sort().join(',') + '|' + [...seeds.tags].sort().join(',') + '|' + [...seeds.demographics].sort().join(',');
  // Cell activity noise is a property of the place, shared by every map (so popularity is the same
  // whatever the signal); each map adds a little noise of its own on top of density and taste.
  const activity = cells.map((c, i) => 0.9 * (zD[i] ?? 0) + 0.25 * gauss('cell', c.gh));
  const affRaw = cells.map((c, i) => (activity[i] ?? 0) + 0.4 * (zT[i] ?? 0) + 0.06 * gauss('aff', noiseKey, c.gh));
  const aff = percentiles(affRaw);
  const popBase = percentiles(activity);
  const rankBase = nodataOnly ? popBase : percentiles(T);

  const rows = cells.map((c, i) => ({
    location: { latitude: round(c.lat), longitude: round(c.lon), geohash: c.gh },
    query: {
      affinity: round(aff[i] ?? 0),
      affinity_rank: round(clamp01((rankBase[i] ?? 0) + 0.05 * gauss('rank', noiseKey, c.gh))),
      popularity: round(popBase[i] ?? 0),
    },
  }));
  rows.sort((a, b) => b.query.affinity - a.query.affinity || (a.location.geohash < b.location.geohash ? -1 : 1));
  return { cells: rows, locality };
}

// ---------------------------------------------------------------------------------------------
// Search catalog
// ---------------------------------------------------------------------------------------------

interface CatalogEntry {
  name: string;
  type: EntityType;
  disambiguation?: string;
  year?: number;
  popularity: number;
  idPrefix?: string;
}

/** Planted cases: an ambiguity (two films), diacritics, a semantic match and default-map anchors. */
const CATALOG: CatalogEntry[] = [
  { name: 'Solaris', type: 'movie', year: 1972, disambiguation: 'Film · 1972 · Andrei Tarkovsky', popularity: 0.71 },
  { name: 'Solaris', type: 'movie', year: 2002, disambiguation: 'Film · 2002 · Steven Soderbergh', popularity: 0.68 },
  { name: 'Beyoncé', type: 'artist', disambiguation: 'Singer and songwriter', popularity: 0.99 },
  { name: 'Blue Note', type: 'place', disambiguation: 'Jazz club · Greenwich Village, New York', popularity: 0.93 },
  { name: 'Bursaspor', type: 'brand', disambiguation: 'Football club · Bursa', popularity: 0.31, idPrefix: NODATA_PREFIX },
  { name: 'Pick n Pay', type: 'brand', disambiguation: 'Supermarket chain · South Africa', popularity: 0.42, idPrefix: NODATA_PREFIX },
];

const VARIANT_SUFFIX: Record<EntityType, string[]> = {
  artist: ['Trio', 'Collective', 'Tribute Band'],
  book: ['Companion', 'Workbook'],
  brand: ['Kitchen', 'Market', 'Express'],
  movie: ['II', 'Returns', 'Redux'],
  person: ['Jr.', 'Sr.'],
  place: ['Annex', 'Garden', 'Rooftop'],
  podcast: ['Live', 'Extra'],
  tv_show: ['Revisited', 'Reunion'],
};

const TYPE_GENRES: Record<EntityType, string[]> = {
  artist: ['Jazz', 'Indie Rock', 'Neo-Soul', 'Hip-Hop', 'Latin Pop'],
  book: ['Literary Fiction', 'Graphic Novel', 'Memoir'],
  brand: ['Fast Casual', 'Streetwear', 'Coffee'],
  movie: ['Drama', 'Animation', 'Science Fiction', 'Comedy'],
  person: ['Comedy', 'Music', 'Film'],
  place: ['Museum', 'Jazz Club', 'Restaurant'],
  podcast: ['Culture', 'Comedy', 'Music'],
  tv_show: ['Comedy', 'Animation', 'Drama'],
};

function catalogId(e: CatalogEntry): string {
  return (e.idPrefix ?? '') + syntheticUuid(`${e.type}|${fold(e.name)}|${e.year ?? ''}`);
}

/** ID of a planted catalog entity (fixtures and tests refer to these). */
export function plantedId(type: EntityType, name: string, year?: number): string {
  const e = CATALOG.find((c) => c.type === type && fold(c.name) === fold(name) && (year === undefined || c.year === year));
  if (!e) throw new Error(`No planted synthetic ${type} called ${name}`);
  return catalogId(e);
}

function displayName(q: string): string {
  const clean = q.replace(/\s+/g, ' ').trim();
  if (/[A-Z]/.test(clean)) return clean;
  return clean.replace(/\b\p{L}/gu, (ch) => ch.toUpperCase());
}

function rawSearchEntity(
  input: { id: string; name: string; type: EntityType; popularity: number; disambiguation?: string; year?: number },
  near: { lat: number; lon: number } | null,
): Json {
  const genre = TYPE_GENRES[input.type][hash32(`genre|${input.id}`) % TYPE_GENRES[input.type].length] ?? 'Culture';
  const properties: Json = {};
  if (input.year) properties.release_year = input.year;
  const e: Json = {
    name: input.name,
    entity_id: input.id,
    types: [`urn:entity:${input.type}`],
    popularity: round(input.popularity, 4),
    properties,
    tags: [{ id: `${SYNTHETIC_ID_PREFIX}genre_${slug(genre)}`, name: genre, type: `urn:tag:genre:${input.type}` }],
  };
  if (input.disambiguation) e.disambiguation = input.disambiguation;
  if (input.type === 'place') {
    const c = near ?? { lat: 40.7128, lon: -74.006 };
    e.location = {
      lat: round(c.lat + 0.05 * (unit('plat', input.id) - 0.5), 5),
      lon: round(c.lon + 0.05 * (unit('plon', input.id) - 0.5), 5),
    };
    properties.address = `${10 + (hash32(`addr|${input.id}`) % 890)} Synthetic Ave, New York, NY`;
  }
  return e;
}

/** All planted catalog entities in raw /search shape (seeds the mock's /entities registry). */
export function catalogEntities(): Json[] {
  return CATALOG.map((e) =>
    rawSearchEntity({ id: catalogId(e), name: e.name, type: e.type, popularity: e.popularity, disambiguation: e.disambiguation, year: e.year }, null),
  );
}

/**
 * Synthetic /search: planted catalog matches when the folded query contains (or is contained in) a
 * catalog name; nothing for "zzzz"; otherwise an exact-name candidate plus one close variant.
 */
export function syntheticSearch(query: string, type: EntityType, take: number, near: { lat: number; lon: number } | null): Json[] {
  const q = fold(query);
  if (!q || q.includes('zzzz')) return [];
  const planted = CATALOG.filter((e) => e.type === type && (q.includes(fold(e.name)) || fold(e.name).includes(q)));
  if (planted.length > 0) {
    return planted
      .map((e) =>
        rawSearchEntity({ id: catalogId(e), name: e.name, type: e.type, popularity: e.popularity, disambiguation: e.disambiguation, year: e.year }, near),
      )
      .slice(0, take);
  }
  const name = displayName(query);
  const seed = `${type}|${q}`;
  const year = type === 'movie' || type === 'tv_show' ? 1985 + (hash32(`year|${seed}`) % 40) : undefined;
  const suffixes = VARIANT_SUFFIX[type];
  const suffix = suffixes[hash32(`suffix|${seed}`) % suffixes.length] ?? 'Live';
  return [
    rawSearchEntity({ id: syntheticUuid(seed), name, type, popularity: 0.55 + 0.4 * unit('pop', seed), year }, near),
    rawSearchEntity(
      { id: syntheticUuid(`${seed}|variant`), name: `${name} ${suffix}`, type, popularity: 0.2 + 0.3 * unit('pop2', seed), year: year ? year + 3 : undefined },
      near,
    ),
  ].slice(0, take);
}

/** Fallback for /entities ids the mock never generated. */
export function unknownEntity(id: string): Json {
  return { name: `Synthetic entity ${id.slice(-4)}`, entity_id: id, types: ['urn:entity:brand'], popularity: 0.5, properties: {} };
}

// ---------------------------------------------------------------------------------------------
// Places (place insights inside a polygon)
// ---------------------------------------------------------------------------------------------

type TagKind = 'category' | 'cuisine' | 'ambience' | 'good_for' | 'time_of_day_fit';

const TAG_TYPE: Record<TagKind | 'payments' | 'accessibility', string> = {
  category: 'urn:tag:category:place',
  cuisine: 'urn:tag:cuisine:qloo',
  ambience: 'urn:tag:ambience:qloo',
  good_for: 'urn:tag:good_for:qloo',
  time_of_day_fit: 'urn:tag:time_of_day_fit:qloo',
  // Sensitive kinds the evidence builder must drop.
  payments: 'urn:tag:payments:qloo',
  accessibility: 'urn:tag:accessibility:qloo',
};

/** Neighbourhood "themes" bias the tag mix so different polygons produce contrasting evidence. */
const THEMES: Record<TagKind, string[]>[] = [
  { category: ['Bar', 'Music Venue', 'Cocktail Bar'], cuisine: ['Natural Wine', 'Small Plates'], ambience: ['Lively', 'Dimly Lit'], good_for: ['Late Night', 'Live Music'], time_of_day_fit: ['Late Night', 'Evening'] },
  { category: ['Restaurant', 'Bakery'], cuisine: ['Soul Food', 'Caribbean', 'Barbecue'], ambience: ['Casual', 'Family Style'], good_for: ['Groups', 'Brunch'], time_of_day_fit: ['Afternoon', 'Evening'] },
  { category: ['Gallery', 'Bookstore', 'Cafe'], cuisine: ['Coffee', 'Vegan'], ambience: ['Artsy', 'Quiet'], good_for: ['Working', 'Solo Visits'], time_of_day_fit: ['Morning', 'Afternoon'] },
  { category: ['Record Store', 'Jazz Club', 'Music Venue'], cuisine: ['Cocktails', 'Small Plates'], ambience: ['Intimate', 'Retro'], good_for: ['Live Music', 'Date Night'], time_of_day_fit: ['Evening', 'Late Night'] },
  { category: ['Restaurant', 'Market'], cuisine: ['Ramen', 'Mexican', 'Greek'], ambience: ['Bustling', 'Casual'], good_for: ['Groups', 'Takeout'], time_of_day_fit: ['Afternoon', 'Evening'] },
  { category: ['Cafe', 'Bakery'], cuisine: ['Coffee', 'Bagels', 'Pastries'], ambience: ['Cozy', 'Laid-back'], good_for: ['Working', 'Brunch'], time_of_day_fit: ['Morning'] },
];

const PLACE_ADJ = ['Late', 'Copper', 'Velvet', 'Corner', 'Lantern', 'Stoop', 'Signal', 'Juniper', 'Marigold', 'Harbor', 'Pigeon', 'Tin', 'Ember', 'Fig'];
const PLACE_NOUN = ['Room', 'Kitchen', 'Social', 'Records', 'Cafe', 'Hall', 'Garden', 'Bar', 'Supply', 'Club', 'Works', 'House'];

function tag(kind: keyof typeof TAG_TYPE, name: string): Json {
  return { id: `${SYNTHETIC_ID_PREFIX}${kind}_${slug(name)}`, name, type: TAG_TYPE[kind] };
}

function pick<T>(list: readonly T[], ...seed: (string | number)[]): T {
  return list[hash32(seed.join('|')) % list.length] as T;
}

interface PoolPlace {
  id: string;
  name: string;
  lat: number;
  lon: number;
  tags: Json[];
  themeTags: Set<string>[];
  price: number;
  rating: number;
}

function placePool(wkt: string): PoolPlace[] {
  const area = wktDigest(wkt);
  const rings = parseWktRings(wkt);
  const [minX, minY, maxX, maxY] = ringsBBox(rings);
  // Tiny polygons hold few places (exercises the "≥8 places" viability check).
  const size = ringsAreaKm2(rings) < 0.4 ? 6 : 40;
  const theme = hash32(`theme|${area}`) % THEMES.length;
  const names = new Set<string>();
  const pool: PoolPlace[] = [];
  for (let j = 0; j < size; j++) {
    const own = unit('own', area, j) < 0.65 ? theme : hash32(`alt|${area}|${j}`) % THEMES.length;
    const t = THEMES[own] as Record<TagKind, string[]>;
    const tags: Json[] = [
      tag('category', pick(t.category, 'cat', area, j)),
      tag('cuisine', pick(t.cuisine, 'cui', area, j)),
      tag('ambience', pick(t.ambience, 'amb', area, j)),
      tag('good_for', pick(t.good_for, 'good', area, j)),
      tag('time_of_day_fit', pick(t.time_of_day_fit, 'time', area, j)),
    ];
    if (unit('amb2', area, j) < 0.5) tags.push(tag('ambience', pick(THEMES[(own + 1) % THEMES.length]?.ambience ?? ['Casual'], 'amb2n', area, j)));
    if (unit('pay', area, j) < 0.3) tags.push(tag('payments', 'Credit Cards'));
    if (unit('acc', area, j) < 0.2) tags.push(tag('accessibility', 'Wheelchair Accessible'));
    let name = `${pick(PLACE_ADJ, 'adj', area, j)} ${pick(PLACE_NOUN, 'noun', area, j)}`;
    if (names.has(name)) name = `${name} No. ${j + 1}`;
    names.add(name);
    let lat = (minY + maxY) / 2;
    let lon = (minX + maxX) / 2;
    for (let k = 0; k < 30; k++) {
      const x = minX + (maxX - minX) * unit('px', area, j, k);
      const y = minY + (maxY - minY) * unit('py', area, j, k);
      if (pointInRings(x, y, rings)) {
        lat = y;
        lon = x;
        break;
      }
    }
    pool.push({
      id: `${SYNTHETIC_ID_PREFIX}place_${hash32(`place|${area}|${j}`).toString(16).padStart(8, '0')}`,
      name,
      lat,
      lon,
      tags,
      themeTags: THEMES.map((th) => new Set(Object.values(th).flat())),
      price: 1 + (hash32(`price|${area}|${j}`) % 4),
      rating: round(3.6 + 1.3 * unit('rating', area, j), 1),
    });
  }
  return pool;
}

/** Synthetic `filter.type=urn:entity:place` results: the polygon's local places ranked for the anchors. */
export function syntheticPlaces(input: { wkt: string; entities: readonly string[]; take: number; explain: boolean }): Json[] {
  const pool = placePool(input.wkt);
  const anchors = [...input.entities].sort();
  const vibe = anchors.length > 0 ? hash32(`vibe|${anchors.join(',')}`) % THEMES.length : 0;
  const scored = pool.map((p) => {
    const names = p.tags.map((t) => String(t.name));
    const match = names.filter((n) => p.themeTags[vibe]?.has(n)).length / Math.max(1, names.length);
    const affinity = clamp01(0.45 * unit('base', p.id) + 0.45 * match + 0.1 * (0.5 + 0.2 * gauss('aff', p.id, anchors.join(','))));
    return { p, affinity };
  });
  scored.sort((a, b) => b.affinity - a.affinity || (a.p.id < b.p.id ? -1 : 1));
  return scored.slice(0, input.take).map(({ p, affinity }) => {
    const entity: Json = {
      name: p.name,
      entity_id: p.id,
      type: 'urn:entity',
      subtype: 'urn:entity:place',
      popularity: round(0.3 + 0.6 * unit('ppop', p.id), 4),
      location: { lat: round(p.lat), lon: round(p.lon), geohash: ngeohash.encode(p.lat, p.lon, 7) },
      properties: {
        address: `${10 + (hash32(`addr|${p.id}`) % 890)} Synthetic Ave, New York, NY`,
        price_level: p.price,
        business_rating: p.rating,
        keywords: [],
      },
      tags: p.tags,
      query: { affinity: round(affinity, 4) } as Json,
    };
    if (input.explain) {
      (entity.query as Json).explainability = {
        'signal.interests.entities': anchors.map((a) => ({ entity_id: a, score: round(0.3 + 0.7 * unit('explain', a, p.id), 3) })),
      };
    }
    return entity;
  });
}

// ---------------------------------------------------------------------------------------------
// Tags and demographics
// ---------------------------------------------------------------------------------------------

const TAG_POOLS: Record<string, string[]> = {
  'urn:tag:genre:music': ['Jazz', 'Neo-Soul', 'Hip-Hop', 'Indie Rock', 'Latin Pop', 'Afrobeats', 'House', 'R&B', 'Salsa', 'Punk', 'Ambient', 'Reggaeton'],
  'urn:tag:genre:media': ['Animation', 'Comedy', 'Drama', 'Documentary', 'Anime', 'Science Fiction', 'Coming of Age', 'Stand-Up'],
};
const DEFAULT_TAG_POOL = ['Vinyl', 'Street Food', 'Sneakers', 'Craft Beer', 'Comics', 'Film Photography', 'Natural Wine', 'Thrifting'];

/** Synthetic `filter.type=urn:tag` results; order depends on the location and the anchors. */
export function syntheticTags(input: { tagTypes: readonly string[]; location: string | null; entities: readonly string[]; take: number }): Json[] {
  const types = input.tagTypes.length > 0 ? input.tagTypes : ['urn:tag:keyword:qloo'];
  const seed = `${input.location ? wktDigest(input.location) : 'none'}|${[...input.entities].sort().join(',')}`;
  const rows = types.flatMap((type) =>
    (TAG_POOLS[type] ?? DEFAULT_TAG_POOL).map((name) => ({
      id: `${SYNTHETIC_ID_PREFIX}${slug(type.replace(/^urn:tag:/, ''))}_${slug(name)}`,
      name,
      type,
      query: { affinity: round(0.35 + 0.6 * unit('tagaff', seed, type, name), 4) },
    })),
  );
  rows.sort((a, b) => b.query.affinity - a.query.affinity || (a.id < b.id ? -1 : 1));
  return rows.slice(0, input.take);
}

const AGE_BUCKETS = ['24_and_younger', '25_to_29', '30_to_34', '35_to_44', '45_to_54', '55_and_older'];

export function syntheticDemographics(entities: readonly string[]): Json[] {
  return [...entities].sort().map((id) => ({
    entity_id: id,
    query: {
      age: Object.fromEntries(AGE_BUCKETS.map((b) => [b, round(Math.max(-1, Math.min(1, 0.2 * gauss('age', id, b))), 3)])),
      gender: { male: round(0.15 * gauss('male', id), 3), female: round(0.15 * gauss('female', id), 3) },
    },
  }));
}
