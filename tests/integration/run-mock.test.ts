import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PRESETS } from '@/content/presets';
import { createRunDeps } from '@/server/agent/deps-live';
import { executeRun, newRunState } from '@/server/agent/orchestrator';
import { resetEnvForTests } from '@/server/env';
import { MemoryKV, setKvForTests } from '@/server/kv';
import { resetQlooClientForTests } from '@/server/qloo';
import { slotKey } from '@/server/qloo/pacing';
import { applyPart, emptyRunView, type StoopPart } from '@/shared/stream';
import type { PlannerOutput, RunState } from '@/shared/types';

const halfnote = PRESETS.find((p) => p.slug === 'halfnote')!;

async function run(state: RunState, deps = createRunDeps({ qloo: 'mock', llm: 'mock', country: 'US' }), choices?: { input: string; entityId: string | null }[]) {
  const parts: StoopPart[] = [];
  const saved: RunState[] = [];
  const final = await executeRun(state, (p) => parts.push(p), deps, {
    country: 'US',
    choices,
    persist: async (s) => {
      saved.push(structuredClone(s));
    },
  });
  return { final, parts, saved };
}

describe('mock run end to end (synthetic Qloo + deterministic writer)', () => {
  let store: MemoryKV;
  beforeEach(() => {
    store = new MemoryKV();
    setKvForTests(store);
    resetEnvForTests();
    resetQlooClientForTests();
  });
  afterEach(() => setKvForTests(undefined));

  it('plans a preset brief into a complete, labelled, grounded plan', async () => {
    const state = newRunState({ id: 'mockrun00001', brief: halfnote.brief, mode: 'mock', presetSlug: 'halfnote', now: new Date() });
    let { final, parts } = await run(state);
    if (final.status === 'awaiting_input') {
      const choices = (final.resolution?.issues ?? []).map((i) => ({ input: i.input, entityId: i.candidates[0]?.id ?? null }));
      ({ final, parts } = await run(final, undefined, choices));
    }

    expect(final.error).toBeNull();
    expect(final.status).toBe('done');
    expect(final.label).toEqual({ kind: 'synthetic' });
    expect(final.stages.every((s) => ['done', 'degraded'].includes(s.status))).toBe(true);

    // WHERE: ranked neighborhoods and scored screens.
    expect(final.where?.ntas.length).toBeGreaterThan(10);
    expect(final.where?.kioskFit).toHaveLength(2183);
    // WHAT: three neighborhoods, two grounded variants each.
    expect(final.evidence).toHaveLength(3);
    expect(final.creative).toHaveLength(3);
    for (const set of final.creative) {
      expect(set.variants.map((v) => v.variant).sort()).toEqual(['A', 'B']);
      for (const v of set.variants) {
        expect(v.grounding.ok).toBe(true);
        expect(v.headline.length).toBeLessThanOrEqual(38);
        expect(`${v.headline} ${v.body} ${v.cta}`).toContain('Halfnote');
      }
    }
    // PLAN: within budget, at least one screen in every top neighborhood.
    expect(final.plan?.totals.spend).toBeLessThanOrEqual(halfnote.brief.budgetUsd);
    expect(final.plan?.byNta.length).toBe(3);
    // PROOF and provenance.
    expect(final.proof?.note).toMatch(/circular/);
    expect(final.envelopes.map((e) => e.operation).sort()).toEqual(['map_taste_lift', 'neighborhood_evidence', 'resolve_anchors']);
    expect(final.envelopes.every((e) => e.provenance.source === 'Synthetic Qloo transport')).toBe(true);
    expect(final.qlooCalls.fresh + final.qlooCalls.cached).toBeGreaterThan(0);
    expect(final.qlooCalls.fresh).toBeLessThanOrEqual(20);

    // The run gave its cross-run Qloo slot back, so the next plan doesn't wait for it to expire.
    expect(await store.mget([0, 1, 2, 3].map((n) => slotKey('syn:', n)))).toEqual([null, null, null, null]);

    // The client view rebuilt from the stream matches the saved run.
    const view = parts.reduce((v, p) => applyPart(v, p), emptyRunView());
    expect(view.done).toBe(true);
    expect(view.state?.plan?.totals).toEqual(final.plan?.totals);
    expect(view.state?.creative.length).toBe(3);
  });

  it('asks one question for an ambiguous anchor and resumes with the answer', async () => {
    const base = createRunDeps({ qloo: 'mock', llm: 'mock', country: 'US' });
    const planned: PlannerOutput = {
      business: { name: 'Halfnote Supper Club', category: 'jazz supper club', offer: null },
      audienceSummary: 'Jazz and film lovers',
      anchors: [
        { name: 'Solaris', type: 'movie', searchHint: null, why: 'art-house film' },
        { name: 'Robert Glasper', type: 'artist', searchHint: null, why: 'modern jazz' },
        { name: 'Esperanza Spalding', type: 'artist', searchHint: null, why: 'modern jazz' },
      ],
      tone: 'warm',
      llmOnlyNeighborhoods: [],
      budgetUsd: 2000,
      weeks: 3,
      fallback: false,
    };
    const deps = { ...base, planner: async () => ({ output: planned, via: 'test', attempts: 0 }) };
    const state = newRunState({ id: 'mockrun00002', brief: halfnote.brief, mode: 'mock', now: new Date() });

    const paused = await run(state, deps);
    expect(paused.final.status).toBe('awaiting_input');
    const issue = paused.final.resolution?.issues.find((i) => i.input === 'Solaris');
    expect(issue?.kind).toBe('ambiguous');
    expect(issue?.candidates.length).toBeGreaterThanOrEqual(2);
    expect(paused.parts.some((p) => p.type === 'data-needsInput')).toBe(true);
    expect(paused.final.stages.find((s) => s.stage === 'resolve')?.status).toBe('needs_input');

    const pick = issue!.candidates[1]!;
    const resumed = await run(paused.final, deps, [{ input: 'Solaris', entityId: pick.id }]);
    expect(resumed.final.status).toBe('done');
    const solaris = resumed.final.resolution?.outcomes.find((o) => o.input === 'Solaris');
    expect(solaris?.status === 'resolved' && solaris.selected.id).toBe(pick.id);
    // Never a second question in the same run.
    expect(resumed.parts.some((p) => p.type === 'data-needsInput')).toBe(false);
  });
});
