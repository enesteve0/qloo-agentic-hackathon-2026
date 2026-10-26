import 'server-only';

/*
 * Rank-based normalisation. Qloo heatmap values behave like percentile ranks, so every comparison
 * goes through ranks: results are invariant to each map's scale and to monotone re-encodings.
 * NaN marks a missing value everywhere and is never ranked.
 */

// Acklam's rational approximation of the standard normal quantile (relative error < 1.15e-9).
const A = [-39.69683028665376, 220.9460984245205, -275.9285104469687, 138.357751867269, -30.66479806614716, 2.506628277459239] as const;
const B = [-54.47609879822406, 161.5858368580409, -155.6989798598866, 66.80131188771972, -13.28068155288572] as const;
const C = [-0.007784894002430293, -0.3223964580411365, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783] as const;
const D = [0.007784695709041462, 0.3224671290700398, 2.445134137142996, 3.754408661907416] as const;
const P_LOW = 0.02425;

function lowerTail(p: number): number {
  const q = Math.sqrt(-2 * Math.log(p));
  return (
    (((((C[0] * q + C[1]) * q + C[2]) * q + C[3]) * q + C[4]) * q + C[5]) /
    ((((D[0] * q + D[1]) * q + D[2]) * q + D[3]) * q + 1)
  );
}

/** Φ⁻¹(p): inverse standard normal CDF. ±Infinity at 0/1, NaN outside [0, 1]. */
export function probit(p: number): number {
  if (!(p >= 0 && p <= 1)) return NaN;
  if (p === 0) return -Infinity;
  if (p === 1) return Infinity;
  if (p < P_LOW) return lowerTail(p);
  // 1 − p is exact for p ≥ 0.5, so the upper tail keeps full precision by symmetry.
  if (p > 1 - P_LOW) return -lowerTail(1 - p);
  const q = p - 0.5;
  const r = q * q;
  return (
    ((((((A[0] * r + A[1]) * r + A[2]) * r + A[3]) * r + A[4]) * r + A[5]) * q) /
    (((((B[0] * r + B[1]) * r + B[2]) * r + B[3]) * r + B[4]) * r + 1)
  );
}

/** 1-based average ranks (ties share their mean rank) over the non-NaN entries; NaN stays NaN. */
export function averageRanks(values: ArrayLike<number>): { ranks: Float64Array; n: number } {
  const order: number[] = [];
  for (let i = 0; i < values.length; i++) if (!Number.isNaN(values[i]!)) order.push(i);
  // Comparisons (not subtraction) keep ±Infinity sortable; index order makes the sort total.
  order.sort((a, b) => {
    const va = values[a]!;
    const vb = values[b]!;
    return va < vb ? -1 : va > vb ? 1 : a - b;
  });
  const ranks = new Float64Array(values.length).fill(NaN);
  let k = 0;
  while (k < order.length) {
    const v = values[order[k]!]!;
    let m = k;
    while (m + 1 < order.length && values[order[m + 1]!]! === v) m++;
    const avg = (k + m) / 2 + 1;
    for (let t = k; t <= m; t++) ranks[order[t]!] = avg;
    k = m + 1;
  }
  return { ranks, n: order.length };
}

/** Rank-normal scores: u = (rank − 0.5)/n → z = Φ⁻¹(u). NaN stays NaN. */
export function rankZ(values: ArrayLike<number>): Float64Array {
  const { ranks, n } = averageRanks(values);
  const z = new Float64Array(values.length);
  for (let i = 0; i < z.length; i++) {
    const r = ranks[i]!;
    z[i] = Number.isNaN(r) ? NaN : probit((r - 0.5) / n);
  }
  return z;
}

/** Mid-rank percentile (0–100) of each non-NaN entry among the non-NaN entries; NaN stays NaN. */
export function percentileRanks(values: ArrayLike<number>): Float64Array {
  const { ranks, n } = averageRanks(values);
  const out = new Float64Array(values.length);
  for (let i = 0; i < out.length; i++) {
    const r = ranks[i]!;
    out[i] = Number.isNaN(r) ? NaN : (100 * (r - 0.5)) / n;
  }
  return out;
}

/** Number of non-NaN entries. */
export function countDefined(values: ArrayLike<number>): number {
  let n = 0;
  for (let i = 0; i < values.length; i++) if (!Number.isNaN(values[i]!)) n++;
  return n;
}

function coCovered(a: ArrayLike<number>, b: ArrayLike<number>): [number[], number[]] {
  if (a.length !== b.length) throw new RangeError(`length mismatch: ${a.length} vs ${b.length}`);
  const xa: number[] = [];
  const xb: number[] = [];
  for (let i = 0; i < a.length; i++) {
    const va = a[i]!;
    const vb = b[i]!;
    if (!Number.isNaN(va) && !Number.isNaN(vb)) {
      xa.push(va);
      xb.push(vb);
    }
  }
  return [xa, xb];
}

function pearsonDense(x: ArrayLike<number>, y: ArrayLike<number>): number {
  const n = x.length;
  if (n < 2) return NaN;
  let mx = 0;
  let my = 0;
  for (let i = 0; i < n; i++) {
    mx += x[i]!;
    my += y[i]!;
  }
  mx /= n;
  my /= n;
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < n; i++) {
    const dx = x[i]! - mx;
    const dy = y[i]! - my;
    sxy += dx * dy;
    sxx += dx * dx;
    syy += dy * dy;
  }
  if (sxx === 0 || syy === 0) return NaN;
  return Math.max(-1, Math.min(1, sxy / Math.sqrt(sxx * syy)));
}

/** Pearson correlation over co-covered entries (both non-NaN); NaN when undefined. */
export function pearson(a: ArrayLike<number>, b: ArrayLike<number>): number {
  const [xa, xb] = coCovered(a, b);
  return pearsonDense(xa, xb);
}

/**
 * Spearman ρ over co-covered entries: Pearson correlation of average ranks (the tie-corrected form).
 * NaN when fewer than 3 entries are co-covered or either side is constant.
 */
export function spearman(a: ArrayLike<number>, b: ArrayLike<number>): number {
  const [xa, xb] = coCovered(a, b);
  if (xa.length < 3) return NaN;
  return pearsonDense(averageRanks(xa).ranks, averageRanks(xb).ranks);
}
