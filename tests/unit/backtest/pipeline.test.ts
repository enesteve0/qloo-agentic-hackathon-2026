import { describe, expect, it } from 'vitest';
import { eligibleNtas, gridSpec, kiosks, ntas, nycStudyWkt } from '@/server/data';
import { DEFAULT_LIFT_CONFIG } from '@/server/geo';
import { MemoryKV } from '@/server/kv';
import { createQlooClient, createRunCtx, type QlooClient, type QlooEnv } from '@/server/qloo/client';
import { plantedId } from '@/server/qloo/synthetic';
import { createDefaultMockTransport } from '@/server/qloo/transport-mock';
import type { QlooTransport } from '@/server/qloo/types';
import type { Candidate, ResolutionOutcome } from '@/shared/types';
import { BRANDS, type BacktestBrand } from '../../../scripts/backtest/brands';
import { brandLift, chooseCandidate, heatmapLocation, STOP_CODES, type BrandLift, type LiftSetup } from '../../../scripts/backtest/qloo-arm';
import { buildReport, METHOD_VERSION, prepareUniverse, type PanelEntry, type UniverseResult } from '../../../scripts/backtest/report';
import { analyzeUniverse, mulberry32 } from '../../../scripts/backtest/stats';
import { ODBL_NOTICE, type BrandTarget, type TargetsFile } from '../../../scripts/backtest/targets';

/** Test environment: fast pacing, cache that never expires during the test. */
const ENV: QlooEnv = {
  QLOO_MAX_FRESH_PER_RUN: 20,
  QLOO_RUN_RPS: 50,
  QLOO_RUN_SLOTS: 2,
  QLOO_CAPS_JSON: undefined,
  EVENT_DATA_EXPIRES_AT: '2099-01-01T00:00:00Z',
  EVENT_JUDGING_START: '2026-11-02T17:00:00Z',
  EVENT_JUDGING_END: '2026-11-06T04:45:00Z',
};

const syntheticClient = () => createQlooClient({ transport: createDefaultMockTransport({ latencyMs: () => 0 }), kv: new MemoryKV(), env: ENV });
let runs = 0;
const forRun = (client: QlooClient) => client.forRun(createRunCtx({ runId: `test-backtest-${runs++}`, actor: 'script', retries: false, maxFresh: 40 }));

const SETUP: LiftSetup = {
  location: heatmapLocation({ location: 'wkt' }, nycStudyWkt),
  config: DEFAULT_LIFT_CONFIG,
  baselines: [],
  fingerprint: null,
  grid: gridSpec,
  kiosks,
  ntas,
};
const brand = (id: string) => BRANDS.find((b) => b.id === id)!;

describe('Qloo arm helpers', () => {
  const cand = (id: string, name: string): Candidate => ({ id, name, type: 'brand', disambiguation: null, popularity: null, year: null });
  const chase = brand('chase');

  it('takes resolved matches as they are and settles ambiguity by name or alias only', () => {
    const resolved: ResolutionOutcome = { input: 'Chase', type: 'brand', status: 'resolved', match: 'exact', selected: cand('1', 'Chase'), alternatives: [], warnings: [] };
    expect(chooseCandidate(resolved, chase)).toEqual({ candidate: cand('1', 'Chase'), match: 'exact' });
    expect(chooseCandidate({ ...resolved, match: 'semantic' }, chase)?.match).toBe('semantic');

    const ambiguous: ResolutionOutcome = {
      input: 'Chase',
      type: 'brand',
      status: 'ambiguous',
      candidates: [cand('1', 'Chase Utley'), cand('2', 'Chase Bank'), cand('3', 'JPMorgan Chase')],
    };
    expect(chooseCandidate(ambiguous, chase)).toEqual({ candidate: cand('2', 'Chase Bank'), match: 'alias' });
    expect(chooseCandidate({ ...ambiguous, candidates: [cand('1', 'Chase Utley')] }, chase)).toBeNull();
    expect(chooseCandidate({ input: 'Chase', type: 'brand', status: 'not_found', candidates: [] }, chase)).toBeNull();
  });

  it('uses the same location form as the app’s WHERE stage', () => {
    expect(heatmapLocation({ location: 'wkt' }, 'POLYGON((0 0, 1 0, 1 1, 0 0))')).toEqual({ wkt: 'POLYGON((0 0, 1 0, 1 1, 0 0))', label: 'NYC study area' });
    expect(heatmapLocation({ location: 'query' }, 'unused')).toEqual({ query: 'NYC' });
  });

  it('stops on 401 and 429 (and on local guards) but not on a single bad request', () => {
    for (const code of ['AUTH', 'QUOTA_EXHAUSTED', 'RATE_LIMITED', 'BUDGET_GUARD', 'BUSY'] as const) expect(STOP_CODES.has(code)).toBe(true);
    for (const code of ['BAD_REQUEST', 'UPSTREAM', 'TIMEOUT', 'BAD_RESPONSE', 'NOT_FOUND'] as const) expect(STOP_CODES.has(code)).toBe(false);
  });
});

describe('brandLift on the synthetic transport', () => {
  it('resolves, maps and scores a chain with two calls, the second time from cache', async () => {
    const client = syntheticClient();
    const api = forRun(client);
    const r = await brandLift(api, brand('sweetgreen'), SETUP);
    expect(r.status).toBe('ok');
    expect(r.match).toBe('exact');
    expect(r.failure).toBeNull();
    expect(api.ctx.stats.fresh).toBe(2);

    const eligible = new Set(eligibleNtas.map((n) => n.code));
    const codes = Object.keys(r.eligible);
    expect(codes.length).toBeGreaterThan(90);
    expect(codes.every((c) => eligible.has(c))).toBe(true);
    expect(Object.keys(r.residential).length).toBeGreaterThan(codes.length);
    // Widening eligibility changes which neighborhoods are listed, never their lift.
    for (const c of codes) expect(r.residential[c]).toBe(r.eligible[c]);
    expect(Object.values(r.residential).every(Number.isFinite)).toBe(true);

    const again = forRun(client);
    const r2 = await brandLift(again, brand('sweetgreen'), SETUP);
    expect(again.ctx.stats.fresh).toBe(0);
    expect(r2.eligible).toEqual(r.eligible);
  });

  it('reports a chain Qloo cannot find without calling the heatmap', async () => {
    const api = forRun(syntheticClient());
    const missing: BacktestBrand = { ...brand('levain'), id: 'missing', qloo: { type: 'brand', query: 'zzzz nothing', hint: null, aliases: [] } };
    const r = await brandLift(api, missing, SETUP);
    expect(r.status).toBe('not_found');
    expect(api.ctx.stats.fresh).toBe(1);
  });

  it('sets aside a chain whose map is Qloo’s generic default map', async () => {
    const client = syntheticClient();
    const api = forRun(client);
    const fp = await api.heatmap({ signals: { entities: [plantedId('brand', 'Pick n Pay')] }, location: SETUP.location, purpose: 'baseline' });
    if (!fp.ok) throw new Error(fp.message);
    const probe: BacktestBrand = { ...brand('levain'), id: 'probe', name: 'Bursaspor', qloo: { type: 'brand', query: 'Bursaspor', hint: null, aliases: [] } };
    const r = await brandLift(api, probe, { ...SETUP, fingerprint: fp.data });
    expect(r.status).toBe('default_map');
    expect(r.flags).toContain('DEFAULT_MAP');
    expect(r.eligible).toEqual({});
  });

  it('returns 401/429 failures with codes the run stops on', async () => {
    const scripted = (status: number, headers: Record<string, string>, json: unknown): QlooTransport => ({
      kind: 'mock',
      fetch: async () => ({ status, headers: new Headers(headers), json }),
    });
    const cases: [number, Record<string, string>, unknown, string][] = [
      [401, {}, { message: 'Unauthorized' }, 'AUTH'],
      [429, { 'x-month-ratelimit-limit': '10000', 'x-month-ratelimit-remaining': '0', 'x-month-ratelimit-reset': '1000' }, { error_msg: 'Rate limit exceeded' }, 'QUOTA_EXHAUSTED'],
      [429, { 'x-second-ratelimit-limit': '5', 'x-second-ratelimit-remaining': '0', 'x-second-ratelimit-reset': '1' }, {}, 'RATE_LIMITED'],
    ];
    for (const [status, headers, json, code] of cases) {
      const client = createQlooClient({ transport: scripted(status, headers, json), kv: new MemoryKV(), env: ENV });
      const r = await brandLift(forRun(client), brand('starbucks'), SETUP);
      expect(r.status).toBe('failed');
      expect(r.failure?.code).toBe(code);
      expect(STOP_CODES.has(r.failure!.code)).toBe(true);
    }
  });
});

describe('report', () => {
  it('runs the whole Qloo arm → statistics → report chain on synthetic maps and publishes summary statistics only', async () => {
    const client = syntheticClient();
    const api = forRun(client);
    const ids = ['sweetgreen', 'popeyes', 'equinox', 'duane-reade'];
    const residential = ntas.filter((n) => n.residential).map((n) => n.code).sort();
    const rng = mulberry32(3);

    // Synthetic OSM targets: random over-index and store counts per residential NTA.
    const panel: PanelEntry[] = ids.map((id) => {
      const b = brand(id);
      const stores: Record<string, number> = {};
      const target: Record<string, number> = {};
      for (const c of residential) {
        const n = rng() < 0.3 ? 1 + Math.floor(rng() * 3) : 0;
        if (n) stores[c] = n;
        target[c] = 0.5 + rng();
      }
      const t: BrandTarget = {
        id,
        name: b.name,
        qid: b.qid,
        category: b.category,
        osmBase: '2026-10-26T19:00:00Z',
        counts: { elements: 99, active: 99, merged: 0, stores: 99, residential: 99, nonResidential: 0, outside: 0 },
        status: 'ok',
        reason: null,
        momentEstimate: 0.4,
        priorVariance: 0.4,
        stores,
        target,
      };
      return { brand: b, target: t };
    });
    // One chain with almost no stores in the eligible neighborhoods.
    panel[3]!.target.stores = { [residential.find((c) => !eligibleNtas.some((n) => n.code === c))!]: 12 };

    const lifts = new Map<string, BrandLift>();
    for (const { brand: b } of panel) lifts.set(b.id, await brandLift(api, b, SETUP));
    expect([...lifts.values()].every((l) => l.status === 'ok')).toBe(true);

    const boroOf = new Map(ntas.map((n) => [n.code, n.boro]));
    const universe = (codes: string[], key: 'eligible' | 'residential', description: string): UniverseResult => {
      const prepared = prepareUniverse(codes, panel, new Map([...lifts].map(([id, l]) => [id, { status: l.status, lift: l[key] }])));
      const analysis = analyzeUniverse(
        codes.map((c) => boroOf.get(c)!),
        prepared.series,
        { permutations: 200, seed: 1, bootstrap: 500, bootstrapSeed: 2, specificitySeed: 3 },
      );
      return { description, neighborhoods: codes.length, analysis, compared: prepared.compared, skipped: prepared.skipped };
    };
    const universes = {
      primary: universe(eligibleNtas.map((n) => n.code).sort(), 'eligible', 'eligible'),
      sensitivity: universe(residential, 'residential', 'residential'),
    };
    expect(universes.primary.skipped.get('duane-reade')).toBe('0 stores in these neighborhoods (minimum 10)');

    const targets: Pick<TargetsFile, 'method' | 'builtAt' | 'poi' | 'brands' | 'unverified'> = {
      method: { version: 'osm-target/2', minStores: 15, dedupeMeters: 40, minPriorVariance: 0.25 },
      builtAt: '2026-10-26T20:00:00Z',
      poi: { osmBase: '2026-10-26T19:00:00Z', elements: 1, active: 1, residential: 1, nonResidential: 0, outside: 0 },
      brands: [
        ...panel.map((p) => p.target),
        { ...panel[0]!.target, id: 'tiny', name: 'Tiny Chain', qid: 'Q2', status: 'excluded', reason: '3 stores in NYC on OSM (minimum 15)', target: {} },
      ],
      unverified: [{ id: 'bad', name: 'Bad QID', qid: 'Q3', reason: 'label is “X”, expected “Y”' }],
    };
    const report = buildReport({
      synthetic: true,
      generatedAt: '2026-10-26T21:00:00Z',
      targets,
      panel,
      outcomes: lifts,
      universes,
      qloo: { config: 'affinity · B4 · difference', location: 'NYC study polygon', calibratedAt: null, fresh: api.ctx.stats.fresh, cached: api.ctx.stats.cached },
    });

    expect(report.synthetic).toBe(true);
    expect(report.label).toMatch(/^SYNTHETIC/);
    expect(report.notice).toBe(ODBL_NOTICE);
    expect(report.methodVersion).toBe(METHOD_VERSION);
    expect(report.primary.chains).toBe(3);
    expect(report.sensitivity.chains).toBe(4);
    expect(report.primary.skipped).toEqual([{ name: 'Duane Reade', reason: '0 stores in these neighborhoods (minimum 10)' }]);
    const sg = report.brands.find((b) => b.name === 'Sweetgreen')!;
    expect(sg.status).toBe('ok');
    expect(sg.primary).toMatchObject({ n: expect.any(Number), rho: expect.any(Number), p: expect.any(Number) });
    expect(report.excluded).toEqual([
      { name: 'Tiny Chain', qid: 'Q2', reason: '3 stores in NYC on OSM (minimum 15)' },
      { name: 'Bad QID', qid: 'Q3', reason: 'Wikidata check failed: label is “X”, expected “Y”' },
    ]);

    expect(sg.primary).toMatchObject({ nullRho: expect.any(Number), otherMapsRho: expect.any(Number), placeboP: expect.any(Number) });
    expect('calibration' in report).toBe(false);
    const withCalibration = buildReport({
      synthetic: true,
      generatedAt: '2026-10-26T21:00:00Z',
      targets,
      panel,
      outcomes: lifts,
      universes,
      qloo: { config: 'x', location: 'y', calibratedAt: null, fresh: 0, cached: 0 },
      calibration: { pairs: 12, alpha: 0.05, falsePositiveRate: 0.123456, sdRho: 0.17777, sdExchangeable: 0.0981 },
    });
    expect(withCalibration.calibration).toMatchObject({ pairs: 12, falsePositiveRate: 0.123, sdRho: 0.178, sdExchangeable: 0.098 });

    // Summary statistics only: no neighborhood codes, no Qloo entity ids, no coordinates, no per-NTA values.
    const text = JSON.stringify(report);
    expect(text).not.toMatch(/\b(MN|BK|QN|BX|SI)\d{4}\b/);
    expect(text).not.toMatch(/5157E7C0/i);
    expect(text).not.toMatch(/-7[34]\.\d{3,}|\b40\.\d{4,}/);
    const numbers = text.match(/-?\d+\.\d+/g) ?? [];
    expect(numbers.length).toBeLessThan(80);
  });
});
