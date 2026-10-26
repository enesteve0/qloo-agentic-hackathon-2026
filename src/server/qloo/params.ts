import 'server-only';
import { ENTITY_TYPES, type EntityType } from '@/shared/types';
import { isWkt, wktDigest } from './keys';
import type { HeatmapSignals, RequestKind, WktLocation } from './types';

/**
 * Parameter allow-lists and request builders. Qloo silently ignores parameters it does not know, so
 * a typo would cost a call and return a misleading default answer; we throw locally instead.
 */

export class QlooParamError extends Error {
  override name = 'QlooParamError';
}

interface EndpointSpec {
  path: string;
  /** `filter.type` value for /v2/insights families. */
  filterType?: string;
  allowed: readonly string[];
  required: readonly string[];
}

export const ENDPOINTS: Readonly<Record<RequestKind, EndpointSpec>> = {
  root: { path: '/', allowed: [], required: [] },
  search: {
    path: '/search',
    allowed: ['query', 'types', 'take', 'page', 'filter.location', 'filter.radius'],
    required: ['query', 'types'],
  },
  entities: { path: '/entities', allowed: ['entity_ids'], required: ['entity_ids'] },
  heatmap: {
    path: '/v2/insights',
    filterType: 'urn:heatmap',
    allowed: [
      'filter.type',
      'filter.location',
      'filter.location.query',
      'signal.interests.entities',
      'signal.interests.tags',
      'signal.demographics.age',
      'signal.demographics.gender',
      'output.heatmap.boundary',
    ],
    required: ['filter.type'],
  },
  places: {
    path: '/v2/insights',
    filterType: 'urn:entity:place',
    allowed: [
      'filter.type',
      'filter.location',
      'filter.location.query',
      'signal.interests.entities',
      'signal.interests.tags',
      'take',
      'page',
      'feature.explainability',
    ],
    required: ['filter.type'],
  },
  tags: {
    path: '/v2/insights',
    filterType: 'urn:tag',
    allowed: [
      'filter.type',
      'filter.tag.types',
      'filter.parents.types',
      'signal.location',
      'signal.interests.entities',
      'signal.interests.tags',
      'take',
      'page',
    ],
    required: ['filter.type'],
  },
  demographics: {
    path: '/v2/insights',
    filterType: 'urn:demographics',
    allowed: ['filter.type', 'signal.interests.entities', 'signal.interests.tags'],
    required: ['filter.type'],
  },
};

/** Search centre for place anchors: City Hall, 25 miles (the /search radius is in MILES). */
export const NYC_SEARCH_CENTER = { lat: 40.7128, lon: -74.006, radiusMiles: 25 } as const;

export const MAX_TAKE = 50;
export const MAX_SIGNAL_IDS = 25;
export const MAX_ENTITY_IDS = 50;
/** Encoded query budget; long polygons are the risk (NTA WKT is capped at 4,000 encoded chars). */
export const MAX_QUERY_CHARS = 7_500;

const TOKEN_RE = /^[^\s,]+$/;
const ENTITY_URN_RE = /^urn:entity:[a-z_]+$/;
const TAG_TYPE_RE = /^urn:tag:[a-z0-9_:.]+$/;
const DEMO_RE = /^[a-z0-9_]+$/;
const LATLON_RE = /^-?\d{1,3}(\.\d+)?,-?\d{1,3}(\.\d+)?$/;
const NEW_YORK_STATE_RE = /^\s*new\s+york(\s+state)?\s*$/i;

// ---------------------------------------------------------------------------------------------
// Entity type mapping
// ---------------------------------------------------------------------------------------------

export type QlooEntityUrn = `urn:entity:${EntityType}`;

export function toQlooType(type: EntityType): QlooEntityUrn {
  return `urn:entity:${type}`;
}

/** Maps `urn:entity:<t>` (or a bare `<t>`) to an EntityType; other types (locality, …) → null. */
export function toEntityType(urn: string | null | undefined): EntityType | null {
  if (!urn) return null;
  const t = urn.startsWith('urn:entity:') ? urn.slice('urn:entity:'.length) : urn;
  return (ENTITY_TYPES as readonly string[]).includes(t) ? (t as EntityType) : null;
}

// ---------------------------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------------------------

/** Identifies the request family; unknown paths or insight types throw. */
export function kindOf(path: string, query: URLSearchParams): RequestKind {
  if (path === '/v2/insights') {
    const ft = query.get('filter.type');
    for (const [kind, spec] of Object.entries(ENDPOINTS) as [RequestKind, EndpointSpec][]) {
      if (spec.path === path && spec.filterType === ft) return kind;
    }
    throw new QlooParamError(`Unsupported filter.type ${JSON.stringify(ft)} for /v2/insights`);
  }
  for (const [kind, spec] of Object.entries(ENDPOINTS) as [RequestKind, EndpointSpec][]) {
    if (spec.path === path && !spec.filterType) return kind;
  }
  throw new QlooParamError(`Unsupported Qloo path ${JSON.stringify(path)}`);
}

/** Throws QlooParamError for unknown, duplicate, missing or malformed parameters. */
export function validateQuery(path: string, query: URLSearchParams): RequestKind {
  const kind = kindOf(path, query);
  const spec = ENDPOINTS[kind];
  const seen = new Set<string>();
  for (const [k, v] of query) {
    if (!spec.allowed.includes(k)) {
      throw new QlooParamError(`Unknown Qloo parameter "${k}" for ${kind} (Qloo would silently ignore it)`);
    }
    if (seen.has(k)) throw new QlooParamError(`Duplicate Qloo parameter "${k}"`);
    seen.add(k);
    if (v.trim() === '') throw new QlooParamError(`Empty value for Qloo parameter "${k}"`);
  }
  for (const k of spec.required) {
    if (!query.has(k)) throw new QlooParamError(`Missing required Qloo parameter "${k}" for ${kind}`);
  }
  checkSemantics(kind, query);
  const encodedLength = query.toString().length;
  if (encodedLength > MAX_QUERY_CHARS) {
    throw new QlooParamError(`Qloo query too long (${encodedLength} > ${MAX_QUERY_CHARS} encoded chars)`);
  }
  return kind;
}

function checkSemantics(kind: RequestKind, q: URLSearchParams): void {
  const take = q.get('take');
  if (take !== null) checkInt('take', take, 1, MAX_TAKE);
  const page = q.get('page');
  if (page !== null) checkInt('page', page, 1, 1_000);

  for (const key of ['signal.interests.entities', 'signal.interests.tags'] as const) {
    const v = q.get(key);
    if (v !== null) checkList(key, v, TOKEN_RE, MAX_SIGNAL_IDS);
  }
  for (const key of ['signal.demographics.age', 'signal.demographics.gender'] as const) {
    const v = q.get(key);
    if (v !== null) checkList(key, v, DEMO_RE, 12);
  }
  for (const key of ['filter.tag.types', 'filter.parents.types'] as const) {
    const v = q.get(key);
    if (v !== null) checkList(key, v, TAG_TYPE_RE, 12);
  }
  const sigLoc = q.get('signal.location');
  if (sigLoc !== null && !isWkt(sigLoc)) throw new QlooParamError('signal.location must be a WKT POLYGON');

  switch (kind) {
    case 'search': {
      checkList('types', q.get('types') ?? '', ENTITY_URN_RE, 4);
      const loc = q.get('filter.location');
      const radius = q.get('filter.radius');
      if (loc !== null && !LATLON_RE.test(loc)) throw new QlooParamError('search filter.location must be "lat,lon"');
      if (radius !== null) {
        if (loc === null) throw new QlooParamError('filter.radius requires filter.location');
        const r = Number(radius);
        if (!Number.isFinite(r) || r <= 0 || r > 100) throw new QlooParamError('filter.radius must be 0–100 miles');
      }
      break;
    }
    case 'entities':
      checkList('entity_ids', q.get('entity_ids') ?? '', TOKEN_RE, MAX_ENTITY_IDS);
      break;
    case 'heatmap': {
      checkLocation(q, true);
      const hasSignal = ['signal.interests.entities', 'signal.interests.tags', 'signal.demographics.age', 'signal.demographics.gender'].some(
        (k) => q.has(k),
      );
      if (!hasSignal) throw new QlooParamError('A heatmap needs at least one signal');
      break;
    }
    case 'places':
      checkLocation(q, true);
      if (q.has('feature.explainability') && !['true', 'false'].includes(q.get('feature.explainability') ?? '')) {
        throw new QlooParamError('feature.explainability must be true or false');
      }
      break;
    case 'demographics':
      if (!q.has('signal.interests.entities') && !q.has('signal.interests.tags')) {
        throw new QlooParamError('Demographics insights need signal.interests.entities or signal.interests.tags');
      }
      break;
    default:
      break;
  }
}

function checkLocation(q: URLSearchParams, required: boolean): void {
  const wkt = q.get('filter.location');
  const name = q.get('filter.location.query');
  if (wkt !== null && name !== null) throw new QlooParamError('Use either filter.location or filter.location.query, not both');
  if (required && wkt === null && name === null) throw new QlooParamError('filter.location or filter.location.query is required');
  if (wkt !== null && !isWkt(wkt)) throw new QlooParamError('filter.location must be a WKT POLYGON or MULTIPOLYGON');
  if (name !== null && NEW_YORK_STATE_RE.test(name)) {
    throw new QlooParamError('filter.location.query "New York" resolves to the state; use "NYC" or the study polygon');
  }
}

function checkInt(key: string, value: string, min: number, max: number): void {
  const n = Number(value);
  if (!Number.isInteger(n) || n < min || n > max) throw new QlooParamError(`${key} must be an integer ${min}–${max}`);
}

function checkList(key: string, value: string, re: RegExp, max: number): void {
  const items = value.split(',');
  if (items.length === 0 || items.length > max) throw new QlooParamError(`${key} must list 1–${max} values`);
  for (const item of items) {
    if (!re.test(item)) throw new QlooParamError(`Invalid value ${JSON.stringify(item)} in ${key}`);
  }
}

// ---------------------------------------------------------------------------------------------
// Builders (every builder validates, so a bad request never reaches the cache or the network)
// ---------------------------------------------------------------------------------------------

function uniqueSorted(values: readonly string[]): string[] {
  return [...new Set(values.map((v) => v.trim()).filter(Boolean))].sort();
}

function setList(q: URLSearchParams, key: string, values: readonly string[] | undefined): void {
  if (values && values.length > 0) {
    const list = uniqueSorted(values);
    if (list.length > 0) q.set(key, list.join(','));
  }
}

export interface SearchInput {
  query: string;
  type: EntityType;
  take?: number;
  /** undefined → NYC centre for places; null → no location filter. */
  location?: { lat: number; lon: number; radiusMiles: number } | null;
}

export function buildSearch(input: SearchInput): URLSearchParams {
  const q = new URLSearchParams();
  q.set('query', input.query.replace(/\s+/g, ' ').trim());
  q.set('types', toQlooType(input.type));
  q.set('take', String(input.take ?? 5));
  const loc = input.location === undefined && input.type === 'place' ? NYC_SEARCH_CENTER : input.location;
  if (loc) {
    q.set('filter.location', `${loc.lat.toFixed(4)},${loc.lon.toFixed(4)}`);
    q.set('filter.radius', String(loc.radiusMiles));
  }
  validateQuery(ENDPOINTS.search.path, q);
  return q;
}

export function buildEntities(ids: readonly string[]): URLSearchParams {
  const q = new URLSearchParams();
  setList(q, 'entity_ids', ids);
  if (!q.has('entity_ids')) throw new QlooParamError('entities() needs at least one id');
  validateQuery(ENDPOINTS.entities.path, q);
  return q;
}

export interface HeatmapInput {
  signals: HeatmapSignals;
  location: WktLocation | { query: string };
  boundary?: string;
}

export function buildHeatmap(input: HeatmapInput): URLSearchParams {
  const q = new URLSearchParams();
  q.set('filter.type', 'urn:heatmap');
  if ('wkt' in input.location) q.set('filter.location', input.location.wkt.trim());
  else q.set('filter.location.query', input.location.query.trim());
  setList(q, 'signal.interests.entities', input.signals.entities);
  setList(q, 'signal.interests.tags', input.signals.tags);
  setList(q, 'signal.demographics.age', input.signals.demographics?.age);
  setList(q, 'signal.demographics.gender', input.signals.demographics?.gender);
  if (input.boundary) q.set('output.heatmap.boundary', input.boundary);
  validateQuery(ENDPOINTS.heatmap.path, q);
  return q;
}

export interface PlacesInput {
  wkt: string;
  entityIds: readonly string[];
  take?: number;
  explain?: boolean;
}

export function buildPlaces(input: PlacesInput): URLSearchParams {
  const q = new URLSearchParams();
  q.set('filter.type', 'urn:entity:place');
  q.set('filter.location', input.wkt.trim());
  setList(q, 'signal.interests.entities', input.entityIds);
  q.set('take', String(input.take ?? 15));
  if (input.explain ?? true) q.set('feature.explainability', 'true');
  validateQuery(ENDPOINTS.places.path, q);
  return q;
}

export interface TagInsightsInput {
  tagTypes?: readonly string[];
  location?: WktLocation;
  entityIds?: readonly string[];
  take?: number;
}

export function buildTagInsights(input: TagInsightsInput): URLSearchParams {
  const q = new URLSearchParams();
  q.set('filter.type', 'urn:tag');
  setList(q, 'filter.tag.types', input.tagTypes);
  if (input.location) q.set('signal.location', input.location.wkt.trim());
  setList(q, 'signal.interests.entities', input.entityIds);
  if (input.take !== undefined) q.set('take', String(input.take));
  validateQuery(ENDPOINTS.tags.path, q);
  return q;
}

export function buildDemographics(ids: readonly string[]): URLSearchParams {
  const q = new URLSearchParams();
  q.set('filter.type', 'urn:demographics');
  setList(q, 'signal.interests.entities', ids);
  validateQuery(ENDPOINTS.demographics.path, q);
  return q;
}

// ---------------------------------------------------------------------------------------------
// Provenance redaction
// ---------------------------------------------------------------------------------------------

/** `POLYGON(<label>)` for provenance; a short digest when the caller gave no label. */
export function polygonLabel(wkt: string, label?: string): string {
  if (label) return /^(MULTI)?POLYGON\s*\(/i.test(label) ? label : `POLYGON(${label})`;
  return `POLYGON(wkt:${wktDigest(wkt).slice(0, 10)})`;
}

/**
 * Human-readable query for the provenance drawer: polygons replaced by a label. The API key travels
 * in a header and is never part of the query; key-like parameters are dropped defensively anyway.
 */
export function redactQuery(query: URLSearchParams, wktLabel?: string): string {
  const parts: string[] = [];
  for (const [k, v] of query) {
    if (/key|token|secret/i.test(k)) continue;
    parts.push(`${k}=${isWkt(v) ? polygonLabel(v, wktLabel) : v}`);
  }
  return parts.join('&');
}
