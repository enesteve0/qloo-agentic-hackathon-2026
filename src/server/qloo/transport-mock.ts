import 'server-only';
import { ENTITY_TYPES, type EntityType } from '@/shared/types';
import { defaultSleep, type SleepFn } from './pacing';
import {
  catalogEntities,
  prepareGrid,
  syntheticDemographics,
  syntheticHeatmap,
  syntheticPlaces,
  syntheticSearch,
  syntheticTags,
  unknownEntity,
  type MockGridInput,
  type PreparedGrid,
} from './synthetic';
import type { QlooTransport, RequestKind, TransportResponse } from './types';

/**
 * Synthetic Qloo transport (mock mode). Answers the same paths and parameters as the real API with
 * deterministic generated data, realistic error bodies and decrementing rate-limit headers.
 * Everything it returns is SYNTHETIC; the client keeps it in a separate cache/ledger namespace.
 */

const MONTH_MS = 30 * 24 * 60 * 60 * 1000;
/** Types a hackathon key is assumed not to cover; the mock answers 403 like the real API. */
const RESTRICTED_TYPES = new Set(['urn:entity:videogame']);

export interface MockTransportOptions {
  /** The analysis grid (`{ cells }`-compatible) or a lazy loader for it. */
  grid: MockGridInput | (() => Promise<MockGridInput>);
  now?: () => number;
  sleep?: SleepFn;
  /** Simulated latency per request family (default none). */
  latencyMs?: (kind: RequestKind) => number;
  monthLimit?: number;
  secondLimit?: number;
}

export interface MockTransport extends QlooTransport {
  readonly kind: 'mock';
  /** Requests served so far (each one decrements the synthetic month counter). */
  readonly requests: number;
}

const json = (status: number, body: unknown, headers: Headers): TransportResponse => {
  const text = JSON.stringify(body);
  return { status, headers, json: JSON.parse(text) as unknown, bytes: Buffer.byteLength(text) };
};

const badRequest = (message: string, path: string) => ({ errors: [{ message, path: [path] }] });

function list(q: URLSearchParams, key: string): string[] {
  return (q.get(key) ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function entityTypeOf(urn: string): EntityType | null {
  const t = urn.replace(/^urn:entity:/, '');
  return (ENTITY_TYPES as readonly string[]).includes(t) ? (t as EntityType) : null;
}

export function createMockTransport(o: MockTransportOptions): MockTransport {
  const now = o.now ?? Date.now;
  const sleep = o.sleep ?? defaultSleep;
  const monthLimit = o.monthLimit ?? 10_000;
  const secondLimit = o.secondLimit ?? 5;
  let served = 0;
  let windowStart: number | null = null;
  let prepared: Promise<PreparedGrid> | null = null;
  const registry = new Map<string, Record<string, unknown>>();
  for (const e of catalogEntities()) registry.set(String(e.entity_id), e);

  const grid = (): Promise<PreparedGrid> => {
    prepared ??= (typeof o.grid === 'function' ? o.grid() : Promise.resolve(o.grid)).then(prepareGrid);
    return prepared;
  };

  function headers(remaining: number): Headers {
    windowStart ??= now();
    const resetSec = Math.max(1, Math.ceil((windowStart + MONTH_MS - now()) / 1000));
    return new Headers({
      'content-type': 'application/json',
      'x-second-ratelimit-limit': String(secondLimit),
      'x-second-ratelimit-remaining': String(secondLimit - 1),
      'x-second-ratelimit-reset': '1',
      'x-month-ratelimit-limit': String(monthLimit),
      'x-month-ratelimit-remaining': String(Math.max(0, remaining)),
      'x-month-ratelimit-reset': String(resetSec),
      'x-qloo-request-id': `synthetic-${served}`,
    });
  }

  async function route(path: string, q: URLSearchParams, h: Headers): Promise<{ kind: RequestKind; res: TransportResponse }> {
    if (path === '/') {
      return { kind: 'root', res: json(200, { name: 'Synthetic Qloo transport', version: 'synthetic-1', _synthetic: true }, h) };
    }
    if (path === '/search') {
      const query = q.get('query');
      const typeUrn = list(q, 'types')[0] ?? '';
      if (!query) return { kind: 'search', res: json(400, badRequest('query is required', 'query'), h) };
      if (RESTRICTED_TYPES.has(typeUrn)) {
        return { kind: 'search', res: json(403, { message: `You do not have permission to access ${typeUrn}` }, h) };
      }
      const type = entityTypeOf(typeUrn) ?? 'brand';
      const take = Math.min(50, Math.max(1, Number(q.get('take') ?? 20) || 20));
      const loc = q.get('filter.location')?.split(',').map(Number);
      const near = loc && loc.length === 2 && loc.every(Number.isFinite) ? { lat: loc[0] as number, lon: loc[1] as number } : null;
      const results = syntheticSearch(query, type, take, near);
      for (const e of results) registry.set(String(e.entity_id), e);
      return { kind: 'search', res: json(200, { results }, h) };
    }
    if (path === '/entities') {
      const ids = list(q, 'entity_ids');
      if (ids.length === 0) return { kind: 'entities', res: json(400, badRequest('entity_ids is required', 'entity_ids'), h) };
      return { kind: 'entities', res: json(200, { results: ids.map((id) => registry.get(id) ?? unknownEntity(id)) }, h) };
    }
    if (path === '/v2/insights') {
      const filterType = q.get('filter.type');
      const entities = list(q, 'signal.interests.entities');
      const take = Math.min(50, Math.max(1, Number(q.get('take') ?? 20) || 20));
      switch (filterType) {
        case 'urn:heatmap': {
          const tags = list(q, 'signal.interests.tags');
          const demographics = [
            ...list(q, 'signal.demographics.age').map((v) => `age:${v}`),
            ...list(q, 'signal.demographics.gender').map((v) => `gender:${v}`),
          ];
          if (entities.length + tags.length + demographics.length === 0) {
            return { kind: 'heatmap', res: json(400, badRequest('At least one signal is required', 'signal'), h) };
          }
          const wkt = q.get('filter.location');
          const name = q.get('filter.location.query');
          if (!wkt && !name) return { kind: 'heatmap', res: json(400, badRequest('filter.location is required', 'filter.location'), h) };
          const map = syntheticHeatmap(await grid(), { entities, tags, demographics }, wkt ? { kind: 'wkt', wkt } : { kind: 'query', query: name ?? '' });
          const body: Record<string, unknown> = { success: true, results: { heatmap: map.cells }, duration: 300 + Math.round(map.cells.length / 4) };
          if (map.locality) body.query = { localities: { filter: map.locality } };
          return { kind: 'heatmap', res: json(200, body, h) };
        }
        case 'urn:entity:place': {
          const wkt = q.get('filter.location');
          if (!wkt) return { kind: 'places', res: json(400, badRequest('filter.location is required', 'filter.location'), h) };
          const results = syntheticPlaces({ wkt, entities, take, explain: q.get('feature.explainability') === 'true' });
          return { kind: 'places', res: json(200, { success: true, results: { entities: results }, duration: 250 }, h) };
        }
        case 'urn:tag': {
          const tags = syntheticTags({ tagTypes: list(q, 'filter.tag.types'), location: q.get('signal.location'), entities, take });
          return { kind: 'tags', res: json(200, { success: true, results: { tags }, duration: 200 }, h) };
        }
        case 'urn:demographics': {
          if (entities.length === 0) {
            return { kind: 'demographics', res: json(400, badRequest('signal.interests.entities is required', 'signal.interests.entities'), h) };
          }
          return { kind: 'demographics', res: json(200, { success: true, results: { demographics: syntheticDemographics(entities) } }, h) };
        }
        case null:
          return { kind: 'heatmap', res: json(400, badRequest('filter.type is required', 'filter.type'), h) };
        default:
          if (RESTRICTED_TYPES.has(filterType)) {
            return { kind: 'places', res: json(403, { message: `You do not have permission to access ${filterType}` }, h) };
          }
          return { kind: 'heatmap', res: json(400, badRequest(`Unsupported filter.type ${filterType}`, 'filter.type'), h) };
      }
    }
    return { kind: 'root', res: json(404, { errors: [{ message: 'Not found' }] }, h) };
  }

  return {
    kind: 'mock',
    get requests() {
      return served;
    },
    async fetch(path, query, signal) {
      if (signal.aborted) throw signal.reason;
      served++;
      const remaining = monthLimit - served;
      const h = headers(remaining);
      if (remaining < 0) {
        // The synthetic month is used up: same body as the real monthly 429 (no Retry-After).
        return json(429, { error_msg: 'Rate limit exceeded' }, h);
      }
      const { kind, res } = await route(path, query, h);
      const delay = o.latencyMs?.(kind) ?? 0;
      if (delay > 0) await sleep(delay, signal);
      return res;
    },
  };
}

/** Realistic latencies so the streaming UI behaves like it will with the live API. */
const DEV_LATENCY: Record<RequestKind, number> = {
  root: 60,
  search: 180,
  entities: 120,
  heatmap: 900,
  places: 600,
  tags: 500,
  demographics: 300,
};

/**
 * The mock used by getQlooClient(): the committed analysis grid is imported lazily so it is only
 * loaded when mock mode is actually used. Tests inject a tiny grid via createMockTransport instead.
 */
export function createDefaultMockTransport(overrides: Partial<MockTransportOptions> = {}): MockTransport {
  return createMockTransport({
    grid: async () => (await import('@/data/grid-gh6.json')).default as MockGridInput,
    latencyMs: process.env.NODE_ENV === 'test' ? undefined : (kind) => DEV_LATENCY[kind],
    ...overrides,
  });
}
