/**
 * Qloo arm of the validation backtest: for one chain, the same calls the app's WHERE stage makes
 * (src/server/agent/deps-live.ts `where`): /search through `resolveAnchors`, one NYC heatmap through the
 * production client, then `computeWhere` with the calibrated lift configuration. Lift values stay in memory;
 * the backtest publishes correlations only.
 */
import { computeWhere, type GridSpec } from '@/server/geo';
import { ELIGIBLE_MIN_AD_KIOSKS } from '@/server/geo/where';
import { normalizeName, resolveAnchors, type QlooApi, type QlooErrorCode, type WktLocation } from '@/server/qloo';
import type { AnchorFlag, Candidate, HeatmapData, Kiosk, LiftConfig, NtaInfo, ResolutionOutcome } from '@/shared/types';
import type { BacktestBrand } from './brands';

/** Everything `computeWhere` needs besides the brand's own map, prepared once per run. */
export interface LiftSetup {
  location: WktLocation | { query: string };
  config: LiftConfig;
  /** Baseline maps for B1–B3 (empty under B0/B4). */
  baselines: readonly HeatmapData[];
  fingerprint: HeatmapData | null;
  grid: GridSpec;
  kiosks: readonly Kiosk[];
  ntas: readonly NtaInfo[];
}

/** The location form the app's WHERE stage uses for a calibration record (the same function, not a copy). */
export { heatmapLocation } from '@/server/agent/deps-live';

export type MatchKind = 'exact' | 'semantic' | 'alias';

/**
 * The backtest cannot ask a person, so an ambiguous search is settled by a fixed rule: the first candidate (in
 * Qloo's order) whose normalized name equals the query, the brand name or one of its aliases; otherwise none.
 */
export function chooseCandidate(outcome: ResolutionOutcome, brand: BacktestBrand): { candidate: Candidate; match: MatchKind } | null {
  if (outcome.status === 'resolved') return { candidate: outcome.selected, match: outcome.match === 'exact' ? 'exact' : 'semantic' };
  if (outcome.status === 'ambiguous') {
    const names = new Set([brand.qloo.query, brand.name, ...brand.qloo.aliases].map(normalizeName));
    const hit = outcome.candidates.find((c) => names.has(normalizeName(c.name)));
    return hit ? { candidate: hit, match: 'alias' } : null;
  }
  return null;
}

export type ArmStatus = 'ok' | 'not_found' | 'ambiguous' | 'default_map' | 'no_signal' | 'failed';

export interface BrandLift {
  id: string;
  status: ArmStatus;
  match: MatchKind | null;
  failure: { code: QlooErrorCode; message: string } | null;
  /** Lift-engine flags on the brand's map (DEFAULT_MAP, DENSITY_ONLY, THIN). */
  flags: AnchorFlag[];
  /** Shrunk lift L̂ per NTA as the app ranks them (residential NTAs with ≥2 ad screens). */
  eligible: Record<string, number>;
  /** The same engine and response with eligibility widened to every residential NTA. */
  residential: Record<string, number>;
}

/** Codes after which the run must stop (401, 429, guards, cancelled): continuing would only burn quota. */
export const STOP_CODES: ReadonlySet<QlooErrorCode> = new Set<QlooErrorCode>([
  'AUTH',
  'QUOTA_EXHAUSTED',
  'RATE_LIMITED',
  'BUDGET_GUARD',
  'BUSY',
  'TYPE_UNSUPPORTED',
  'ABORTED',
  'DISABLED',
  'CACHE_ONLY',
]);

const liftByCode = (ntas: readonly { code: string; lift: number }[]) => Object.fromEntries(ntas.map((n) => [n.code, n.lift]));

/** Resolves one chain and maps its NYC taste lift: at most one /search and one heatmap call. */
export async function brandLift(api: QlooApi, brand: BacktestBrand, setup: LiftSetup): Promise<BrandLift> {
  const result: BrandLift = { id: brand.id, status: 'ok', match: null, failure: null, flags: [], eligible: {}, residential: {} };
  const resolved = await resolveAnchors(api, [{ name: brand.qloo.query, type: brand.qloo.type, searchHint: brand.qloo.hint }]);
  const failure = resolved.failures[0];
  if (failure) return { ...result, status: 'failed', failure: { code: failure.code, message: failure.message } };
  const outcome = resolved.outcomes[0]!;
  const chosen = chooseCandidate(outcome, brand);
  if (!chosen) return { ...result, status: outcome.status === 'not_found' ? 'not_found' : 'ambiguous' };
  result.match = chosen.match;

  const map = await api.heatmap({ signals: { entities: [chosen.candidate.id] }, location: setup.location, purpose: 'backtest' });
  if (!map.ok) return { ...result, status: 'failed', failure: { code: map.code, message: map.message } };

  const common = {
    anchors: [{ id: chosen.candidate.id, name: brand.name, heatmap: map.data, userWeight: 1 }],
    baselines: setup.baselines,
    defaultFingerprint: setup.fingerprint,
    config: setup.config,
    grid: setup.grid,
    kiosks: setup.kiosks,
  };
  const asApp = computeWhere({ ...common, ntas: setup.ntas }).result;
  const widened = computeWhere({
    ...common,
    ntas: setup.ntas.map((n) => (n.residential && n.adKiosks < ELIGIBLE_MIN_AD_KIOSKS ? { ...n, adKiosks: ELIGIBLE_MIN_AD_KIOSKS } : n)),
  }).result;
  result.flags = asApp.anchors[0]?.flags ?? [];
  if (result.flags.includes('DEFAULT_MAP')) return { ...result, status: 'default_map' };
  if (asApp.ntas.length === 0) return { ...result, status: 'no_signal' };
  return { ...result, eligible: liftByCode(asApp.ntas), residential: liftByCode(widened.ntas) };
}
