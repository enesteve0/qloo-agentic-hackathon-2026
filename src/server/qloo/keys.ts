import 'server-only';
import { createHash } from 'node:crypto';

/**
 * Canonical cache keys. Two requests that Qloo answers identically must share a key, so keys are
 * built from sorted parameters, sorted order-free lists and a digest of any WKT polygon (polygons are
 * long and would otherwise dominate the key input).
 */

/** Comma-joined lists whose order does not change Qloo's answer. */
export const ORDER_FREE_PARAMS: ReadonlySet<string> = new Set([
  'entity_ids',
  'types',
  'signal.interests.entities',
  'signal.interests.tags',
  'signal.demographics.age',
  'signal.demographics.gender',
  'filter.tag.types',
  'filter.parents.types',
]);

const WKT_RE = /^\s*(MULTI)?POLYGON\s*\(/i;

export function isWkt(value: string): boolean {
  return WKT_RE.test(value);
}

/** Whitespace-insensitive form so cosmetic differences do not split the cache. */
export function normalizeWkt(wkt: string): string {
  return wkt
    .trim()
    .replace(/\s*([(),])\s*/g, '$1')
    .replace(/\s+/g, ' ')
    .toUpperCase();
}

export function sha1Hex(value: string): string {
  return createHash('sha1').update(value).digest('hex');
}

export function sha256Hex(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function wktDigest(wkt: string): string {
  return sha1Hex(normalizeWkt(wkt));
}

function canonicalValue(key: string, value: string): string {
  const v = value.trim();
  if (isWkt(v)) return `wkt:${wktDigest(v)}`;
  if (ORDER_FREE_PARAMS.has(key)) {
    return [...new Set(v.split(',').map((s) => s.trim()).filter(Boolean))].sort().join(',');
  }
  return v;
}

/** Sorted `k=v` pairs (URI-encoded) with order-free lists sorted and WKT replaced by its digest. */
export function canonicalQuery(query: URLSearchParams): string {
  const pairs: [string, string][] = [];
  for (const [k, v] of query) pairs.push([k, canonicalValue(k, v)]);
  pairs.sort((a, b) => (a[0] === b[0] ? cmp(a[1], b[1]) : cmp(a[0], b[0])));
  return pairs.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&');
}

/** `q1:{sha256(path + canonical query)}`. */
export function cacheKey(path: string, query: URLSearchParams): string {
  return `q1:${sha256Hex(`${path}?${canonicalQuery(query)}`)}`;
}

function cmp(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
