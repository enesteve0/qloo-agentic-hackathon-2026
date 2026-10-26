import { describe, expect, it } from 'vitest';
import { averageRanks, countDefined, pearson, percentileRanks, probit, rankZ, spearman } from '@/server/geo/rankz';

// Reference quantiles from Python's statistics.NormalDist().inv_cdf (Wichura AS241, ~1e-16).
const REFERENCE: [number, number][] = [
  [0.5, 0],
  [0.975, 1.9599639845400534],
  [0.025, -1.9599639845400538],
  [0.9, 1.2815515655446006],
  [0.3, -0.5244005127080408],
  [0.99, 2.3263478740408408],
  [0.01, -2.3263478740408408],
  [0.999, 3.090232306167813],
  [0.02425, -1.9729610513118845],
  [0.97575, 1.972961051311885],
  [0.0001, -3.71901648545568],
  [1e-6, -4.753424308822899],
  [1e-10, -6.361340902404057],
  [0.8413447460685429, 1],
];

describe('probit (Acklam)', () => {
  it.each(REFERENCE)('Φ⁻¹(%s) ≈ %s within Acklam accuracy', (p, z) => {
    expect(Math.abs(probit(p) - z)).toBeLessThanOrEqual(1.5e-9 * Math.max(1, Math.abs(z)));
  });

  it('is antisymmetric and handles the domain edges', () => {
    for (const p of [0.001, 0.02, 0.2, 0.45]) expect(probit(1 - p)).toBeCloseTo(-probit(p), 12);
    expect(probit(0)).toBe(-Infinity);
    expect(probit(1)).toBe(Infinity);
    expect(probit(-0.1)).toBeNaN();
    expect(probit(1.1)).toBeNaN();
    expect(probit(NaN)).toBeNaN();
  });
});

describe('rank-z', () => {
  it('averages tied ranks and leaves NaN missing', () => {
    const values = [3, 1, 2, 2, NaN];
    const { ranks, n } = averageRanks(values);
    expect(n).toBe(4);
    expect(Array.from(ranks)).toEqual([4, 1, 2.5, 2.5, NaN]);

    const z = rankZ(values);
    expect(z[0]).toBeCloseTo(probit(3.5 / 4), 12);
    expect(z[1]).toBeCloseTo(probit(0.5 / 4), 12);
    expect(z[2]).toBe(0);
    expect(z[3]).toBe(0);
    expect(z[4]).toBeNaN();
    expect(countDefined(z)).toBe(4);
  });

  it('is invariant to monotone transforms of the input', () => {
    const x = [0.12, 0.5, 0.33, 0.5, NaN, 0.91, 0.07, 0.33, 0.66];
    const base = Array.from(rankZ(x));
    expect(Array.from(rankZ(x.map((v) => Math.exp(5 * v))))).toEqual(base);
    expect(Array.from(rankZ(x.map((v) => v ** 3 + 5)))).toEqual(base);
    expect(Array.from(rankZ(x.map((v) => 100 * v - 3)))).toEqual(base);
    // A decreasing transform mirrors the scores (up to rounding of u and 1 − u).
    const mirrored = rankZ(x.map((v) => -v));
    base.forEach((z, i) => {
      if (Number.isNaN(z)) expect(mirrored[i]).toBeNaN();
      else expect(mirrored[i]).toBeCloseTo(-z, 12);
    });
  });

  it('produces symmetric, increasing scores for distinct values', () => {
    const z = rankZ([5, 1, 4, 2, 3]);
    expect(Array.from(z).reduce((s, v) => s + v, 0)).toBeCloseTo(0, 12);
    expect(z[1]! < z[3]! && z[3]! < z[4]! && z[4]! < z[2]! && z[2]! < z[0]!).toBe(true);
    expect(z[4]).toBe(0);
  });

  it('handles empty and single-value maps', () => {
    expect(Array.from(rankZ([NaN, NaN]))).toEqual([NaN, NaN]);
    expect(Array.from(rankZ([0.4]))).toEqual([0]);
  });
});

describe('percentile ranks', () => {
  it('uses mid-rank percentiles with ties and keeps NaN', () => {
    expect(Array.from(percentileRanks([10, 20, 30, 40]))).toEqual([12.5, 37.5, 62.5, 87.5]);
    expect(Array.from(percentileRanks([1, 1, NaN, 2]))).toEqual([100 / 3, 100 / 3, NaN, (100 * 2.5) / 3]);
    expect(Array.from(percentileRanks([7]))).toEqual([50]);
  });
});

describe('spearman', () => {
  it('is ±1 for monotone relations and uses co-covered cells only', () => {
    expect(spearman([1, 2, 3, 4], [10, 20, 35, 90])).toBeCloseTo(1, 12);
    expect(spearman([1, 2, 3, 4], [4, 3, 2, 1])).toBeCloseTo(-1, 12);
    // NaN on either side drops the pair; the remaining pairs are perfectly ordered.
    expect(spearman([1, NaN, 3, 4, 5], [1, 2, NaN, 4, 9])).toBeCloseTo(1, 12);
  });

  it('applies the tie correction (Pearson on average ranks)', () => {
    // ranks y = [1, 2, 3.5, 5, 3.5] → ρ = 8 / √95.
    expect(spearman([1, 2, 3, 4, 5], [5, 6, 7, 8, 7])).toBeCloseTo(8 / Math.sqrt(95), 12);
  });

  it('is NaN when undefined and rejects mismatched lengths', () => {
    expect(spearman([1, 2], [1, 2])).toBeNaN();
    expect(spearman([1, 2, 3], [5, 5, 5])).toBeNaN();
    expect(() => spearman([1, 2, 3], [1, 2])).toThrow(RangeError);
  });

  it('pearson ignores NaN pairs', () => {
    expect(pearson([1, 2, NaN, 4], [2, 4, 100, 8])).toBeCloseTo(1, 12);
  });
});
