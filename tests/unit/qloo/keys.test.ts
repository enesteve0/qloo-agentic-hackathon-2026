import { describe, expect, it } from 'vitest';
import { cacheKey, canonicalQuery, isWkt, normalizeWkt, sha1Hex, wktDigest } from '@/server/qloo/keys';

const WKT = 'POLYGON((-73.97 40.70, -73.94 40.70, -73.94 40.73, -73.97 40.73, -73.97 40.70))';

describe('cache keys', () => {
  it('have the q1:{sha256} form', () => {
    expect(cacheKey('/search', new URLSearchParams({ query: 'Solaris', types: 'urn:entity:movie' }))).toMatch(/^q1:[0-9a-f]{64}$/);
  });

  it('ignore parameter order', () => {
    const a = new URLSearchParams([
      ['filter.type', 'urn:heatmap'],
      ['filter.location.query', 'NYC'],
      ['signal.interests.entities', 'x'],
    ]);
    const b = new URLSearchParams([
      ['signal.interests.entities', 'x'],
      ['filter.location.query', 'NYC'],
      ['filter.type', 'urn:heatmap'],
    ]);
    expect(cacheKey('/v2/insights', a)).toBe(cacheKey('/v2/insights', b));
  });

  it('sort and de-duplicate order-free entity and tag lists', () => {
    const a = new URLSearchParams({ 'filter.type': 'urn:heatmap', 'signal.interests.entities': 'B,A, C', 'signal.interests.tags': 't2,t1' });
    const b = new URLSearchParams({ 'filter.type': 'urn:heatmap', 'signal.interests.entities': 'C,B,A,A', 'signal.interests.tags': 't1,t2' });
    expect(cacheKey('/v2/insights', a)).toBe(cacheKey('/v2/insights', b));
    expect(canonicalQuery(a)).toContain('signal.interests.entities=A%2CB%2CC');
    expect(cacheKey('/entities', new URLSearchParams({ entity_ids: 'b,a' }))).toBe(cacheKey('/entities', new URLSearchParams({ entity_ids: 'a,b' })));
  });

  it('keep order where order is meaningful and separate different values', () => {
    const k = (q: string) => cacheKey('/search', new URLSearchParams({ query: q, types: 'urn:entity:artist' }));
    expect(k('Vampire Weekend')).not.toBe(k('Weekend Vampire'));
    expect(cacheKey('/search', new URLSearchParams({ query: 'x', take: '5' }))).not.toBe(cacheKey('/search', new URLSearchParams({ query: 'x', take: '3' })));
    expect(cacheKey('/search', new URLSearchParams({ query: 'x' }))).not.toBe(cacheKey('/entities', new URLSearchParams({ query: 'x' })));
  });

  it('replace polygons by wkt:{sha1} that ignores cosmetic whitespace', () => {
    const q = (wkt: string) => new URLSearchParams({ 'filter.type': 'urn:entity:place', 'filter.location': wkt });
    const spaced = WKT.replace(/, /g, ' ,  ').replace('POLYGON((', 'polygon ( (');
    expect(canonicalQuery(q(WKT))).toBe(`filter.location=${encodeURIComponent(`wkt:${wktDigest(WKT)}`)}&filter.type=urn%3Aentity%3Aplace`);
    expect(canonicalQuery(q(WKT))).not.toContain('40.70');
    expect(cacheKey('/v2/insights', q(WKT))).toBe(cacheKey('/v2/insights', q(spaced)));
    expect(cacheKey('/v2/insights', q(WKT))).not.toBe(cacheKey('/v2/insights', q(WKT.replace('-73.94 40.73', '-73.93 40.73'))));
    expect(wktDigest(WKT)).toBe(sha1Hex(normalizeWkt(WKT)));
    expect(isWkt('MULTIPOLYGON(((0 0, 1 0, 1 1, 0 0)))')).toBe(true);
    expect(isWkt('40.7128,-74.0060')).toBe(false);
  });
});
