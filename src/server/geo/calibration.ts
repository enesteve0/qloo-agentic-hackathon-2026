import 'server-only';
import type { LiftConfig } from '@/shared/types';
import { spearman } from './rankz';

/**
 * Configuration used until calibration (ARCHITECTURE §17) replaces it: B4 compares each anchor with
 * the same response's popularity, so it costs no extra Qloo call. Frozen — spread it to override.
 */
export const DEFAULT_LIFT_CONFIG: LiftConfig = Object.freeze({
  metric: 'affinity',
  baseline: 'B4',
  form: 'difference',
  kappa: 1.5,
  thresholds: Object.freeze({
    defaultMapRho: 0.98,
    identicalRho: 0.999,
    densityOnlyRho: 0.99,
    thinMinCells: 300,
    thinMinOverlap: 0.5,
  }),
  experimental: false,
});

/** Extra Qloo calls each baseline needs; calibration ties go to the cheaper one. */
export const BASELINE_COST: Readonly<Record<LiftConfig['baseline'], number>> = Object.freeze({
  B0: 0,
  B4: 0,
  B1: 1,
  B2: 1,
  B3: 2,
});

export interface Face1Check {
  /** Borough where the anchor should over-index (e.g. Brooklyn Museum → Brooklyn). */
  expectedBoro: string;
  /** The anchor's neighborhoods ranked by lift under the trial configuration, best first. */
  ranking: readonly { code: string; boro: string }[];
}

export interface Face2Check {
  /** Lift per NTA code under the trial configuration. */
  lift: Readonly<Record<string, number>>;
  /** External target per NTA code (e.g. density-adjusted OSM store over-index). */
  target: Readonly<Record<string, number>>;
}

/** Everything the smoke script measured for one metric × baseline × form combination. */
export interface ConfigTrial {
  config: LiftConfig;
  face1: readonly Face1Check[];
  face2: readonly Face2Check[];
  /** Per-anchor cell lift maps (`computeAnchorLifts(...).anchors[i].lift`), for DISC. */
  anchorLifts: readonly ArrayLike<number>[];
  /** Per-anchor coverage share 0–1 (`cells / grid size`), for COV. */
  coverage: readonly number[];
}

export interface TrialScore {
  /** Mean share of each check's top-N neighborhoods in the expected borough. */
  FACE1: number | null;
  /** Mean Spearman ρ between lift and the external target over common neighborhoods. */
  FACE2: number | null;
  /** Mean of the available FACE1/FACE2. */
  FACE: number | null;
  /** 1 − mean pairwise Spearman ρ between anchor lift maps (null with fewer than 2 maps). */
  DISC: number | null;
  /** Mean anchor coverage. */
  COV: number | null;
  /** DISC ≥ discMin and COV ≥ covMin (a metric that could not be measured does not block). */
  passesGates: boolean;
}

export interface CalibrationOptions {
  topN: number;
  discMin: number;
  covMin: number;
  /** If no configuration beats this FACE, ship the most distinctive one as experimental. */
  faceFloor: number;
  /** FACE values within this distance of the best count as tied. */
  tieTolerance: number;
}

export const CALIBRATION_DEFAULTS: Readonly<CalibrationOptions> = Object.freeze({
  topN: 10,
  discMin: 0.3,
  covMin: 0.9,
  faceFloor: 0.2,
  tieTolerance: 0.01,
});

export interface CalibrationChoice {
  scores: TrialScore[];
  /** Trial indices, best first: gates, FACE, baseline cost, difference before residual, input order. */
  ranking: number[];
  chosen: number;
  /** The chosen trial's configuration with `experimental` set. */
  config: LiftConfig;
  reason: string;
}

function meanOf(xs: readonly (number | null)[]): number | null {
  const ok = xs.filter((x): x is number => x !== null && Number.isFinite(x));
  return ok.length ? ok.reduce((s, x) => s + x, 0) / ok.length : null;
}

function spearmanRecords(a: Readonly<Record<string, number>>, b: Readonly<Record<string, number>>): number {
  const xa: number[] = [];
  const xb: number[] = [];
  for (const key of Object.keys(a).sort()) {
    const va = a[key];
    const vb = b[key];
    if (typeof va === 'number' && typeof vb === 'number' && Number.isFinite(va) && Number.isFinite(vb)) {
      xa.push(va);
      xb.push(vb);
    }
  }
  return spearman(xa, xb);
}

/** 1 − mean pairwise Spearman ρ over co-covered cells; null when fewer than two comparable maps. */
export function distinctness(maps: readonly ArrayLike<number>[]): number | null {
  const rhos: number[] = [];
  for (let i = 0; i < maps.length; i++) {
    for (let j = i + 1; j < maps.length; j++) {
      const rho = spearman(maps[i]!, maps[j]!);
      if (Number.isFinite(rho)) rhos.push(rho);
    }
  }
  const m = meanOf(rhos);
  return m === null ? null : 1 - m;
}

export function scoreTrial(trial: ConfigTrial, options: Partial<CalibrationOptions> = {}): TrialScore {
  const o = { ...CALIBRATION_DEFAULTS, ...options };
  const FACE1 = meanOf(
    trial.face1.map((c) => {
      const top = c.ranking.slice(0, o.topN);
      return top.length ? top.filter((n) => n.boro === c.expectedBoro).length / top.length : null;
    }),
  );
  const FACE2 = meanOf(trial.face2.map((c) => spearmanRecords(c.lift, c.target)));
  const FACE = meanOf([FACE1, FACE2]);
  const DISC = distinctness(trial.anchorLifts);
  const COV = meanOf(trial.coverage);
  const passesGates = (DISC === null || DISC >= o.discMin) && (COV === null || COV >= o.covMin);
  return { FACE1, FACE2, FACE, DISC, COV, passesGates };
}

function label(c: LiftConfig): string {
  return `${c.metric} · ${c.baseline} · ${c.form}`;
}

function fmt(x: number | null): string {
  return x === null ? 'n/a' : x.toFixed(2);
}

/**
 * Chooses the lift configuration (ARCHITECTURE §17): among trials passing DISC ≥ 0.3 and COV ≥ 0.9,
 * the highest FACE wins and near-ties go to the cheaper baseline (then difference over residual).
 * If no FACE beats 0.2 — or no trial passes the gates — the result is labelled experimental, and
 * without any FACE above 0.2 the most distinctive (highest DISC) configuration is shipped.
 */
export function scoreConfigs(trials: readonly ConfigTrial[], options: Partial<CalibrationOptions> = {}): CalibrationChoice {
  if (!trials.length) throw new Error('scoreConfigs needs at least one trial');
  const o = { ...CALIBRATION_DEFAULTS, ...options };
  const scores = trials.map((t) => scoreTrial(t, o));
  const face = (i: number) => scores[i]!.FACE ?? -Infinity;
  const disc = (i: number) => scores[i]!.DISC ?? -Infinity;
  const desc = (x: number, y: number) => (x > y ? -1 : x < y ? 1 : 0);
  const cheaper = (a: number, b: number) => {
    const ca = trials[a]!.config;
    const cb = trials[b]!.config;
    const form = (c: LiftConfig) => (c.form === 'difference' ? 0 : 1);
    return BASELINE_COST[ca.baseline] - BASELINE_COST[cb.baseline] || form(ca) - form(cb) || a - b;
  };

  const all = trials.map((_, i) => i);
  const ranking = [...all].sort(
    (a, b) => Number(scores[b]!.passesGates) - Number(scores[a]!.passesGates) || desc(face(a), face(b)) || cheaper(a, b),
  );
  const gated = all.filter((i) => scores[i]!.passesGates);
  const pool = gated.length ? gated : all;
  const best = Math.max(...pool.map(face));

  let chosen: number;
  let experimental: boolean;
  let reason: string;
  if (best > o.faceFloor) {
    chosen = pool.filter((i) => face(i) >= best - o.tieTolerance).sort(cheaper)[0]!;
    experimental = gated.length === 0;
    const s = scores[chosen]!;
    reason =
      `${label(trials[chosen]!.config)}: FACE ${fmt(s.FACE)} (FACE1 ${fmt(s.FACE1)}, FACE2 ${fmt(s.FACE2)}), ` +
      `DISC ${fmt(s.DISC)}, COV ${fmt(s.COV)}.` +
      (experimental ? ' No configuration passed the DISC/COV gates, so it ships as experimental.' : '');
  } else {
    chosen = [...pool].sort((a, b) => desc(disc(a), disc(b)) || cheaper(a, b))[0]!;
    experimental = true;
    reason =
      `Every configuration scored FACE ≤ ${o.faceFloor}; shipping the most distinctive one ` +
      `(${label(trials[chosen]!.config)}, DISC ${fmt(scores[chosen]!.DISC)}) as experimental.`;
  }

  const picked = trials[chosen]!.config;
  return {
    scores,
    ranking,
    chosen,
    config: { ...picked, thresholds: { ...picked.thresholds }, experimental },
    reason,
  };
}
