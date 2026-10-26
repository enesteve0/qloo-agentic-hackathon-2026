import 'server-only';
import type { Confidence } from '@/shared/types';
import { gridNeighbors } from './grid';
import type { GridSpec } from './types';

/** Below this effective sample size an NTA's own SD is too noisy; the pooled median SD is used. */
export const MIN_NEFF_OWN_SD = 3;
/** Guards L̂/SE against a zero SE (e.g. a perfectly flat neighborhood). */
const SE_FLOOR = 1e-9;

export interface WeightedLift {
  id: string;
  /** Per-cell lift ℓ_a (NaN = undefined). */
  lift: Float64Array;
  /** Final anchor weight (> 0 for included anchors). */
  weight: number;
}

/** L(g) = Σ w_a ℓ_a(g) / Σ w_a over the anchors defined at g with weight > 0; NaN where none is. */
export function combineLift(parts: readonly WeightedLift[], size: number): Float64Array {
  const num = new Float64Array(size);
  const den = new Float64Array(size);
  for (const { lift, weight } of parts) {
    if (!(weight > 0)) continue;
    for (let g = 0; g < size; g++) {
      const l = lift[g];
      if (l === undefined || Number.isNaN(l)) continue;
      num[g] = num[g]! + weight * l;
      den[g] = den[g]! + weight;
    }
  }
  return num.map((s, g) => (den[g]! > 0 ? s / den[g]! : NaN));
}

/**
 * Kiosk smoothing: S(g) = (4·L(g) + Σ_{n ∈ N8(g), defined} L(n)) / (4 + k_g), k_g = defined neighbours.
 * A cell without its own L stays NaN (kiosks there are not scored).
 */
export function smoothLift(L: Float64Array, grid: GridSpec): Float64Array {
  const { offsets, indices } = gridNeighbors(grid);
  const S = new Float64Array(L.length);
  for (let g = 0; g < L.length; g++) {
    const own = L[g]!;
    if (Number.isNaN(own)) {
      S[g] = NaN;
      continue;
    }
    let sum = 4 * own;
    let k = 0;
    for (let p = offsets[g]!; p < offsets[g + 1]!; p++) {
      const v = L[indices[p]!]!;
      if (!Number.isNaN(v)) {
        sum += v;
        k++;
      }
    }
    S[g] = sum / (4 + k);
  }
  return S;
}

/** high: L̂/SE ≥ 2, agreement ≥ 2/3, n_eff ≥ 3 · medium: L̂/SE ≥ 1, agreement ≥ 1/2 · otherwise low. */
export function confidenceOf(x: { lift: number; se: number; agreement: number; nEff: number }): Confidence {
  const t = x.se > 0 ? x.lift / x.se : x.lift > 0 ? Infinity : x.lift < 0 ? -Infinity : 0;
  if (t >= 2 && x.agreement >= 2 / 3 && x.nEff >= 3) return 'high';
  if (t >= 1 && x.agreement >= 1 / 2) return 'medium';
  return 'low';
}

export interface NtaAggregate {
  code: string;
  /** Land-weighted mean lift L_j (unshrunk). */
  mean: number;
  /** Empirical-Bayes shrunk lift L̂_j = L_j · n_eff/(n_eff + κ). */
  lift: number;
  /** SD behind the SE: the NTA's own weighted SD, or the pooled median when n_eff < 3. */
  sd: number;
  pooledSd: boolean;
  se: number;
  nEff: number;
  /** Share of included anchors (defined here) whose own aggregated lift is positive. */
  agreement: number;
  confidence: Confidence;
  /** Each included anchor's share of L̂_j (sums to L̂_j when anchors cover the same cells), best first. */
  contributions: { anchorId: string; contribution: number }[];
}

export interface AggregateInput {
  /** Combined, unsmoothed lift per cell. */
  L: Float64Array;
  grid: GridSpec;
  kappa: number;
  /** Included anchors (weight > 0), for agreement and contributions. */
  anchors: readonly WeightedLift[];
}

function median(xs: number[]): number | undefined {
  if (!xs.length) return undefined;
  const s = [...xs].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

/** Unweighted SD of all defined cells: the pooled fallback when no NTA has n_eff ≥ 3. */
function cellSd(L: Float64Array): number {
  let n = 0;
  let mean = 0;
  for (const v of L) {
    if (!Number.isNaN(v)) {
      n++;
      mean += v;
    }
  }
  if (n < 2) return 1;
  mean /= n;
  let ss = 0;
  for (const v of L) if (!Number.isNaN(v)) ss += (v - mean) ** 2;
  return Math.sqrt(ss / (n - 1));
}

interface Row {
  code: string;
  mean: number;
  nEff: number;
  ownSd: number;
  perAnchor: number[];
}

/**
 * Neighborhood aggregation from the unsmoothed L with land weights w_gj (ARCHITECTURE §6 steps 8–9):
 * L_j, n_eff = (Σw)²/Σw², reliability-weighted SD (pooled median SD across NTAs when n_eff < 3),
 * SE = s/√n_eff, L̂ = L_j·n_eff/(n_eff + κ), agreement and confidence. NTAs without data are omitted.
 */
export function aggregateNtas(input: AggregateInput): NtaAggregate[] {
  const { L, grid, kappa, anchors } = input;
  const rows: Row[] = [];
  for (const [code, pairs] of Object.entries(grid.ntaWeights)) {
    let W = 0;
    let W2 = 0;
    let S = 0;
    for (const [g, w] of pairs) {
      const l = L[g];
      if (!(w > 0) || l === undefined || Number.isNaN(l)) continue;
      W += w;
      W2 += w * w;
      S += w * l;
    }
    if (W === 0) continue;
    const mean = S / W;
    const nEff = (W * W) / W2;
    let ss = 0;
    for (const [g, w] of pairs) {
      const l = L[g];
      if (!(w > 0) || l === undefined || Number.isNaN(l)) continue;
      ss += w * (l - mean) ** 2;
    }
    // Reliability-weights correction: Σw(L − L_j)² / (Σw − Σw²/Σw).
    const ownSd = nEff > 1 ? Math.sqrt((ss / W) * (nEff / (nEff - 1))) : NaN;
    const perAnchor = anchors.map((a) => {
      let wa = 0;
      let sa = 0;
      for (const [g, w] of pairs) {
        const l = a.lift[g];
        if (!(w > 0) || l === undefined || Number.isNaN(l)) continue;
        wa += w;
        sa += w * l;
      }
      return wa > 0 ? sa / wa : NaN;
    });
    rows.push({ code, mean, nEff, ownSd, perAnchor });
  }

  const pooled =
    median(rows.filter((r) => r.nEff >= MIN_NEFF_OWN_SD && Number.isFinite(r.ownSd)).map((r) => r.ownSd)) ?? cellSd(L);

  return rows.map((r): NtaAggregate => {
    const pooledSd = !(r.nEff >= MIN_NEFF_OWN_SD && Number.isFinite(r.ownSd));
    const sd = pooledSd ? pooled : r.ownSd;
    const se = Math.max(sd / Math.sqrt(r.nEff), SE_FLOOR);
    const shrink = r.nEff / (r.nEff + kappa);
    const lift = r.mean * shrink;

    let defined = 0;
    let positive = 0;
    let wSum = 0;
    anchors.forEach((a, k) => {
      const v = r.perAnchor[k]!;
      if (Number.isNaN(v)) return;
      defined++;
      if (v > 0) positive++;
      wSum += a.weight;
    });
    const agreement = defined ? positive / defined : 0;
    const contributions = anchors
      .map((a, k) => ({ anchorId: a.id, contribution: (a.weight / wSum) * r.perAnchor[k]! * shrink, k }))
      .filter((c) => !Number.isNaN(c.contribution))
      .sort((x, y) => y.contribution - x.contribution || x.k - y.k)
      .map(({ anchorId, contribution }) => ({ anchorId, contribution }));

    return {
      code: r.code,
      mean: r.mean,
      lift,
      sd,
      pooledSd,
      se,
      nEff: r.nEff,
      agreement,
      confidence: confidenceOf({ lift, se, agreement, nEff: r.nEff }),
      contributions,
    };
  });
}
