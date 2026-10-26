import 'server-only';
import type {
  Brief,
  CreativeSet,
  EvidencePack,
  MediaPlan,
  NtaScore,
  PlannerOutput,
  ProvenanceRequest,
  Proof,
  ResolutionChoice,
  ResolutionIssue,
  ResolutionOutcome,
  StageEnvelope,
  WhereResult,
} from '@/shared/types';
import type { StoopDataParts } from '@/shared/stream';

export type AttemptEvent = StoopDataParts['attempt'];

/** Per-run context handed to every Qloo-backed step: abort signal, budget and provenance sink. */
export interface StepCtx {
  runId: string;
  signal: AbortSignal;
  onRequest: (r: ProvenanceRequest) => void;
}

export interface ResolvedAnchor {
  id: string;
  name: string;
  type: string;
}

/**
 * Everything the orchestrator needs from the domain modules. Production wires these to the Qloo client,
 * lift engine, model chain, creative validator, optimizer and proof module (`deps-live.ts`); tests pass fakes.
 */
export interface RunDeps {
  mode: 'live' | 'mock';
  now: () => Date;
  eligibleNtas: { code: string; name: string; short: string }[];
  planner(input: {
    brief: Brief;
    country: string | null;
    signal: AbortSignal;
    onAttempt: (e: AttemptEvent) => void;
  }): Promise<{ output: PlannerOutput; via: string; attempts: number }>;
  resolve(input: {
    anchors: PlannerOutput['anchors'];
    choices: ResolutionChoice[];
    previous: ResolutionOutcome[] | null;
    ctx: StepCtx;
  }): Promise<{ outcomes: ResolutionOutcome[]; issues: ResolutionIssue[]; envelope: StageEnvelope }>;
  where(input: { anchors: ResolvedAnchor[]; ctx: StepCtx }): Promise<{ result: WhereResult; narration: string[]; envelope: StageEnvelope }>;
  evidence(input: { ntas: NtaScore[]; anchors: ResolvedAnchor[]; ctx: StepCtx }): Promise<{ packs: EvidencePack[]; envelope: StageEnvelope }>;
  creative(input: {
    brief: Brief;
    planner: PlannerOutput;
    packs: EvidencePack[];
    country: string | null;
    signal: AbortSignal;
    onAttempt: (e: AttemptEvent) => void;
  }): Promise<{ sets: CreativeSet[]; via: string; attempts: number }>;
  /** Frees per-run resources such as the cross-run Qloo slot; called after the last Qloo stage and on exit. */
  release?(ctx: StepCtx): Promise<void>;
  plan(input: { where: WhereResult; topNtas: string[]; brief: Brief }): MediaPlan;
  proof(input: { where: WhereResult; llmPicks: PlannerOutput['llmOnlyNeighborhoods']; plan: MediaPlan; brief: Brief; packs: EvidencePack[] }): Proof;
}
