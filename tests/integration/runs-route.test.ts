import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

// `after()` needs a Next.js request scope; in tests the run promise is simply awaited by the stream.
vi.mock('next/server', async (importOriginal) => {
  const mod = await importOriginal<typeof import('next/server')>();
  return { ...mod, after: (task: unknown) => void (task instanceof Promise ? task.catch(() => undefined) : undefined) };
});

import { POST } from '@/app/api/runs/route';
import { PRESETS } from '@/content/presets';
import { createRunDeps } from '@/server/agent/deps-live';
import { executeRun, newRunState } from '@/server/agent/orchestrator';
import { resetEnvForTests } from '@/server/env';
import { MemoryKV, setKvForTests } from '@/server/kv';
import { resetQlooClientForTests } from '@/server/qloo';
import { loadRun, saveRun } from '@/server/store/runs';
import { applyPart, emptyRunView, readUiMessageSse, type RunView } from '@/shared/stream';
import type { Brief, PlannerOutput } from '@/shared/types';

const brief = (business: string): Brief => ({ ...PRESETS[0]!.brief, business });

function post(body: unknown, headers: Record<string, string> = {}) {
  return POST(
    new Request('http://localhost:3000/api/runs', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'sec-fetch-site': 'same-origin', ...headers },
      body: JSON.stringify(body),
    }),
  );
}

async function read(res: Response): Promise<RunView> {
  expect(res.headers.get('content-type')).toContain('text/event-stream');
  let view = emptyRunView();
  for await (const part of readUiMessageSse(res.body!)) view = applyPart(view, part);
  return view;
}

describe('POST /api/runs', () => {
  let cookie = '';

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

  it('rejects cross-site posts and invalid briefs without starting anything', async () => {
    expect((await post({ mode: 'start', brief: brief('Halfnote') }, { 'sec-fetch-site': 'cross-site' })).status).toBe(403);
    const bad = await post({ mode: 'start', brief: { business: 'x', description: 'short', budgetUsd: 5, weeks: 0 } });
    expect(bad.status).toBe(400);
    const body = (await bad.json()) as { errors: string[] };
    expect(body.errors.length).toBeGreaterThan(0);
    const housing = await post({ mode: 'start', brief: { ...brief('Park Lofts'), description: 'Two-bedroom apartments for rent near the park' } });
    expect(housing.status).toBe(422);
    expect(((await housing.json()) as { error: string }).error).toMatch(/fair-housing/);
  });

  it('streams a new plan, saves it and sets a session cookie', async () => {
    const res = await post({ mode: 'start', brief: brief('Halfnote Supper Club'), presetSlug: 'halfnote' });
    cookie = (res.headers.get('set-cookie') ?? '').split(';')[0]!;
    expect(cookie).toMatch(/^stoop_sid=/);
    const runId = res.headers.get('x-run-id')!;
    const view = await read(res);
    expect(view.done).toBe(true);
    expect(view.state?.id).toBe(runId);
    expect(view.state?.status).toBe('done');
    expect(view.state?.label).toEqual({ kind: 'synthetic' });
    expect((await loadRun(runId))?.status).toBe('done');
  });

  it('serves an identical brief from the saved run, labelled cached', async () => {
    const view = await read(await post({ mode: 'start', brief: brief('Halfnote Supper Club') }, { cookie }));
    expect(view.done).toBe(true);
    expect(view.state?.label?.kind).toBe('cached');
    expect(view.state?.plan).not.toBeNull();
  });

  it('answers a session over its live-run limit with a labelled sample plan, not an error', async () => {
    for (const name of ['Second Spot', 'Third Spot']) {
      const view = await read(await post({ mode: 'start', brief: brief(name) }, { cookie }));
      expect(view.fallback).toBeNull();
      expect(view.state?.status).toBe('done');
    }
    const view = await read(await post({ mode: 'start', brief: brief('Fourth Spot') }, { cookie }));
    expect(view.fallback?.reason).toBe('limits');
    expect(view.fallback?.presetSlug).toBe('halfnote');
    expect(view.done).toBe(true);
    expect(view.state?.status).toBe('done');
    expect(view.state?.brief.business).toBe('Halfnote Supper Club');
  });

  it('resumes a paused run with the owner’s answer', async () => {
    const base = createRunDeps({ qloo: 'mock', llm: 'mock', country: 'US' });
    const planned: PlannerOutput = {
      business: { name: 'Film Club', category: 'cinema bar', offer: null },
      audienceSummary: 'Film lovers',
      anchors: [
        { name: 'Solaris', type: 'movie', searchHint: null, why: 'art-house' },
        { name: 'Robert Glasper', type: 'artist', searchHint: null, why: 'jazz' },
        { name: 'Esperanza Spalding', type: 'artist', searchHint: null, why: 'jazz' },
      ],
      tone: 'warm',
      llmOnlyNeighborhoods: [],
      budgetUsd: 2000,
      weeks: 3,
      fallback: false,
    };
    const deps = { ...base, planner: async () => ({ output: planned, via: 'test', attempts: 0 }) };
    const paused = await executeRun(newRunState({ id: 'routeresume1', brief: brief('Film Club'), mode: 'mock', now: new Date() }), () => {}, deps, {
      country: 'US',
      persist: saveRun,
    });
    expect(paused.status).toBe('awaiting_input');
    const issue = paused.resolution!.issues[0]!;

    const wrong = await post({ mode: 'resume', runId: paused.id, choices: [{ input: issue.input, entityId: 'not-a-candidate' }] }, { cookie });
    expect(wrong.status).toBe(400);

    const view = await read(await post({ mode: 'resume', runId: paused.id, choices: [{ input: issue.input, entityId: issue.candidates[0]!.id }] }, { cookie }));
    expect(view.done).toBe(true);
    expect(view.state?.status).toBe('done');
    expect(view.state?.decisions.length).toBeGreaterThan(3); // kept the plan stage's decisions from before the pause

    const again = await post({ mode: 'resume', runId: paused.id, choices: [] }, { cookie });
    expect(again.status).toBe(409);
  });
});
