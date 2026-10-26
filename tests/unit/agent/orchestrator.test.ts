import { describe, expect, it } from 'vitest';
import type { RunDeps } from '@/server/agent/deps';
import { executeRun, newRunState } from '@/server/agent/orchestrator';
import type { StoopPart } from '@/shared/stream';
import type { Brief, Candidate, MediaPlan, NtaScore, PlannerOutput, StageEnvelope, WhereResult } from '@/shared/types';

const brief: Brief = {
  business: 'Halfnote Supper Club',
  description: 'A 48-seat jazz supper club opening on Nostrand Ave',
  offer: 'Free first set on Tuesdays',
  budgetUsd: 2000,
  weeks: 3,
  startDate: null,
  address: null,
};

const envelope = (operation: StageEnvelope['operation']): StageEnvelope => ({
  operation,
  status: 'ok',
  query_intent: { job: 'x', target: 'y', signals: [], filters: [], assumptions: [], unresolved: [] },
  interpretation: 'synthetic',
  result_count: 1,
  execution: { transport: 'mock', correlation_id: 'c', duration_ms: 1 },
  provenance: { source: 'Synthetic Qloo transport', requests: [] },
  what_this_supports: 'synthetic',
  warnings: [],
});

const planner: PlannerOutput = {
  business: { name: 'Halfnote Supper Club', category: 'jazz supper club', offer: null },
  audienceSummary: 'Jazz lovers',
  anchors: [
    { name: 'Robert Glasper', type: 'artist', searchHint: null, why: 'modern jazz' },
    { name: 'Soul', type: 'movie', searchHint: '2020', why: 'jazz film' },
    { name: 'Blue Note Jazz Club', type: 'place', searchHint: 'New York', why: 'jazz venue' },
  ],
  tone: 'warm',
  llmOnlyNeighborhoods: [{ ntaCode: 'MN0603', reason: 'busy' }],
  budgetUsd: 2000,
  weeks: 3,
  fallback: false,
};

const cand = (id: string, name: string, type: Candidate['type']): Candidate => ({ id, name, type, disambiguation: null, popularity: 0.9, year: null });

const nta = (code: string, lift: number): NtaScore => ({
  code,
  name: code,
  short: code,
  boro: 'Brooklyn',
  lift,
  se: 0.2,
  nEff: 5,
  agreement: 1,
  confidence: 'high',
  fitIndex: 90,
  multiplier: 2,
  topAnchors: [],
  adKiosks: 5,
});

const where: WhereResult = {
  config: {
    metric: 'affinity',
    baseline: 'B4',
    form: 'difference',
    kappa: 1.5,
    thresholds: { defaultMapRho: 0.98, identicalRho: 0.999, densityOnlyRho: 0.99, thinMinCells: 300, thinMinOverlap: 0.5 },
    experimental: false,
  },
  anchors: [],
  ntas: [nta('BK0302', 1.2), nta('BK0301', 0.9), nta('MN0303', 0.5)],
  kioskFit: [90, 80, -1],
  heat: [],
  grid: { cells: 3, covered: 3 },
};

const plan: MediaPlan = {
  budgetUsd: 2000,
  weeks: 3,
  assumptions: { label: 'assumption', pricePerKioskWeek: { manhattan: 100, outer: 60 }, impressionsPerKioskWeek: { manhattan: 1, outer: 1 } },
  screens: [],
  byNta: [{ nta: 'BK0302', screens: 2, spend: 360, tasteWeightedImpressions: 10 }],
  totals: { spend: 360, impressions: 2, tasteWeightedImpressions: 10, screens: 2 },
  leftoverUsd: 1640,
  nextBest: [],
  infeasibleReason: null,
};

function fakeDeps(overrides: Partial<RunDeps> = {}): RunDeps {
  let t = Date.parse('2026-10-28T15:00:00Z');
  return {
    mode: 'mock',
    now: () => new Date((t += 10)),
    eligibleNtas: [],
    planner: async () => ({ output: planner, via: 'groq/gpt-oss-20b', attempts: 1 }),
    resolve: async ({ choices }) => {
      const soulChosen = choices.find((c) => c.input === 'Soul');
      const outcomes = [
        { input: 'Robert Glasper', type: 'artist' as const, status: 'resolved' as const, match: 'exact' as const, selected: cand('a1', 'Robert Glasper', 'artist'), alternatives: [], warnings: [] },
        soulChosen
          ? { input: 'Soul', type: 'movie' as const, status: 'resolved' as const, match: 'chosen' as const, selected: cand('m1', 'Soul', 'movie'), alternatives: [], warnings: [] }
          : { input: 'Soul', type: 'movie' as const, status: 'ambiguous' as const, candidates: [cand('m1', 'Soul', 'movie'), cand('m2', 'Soul', 'movie')] },
        { input: 'Blue Note Jazz Club', type: 'place' as const, status: 'resolved' as const, match: 'exact' as const, selected: cand('p1', 'Blue Note', 'place'), alternatives: [], warnings: [] },
      ];
      const issues = soulChosen ? [] : [{ input: 'Soul', type: 'movie' as const, kind: 'ambiguous' as const, question: 'Which Soul?', candidates: [] }];
      return { outcomes, issues, envelope: envelope('resolve_anchors') };
    },
    where: async ({ ctx }) => {
      ctx.onRequest({ method: 'GET', path: '/v2/insights', query: 'filter.type=urn:heatmap', status: 200, cache: 'miss', ms: 5, attempt: 1, purpose: 'heatmap' });
      return { result: where, narration: ['Set aside nothing.'], envelope: envelope('map_taste_lift') };
    },
    evidence: async ({ ntas }) => ({
      packs: ntas.map((n) => ({ nta: n.code, shortName: n.short, items: [], places: [] })),
      envelope: envelope('neighborhood_evidence'),
    }),
    creative: async ({ packs }) => ({
      sets: packs.map((p) => ({ nta: p.nta, variants: [], via: 'groq/gpt-oss-120b' })),
      via: 'groq/gpt-oss-120b',
      attempts: 1,
    }),
    plan: () => plan,
    proof: () => ({
      available: true,
      llmPicks: [],
      overlapAt5: 0,
      medianLlmPercentile: 20,
      ours: { tasteWeightedImpressions: 10, belowBaselineShare: 0 },
      llmOnly: { tasteWeightedImpressions: 3, belowBaselineShare: 0.6 },
      missedByLlm: null,
      note: 'circular',
    }),
    ...overrides,
  };
}

const collect = () => {
  const parts: StoopPart[] = [];
  return { parts, emit: (p: StoopPart) => parts.push(p) };
};

describe('executeRun', () => {
  it('pauses for one question, then resumes to a finished plan', async () => {
    const deps = fakeDeps();
    const saved: string[] = [];
    const persist = async (s: { status: string }) => {
      saved.push(s.status);
    };
    let state = newRunState({ id: 'r1', brief, mode: 'mock', now: new Date('2026-10-28T15:00:00Z') });
    const first = collect();
    state = await executeRun(state, first.emit, deps, { country: 'US', persist });
    expect(state.status).toBe('awaiting_input');
    expect(first.parts.some((p) => p.type === 'data-needsInput')).toBe(true);
    expect(first.parts.at(-1)).toMatchObject({ type: 'data-done', data: { status: 'awaiting_input' } });

    const second = collect();
    state = await executeRun(state, second.emit, deps, { country: 'US', persist, choices: [{ input: 'Soul', entityId: 'm1' }] });
    expect(state.status).toBe('done');
    expect(state.label).toEqual({ kind: 'synthetic' });
    expect(state.qlooCalls.fresh).toBe(1);
    expect(state.evidence.map((e) => e.nta)).toEqual(['BK0302', 'BK0301', 'MN0303']);
    const types = second.parts.map((p) => p.type);
    expect(types[0]).toBe('data-run');
    expect(types).toContain('data-where');
    expect(types).toContain('data-plan');
    expect(types).toContain('data-proof');
    expect(types.at(-1)).toBe('data-done');
    expect(state.stages.every((s) => ['done', 'degraded'].includes(s.status))).toBe(true);
    expect(saved.at(-1)).toBe('done');
  });

  it('ends with a safe, human message when Qloo fails', async () => {
    const deps = fakeDeps({
      resolve: async () => {
        throw new Error('QLOO_UPSTREAM 502 at https://hackathon.api.qloo.com/v2/insights?x-api-key=secret');
      },
    });
    const state = newRunState({ id: 'r2', brief, mode: 'live', now: new Date() });
    const { parts, emit } = collect();
    const out = await executeRun(state, emit, deps, { country: null, persist: async () => {} });
    expect(out.status).toBe('error');
    expect(out.error).not.toContain('secret');
    expect(out.stages.find((s) => s.stage === 'resolve')?.status).toBe('error');
    expect(parts.at(-1)?.type).toBe('data-done');
  });

  it('labels a live run that used no AI writer as Qloo-data-only', async () => {
    const deps = fakeDeps({
      mode: 'live',
      planner: async () => ({ output: { ...planner, fallback: true }, via: 'rules', attempts: 5 }),
      creative: async ({ packs }) => ({ sets: packs.map((p) => ({ nta: p.nta, variants: [], via: 'template' })), via: 'template', attempts: 3 }),
      resolve: async () => ({
        outcomes: [
          { input: 'A', type: 'artist', status: 'resolved', match: 'exact', selected: cand('a', 'A', 'artist'), alternatives: [], warnings: [] },
          { input: 'B', type: 'brand', status: 'resolved', match: 'exact', selected: cand('b', 'B', 'brand'), alternatives: [], warnings: [] },
        ],
        issues: [],
        envelope: envelope('resolve_anchors'),
      }),
    });
    const out = await executeRun(newRunState({ id: 'r3', brief, mode: 'live', now: new Date() }), () => {}, deps, {
      country: 'TR',
      persist: async () => {},
    });
    expect(out.status).toBe('done');
    expect(out.label?.kind).toBe('qloo_only');
    expect(out.stages.find((s) => s.stage === 'plan')?.status).toBe('degraded');
    expect(out.stages.find((s) => s.stage === 'creative')?.status).toBe('degraded');
  });
});
