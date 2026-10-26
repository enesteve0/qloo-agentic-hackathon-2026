import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { presetRun } from '@/server/agent/presets';
import { resetEnvForTests } from '@/server/env';
import { MemoryKV, setKvForTests } from '@/server/kv';
import { resetQlooClientForTests } from '@/server/qloo';
import { savePreset } from '@/server/store/runs';

describe('presetRun', () => {
  beforeAll(() => {
    vi.stubEnv('QLOO_RUN_RPS', '50');
    resetEnvForTests();
    resetQlooClientForTests();
    setKvForTests(new MemoryKV());
  });
  afterAll(() => {
    vi.unstubAllEnvs();
    resetEnvForTests();
    resetQlooClientForTests();
    setKvForTests(undefined);
  });

  it('makes a synthetic plan once for an unrecorded preset and reuses it', async () => {
    const [a, b] = await Promise.all([presetRun('smoke-and-sons'), presetRun('smoke-and-sons')]);
    expect(a?.status).toBe('done');
    expect(a?.label).toEqual({ kind: 'synthetic' });
    expect(a?.presetSlug).toBe('smoke-and-sons');
    expect(b?.id).toBe(a?.id);
    expect((await presetRun('smoke-and-sons'))?.createdAt).toBe(a?.createdAt);
  });

  it('prefers the recorded run and ignores unknown slugs', async () => {
    const synthetic = await presetRun('halfnote');
    await savePreset('halfnote', { ...synthetic!, label: { kind: 'recorded', at: '2026-10-28T12:00:00Z', model: 'm', qlooCalls: 9 } });
    expect((await presetRun('halfnote'))?.label?.kind).toBe('recorded');
    expect(await presetRun('no-such-preset')).toBeNull();
  });
});
