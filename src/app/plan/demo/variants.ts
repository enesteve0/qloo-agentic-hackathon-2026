import 'server-only';
import { syntheticDemoQuestion, syntheticDemoRun } from '@/content/demo-run';
import { viewFromState, type RunView } from '@/shared/stream';
import type { CreativeSet, RunState, StageId, StageInfo } from '@/shared/types';

/**
 * Design states of the synthetic demo (`/plan/demo?state=…`), derived from the one synthetic run so the
 * run screen's streaming, question, fallback, empty and error states can be reviewed and tested.
 */
export const DEMO_STATES = ['done', 'running', 'needs-input', 'degraded', 'empty', 'error'] as const;
export type DemoState = (typeof DEMO_STATES)[number];

export function isDemoState(x: unknown): x is DemoState {
  return typeof x === 'string' && (DEMO_STATES as readonly string[]).includes(x);
}

function stagesUpTo(state: RunState, done: StageId[], current: { id: StageId; status: StageInfo['status']; detail?: string } | null): StageInfo[] {
  return state.stages.map((s) => {
    if (done.includes(s.stage)) return s;
    if (current && s.stage === current.id) return { ...s, status: current.status, detail: current.detail ?? null, ms: null };
    return { ...s, status: 'pending', detail: null, ms: null };
  });
}

export function demoState(kind: DemoState): { view: RunView; state: RunState } {
  const s = syntheticDemoRun();
  switch (kind) {
    case 'running': {
      const state: RunState = {
        ...s,
        status: 'running',
        evidence: [],
        creative: [],
        plan: null,
        proof: null,
        label: null,
        stages: stagesUpTo(s, ['intake', 'plan', 'resolve', 'where'], { id: 'evidence', status: 'running' }),
        decisions: s.decisions.filter((d) => ['plan', 'resolve', 'where'].includes(d.stage)),
        envelopes: s.envelopes.filter((e) => e.operation !== 'neighborhood_evidence'),
        qlooCalls: { fresh: 8, cached: 1 },
        llm: { via: ['synthetic'], attempts: 1 },
      };
      const view: RunView = {
        state,
        progress: 'Reading Bed-Stuy, Crown Heights, Harlem and Fort Greene',
        attempts: [],
        fallback: null,
        needsInput: null,
        extras: null,
        done: false,
      };
      return { view, state };
    }
    case 'needs-input': {
      const issues = syntheticDemoQuestion();
      const question = issues[0]!;
      const state: RunState = {
        ...s,
        status: 'awaiting_input',
        where: null,
        evidence: [],
        creative: [],
        plan: null,
        proof: null,
        label: null,
        resolution: {
          outcomes: (s.resolution?.outcomes ?? []).map((o) =>
            o.input === question.input ? { input: o.input, type: o.type, status: 'ambiguous', candidates: question.candidates } : o,
          ),
          issues,
        },
        stages: stagesUpTo(s, ['intake', 'plan'], { id: 'resolve', status: 'needs_input', detail: 'One quick check' }),
        decisions: s.decisions.filter((d) => d.stage === 'plan'),
        envelopes: s.envelopes.filter((e) => e.operation === 'resolve_anchors'),
        qlooCalls: { fresh: 4, cached: 0 },
        llm: { via: ['synthetic'], attempts: 1 },
      };
      return { view: viewFromState(state), state };
    }
    case 'degraded': {
      const creative: CreativeSet[] = s.creative.map((set) => ({
        ...set,
        via: 'template',
        variants: set.variants.map((v) => ({
          ...v,
          source: 'template',
          grounding: { ok: true, failed: [], replacedByTemplate: true },
          rationale: 'Template: assembled by rules from this neighborhood’s evidence while the AI writers were busy.',
        })),
      }));
      const state: RunState = {
        ...s,
        creative,
        stages: s.stages.map((x) => (x.stage === 'creative' ? { ...x, status: 'degraded', detail: 'Template copy (AI writers busy)' } : x)),
        decisions: s.decisions.map((d) =>
          d.stage === 'creative' ? { ...d, text: 'AI writers were busy, so every ad was assembled by rules from the evidence.' } : d,
        ),
      };
      const view: RunView = {
        ...viewFromState(state),
        fallback: {
          reason: 'llm_exhausted',
          presetSlug: null,
          message: 'The free AI writers hit their limits, so the ads were assembled by rules from the same Qloo evidence. The map, neighborhoods and plan are unchanged.',
        },
      };
      return { view, state };
    }
    case 'empty': {
      const budget = 80;
      const plan = s.plan!;
      const state: RunState = {
        ...s,
        brief: { ...s.brief, budgetUsd: budget },
        plan: {
          ...plan,
          budgetUsd: budget,
          screens: [],
          byNta: [],
          totals: { spend: 0, impressions: 0, tasteWeightedImpressions: 0, screens: 0 },
          leftoverUsd: budget,
          nextBest: [],
          infeasibleReason: `Minimum $${plan.assumptions.pricePerKioskWeek.outer * plan.weeks} for one screen over ${plan.weeks} weeks.`,
        },
        proof: { ...s.proof!, available: false, llmOnly: null, missedByLlm: null },
        stages: s.stages.map((x) => (x.stage === 'optimize' ? { ...x, status: 'degraded', detail: 'Budget below one screen-week' } : x)),
        decisions: s.decisions.filter((d) => d.stage !== 'optimize' && d.stage !== 'proof'),
      };
      return { view: viewFromState(state), state };
    }
    case 'error': {
      const state: RunState = {
        ...s,
        status: 'error',
        where: null,
        evidence: [],
        creative: [],
        plan: null,
        proof: null,
        label: null,
        stages: stagesUpTo(s, ['intake', 'plan', 'resolve'], { id: 'where', status: 'error', detail: 'Qloo didn’t answer in time.' }),
        decisions: s.decisions.filter((d) => d.stage === 'plan' || d.stage === 'resolve'),
        envelopes: s.envelopes.filter((e) => e.operation === 'resolve_anchors'),
        error: 'Qloo didn’t answer in time, so the taste map could not be drawn.',
      };
      return { view: viewFromState(state), state };
    }
    case 'done':
      return { view: viewFromState(s), state: s };
  }
}
