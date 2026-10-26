import 'server-only';
import ngeohash from 'ngeohash';
import { buildDemographics, buildEntities, buildHeatmap, buildPlaces, buildSearch, buildTagInsights } from './params';
import { plantedId } from './synthetic';
import { createMockTransport } from './transport-mock';
import type { TransportResponse } from './types';

/**
 * Synthetic fixture snapshots (fixtures/qloo/synthetic.*.json). Every file is produced by the mock
 * generator — or, for error bodies the mock cannot produce, written by hand in the documented shape —
 * and carries `"_synthetic": true`. No real Qloo response is ever stored in the repository.
 */

export const FIXTURE_NOW = Date.parse('2026-10-27T12:00:00Z');
const GENERATOR = 'scripts/gen-fixtures.ts';

export interface SyntheticFixture {
  _synthetic: true;
  generator: string;
  description: string;
  request: { method: 'GET'; path: string; query: string };
  status: number;
  headers: Record<string, string>;
  body: unknown;
}

export interface FixtureFile {
  /** File name is `synthetic.<name>.json`. */
  name: string;
  content: SyntheticFixture;
}

/** A small lattice over NYC: Manhattan cells come back as gh7, Staten Island cells as gh5. */
export function fixtureGrid(): { cells: string[] } {
  const cells = new Set<string>();
  for (let i = 0; i <= 9; i++) {
    for (let j = 0; j <= 11; j++) cells.add(ngeohash.encode(40.52 + i * 0.04, -74.2 + j * 0.04, 6));
  }
  return { cells: [...cells].sort() };
}

/** Williamsburg-sized square (lon-lat, closed ring). */
export const FIXTURE_NTA_WKT = 'POLYGON((-73.97 40.70, -73.94 40.70, -73.94 40.73, -73.97 40.73, -73.97 40.70))';
/** Box around the five boroughs. */
export const FIXTURE_NYC_WKT = 'POLYGON((-74.26 40.49, -73.70 40.49, -73.70 40.92, -74.26 40.92, -74.26 40.49))';

const SOLARIS_1972 = plantedId('movie', 'Solaris', 1972);
const SOLARIS_2002 = plantedId('movie', 'Solaris', 2002);
const BURSASPOR = plantedId('brand', 'Bursaspor');

function headerObject(h: Headers): Record<string, string> {
  return Object.fromEntries([...h.entries()].sort(([a], [b]) => (a < b ? -1 : 1)));
}

export async function buildSyntheticFixtures(): Promise<FixtureFile[]> {
  const transport = createMockTransport({ grid: fixtureGrid(), now: () => FIXTURE_NOW });
  const signal = new AbortController().signal;
  const files: FixtureFile[] = [];

  const capture = async (name: string, description: string, path: string, query: URLSearchParams, via = transport) => {
    const res: TransportResponse = await via.fetch(path, query, signal);
    files.push({
      name,
      content: {
        _synthetic: true,
        generator: GENERATOR,
        description,
        request: { method: 'GET', path, query: query.toString() },
        status: res.status,
        headers: headerObject(res.headers),
        body: res.json,
      },
    });
  };

  await capture('root', 'GET / (version info and rate-limit headers)', '/', new URLSearchParams());
  await capture('search-solaris', 'Planted ambiguity: two films called Solaris', '/search', buildSearch({ query: 'Solaris', type: 'movie' }));
  await capture('search-brand', 'Unknown-ish query: exact candidate plus a close variant', '/search', buildSearch({ query: 'Sweetgreen', type: 'brand' }));
  await capture(
    'search-place',
    'Place search near NYC (filter.radius is in miles)',
    '/search',
    buildSearch({ query: 'Brooklyn Museum', type: 'place' }),
  );
  await capture('search-empty', 'No candidates', '/search', buildSearch({ query: 'zzzz', type: 'artist' }));
  await capture('entities', 'Entities by id (flat results[])', '/entities', buildEntities([SOLARIS_1972, SOLARIS_2002]));
  await capture(
    'heatmap-nyc',
    'Heatmap with filter.location.query=NYC (locality echo as an object; mixed geohash precision)',
    '/v2/insights',
    buildHeatmap({ signals: { entities: [SOLARIS_2002] }, location: { query: 'NYC' } }),
  );
  await capture(
    'heatmap-default-map',
    'Planted default map: nodata- ids return one density-only map',
    '/v2/insights',
    buildHeatmap({ signals: { entities: [BURSASPOR] }, location: { wkt: FIXTURE_NYC_WKT } }),
  );
  await capture(
    'places',
    'Place insights inside a neighborhood polygon with explainability',
    '/v2/insights',
    buildPlaces({ wkt: FIXTURE_NTA_WKT, entityIds: [SOLARIS_1972, SOLARIS_2002], take: 8 }),
  );
  await capture(
    'tags',
    'Tag insights with signal.location',
    '/v2/insights',
    buildTagInsights({ tagTypes: ['urn:tag:genre:music'], location: { wkt: FIXTURE_NTA_WKT }, entityIds: [SOLARIS_2002], take: 5 }),
  );
  await capture('demographics', 'Demographics insights', '/v2/insights', buildDemographics([SOLARIS_2002]));
  // Hand-built queries: the allow-list would (rightly) refuse these before they reached Qloo.
  await capture('error-400', '400 with errors[] (unsupported filter.type)', '/v2/insights', new URLSearchParams({ 'filter.type': 'urn:bogus' }));
  await capture(
    'error-403',
    '403 for an entity type the key cannot use (not an auth failure)',
    '/search',
    new URLSearchParams({ query: 'Synthetic Quest', types: 'urn:entity:videogame' }),
  );
  const spent = createMockTransport({ grid: fixtureGrid(), now: () => FIXTURE_NOW, monthLimit: 1 });
  await spent.fetch('/', new URLSearchParams(), signal);
  await capture('error-429-month', 'Monthly quota used up: 429 {error_msg}, month remaining 0, no Retry-After', '/', new URLSearchParams(), spent);

  const handWritten = (name: string, description: string, status: number, headers: Record<string, string>, body: unknown) =>
    files.push({
      name,
      content: {
        _synthetic: true,
        generator: GENERATOR,
        description,
        request: { method: 'GET', path: '/search', query: buildSearch({ query: 'Synthetic', type: 'brand' }).toString() },
        status,
        headers,
        body,
      },
    });
  handWritten(
    'error-429-second',
    'Per-second limit: 429 {error_msg} with the second window at 0 and month quota left (hand-written)',
    429,
    {
      'content-type': 'application/json',
      'x-month-ratelimit-limit': '10000',
      'x-month-ratelimit-remaining': '9000',
      'x-month-ratelimit-reset': '2000000',
      'x-second-ratelimit-limit': '5',
      'x-second-ratelimit-remaining': '0',
      'x-second-ratelimit-reset': '1',
    },
    { error_msg: 'Rate limit exceeded' },
  );
  handWritten('error-401', 'Wrong host, header or key (hand-written)', 401, { 'content-type': 'application/json' }, { message: 'Unauthorized' });
  return files;
}
