import 'server-only';
import type { HeatmapData, LiftConfig } from '@/shared/types';
import { projectToGrid } from './grid';
import { countDefined, pearson, rankZ, spearman } from './rankz';
import type { AnchorMapInput, GridSpec, HeatMetric } from './types';

/** One anchor's projected map and its lift over the baseline (ARCHITECTURE §6 steps 1–4). */
export interface AnchorLift {
  id: string;
  name: string;
  /** Sanitized user weight (≥ 0). */
  userWeight: number;
  /** The anchor's own projected metric (NaN = no data); compared across anchors and with the default map. */
  values: Float64Array;
  /** What the anchor is compared with: the baseline map (B1–B4) or, under B0, its own popularity. */
  reference: Float64Array | null;
  /** Spearman ρ(values, reference) over co-covered cells; NaN when there is no reference. */
  rhoReference: number;
  /** Per-cell lift ℓ_a in z units; NaN where the anchor and the baseline are not co-covered. */
  lift: Float64Array;
  /** Cells covered by the anchor map. */
  covered: number;
  /** Cells with a defined lift. */
  cells: number;
  /** Share of the baseline's covered cells that also have a lift (always 1 under B0). */
  overlap: number;
}

export interface LiftInput {
  anchors: readonly AnchorMapInput[];
  /** B1/B2: the first map is used; B3: every map is a panel member; B0/B4: ignored. */
  baselines: readonly HeatmapData[];
  config: LiftConfig;
  grid: GridSpec;
}

export interface LiftOutput {
  anchors: AnchorLift[];
  /** The configuration actually applied (B1–B3 fall back to B4 when no usable baseline map was supplied). */
  config: LiftConfig;
  /** Plain-language notes about fallbacks, for the agent log. */
  notes: string[];
}

/** Heatmap field that stands for the anchor: B0 reads affinity_rank directly, otherwise config.metric. */
export function anchorMetric(config: LiftConfig): HeatMetric {
  if (config.baseline === 'B0') return 'rank';
  return config.metric === 'affinity' ? 'aff' : 'rank';
}

/** Cell-wise mean of each map's rank-normal scores over the maps covering the cell (B3 panel). */
export function panelMeanZ(maps: readonly Float64Array[]): Float64Array {
  const size = maps[0]?.length ?? 0;
  const sum = new Float64Array(size);
  const count = new Uint16Array(size);
  for (const map of maps) {
    const z = rankZ(map);
    for (let i = 0; i < size; i++) {
      const v = z[i]!;
      if (!Number.isNaN(v)) {
        sum[i] = sum[i]! + v;
        count[i] = count[i]! + 1;
      }
    }
  }
  return sum.map((s, i) => (count[i] ? s / count[i]! : NaN));
}

/**
 * Lift of `values` over `reference` on their co-covered cells. Both maps are re-ranked on that common
 * support so each is standard normal on the same cells (identical to ranking each map once when
 * coverage matches, as it does for B4). `difference`: z_a − z_b. `residual`: (z_a − ρ̂·z_b)/sd with
 * ρ̂ = Pearson(z_a, z_b) and sd the residuals' SD; a map identical to its baseline gets 0 everywhere.
 */
export function liftOver(values: Float64Array, reference: Float64Array, form: LiftConfig['form']): Float64Array {
  const size = values.length;
  const a = new Float64Array(size);
  const b = new Float64Array(size);
  for (let i = 0; i < size; i++) {
    const va = values[i]!;
    const vb = reference[i]!;
    const both = !Number.isNaN(va) && !Number.isNaN(vb);
    a[i] = both ? va : NaN;
    b[i] = both ? vb : NaN;
  }
  const za = rankZ(a);
  const zb = rankZ(b);
  if (form === 'difference') return za.map((v, i) => v - zb[i]!);

  const rhoHat = pearson(za, zb);
  const rho = Number.isFinite(rhoHat) ? rhoHat : 0;
  const out = za.map((v, i) => v - rho * zb[i]!);
  let n = 0;
  let mean = 0;
  for (const v of out) {
    if (!Number.isNaN(v)) {
      n++;
      mean += v;
    }
  }
  mean = n ? mean / n : 0;
  let ss = 0;
  for (const v of out) if (!Number.isNaN(v)) ss += (v - mean) ** 2;
  const sd = n ? Math.sqrt(ss / n) : 0;
  return out.map((v) => (Number.isNaN(v) ? NaN : sd > 1e-12 ? v / sd : 0));
}

function sanitizeWeight(w: number): number {
  return Number.isFinite(w) && w > 0 ? w : 0;
}

/**
 * Projects every anchor (and the baseline) onto G and computes per-anchor lift ℓ_a:
 * - B0: ℓ_a = z(affinity_rank) — no subtraction; `form` does not apply.
 * - B1/B2: subtract the supplied baseline map (same metric as the anchors).
 * - B3: subtract the mean rank-normal score of the supplied panel maps.
 * - B4: subtract the same response's popularity.
 */
export function computeAnchorLifts(input: LiftInput): LiftOutput {
  const { grid } = input;
  const notes: string[] = [];
  let config = input.config;
  const metric = anchorMetric(config);

  let shared: Float64Array | null = null;
  if (config.baseline === 'B1' || config.baseline === 'B2' || config.baseline === 'B3') {
    const maps = input.baselines.map((b) => projectToGrid(b.cells, grid, metric).values);
    if (config.baseline === 'B3') shared = maps.length ? panelMeanZ(maps) : null;
    else shared = maps[0] ?? null;
    if (!shared || countDefined(shared) === 0) {
      notes.push(`No ${config.baseline} baseline map was available, so each anchor was compared with its own popularity map (B4).`);
      config = { ...config, baseline: 'B4' };
      shared = null;
    }
  }

  const anchors = input.anchors.map((anchor): AnchorLift => {
    const values = projectToGrid(anchor.heatmap.cells, grid, metric).values;
    const reference = shared ?? projectToGrid(anchor.heatmap.cells, grid, 'pop').values;
    const referenceCovered = countDefined(reference);
    const usable = referenceCovered > 0 ? reference : null;

    let lift: Float64Array;
    if (config.baseline === 'B0') {
      lift = rankZ(values);
    } else if (usable) {
      lift = liftOver(values, usable, config.form);
    } else {
      lift = new Float64Array(values.length).fill(NaN);
      notes.push(`Could not compare '${anchor.name}' with the NYC baseline: its map came back without popularity values.`);
    }
    const cells = countDefined(lift);
    return {
      id: anchor.id,
      name: anchor.name,
      userWeight: sanitizeWeight(anchor.userWeight),
      values,
      reference: usable,
      rhoReference: usable ? spearman(values, usable) : NaN,
      lift,
      covered: countDefined(values),
      cells,
      overlap: config.baseline === 'B0' ? 1 : referenceCovered > 0 ? cells / referenceCovered : 0,
    };
  });

  return { anchors, config, notes };
}
