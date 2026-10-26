/**
 * Validation backtest: Qloo arm and statistics (docs/ARCHITECTURE.md §18). Needs data/raw/osm/targets.json
 * from `pnpm backtest:osm`.
 *
 *   pnpm backtest:run --dry-run      print the planned Qloo calls (≈2 per chain); no network, no key
 *   pnpm backtest:run --mock         rehearse end to end on the synthetic transport (QLOO_MODE=mock, in-memory
 *                                    KV); writes data/raw/backtest/validation.SYNTHETIC.json, never src/content
 *   pnpm backtest:run --confirm [--force]
 *                                    live (needs QLOO_MODE=live and QLOO_API_KEY): sequential calls through the
 *                                    production client, no retries, stops on any 401 or 429; writes
 *                                    src/content/validation.json with summary statistics only
 *
 * Lift values and Qloo responses never leave memory, and the key is never printed. --force lets the script
 * spend below the phase floor (the absolute floor still applies).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import path from 'node:path';
import type { CalibrationRecord } from '@/server/agent/deps-live';
import type { QlooErrorCode } from '@/server/qloo';
import type { HeatmapData } from '@/shared/types';
import { BRANDS, type BacktestBrand } from './brands';
import type { BrandLift, LiftSetup } from './qloo-arm';
import type { PanelEntry, UniverseResult } from './report';
import { TARGET_METHOD, type TargetsFile } from './targets';

// Server modules begin with `import 'server-only'`, which throws outside a React Server bundle. This is trusted
// tooling: resolve the marker to an empty module before any of them loads (as scripts/qloo-smoke.ts does).
registerHooks({
  resolve: (specifier, context, nextResolve) =>
    specifier === 'server-only' ? { url: 'data:text/javascript,', shortCircuit: true } : nextResolve(specifier, context),
});

const ROOT = path.resolve(import.meta.dirname, '../..');
const TARGETS_FILE = path.join(ROOT, 'data/raw/osm/targets.json');
const OUT_LIVE = path.join(ROOT, 'src/content/validation.json');
const OUT_SYNTHETIC = path.join(ROOT, 'data/raw/backtest/validation.SYNTHETIC.json');
/** Pause between chains (the client also keeps ≥500 ms between call starts). */
const BRAND_GAP_MS = 600;

const flags = new Set(process.argv.slice(2));
const modes = (['--dry-run', '--mock', '--confirm'] as const).filter((f) => flags.has(f));
// Exactly one mode: `--mock --confirm` must never quietly turn a rehearsal into live calls.
const MODE = modes.length !== 1 ? null : modes[0] === '--confirm' ? 'live' : modes[0] === '--mock' ? 'mock' : 'dry';
const FORCE = flags.has('--force');
if (!MODE) {
  console.log('Usage: pnpm backtest:run --dry-run | --mock | --confirm [--force]   (exactly one mode)');
  process.exit(1);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const fmt = (x: number | null | undefined, d = 3) => (x === null || x === undefined || !Number.isFinite(x) ? 'n/a' : x.toFixed(d));
const hardStop = (planned: number) => planned + 6;
/** Dry-run stand-in for an entity id (passes the id allow-list: no spaces or commas). */
const placeholder = (b: BacktestBrand) => `<${b.name.replace(/[\s,]+/g, '_')}>`;

function readTargets(): TargetsFile | null {
  if (!existsSync(TARGETS_FILE)) return null;
  const t = JSON.parse(readFileSync(TARGETS_FILE, 'utf8')) as TargetsFile;
  if (t.kind !== 'stoop-backtest-targets') throw new Error(`${TARGETS_FILE} is not a targets file`);
  if (t.method.version !== TARGET_METHOD.version) {
    throw new Error(`targets.json was built with ${t.method.version}, not ${TARGET_METHOD.version}: rebuild with pnpm backtest:osm (cached, no network).`);
  }
  return t;
}

const targets = readTargets();
const brandById = new Map(BRANDS.map((b) => [b.id, b]));
const panel: PanelEntry[] = (targets?.brands ?? [])
  .filter((t) => t.status === 'ok')
  .flatMap((t) => {
    const brand = brandById.get(t.id);
    return brand ? [{ brand, target: t }] : [];
  });

// ---------------------------------------------------------------------------------------------
// Dry run
// ---------------------------------------------------------------------------------------------

if (MODE === 'dry') {
  const params = await import('@/server/qloo/params');
  const { nycStudyWkt } = await import('@/server/data');
  const { heatmapLocation } = await import('./qloo-arm');
  const location = heatmapLocation({ location: 'wkt' }, nycStudyWkt);
  const list = targets ? panel.map((p) => p.brand) : [...BRANDS];
  console.log('Stoop · validation backtest — DRY RUN (no network, no key needed)\n');
  console.log(
    targets
      ? `Panel: ${panel.length} chains with ≥${targets.method.minStores} NYC stores on OSM (targets built ${targets.builtAt}).`
      : 'data/raw/osm/targets.json is missing (run pnpm backtest:osm): listing every candidate; the ≥15-store rule will drop some.',
  );
  console.log('Lift configuration: KV cfg:calibration when present, else affinity · B4 · difference on the NYC study polygon (shown).\n');
  list.forEach((b, i) => {
    const search = params.buildSearch({ query: b.qloo.query, type: b.qloo.type, take: 5 });
    const heat = params.buildHeatmap({ signals: { entities: [placeholder(b)] }, location });
    console.log(`${String(i + 1).padStart(2)}  ${b.name}`);
    console.log(`    GET /search?${params.redactQuery(search)}`);
    console.log(`    GET /v2/insights?${params.redactQuery(heat, 'wkt' in location ? location.label : undefined)}`);
  });
  const planned = list.length * 2;
  console.log(`\n${planned} planned calls (${list.length} chains × /search + heatmap), sequential, no retries; hard stop ${hardStop(planned)} attempts.`);
  console.log('A calibration that chose baseline B1–B3 adds 1–2 baseline maps, a stored default-map fingerprint 1 more (fetched once, usually cached).');
  console.log('Resolutions and heatmaps already in the Qloo cache cost nothing. --mock rehearses on synthetic data; --confirm runs live.');
  process.exit(0);
}

if (!targets) {
  console.error('data/raw/osm/targets.json is missing: run pnpm backtest:osm first.');
  process.exit(1);
}
if (panel.length === 0) {
  console.error('No chain in targets.json passed the OSM panel rule; nothing to test.');
  process.exit(1);
}

// ---------------------------------------------------------------------------------------------
// Environment: synthetic rehearsal or live
// ---------------------------------------------------------------------------------------------

if (MODE === 'mock') {
  // Synthetic data must never reach the shared Redis or pass as live: force the mock transport and memory KV.
  process.env.QLOO_MODE = 'mock';
  process.env.REDIS_DRIVER = 'memory';
} else {
  for (const file of ['.env.local', '.env']) {
    const p = path.join(ROOT, file);
    if (existsSync(p)) process.loadEnvFile(p);
  }
  if (process.env.QLOO_MODE !== 'live') {
    console.error('--confirm makes live Qloo calls and needs QLOO_MODE=live. For a synthetic rehearsal use --mock. Nothing was called.');
    process.exit(1);
  }
  if (!process.env.QLOO_API_KEY) {
    console.error('QLOO_API_KEY is not set (environment or .env.local). Nothing was called.');
    process.exit(1);
  }
}

const { getQlooClient, runCtxFor } = await import('@/server/qloo');
const { loadCalibration } = await import('@/server/agent/deps-live');
const data = await import('@/server/data');
const { getEnv } = await import('@/server/env');
const arm = await import('./qloo-arm');
const stats = await import('./stats');
const report = await import('./report');

const env = getEnv();
const client = getQlooClient();
if (client.synthetic !== (MODE === 'mock')) {
  console.error(`The Qloo client is ${client.synthetic ? 'synthetic' : 'live'}, which does not match --${MODE === 'mock' ? 'mock' : 'confirm'}. Nothing was called.`);
  process.exit(1);
}
if (MODE === 'live' && env.redisDriver === 'memory') {
  console.warn('Note: no Upstash configured — the quota ledger and Qloo cache for this run live in memory only.');
}

const cal: CalibrationRecord = await loadCalibration();
const location = arm.heatmapLocation(cal, data.nycStudyWkt);
const usesBaselineMaps = cal.config.baseline === 'B1' || cal.config.baseline === 'B2' || cal.config.baseline === 'B3';
const extraMaps = (usesBaselineMaps ? cal.baselineSignals.length : 0) + (cal.fingerprintSignals ? 1 : 0);
const planned = panel.length * 2 + extraMaps;
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const ctx = runCtxFor({ runId: `backtest-${stamp}` }, { actor: 'script', force: FORCE, retries: false, maxFresh: hardStop(planned) });
const api = client.forRun(ctx);
const configLabel = `${cal.config.metric} · ${cal.config.baseline} · ${cal.config.form}${cal.config.experimental ? ' (experimental)' : ''}`;
const locationLabel = cal.location === 'query' ? 'NYC (Qloo locality)' : 'NYC study polygon';

console.log(
  `Stoop · validation backtest — ${MODE === 'live' ? `LIVE against ${env.QLOO_BASE_URL} (key: set, not shown)` : 'SYNTHETIC rehearsal (mock transport)'}`,
);
console.log(`${panel.length} chains · ${planned} planned calls (hard stop ${hardStop(planned)}) · lift ${configLabel} on the ${locationLabel}\n`);

// ---------------------------------------------------------------------------------------------
// Qloo arm (sequential)
// ---------------------------------------------------------------------------------------------

/** Why the run must stop after this failure (401, 429, guards), or null to carry on. */
const stopReason = (what: string, f: { code: QlooErrorCode; message: string }) =>
  arm.STOP_CODES.has(f.code) ? `${what}: ${f.code} — ${f.message}` : null;
let stop: string | null = null;

const baselines: HeatmapData[] = [];
for (const signals of usesBaselineMaps ? cal.baselineSignals : []) {
  const r = await api.heatmap({ signals, location, purpose: 'baseline' });
  if (r.ok) baselines.push(r.data);
  else {
    console.log(`    baseline map failed (${r.code}); the lift engine falls back to B4 as the app does`);
    stop = stopReason('baseline map', r);
  }
  if (stop) break;
}
let fingerprint: HeatmapData | null = null;
if (!stop && cal.fingerprintSignals) {
  const r = await api.heatmap({ signals: cal.fingerprintSignals, location, purpose: 'baseline' });
  if (r.ok) fingerprint = r.data;
  else stop = stopReason('default-map fingerprint', r);
}

const setup: LiftSetup = { location, config: cal.config, baselines, fingerprint, grid: data.gridSpec, kiosks: data.kiosks, ntas: data.ntas };
const lifts = new Map<string, BrandLift>();
let lastStart = 0;
for (const [i, { brand }] of panel.entries()) {
  if (stop) break;
  const wait = lastStart + BRAND_GAP_MS - Date.now();
  if (wait > 0) await sleep(wait);
  lastStart = Date.now();
  const r = await arm.brandLift(api, brand, setup);
  lifts.set(brand.id, r);
  const detail = r.failure
    ? `${r.failure.code}: ${r.failure.message}`
    : `${r.match ?? '-'}${r.flags.length ? ` · ${r.flags.join(', ')}` : ''}` +
      (r.status === 'ok' ? ` · ${Object.keys(r.eligible).length}/${Object.keys(r.residential).length} NTAs` : '');
  console.log(`${String(i + 1).padStart(2)}  ${brand.name.padEnd(24)} ${r.status.padEnd(11)} ${detail}`);
  if (r.failure) stop = stopReason(brand.name, r.failure);
}
await client.releaseRun(ctx);
console.log(`\nQloo: ${ctx.stats.fresh} fresh, ${ctx.stats.cached} cached, ${ctx.stats.attempts} attempts, ${ctx.stats.guarded} refused locally.`);
if (stop) {
  console.error(`Stopped — ${stop}. Nothing was written; rerun once the cause is fixed (successful calls are cached).`);
  process.exit(2);
}

// ---------------------------------------------------------------------------------------------
// Statistics and report
// ---------------------------------------------------------------------------------------------

const residentialCodes = data.ntas.filter((n) => n.residential).map((n) => n.code).sort();
if (residentialCodes.join() !== targets.ntas.map((n) => n.code).sort().join()) {
  console.error('targets.json and src/data/nta2020.json disagree on the residential NTAs: rebuild with pnpm backtest:osm.');
  process.exit(1);
}
const boroOf = new Map(data.ntas.map((n) => [n.code, n.boro]));

function universe(codes: string[], key: 'eligible' | 'residential', description: string): UniverseResult {
  const armLifts = new Map([...lifts].map(([id, r]) => [id, { status: r.status, lift: r[key] }]));
  const prepared = report.prepareUniverse(codes, panel, armLifts);
  const analysis = stats.analyzeUniverse(
    codes.map((c) => boroOf.get(c) ?? '?'),
    prepared.series,
    {
      permutations: report.PERMUTATIONS,
      seed: report.SEEDS.permutation,
      bootstrap: report.BOOTSTRAP,
      bootstrapSeed: report.SEEDS.bootstrap,
      specificitySeed: report.SEEDS.specificity,
    },
  );
  return { description, neighborhoods: codes.length, analysis, compared: prepared.compared, skipped: prepared.skipped };
}

const universes = {
  primary: universe(
    data.eligibleNtas.map((n) => n.code).sort(),
    'eligible',
    'Residential NTAs with at least two ad-capable LinkNYC screens: the neighborhoods Stoop ranks.',
  ),
  sensitivity: universe(residentialCodes, 'residential', 'Every residential NTA (same responses and engine; eligibility widened).'),
};

const synthetic = MODE === 'mock';
// Synthetic maps know nothing about stores, so every cross-chain pair is a true null: measure how often the
// within-borough test still rejects (spatial autocorrelation). Live maps can share real audiences, so not there.
let calibration: ReturnType<typeof stats.nullCalibration> = null;
if (synthetic) {
  const codes = data.eligibleNtas.map((n) => n.code).sort();
  const prepared = report.prepareUniverse(codes, panel, new Map([...lifts].map(([id, r]) => [id, { status: r.status, lift: r.eligible }])));
  calibration = stats.nullCalibration(codes.map((c) => boroOf.get(c) ?? '?'), prepared.series, { permutations: 199, seed: report.SEEDS.permutation });
}

const output = report.buildReport({
  synthetic,
  generatedAt: new Date().toISOString(),
  targets,
  panel,
  outcomes: lifts,
  universes,
  qloo: { config: configLabel, location: locationLabel, calibratedAt: cal.decidedAt, fresh: ctx.stats.fresh, cached: ctx.stats.cached },
  calibration,
});
const outFile = synthetic ? OUT_SYNTHETIC : OUT_LIVE;
mkdirSync(path.dirname(outFile), { recursive: true });
writeFileSync(outFile, `${JSON.stringify(output, null, 2)}\n`);

// ---------------------------------------------------------------------------------------------
// Console summary
// ---------------------------------------------------------------------------------------------

for (const [name, b] of [['Primary', output.primary], ['Sensitivity', output.sensitivity]] as const) {
  console.log(
    `\n${name} (${b.neighborhoods} NTAs, ${b.chains} chains): median ρ ${fmt(b.medianRho)} [95% CI ${fmt(b.ci95?.[0])}, ${fmt(b.ci95?.[1])}] · ` +
      `p(median) ${fmt(b.pMedian, 4)} · ρ > 0 in ${b.positive}/${b.chains} (p ${fmt(b.pPositive, 4)}) · p < 0.05 in ${b.significant05}` +
      (b.specificity
        ? ` · own map ρ ${fmt(b.specificity.meanOwnRho)} vs others ${fmt(b.specificity.meanOtherRho)} (p ${fmt(b.specificity.p, 4)}; best for ${b.specificity.ownMapBest})`
        : ''),
  );
}
console.log(
  `\n  ${'chain'.padEnd(24)} ${'stores'.padStart(6)} ${'n'.padStart(4)} ${'ρ'.padStart(7)} ${'p'.padStart(7)} ${'null ρ'.padStart(7)} ` +
    `${'others'.padStart(7)} ${'own'.padStart(4)}   ρ (all residential)`,
);
for (const { brand, target } of panel) {
  const status = lifts.get(brand.id)?.status ?? 'not run';
  const p = universes.primary.analysis.perBrand.find((x) => x.id === brand.id);
  const s = universes.sensitivity.analysis.perBrand.find((x) => x.id === brand.id);
  const skipped = universes.primary.skipped.get(brand.id);
  const note = status !== 'ok' ? `  (${status})` : skipped ? `  (${skipped})` : '';
  console.log(
    `  ${brand.name.padEnd(24)} ${String(target.counts.stores).padStart(6)} ${(p ? String(p.n) : '-').padStart(4)} ` +
      `${(p ? fmt(p.rho) : '-').padStart(7)} ${(p ? fmt(p.p, 4) : '-').padStart(7)} ${(p ? fmt(p.nullMean) : '-').padStart(7)} ` +
      `${(p ? fmt(p.otherMaps) : '-').padStart(7)} ${String(p?.ownRank ?? '-').padStart(4)}   ${s ? fmt(s.rho) : '-'}${note}`,
  );
}
if (calibration) {
  console.log(
    `\nCalibration (store-blind synthetic maps, ${calibration.pairs} unrelated map–store pairs): within-borough p < ${calibration.alpha} in ` +
      `${(100 * calibration.falsePositiveRate).toFixed(1)}% (nominal ${100 * calibration.alpha}%); SD of ρ ${fmt(calibration.sdRho)} vs ` +
      `${fmt(calibration.sdExchangeable)} if neighborhoods were exchangeable.`,
  );
}
console.log(`\nWrote ${path.relative(ROOT, outFile)}${synthetic ? ' (SYNTHETIC — git-ignored; never published)' : ''}.`);
process.exit(0);
