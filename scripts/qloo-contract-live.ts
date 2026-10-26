/**
 * Live contract check: at most 5 Qloo calls whose raw responses are validated against the loose zod
 * schemas in src/server/qloo/schemas.ts. It prints structure only (keys, counts, shapes — never
 * values) and persists nothing: no cache, no files. The quota ledger still counts the attempts.
 *
 *   pnpm exec tsx scripts/qloo-contract-live.ts             print the plan (no network)
 *   pnpm exec tsx scripts/qloo-contract-live.ts --confirm   run it (needs QLOO_API_KEY)
 */
import { existsSync, readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import path from 'node:path';
import type { TransportResponse } from '@/server/qloo/types';
import type { NtaInfo } from '@/shared/types';

// `server-only` throws outside a React Server bundle; this script is trusted server-side tooling.
registerHooks({
  resolve: (specifier, context, nextResolve) =>
    specifier === 'server-only' ? { url: 'data:text/javascript,', shortCircuit: true } : nextResolve(specifier, context),
});

const ROOT = path.resolve(import.meta.dirname, '..');
const CONFIRM = process.argv.includes('--confirm');
const GAP_MS = 600;
const MAX_CALLS = 5;

const params = await import('@/server/qloo/params');
const schemas = await import('@/server/qloo/schemas');
const normalize = await import('@/server/qloo/normalize');

const ntasPath = path.join(ROOT, 'src/data/nta2020.json');
const williamsburg = existsSync(ntasPath)
  ? ((JSON.parse(readFileSync(ntasPath, 'utf8')) as NtaInfo[]).find((n) => n.code === 'BK0102') ?? null)
  : null;
const fallbackWkt = 'POLYGON((-73.97 40.70, -73.94 40.70, -73.94 40.73, -73.97 40.73, -73.97 40.70))';

interface Check {
  id: string;
  title: string;
  path: string;
  query: (id: string) => URLSearchParams;
  label?: string;
  validate: (json: unknown) => { ok: boolean; issues: string[]; shape: string; firstId?: string };
}

const issuesOf = (r: { success: boolean; error?: { issues: { path: PropertyKey[]; message: string }[] } }) =>
  r.success ? [] : (r.error?.issues ?? []).slice(0, 5).map((i) => `${i.path.map(String).join('.') || '(root)'}: ${i.message}`);
const keysOf = (v: unknown) => (v && typeof v === 'object' && !Array.isArray(v) ? Object.keys(v).sort().join(',') : typeof v);

/** Per-item validation: share of items the item schema accepts, plus the first item's key set. */
function items(list: unknown[] | null | undefined, schema: { safeParse: (v: unknown) => { success: boolean } }): string {
  const arr = list ?? [];
  const good = arr.filter((x) => schema.safeParse(x).success).length;
  return `${good}/${arr.length} items valid; first item keys [${keysOf(arr[0])}]`;
}

const CHECKS: Check[] = [
  {
    id: 'K1',
    title: 'GET /',
    path: '/',
    query: () => new URLSearchParams(),
    validate: (json) => ({ ok: schemas.RootResponseSchema.safeParse(json).success, issues: [], shape: `keys [${keysOf(json)}]` }),
  },
  {
    id: 'K2',
    title: 'search (place, NYC filter)',
    path: '/search',
    query: () => params.buildSearch({ query: 'Brooklyn Museum', type: 'place', take: 3 }),
    validate: (json) => {
      const r = schemas.SearchResponseSchema.safeParse(json);
      const list = r.success ? (Array.isArray(r.data.results) ? r.data.results : r.data.results.entities) : [];
      const n = normalize.normalizeCandidates(json, 'place');
      const first = n.ok ? n.value[0]?.id : undefined;
      const typed = list.map((x) => keysOf(x)).some((k) => k.includes('types')) ? 'types[]' : 'type/subtype';
      return { ok: r.success && n.ok, issues: issuesOf(r), shape: `${Array.isArray(r.data?.results) ? 'flat results[]' : 'results.entities[]'} · ${items(list, schemas.EntitySchema)} · ${typed}`, firstId: first };
    },
  },
  {
    id: 'K3',
    title: 'entities by id',
    path: '/entities',
    query: (id) => params.buildEntities([id]),
    validate: (json) => {
      const r = schemas.SearchResponseSchema.safeParse(json);
      const list = r.success ? (Array.isArray(r.data.results) ? r.data.results : r.data.results.entities) : [];
      return { ok: r.success && normalize.normalizeCandidates(json).ok, issues: issuesOf(r), shape: items(list, schemas.EntitySchema) };
    },
  },
  {
    id: 'K4',
    title: 'heatmap, filter.location.query=NYC',
    path: '/v2/insights',
    query: (id) => params.buildHeatmap({ signals: { entities: [id] }, location: { query: 'NYC' } }),
    validate: (json) => {
      const r = schemas.HeatmapResponseSchema.safeParse(json);
      const n = normalize.normalizeHeatmap(json);
      const cells = n.ok ? n.value.cells : [];
      const mix: Record<number, number> = {};
      for (const c of cells) mix[c.gh.length] = (mix[c.gh.length] ?? 0) + 1;
      const nulls = cells.filter((c) => c.aff === null || c.rank === null || c.pop === null).length;
      const echo = (json as { query?: { localities?: { filter?: unknown } } } | null)?.query?.localities?.filter;
      return {
        ok: r.success && n.ok,
        issues: n.ok ? issuesOf(r) : [...issuesOf(r), n.message],
        shape: `${items(r.data?.results.heatmap, schemas.HeatCellSchema)} · precision ${JSON.stringify(mix)} · ${nulls} cells with a null score · locality echo ${Array.isArray(echo) ? 'array' : echo ? 'object' : 'absent'}`,
      };
    },
  },
  {
    id: 'K5',
    title: 'place insights in a neighborhood polygon',
    path: '/v2/insights',
    label: 'NTA BK0102',
    query: (id) => params.buildPlaces({ wkt: williamsburg?.wkt ?? fallbackWkt, entityIds: [id], take: 5, explain: true }),
    validate: (json) => {
      const r = schemas.EntityInsightsResponseSchema.safeParse(json);
      const n = normalize.normalizePlaces(json);
      const places = n.ok ? n.value : [];
      const kinds = [...new Set(places.flatMap((p) => p.tags.map((t) => t.kind)))].sort().join(',');
      return {
        ok: r.success && n.ok,
        issues: n.ok ? issuesOf(r) : [...issuesOf(r), n.message],
        shape: `${items(r.data?.results.entities, schemas.EntitySchema)} · tag kinds [${kinds}] · explainability ${places.some((p) => p.explain.length > 0) ? 'present' : 'absent'}`,
      };
    },
  },
];

if (!CONFIRM) {
  console.log(`Qloo live contract check — plan (≤${MAX_CALLS} calls; run with --confirm to execute):\n`);
  for (const c of CHECKS) {
    const q = params.redactQuery(c.query('<id from K2>'), c.label);
    console.log(`${c.id} GET ${c.path}${q ? `?${q}` : ''}  — ${c.title}`);
  }
  process.exit(0);
}

for (const file of ['.env.local', '.env']) {
  const p = path.join(ROOT, file);
  if (existsSync(p)) process.loadEnvFile(p);
}
const apiKey = process.env.QLOO_API_KEY;
if (!apiKey) {
  console.error('QLOO_API_KEY is not set (environment or .env.local). Nothing was called.');
  process.exit(1);
}

const { getEnv } = await import('@/server/env');
const { kv } = await import('@/server/kv');
const { createLiveTransport } = await import('@/server/qloo/transport-live');
const { QuotaLedger, parseCaps, parseRateHeaders } = await import('@/server/qloo/ledger');

const env = getEnv();
const caps = parseCaps(env.QLOO_CAPS_JSON, { judgingStart: env.EVENT_JUDGING_START, judgingEnd: env.EVENT_JUDGING_END });
const ledger = new QuotaLedger({ kv: kv(), prefix: '', now: Date.now, caps });
const before = await ledger.read();
if (before.exhaustedUntil || before.authFailUntil || before.effectiveRemaining <= caps.absoluteFloor) {
  console.error('Quota breaker open or quota at the absolute floor; not calling Qloo.');
  process.exit(1);
}
const transport = createLiveTransport({ apiKey, baseUrl: env.QLOO_BASE_URL });
console.log(`Qloo live contract check against ${env.QLOO_BASE_URL} (key: set, not shown)\n`);

let entityId: string | null = null;
let failures = 0;
for (const c of CHECKS) {
  if (c.path !== '/' && c.id !== 'K2' && !entityId) {
    console.log(`${c.id} skipped: no entity id from K2`);
    continue;
  }
  const query = c.query(entityId ?? '');
  await ledger.recordAttempt();
  const t0 = Date.now();
  let res: TransportResponse;
  try {
    res = await transport.fetch(c.path, query, AbortSignal.timeout(25_000));
  } catch (e) {
    console.log(`${c.id} network error: ${e instanceof Error ? e.message : String(e)}`);
    failures++;
    continue;
  }
  const ms = Date.now() - t0;
  const rate = parseRateHeaders(res.headers);
  await ledger.recordRate(rate);
  const rateNames = [...res.headers.keys()].filter((k) => /ratelimit|request-id/i.test(k)).sort().join(',');
  if (res.status === 401 || res.status === 429) {
    console.log(`${c.id} ${res.status} — stopping (body keys [${keysOf(res.json)}])`);
    process.exit(2);
  }
  if (res.status !== 200) {
    const details = normalize.errorDetails(res.json);
    console.log(`${c.id} ${res.status} ${ms} ms — ${details.messages.join('; ') || 'no message'}`);
    failures++;
  } else {
    const v = c.validate(res.json);
    if (c.id === 'K2') entityId = v.firstId ?? null;
    console.log(`${c.id} 200 ${ms} ms ${v.ok ? 'OK  ' : 'FAIL'} ${c.title}`);
    console.log(`    ${v.shape}`);
    console.log(`    headers: ${rateNames || 'no rate-limit headers'}`);
    for (const issue of v.issues) console.log(`    issue: ${issue}`);
    if (!v.ok) failures++;
  }
  await new Promise((r) => setTimeout(r, GAP_MS));
}
console.log(`\n${failures === 0 ? 'All shapes accepted.' : `${failures} check(s) failed.`} Month remaining: ${(await ledger.read()).effectiveRemaining}.`);
process.exit(failures === 0 ? 0 : 1);
