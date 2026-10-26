import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('next/server', async (importOriginal) => {
  const mod = await importOriginal<typeof import('next/server')>();
  return { ...mod, after: (task: unknown) => void (task instanceof Promise ? task.catch(() => undefined) : undefined) };
});

// While `full` is set, runs hit full Qloo slots at WHERE (the sample plan is generated before that).
const slots = vi.hoisted(() => ({ full: false }));
vi.mock('@/server/agent/deps-live', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@/server/agent/deps-live')>();
  const { UserFacingError } = await import('@/server/agent/errors');
  return {
    ...mod,
    createRunDeps: (o: Parameters<typeof mod.createRunDeps>[0]) => {
      const deps = mod.createRunDeps(o);
      if (!slots.full) return deps;
      return {
        ...deps,
        where: async () => {
          throw new UserFacingError('Lots of people are planning right now.', 'qloo_busy');
        },
      };
    },
  };
});

import { POST } from '@/app/api/runs/route';
import { PRESETS } from '@/content/presets';
import { presetRun } from '@/server/agent/presets';
import { resetEnvForTests } from '@/server/env';
import { MemoryKV, setKvForTests } from '@/server/kv';
import { resetQlooClientForTests } from '@/server/qloo';
import { loadRun } from '@/server/store/runs';
import { applyPart, emptyRunView, readUiMessageSse } from '@/shared/stream';

describe('a live run that runs out of capacity mid-way', () => {
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

  it('ends with a labelled sample plan instead of an error', async () => {
    expect((await presetRun('halfnote'))?.status).toBe('done');
    slots.full = true;
    const res = await POST(
      new Request('http://localhost:3000/api/runs', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'sec-fetch-site': 'same-origin' },
        body: JSON.stringify({ mode: 'start', brief: { ...PRESETS[0]!.brief, business: 'Busy Night Jazz' } }),
      }),
    );
    const runId = res.headers.get('x-run-id')!;
    let view = emptyRunView();
    for await (const part of readUiMessageSse(res.body!)) view = applyPart(view, part);
    slots.full = false;

    expect(view.fallback?.reason).toBe('busy');
    expect(view.state?.status).toBe('done');
    expect(view.state?.presetSlug).toBe('halfnote');
    expect(view.state?.brief.business).toBe('Halfnote Supper Club');
    expect(view.extras?.send?.csvHref).toBe('/api/export?preset=halfnote');
    // The failed live run is still saved, with a machine-readable reason.
    const failed = await loadRun(runId);
    expect(failed?.status).toBe('error');
    expect(failed?.errorCode).toBe('qloo_busy');
  });
});
