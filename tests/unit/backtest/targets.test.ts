import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { BacktestBrand } from '../../../scripts/backtest/brands';
import {
  assignPoints,
  buildTargets,
  createLocator,
  dedupeStores,
  elementPoint,
  isPoi,
  isStore,
  metres,
  ODBL_NOTICE,
  overIndex,
  parseNtaGeoJson,
  TARGET_METHOD,
  type OsmElement,
  type OsmPoint,
} from '../../../scripts/backtest/targets';

// ---------------------------------------------------------------------------------------------
// Toy neighborhoods (lon/lat squares): AA and BB share the edge x = 2; AA has a hole; CC is a
// two-part non-residential area (a park).
// ---------------------------------------------------------------------------------------------

const square = (x0: number, y0: number, x1: number, y1: number) => [
  [x0, y0],
  [x1, y0],
  [x1, y1],
  [x0, y1],
  [x0, y0],
];

const TOY = {
  type: 'FeatureCollection',
  features: [
    // Listed out of code order on purpose: lookups must not depend on file order.
    { properties: { nta2020: 'BB0101', ntaname: 'Bee', boroname: 'Brooklyn', ntatype: '0' }, geometry: { type: 'Polygon', coordinates: [square(2, 0, 4, 2)] } },
    {
      properties: { nta2020: 'AA0101', ntaname: 'Ay', boroname: 'Manhattan', ntatype: '0' },
      geometry: { type: 'MultiPolygon', coordinates: [[square(0, 0, 2, 2), square(0.5, 0.5, 1, 1)]] },
    },
    {
      properties: { nta2020: 'CC9191', ntaname: 'Park', boroname: 'Queens', ntatype: '9' },
      geometry: { type: 'MultiPolygon', coordinates: [[square(10, 10, 11, 11)], [square(12, 12, 13, 13)]] },
    },
  ],
};
const areas = parseNtaGeoJson(TOY);
const locate = createLocator(areas);

describe('NTA parsing and point-in-polygon', () => {
  it('parses codes, boroughs, the residential rule (ntatype "0") and bounding boxes, sorted by code', () => {
    expect(areas.map((a) => [a.code, a.boro, a.residential])).toEqual([
      ['AA0101', 'Manhattan', true],
      ['BB0101', 'Brooklyn', true],
      ['CC9191', 'Queens', false],
    ]);
    expect(areas[2]!.bbox).toEqual([10, 10, 13, 13]);
    expect(() => parseNtaGeoJson({})).toThrow(/no features/);
    expect(() => parseNtaGeoJson({ features: [{ properties: { nta2020: 'X' }, geometry: { type: 'Point', coordinates: [0, 0] } }] })).toThrow(/Bad NTA/);
  });

  it('finds the containing NTA, excludes holes and handles multipart polygons', () => {
    expect(locate(1.5, 1.5)?.code).toBe('AA0101');
    expect(locate(3, 1)?.code).toBe('BB0101');
    expect(locate(0.75, 0.75)).toBeNull(); // inside AA's hole
    expect(locate(12.5, 12.5)?.code).toBe('CC9191'); // second part
    expect(locate(11.5, 11.5)).toBeNull(); // between the parts
    expect(locate(50, 50)).toBeNull();
  });

  it('counts edges and vertices as inside and gives a shared edge to the lower code', () => {
    expect(locate(2, 1)?.code).toBe('AA0101');
    expect(locate(0, 0)?.code).toBe('AA0101');
    expect(locate(4, 2)?.code).toBe('BB0101');
    expect(locate(1, 0.75)?.code).toBe('AA0101'); // on the hole's edge
  });

  it('rejects non-finite coordinates', () => {
    expect(locate(NaN, 1)).toBeNull();
    expect(locate(1, Infinity)).toBeNull();
  });

  it('assigns points to residential NTAs and counts the dropped ones', () => {
    const pts: OsmPoint[] = [
      { key: 'node/1', lon: 1.5, lat: 1.5, area: false },
      { key: 'node/2', lon: 3, lat: 1, area: false },
      { key: 'node/3', lon: 3.5, lat: 0.5, area: false },
      { key: 'node/4', lon: 12.5, lat: 12.5, area: false }, // park
      { key: 'node/5', lon: 0.75, lat: 0.75, area: false }, // hole
      { key: 'way/6', lon: 50, lat: 50, area: true }, // outside
    ];
    const a = assignPoints(pts, locate);
    expect([...a.byNta.entries()].map(([k, v]) => [k, v.map((p) => p.key)])).toEqual([
      ['AA0101', ['node/1']],
      ['BB0101', ['node/2', 'node/3']],
    ]);
    expect(a.nonResidential).toBe(1);
    expect(a.outside).toBe(2);
  });

  it('places real landmarks in the right 2020 NTA (committed display polygons, lon/lat order)', () => {
    const min = JSON.parse(readFileSync(path.resolve(import.meta.dirname, '../../../public/geo/nta2020.min.geojson'), 'utf8')) as {
      features: { geometry: unknown; properties: { code: string; name: string; boro: string; residential: boolean } }[];
    };
    const real = createLocator(
      parseNtaGeoJson({
        features: min.features.map((f) => ({
          geometry: f.geometry,
          properties: { nta2020: f.properties.code, ntaname: f.properties.name, boroname: f.properties.boro, ntatype: f.properties.residential ? '0' : '9' },
        })),
      }),
    );
    const at = (lat: number, lon: number) => {
      const a = real(lon, lat);
      return a ? `${a.code}${a.residential ? '' : ' (non-residential)'}` : null;
    };
    expect(at(40.74844, -73.98566)).toBe('MN0501'); // Empire State Building
    expect(at(40.7172, -73.9566)).toBe('BK0102'); // Williamsburg, Bedford Av
    expect(at(40.7672, -73.9213)).toBe('QN0103'); // Astoria
    expect(at(40.7596, -73.83)).toBe('QN0707'); // Flushing, Main St
    expect(at(40.6437, -74.0736)).toBe('SI0101'); // St. George
    expect(at(40.7813, -73.9665)).toBe('MN6491 (non-residential)'); // Central Park
    expect(at(40.6441, -73.7822)).toBe('QN8381 (non-residential)'); // JFK
    expect(at(40.67, -74.05)).toBeNull(); // Upper New York Bay
    expect(real(40.74844, -73.98566)).toBeNull(); // lat/lon swapped lands nowhere
  });
});

// ---------------------------------------------------------------------------------------------
// OSM elements
// ---------------------------------------------------------------------------------------------

describe('OSM elements', () => {
  it('takes node coordinates or way/relation centres', () => {
    expect(elementPoint({ type: 'node', id: 1, lat: 40.7, lon: -73.9 })).toEqual({ key: 'node/1', lon: -73.9, lat: 40.7, area: false });
    expect(elementPoint({ type: 'way', id: 2, center: { lat: 40.71, lon: -73.91 } })).toEqual({ key: 'way/2', lon: -73.91, lat: 40.71, area: true });
    expect(elementPoint({ type: 'relation', id: 3, center: { lat: 40.72, lon: -73.92 } })?.key).toBe('relation/3');
    expect(elementPoint({ type: 'way', id: 4 })).toBeNull();
    expect(elementPoint({ type: 'node', id: 5, lat: NaN, lon: -73.9 })).toBeNull();
  });

  it('counts active stores only', () => {
    expect(isStore({ amenity: 'cafe', brand: 'Starbucks' })).toBe(true);
    expect(isStore({ amenity: 'bank', atm: 'yes' })).toBe(true);
    expect(isStore({ leisure: 'fitness_centre' })).toBe(true);
    expect(isStore({ shop: 'chemist', amenity: 'pharmacy' })).toBe(true);
    expect(isStore({ amenity: 'atm' })).toBe(false);
    expect(isStore({ shop: 'convenience', amenity: 'atm' })).toBe(false); // a bank's ATM inside a deli
    expect(isStore({ amenity: 'vending_machine' })).toBe(false);
    expect(isStore({ amenity: 'parking' })).toBe(false);
    expect(isStore({ shop: 'vacant' })).toBe(false);
    expect(isStore({ 'disused:shop': 'supermarket', brand: 'Target' })).toBe(false);
    expect(isStore({ building: 'retail', brand: 'Target' })).toBe(false);
    expect(isStore({ amenity: '' })).toBe(false);
    expect(isStore(undefined)).toBe(false);
  });

  it('counts food and drink amenities and active shops as commercial POIs', () => {
    for (const amenity of ['restaurant', 'cafe', 'fast_food', 'bar', 'pub']) expect(isPoi({ amenity })).toBe(true);
    expect(isPoi({ shop: 'clothes' })).toBe(true);
    expect(isPoi({ amenity: 'bank' })).toBe(false);
    expect(isPoi({ shop: 'vacant' })).toBe(false);
    expect(isPoi({ shop: 'no' })).toBe(false);
    expect(isPoi(undefined)).toBe(false);
  });

  it('measures distances in metres', () => {
    expect(metres({ lat: 40.7, lon: -73.9 }, { lat: 40.701, lon: -73.9 })).toBeCloseTo(111.2, 0);
    // 0.001° of longitude at 40.7°N ≈ 84.3 m
    expect(metres({ lat: 40.7, lon: -73.9 }, { lat: 40.7, lon: -73.899 })).toBeCloseTo(84.3, 0);
  });

  it('merges an outline into a nearby point of the same store, never two points or two outlines', () => {
    const node = (id: number, lat: number, lon: number): OsmPoint => ({ key: `node/${id}`, lat, lon, area: false });
    const way = (id: number, lat: number, lon: number): OsmPoint => ({ key: `way/${id}`, lat, lon, area: true });
    const tenMetres = 10 / 111_195;
    const r = dedupeStores([way(9, 40.7 + tenMetres, -73.9), node(1, 40.7, -73.9), node(2, 40.7 + tenMetres, -73.9), way(8, 40.71, -73.9), way(7, 40.71 + tenMetres, -73.9)]);
    expect(r.merged).toBe(1);
    expect(r.kept.map((p) => p.key)).toEqual(['node/1', 'node/2', 'way/7', 'way/8']);
    expect(dedupeStores([node(1, 40.7, -73.9), way(2, 40.7 + 100 / 111_195, -73.9)]).merged).toBe(0);
    expect(dedupeStores([node(1, 40.7, -73.9), way(2, 40.7 + 39 / 111_195, -73.9)], TARGET_METHOD.dedupeMeters).merged).toBe(1);
  });
});

// ---------------------------------------------------------------------------------------------
// Empirical-Bayes over-index
// ---------------------------------------------------------------------------------------------

describe('overIndex (Marshall global empirical Bayes)', () => {
  it('matches a hand-computed example', () => {
    // B = 8, P = 40 → E = 2 everywhere; s² = (16/2 + 4/2 + 4/2 + 0)/8 = 1.5; a = 1.5 − 1/2 = 1.
    const r = overIndex([6, 0, 0, 2], [10, 10, 10, 10]);
    expect(r.expected).toEqual([2, 2, 2, 2]);
    expect(r.rate).toBe(1);
    expect(r.momentEstimate).toBeCloseTo(1, 12);
    expect(r.priorVariance).toBeCloseTo(1, 12);
    expect(r.theta[0]).toBeCloseTo(7 / 3, 12);
    expect(r.theta[1]).toBeCloseTo(1 / 3, 12);
    expect(r.theta[2]).toBeCloseTo(1 / 3, 12);
    expect(r.theta[3]).toBeCloseTo(1, 12);
  });

  it('shrinks toward the city-wide rate, more where little is expected', () => {
    const r = overIndex([6, 0, 0, 2], [10, 10, 10, 10]);
    expect(r.theta[0]!).toBeLessThan(6 / 2); // raw ratio 3
    expect(r.theta[1]!).toBeGreaterThan(0); // raw ratio 0
    // Zero stores: the busier area is the stronger under-index.
    const z = overIndex([6, 0, 0, 2], [10, 5, 20, 10]);
    expect(z.theta[2]!).toBeLessThan(z.theta[1]!);
    // Same exposure: more stores, higher over-index.
    expect(r.theta[0]!).toBeGreaterThan(r.theta[3]!);
  });

  it('pools completely without a floor when the moment estimate is ≤ 0', () => {
    const r = overIndex([2, 0, 1, 1], [5, 5, 5, 5]);
    // E = 1 everywhere; s² = 2/4; a = 0.5 − 1 = −0.5.
    expect(r.momentEstimate).toBeCloseTo(-0.5, 12);
    expect(r.priorVariance).toBe(0);
    expect(r.theta).toEqual([1, 1, 1, 1]);
  });

  it('keeps the stores’ ranking with a floor on the prior variance', () => {
    const r = overIndex([2, 0, 1, 1], [5, 5, 5, 5], TARGET_METHOD.minPriorVariance);
    expect(TARGET_METHOD.minPriorVariance).toBe(0.25);
    expect(r.momentEstimate).toBeCloseTo(-0.5, 12);
    expect(r.priorVariance).toBe(0.25);
    // θ = (b + 4)/(1 + 4)
    expect(r.theta.map((x) => Math.round(x * 1e12) / 1e12)).toEqual([1.2, 0.8, 1, 1]);
    // A floor below the moment estimate changes nothing.
    expect(overIndex([6, 0, 0, 2], [10, 10, 10, 10], 0.25).theta).toEqual(overIndex([6, 0, 0, 2], [10, 10, 10, 10]).theta);
  });

  it('gives areas without exposure the city-wide rate and leaves the estimate unchanged', () => {
    const base = overIndex([6, 0, 0, 2], [10, 10, 10, 10]);
    const r = overIndex([6, 0, 0, 2, 0], [10, 10, 10, 10, 0]);
    expect(r.theta[4]).toBe(1);
    expect(r.priorVariance).toBeCloseTo(base.priorVariance, 12);
    expect(r.theta.slice(0, 4)).toEqual(base.theta);
  });

  it('is invariant to the scale of the exposure', () => {
    const a = overIndex([6, 0, 1, 2], [10, 7, 3, 10]);
    const b = overIndex([6, 0, 1, 2], [100, 70, 30, 100]);
    a.theta.forEach((t, i) => expect(b.theta[i]).toBeCloseTo(t, 12));
  });

  it('rejects inconsistent input and is undefined without stores', () => {
    expect(() => overIndex([1], [1, 2])).toThrow(/length/);
    expect(() => overIndex([1, 0], [0, 3])).toThrow(/no exposure/);
    expect(() => overIndex([-1, 2], [1, 2])).toThrow(/≥ 0/);
    expect(overIndex([0, 0], [1, 2]).theta.every(Number.isNaN)).toBe(true);
  });
});

// ---------------------------------------------------------------------------------------------
// buildTargets (toy world)
// ---------------------------------------------------------------------------------------------

describe('buildTargets', () => {
  const brand = (id: string): BacktestBrand => ({
    id,
    name: id,
    qid: 'Q1',
    wikidataLabel: id,
    category: 'bank',
    qloo: { type: 'brand', query: id, hint: null, aliases: [] },
  });
  let next = 100;
  const node = (lon: number, lat: number, tags: Record<string, string>): OsmElement => ({ type: 'node', id: next++, lon, lat, tags });

  // POIs: 6 in AA, 1 in BB, 1 in the park, 1 outside, 1 vacant shop (ignored), 1 bank (not a POI).
  const sharedCafe = node(1.2, 1.2, { amenity: 'cafe', brand: 'Chain' });
  const poi = {
    osm3s: { timestamp_osm_base: '2026-10-26T19:00:00Z' },
    elements: [
      sharedCafe,
      node(1.3, 1.3, { shop: 'clothes' }),
      node(1.4, 1.4, { amenity: 'bar' }),
      node(1.5, 1.5, { amenity: 'restaurant' }),
      node(1.6, 1.6, { amenity: 'cafe' }),
      node(1.7, 1.7, { amenity: 'pub' }),
      node(3, 1, { amenity: 'restaurant' }),
      node(10.5, 10.5, { amenity: 'cafe' }),
      node(50, 50, { shop: 'bakery' }),
      node(3.2, 1.2, { shop: 'vacant' }),
      node(3.3, 1.3, { amenity: 'bank' }),
    ],
  };
  // The chain: the shared cafe in AA (also a POI), five banks in BB (not POIs; one also mapped as a
  // building outline), an ATM (ignored) and one store in the park (dropped).
  const chain = {
    osm3s: { timestamp_osm_base: '2026-10-26T19:05:00Z' },
    elements: [
      sharedCafe,
      node(3.4, 1.4, { amenity: 'bank' }),
      node(3.5, 0.5, { amenity: 'bank' }),
      node(3.6, 1.6, { amenity: 'bank' }),
      node(3.7, 1.7, { amenity: 'bank' }),
      node(3.8, 0.8, { amenity: 'bank' }),
      node(3.6, 0.6, { amenity: 'atm' }),
      { type: 'way', id: 9, center: { lat: 0.5, lon: 3.5 }, tags: { amenity: 'bank', building: 'yes' } } as OsmElement,
      node(10.2, 10.2, { amenity: 'bank' }),
    ],
  };
  // Pure empirical Bayes (no floor) keeps the hand computation below simple.
  const t = buildTargets({
    areas,
    poi,
    brands: [{ brand: brand('chain'), response: chain }],
    builtAt: '2026-10-26T20:00:00Z',
    minStores: 3,
    minPriorVariance: 0,
  });

  it('summarizes POIs and lists residential NTAs with their POI counts', () => {
    expect(t.kind).toBe('stoop-backtest-targets');
    expect(t.notice).toBe(ODBL_NOTICE);
    expect(t.poi).toEqual({ osmBase: '2026-10-26T19:00:00Z', elements: 11, active: 9, residential: 7, nonResidential: 1, outside: 1 });
    expect(t.ntas).toEqual([
      { code: 'AA0101', boro: 'Manhattan', pois: 6 },
      { code: 'BB0101', boro: 'Brooklyn', pois: 1 },
    ]);
  });

  it('counts the chain’s active, de-duplicated stores and where they fall', () => {
    const b = t.brands[0]!;
    expect(b.counts).toEqual({ elements: 9, active: 8, merged: 1, stores: 7, residential: 6, nonResidential: 1, outside: 0 });
    expect(b.stores).toEqual({ AA0101: 1, BB0101: 5 });
    expect(b.status).toBe('ok');
    expect(b.reason).toBeNull();
    expect(b.osmBase).toBe('2026-10-26T19:05:00Z');
  });

  it('computes the target over every residential NTA with the chain’s own stores in the exposure, once', () => {
    const b = t.brands[0]!;
    expect(Object.keys(b.target)).toEqual(['AA0101', 'BB0101']);
    // Exposure: AA = 6 POIs (the chain's cafe is one of them, counted once); BB = 1 POI + 5 banks.
    // B = 6, E = [3, 3]; s² = (4/3 + 4/3)/6 = 4/9; a = 4/9 − 1/3 = 1/9 → θ = (b + 9)/(3 + 9).
    const expected = overIndex([1, 5], [6, 6]);
    expect(expected.priorVariance).toBeCloseTo(1 / 9, 12);
    expect(b.momentEstimate).toBeCloseTo(1 / 9, 12);
    expect(b.priorVariance).toBeCloseTo(1 / 9, 12);
    expect(b.target.AA0101).toBeCloseTo(10 / 12, 12);
    expect(b.target.BB0101).toBeCloseTo(14 / 12, 12);
  });

  it('floors the prior variance by default (1/9 → 0.25: θ = (b + 4)/(3 + 4))', () => {
    const d = buildTargets({ areas, poi, brands: [{ brand: brand('chain'), response: chain }], builtAt: 'x', minStores: 3 }).brands[0]!;
    expect(d.momentEstimate).toBeCloseTo(1 / 9, 12);
    expect(d.priorVariance).toBe(0.25);
    expect(d.target.AA0101).toBeCloseTo(5 / 7, 12);
    expect(d.target.BB0101).toBeCloseTo(9 / 7, 12);
  });

  it('excludes chains below the store minimum, with the reason', () => {
    const strict = buildTargets({ areas, poi, brands: [{ brand: brand('chain'), response: chain }], builtAt: 'x' });
    const b = strict.brands[0]!;
    expect(TARGET_METHOD.minStores).toBe(15);
    expect(b.status).toBe('excluded');
    expect(b.reason).toBe('7 stores in NYC on OSM (minimum 15)');
    expect(b.target).toEqual({});
    expect(b.stores).toEqual({ AA0101: 1, BB0101: 5 }); // counts are still reported
  });

  it('keeps a chain whose counts look under-dispersed (floored), and excludes it only without a floor', () => {
    const flat = {
      elements: [node(1.5, 1.5, { amenity: 'bank' }), node(1.6, 1.6, { amenity: 'bank' }), node(1.7, 1.7, { amenity: 'bank' }), node(3.5, 1.5, { amenity: 'bank' })],
    };
    // Exposure AA = 6 + 3, BB = 1 + 1; stores 3 and 1 track it closely → moment estimate ≤ 0.
    const floored = buildTargets({ areas, poi, brands: [{ brand: brand('flat'), response: flat }], builtAt: 'x', minStores: 1 }).brands[0]!;
    expect(floored.momentEstimate!).toBeLessThanOrEqual(0);
    expect(floored.status).toBe('ok');
    expect(floored.priorVariance).toBe(0.25);
    expect(floored.target.BB0101).not.toBe(floored.target.AA0101);

    const pooled = buildTargets({ areas, poi, brands: [{ brand: brand('flat'), response: flat }], builtAt: 'x', minStores: 1, minPriorVariance: 0 }).brands[0]!;
    expect(pooled.status).toBe('excluded');
    expect(pooled.reason).toMatch(/complete pooling/);
  });
});
