/**
 * The streaming contract between POST /api/runs and the run view.
 *
 * The server writes AI SDK UI-message-stream chunks (`createUIMessageStream` → SSE); every Stoop update
 * is a typed `data-<name>` part. Parts with the same `id` replace the previous value (e.g. one `stage`
 * part per stage id). The client folds parts into a `RunView` with `applyPart`, which is pure and shared
 * by the live stream, recorded presets and saved runs.
 */
import type { UIMessage } from 'ai';
import type {
  CreativeSet,
  EvidencePack,
  MediaPlan,
  Proof,
  ResolutionIssue,
  ResolutionOutcome,
  ResultLabel,
  RunState,
  RunStatus,
  StageEnvelope,
  StageId,
  StageInfo,
  WhereResult,
} from './types';

export type FallbackReason = 'limits' | 'qloo_reserve' | 'llm_exhausted' | 'busy' | 'qloo_unavailable' | 'error';

export interface StoopDataParts {
  [key: string]: unknown;
  run: { runId: string; mode: 'live' | 'mock'; startedAt: string; presetSlug: string | null; businessName: string };
  stage: StageInfo;
  decision: { stage: StageId; text: string };
  anchors: { interpretation: string; outcomes: ResolutionOutcome[] };
  needsInput: { runId: string; issues: ResolutionIssue[] };
  where: WhereResult;
  evidence: EvidencePack;
  creative: CreativeSet;
  plan: MediaPlan;
  proof: Proof;
  envelope: StageEnvelope;
  label: ResultLabel;
  fallback: { reason: FallbackReason; presetSlug: string | null; message: string };
  done: { runId: string; status: RunStatus; error: string | null };
  /** Transient: the agent's current one-line activity for the ticker. */
  progress: { text: string };
  /** Transient: one model attempt in the fallback chain. */
  attempt: { kind: 'planner' | 'creative'; slot: string; ok: boolean; reason: string | null; ms: number };
}

export type StoopMessage = UIMessage<never, StoopDataParts>;

export type StoopPart = {
  [K in keyof StoopDataParts & string]: { type: `data-${K}`; id?: string; data: StoopDataParts[K]; transient?: boolean };
}[keyof StoopDataParts & string];

/** Client-side view of a run: the persisted RunState plus transient streaming state. */
export interface RunView {
  state: RunState | null;
  progress: string | null;
  attempts: StoopDataParts['attempt'][];
  fallback: StoopDataParts['fallback'] | null;
  needsInput: ResolutionIssue[] | null;
  done: boolean;
}

export const emptyRunView = (): RunView => ({
  state: null,
  progress: null,
  attempts: [],
  fallback: null,
  needsInput: null,
  done: false,
});

const nowIso = () => new Date().toISOString();

function skeletonState(run: StoopDataParts['run']): RunState {
  return {
    id: run.runId,
    createdAt: run.startedAt,
    updatedAt: run.startedAt,
    status: 'running',
    mode: run.mode,
    presetSlug: run.presetSlug,
    brief: { business: run.businessName, description: '', offer: null, budgetUsd: 0, weeks: 0, startDate: null, address: null },
    planner: null,
    resolution: null,
    where: null,
    evidence: [],
    creative: [],
    plan: null,
    proof: null,
    stages: [],
    decisions: [],
    envelopes: [],
    label: null,
    qlooCalls: { fresh: 0, cached: 0 },
    llm: { via: [], attempts: 0 },
    error: null,
  };
}

function upsertBy<T>(list: T[], item: T, key: (x: T) => string): T[] {
  const k = key(item);
  const i = list.findIndex((x) => key(x) === k);
  if (i === -1) return [...list, item];
  const next = list.slice();
  next[i] = item;
  return next;
}

/** Folds one streamed part into the view. Pure; unknown parts are ignored for forward compatibility. */
export function applyPart(view: RunView, part: { type: string; data?: unknown }): RunView {
  if (!part.type.startsWith('data-')) return view;
  const name = part.type.slice(5) as keyof StoopDataParts;
  const data = part.data as never;
  if (name === 'run') return { ...view, state: skeletonState(data as StoopDataParts['run']) };
  if (name === 'progress') return { ...view, progress: (data as StoopDataParts['progress']).text };
  if (name === 'attempt') return { ...view, attempts: [...view.attempts, data as StoopDataParts['attempt']].slice(-20) };
  if (name === 'fallback') return { ...view, fallback: data as StoopDataParts['fallback'] };
  if (name === 'needsInput') return { ...view, needsInput: (data as StoopDataParts['needsInput']).issues };
  const s = view.state;
  if (!s) return view;
  const touch = (patch: Partial<RunState>): RunView => ({ ...view, state: { ...s, ...patch, updatedAt: nowIso() } });
  switch (name) {
    case 'stage':
      return touch({ stages: upsertBy(s.stages, data as StageInfo, (x) => x.stage) });
    case 'decision':
      return touch({ decisions: [...s.decisions, data as StoopDataParts['decision']] });
    case 'anchors': {
      const d = data as StoopDataParts['anchors'];
      return touch({ resolution: { outcomes: d.outcomes, issues: s.resolution?.issues ?? [] } });
    }
    case 'where':
      return touch({ where: data as WhereResult });
    case 'evidence':
      return touch({ evidence: upsertBy(s.evidence, data as EvidencePack, (x) => x.nta) });
    case 'creative':
      return touch({ creative: upsertBy(s.creative, data as CreativeSet, (x) => x.nta) });
    case 'plan':
      return touch({ plan: data as MediaPlan });
    case 'proof':
      return touch({ proof: data as Proof });
    case 'envelope':
      return touch({ envelopes: upsertBy(s.envelopes, data as StageEnvelope, (x) => x.operation) });
    case 'label':
      return touch({ label: data as ResultLabel });
    case 'done': {
      const d = data as StoopDataParts['done'];
      return { ...view, done: true, progress: null, state: { ...s, status: d.status, error: d.error, updatedAt: nowIso() } };
    }
    default:
      return view;
  }
}

/** A complete saved run rendered through the same view model as a live stream. */
export function viewFromState(state: RunState): RunView {
  return {
    state,
    progress: null,
    attempts: [],
    fallback: null,
    needsInput: state.status === 'awaiting_input' ? (state.resolution?.issues ?? []) : null,
    done: state.status === 'done' || state.status === 'error',
  };
}

/**
 * Reads an SSE body produced by createUIMessageStreamResponse and yields parsed JSON chunks.
 * Works in browsers and Node (tests). Ignores keep-alive comments and the final `[DONE]`.
 */
export async function* readUiMessageSse(body: ReadableStream<Uint8Array>): AsyncGenerator<{ type: string; id?: string; data?: unknown }> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (value) buffer += decoder.decode(value, { stream: true });
    let sep: number;
    while ((sep = buffer.search(/\r?\n\r?\n/)) !== -1) {
      const rawEvent = buffer.slice(0, sep);
      buffer = buffer.slice(sep).replace(/^\r?\n\r?\n/, '');
      const dataLines = rawEvent
        .split(/\r?\n/)
        .filter((l) => l.startsWith('data:'))
        .map((l) => l.slice(5).trimStart());
      if (dataLines.length === 0) continue;
      const payload = dataLines.join('\n');
      if (payload === '[DONE]') return;
      try {
        yield JSON.parse(payload) as { type: string; id?: string; data?: unknown };
      } catch {
        // A malformed event is skipped rather than breaking the whole run view.
      }
    }
    if (done) return;
  }
}
