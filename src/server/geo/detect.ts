import 'server-only';
import type { AnchorFlag, AnchorMapInfo, LiftConfig } from '@/shared/types';
import { formatInt, round } from './format';
import type { AnchorLift } from './lift';
import { spearman } from './rankz';

/** Length of the cell order compared with the default-map fingerprint. */
export const TOP_ORDER_CELLS = 100;
/** Shorter top lists than this are never called identical (too little evidence). */
const MIN_TOP_ORDER = 10;

/** Indices of the `k` highest values, highest first; ties by index so the order is total. */
export function topOrder(values: ArrayLike<number>, k: number): number[] {
  const idx: number[] = [];
  for (let i = 0; i < values.length; i++) if (!Number.isNaN(values[i]!)) idx.push(i);
  idx.sort((a, b) => {
    const va = values[a]!;
    const vb = values[b]!;
    return va > vb ? -1 : va < vb ? 1 : a - b;
  });
  return idx.slice(0, k);
}

/** True when both maps rank the same top cells in the same order (up to `k`, at least 10 cells). */
export function sameTopOrder(a: ArrayLike<number>, b: ArrayLike<number>, k = TOP_ORDER_CELLS): boolean {
  const ta = topOrder(a, k);
  const tb = topOrder(b, k);
  const n = Math.min(ta.length, tb.length);
  if (n < MIN_TOP_ORDER) return false;
  for (let i = 0; i < n; i++) if (ta[i] !== tb[i]) return false;
  return true;
}

export interface FlagInput {
  anchors: readonly AnchorLift[];
  config: LiftConfig;
  /** Number of cells in G (for coverage). */
  gridSize: number;
  /** Qloo's generic default map projected with the anchors' metric, when calibration stored one. */
  fingerprint?: Float64Array | null;
}

export interface FlagOutput {
  infos: AnchorMapInfo[];
  /** Final weight per anchor (user weight × flag weights), aligned with `anchors`; 0 = excluded. */
  weights: number[];
  /** One plain-language line per flag, in anchor order. */
  narration: string[];
}

/**
 * Decides which anchor maps to trust (ARCHITECTURE §6 step 5):
 * - DEFAULT_MAP: ρ ≥ defaultMapRho vs the fingerprint, or the same top-100 cell order → excluded.
 * - IDENTICAL_PAIR: ρ ≥ identicalRho with an earlier counted anchor → the later one is merged
 *   (weight 0) so one map is not counted twice.
 * - DENSITY_ONLY: ρ(anchor, baseline) ≥ densityOnlyRho → weight × 0.5.
 * - THIN: fewer than thinMinCells lift cells, or overlap with the baseline < thinMinOverlap → weight × coverage.
 * Excluded anchors get no further flags.
 */
export function detectFlags(input: FlagInput): FlagOutput {
  const { anchors, gridSize, fingerprint } = input;
  const t = input.config.thresholds;
  const flags: AnchorFlag[][] = anchors.map(() => []);
  const lines: string[][] = anchors.map(() => []);
  const weights = anchors.map((a) => a.userWeight);

  anchors.forEach((a, i) => {
    if (!fingerprint) return;
    if (spearman(a.values, fingerprint) >= t.defaultMapRho || sameTopOrder(a.values, fingerprint)) {
      flags[i]!.push('DEFAULT_MAP');
      weights[i] = 0;
      lines[i]!.push(`Set aside '${a.name}': its NYC map matches Qloo's default map, which is just overall density.`);
    }
  });

  anchors.forEach((a, i) => {
    if (weights[i] === 0) return;
    for (let j = 0; j < i; j++) {
      const other = anchors[j]!;
      if (weights[j] === 0) continue;
      if (spearman(a.values, other.values) >= t.identicalRho) {
        flags[i]!.push('IDENTICAL_PAIR');
        weights[i] = 0;
        lines[i]!.push(`Merged '${a.name}' into '${other.name}': Qloo returned the same NYC map for both.`);
        return;
      }
    }
  });

  anchors.forEach((a, i) => {
    if (weights[i] === 0) return;
    if (a.rhoReference >= t.densityOnlyRho) {
      flags[i]!.push('DENSITY_ONLY');
      weights[i] = weights[i]! * 0.5;
      lines[i]!.push(`Halved the weight of '${a.name}': its NYC map mostly tracks overall density.`);
    }
    if (a.cells < t.thinMinCells || a.overlap < t.thinMinOverlap) {
      flags[i]!.push('THIN');
      weights[i] = weights[i]! * (gridSize > 0 ? a.cells / gridSize : 0);
      lines[i]!.push(
        a.cells < t.thinMinCells
          ? `Down-weighted '${a.name}': thin signal on ${formatInt(a.cells)} of ${formatInt(gridSize)} city cells.`
          : `Down-weighted '${a.name}': its map overlaps only ${Math.round(a.overlap * 100)}% of the baseline's cells.`,
      );
    }
  });

  const infos = anchors.map(
    (a, i): AnchorMapInfo => ({
      anchorId: a.id,
      name: a.name,
      flags: flags[i]!,
      weight: round(weights[i]!, 4),
      coverage: round(gridSize > 0 ? a.cells / gridSize : 0, 4),
      cells: a.cells,
    }),
  );
  return { infos, weights, narration: lines.flat() };
}
