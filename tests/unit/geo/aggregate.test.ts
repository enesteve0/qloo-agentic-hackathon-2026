import ngeohash from 'ngeohash';
import { describe, expect, it } from 'vitest';
import { aggregateNtas, combineLift, confidenceOf, smoothLift } from '@/server/geo/aggregate';
import type { GridSpec } from '@/server/geo/types';

const F = (xs: number[]) => Float64Array.from(xs);

function gridOf(size: number, ntaWeights: GridSpec['ntaWeights'] = {}): GridSpec {
  return { precision: 6, cells: Array.from({ length: size }, (_, i) => `cell${i}`), ntaWeights, kioskCell: [] };
}

describe('combineLift', () => {
  it('takes the weighted mean over anchors defined at each cell', () => {
    const L = combineLift(
      [
        { id: 'a', lift: F([1, NaN, 2, NaN]), weight: 1 },
        { id: 'b', lift: F([3, 4, NaN, NaN]), weight: 3 },
        { id: 'c', lift: F([100, 100, 100, 100]), weight: 0 }, // excluded anchors never count
      ],
      4,
    );
    expect(Array.from(L)).toEqual([2.5, 4, 2, NaN]);
  });

  it('is all-NA without anchors', () => {
    expect(Array.from(combineLift([], 3))).toEqual([NaN, NaN, NaN]);
  });
});

describe('smoothLift', () => {
  const center = ngeohash.encode(40.7505, -73.9934, 6);
  const [n, ne, e, se, s, sw, w, nw] = ngeohash.neighbors(center) as [string, string, string, string, string, string, string, string];
  const grid: GridSpec = { precision: 6, cells: [nw, n, ne, w, center, e, sw, s, se], ntaWeights: {}, kioskCell: [] };

  it('S(g) = (4·L(g) + Σ defined N8) / (4 + k)', () => {
    const L = F([0, 2, 0, 0, 1, NaN, 0, 0, 0]);
    const S = smoothLift(L, grid);
    expect(S[4]).toBeCloseTo((4 * 1 + 2) / (4 + 7), 12); // centre: 7 defined neighbours (east is NA)
    expect(S[2]).toBeCloseTo((0 + 2 + 1) / (4 + 2), 12); // NE corner: N and centre defined, E is NA
    expect(S[5]).toBeNaN(); // no own value → not scored
  });
});

describe('aggregateNtas', () => {
  it('computes L_j, n_eff, weighted SD, SE and shrinkage; pools the SD when n_eff < 3', () => {
    const L = F([0.8, 1.2, 1.0, 1.0, 0, 0.5, 0.25, -0.2, 0.2, 0, 0.4, -0.4, NaN]);
    const grid = gridOf(L.length, {
      A: [[0, 1], [1, 1], [2, 1], [3, 1]],
      B: [[4, 1], [5, 1], [6, 2]],
      C: [[7, 1], [8, 1], [9, 1], [10, 1], [11, 1]],
      D: [[12, 1], [99, 1]], // NA and out-of-range cells only → omitted
      E: [[0, 0]], // zero land weight → omitted
    });
    const rows = new Map(aggregateNtas({ L, grid, kappa: 1.5, anchors: [] }).map((r) => [r.code, r]));
    expect([...rows.keys()]).toEqual(['A', 'B', 'C']);

    const a = rows.get('A')!;
    expect(a.mean).toBeCloseTo(1, 12);
    expect(a.nEff).toBeCloseTo(4, 12);
    expect(a.pooledSd).toBe(false);
    expect(a.sd).toBeCloseTo(Math.sqrt((0.08 / 4) * (4 / 3)), 12);
    expect(a.se).toBeCloseTo(a.sd / 2, 12);
    expect(a.lift).toBeCloseTo((1 * 4) / 5.5, 12);

    const c = rows.get('C')!;
    expect(c.sd).toBeCloseTo(Math.sqrt(0.1), 12);
    expect(c.lift).toBeCloseTo(0, 12);

    const b = rows.get('B')!;
    expect(b.mean).toBeCloseTo(0.25, 12);
    expect(b.nEff).toBeCloseTo(16 / 6, 12);
    expect(b.pooledSd).toBe(true);
    expect(b.sd).toBeCloseTo((a.sd + c.sd) / 2, 12); // median of the NTAs with n_eff ≥ 3
    expect(b.se).toBeCloseTo(b.sd / Math.sqrt(16 / 6), 12);
    expect(b.lift).toBeCloseTo(0.25 * (16 / 6 / (16 / 6 + 1.5)), 12);
  });

  it('measures anchor agreement and splits L̂ into anchor contributions', () => {
    const anchors = [
      { id: 'a1', lift: F([1, 1, 1, 1, -1]), weight: 1 },
      { id: 'a2', lift: F([0.5, 0.5, 0.5, 0.5, NaN]), weight: 1 },
      { id: 'a3', lift: F([-0.25, -0.25, -0.25, -0.25, -1]), weight: 2 },
    ];
    const L = combineLift(anchors, 5);
    const grid = gridOf(5, { A: [[0, 1], [1, 1], [2, 1], [3, 1]], B: [[4, 1]] });
    const [a, b] = aggregateNtas({ L, grid, kappa: 1.5, anchors });

    expect(a!.agreement).toBe(2 / 3);
    expect(a!.contributions.map((x) => x.anchorId)).toEqual(['a1', 'a2', 'a3']);
    expect(a!.contributions.reduce((s, x) => s + x.contribution, 0)).toBeCloseTo(a!.lift, 12);
    expect(a!.contributions[0]!.contribution).toBeCloseTo(0.25 * 1 * (4 / 5.5), 12);
    // Flat lift → zero SD → SE floor; strong, agreeing, n_eff 4 → high.
    expect(a!.confidence).toBe('high');

    // In B only a1 and a3 have data; both are negative.
    expect(b!.agreement).toBe(0);
    expect(b!.contributions.map((x) => x.anchorId)).toEqual(['a1', 'a3']);
    expect(b!.confidence).toBe('low');
  });
});

describe('confidenceOf', () => {
  const base = { lift: 0.2, se: 0.1, agreement: 2 / 3, nEff: 3 };
  it.each([
    ['high at every threshold', base, 'high'],
    ['medium when n_eff < 3', { ...base, nEff: 2.99 }, 'medium'],
    ['medium when agreement < 2/3', { ...base, agreement: 0.66 }, 'medium'],
    ['medium when L̂/SE is exactly 1', { lift: 0.1, se: 0.1, agreement: 0.5, nEff: 10 }, 'medium'],
    ['low when L̂/SE < 1', { lift: 0.099, se: 0.1, agreement: 1, nEff: 10 }, 'low'],
    ['low when agreement < 1/2', { lift: 1, se: 0.1, agreement: 0.49, nEff: 10 }, 'low'],
    ['low for negative lift', { lift: -1, se: 0.1, agreement: 1, nEff: 10 }, 'low'],
    ['high for positive lift with SE 0', { lift: 0.3, se: 0, agreement: 1, nEff: 3 }, 'high'],
    ['low for zero lift with SE 0', { lift: 0, se: 0, agreement: 1, nEff: 3 }, 'low'],
  ] as const)('%s', (_, x, expected) => {
    expect(confidenceOf(x)).toBe(expected);
  });
});
