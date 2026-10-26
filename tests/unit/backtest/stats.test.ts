import { describe, expect, it } from 'vitest';
import { spearman } from '@/server/geo/rankz';
import {
  analyzeUniverse,
  bootstrapMedianCI,
  groupsOf,
  median,
  mulberry32,
  nullCalibration,
  permutationP,
  permute,
  quantileSorted,
  withinGroupPermutation,
  type AnalysisOptions,
  type BrandSeries,
} from '../../../scripts/backtest/stats';

function gaussian(rng: () => number): number {
  const u = 1 - rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rng());
}

const noise = (n: number, rng: () => number, sd = 1) => Float64Array.from({ length: n }, () => sd * gaussian(rng));
const add = (a: ArrayLike<number>, b: ArrayLike<number>, k = 1) => Float64Array.from({ length: a.length }, (_, i) => a[i]! + k * b[i]!);

/** 60 neighborhoods in three boroughs of 20. */
const BOROS = Array.from({ length: 60 }, (_, i) => ['Bronx', 'Brooklyn', 'Manhattan'][i % 3]!);
const OPTS: AnalysisOptions = { permutations: 1000, seed: 11, bootstrap: 2000, bootstrapSeed: 12, specificitySeed: 13 };

describe('seeded building blocks', () => {
  it('mulberry32 is deterministic per seed and uniform on [0, 1)', () => {
    const take = (seed: number, n: number) => Array.from({ length: n }, mulberry32(seed));
    expect(take(42, 5)).toEqual(take(42, 5));
    expect(take(43, 5)).not.toEqual(take(42, 5));
    const xs = take(7, 20_000);
    expect(xs.every((x) => x >= 0 && x < 1)).toBe(true);
    expect(xs.reduce((s, x) => s + x, 0) / xs.length).toBeCloseTo(0.5, 1);
  });

  it('groups positions by label in label order', () => {
    expect(groupsOf(['b', 'a', 'b', 'c'])).toEqual([[1], [0, 2], [3]]);
    expect(groupsOf([])).toEqual([]);
  });

  it('permutes within groups only, deterministically', () => {
    const groups = [
      [0, 2, 4],
      [1, 3],
    ];
    const seen = new Set<string>();
    const rng = mulberry32(5);
    for (let k = 0; k < 200; k++) {
      const p = Array.from(withinGroupPermutation(groups, 6, rng));
      expect([...p].sort()).toEqual([0, 1, 2, 3, 4, 5]);
      for (const i of [0, 2, 4]) expect([0, 2, 4]).toContain(p[i]);
      for (const i of [1, 3]) expect([1, 3]).toContain(p[i]);
      expect(p[5]).toBe(5); // a position in no group stays put
      seen.add(p.join());
    }
    expect(seen.size).toBe(12); // all 3! · 2! within-group arrangements occur
    const a = withinGroupPermutation(groups, 6, mulberry32(9));
    const b = withinGroupPermutation(groups, 6, mulberry32(9));
    expect(Array.from(a)).toEqual(Array.from(b));
  });

  it('permute reads values through the permutation', () => {
    expect(Array.from(permute([10, 20, 30], [2, 0, 1]))).toEqual([30, 10, 20]);
  });

  it('median and type-7 quantiles', () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 3, 2])).toBe(2.5);
    expect(median([])).toBeNaN();
    expect(quantileSorted([1, 2, 3, 4], 0.25)).toBeCloseTo(1.75, 12);
    expect(quantileSorted([1, 2, 3, 4], 0)).toBe(1);
    expect(quantileSorted([1, 2, 3, 4], 1)).toBe(4);
    expect(quantileSorted([], 0.5)).toBeNaN();
  });

  it('permutation p-values count ties as at least as large and never reach 0', () => {
    expect(permutationP(5, [1, 2, 3])).toBe(0.25);
    expect(permutationP(0, [1, 2, 3])).toBe(1);
    expect(permutationP(2, [1, 2, 3])).toBe(0.75);
    expect(permutationP(2 - 1e-14, [1, 2, 3])).toBe(0.75);
  });

  it('bootstrap CI of the median is seeded, brackets the median and narrows with the level', () => {
    const rng = mulberry32(3);
    const rhos = Array.from({ length: 25 }, () => 0.2 + 0.15 * gaussian(rng));
    const ci = bootstrapMedianCI(rhos, 4000, 99);
    expect(bootstrapMedianCI(rhos, 4000, 99)).toEqual(ci);
    expect(ci[0]).toBeLessThanOrEqual(median(rhos));
    expect(ci[1]).toBeGreaterThanOrEqual(median(rhos));
    const half = bootstrapMedianCI(rhos, 4000, 99, 0.5);
    expect(half[1] - half[0]).toBeLessThan(ci[1] - ci[0]);
    expect(bootstrapMedianCI([0.3, 0.3, 0.3], 500, 1)).toEqual([0.3, 0.3]);
    expect(bootstrapMedianCI([], 10, 1).every(Number.isNaN)).toBe(true);
  });
});

describe('analyzeUniverse', () => {
  it('reuses the production Spearman ρ over co-covered neighborhoods', () => {
    const rng = mulberry32(21);
    const target = noise(60, rng);
    const lift = add(target, noise(60, rng), 2);
    lift[3] = NaN;
    lift[17] = NaN;
    const r = analyzeUniverse(BOROS, [{ id: 'a', target, lift }], { ...OPTS, permutations: 50 });
    expect(r.perBrand[0]!.rho).toBe(spearman(lift, target));
    expect(r.perBrand[0]!.n).toBe(58);
  });

  it('finds a real within-borough signal', () => {
    const rng = mulberry32(31);
    const series: BrandSeries[] = Array.from({ length: 5 }, (_, b) => {
      const target = noise(60, rng);
      return { id: `b${b}`, target, lift: add(target, noise(60, rng), 0.5) };
    });
    const r = analyzeUniverse(BOROS, series, OPTS);
    for (const b of r.perBrand) {
      expect(b.rho).toBeGreaterThan(0.7);
      expect(b.p).toBeCloseTo(1 / 1001, 10); // no permutation reaches the observed ρ
    }
    expect(r.summary!.brands).toBe(5);
    expect(r.summary!.positive).toBe(5);
    expect(r.summary!.significant).toBe(5);
    expect(r.summary!.pMedian).toBeCloseTo(1 / 1001, 10);
    expect(r.summary!.pPositive).toBeLessThan(0.1); // all 5 positive by chance ≈ 1/32
    expect(r.summary!.ci[0]).toBeGreaterThan(0.7);
  });

  it('is deterministic for fixed seeds', () => {
    const rng = mulberry32(41);
    const series: BrandSeries[] = Array.from({ length: 4 }, (_, b) => {
      const target = noise(60, rng);
      return { id: `b${b}`, target, lift: add(noise(60, rng), target, 0.3) };
    });
    const a = analyzeUniverse(BOROS, series, OPTS);
    const b = analyzeUniverse(BOROS, series, OPTS);
    expect(b).toEqual(a);
    const c = analyzeUniverse(BOROS, series, { ...OPTS, seed: 12 });
    expect(c.perBrand.map((x) => x.rho)).toEqual(a.perBrand.map((x) => x.rho));
    expect(c.perBrand.map((x) => x.p)).not.toEqual(a.perBrand.map((x) => x.p));
  });

  it('gives no credit for borough-level association alone (null calibration)', () => {
    // Lift and target share only a borough effect; within boroughs they are independent.
    const effect: Record<string, number> = { Bronx: 0, Brooklyn: 2, Manhattan: 4 };
    let rejections = 0;
    let rhoSum = 0;
    let nullSum = 0;
    const datasets = 60;
    for (let d = 0; d < datasets; d++) {
      const rng = mulberry32(1000 + d);
      const target = Float64Array.from(BOROS, (b) => effect[b]! + gaussian(rng));
      const lift = Float64Array.from(BOROS, (b) => effect[b]! + gaussian(rng));
      const r = analyzeUniverse(BOROS, [{ id: 'x', target, lift }], { ...OPTS, permutations: 199, seed: d });
      rhoSum += r.perBrand[0]!.rho;
      nullSum += r.perBrand[0]!.nullMean;
      if (r.perBrand[0]!.p < 0.05) rejections++;
    }
    expect(rhoSum / datasets).toBeGreaterThan(0.6); // the naive correlation looks impressive…
    expect(rejections / datasets).toBeLessThanOrEqual(0.12); // …but the null rejects at about the nominal 5%
    expect(Math.abs(nullSum - rhoSum) / datasets).toBeLessThan(0.05); // because borough structure alone produces it
  });

  it('is calibrated under a plain null', () => {
    let rejections = 0;
    const datasets = 60;
    for (let d = 0; d < datasets; d++) {
      const rng = mulberry32(5000 + d);
      const r = analyzeUniverse(BOROS, [{ id: 'x', target: noise(60, rng), lift: noise(60, rng) }], { ...OPTS, permutations: 199, seed: d });
      if (r.perBrand[0]!.p < 0.05) rejections++;
    }
    expect(rejections / datasets).toBeLessThanOrEqual(0.12);
  });

  it('specificity: own maps beat other chains’ maps only when the maps are chain-specific', () => {
    const rng = mulberry32(61);
    const specific: BrandSeries[] = Array.from({ length: 6 }, (_, b) => {
      const target = noise(60, rng);
      return { id: `s${b}`, target, lift: add(target, noise(60, rng), 0.7) };
    });
    const s = analyzeUniverse(BOROS, specific, OPTS);
    expect(s.specificity!.meanOwn).toBeGreaterThan(s.specificity!.meanOther + 0.4);
    expect(s.specificity!.ownBest).toBe(6);
    expect(s.specificity!.p).toBeLessThan(0.01);
    expect(s.perBrand.every((b) => b.ownRank === 1)).toBe(true);
    for (const b of s.perBrand) {
      expect(Math.abs(b.otherMaps!)).toBeLessThan(0.3); // other chains' maps know nothing about this chain
      expect(b.rho).toBeGreaterThan(b.otherMaps! + 0.4);
      expect(Math.abs(b.nullMean)).toBeLessThan(0.1); // no borough structure here
    }
    // The placebo baseline is the column mean of the cross matrix (own map excluded).
    expect(s.specificity!.meanOther).toBeCloseTo(s.perBrand.reduce((sum, b) => sum + b.otherMaps!, 0) / 6, 12);
    // Own map best among 6 maps → placebo p = (1 + 0)/6, the smallest possible with six chains.
    for (const b of s.perBrand) expect(b.placeboP).toBeCloseTo(1 / 6, 12);

    // Every map is the same density surface and every target follows density: each ρ > 0, yet a chain's
    // own map is no better than another chain's.
    const density = noise(60, rng);
    const shared: BrandSeries[] = Array.from({ length: 6 }, (_, b) => ({
      id: `d${b}`,
      target: add(density, noise(60, rng), 0.8),
      lift: add(density, noise(60, rng), 0.05),
    }));
    const d = analyzeUniverse(BOROS, shared, OPTS);
    expect(d.summary!.positive).toBe(6);
    expect(Math.abs(d.specificity!.meanOwn - d.specificity!.meanOther)).toBeLessThan(0.05);
    expect(d.specificity!.p).toBeGreaterThan(0.05);
    for (const b of d.perBrand) expect(Math.abs(b.rho - b.otherMaps!)).toBeLessThan(0.1);
  });

  it('reports undefined correlations without letting them into the panel statistics', () => {
    const rng = mulberry32(71);
    const target = noise(60, rng);
    const r = analyzeUniverse(
      BOROS,
      [
        { id: 'flat', target: new Float64Array(60).fill(1), lift: noise(60, rng) },
        { id: 'ok', target, lift: add(target, noise(60, rng)) },
      ],
      { ...OPTS, permutations: 100 },
    );
    expect(r.perBrand[0]!.rho).toBeNaN();
    expect(r.perBrand[0]!.p).toBeNaN();
    expect(r.perBrand[0]!.nullMean).toBeNaN();
    expect(r.perBrand[0]!.ownRank).toBeNull();
    expect(r.perBrand[0]!.otherMaps).toBeNull();
    expect(r.summary!.brands).toBe(1);
    expect(r.specificity).toBeNull(); // needs two chains with a defined ρ
    expect(analyzeUniverse(BOROS, [], OPTS)).toEqual({ perBrand: [], summary: null, specificity: null });
  });

  it('rejects series that are not aligned with the universe', () => {
    expect(() => analyzeUniverse(BOROS, [{ id: 'x', target: [1, 2, 3], lift: [1, 2, 3] }], OPTS)).toThrow(/not aligned/);
  });
});

describe('nullCalibration', () => {
  const groups = groupsOf(BOROS);
  /** Independent field per borough, smoothed along the borough's positions (a 1-D stand-in for neighbouring NTAs). */
  const field = (rng: () => number, window: number) => {
    const out = new Float64Array(BOROS.length);
    for (const g of groups) {
      const raw = g.map(() => gaussian(rng));
      g.forEach((pos, t) => {
        let sum = 0;
        let n = 0;
        for (let d = -window; d <= window; d++) {
          const v = raw[t + d];
          if (v !== undefined) {
            sum += v;
            n++;
          }
        }
        out[pos] = sum / n;
      });
    }
    return out;
  };
  const series = (seed: number, window: number) => {
    const rng = mulberry32(seed);
    return Array.from({ length: 12 }, (_, b): BrandSeries => ({ id: `c${b}`, target: field(rng, window), lift: field(rng, window) }));
  };

  it('is close to nominal when neighborhoods are exchangeable', () => {
    const c = nullCalibration(BOROS, series(81, 0), { permutations: 199, seed: 1 })!;
    expect(c.pairs).toBe(132);
    expect(c.alpha).toBe(0.05);
    expect(c.falsePositiveRate).toBeLessThanOrEqual(0.12);
    expect(c.sdExchangeable).toBeCloseTo(1 / Math.sqrt(59), 12);
    expect(c.sdRho / c.sdExchangeable).toBeGreaterThan(0.7);
    expect(c.sdRho / c.sdExchangeable).toBeLessThan(1.3);
  });

  it('exposes the inflation spatial smoothness causes', () => {
    const c = nullCalibration(BOROS, series(82, 4), { permutations: 199, seed: 1 })!;
    expect(c.falsePositiveRate).toBeGreaterThan(0.1);
    expect(c.sdRho).toBeGreaterThan(1.5 * c.sdExchangeable);
  });

  it('needs at least two comparable pairs', () => {
    expect(nullCalibration(BOROS, [], { permutations: 9, seed: 1 })).toBeNull();
    expect(nullCalibration(BOROS, series(83, 0).slice(0, 1), { permutations: 9, seed: 1 })).toBeNull();
  });
});
