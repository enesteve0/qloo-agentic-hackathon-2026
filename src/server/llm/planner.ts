import 'server-only';
import type { Brief, PlannerOutput } from '@/shared/types';
import { fallbackPlanner } from './fallback-planner';
import { getLlmGateway, type AttemptEvent, type LlmFailureReason, type LlmGateway, type SlotSkip } from './gateway';
import { buildPlannerInstructions, buildPlannerPrompt, type NeighborhoodRef } from './prompts';
import { createPlannerValidator, finalizePlannerOutput, plannerSchema } from './schemas';

export interface RunPlannerInput {
  brief: Brief;
  /** Eligible neighborhoods for the LLM-only picks (code + display name). */
  neighborhoods: readonly NeighborhoodRef[];
  /** Famous/busy codes for the deterministic fallback's no-data picks. */
  busyNtaCodes?: readonly string[];
  /** `x-vercel-ip-country`, or null when unknown (the Gemini slot is then skipped). */
  country: string | null;
  signal: AbortSignal;
  onAttempt?: (event: AttemptEvent) => void;
  /** Defaults to the process gateway. */
  gateway?: LlmGateway;
  /** Defaults to 2 (ARCHITECTURE §11). */
  maxAttempts?: number;
}

export interface RunPlannerResult {
  plan: PlannerOutput;
  /** Slot that wrote the plan, or null when the deterministic fallback did. */
  via: string | null;
  model: string | null;
  attempts: AttemptEvent[];
  skipped: SlotSkip[];
  /** Why the deterministic fallback was used; null when a model wrote the plan. */
  fallbackReason: LlmFailureReason | null;
}

/**
 * Planner step (model 1): one gateway call with the fixed instructions, the strict schema and the
 * semantic validator; any failure (including the caller's abort) degrades to the keyword fallback.
 */
export async function runPlanner(input: RunPlannerInput): Promise<RunPlannerResult> {
  const gateway = input.gateway ?? getLlmGateway();
  const codes = input.neighborhoods.map((n) => n.code);
  const eligibleCodes = codes.length > 0 ? codes : undefined;
  const result = await gateway.run({
    kind: 'planner',
    schema: plannerSchema,
    name: 'stoop_plan',
    instructions: buildPlannerInstructions(input.neighborhoods),
    prompt: buildPlannerPrompt(input.brief),
    country: input.country,
    signal: input.signal,
    maxAttempts: input.maxAttempts ?? 2,
    validate: createPlannerValidator(eligibleCodes),
    onAttempt: input.onAttempt,
  });

  if (!result.ok) {
    return {
      plan: fallbackPlanner(input.brief, { neighborhoods: input.neighborhoods, busyNtaCodes: input.busyNtaCodes }),
      via: null,
      model: null,
      attempts: result.attempts,
      skipped: result.skipped,
      fallbackReason: result.reason,
    };
  }

  const plan = finalizePlannerOutput(result.data, { eligibleCodes });
  // The form's numbers are authoritative; the model only echoes them.
  if (Number.isFinite(input.brief.budgetUsd) && input.brief.budgetUsd > 0) plan.budgetUsd = input.brief.budgetUsd;
  if (Number.isFinite(input.brief.weeks) && input.brief.weeks > 0) plan.weeks = Math.max(1, Math.round(input.brief.weeks));
  return { plan, via: result.via, model: result.model, attempts: result.attempts, skipped: result.skipped, fallbackReason: null };
}
