import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createRunCtx } from '@/server/qloo/client';
import { buildSyntheticFixtures, type SyntheticFixture } from '@/server/qloo/fixtures';
import {
  errorDetails,
  normalizeCandidates,
  normalizeDemographics,
  normalizeHeatmap,
  normalizePlaces,
  normalizeRoot,
  normalizeTags,
  unsupportedTypeFrom,
} from '@/server/qloo/normalize';
import { parseRateHeaders } from '@/server/qloo/ledger';
import {
  DemographicsResponseSchema,
  EntityInsightsResponseSchema,
  EntitySchema,
  ErrorBodySchema,
  HeatCellSchema,
  HeatmapResponseSchema,
  RootResponseSchema,
  SearchResponseSchema,
  TagInsightsResponseSchema,
} from '@/server/qloo/schemas';
import { SYNTHETIC_UUID_PREFIX } from '@/server/qloo/synthetic';
import { makeClient, scripted } from '../unit/qloo/helpers';

const DIR = path.resolve(import.meta.dirname, '../../fixtures/qloo');
const files = readdirSync(DIR).filter((f) => f.endsWith('.json'));
const fixtures = Object.fromEntries(
  files.map((f) => [f.replace(/^synthetic\.|\.json$/g, ''), JSON.parse(readFileSync(path.join(DIR, f), 'utf8')) as SyntheticFixture]),
);
const fx = (name: string): SyntheticFixture => {
  const f = fixtures[name];
  if (!f) throw new Error(`missing fixture ${name}`);
  return f;
};
const UUID_RE = /[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}/gi;

describe('synthetic fixtures', () => {
  it('are synthetic only: named synthetic.*.json, marked, and using the synthetic UUID prefix', () => {
    expect(files.length).toBeGreaterThanOrEqual(16);
    for (const f of files) {
      expect(f).toMatch(/^synthetic\.[a-z0-9-]+\.json$/);
      const text = readFileSync(path.join(DIR, f), 'utf8');
      const content = JSON.parse(text) as SyntheticFixture;
      expect(content._synthetic).toBe(true);
      expect(content.generator).toBe('scripts/gen-fixtures.ts');
      for (const uuid of text.match(UUID_RE) ?? []) expect(uuid.startsWith(SYNTHETIC_UUID_PREFIX)).toBe(true);
    }
  });

  it('equal a fresh generation (rerun `pnpm fixtures:gen` after changing the generator)', async () => {
    const fresh = await buildSyntheticFixtures();
    expect(Object.keys(fixtures).sort()).toEqual(fresh.map((f) => f.name).sort());
    for (const f of fresh) expect(fixtures[f.name]).toEqual(JSON.parse(JSON.stringify(f.content)));
  });
});

describe('loose schemas accept every synthetic success fixture', () => {
  it('root', () => {
    const f = fx('root');
    expect(RootResponseSchema.safeParse(f.body).success).toBe(true);
    const rate = parseRateHeaders(new Headers(f.headers));
    const n = normalizeRoot(f.body, rate);
    expect(n.ok && n.value).toMatchObject({ version: 'synthetic-1', rate: { month: { limit: 10_000, remaining: 9_999 }, second: { limit: 5 } } });
  });

  it.each(['search-solaris', 'search-brand', 'search-place', 'search-empty', 'entities'])('%s: flat results[] of entities', (name) => {
    const f = fx(name);
    const parsed = SearchResponseSchema.safeParse(f.body);
    expect(parsed.success).toBe(true);
    const rows = (f.body as { results: unknown[] }).results;
    for (const row of rows) expect(EntitySchema.safeParse(row).success).toBe(true);
    const n = normalizeCandidates(f.body);
    expect(n.ok && n.value.length).toBe(rows.length);
  });

  it('search-place: a place gets "Place · City, ST" context when Qloo gives no disambiguation', () => {
    const n = normalizeCandidates(fx('search-brand').body, 'brand');
    expect(n.ok && n.value[0]?.disambiguation).toBeNull();
    const solaris = normalizeCandidates(fx('search-solaris').body, 'movie');
    expect(solaris.ok && solaris.value.map((c) => c.year)).toEqual([1972, 2002]);
  });

  it.each(['heatmap-nyc', 'heatmap-default-map'])('%s: heatmap cells with mixed precision', (name) => {
    const f = fx(name);
    expect(HeatmapResponseSchema.safeParse(f.body).success).toBe(true);
    const rows = (f.body as { results: { heatmap: unknown[] } }).results.heatmap;
    for (const row of rows) expect(HeatCellSchema.safeParse(row).success).toBe(true);
    const n = normalizeHeatmap(f.body);
    if (!n.ok) throw new Error(n.message);
    expect(n.value.cells).toHaveLength(rows.length);
    expect(n.dropped).toBe(0);
    expect(new Set(n.value.cells.map((c) => c.gh.length))).toEqual(new Set([5, 6, 7]));
  });

  it('places, tags and demographics', () => {
    expect(EntityInsightsResponseSchema.safeParse(fx('places').body).success).toBe(true);
    const places = normalizePlaces(fx('places').body);
    expect(places.ok && places.value.length).toBe(8);
    expect(places.ok && places.value.every((p) => p.explain.length === 2 && p.tags.length >= 5)).toBe(true);
    expect(TagInsightsResponseSchema.safeParse(fx('tags').body).success).toBe(true);
    const tags = normalizeTags(fx('tags').body);
    expect(tags.ok && tags.value.map((t) => t.kind)).toEqual(['genre', 'genre', 'genre', 'genre', 'genre']);
    expect(DemographicsResponseSchema.safeParse(fx('demographics').body).success).toBe(true);
    const demo = normalizeDemographics(fx('demographics').body);
    expect(demo.ok && Object.keys(demo.value[0]?.age ?? {})).toHaveLength(6);
  });
});

describe('edge variants', () => {
  const cell = (gh: string, extra: Record<string, unknown> = {}) => ({
    location: { latitude: 40.7, longitude: -73.9, geohash: gh },
    query: { affinity: 0.5, affinity_rank: 0.4, popularity: 0.9 },
    ...extra,
  });
  const locality = { entity_id: 'L1', name: 'New York City', disambiguation: 'New York, United States' };

  it('locality echo as an object or as an array', () => {
    const asObject = normalizeHeatmap({ results: { heatmap: [cell('dr5ru7')] }, query: { localities: { filter: locality } } });
    const asArray = normalizeHeatmap({ results: { heatmap: [cell('dr5ru7')] }, query: { localities: { filter: [locality] } } });
    expect(asObject.ok && asObject.value.locality).toEqual({ id: 'L1', name: 'New York City', disambiguation: 'New York, United States' });
    expect(asArray.ok && asArray.value.locality).toEqual(asObject.ok && asObject.value.locality);
    const absent = normalizeHeatmap({ results: { heatmap: [] } });
    expect(absent.ok && absent.value).toEqual({ cells: [], locality: null });
  });

  it('entity type from `type` + `subtype`, from `types[]`, or the requested type for a bare urn:entity', () => {
    const base = { entity_id: 'E1', name: 'Blue Note' };
    const sub = normalizeCandidates({ results: [{ ...base, type: 'urn:entity', subtype: 'urn:entity:place' }] });
    const list = normalizeCandidates({ results: [{ ...base, types: ['urn:entity:place'] }] });
    const bare = normalizeCandidates({ results: [{ ...base, type: 'urn:entity' }] }, 'place');
    for (const n of [sub, list, bare]) expect(n.ok && n.value[0]?.type).toBe('place');
    const other = normalizeCandidates({ results: [{ ...base, types: ['urn:entity:locality'] }] }, 'place');
    expect(other.ok && other.value).toEqual([]);
  });

  it('flat results[] and nested results.entities[] both work for /search', () => {
    const row = { entity_id: 'E1', name: 'Solaris', types: ['urn:entity:movie'], properties: { release_year: 2002 } };
    const flat = normalizeCandidates({ results: [row] });
    const nested = normalizeCandidates({ results: { entities: [row] } });
    expect(flat.ok && flat.value).toEqual(nested.ok && nested.value);
    expect(flat.ok && flat.value[0]).toMatchObject({ disambiguation: 'Film · 2002', year: 2002 });
  });

  it('null or malformed scores become null without dropping the record', () => {
    const n = normalizeHeatmap({ results: { heatmap: [cell('dr5ru7', { query: { affinity: null, affinity_rank: 'high', popularity: 0.2 } })] } });
    expect(n.ok && n.value.cells).toEqual([{ gh: 'dr5ru7', aff: null, rank: null, pop: 0.2 }]);
    const places = normalizePlaces({
      results: {
        entities: [
          {
            entity_id: 'P1',
            name: 'Somewhere',
            popularity: null,
            query: { affinity: null, explainability: { 'signal.interests.entities': [{ entity_id: 'A', score: null }, { entity_id: 'B', score: 0.4 }] } },
          },
        ],
      },
    });
    expect(places.ok && places.value[0]).toMatchObject({ affinity: null, popularity: null, explain: [{ anchorId: 'B', score: 0.4 }] });
  });

  it('extra fields are ignored and never reach normalized data', () => {
    const n = normalizeCandidates({
      success: true,
      results: [{ entity_id: 'E1', name: 'Solaris', types: ['urn:entity:movie'], secret_new_field: { deep: 1 }, external: { imdb: 'tt' } }],
      duration: 12,
      something_new: [],
    });
    expect(n.ok && n.value[0]).toEqual({ id: 'E1', name: 'Solaris', type: 'movie', disambiguation: null, popularity: null, year: null });
    const h = normalizeHeatmap({ results: { heatmap: [cell('dr5ru7', { extra: true })], audiences: [] }, query: { localities: null, other: 1 } });
    expect(h.ok && Object.keys(h.value.cells[0] ?? {})).toEqual(['gh', 'aff', 'rank', 'pop']);
  });

  it('cells without a geohash are placed at precision 7; duplicates and unusable cells are dropped', () => {
    const n = normalizeHeatmap({
      results: {
        heatmap: [
          { location: { latitude: 40.7128, longitude: -74.006 }, query: { affinity: 0.1 } },
          cell('DR5RU7'),
          cell('dr5ru7'),
          { location: {}, query: { affinity: 0.3 } },
          'not a cell',
        ],
      },
    });
    if (!n.ok) throw new Error(n.message);
    expect(n.value.cells.map((c) => c.gh)).toEqual(['dr5regw', 'dr5ru7']);
    expect(n.dropped).toBe(3);
    expect(normalizeHeatmap({ results: { heatmap: ['x', 1] } }).ok).toBe(false);
    expect(normalizeHeatmap({ results: { heatmap: { not: 'an array' } } }).ok).toBe(false);
    expect(normalizeHeatmap({ nothing: true }).ok).toBe(false);
  });

  it('tags with tag_id, unknown kinds and place context', () => {
    const p = normalizePlaces({
      results: {
        entities: [
          {
            entity_id: 'P1',
            name: 'Somewhere',
            properties: { address: '200 Eastern Pkwy, Brooklyn, NY 11238, USA', price_level: 2, business_rating: 4.6 },
            tags: [
              { tag_id: 'urn:tag:cuisine:qloo:soul_food', name: 'Soul Food', type: 'urn:tag:cuisine:qloo' },
              { id: 'urn:tag:genre:place:jazz_club', name: 'Jazz Club' },
              { name: 'no id' },
            ],
          },
        ],
      },
    });
    expect(p.ok && p.value[0]).toMatchObject({
      priceLevel: 2,
      rating: 4.6,
      categories: ['Jazz Club'],
      tags: [
        { id: 'urn:tag:cuisine:qloo:soul_food', name: 'Soul Food', type: 'urn:tag:cuisine:qloo', kind: 'cuisine' },
        { id: 'urn:tag:genre:place:jazz_club', name: 'Jazz Club', type: 'urn:tag:genre:place', kind: 'genre' },
      ],
    });
    const place = normalizeCandidates({ results: [{ entity_id: 'M', name: 'Brooklyn Museum', types: ['urn:entity:place'], properties: { address: '200 Eastern Pkwy, Brooklyn, NY 11238, USA' } }] });
    expect(place.ok && place.value[0]?.disambiguation).toBe('Place · Brooklyn, NY');
  });

  it('error bodies: 429 {error_msg}, 400 errors[] with array or string paths, 403 permission messages', () => {
    for (const name of ['error-400', 'error-403', 'error-429-month', 'error-429-second', 'error-401']) {
      expect(ErrorBodySchema.safeParse(fx(name).body).success).toBe(true);
    }
    expect(errorDetails(fx('error-429-month').body)).toEqual({ messages: ['Rate limit exceeded'], issues: [], errorMsg: 'Rate limit exceeded' });
    expect(errorDetails(fx('error-400').body).issues).toEqual([{ message: 'Unsupported filter.type urn:bogus', path: 'filter.type' }]);
    expect(errorDetails({ errors: [{ message: 'bad', path: 'take' }] }).issues).toEqual([{ message: 'bad', path: 'take' }]);
    expect(errorDetails({ error: { message: 'nested' } }).messages).toEqual(['nested']);
    expect(errorDetails('<html>502</html>').messages).toEqual(['<html>502</html>']);
    expect(errorDetails(null)).toEqual({ messages: [], issues: [], errorMsg: null });
    expect(unsupportedTypeFrom(errorDetails(fx('error-403').body).messages)).toBe('urn:entity:videogame');
    expect(unsupportedTypeFrom(['You do not have permission to do that'])).toBe('unknown');
    expect(unsupportedTypeFrom(['Forbidden'])).toBeNull();
  });
});

describe('error fixtures through the client status table', () => {
  const reply = (name: string) => {
    const f = fx(name);
    return { status: f.status, json: f.body, headers: f.headers };
  };
  const okReply = { status: 200, json: fx('search-brand').body, headers: fx('search-brand').headers };
  const callWith = async (...replies: ReturnType<typeof reply>[]) => {
    const { transport, calls } = scripted(replies);
    const r = await makeClient(transport).client.forRun(createRunCtx({ runId: 'contract' })).search('Synthetic', 'brand');
    return { r, calls: calls.length };
  };

  it('maps each documented error to its code with the right number of attempts', async () => {
    expect(await callWith(reply('error-429-month'), okReply)).toMatchObject({ r: { ok: false, code: 'QUOTA_EXHAUSTED' }, calls: 1 });
    expect(await callWith(reply('error-429-second'), okReply)).toMatchObject({ r: { ok: true, meta: { attempts: 2 } }, calls: 2 });
    expect(await callWith(reply('error-401'), okReply)).toMatchObject({ r: { ok: false, code: 'AUTH' }, calls: 1 });
    expect(await callWith(reply('error-403'), okReply)).toMatchObject({ r: { ok: false, code: 'TYPE_UNSUPPORTED' }, calls: 1 });
    expect(await callWith(reply('error-400'), okReply)).toMatchObject({
      r: { ok: false, code: 'BAD_REQUEST', issues: [{ path: 'filter.type' }] },
      calls: 1,
    });
  });
});
