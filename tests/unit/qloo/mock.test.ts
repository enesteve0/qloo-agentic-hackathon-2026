import ngeohash from 'ngeohash';
import { describe, expect, it } from 'vitest';
import { normalizeCandidates, normalizeHeatmap, normalizePlaces } from '@/server/qloo/normalize';
import { buildHeatmap, buildPlaces, buildSearch } from '@/server/qloo/params';
import {
  NODATA_PREFIX,
  SYNTHETIC_UUID_PREFIX,
  THIN_PREFIX,
  plantedBumps,
  plantedId,
  prepareGrid,
  regionOf,
  syntheticUuid,
  unit,
} from '@/server/qloo/synthetic';
import { createMockTransport } from '@/server/qloo/transport-mock';
import type { HeatmapData } from '@/shared/types';

/** The gh6 cell at (lat, lon), nudged north until it isn't one of the generator's shared coverage holes. */
function solidCell(lat: number, lon: number): string {
  for (let step = 0; step < 20; step++) {
    const gh = ngeohash.encode(lat + step * 0.004, lon, 6);
    if (unit('hole', gh) >= 0.025) return gh;
  }
  throw new Error('no solid cell near the sample point');
}

const MANHATTAN = solidCell(40.754, -73.984);
const STATEN_ISLAND = [solidCell(40.58, -74.15), solidCell(40.6, -74.12)];
const BROOKLYN = [ngeohash.encode(40.67, -73.95, 6), ngeohash.encode(40.69, -73.92, 6), ngeohash.encode(40.65, -73.97, 6)];
const QUEENS = [ngeohash.encode(40.75, -73.83, 6), ngeohash.encode(40.72, -73.8, 6)];
const GRID = { cells: [MANHATTAN, ...STATEN_ISLAND, ...BROOKLYN, ...QUEENS] };
const signal = new AbortController().signal;
const NYC_BOX = 'POLYGON((-74.26 40.49, -73.70 40.49, -73.70 40.92, -74.26 40.92, -74.26 40.49))';
const BK_BOX = 'POLYGON((-74.00 40.62, -73.90 40.62, -73.90 40.70, -74.00 40.70, -74.00 40.62))';

async function heatmap(entities: string[], location: { wkt: string } | { query: string } = { query: 'NYC' }, grid = GRID) {
  const t = createMockTransport({ grid, now: () => 0 });
  const res = await t.fetch('/v2/insights', buildHeatmap({ signals: { entities }, location }), signal);
  const n = normalizeHeatmap(res.json);
  if (!n.ok) throw new Error(n.message);
  return { res, map: n.value };
}

const byGh = (m: HeatmapData) => Object.fromEntries(m.cells.map((c) => [c.gh, c]));

describe('synthetic heatmaps', () => {
  it('are deterministic per request and differ between anchors', async () => {
    const a1 = await heatmap([syntheticUuid('a')]);
    const a2 = await heatmap([syntheticUuid('a')]);
    const b = await heatmap([syntheticUuid('b')]);
    expect(a1.res.json).toEqual(a2.res.json);
    // Cells are sorted by affinity, so compare per geohash.
    expect(byGh(a1.map)).toEqual(byGh(a2.map));
    expect(byGh(a1.map)).not.toEqual(byGh(b.map));
  });

  it('mix precisions: gh7 in Manhattan, gh5 on Staten Island, gh6 elsewhere, plus a few NJ cells for NYC', async () => {
    const isHole = (gh: string) => unit('hole', gh) < 0.025; // coverage holes shared by every map
    expect([MANHATTAN, ...STATEN_ISLAND].some(isHole)).toBe(false);
    const { map } = await heatmap([syntheticUuid('a')]);
    const gh = map.cells.map((c) => c.gh);
    expect(gh.filter((g) => g.length === 7)).toHaveLength(2);
    expect(gh.filter((g) => g.length === 7).every((g) => g.startsWith(MANHATTAN))).toBe(true);
    expect(gh.filter((g) => g.length === 5).sort()).toEqual([...new Set(STATEN_ISLAND.map((c) => c.slice(0, 5)))].sort());
    const others = [...BROOKLYN, ...QUEENS].filter((c) => !isHole(c)).sort();
    expect(gh.filter((g) => g.length === 6 && GRID.cells.includes(g)).sort()).toEqual(others);
    expect(gh.filter((g) => g.length === 6 && !GRID.cells.includes(g))).toHaveLength(3);
    expect(map.locality).toMatchObject({ name: 'New York City' });
    expect(regionOf(40.754, -73.984)).toBe('manhattan');
    expect(regionOf(40.58, -74.15)).toBe('staten_island');
    expect(regionOf(40.67, -73.95)).toBe('other');
  });

  it('report percentile-like values in [0, 1] with popularity independent of the signal', async () => {
    const a = await heatmap([syntheticUuid('a')]);
    const b = await heatmap([syntheticUuid('b')]);
    for (const c of a.map.cells) {
      for (const v of [c.aff, c.rank, c.pop]) {
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(1);
      }
    }
    const popA = a.map.cells.map((c) => [c.gh, c.pop]).sort();
    const popB = b.map.cells.map((c) => [c.gh, c.pop]).sort();
    expect(popA).toEqual(popB);
  });

  it('return one identical density-only map for every nodata- id (planted default map)', async () => {
    const x = await heatmap([`${NODATA_PREFIX}x`]);
    const y = await heatmap([`${NODATA_PREFIX}${syntheticUuid('y')}`]);
    expect(x.map).toEqual(y.map);
    for (const c of x.map.cells) expect(c.rank).toBeCloseTo(c.pop ?? 0, 0);
    const mixed = await heatmap([`${NODATA_PREFIX}x`, syntheticUuid('a')]);
    const plain = await heatmap([syntheticUuid('a')]);
    expect(mixed.map).toEqual(plain.map); // no-data anchors add nothing
  });

  it('thin- ids keep only a sparse subset of cells', async () => {
    const full = await heatmap([syntheticUuid('a')], { wkt: NYC_BOX }, { cells: [...GRID.cells, ...Array.from({ length: 60 }, (_, i) => ngeohash.encode(40.6 + i * 0.003, -73.9, 6))] });
    const thin = await heatmap([`${THIN_PREFIX}a`], { wkt: NYC_BOX }, { cells: [...GRID.cells, ...Array.from({ length: 60 }, (_, i) => ngeohash.encode(40.6 + i * 0.003, -73.9, 6))] });
    expect(thin.map.cells.length).toBeLessThan(full.map.cells.length * 0.5);
  });

  it('filter cells to a WKT polygon and echo no locality for polygons', async () => {
    const { map } = await heatmap([syntheticUuid('a')], { wkt: BK_BOX });
    expect(map.cells.length).toBeGreaterThan(0);
    expect(map.cells.every((c) => !c.gh.startsWith(MANHATTAN) && c.gh.length === 6)).toBe(true);
    expect(map.locality).toBeNull();
    const elsewhere = await heatmap([syntheticUuid('a')], { query: 'Springfield' });
    expect(elsewhere.map.cells).toEqual([]);
    expect(elsewhere.map.locality?.name).toBe('Springfield');
  });

  it('plants 2–3 bumps per signal, on cells with kiosks when kiosks are known', () => {
    const grid = prepareGrid({ cells: GRID.cells, kioskCell: [0, 0, 3] });
    for (const seed of ['a', 'b', 'c', 'd']) {
      const bumps = plantedBumps(seed, grid);
      expect(bumps.length).toBeGreaterThanOrEqual(2);
      expect(bumps.length).toBeLessThanOrEqual(3);
      expect(bumps.every((b) => b.gh === GRID.cells[0] || b.gh === GRID.cells[3])).toBe(true);
    }
    expect(plantedBumps('a', grid)).toEqual(plantedBumps('a', grid));
  });
});

describe('synthetic search, entities, places', () => {
  const t = () => createMockTransport({ grid: GRID });

  it('plants the two Solaris films and returns nothing for zzzz', async () => {
    const tr = t();
    const solaris = normalizeCandidates((await tr.fetch('/search', buildSearch({ query: 'Solaris', type: 'movie' }), signal)).json, 'movie');
    expect(solaris.ok && solaris.value.map((c) => [c.name, c.year])).toEqual([
      ['Solaris', 1972],
      ['Solaris', 2002],
    ]);
    const none = normalizeCandidates((await tr.fetch('/search', buildSearch({ query: 'zzzz', type: 'artist' }), signal)).json);
    expect(none.ok && none.value).toEqual([]);
  });

  it('answers unknown queries with an exact candidate plus a close variant, all with synthetic UUIDs', async () => {
    const r = normalizeCandidates((await t().fetch('/search', buildSearch({ query: 'robert glasper', type: 'artist' }), signal)).json, 'artist');
    expect(r.ok && r.value.map((c) => c.name)).toEqual(['Robert Glasper', expect.stringMatching(/^Robert Glasper /)]);
    expect(r.ok && r.value.every((c) => c.id.startsWith(SYNTHETIC_UUID_PREFIX))).toBe(true);
    expect(plantedId('brand', 'Bursaspor').startsWith(NODATA_PREFIX + SYNTHETIC_UUID_PREFIX)).toBe(true);
  });

  it('returns generated entities by id', async () => {
    const tr = t();
    const search = await tr.fetch('/search', buildSearch({ query: 'Robert Glasper', type: 'artist' }), signal);
    const id = (search.json as { results: { entity_id: string }[] }).results[0]!.entity_id;
    const r = await tr.fetch('/entities', new URLSearchParams({ entity_ids: `${id},${plantedId('movie', 'Solaris', 2002)}` }), signal);
    const n = normalizeCandidates(r.json);
    expect(n.ok && n.value.map((c) => c.name)).toEqual(['Robert Glasper', 'Solaris']);
  });

  it('builds local places with synthetic_ ids, allowed and sensitive tag types and explainability', async () => {
    const r = await t().fetch('/v2/insights', buildPlaces({ wkt: BK_BOX, entityIds: ['a', 'b'], take: 12 }), signal);
    const n = normalizePlaces(r.json);
    if (!n.ok) throw new Error(n.message);
    expect(n.value).toHaveLength(12);
    expect(n.value.every((p) => p.id.startsWith('synthetic_place_'))).toBe(true);
    const kinds = new Set(n.value.flatMap((p) => p.tags.map((tag) => tag.kind)));
    for (const k of ['category', 'cuisine', 'ambience', 'good_for', 'time_of_day_fit']) expect(kinds.has(k)).toBe(true);
    expect([...kinds].some((k) => k === 'payments' || k === 'accessibility')).toBe(true);
    expect(n.value.every((p) => p.tags.every((tag) => tag.id.startsWith('synthetic_')))).toBe(true);
    expect(n.value[0]?.explain.map((e) => e.anchorId)).toEqual(['a', 'b']);
    const aff = n.value.map((p) => p.affinity ?? 0);
    expect([...aff].sort((x, y) => y - x)).toEqual(aff);
  });
});

describe('synthetic transport behaviour', () => {
  it('emits rate-limit headers with a decrementing month counter and a 30-day reset', async () => {
    const tr = createMockTransport({ grid: GRID, now: () => 0 });
    const a = await tr.fetch('/', new URLSearchParams(), signal);
    const b = await tr.fetch('/', new URLSearchParams(), signal);
    expect(a.headers.get('x-month-ratelimit-remaining')).toBe('9999');
    expect(b.headers.get('x-month-ratelimit-remaining')).toBe('9998');
    expect(b.headers.get('x-month-ratelimit-reset')).toBe(String(30 * 24 * 3600));
    expect(b.headers.get('x-second-ratelimit-limit')).toBe('5');
    expect(tr.requests).toBe(2);
  });

  it('answers 429 {error_msg} with month remaining 0 once the synthetic month is spent', async () => {
    const tr = createMockTransport({ grid: GRID, monthLimit: 1 });
    expect((await tr.fetch('/', new URLSearchParams(), signal)).status).toBe(200);
    const spent = await tr.fetch('/', new URLSearchParams(), signal);
    expect(spent.status).toBe(429);
    expect(spent.json).toEqual({ error_msg: 'Rate limit exceeded' });
    expect(spent.headers.get('x-month-ratelimit-remaining')).toBe('0');
  });

  it('mirrors the API’s 400, 403 and 404 bodies', async () => {
    const tr = createMockTransport({ grid: GRID });
    expect((await tr.fetch('/v2/insights', new URLSearchParams(), signal)).status).toBe(400);
    const forbidden = await tr.fetch('/search', new URLSearchParams({ query: 'x', types: 'urn:entity:videogame' }), signal);
    expect(forbidden).toMatchObject({ status: 403, json: { message: 'You do not have permission to access urn:entity:videogame' } });
    expect((await tr.fetch('/v3/nothing', new URLSearchParams(), signal)).status).toBe(404);
  });

  it('loads the grid lazily, once', async () => {
    let loads = 0;
    const tr = createMockTransport({
      grid: async () => {
        loads++;
        return GRID;
      },
    });
    expect(loads).toBe(0);
    await tr.fetch('/v2/insights', buildHeatmap({ signals: { entities: ['a'] }, location: { query: 'NYC' } }), signal);
    await tr.fetch('/v2/insights', buildHeatmap({ signals: { entities: ['b'] }, location: { query: 'NYC' } }), signal);
    expect(loads).toBe(1);
  });
});
