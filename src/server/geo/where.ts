import 'server-only';
import type { HeatmapData, Kiosk, LiftConfig, NtaInfo, NtaScore, WhereResult } from '@/shared/types';
import { aggregateNtas, combineLift, smoothLift } from './aggregate';
import { detectFlags } from './detect';
import { formatInt, plural, round } from './format';
import { gridIndex, projectToGrid } from './grid';
import { anchorMetric, computeAnchorLifts } from './lift';
import { countDefined, percentileRanks } from './rankz';
import type { AnchorMapInput, GridSpec } from './types';

/**
 * Display multiplier: `clamp(1.6^L̂, 0.3, 4)`. Lift is in z units (rank-normal SDs), so a 1-SD lift
 * reads "1.6×", 0 reads "1.0×", −1 SD reads "0.63×"; the clamp is reached at L̂ ≈ +2.95 / −2.56.
 * It is a monotone display device, not a ratio of visits or audiences.
 */
export const MULTIPLIER_BASE = 1.6;
export const MULTIPLIER_MIN = 0.3;
export const MULTIPLIER_MAX = 4;
/** The map heat layer keeps the strongest cells only (payload size). */
export const HEAT_MAX_CELLS = 400;
/** Eligible neighborhoods: residential with at least this many ad kiosks. */
export const ELIGIBLE_MIN_AD_KIOSKS = 2;
/** Anchors listed per neighborhood in `topAnchors`. */
export const TOP_ANCHORS = 3;

export function liftMultiplier(lift: number): number {
  if (Number.isNaN(lift)) return NaN;
  return Math.min(MULTIPLIER_MAX, Math.max(MULTIPLIER_MIN, MULTIPLIER_BASE ** lift));
}

export interface WhereInput {
  anchors: readonly AnchorMapInput[];
  /** Baseline maps for B1/B2 (first map) or B3 (panel); ignored for B0/B4. */
  baselines: readonly HeatmapData[];
  /** Qloo's generic "no data" map stored at calibration; enables the DEFAULT_MAP check. */
  defaultFingerprint?: HeatmapData | null;
  config: LiftConfig;
  grid: GridSpec;
  /** kiosks.json order; `grid.kioskCell[i]` is kiosk i's cell. */
  kiosks: readonly Kiosk[];
  ntas: readonly NtaInfo[];
}

export interface WhereOutput {
  result: WhereResult;
  /** Deterministic agent-log lines (fallbacks, flags, coverage). */
  narration: string[];
}

function byCode(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * WHERE stage, pure and deterministic: projection → rank-z → lift → flags → combine → smoothing (kiosks)
 * → neighborhood aggregation → Taste Fit Index, kiosk fit, display multiplier and heat layer.
 */
export function computeWhere(input: WhereInput): WhereOutput {
  const { grid } = input;
  const size = grid.cells.length;

  const lifted = computeAnchorLifts({ anchors: input.anchors, baselines: input.baselines, config: input.config, grid });
  const config = lifted.config;
  const fingerprint = input.defaultFingerprint
    ? projectToGrid(input.defaultFingerprint.cells, grid, anchorMetric(config)).values
    : null;
  const flagged = detectFlags({ anchors: lifted.anchors, config, gridSize: size, fingerprint });

  const included = lifted.anchors
    .map((a, k) => ({ id: a.id, lift: a.lift, weight: flagged.weights[k] ?? 0 }))
    .filter((a) => a.weight > 0);
  const L = combineLift(included, size);
  const S = smoothLift(L, grid);
  const aggregates = new Map(aggregateNtas({ L, grid, kappa: config.kappa, anchors: included }).map((r) => [r.code, r]));

  // Neighborhoods: eligible ones with a score, ranked by shrunk lift; fit index = percentile among them.
  const eligible = input.ntas.filter((n) => n.residential && n.adKiosks >= ELIGIBLE_MIN_AD_KIOSKS);
  const scored = eligible.flatMap((nta) => {
    const agg = aggregates.get(nta.code);
    return agg ? [{ nta, agg }] : [];
  });
  const fit = percentileRanks(scored.map((s) => s.agg.lift));
  const ntas: NtaScore[] = scored
    .map((s, k) => ({ ...s, fit: fit[k]! }))
    .sort((x, y) => y.agg.lift - x.agg.lift || byCode(x.nta.code, y.nta.code))
    .map(({ nta, agg, fit: pct }) => ({
      code: nta.code,
      name: nta.name,
      short: nta.short,
      boro: nta.boro,
      lift: round(agg.lift, 4),
      se: round(agg.se, 4),
      nEff: round(agg.nEff, 2),
      agreement: round(agg.agreement, 3),
      confidence: agg.confidence,
      fitIndex: Math.round(pct),
      multiplier: round(liftMultiplier(agg.lift), 2),
      topAnchors: agg.contributions
        .slice(0, TOP_ANCHORS)
        .map((c) => ({ anchorId: c.anchorId, contribution: round(c.contribution, 4) })),
      adKiosks: nta.adKiosks,
    }));

  // Kiosk fit: percentile of the smoothed lift at the kiosk's cell among kiosks with a defined value.
  const index = gridIndex(grid);
  const atKiosk = input.kiosks.map((kiosk, i) => {
    const cell = grid.kioskCell[i] ?? index.get(kiosk.gh6.toLowerCase()) ?? -1;
    return cell >= 0 && cell < size ? S[cell]! : NaN;
  });
  const kioskFit = Array.from(percentileRanks(atKiosk), (p) => (Number.isNaN(p) ? -1 : Math.round(p)));

  // Heat layer: the same smoothed surface as kiosk fit (dots and heat agree), above-baseline cells only.
  const hot: number[] = [];
  for (let g = 0; g < size; g++) if (S[g]! > 0) hot.push(g);
  hot.sort((a, b) => S[b]! - S[a]! || a - b);
  const heat = hot
    .slice(0, HEAT_MAX_CELLS)
    .map((g) => ({ gh: grid.cells[g]!, v: round(liftMultiplier(S[g]!), 2) }))
    .filter((h) => h.v > 1);

  const covered = countDefined(L);
  const narration = [...lifted.notes, ...flagged.narration];
  if (included.length === 0) {
    narration.push('No anchor map was usable, so no neighborhood could be scored.');
  } else {
    narration.push(
      `Scored ${plural(scored.length, 'neighborhood')} from ${plural(included.length, 'anchor map')} ` +
        `on ${formatInt(covered)} of ${formatInt(size)} city cells.`,
    );
    const unscored = eligible.length - scored.length;
    if (unscored > 0) narration.push(`${plural(unscored, 'neighborhood')} had no Qloo signal and stayed unranked.`);
  }

  const result: WhereResult = {
    config: { ...config, thresholds: { ...config.thresholds } },
    anchors: flagged.infos,
    ntas,
    kioskFit,
    heat,
    grid: { cells: size, covered },
  };
  return { result, narration };
}
