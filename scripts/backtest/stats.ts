/**
 * Statistics for the validation backtest (docs/ARCHITECTURE.md §18). Pure, seeded and deterministic.
 *
 * Every correlation is the production `spearman` from the lift engine (src/server/geo/rankz.ts): Pearson
 * correlation of average ranks over the entries both series define.
 *
 * - Per brand: ρ(Qloo lift, OSM over-index) across the neighborhoods of one universe.
 * - Null: the targets are shuffled within borough (one shared permutation per draw, applied to every brand, so
 *   correlations between brands survive). It keeps each borough's mix of targets, so a map that only separates
 *   boroughs earns nothing; `nullMean` is what that structure alone yields. p = (1 + #{null ≥ observed}) /
 *   (1 + draws), one-sided (ρ > 0). Spatial autocorrelation below the borough scale is not preserved, so these
 *   p-values are optimistic; `nullCalibration` measures by how much on maps known to be unrelated.
 * - Panel: median ρ with a brand-level percentile bootstrap CI, and the number of brands with ρ > 0, both tested
 *   against the same permutation draws.
 * - Specificity (placebo): ρ of every brand's map against every brand's target. If Qloo's maps only tracked
 *   something shared by all chains (density, borough), another brand's map would predict a target as well as
 *   the brand's own; the test shuffles which map belongs to which brand, and `placeboP` asks the same per brand.
 *   Other chains' maps are as spatially smooth as the own map, so these comparisons survive autocorrelation.
 */
import { spearman } from '@/server/geo/rankz';

/** Seeded PRNG (mulberry32): uniform [0, 1), identical on every platform. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffleInPlace(a: number[], rng: () => number): void {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const t = a[i]!;
    a[i] = a[j]!;
    a[j] = t;
  }
}

/** Positions grouped by label (labels in sorted order, positions ascending), e.g. NTA positions by borough. */
export function groupsOf(labels: readonly string[]): number[][] {
  const byLabel = new Map<string, number[]>();
  labels.forEach((label, i) => {
    const list = byLabel.get(label);
    if (list) list.push(i);
    else byLabel.set(label, [i]);
  });
  return [...byLabel.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([, list]) => list);
}

/** A permutation that only moves values between positions of the same group: out[i] = source position for i. */
export function withinGroupPermutation(groups: readonly (readonly number[])[], size: number, rng: () => number): Int32Array {
  const perm = new Int32Array(size);
  for (let i = 0; i < size; i++) perm[i] = i;
  for (const group of groups) {
    const shuffled = [...group];
    shuffleInPlace(shuffled, rng);
    group.forEach((pos, t) => {
      perm[pos] = shuffled[t]!;
    });
  }
  return perm;
}

export function permute(values: ArrayLike<number>, perm: ArrayLike<number>): Float64Array {
  const out = new Float64Array(perm.length);
  for (let i = 0; i < perm.length; i++) out[i] = values[perm[i]!]!;
  return out;
}

export function median(xs: readonly number[]): number {
  if (xs.length === 0) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

/** Linear-interpolation quantile of sorted values (type 7, numpy's default). */
export function quantileSorted(sorted: readonly number[], q: number): number {
  if (sorted.length === 0) return NaN;
  const h = (sorted.length - 1) * Math.min(1, Math.max(0, q));
  const lo = Math.floor(h);
  const hi = Math.min(lo + 1, sorted.length - 1);
  return sorted[lo]! + (h - lo) * (sorted[hi]! - sorted[lo]!);
}

/** Percentile bootstrap CI of the median: values resampled with replacement `resamples` times. */
export function bootstrapMedianCI(values: readonly number[], resamples: number, seed: number, level = 0.95): [number, number] {
  if (values.length === 0) return [NaN, NaN];
  const rng = mulberry32(seed);
  const medians: number[] = [];
  const sample = new Array<number>(values.length);
  for (let r = 0; r < resamples; r++) {
    for (let i = 0; i < values.length; i++) sample[i] = values[Math.floor(rng() * values.length)]!;
    medians.push(median(sample));
  }
  medians.sort((a, b) => a - b);
  const alpha = (1 - level) / 2;
  return [quantileSorted(medians, alpha), quantileSorted(medians, 1 - alpha)];
}

/** Floating-point slack: a null value equal to the observed one counts as "at least as large" (conservative). */
const EPS = 1e-12;

/** One-sided permutation p-value: (1 + #{null ≥ observed}) / (1 + draws). */
export function permutationP(observed: number, nulls: ArrayLike<number>): number {
  let atLeast = 0;
  for (let k = 0; k < nulls.length; k++) if (nulls[k]! >= observed - EPS) atLeast++;
  return (1 + atLeast) / (1 + nulls.length);
}

// ---------------------------------------------------------------------------------------------
// One universe of neighborhoods
// ---------------------------------------------------------------------------------------------

export interface BrandSeries {
  id: string;
  /** OSM over-index per universe position (NaN = missing). */
  target: ArrayLike<number>;
  /** Qloo lift per universe position (NaN = missing). */
  lift: ArrayLike<number>;
}

export interface AnalysisOptions {
  permutations: number;
  seed: number;
  bootstrap: number;
  bootstrapSeed: number;
  specificitySeed: number;
  level?: number;
}

export interface BrandResult {
  id: string;
  /** Neighborhoods where both the lift and the target are defined. */
  n: number;
  /** NaN when undefined (fewer than 3 neighborhoods or a constant series). */
  rho: number;
  /** Within-borough permutation p-value (one-sided, ρ > 0); NaN when ρ is undefined. */
  p: number;
  /** Mean ρ under the within-borough shuffle: what borough-level structure alone yields (not 0 in general). */
  nullMean: number;
  /** Rank of the brand's own map among all panel maps as a predictor of its target (1 = best); null when ρ is undefined. */
  ownRank: number | null;
  /** Mean ρ of the other chains' maps against this chain's target (the placebo baseline); null without ≥2 chains. */
  otherMaps: number | null;
  /**
   * Placebo p-value: (1 + #{other maps with ρ ≥ own}) / (number of maps). The other chains' maps share the own map's
   * spatial smoothness, so unlike `p` it stays valid under spatial autocorrelation (coarse: at best 1/maps).
   */
  placeboP: number | null;
}

export interface PanelSummary {
  brands: number;
  medianRho: number;
  meanRho: number;
  /** Brand-level bootstrap percentile interval of the median ρ. */
  ci: [number, number];
  /** Share of permutation draws whose median ρ is at least the observed one. */
  pMedian: number;
  positive: number;
  pPositive: number;
  /** Brands with a per-brand p < 0.05 (unadjusted). */
  significant: number;
}

export interface Specificity {
  /** Mean ρ of each brand's own map against its own target. */
  meanOwn: number;
  /** Mean ρ of other brands' maps against a brand's target. */
  meanOther: number;
  /** Brands whose own map is the best predictor of their target. */
  ownBest: number;
  /** Permutation p-value of `meanOwn` when maps are reassigned to brands at random. */
  p: number;
}

export interface UniverseAnalysis {
  perBrand: BrandResult[];
  summary: PanelSummary | null;
  specificity: Specificity | null;
}

/**
 * Analyses one universe: `boros[i]` is the borough of position i, every series is aligned with it. Brands
 * whose ρ is undefined are reported but left out of the panel statistics.
 */
export function analyzeUniverse(boros: readonly string[], series: readonly BrandSeries[], o: AnalysisOptions): UniverseAnalysis {
  const size = boros.length;
  for (const s of series) {
    if (s.target.length !== size || s.lift.length !== size) throw new RangeError(`series ${s.id} is not aligned with the universe`);
  }
  const coCovered = (s: BrandSeries) => {
    let n = 0;
    for (let i = 0; i < size; i++) if (!Number.isNaN(s.target[i]!) && !Number.isNaN(s.lift[i]!)) n++;
    return n;
  };
  const observed = series.map((s) => spearman(s.lift, s.target));
  const valid = series.map((_, b) => b).filter((b) => Number.isFinite(observed[b]!));

  // Null distribution: one within-borough permutation per draw, shared by every brand.
  const groups = groupsOf(boros);
  const rng = mulberry32(o.seed);
  const nullRho = valid.map(() => new Float64Array(o.permutations));
  const nullMedian = new Float64Array(o.permutations);
  const nullPositive = new Float64Array(o.permutations);
  for (let k = 0; k < o.permutations; k++) {
    const perm = withinGroupPermutation(groups, size, rng);
    const draw: number[] = [];
    valid.forEach((b, v) => {
      const s = series[b]!;
      const rho = spearman(s.lift, permute(s.target, perm));
      nullRho[v]![k] = rho;
      if (Number.isFinite(rho)) draw.push(rho);
    });
    nullMedian[k] = median(draw);
    nullPositive[k] = draw.filter((r) => r > 0).length;
  }

  // Specificity: R[i][j] = ρ(map of brand i, target of brand j) over the valid brands.
  let specificity: Specificity | null = null;
  const ownRank = new Map<number, number>();
  const otherMaps = new Map<number, number>();
  const placeboP = new Map<number, number>();
  if (valid.length >= 2) {
    const R = valid.map((i) => valid.map((j) => spearman(series[i]!.lift, series[j]!.target)));
    const at = (i: number, j: number) => (Number.isFinite(R[i]![j]!) ? R[i]![j]! : 0);
    const meanDiag = (assign: readonly number[]) => assign.reduce((sum, i, j) => sum + at(i, j), 0) / assign.length;
    const identity = valid.map((_, v) => v);
    const meanOwn = meanDiag(identity);
    let other = 0;
    let otherN = 0;
    valid.forEach((_, j) => {
      let better = 0;
      let atLeast = 0;
      let column = 0;
      valid.forEach((__, i) => {
        if (i === j) return;
        column += at(i, j);
        if (at(i, j) > at(j, j)) better++;
        if (at(i, j) >= at(j, j) - EPS) atLeast++;
      });
      other += column;
      otherN += valid.length - 1;
      ownRank.set(valid[j]!, 1 + better);
      otherMaps.set(valid[j]!, column / (valid.length - 1));
      placeboP.set(valid[j]!, (1 + atLeast) / valid.length);
    });
    const srng = mulberry32(o.specificitySeed);
    const nulls = new Float64Array(o.permutations);
    for (let k = 0; k < o.permutations; k++) {
      const assign = [...identity];
      shuffleInPlace(assign, srng);
      nulls[k] = meanDiag(assign);
    }
    specificity = {
      meanOwn,
      meanOther: otherN ? other / otherN : NaN,
      ownBest: [...ownRank.values()].filter((r) => r === 1).length,
      p: permutationP(meanOwn, nulls),
    };
  }

  const meanFinite = (xs: ArrayLike<number>) => {
    let sum = 0;
    let n = 0;
    for (let k = 0; k < xs.length; k++) {
      if (Number.isFinite(xs[k]!)) {
        sum += xs[k]!;
        n++;
      }
    }
    return n ? sum / n : NaN;
  };
  const perBrand = series.map((s, b): BrandResult => {
    const v = valid.indexOf(b);
    return {
      id: s.id,
      n: coCovered(s),
      rho: observed[b]!,
      p: v >= 0 ? permutationP(observed[b]!, nullRho[v]!) : NaN,
      nullMean: v >= 0 ? meanFinite(nullRho[v]!) : NaN,
      ownRank: ownRank.get(b) ?? null,
      otherMaps: otherMaps.get(b) ?? null,
      placeboP: placeboP.get(b) ?? null,
    };
  });

  if (valid.length === 0) return { perBrand, summary: null, specificity };
  return { perBrand, summary: summarize(valid.map((b) => observed[b]!), perBrand, nullMedian, nullPositive, o), specificity };
}

/** Panel statistics over the chains with a defined ρ, tested against the shared permutation draws. */
function summarize(
  rhos: readonly number[],
  perBrand: readonly BrandResult[],
  nullMedian: Float64Array,
  nullPositive: Float64Array,
  o: AnalysisOptions,
): PanelSummary {
  const medianRho = median(rhos);
  const positive = rhos.filter((r) => r > 0).length;
  return {
    brands: rhos.length,
    medianRho,
    meanRho: rhos.reduce((s, r) => s + r, 0) / rhos.length,
    ci: bootstrapMedianCI(rhos, o.bootstrap, o.bootstrapSeed, o.level ?? 0.95),
    pMedian: permutationP(medianRho, nullMedian),
    positive,
    pPositive: permutationP(positive, nullPositive),
    significant: perBrand.filter((r) => r.p < 0.05).length,
  };
}

// ---------------------------------------------------------------------------------------------
// Calibration of the within-borough test
// ---------------------------------------------------------------------------------------------

export interface NullCalibration {
  /** (map, target) pairs tested: every chain's map against every other chain's target. */
  pairs: number;
  alpha: number;
  /** Share of pairs with a within-borough p below `alpha` (nominal rate: `alpha`). */
  falsePositiveRate: number;
  /** SD of ρ across the pairs… */
  sdRho: number;
  /** …and the SD an exchangeable null would imply, 1/√(n − 1) at the mean pair size n. */
  sdExchangeable: number;
}

/**
 * Empirical false-positive rate of the within-borough test, for maps known to carry no information about the
 * targets (the synthetic transport's maps): each chain's map is tested against every other chain's target. Rates
 * above `alpha`, and an SD of ρ above the exchangeable one, measure what spatial autocorrelation does to the test.
 * Not meaningful for live maps, whose cross-chain pairs can share real audiences.
 */
export function nullCalibration(
  boros: readonly string[],
  series: readonly BrandSeries[],
  o: { permutations: number; seed: number; alpha?: number },
): NullCalibration | null {
  const alpha = o.alpha ?? 0.05;
  const rhos: number[] = [];
  let sizes = 0;
  let rejected = 0;
  let pair = 0;
  series.forEach((map, i) =>
    series.forEach((stores, j) => {
      if (i === j) return;
      const r = analyzeUniverse(boros, [{ id: `${map.id}→${stores.id}`, target: stores.target, lift: map.lift }], {
        permutations: o.permutations,
        seed: o.seed + pair++,
        bootstrap: 1,
        bootstrapSeed: 0,
        specificitySeed: 0,
      }).perBrand[0]!;
      if (!Number.isFinite(r.rho)) return;
      rhos.push(r.rho);
      sizes += r.n;
      if (r.p < alpha) rejected++;
    }),
  );
  if (rhos.length < 2) return null;
  const mean = rhos.reduce((s, r) => s + r, 0) / rhos.length;
  const sd = Math.sqrt(rhos.reduce((s, r) => s + (r - mean) ** 2, 0) / (rhos.length - 1));
  return { pairs: rhos.length, alpha, falsePositiveRate: rejected / rhos.length, sdRho: sd, sdExchangeable: 1 / Math.sqrt(sizes / rhos.length - 1) };
}
