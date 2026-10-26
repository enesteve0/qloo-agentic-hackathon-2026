import 'server-only';
import type { HeatmapData } from '@/shared/types';

/**
 * Analysis grid G (geohash precision 6), built by scripts/build-geo.ts into src/data/grid-gh6.json.
 * A cell's position in `cells` is its index in every per-cell array of this module.
 */
export interface GridSpec {
  precision: 6;
  /** gh6 geohashes (lower case). */
  cells: string[];
  /** Per 2020 NTA code: `[cellIndex, landWeight]` pairs (w_gj from gh7 sub-cells). */
  ntaWeights: Record<string, [cellIndex: number, weight: number][]>;
  /** Kiosk index (kiosks.json order) → cell index; -1 when the kiosk lies outside G. */
  kioskCell: number[];
}

/** Normalized heatmap fields: `aff` = affinity, `rank` = affinity_rank, `pop` = popularity. */
export type HeatMetric = 'aff' | 'rank' | 'pop';

export interface GridProjection {
  /** One value per grid cell; NaN = no data (NA). */
  values: Float64Array;
  /** Cells with a value. */
  covered: number;
  /** Share of G with a value (0–1). */
  coverage: number;
  /** How covered cells were filled: own gh6 cell, mean of gh7 children, or gh5 parent. */
  sources: { exact: number; children: number; parent: number };
}

/** One included anchor and its NYC heatmap, as handed to the lift engine. */
export interface AnchorMapInput {
  id: string;
  name: string;
  heatmap: HeatmapData;
  /** Owner/planner weight (≥ 0; non-finite or negative values count as 0). */
  userWeight: number;
}
