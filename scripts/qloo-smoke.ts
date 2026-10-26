/**
 * First-key smoke test and calibration (ARCHITECTURE §17): 26 planned Qloo calls, hard stop 30.
 *
 *   pnpm qloo:smoke --dry-run                      print every planned request (no network, no key)
 *   pnpm qloo:smoke --mock                         rehearse the whole flow on the synthetic transport
 *   pnpm qloo:smoke --confirm [--force] [--skip-optional]
 *                                                  run it live: sequential, one start per 600 ms
 *
 * --confirm aborts on any 401 or 429, never prints the API key, and stores configuration decisions
 * only (no Qloo response data) in .private/calibration/<timestamp>/ and in KV `cfg:calibration`.
 * --force lets the script spend below the phase floor (absolute floor 300 still applies).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import path from 'node:path';
import type { ConfigTrial, GridSpec } from '@/server/geo';
import type { QlooClient } from '@/server/qloo/client';
import type { HeatmapSignals, QlooApi, QlooResult, WktLocation } from '@/server/qloo/types';
import type { Candidate, EntityType, HeatmapData, LiftConfig, NtaInfo } from '@/shared/types';

// Server modules begin with `import 'server-only'`, which throws outside a React Server bundle. This is
// trusted server-side tooling, so resolve that marker to an empty module before loading any of them
// (works with plain `tsx` and with `tsx --conditions=react-server`).
registerHooks({
  resolve: (specifier, context, nextResolve) =>
    specifier === 'server-only' ? { url: 'data:text/javascript,', shortCircuit: true } : nextResolve(specifier, context),
});

const ROOT = path.resolve(import.meta.dirname, '..');
const flags = new Set(process.argv.slice(2));
const MODE = flags.has('--confirm') ? 'live' : flags.has('--mock') ? 'mock' : flags.has('--dry-run') ? 'dry' : null;
const FORCE = flags.has('--force');
const SKIP_OPTIONAL = flags.has('--skip-optional');
const GAP_MS = 600;
const HARD_STOP = 30;
const NTA_A = 'BK0102'; // Williamsburg
const NTA_B = 'QN0103'; // Astoria (Central)
/** Signal age buckets for the demographics-only baseline B1 (values unverified until the key works). */
const ALL_AGES = ['35_and_younger', '36_to_55', '55_and_older'];
const RESTAURANT_TAG = 'urn:tag:genre:place:restaurant';
const MUSIC_GENRES = 'urn:tag:genre:music';
const USEFUL_TAG_KINDS = new Set([
  'ambience',
  'category',
  'genre',
  'cuisine',
  'neighborhood_characteristic',
  'good_for',
  'visit_intent',
  'time_of_day_fit',
  'decor',
  'setting',
]);

if (!MODE) {
  console.log('Usage: pnpm qloo:smoke --dry-run | --mock | --confirm [--force] [--skip-optional]');
  process.exit(1);
}

const params = await import('@/server/qloo/params');

// ---------------------------------------------------------------------------------------------
// Static inputs (committed public geo data)
// ---------------------------------------------------------------------------------------------

function readData<T>(file: string): T | null {
  const p = path.join(ROOT, 'src/data', file);
  if (!existsSync(p)) return null;
  const text = readFileSync(p, 'utf8');
  return (file.endsWith('.json') ? JSON.parse(text) : text.trim()) as T;
}

const nycWkt = readData<string>('nyc-study.wkt');
const ntas = readData<NtaInfo[]>('nta2020.json') ?? [];
const grid = readData<GridSpec>('grid-gh6.json');
const ntaA = ntas.find((n) => n.code === NTA_A) ?? null;
const ntaB = ntas.find((n) => n.code === NTA_B) ?? null;
// Dry runs still validate the parameters, so a placeholder polygon stands in for missing data files.
const PLACEHOLDER_WKT = 'POLYGON((-74 40.7, -73.9 40.7, -73.9 40.8, -74 40.8, -74 40.7))';

// ---------------------------------------------------------------------------------------------
// The plan
// ---------------------------------------------------------------------------------------------

type Loc = WktLocation | { query: string };

type Op =
  | { kind: 'root' }
  | { kind: 'search'; query: string; type: EntityType; saveAs: string }
  | { kind: 'heatmap'; signals: HeatmapSignals; location: Loc; boundary?: string; saveAs: string }
  | { kind: 'places'; location: WktLocation; entityIds: string[]; saveAs: string }
  | { kind: 'tags'; location: WktLocation; entityIds: string[]; saveAs: string };

class MissingInput extends Error {}

/** Results of earlier calls; in a dry run, placeholders such as `<B1:Sweetgreen>` stand in. */
class PlanState {
  readonly ids = new Map<string, string>();
  readonly maps = new Map<string, HeatmapData>();
  locationForm: 'wkt' | 'query' | null = null;

  constructor(readonly live: boolean) {}

  id(key: string, label: string): string {
    const v = this.ids.get(key);
    if (v) return v;
    if (this.live) throw new MissingInput(`${label} was not resolved`);
    // Placeholders still pass the id allow-list (no spaces or commas).
    return `<${label.replace(/[\s,]+/g, '_')}>`;
  }

  nyc(): WktLocation {
    if (nycWkt) return { wkt: nycWkt, label: 'NYC study' };
    if (this.live) throw new MissingInput('src/data/nyc-study.wkt is missing (run pnpm geo:build)');
    return { wkt: PLACEHOLDER_WKT, label: 'NYC study (placeholder)' };
  }

  nta(info: NtaInfo | null, code: string): WktLocation {
    if (info) return { wkt: info.wkt, label: `NTA ${info.code} ${info.short}` };
    if (this.live) throw new MissingInput(`NTA ${code} missing from src/data/nta2020.json`);
    return { wkt: PLACEHOLDER_WKT, label: `NTA ${code} (placeholder)` };
  }

  /** Location form for D–H: chosen after C1/C2 (the NYC study polygon until then). */
  anchorLocation(): Loc {
    return this.locationForm === 'query' ? { query: 'NYC' } : this.nyc();
  }
}

interface Step {
  id: string;
  title: string;
  decides: string;
  optional?: boolean;
  op: (s: PlanState) => Op;
}

const search = (id: string, query: string, type: EntityType, saveAs: string, decides: string): Step => ({
  id,
  title: `search “${query}” (${type})`,
  decides,
  op: () => ({ kind: 'search', query, type, saveAs }),
});

const anchorMap = (id: string, key: string, label: string, decides: string): Step => ({
  id,
  title: `heatmap ${label}`,
  decides,
  op: (s) => ({ kind: 'heatmap', signals: { entities: [s.id(key, label)] }, location: s.anchorLocation(), saveAs: key }),
});

const STEPS: Step[] = [
  { id: 'A1', title: 'GET / (version and rate-limit headers)', decides: 'profile 10k/50k, window end, per-second limit → run slots', op: () => ({ kind: 'root' }) },
  search('B1', 'Sweetgreen', 'brand', 'sweetgreen', 'resolution rule, picker fields, search timeout'),
  search('B2', 'Vampire Weekend', 'artist', 'vampire', 'resolution rule'),
  search('B3', 'Brooklyn Museum', 'place', 'museum', 'place search with the NYC location filter (miles)'),
  search('B4', 'Broad City', 'tv_show', 'broadcity', 'tv_show type access'),
  {
    id: 'C1',
    title: 'heatmap Sweetgreen, filter.location.query=NYC',
    decides: 'location form, coverage, precision mix, payload, latency',
    op: (s) => ({ kind: 'heatmap', signals: { entities: [s.id('sweetgreen', 'B1:Sweetgreen')] }, location: { query: 'NYC' }, saveAs: 'C1' }),
  },
  {
    id: 'C2',
    title: 'heatmap Sweetgreen, NYC study polygon',
    decides: 'location form, coverage',
    op: (s) => ({ kind: 'heatmap', signals: { entities: [s.id('sweetgreen', 'B1:Sweetgreen')] }, location: s.nyc(), saveAs: 'C2' }),
  },
  {
    id: 'C3',
    title: 'repeat C2 (cache bypassed)',
    decides: 'determinism → cache TTL',
    op: (s) => ({ kind: 'heatmap', signals: { entities: [s.id('sweetgreen', 'B1:Sweetgreen')] }, location: s.nyc(), saveAs: 'C3' }),
  },
  anchorMap('D1', 'vampire', 'B2:Vampire Weekend', 'artist maps work; distinct geohash sets'),
  anchorMap('D2', 'museum', 'B3:Brooklyn Museum', 'place maps work; FACE1 check'),
  anchorMap('D3', 'broadcity', 'B4:Broad City', 'tv_show maps work'),
  {
    id: 'E1',
    title: 'baseline B1: demographics-only signal, all age buckets',
    decides: 'baseline candidate B1',
    op: (s) => ({ kind: 'heatmap', signals: { demographics: { age: ALL_AGES } }, location: s.anchorLocation(), saveAs: 'B1' }),
  },
  {
    id: 'E2',
    title: 'baseline B2: restaurant tag',
    decides: 'baseline candidate B2',
    op: (s) => ({ kind: 'heatmap', signals: { tags: [RESTAURANT_TAG] }, location: s.anchorLocation(), saveAs: 'B2' }),
  },
  search('E3', 'Starbucks', 'brand', 'starbucks', 'baseline panel B3'),
  search('E4', "McDonald's", 'brand', 'mcdonalds', 'baseline panel B3'),
  anchorMap('E5', 'starbucks', 'E3:Starbucks', 'baseline panel B3'),
  anchorMap('E6', 'mcdonalds', "E4:McDonald's", 'baseline panel B3'),
  search('F1', 'Bursaspor', 'brand', 'bursaspor', 'default-map probe'),
  search('F2', 'Pick n Pay', 'brand', 'picknpay', 'default-map probe'),
  anchorMap('F3', 'bursaspor', 'F1:Bursaspor', 'default-map fingerprint, thin thresholds'),
  anchorMap('F4', 'picknpay', 'F2:Pick n Pay', 'default-map fingerprint, thin thresholds'),
  {
    id: 'G1',
    title: `place evidence in ${ntaA?.short ?? NTA_A} (two anchors)`,
    decides: 'P0 evidence viability (≥8 places, ≥10 useful tags), explainability',
    op: (s) => ({ kind: 'places', location: s.nta(ntaA, NTA_A), entityIds: [s.id('sweetgreen', 'B1:Sweetgreen'), s.id('vampire', 'B2:Vampire Weekend')], saveAs: 'G1' }),
  },
  {
    id: 'G2',
    title: `place evidence in ${ntaB?.short ?? NTA_B} (two anchors)`,
    decides: 'P0 evidence viability',
    op: (s) => ({ kind: 'places', location: s.nta(ntaB, NTA_B), entityIds: [s.id('sweetgreen', 'B1:Sweetgreen'), s.id('vampire', 'B2:Vampire Weekend')], saveAs: 'G2' }),
  },
  {
    id: 'G3',
    title: `tags + signal.location ${ntaA?.short ?? NTA_A}`,
    decides: 'P1 tag evidence (enable if tag-set Jaccard ≤ 0.6)',
    op: (s) => ({ kind: 'tags', location: s.nta(ntaA, NTA_A), entityIds: [s.id('sweetgreen', 'B1:Sweetgreen'), s.id('vampire', 'B2:Vampire Weekend')], saveAs: 'G3' }),
  },
  {
    id: 'G4',
    title: `tags + signal.location ${ntaB?.short ?? NTA_B}`,
    decides: 'P1 tag evidence',
    op: (s) => ({ kind: 'tags', location: s.nta(ntaB, NTA_B), entityIds: [s.id('sweetgreen', 'B1:Sweetgreen'), s.id('vampire', 'B2:Vampire Weekend')], saveAs: 'G4' }),
  },
  {
    id: 'H1',
    title: 'heatmap Sweetgreen with output.heatmap.boundary=urn:entity:locality',
    decides: 'P1 cross-check',
    optional: true,
    op: (s) => ({
      kind: 'heatmap',
      signals: { entities: [s.id('sweetgreen', 'B1:Sweetgreen')] },
      location: s.anchorLocation(),
      boundary: 'urn:entity:locality',
      saveAs: 'H1',
    }),
  },
];

function describe(op: Op): { path: string; query: URLSearchParams; label?: string } {
  switch (op.kind) {
    case 'root':
      return { path: '/', query: new URLSearchParams() };
    case 'search':
      return { path: '/search', query: params.buildSearch({ query: op.query, type: op.type }) };
    case 'heatmap':
      return {
        path: '/v2/insights',
        query: params.buildHeatmap({ signals: op.signals, location: op.location, boundary: op.boundary }),
        label: 'wkt' in op.location ? op.location.label : undefined,
      };
    case 'places':
      return {
        path: '/v2/insights',
        query: params.buildPlaces({ wkt: op.location.wkt, entityIds: op.entityIds, take: 15, explain: true }),
        label: op.location.label,
      };
    case 'tags':
      return {
        path: '/v2/insights',
        query: params.buildTagInsights({ tagTypes: [MUSIC_GENRES], location: op.location, entityIds: op.entityIds, take: 20 }),
        label: op.location.label,
      };
  }
}

// ---------------------------------------------------------------------------------------------
// Dry run
// ---------------------------------------------------------------------------------------------

if (MODE === 'dry') {
  const s = new PlanState(false);
  console.log('Stoop · Qloo smoke test and calibration — DRY RUN (no network, no key needed)\n');
  let n = 0;
  for (const step of STEPS) {
    const d = describe(step.op(s));
    n++;
    const q = params.redactQuery(d.query, d.label);
    console.log(`${step.id.padEnd(3)} GET ${d.path}${q ? `?${q}` : ''}`);
    console.log(`    ${step.title}${step.optional ? ' (optional; --skip-optional drops it)' : ''} → decides: ${step.decides}`);
  }
  console.log(`\n${n} planned calls (hard stop ${HARD_STOP}); D–H use the location form chosen after C1/C2 (shown: NYC study polygon).`);
  console.log('Run with --confirm to execute live (needs QLOO_API_KEY), or --mock to rehearse on synthetic data.');
  process.exit(0);
}

// ---------------------------------------------------------------------------------------------
// Live or synthetic execution
// ---------------------------------------------------------------------------------------------

for (const file of ['.env.local', '.env']) {
  const p = path.join(ROOT, file);
  if (MODE === 'live' && existsSync(p)) process.loadEnvFile(p);
}
if (MODE === 'live' && !process.env.QLOO_API_KEY) {
  console.error('QLOO_API_KEY is not set (environment or .env.local). Nothing was called.');
  process.exit(1);
}

const { getEnv } = await import('@/server/env');
const { kv } = await import('@/server/kv');
const { createQlooClient, createRunCtx } = await import('@/server/qloo/client');
const { createLiveTransport } = await import('@/server/qloo/transport-live');
const { createDefaultMockTransport } = await import('@/server/qloo/transport-mock');
const { decideOutcome } = await import('@/server/qloo/resolve');

const env = getEnv();
const store = kv();
if (MODE === 'live' && env.redisDriver === 'memory') {
  console.warn('Note: no Upstash configured — the quota ledger for this run lives in memory only.');
}
const client: QlooClient =
  MODE === 'live'
    ? createQlooClient({ transport: createLiveTransport({ apiKey: process.env.QLOO_API_KEY ?? '', baseUrl: env.QLOO_BASE_URL }), kv: store, env })
    : createQlooClient({ transport: createDefaultMockTransport({ latencyMs: () => 0 }), kv: store, env });
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const ctx = createRunCtx({ runId: `smoke-${stamp}`, actor: 'script', force: FORCE, retries: false, maxFresh: HARD_STOP });
const api: QlooApi = client.forRun(ctx);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

console.log(`Stoop · Qloo smoke test and calibration — ${MODE === 'live' ? `LIVE against ${env.QLOO_BASE_URL} (key: set, not shown)` : 'SYNTHETIC rehearsal'}\n`);

interface CallRecord {
  id: string;
  ok: boolean;
  status: number | null;
  ms: number;
  bytes: number | null;
  code?: string;
  note: string;
}

const records: CallRecord[] = [];
const searchOutcomes: Record<string, { outcome: string; candidates: number }> = {};
const placeStats: Record<string, { places: number; usefulTags: number; explainability: boolean }> = {};
const tagSets: Record<string, Set<string>> = {};
interface RootRate {
  monthLimit: number | null;
  monthRemaining: number | null;
  resetSec: number | null;
  secondLimit: number | null;
}
/** Filled by A1 (a container, because it is assigned inside summarize()). */
const measured: { root: RootRate | null } = { root: null };
let abortReason: string | null = null;
let lastStart = 0;
const state = new PlanState(true);
const geo = await import('@/server/geo');

const precisionMix = (cells: HeatmapData['cells']) => {
  const mix: Record<string, number> = {};
  for (const c of cells) mix[c.gh.length] = (mix[c.gh.length] ?? 0) + 1;
  return mix;
};
const coverage = (map: HeatmapData | undefined) => (map && grid ? geo.projectToGrid(map.cells, grid, 'aff').coverage : null);

async function execute(op: Op): Promise<QlooResult<unknown>> {
  const o = { purpose: 'calibration' as const, cache: 'refresh' as const };
  switch (op.kind) {
    case 'root':
      return api.root(o);
    case 'search':
      return api.search(op.query, op.type, o);
    case 'heatmap':
      return api.heatmap({ signals: op.signals, location: op.location, boundary: op.boundary, ...o });
    case 'places':
      return api.places({ ...op.location, entityIds: op.entityIds, take: 15, explain: true, ...o });
    case 'tags':
      return api.tagInsights({ tagTypes: [MUSIC_GENRES], location: op.location, entityIds: op.entityIds, take: 20, ...o });
  }
}

function summarize(op: Op, r: Extract<QlooResult<unknown>, { ok: true }>): string {
  switch (op.kind) {
    case 'root': {
      const info = r.data as { version: string | null; rate: { month: { limit: number | null; remaining: number | null; resetSec: number | null } | null; second: { limit: number | null } | null } };
      const rootRate: RootRate = {
        monthLimit: info.rate.month?.limit ?? null,
        monthRemaining: info.rate.month?.remaining ?? null,
        resetSec: info.rate.month?.resetSec ?? null,
        secondLimit: info.rate.second?.limit ?? null,
      };
      measured.root = rootRate;
      return `version ${info.version ?? 'n/a'} · month ${rootRate.monthRemaining ?? '?'} / ${rootRate.monthLimit ?? '?'} · ${rootRate.secondLimit ?? '?'}/s`;
    }
    case 'search': {
      const list = r.data as Candidate[];
      const outcome = decideOutcome(op.query, op.type, list);
      searchOutcomes[op.saveAs] = { outcome: outcome.status === 'resolved' ? outcome.match : outcome.status, candidates: list.length };
      const pick = outcome.status === 'resolved' ? outcome.selected : list[0];
      if (pick) state.ids.set(op.saveAs, pick.id);
      return `${list.length} candidates → ${outcome.status === 'resolved' ? outcome.match : outcome.status}`;
    }
    case 'heatmap': {
      const map = r.data as HeatmapData;
      state.maps.set(op.saveAs, map);
      const cov = coverage(map);
      const mix = Object.entries(precisionMix(map.cells))
        .map(([p, n]) => `gh${p}:${n}`)
        .join(' ');
      return `${map.cells.length} cells (${mix || 'none'}) · coverage ${cov === null ? 'n/a' : cov.toFixed(2)}${map.locality ? ` · locality “${map.locality.name}”` : ''}`;
    }
    case 'places': {
      const places = r.data as { tags: { id: string; kind: string }[]; explain: unknown[] }[];
      const useful = new Set(places.flatMap((p) => p.tags.filter((t) => USEFUL_TAG_KINDS.has(t.kind)).map((t) => t.id)));
      placeStats[op.saveAs] = { places: places.length, usefulTags: useful.size, explainability: places.some((p) => p.explain.length > 0) };
      return `${places.length} places · ${useful.size} distinct useful tags`;
    }
    case 'tags': {
      const tags = r.data as { id: string }[];
      tagSets[op.saveAs] = new Set(tags.map((t) => t.id));
      return `${tags.length} tags`;
    }
  }
}

for (const step of STEPS) {
  if (step.optional && SKIP_OPTIONAL) {
    console.log(`${step.id.padEnd(3)} skipped (--skip-optional)`);
    continue;
  }
  if (ctx.stats.attempts >= HARD_STOP) {
    abortReason = `hard stop: ${HARD_STOP} calls`;
    break;
  }
  // After C1/C2: the NYC study polygon unless it covers clearly less of the grid than the NYC query.
  if (step.id === 'D1' && state.locationForm === null) {
    const q = coverage(state.maps.get('C1'));
    const w = coverage(state.maps.get('C2'));
    state.locationForm = w !== null && (q === null || w >= 0.9 * q) ? 'wkt' : q !== null ? 'query' : 'wkt';
    console.log(`    → location form for D–H: ${state.locationForm === 'wkt' ? 'NYC study polygon' : 'filter.location.query=NYC'}`);
  }
  let op: Op;
  try {
    op = step.op(state);
  } catch (e) {
    if (!(e instanceof MissingInput)) throw e;
    console.log(`${step.id.padEnd(3)} skipped: ${e.message}`);
    records.push({ id: step.id, ok: false, status: null, ms: 0, bytes: null, code: 'SKIPPED', note: e.message });
    continue;
  }
  const wait = lastStart + GAP_MS - Date.now();
  if (wait > 0) await sleep(wait);
  lastStart = Date.now();
  const r = await execute(op);
  const note = r.ok ? summarize(op, r) : `${r.code}: ${r.message}`;
  records.push({ id: step.id, ok: r.ok, status: r.meta.status, ms: r.meta.ms, bytes: r.meta.bytes, code: r.ok ? undefined : r.code, note });
  const size = r.meta.bytes === null ? '' : ` · ${(r.meta.bytes / 1024).toFixed(0)} KB`;
  console.log(`${step.id.padEnd(3)} ${String(r.meta.status ?? '---').padEnd(4)} ${String(r.meta.ms).padStart(6)} ms${size}  ${note}`);
  if (!r.ok && (r.code === 'AUTH' || r.code === 'QUOTA_EXHAUSTED' || r.code === 'RATE_LIMITED' || r.code === 'BUDGET_GUARD')) {
    abortReason = `${step.id} ${r.code}: ${r.message}`;
    break;
  }
}

// ---------------------------------------------------------------------------------------------
// Decisions (local, no more calls)
// ---------------------------------------------------------------------------------------------

const ok = (id: string) => records.find((r) => r.id === id)?.ok === true;
const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? (s[(s.length - 1) >> 1] ?? 0) : null;
};
const searchMs = records.filter((r) => ['B1', 'B2', 'B3', 'B4', 'E3', 'E4', 'F1', 'F2'].includes(r.id) && r.ok).map((r) => r.ms);
const heatMs = records.filter((r) => /^[CDEFH]\d$/.test(r.id) && r.ok && !['E3', 'E4', 'F1', 'F2'].includes(r.id)).map((r) => r.ms);
const ledger = await client.ledger();
const rootRate = measured.root;
const monthLimit = rootRate?.monthLimit ?? ledger.monthLimit;
const secondLimit = rootRate?.secondLimit ?? ledger.secondLimit;
const resetAt = rootRate?.resetSec ? new Date(Date.now() + rootRate.resetSec * 1000).toISOString() : ledger.monthResetAt;

const c2 = state.maps.get('C2');
const c3 = state.maps.get('C3');
const deterministic = c2 && c3 ? JSON.stringify(c2.cells) === JSON.stringify(c3.cells) : null;

function spearmanOf(a: HeatmapData | undefined, b: HeatmapData | undefined): number | null {
  if (!a || !b || !grid) return null;
  const rho = geo.spearman(geo.projectToGrid(a.cells, grid, 'aff').values, geo.projectToGrid(b.cells, grid, 'aff').values);
  return Number.isFinite(rho) ? rho : null;
}
const defaultRho = spearmanOf(state.maps.get('bursaspor'), state.maps.get('picknpay'));
const defaultMapDetected = defaultRho !== null && defaultRho >= geo.DEFAULT_LIFT_CONFIG.thresholds.defaultMapRho;

const g3 = tagSets.G3;
const g4 = tagSets.G4;
const jaccard = g3 && g4 && g3.size + g4.size > 0 ? [...g3].filter((t) => g4.has(t)).length / new Set([...g3, ...g4]).size : null;
const evidenceViable = ['G1', 'G2'].every((k) => (placeStats[k]?.places ?? 0) >= 8 && (placeStats[k]?.usefulTags ?? 0) >= 10);

const B1_SIGNALS: HeatmapSignals = { demographics: { age: ALL_AGES } };
const B2_SIGNALS: HeatmapSignals = { tags: [RESTAURANT_TAG] };
const panel = (['starbucks', 'mcdonalds'] as const).filter((k) => state.maps.has(k));
const baselineMaps = (b: LiftConfig['baseline']): HeatmapData[] =>
  b === 'B1' ? [state.maps.get('B1')].filter((m): m is HeatmapData => !!m) : b === 'B2' ? [state.maps.get('B2')].filter((m): m is HeatmapData => !!m) : b === 'B3' ? panel.map((k) => state.maps.get(k)!) : [];
const baselineSignals = (b: LiftConfig['baseline']): HeatmapSignals[] =>
  b === 'B1' ? [B1_SIGNALS] : b === 'B2' ? [B2_SIGNALS] : b === 'B3' ? panel.map((k) => ({ entities: [state.ids.get(k)!] })) : [];

/**
 * Lift-configuration choice: builds one ConfigTrial per metric × baseline (difference form, then the
 * residual form for the two best) with the lift engine and lets `scoreConfigs` pick (FACE1 = share of
 * Brooklyn Museum's top-10 neighborhoods in Brooklyn; FACE2 needs the OSM backtest and is skipped here).
 */
async function chooseLiftConfig(): Promise<{ config: LiftConfig; reason: string; scores: unknown[] } | { skipped: string }> {
  if (!grid) return { skipped: 'src/data/grid-gh6.json is missing' };
  const anchorKeys = [state.locationForm === 'query' ? 'C1' : 'C2', 'vampire', 'museum', 'broadcity'];
  const anchors = anchorKeys.flatMap((k) => {
    const map = state.maps.get(k);
    return map ? [{ id: k, name: k, heatmap: map, userWeight: 1 }] : [];
  });
  if (anchors.length < 2 || !state.maps.has('museum')) return { skipped: 'fewer than two anchor maps (or no Brooklyn Museum map)' };
  const boroOf = new Map(ntas.map((n) => [n.code, n.boro]));
  const residential = new Set(ntas.filter((n) => n.residential).map((n) => n.code));
  const base = { ...geo.DEFAULT_LIFT_CONFIG, thresholds: { ...geo.DEFAULT_LIFT_CONFIG.thresholds }, experimental: false };
  const trialFor = (config: LiftConfig): ConfigTrial => {
    const lifted = geo.computeAnchorLifts({ anchors, baselines: baselineMaps(config.baseline), config, grid });
    const museum = lifted.anchors.find((a) => a.id === 'museum');
    const ranking = museum
      ? geo
          .aggregateNtas({ L: museum.lift, grid, kappa: config.kappa, anchors: [{ id: 'museum', lift: museum.lift, weight: 1 }] })
          .filter((a) => residential.has(a.code))
          .sort((a, b) => b.lift - a.lift)
          .map((a) => ({ code: a.code, boro: boroOf.get(a.code) ?? '' }))
      : [];
    return {
      config: lifted.config,
      face1: [{ expectedBoro: 'Brooklyn', ranking }],
      face2: [],
      anchorLifts: lifted.anchors.map((a) => a.lift),
      coverage: lifted.anchors.map((a) => a.covered / grid.cells.length),
    };
  };
  const configs: LiftConfig[] = [{ ...base, metric: 'affinity_rank', baseline: 'B0', form: 'difference' }];
  for (const metric of ['affinity', 'affinity_rank'] as const) {
    for (const baseline of ['B1', 'B2', 'B3', 'B4'] as const) {
      if (baseline === 'B4' || baselineMaps(baseline).length > 0) configs.push({ ...base, metric, baseline, form: 'difference' });
    }
  }
  const trials = configs.map(trialFor);
  const first = geo.scoreConfigs(trials);
  const residuals = first.ranking
    .filter((i) => trials[i]?.config.baseline !== 'B0')
    .slice(0, 2)
    .map((i) => trialFor({ ...(trials[i]?.config ?? base), form: 'residual' }));
  const all = [...trials, ...residuals];
  const choice = geo.scoreConfigs(all);
  return {
    config: choice.config,
    reason: choice.reason,
    scores: all.map((t, i) => ({ config: `${t.config.metric}·${t.config.baseline}·${t.config.form}`, ...choice.scores[i] })),
  };
}

const lift = abortReason ? { skipped: `aborted: ${abortReason}` } : await chooseLiftConfig();
const decidedAt = new Date().toISOString();
const chosen = 'config' in lift ? lift.config : { ...geo.DEFAULT_LIFT_CONFIG, experimental: true };

/** The record the run pipeline reads from KV `cfg:calibration` (configuration only). */
const cfgCalibration = {
  config: chosen,
  location: state.locationForm ?? 'wkt',
  baselineSignals: baselineSignals(chosen.baseline),
  fingerprintSignals: defaultMapDetected && state.ids.get('bursaspor') ? { entities: [state.ids.get('bursaspor')!] } : null,
  decidedAt,
  experimental: chosen.experimental,
};

const decisions = {
  _kind: 'stoop-calibration-decisions',
  synthetic: MODE !== 'live',
  decidedAt,
  callsUsed: ctx.stats.attempts,
  aborted: abortReason,
  quota: {
    profile: monthLimit !== null && monthLimit >= 50_000 ? '50k' : '10k',
    monthLimit,
    monthRemaining: rootRate?.monthRemaining ?? ledger.headerRemaining,
    windowResetsAt: resetAt,
    windowEndsAfterEvent: resetAt ? Date.parse(resetAt) > Date.parse('2026-11-06T05:00:00Z') : null,
    secondLimit,
    suggestedRunSlots: secondLimit ? Math.max(1, Math.floor((secondLimit - 1) / env.QLOO_RUN_RPS)) : null,
  },
  search: { outcomes: searchOutcomes, medianMs: median(searchMs), maxMs: searchMs.length ? Math.max(...searchMs) : null },
  heatmap: {
    locationForm: state.locationForm,
    query: { cells: state.maps.get('C1')?.cells.length ?? null, coverage: coverage(state.maps.get('C1')), precision: state.maps.get('C1') ? precisionMix(state.maps.get('C1')!.cells) : null, locality: state.maps.get('C1')?.locality?.name ?? null },
    wkt: { cells: c2?.cells.length ?? null, coverage: coverage(c2), precision: c2 ? precisionMix(c2.cells) : null },
    deterministic,
    medianMs: median(heatMs),
    maxMs: heatMs.length ? Math.max(...heatMs) : null,
    maxKb: Math.max(0, ...records.map((r) => (r.bytes ?? 0) / 1024)),
  },
  baselines: { B1: ok('E1'), B2: ok('E2'), B3: panel.length },
  defaultMap: { rho: defaultRho, detected: defaultMapDetected, cells: [state.maps.get('bursaspor')?.cells.length ?? null, state.maps.get('picknpay')?.cells.length ?? null] },
  evidence: { ...placeStats, viable: evidenceViable },
  tagEvidence: { jaccard, enableP1: jaccard !== null && jaccard <= 0.6 },
  lift,
  calls: records.map(({ id, ok: success, status, ms, bytes, code }) => ({ id, ok: success, status, ms, bytes, code: code ?? null })),
  cfgCalibration,
};

const outDir = path.join(ROOT, '.private', 'calibration', `${stamp}${MODE === 'live' ? '' : '-synthetic'}`);
mkdirSync(outDir, { recursive: true });
writeFileSync(path.join(outDir, 'decisions.json'), `${JSON.stringify(decisions, null, 2)}\n`);
writeFileSync(path.join(outDir, 'cfg-calibration.json'), `${JSON.stringify(cfgCalibration, null, 2)}\n`);
if (MODE === 'live' && !abortReason) {
  await store.set('cfg:calibration', cfgCalibration);
}
await client.releaseRun(ctx);

console.log('\nDecisions');
console.log(`  calls used          ${ctx.stats.attempts}${abortReason ? ` (aborted: ${abortReason})` : ''}`);
console.log(`  quota profile       ${decisions.quota.profile} · ${decisions.quota.monthRemaining ?? '?'} left · resets ${resetAt ?? 'unknown'}`);
console.log(`  run slots           ${decisions.quota.suggestedRunSlots ?? 'n/a'} (per-second limit ${secondLimit ?? 'unknown'})`);
console.log(`  location form       ${state.locationForm ?? 'n/a'} · deterministic repeat: ${deterministic ?? 'n/a'}`);
console.log(`  default map         ${defaultMapDetected ? 'detected' : 'not detected'} (ρ ${defaultRho?.toFixed(3) ?? 'n/a'})`);
console.log(`  evidence (P0)       ${evidenceViable ? 'viable' : 'NOT viable'} · tag evidence (P1) ${decisions.tagEvidence.enableP1 ? 'enable' : 'skip'} (Jaccard ${jaccard?.toFixed(2) ?? 'n/a'})`);
console.log(`  lift config         ${'config' in lift ? `${lift.config.metric} · ${lift.config.baseline} · ${lift.config.form}${lift.config.experimental ? ' (experimental)' : ''}` : `skipped — ${lift.skipped}`}`);
if ('reason' in lift) console.log(`                      ${lift.reason}`);
console.log(`\nWrote ${path.relative(ROOT, outDir)}/decisions.json and cfg-calibration.json${MODE === 'live' && !abortReason ? ' and KV cfg:calibration' : ''}.`);
process.exit(abortReason ? 2 : 0);
