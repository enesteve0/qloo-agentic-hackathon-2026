import { afterEach, describe, expect, it } from 'vitest';
import { resetEnvForTests } from '@/server/env';
import { MemoryKV, setKvForTests } from '@/server/kv';
import { createRunCtx, getQlooClient, resetQlooClientForTests } from '@/server/qloo';

const saved = { mode: process.env.QLOO_MODE, key: process.env.QLOO_API_KEY };

function useMode(mode: string, key?: string) {
  process.env.QLOO_MODE = mode;
  if (key === undefined) delete process.env.QLOO_API_KEY;
  else process.env.QLOO_API_KEY = key;
  resetEnvForTests();
  resetQlooClientForTests();
  setKvForTests(new MemoryKV());
}

afterEach(() => {
  process.env.QLOO_MODE = saved.mode;
  if (saved.key === undefined) delete process.env.QLOO_API_KEY;
  else process.env.QLOO_API_KEY = saved.key;
  resetEnvForTests();
  resetQlooClientForTests();
  setKvForTests(undefined);
});

describe('getQlooClient', () => {
  it('uses the synthetic transport in mock mode and keeps one client per process', async () => {
    useMode('mock');
    const client = getQlooClient();
    expect(client).toBe(getQlooClient());
    expect(client).toMatchObject({ mode: 'mock', synthetic: true });
    const r = await client.forRun(createRunCtx({ runId: 'i' })).search('Solaris', 'movie');
    expect(r.ok && r.data).toHaveLength(2);
  });

  it('refuses live mode without a key', () => {
    useMode('live');
    expect(() => getQlooClient()).toThrow(/QLOO_API_KEY/);
  });

  it('builds a live client when a key is configured (no call is made here)', () => {
    useMode('live', 'test-key-not-real');
    expect(getQlooClient()).toMatchObject({ mode: 'live', synthetic: false });
  });

  it('serves only cached results in cache-only mode and nothing when off', async () => {
    useMode('cache-only');
    const cacheOnly = await getQlooClient().forRun(createRunCtx({ runId: 'c' })).search('Solaris', 'movie');
    expect(cacheOnly).toMatchObject({ ok: false, code: 'CACHE_ONLY' });
    useMode('off');
    const off = await getQlooClient().forRun(createRunCtx({ runId: 'o' })).search('Solaris', 'movie');
    expect(off).toMatchObject({ ok: false, code: 'DISABLED', message: 'Qloo is turned off (QLOO_MODE=off).' });
  });
});
