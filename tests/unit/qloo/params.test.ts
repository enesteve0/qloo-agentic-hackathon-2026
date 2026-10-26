import { describe, expect, it } from 'vitest';
import {
  QlooParamError,
  buildDemographics,
  buildEntities,
  buildHeatmap,
  buildPlaces,
  buildSearch,
  buildTagInsights,
  kindOf,
  polygonLabel,
  redactQuery,
  toEntityType,
  toQlooType,
  validateQuery,
} from '@/server/qloo/params';

const WKT = 'POLYGON((-73.97 40.70, -73.94 40.70, -73.94 40.73, -73.97 40.73, -73.97 40.70))';
const v = (path: string, entries: Record<string, string>) => validateQuery(path, new URLSearchParams(entries));

describe('parameter allow-lists', () => {
  it('throws on unknown keys before any network call (Qloo would silently ignore them)', () => {
    expect(() => v('/v2/insights', { 'filter.type': 'urn:heatmap', 'filter.locaton': WKT, 'signal.interests.entities': 'a' })).toThrow(
      /Unknown Qloo parameter "filter.locaton" for heatmap/,
    );
    expect(() => v('/search', { query: 'x', types: 'urn:entity:artist', 'filter.type': 'urn:heatmap' })).toThrow(QlooParamError);
    expect(() => v('/entities', { entity_ids: 'a', take: '3' })).toThrow(/Unknown/);
    expect(() => v('/', { foo: 'bar' })).toThrow(/Unknown/);
    // take is not a heatmap parameter (Qloo ignores it for heatmaps).
    expect(() => v('/v2/insights', { 'filter.type': 'urn:heatmap', 'filter.location.query': 'NYC', 'signal.interests.entities': 'a', take: '5' })).toThrow(/take/);
  });

  it('identifies each request family by path and filter.type', () => {
    expect(kindOf('/v2/insights', new URLSearchParams({ 'filter.type': 'urn:heatmap' }))).toBe('heatmap');
    expect(kindOf('/v2/insights', new URLSearchParams({ 'filter.type': 'urn:entity:place' }))).toBe('places');
    expect(kindOf('/v2/insights', new URLSearchParams({ 'filter.type': 'urn:tag' }))).toBe('tags');
    expect(kindOf('/v2/insights', new URLSearchParams({ 'filter.type': 'urn:demographics' }))).toBe('demographics');
    expect(() => kindOf('/v2/insights', new URLSearchParams({ 'filter.type': 'urn:entity:artist' }))).toThrow(/filter.type/);
    expect(() => kindOf('/v2/insights', new URLSearchParams())).toThrow(QlooParamError);
    expect(() => kindOf('/v2/audiences', new URLSearchParams())).toThrow(/path/);
  });

  it('checks required, duplicate, empty and malformed values', () => {
    expect(() => v('/search', { types: 'urn:entity:artist' })).toThrow(/Missing required.*query/);
    expect(() => validateQuery('/search', new URLSearchParams('query=a&query=b&types=urn:entity:artist'))).toThrow(/Duplicate/);
    expect(() => v('/search', { query: ' ', types: 'urn:entity:artist' })).toThrow(/Empty/);
    expect(() => v('/search', { query: 'x', types: 'artist' })).toThrow(/Invalid value/);
    expect(() => v('/search', { query: 'x', types: 'urn:entity:artist', take: '0' })).toThrow(/take/);
    expect(() => v('/search', { query: 'x', types: 'urn:entity:artist', take: '51' })).toThrow(/take/);
    expect(() => v('/search', { query: 'x', types: 'urn:entity:place', 'filter.radius': '25' })).toThrow(/requires filter.location/);
    expect(() => v('/search', { query: 'x', types: 'urn:entity:place', 'filter.location': WKT })).toThrow(/lat,lon/);
    expect(() => v('/v2/insights', { 'filter.type': 'urn:heatmap', 'filter.location': WKT, 'signal.interests.entities': 'a b' })).toThrow(/Invalid value/);
  });

  it('heatmaps need exactly one location form, at least one signal and never "New York"', () => {
    const base = { 'filter.type': 'urn:heatmap', 'signal.interests.entities': 'a' };
    expect(() => v('/v2/insights', base)).toThrow(/filter.location/);
    expect(() => v('/v2/insights', { ...base, 'filter.location': WKT, 'filter.location.query': 'NYC' })).toThrow(/either/);
    expect(() => v('/v2/insights', { 'filter.type': 'urn:heatmap', 'filter.location.query': 'NYC' })).toThrow(/signal/);
    expect(() => v('/v2/insights', { ...base, 'filter.location.query': 'New York' })).toThrow(/state/);
    expect(() => v('/v2/insights', { ...base, 'filter.location.query': ' new  york ' })).toThrow(/state/);
    expect(() => v('/v2/insights', { ...base, 'filter.location': '40.7,-74.0' })).toThrow(/WKT/);
    expect(v('/v2/insights', { ...base, 'filter.location.query': 'NYC' })).toBe('heatmap');
    expect(v('/v2/insights', { ...base, 'filter.location.query': 'New York City' })).toBe('heatmap');
  });

  it('rejects over-long queries', () => {
    const huge = `POLYGON((${Array.from({ length: 600 }, (_, i) => `-73.${String(i).padStart(5, '0')} 40.${String(i).padStart(5, '0')}`).join(', ')}))`;
    expect(() => buildPlaces({ wkt: huge, entityIds: ['a'] })).toThrow(/too long/);
  });
});

describe('request builders', () => {
  it('search: types URN, take 5, NYC centre in miles for places only', () => {
    expect(buildSearch({ query: '  Vampire   Weekend ', type: 'artist' }).toString()).toBe('query=Vampire+Weekend&types=urn%3Aentity%3Aartist&take=5');
    const place = buildSearch({ query: 'Brooklyn Museum', type: 'place' });
    expect(place.get('filter.location')).toBe('40.7128,-74.0060');
    expect(place.get('filter.radius')).toBe('25');
    expect(buildSearch({ query: 'Blue Note', type: 'place', location: null }).has('filter.location')).toBe(false);
  });

  it('heatmap: comma-joined, sorted, de-duplicated signals', () => {
    const q = buildHeatmap({
      signals: { entities: ['b', 'a', 'b'], tags: ['urn:tag:genre:place:restaurant'], demographics: { age: ['36_to_55', '35_and_younger'] } },
      location: { wkt: WKT },
      boundary: 'urn:entity:locality',
    });
    expect(Object.fromEntries(q)).toEqual({
      'filter.type': 'urn:heatmap',
      'filter.location': WKT,
      'signal.interests.entities': 'a,b',
      'signal.interests.tags': 'urn:tag:genre:place:restaurant',
      'signal.demographics.age': '35_and_younger,36_to_55',
      'output.heatmap.boundary': 'urn:entity:locality',
    });
  });

  it('places, tags, entities and demographics', () => {
    expect(Object.fromEntries(buildPlaces({ wkt: WKT, entityIds: ['x', 'y'] }))).toEqual({
      'filter.type': 'urn:entity:place',
      'filter.location': WKT,
      'signal.interests.entities': 'x,y',
      take: '15',
      'feature.explainability': 'true',
    });
    expect(buildPlaces({ wkt: WKT, entityIds: ['x'], explain: false }).has('feature.explainability')).toBe(false);
    expect(Object.fromEntries(buildTagInsights({ tagTypes: ['urn:tag:genre:music'], location: { wkt: WKT }, entityIds: ['x'], take: 10 }))).toEqual({
      'filter.type': 'urn:tag',
      'filter.tag.types': 'urn:tag:genre:music',
      'signal.location': WKT,
      'signal.interests.entities': 'x',
      take: '10',
    });
    expect(buildEntities(['b', 'a']).get('entity_ids')).toBe('a,b');
    expect(() => buildEntities([])).toThrow(/at least one id/);
    expect(Object.fromEntries(buildDemographics(['x']))).toEqual({ 'filter.type': 'urn:demographics', 'signal.interests.entities': 'x' });
    expect(() => buildDemographics([])).toThrow(QlooParamError);
  });

  it('maps entity types both ways', () => {
    expect(toQlooType('tv_show')).toBe('urn:entity:tv_show');
    expect(toEntityType('urn:entity:movie')).toBe('movie');
    expect(toEntityType('podcast')).toBe('podcast');
    expect(toEntityType('urn:entity:locality')).toBeNull();
    expect(toEntityType('urn:entity')).toBeNull();
    expect(toEntityType(null)).toBeNull();
  });
});

describe('provenance redaction', () => {
  it('replaces polygons with the caller label and never echoes key-like parameters', () => {
    const q = buildPlaces({ wkt: WKT, entityIds: ['x'] });
    q.append('api_key', 'secret');
    const text = redactQuery(q, 'NTA BK0102');
    expect(text).toBe('filter.type=urn:entity:place&filter.location=POLYGON(NTA BK0102)&signal.interests.entities=x&take=15&feature.explainability=true');
    expect(text).not.toContain('secret');
    expect(polygonLabel(WKT, 'POLYGON(NYC study)')).toBe('POLYGON(NYC study)');
    expect(polygonLabel(WKT)).toMatch(/^POLYGON\(wkt:[0-9a-f]{10}\)$/);
  });
});
