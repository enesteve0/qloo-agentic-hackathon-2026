import 'server-only';
import type { StoopPart } from '@/shared/stream';
import type {
  Brief,
  ResolutionChoice,
  ResultLabel,
  RunState,
  StageEnvelope,
  StageId,
  StageInfo,
  StageStatus,
} from '@/shared/types';
import type { ResolvedAnchor, RunDeps, StepCtx } from './deps';
import { toUserMessage, UserFacingError } from './errors';

export type Emit = (part: StoopPart) => void;

export interface RunOptions {
  country: string | null;
  choices?: ResolutionChoice[];
  /** Absolute wall-clock budget for the whole run. */
  deadlineMs?: number;
  signal?: AbortSignal;
  persist: (state: RunState) => Promise<void>;
}

const TOP_NTAS = 3;
const STAGE_TITLES: Record<StageId, string> = {
  intake: 'Reading the brief',
  plan: 'Choosing taste anchors',
  resolve: 'Matching anchors in Qloo',
  where: 'Mapping where this taste over-indexes',
  evidence: 'Reading each neighborhood’s taste',
  creative: 'Writing the ads',
  optimize: 'Fitting the budget',
  proof: 'Comparing with an AI that has no Qloo',
  finalize: 'Plan ready',
};

export function newRunState(input: { id: string; brief: Brief; mode: 'live' | 'mock'; presetSlug?: string | null; now: Date }): RunState {
  const at = input.now.toISOString();
  return {
    id: input.id,
    createdAt: at,
    updatedAt: at,
    status: 'running',
    mode: input.mode,
    presetSlug: input.presetSlug ?? null,
    brief: input.brief,
    planner: null,
    resolution: null,
    where: null,
    evidence: [],
    creative: [],
    plan: null,
    proof: null,
    stages: (Object.keys(STAGE_TITLES) as StageId[]).map((stage) => ({
      stage,
      status: 'pending',
      title: STAGE_TITLES[stage],
      detail: null,
      ms: null,
    })),
    decisions: [],
    envelopes: [],
    label: null,
    qlooCalls: { fresh: 0, cached: 0 },
    llm: { via: [], attempts: 0 },
    error: null,
  };
}

const fmt = new Intl.NumberFormat('en-US');

/** Thrown to stop the run early while keeping everything computed so far. */
class Paused extends Error {}

/**
 * Runs the agent pipeline: plan → resolve (may pause for one question) → where → evidence → creative ∥
 * optimize ∥ proof → finalize. Every stage emits stream parts, updates the RunState and checkpoints it, so
 * a reload or a client disconnect never loses work. Model failures degrade to labelled deterministic
 * fallbacks; Qloo failures end the run with a clear error (Stoop never invents Qloo data).
 */
export async function executeRun(state: RunState, emit: Emit, deps: RunDeps, opts: RunOptions): Promise<RunState> {
  const started = deps.now().getTime();
  const deadline = started + (opts.deadlineMs ?? 110_000);
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  opts.signal?.addEventListener('abort', onAbort);
  const signal = controller.signal;
  const timer = setTimeout(() => controller.abort(), Math.max(1_000, deadline - started));

  const touch = () => {
    state.updatedAt = deps.now().toISOString();
  };
  const setStage = (stage: StageId, status: StageStatus, detail: string | null = null, ms: number | null = null) => {
    const info: StageInfo = { stage, status, title: STAGE_TITLES[stage], detail, ms };
    state.stages = state.stages.map((s) => (s.stage === stage ? info : s));
    touch();
    emit({ type: 'data-stage', id: stage, data: info });
  };
  const decide = (stage: StageId, text: string) => {
    state.decisions.push({ stage, text });
    emit({ type: 'data-decision', data: { stage, text } });
  };
  const progress = (text: string) => emit({ type: 'data-progress', data: { text }, transient: true });
  const addEnvelope = (env: StageEnvelope) => {
    state.envelopes = [...state.envelopes.filter((e) => e.operation !== env.operation), env];
    emit({ type: 'data-envelope', id: env.operation, data: env });
  };
  const ctx: StepCtx = {
    runId: state.id,
    signal,
    onRequest: (r) => {
      if (r.cache === 'hit') state.qlooCalls.cached += 1;
      else state.qlooCalls.fresh += 1;
    },
  };
  const onAttempt = (e: Parameters<Parameters<RunDeps['planner']>[0]['onAttempt']>[0]) => {
    state.llm.attempts += 1;
    emit({ type: 'data-attempt', data: e, transient: true });
  };
  const timed = async <T>(stage: StageId, fn: () => Promise<T>): Promise<T> => {
    const t0 = deps.now().getTime();
    setStage(stage, 'running');
    const out = await fn();
    const current = state.stages.find((s) => s.stage === stage);
    if (current?.status === 'running') setStage(stage, 'done', current.detail, deps.now().getTime() - t0);
    await opts.persist(state);
    return out;
  };

  emit({
    type: 'data-run',
    data: { runId: state.id, mode: state.mode, startedAt: state.createdAt, presetSlug: state.presetSlug, businessName: state.brief.business },
  });

  try {
    // ---------------- intake + plan ----------------
    if (!state.planner) {
      await timed('intake', async () => {
        progress('Reading the brief');
        setStage('intake', 'running', `${state.brief.business} · $${fmt.format(state.brief.budgetUsd)} · ${state.brief.weeks} wk`);
      });
      await timed('plan', async () => {
        progress('Choosing taste anchors');
        const { output, via, attempts } = await deps.planner({ brief: state.brief, country: opts.country, signal, onAttempt });
        state.planner = output;
        state.llm.via.push(via);
        state.llm.attempts = Math.max(state.llm.attempts, attempts);
        const list = output.anchors.map((a) => `${a.name} (${a.type.replace('_', ' ')})`).join(', ');
        decide('plan', output.fallback ? `No AI writer was free, so rules picked the anchors: ${list}.` : `Anchors for this audience: ${list}.`);
        if (output.fallback) setStage('plan', 'degraded', 'Rule-based anchors (AI capacity busy)');
      });
    }
    const planner = state.planner!;

    // ---------------- resolve (one question at most) ----------------
    const resolved = await timed('resolve', async () => {
      progress('Matching anchors in Qloo');
      const r = await deps.resolve({ anchors: planner.anchors, choices: opts.choices ?? [], previous: state.resolution?.outcomes ?? null, ctx });
      state.resolution = { outcomes: r.outcomes, issues: r.issues };
      addEnvelope(r.envelope);
      emit({ type: 'data-anchors', data: { interpretation: r.envelope.interpretation, outcomes: r.outcomes } });
      if (r.issues.some((i) => i.kind === 'ambiguous')) {
        setStage('resolve', 'needs_input', 'One quick check');
        state.status = 'awaiting_input';
        emit({ type: 'data-needsInput', data: { runId: state.id, issues: r.issues } });
        throw new Paused('needs_input');
      }
      const anchors: ResolvedAnchor[] = r.outcomes.flatMap((o) =>
        o.status === 'resolved' ? [{ id: o.selected.id, name: o.selected.name, type: o.selected.type }] : [],
      );
      const missing = r.outcomes.filter((o) => o.status === 'not_found').map((o) => o.input);
      if (missing.length) decide('resolve', `Couldn’t find ${missing.map((m) => `“${m}”`).join(', ')} in Qloo, so it was skipped.`);
      if (anchors.length < 2) {
        throw new UserFacingError('Fewer than two taste anchors could be matched in Qloo. Try naming different artists, places or brands.', 'anchors');
      }
      decide('resolve', `Matched ${anchors.length} of ${r.outcomes.length} anchors in Qloo.`);
      return anchors;
    });

    // ---------------- where ----------------
    const where = await timed('where', async () => {
      progress('Mapping where this taste over-indexes across New York');
      const w = await deps.where({ anchors: resolved, ctx });
      state.where = w.result;
      addEnvelope(w.envelope);
      for (const line of w.narration) decide('where', line);
      const top = w.result.ntas.slice(0, TOP_NTAS);
      progress(`Scoring ${fmt.format(w.result.kioskFit.filter((f) => f >= 0).length)} street screens`);
      if (top.length) decide('where', `Strongest fit: ${top.map((n) => `${n.short} ${n.multiplier.toFixed(1)}×`).join(', ')}.`);
      emit({ type: 'data-where', data: w.result });
      return w.result;
    });
    const topNtas = where.ntas.slice(0, TOP_NTAS);
    if (topNtas.length === 0) {
      throw new UserFacingError('No neighborhood with enough street screens showed a taste signal for these anchors.', 'no_signal');
    }

    // ---------------- evidence ----------------
    const packs = await timed('evidence', async () => {
      progress(`Reading ${topNtas.map((n) => n.short).join(', ')}`);
      const ev = await deps.evidence({ ntas: topNtas, anchors: resolved, ctx });
      state.evidence = ev.packs;
      addEnvelope(ev.envelope);
      for (const p of ev.packs) emit({ type: 'data-evidence', id: p.nta, data: p });
      return ev.packs;
    });

    // ---------------- creative ∥ optimize, then proof ----------------
    const remaining = deadline - deps.now().getTime();
    const creativeTask = timed('creative', async () => {
      progress(`Writing ${packs.length * 2} ads`);
      const c = await deps.creative({ brief: state.brief, planner, packs, country: opts.country, signal, onAttempt });
      state.creative = c.sets;
      state.llm.via.push(c.via);
      for (const set of c.sets) emit({ type: 'data-creative', id: set.nta, data: set });
      const templated = c.sets.flatMap((s) => s.variants).filter((v) => v.source === 'template').length;
      if (c.via === 'template') setStage('creative', 'degraded', 'Template copy (AI writers busy)');
      decide(
        'creative',
        templated ? `Checked every line; ${templated} variant(s) were rewritten from evidence by rules.` : 'Checked every line against the evidence.',
      );
    });
    const planTask = timed('optimize', async () => {
      progress(`Fitting $${fmt.format(state.brief.budgetUsd)} into street screens`);
      const plan = deps.plan({ where, topNtas: topNtas.map((n) => n.code), brief: state.brief });
      state.plan = plan;
      emit({ type: 'data-plan', data: plan });
      if (plan.infeasibleReason) {
        setStage('optimize', 'degraded', plan.infeasibleReason);
      } else {
        decide('optimize', `${plan.totals.screens} screens in ${plan.byNta.length} neighborhoods for $${fmt.format(plan.totals.spend)}.`);
      }
      return plan;
    });
    if (remaining < 15_000) progress('Running short on time; keeping it simple');
    const [, plan] = await Promise.all([creativeTask, planTask]);

    await timed('proof', async () => {
      const proof = deps.proof({ where, llmPicks: planner.llmOnlyNeighborhoods, plan, brief: state.brief, packs });
      state.proof = proof;
      emit({ type: 'data-proof', data: proof });
      if (!proof.available) setStage('proof', 'degraded', 'LLM-only comparison unavailable for this run');
    });

    // ---------------- finalize ----------------
    await timed('finalize', async () => {
      state.label = labelFor(state, deps.mode);
      emit({ type: 'data-label', data: state.label });
      state.status = 'done';
    });
  } catch (err) {
    if (err instanceof Paused) {
      // Awaiting the owner's answer; state already carries the question.
    } else {
      const message = toUserMessage(err, signal.aborted);
      const running = state.stages.find((s) => s.status === 'running');
      if (running) setStage(running.stage, 'error', message);
      state.status = 'error';
      state.error = message;
    }
  } finally {
    clearTimeout(timer);
    opts.signal?.removeEventListener('abort', onAbort);
    touch();
    await opts.persist(state);
    emit({ type: 'data-done', data: { runId: state.id, status: state.status, error: state.error } });
  }
  return state;
}

function labelFor(state: RunState, mode: 'live' | 'mock'): ResultLabel {
  if (mode === 'mock') return { kind: 'synthetic' };
  const models = state.llm.via.filter((v) => v !== 'template' && v !== 'rules');
  if (models.length === 0) return { kind: 'qloo_only', reason: 'AI writers were busy; rules and templates used Qloo evidence only.' };
  return { kind: 'live', model: models[models.length - 1] ?? null, qloo: { ...state.qlooCalls } };
}
