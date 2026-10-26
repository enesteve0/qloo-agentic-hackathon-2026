import { describe, expect, it } from 'vitest';
import { MemoryKV } from '@/server/kv';
import { createRunCtx, failureKind, runCtxFor } from '@/server/qloo/client';
import { QlooParamError } from '@/server/qloo/params';
import { createMockTransport } from '@/server/qloo/transport-mock';
import type { ProvenanceRequest } from '@/shared/types';
import { BUILD_DAY, TEST_ENV, makeClient, monthHeaders, ok, scripted, searchBody, secondHeaders } from './helpers';

const run = (id = 'run-1') => createRunCtx({ runId: id });

describe('Qloo client — success and cache', () => {
  it('normalizes a 200, counts one attempt, caches it and serves the repeat from cache', async () => {
    const { transport, calls } = scripted([ok()]);
    const { client, kv } = makeClient(transport);
    const ctx = run();
    const api = client.forRun(ctx);

    const first = await api.search('Sweetgreen', 'brand');
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.data).toEqual([
      { id: '5157E7C0-0000-4000-8000-000000000000', name: 'Sweetgreen', type: 'brand', disambiguation: null, popularity: 0.5, year: null },
    ]);
    expect(first.meta).toMatchObject({ cache: 'miss', attempts: 1, status: 200, monthRemaining: 9_000 });
    expect(first.meta.key).toMatch(/^q1:[0-9a-f]{64}$/);

    const second = await api.search('Sweetgreen', 'brand');
    expect(second.ok && second.meta).toMatchObject({ cache: 'hit', attempts: 0, cachedAt: new Date(BUILD_DAY).toISOString() });
    expect(calls).toHaveLength(1);
    expect(ctx.stats).toEqual({ fresh: 1, cached: 1, attempts: 1, guarded: 0 });
    expect(await kv.get('qloo:attempts:total')).toBe(1);
    expect(await kv.get('qloo:attempts:2026-10-27')).toBe(1);
    expect(await kv.get('qloo:month:remaining')).toBe(9_000);
  });

  it('treats an empty result as success and caches it', async () => {
    const { transport, calls } = scripted([ok({ results: [] })]);
    const api = makeClient(transport).client.forRun(run());
    const a = await api.search('zzzz', 'artist');
    const b = await api.search('zzzz', 'artist');
    expect(a.ok && a.data).toEqual([]);
    expect(b.ok && b.meta.cache).toBe('hit');
    expect(calls).toHaveLength(1);
  });

  it('caches until EVENT_DATA_EXPIRES_AT', async () => {
    const { transport } = scripted([ok()]);
    const { client, kv, clock } = makeClient(transport);
    const r = await client.forRun(run()).search('Sweetgreen', 'brand');
    expect(await kv.pttl(r.meta.key)).toBe(Date.parse(TEST_ENV.EVENT_DATA_EXPIRES_AT) - clock.t);
  });

  it('de-duplicates identical in-flight calls across runs', async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((r) => (release = r));
    const { transport, calls } = scripted([ok()]);
    const slow = {
      kind: 'live' as const,
      fetch: async (p: string, q: URLSearchParams, s: AbortSignal) => {
        await gate;
        return transport.fetch(p, q, s);
      },
    };
    const { client } = makeClient(slow);
    const a = client.forRun(run('a')).search('Sweetgreen', 'brand');
    const b = client.forRun(run('b')).search('Sweetgreen', 'brand');
    await new Promise((r) => setTimeout(r, 5));
    release();
    const [ra, rb] = await Promise.all([a, b]);
    expect(calls).toHaveLength(1);
    expect(ra.ok && ra.meta.cache).toBe('miss');
    expect(rb.ok && rb.meta.cache).toBe('hit');
  });

  it('reports one redacted provenance record per attempt (polygon label, no key)', async () => {
    const { transport } = scripted([ok({ results: { heatmap: [] } })]);
    const seen: ProvenanceRequest[] = [];
    const ctx = createRunCtx({ runId: 'p', onRequest: (r) => seen.push(r) });
    const wkt = 'POLYGON((-73.97 40.70, -73.94 40.70, -73.94 40.73, -73.97 40.73, -73.97 40.70))';
    await makeClient(transport).client.forRun(ctx).heatmap({ signals: { entities: ['b', 'a'] }, location: { wkt, label: 'NTA BK0102' } });
    expect(seen).toEqual([
      {
        method: 'GET',
        path: '/v2/insights',
        query: 'filter.type=urn:heatmap&filter.location=POLYGON(NTA BK0102)&signal.interests.entities=a,b',
        status: 200,
        cache: 'miss',
        ms: 0,
        attempt: 1,
        purpose: 'heatmap',
      },
    ]);
    expect(ctx.requests).toEqual(seen);
    expect(JSON.stringify(seen)).not.toContain('40.70');
  });

  it('rejects disallowed parameters locally before any request', async () => {
    const { transport, calls } = scripted([ok()]);
    const api = makeClient(transport).client.forRun(run());
    await expect(api.heatmap({ signals: {}, location: { query: 'NYC' } })).rejects.toThrow(QlooParamError);
    await expect(api.heatmap({ signals: { entities: ['x'] }, location: { query: 'New York' } })).rejects.toThrow(/state/);
    expect(calls).toHaveLength(0);
  });
});

describe('Qloo client — status table', () => {
  it('429 with month remaining 0 → QUOTA_EXHAUSTED, no retry, breaker until reset', async () => {
    const { transport, calls } = scripted([
      { status: 429, json: { error_msg: 'Rate limit exceeded' }, headers: monthHeaders(0, 10_000, 86_400) },
      ok(),
    ]);
    const { client, kv, sleeps } = makeClient(transport);
    const api = client.forRun(run());
    const r = await api.search('Sweetgreen', 'brand');
    expect(r).toMatchObject({ ok: false, code: 'QUOTA_EXHAUSTED', meta: { attempts: 1, status: 429, monthRemaining: 0 } });
    expect(sleeps).toEqual([]);
    expect(await kv.pttl('qloo:exhausted')).toBe(86_400_000);

    const next = await api.search('Starbucks', 'brand');
    expect(next).toMatchObject({ ok: false, code: 'BUDGET_GUARD', reason: 'exhausted', meta: { attempts: 0 } });
    expect(calls).toHaveLength(1);
    expect(await kv.get('qloo:attempts:total')).toBe(1);
  });

  it('429 without a month header but "Rate limit exceeded" → QUOTA_EXHAUSTED with a 1 h breaker', async () => {
    const { transport, calls } = scripted([{ status: 429, json: { error_msg: 'Rate limit exceeded' } }]);
    const { client, kv } = makeClient(transport);
    const r = await client.forRun(run()).search('Sweetgreen', 'brand');
    expect(r.ok === false && r.code).toBe('QUOTA_EXHAUSTED');
    expect(calls).toHaveLength(1);
    expect(await kv.pttl('qloo:exhausted')).toBe(3_600_000);
  });

  it('per-second 429 waits max(reset·1000, 1100) + jitter and retries once', async () => {
    const { transport, calls } = scripted([
      { status: 429, json: { error_msg: 'Rate limit exceeded' }, headers: { ...monthHeaders(9_000), ...secondHeaders(0, 2) } },
      ok(),
    ]);
    const { client, kv, sleeps } = makeClient(transport);
    const ctx = run();
    const r = await client.forRun(ctx).search('Sweetgreen', 'brand');
    expect(r.ok && r.meta.attempts).toBe(2);
    expect(sleeps).toEqual([2_000 + 125]);
    expect(calls).toHaveLength(2);
    expect(await kv.get('qloo:attempts:total')).toBe(2);
    expect(ctx.requests.map((q) => [q.attempt, q.status])).toEqual([
      [1, 429],
      [2, 200],
    ]);
  });

  it('per-second 429 with a short reset still waits at least 1.1 s', async () => {
    const { transport } = scripted([{ status: 429, json: { error_msg: 'Rate limit exceeded' }, headers: { ...monthHeaders(9_000), ...secondHeaders(0, 0) } }, ok()]);
    const { client, sleeps } = makeClient(transport);
    await client.forRun(run()).search('Sweetgreen', 'brand');
    expect(sleeps).toEqual([1_100 + 125]);
  });

  it('a per-second 429 header at 0 wins over the body when the month header is missing', async () => {
    const { transport, calls } = scripted([{ status: 429, json: { error_msg: 'Rate limit exceeded' }, headers: secondHeaders(0, 1) }, ok()]);
    const r = await makeClient(transport).client.forRun(run()).search('Sweetgreen', 'brand');
    expect(r.ok).toBe(true);
    expect(calls).toHaveLength(2);
  });

  it('a second per-second 429 → RATE_LIMITED after exactly two attempts', async () => {
    const limited = { status: 429, json: { error_msg: 'Rate limit exceeded' }, headers: { ...monthHeaders(9_000), ...secondHeaders(0) } };
    const { transport, calls } = scripted([limited, limited, ok()]);
    const r = await makeClient(transport).client.forRun(run()).search('Sweetgreen', 'brand');
    expect(r).toMatchObject({ ok: false, code: 'RATE_LIMITED', meta: { attempts: 2 } });
    expect(calls).toHaveLength(2);
  });

  it('guards a retry like any other attempt (a 429 that reports quota at the floor is not retried)', async () => {
    const limited = { status: 429, json: { error_msg: 'Rate limit exceeded' }, headers: { ...monthHeaders(6_000), ...secondHeaders(0) } };
    const { transport, calls } = scripted([limited, ok()]);
    const r = await makeClient(transport).client.forRun(run()).search('Sweetgreen', 'brand');
    expect(r).toMatchObject({ ok: false, code: 'BUDGET_GUARD', reason: 'floor', meta: { attempts: 1 } });
    expect(calls).toHaveLength(1);
  });

  it('scripts can disable retries (calibration aborts on any 429)', async () => {
    const limited = { status: 429, json: { error_msg: 'Rate limit exceeded' }, headers: { ...monthHeaders(9_000), ...secondHeaders(0) } };
    const { transport, calls } = scripted([limited, ok()]);
    const ctx = createRunCtx({ runId: 's', actor: 'script', retries: false });
    const r = await makeClient(transport).client.forRun(ctx).search('Sweetgreen', 'brand');
    expect(r.ok === false && r.code).toBe('RATE_LIMITED');
    expect(calls).toHaveLength(1);
  });

  it('5xx is retried once after 0.8–1.5 s; a second 5xx → UPSTREAM', async () => {
    const a = scripted([{ status: 503 }, ok()]);
    const ca = makeClient(a.transport);
    const ra = await ca.client.forRun(run()).search('Sweetgreen', 'brand');
    expect(ra.ok && ra.meta.attempts).toBe(2);
    expect(ca.sleeps).toEqual([800 + 350]);

    const b = scripted([{ status: 500 }, { status: 502 }, ok()]);
    const rb = await makeClient(b.transport).client.forRun(run()).search('Sweetgreen', 'brand');
    expect(rb).toMatchObject({ ok: false, code: 'UPSTREAM', meta: { attempts: 2, status: 502 } });
    expect(b.calls).toHaveLength(2);
  });

  it('5xx is not retried when less than 8 s of the stage budget would remain', async () => {
    const tight = scripted([{ status: 500 }, ok()]);
    const c1 = makeClient(tight.transport);
    const r1 = await c1.client.forRun(createRunCtx({ runId: 't', deadlineAt: c1.clock.t + 9_000 })).search('Sweetgreen', 'brand');
    expect(r1).toMatchObject({ ok: false, code: 'UPSTREAM', meta: { attempts: 1 } });
    expect(tight.calls).toHaveLength(1);

    const roomy = scripted([{ status: 500 }, ok()]);
    const c2 = makeClient(roomy.transport);
    const r2 = await c2.client.forRun(createRunCtx({ runId: 'r', deadlineAt: c2.clock.t + 10_000 })).search('Sweetgreen', 'brand');
    expect(r2.ok).toBe(true);
    expect(roomy.calls).toHaveLength(2);
  });

  it('a timeout is retried once, then reported as TIMEOUT', async () => {
    const { transport, calls } = scripted([{ status: 0, fail: 'hang' }]);
    const r = await makeClient(transport).client.forRun(run()).search('Sweetgreen', 'brand', { timeoutMs: 20 });
    expect(r).toMatchObject({ ok: false, code: 'TIMEOUT', meta: { attempts: 2, status: null } });
    expect(calls).toHaveLength(2);
  });

  it('a network error is retried once', async () => {
    const { transport, calls } = scripted([{ status: 0, fail: new TypeError('fetch failed') }, ok()]);
    const r = await makeClient(transport).client.forRun(run()).search('Sweetgreen', 'brand');
    expect(r.ok).toBe(true);
    expect(calls).toHaveLength(2);
  });

  it('401 → AUTH without retry; the auth breaker blocks calls for 10 minutes', async () => {
    const { transport, calls } = scripted([{ status: 401, json: { message: 'Unauthorized' } }, ok()]);
    const { client, kv, clock } = makeClient(transport);
    const api = client.forRun(run());
    expect(await api.search('Sweetgreen', 'brand')).toMatchObject({ ok: false, code: 'AUTH', meta: { attempts: 1 } });
    expect(await kv.pttl('qloo:auth_fail')).toBe(600_000);
    expect(await api.search('Starbucks', 'brand')).toMatchObject({ ok: false, code: 'BUDGET_GUARD', reason: 'auth' });
    expect(calls).toHaveLength(1);
    clock.t += 600_001;
    expect((await api.search('Starbucks', 'brand')).ok).toBe(true);
    expect(calls).toHaveLength(2);
  });

  it('403 "permission to access urn:entity:…" → TYPE_UNSUPPORTED (not AUTH), remembered for that type only', async () => {
    const { transport, calls } = scripted([
      { status: 403, json: { message: 'You do not have permission to access urn:entity:podcast' } },
      ok(),
    ]);
    const { client, kv } = makeClient(transport);
    const api = client.forRun(run());
    expect(await api.search('Some Podcast', 'podcast')).toMatchObject({ ok: false, code: 'TYPE_UNSUPPORTED', meta: { attempts: 1 } });
    expect(await kv.get('qloo:auth_fail')).toBeNull();
    expect(await api.search('Another Podcast', 'podcast')).toMatchObject({ ok: false, code: 'TYPE_UNSUPPORTED', meta: { attempts: 0 } });
    expect(calls).toHaveLength(1);
    expect((await api.search('Sweetgreen', 'brand')).ok).toBe(true);
    expect(calls).toHaveLength(2);
  });

  it('any other 403 → FORBIDDEN without retry', async () => {
    const { transport, calls } = scripted([{ status: 403, json: { message: 'Forbidden' } }]);
    const r = await makeClient(transport).client.forRun(run()).search('Sweetgreen', 'brand');
    expect(r).toMatchObject({ ok: false, code: 'FORBIDDEN', message: 'Forbidden' });
    expect(calls).toHaveLength(1);
  });

  it('400 → BAD_REQUEST with Qloo messages and paths, no retry', async () => {
    const { transport, calls } = scripted([
      { status: 400, json: { errors: [{ message: 'filter.location is invalid', path: ['filter', 'location'] }] } },
    ]);
    const r = await makeClient(transport).client.forRun(run()).search('Sweetgreen', 'brand');
    expect(r).toMatchObject({
      ok: false,
      code: 'BAD_REQUEST',
      message: 'filter.location is invalid',
      issues: [{ message: 'filter.location is invalid', path: 'filter.location' }],
      meta: { attempts: 1 },
    });
    expect(calls).toHaveLength(1);
  });

  it('a 200 whose body does not fit the schema → BAD_RESPONSE, not cached', async () => {
    const { transport, calls } = scripted([ok({ unexpected: true })]);
    const { client, kv } = makeClient(transport);
    const r = await client.forRun(run()).search('Sweetgreen', 'brand');
    expect(r.ok === false && r.code).toBe('BAD_RESPONSE');
    expect(await kv.get(r.meta.key)).toBeNull();
    expect(calls).toHaveLength(1);
  });

  it('an aborted run → ABORTED without spending an attempt; aborting mid-flight is not retried', async () => {
    const idle = scripted([ok()]);
    const controller = new AbortController();
    controller.abort();
    const r = await makeClient(idle.transport).client.forRun(createRunCtx({ runId: 'x', signal: controller.signal })).search('Sweetgreen', 'brand');
    expect(r).toMatchObject({ ok: false, code: 'ABORTED', meta: { attempts: 0 } });
    expect(idle.calls).toHaveLength(0);

    const hang = scripted([{ status: 0, fail: 'hang' }, ok()]);
    const live = new AbortController();
    const pending = makeClient(hang.transport).client.forRun(createRunCtx({ runId: 'y', signal: live.signal })).search('Sweetgreen', 'brand');
    setTimeout(() => live.abort(), 5);
    expect(await pending).toMatchObject({ ok: false, code: 'ABORTED', meta: { attempts: 1 } });
    expect(hang.calls).toHaveLength(1);
  });
});

describe('Qloo client — budget guard', () => {
  it('enforces the per-run fresh-attempt cap', async () => {
    const { transport, calls } = scripted([ok()]);
    const { client } = makeClient(transport);
    const ctx = createRunCtx({ runId: 'cap', maxFresh: 2 });
    const api = client.forRun(ctx);
    await api.search('A', 'brand');
    await api.search('B', 'brand');
    expect(await api.search('C', 'brand')).toMatchObject({ ok: false, code: 'BUDGET_GUARD', reason: 'run_cap' });
    expect(calls).toHaveLength(2);
    expect(ctx.stats).toMatchObject({ fresh: 2, attempts: 2, guarded: 1 });
  });

  it('enforces the ET daily cap; a forced script may pass it', async () => {
    const { transport, calls } = scripted([ok()]);
    const { client, kv } = makeClient(transport);
    await kv.set('qloo:attempts:2026-10-27', 400);
    expect(await client.forRun(run()).search('A', 'brand')).toMatchObject({ ok: false, reason: 'daily_cap' });
    const forced = createRunCtx({ runId: 'script', actor: 'script', force: true });
    expect((await client.forRun(forced).search('A', 'brand')).ok).toBe(true);
    // A public run cannot opt into force.
    expect(createRunCtx({ runId: 'pub', force: true }).force).toBe(false);
    expect(calls).toHaveLength(1);
  });

  it('stops fresh public calls at the phase floor (build: 6,500); force uses the absolute floor 300', async () => {
    const { transport, calls } = scripted([ok(undefined, monthHeaders(6_400))]);
    const { client, kv } = makeClient(transport);
    await kv.set('qloo:month:remaining', 6_500);
    expect(await client.forRun(run()).search('A', 'brand')).toMatchObject({ ok: false, code: 'BUDGET_GUARD', reason: 'floor' });
    await kv.set('qloo:month:remaining', 6_501);
    expect((await client.forRun(run('b')).search('A', 'brand')).ok).toBe(true);
    expect(await kv.get('qloo:month:remaining')).toBe(6_400);
    expect((await client.forRun(createRunCtx({ runId: 's', actor: 'script', force: true })).search('B', 'brand')).ok).toBe(true);
    await kv.set('qloo:month:remaining', 300);
    expect(await client.forRun(createRunCtx({ runId: 's2', actor: 'script', force: true })).search('C', 'brand')).toMatchObject({ reason: 'floor' });
    expect(calls).toHaveLength(2);
  });

  it('after the finale only cached results are served', async () => {
    const { transport, calls } = scripted([ok()]);
    const clock = { t: BUILD_DAY };
    const kv = new MemoryKV(() => clock.t);
    await makeClient(transport, { kv }).client.forRun(run()).search('Sweetgreen', 'brand');
    clock.t = Date.parse('2026-11-06T05:00:00Z');
    const api = makeClient(transport, { kv, start: clock.t }).client.forRun(run('late'));
    expect((await api.search('Sweetgreen', 'brand')).ok).toBe(true);
    expect(await api.search('Other', 'brand')).toMatchObject({ ok: false, reason: 'after_event' });
    expect(calls).toHaveLength(1);
  });

  it('honours the runtime switch cfg:qloo:mode=cache-only', async () => {
    const { transport, calls } = scripted([ok()]);
    const { client, kv } = makeClient(transport);
    await client.forRun(run()).search('Sweetgreen', 'brand');
    await kv.set('cfg:qloo:mode', 'cache-only');
    expect((await client.forRun(run('b')).search('Sweetgreen', 'brand')).ok).toBe(true);
    expect(await client.forRun(run('c')).search('New', 'brand')).toMatchObject({ ok: false, reason: 'mode' });
    expect(calls).toHaveLength(1);
  });

  it('limits concurrent runs with KV slots; a third run gets BUSY until a slot is released', async () => {
    const { transport } = scripted([ok()]);
    const { client } = makeClient(transport, { slotWaitMs: 1_000 });
    const [a, b, c] = ['a', 'b', 'c'].map((id) => createRunCtx({ runId: id }));
    expect((await client.forRun(a!).search('A', 'brand')).ok).toBe(true);
    expect((await client.forRun(b!).search('B', 'brand')).ok).toBe(true);
    expect(await client.forRun(c!).search('C', 'brand')).toMatchObject({ ok: false, code: 'BUSY' });
    await client.releaseRun(a!);
    expect((await client.forRun(c!).search('C', 'brand')).ok).toBe(true);
  });
});

describe('Qloo client — modes and namespaces', () => {
  it('keeps synthetic data and its quota under syn: keys', async () => {
    const mock = createMockTransport({ grid: { cells: ['dr5ru7'] } });
    const { client, kv } = makeClient(mock);
    const r = await client.forRun(run()).search('Sweetgreen', 'brand');
    expect(client.synthetic).toBe(true);
    expect(r.meta.key).toMatch(/^syn:q1:/);
    expect(await kv.get('syn:qloo:attempts:total')).toBe(1);
    expect(await kv.get('qloo:attempts:total')).toBeNull();
  });

  it('cache-only serves the live cache and refuses misses; off is DISABLED', async () => {
    const { transport } = scripted([ok()]);
    const kv = new MemoryKV(() => BUILD_DAY);
    await makeClient(transport, { kv }).client.forRun(run()).search('Sweetgreen', 'brand');
    const cacheOnly = makeClient(null, { kv, mode: 'cache-only' }).client.forRun(run('c'));
    expect((await cacheOnly.search('Sweetgreen', 'brand')).ok).toBe(true);
    expect(await cacheOnly.search('Other', 'brand')).toMatchObject({ ok: false, code: 'CACHE_ONLY' });
    const off = makeClient(null, { kv, mode: 'off' }).client.forRun(run('o'));
    expect(await off.search('Sweetgreen', 'brand')).toMatchObject({ ok: false, code: 'DISABLED' });
  });

  it('runCtxFor gives every stage of a run the same context', () => {
    const step = { runId: 'r', signal: new AbortController().signal, onRequest: () => undefined };
    expect(runCtxFor(step)).toBe(runCtxFor(step));
    expect(runCtxFor({ ...step })).not.toBe(runCtxFor(step));
  });

  it('classifies failures for the product', () => {
    expect(failureKind({ code: 'QUOTA_EXHAUSTED' })).toBe('quota');
    expect(failureKind({ code: 'BUDGET_GUARD', reason: 'floor' })).toBe('quota');
    expect(failureKind({ code: 'BUDGET_GUARD', reason: 'auth' })).toBe('unavailable');
    expect(failureKind({ code: 'TIMEOUT' })).toBe('unavailable');
    expect(failureKind({ code: 'BAD_REQUEST' })).toBe('request');
  });

  it('normalizes the raw /search search body into candidates only', async () => {
    const { transport } = scripted([ok(searchBody('Solaris', 'Solaris II'))]);
    const r = await makeClient(transport).client.forRun(run()).search('Solaris', 'brand');
    expect(r.ok && r.data.map((c) => c.name)).toEqual(['Solaris', 'Solaris II']);
    expect(r.ok && Object.keys(r.data[0]!).sort()).toEqual(['disambiguation', 'id', 'name', 'popularity', 'type', 'year']);
  });
});
