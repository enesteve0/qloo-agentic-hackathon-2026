/**
 * Validation report assembly (pure). The published file (src/content/validation.json) carries summary
 * statistics only: per-chain ρ, n and p with their baselines, panel statistics, method and caveats. Lift values
 * cannot reach it (BrandOutcome has no lift fields), and OSM data leaves only as city-wide store counts.
 */
import type { BacktestBrand } from './brands';
import type { BrandLift } from './qloo-arm';
import type { BrandSeries, NullCalibration, UniverseAnalysis } from './stats';
import { ODBL_NOTICE, type BrandTarget, type TargetsFile } from './targets';

export const METHOD_VERSION = 'stoop-backtest/1';
export const PERMUTATIONS = 1_000;
export const BOOTSTRAP = 10_000;
export const SEEDS = Object.freeze({ permutation: 20_261_026, bootstrap: 20_261_027, specificity: 20_261_028 });
/** A chain enters a universe only with this many stores inside it (fewer leaves a target that is mostly density). */
export const MIN_STORES_COMPARED = 10;

export interface PanelEntry {
  brand: BacktestBrand;
  target: BrandTarget;
}

/** What the report may know about a chain's Qloo arm: never its lift values. */
export type BrandOutcome = Pick<BrandLift, 'status' | 'match' | 'flags' | 'failure'>;

export interface PreparedUniverse {
  series: BrandSeries[];
  /** Stores of each chain inside the universe (chains with a usable map). */
  compared: Map<string, number>;
  /** Chains left out of this universe, with the reason. */
  skipped: Map<string, string>;
}

/** Aligns each chain's target and lift with `codes`; chains with too few stores inside the universe are skipped. */
export function prepareUniverse(
  codes: readonly string[],
  panel: readonly PanelEntry[],
  lifts: ReadonlyMap<string, Pick<BrandLift, 'status'> & { lift: Readonly<Record<string, number>> }>,
  minStores: number = MIN_STORES_COMPARED,
): PreparedUniverse {
  const series: BrandSeries[] = [];
  const compared = new Map<string, number>();
  const skipped = new Map<string, string>();
  for (const { brand, target } of panel) {
    const arm = lifts.get(brand.id);
    if (!arm || arm.status !== 'ok') continue;
    const stores = codes.reduce((s, c) => s + (target.stores[c] ?? 0), 0);
    compared.set(brand.id, stores);
    if (stores < minStores) {
      skipped.set(brand.id, `${stores} stores in these neighborhoods (minimum ${minStores})`);
      continue;
    }
    series.push({
      id: brand.id,
      target: Float64Array.from(codes, (c) => target.target[c] ?? NaN),
      lift: Float64Array.from(codes, (c) => arm.lift[c] ?? NaN),
    });
  }
  return { series, compared, skipped };
}

export interface UniverseResult {
  description: string;
  neighborhoods: number;
  analysis: UniverseAnalysis;
  compared: ReadonlyMap<string, number>;
  skipped: ReadonlyMap<string, string>;
}

export interface ReportInput {
  synthetic: boolean;
  generatedAt: string;
  targets: Pick<TargetsFile, 'method' | 'builtAt' | 'poi' | 'brands' | 'unverified'>;
  panel: readonly PanelEntry[];
  outcomes: ReadonlyMap<string, BrandOutcome>;
  universes: { primary: UniverseResult; sensitivity: UniverseResult };
  qloo: { config: string; location: string; calibratedAt: string | null; fresh: number; cached: number };
  /** Synthetic rehearsals only: false-positive rate of the within-borough test on store-blind maps. */
  calibration?: NullCalibration | null;
}

const r3 = (x: number) => (Number.isFinite(x) ? Math.round(x * 1000) / 1000 : null);
const r4 = (x: number) => (Number.isFinite(x) ? Math.round(x * 10_000) / 10_000 : null);

const STATUS_TEXT: Record<BrandLift['status'], string | null> = {
  ok: null,
  not_found: 'Qloo search found no brand entity',
  ambiguous: 'Qloo search was ambiguous and no candidate matched the name or an alias',
  default_map: 'Qloo returned its generic default map (no brand-specific NYC signal)',
  no_signal: 'no neighborhood had Qloo signal',
  failed: 'Qloo call failed',
};

function universeBlock(u: UniverseResult, names: ReadonlyMap<string, string>) {
  const s = u.analysis.summary;
  const sp = u.analysis.specificity;
  return {
    description: u.description,
    neighborhoods: u.neighborhoods,
    chains: s?.brands ?? 0,
    medianRho: s ? r3(s.medianRho) : null,
    ci95: s ? [r3(s.ci[0]), r3(s.ci[1])] : null,
    pMedian: s ? r4(s.pMedian) : null,
    meanRho: s ? r3(s.meanRho) : null,
    positive: s?.positive ?? 0,
    pPositive: s ? r4(s.pPositive) : null,
    significant05: s?.significant ?? 0,
    specificity: sp ? { meanOwnRho: r3(sp.meanOwn), meanOtherRho: r3(sp.meanOther), ownMapBest: sp.ownBest, p: r4(sp.p) } : null,
    skipped: [...u.skipped.entries()].map(([id, reason]) => ({ name: names.get(id) ?? id, reason })),
  };
}

function brandCell(u: UniverseResult, id: string) {
  const reason = u.skipped.get(id);
  if (reason) return { storesCompared: u.compared.get(id) ?? 0, skipped: reason };
  const r = u.analysis.perBrand.find((x) => x.id === id);
  if (!r) return null;
  return {
    storesCompared: u.compared.get(id) ?? 0,
    n: r.n,
    rho: r3(r.rho),
    p: r4(r.p),
    nullRho: r3(r.nullMean),
    otherMapsRho: r.otherMaps === null ? null : r3(r.otherMaps),
    ownMapRank: r.ownRank,
    placeboP: r.placeboP === null ? null : r4(r.placeboP),
  };
}

export function buildReport(input: ReportInput) {
  const { targets, panel, outcomes, universes } = input;
  const names = new Map(panel.map((p) => [p.brand.id, p.brand.name]));
  const bases = [targets.poi.osmBase, ...panel.map((p) => p.target.osmBase)].filter((x): x is string => !!x).sort();
  const snapshot = bases.length === 0 ? null : bases[0] === bases.at(-1) ? bases[0]! : `${bases[0]} – ${bases.at(-1)}`;
  const n = (x: number) => x.toLocaleString('en-US');
  return {
    kind: 'stoop-validation-backtest' as const,
    methodVersion: METHOD_VERSION,
    synthetic: input.synthetic,
    label: input.synthetic ? 'SYNTHETIC: maps from the mock Qloo transport, not from Qloo. Pipeline rehearsal only; says nothing about Qloo.' : null,
    generatedAt: input.generatedAt,
    notice: ODBL_NOTICE,
    question: 'Do Qloo taste maps rank NYC neighborhoods the way real chain stores over-index?',
    method: {
      stores:
        'OpenStreetMap objects tagged brand:wikidata=<QID> inside New York City (Wikidata Q60), via Overpass; active stores only ' +
        `(ATMs, lockers, parking and vacant premises dropped); a building outline within ${targets.method.dedupeMeters} m of a point of the ` +
        `same brand counts once; a chain needs ≥${targets.method.minStores} stores. Stores in parks, airports and cemeteries ` +
        '(non-residential NTAs) are dropped.',
      target:
        'Per 2020 NTA: empirical-Bayes (Poisson–Gamma; Marshall 1991) estimate of the chain’s share of stores divided by the NTA’s share ' +
        'of commercial points of interest (OSM restaurants, cafes, fast food, bars, pubs and shops, plus the chain’s own stores). ' +
        '1 = as many stores as commercial density predicts. The prior variance is the moment estimate floored at ' +
        `${targets.method.minPriorVariance} (prior SD ≥ ${Math.sqrt(targets.method.minPriorVariance)}): for chains with fewer stores than ` +
        'neighborhoods the moment estimate often truncates to complete pooling, which would make the target constant.',
      lift:
        `Qloo NYC heatmap of the chain’s brand entity, through Stoop’s production Qloo client and lift engine (computeWhere): ` +
        `${input.qloo.config}, ${input.qloo.location}; the shrunk neighborhood lift L̂ the app ranks by.`,
      statistic: 'Spearman ρ between lift and target across neighborhoods, per chain.',
      null:
        `Targets shuffled within borough, ${n(PERMUTATIONS)} draws (seed ${SEEDS.permutation}), one shared draw for every chain; ` +
        'one-sided p = (1 + #{null ρ ≥ observed}) / (1 + draws). The panel median and the count of chains with ρ > 0 are tested ' +
        'against the same draws. nullRho is the mean ρ under the shuffle: what borough-level structure alone produces, so p can be ' +
        'small while ρ is near 0 (and the reverse).',
      interval: `Median ρ across chains with a brand-level percentile bootstrap 95% interval (${n(BOOTSTRAP)} resamples, seed ${SEEDS.bootstrap}).`,
      specificity:
        `Placebo: every chain’s map against every chain’s target. Maps reassigned to chains at random ${n(PERMUTATIONS)} times ` +
        `(seed ${SEEDS.specificity}) test whether a chain’s own map predicts its stores better than other chains’ maps do. ` +
        'otherMapsRho is the mean ρ of the other chains’ maps against a chain’s stores; ownMapRank 1 means its own map is the best predictor; ' +
        'placeboP = (1 + #{other maps with ρ ≥ own}) / maps. Other chains’ maps share the own map’s spatial smoothness, so the placebo ' +
        'comparisons stay valid under spatial autocorrelation, unlike the within-borough p.',
      minStoresCompared: MIN_STORES_COMPARED,
    },
    sources: {
      osm: {
        snapshot,
        extractedAt: targets.builtAt,
        query: 'nwr["brand:wikidata"="<QID>"](area["wikidata"="Q60"]); out center;',
      },
      neighborhoods: 'NYC Open Data 9nt8-h7nd (2020 Neighborhood Tabulation Areas)',
      qloo: {
        transport: input.synthetic ? 'synthetic mock transport' : 'direct REST',
        calls: { fresh: input.qloo.fresh, cached: input.qloo.cached },
        calibratedAt: input.qloo.calibratedAt,
      },
    },
    primary: universeBlock(universes.primary, names),
    sensitivity: universeBlock(universes.sensitivity, names),
    ...(input.calibration
      ? {
          calibration: {
            description: 'Within-borough test on store-blind synthetic maps: every chain’s map against every other chain’s stores.',
            pairs: input.calibration.pairs,
            alpha: input.calibration.alpha,
            falsePositiveRate: r3(input.calibration.falsePositiveRate),
            sdRho: r3(input.calibration.sdRho),
            sdExchangeable: r3(input.calibration.sdExchangeable),
          },
        }
      : {}),
    brands: panel.map(({ brand, target }) => {
      const o = outcomes.get(brand.id);
      const status = o?.status ?? 'failed';
      const text = STATUS_TEXT[status];
      return {
        name: brand.name,
        qid: brand.qid,
        category: brand.category,
        stores: target.counts.stores,
        status,
        reason: o ? (text ? `${text}${o.failure ? ` (${o.failure.code})` : ''}` : null) : 'not run',
        match: o?.match ?? null,
        flags: o?.flags ?? [],
        primary: status === 'ok' ? brandCell(universes.primary, brand.id) : null,
        sensitivity: status === 'ok' ? brandCell(universes.sensitivity, brand.id) : null,
      };
    }),
    excluded: [
      ...targets.brands.filter((t) => t.status === 'excluded').map((t) => ({ name: t.name, qid: t.qid, reason: t.reason })),
      ...(targets.unverified ?? []).map((u) => ({ name: u.name, qid: u.qid, reason: `Wikidata check failed: ${u.reason}` })),
    ],
    caveats: [
      'OSM completeness: brand tags are maintained by volunteers; missing, stale or closed stores add noise, and mapping is likely denser in Manhattan.',
      'Single snapshot: one OSM extract and one set of Qloo responses; store networks reflect years of rent, traffic and strategy, not taste alone.',
      'Spatial autocorrelation: neighboring NTAs are not independent, and the within-borough shuffle removes borough-level structure only. On synthetic, ' +
        'store-blind maps (pnpm backtest:run --mock) it rejected unrelated map–store pairs more than twice as often as its nominal 5%, so the ' +
        'within-borough p, the panel median and count tests are optimistic. The placebo comparisons (specificity, placeboP) are the robust test.',
      'Shared patterns: NTAs without stores are ordered by commercial density, so a map that merely follows density can correlate with a chain’s ' +
        'target; only the placebo comparisons ask whether a chain’s own map beats other chains’ maps. They are conservative when chains share ' +
        'audiences (another coffee chain’s map may genuinely predict a coffee chain’s stores).',
      'The panel is chosen, not sampled: the bootstrap interval describes variation across these chains only. Per-chain p-values are unadjusted; the panel tests account for multiplicity.',
      'Stores are not audiences: this is an external plausibility check of taste maps, not ground truth, and it says nothing about any individual.',
    ],
  };
}

export type ValidationReport = ReturnType<typeof buildReport>;
