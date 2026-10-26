import 'server-only';
import { generateText, NoObjectGeneratedError, Output } from 'ai';
import type { z } from 'zod';
import {
  classifyError,
  countAttempt,
  readChainState,
  recordSchemaFailure,
  setCooldown,
  type ChainState,
  type ErrorClass,
} from './cooldowns';
import type {
  AttemptEvent,
  AttemptOutcome,
  LlmFailureReason,
  LlmGateway,
  LlmKind,
  LlmRunRequest,
  LlmRunResult,
  SlotSkip,
} from './gateway';
import { isGeminiAllowed } from './geo-gate';
import { appendJsonSkeleton } from './prompts';
import { repairJson } from './repair';
import type { LlmSlot } from './slots';

/** Per-attempt timeouts sized to the stage budgets (plan 25 s / 2 attempts, creative 45 s / 3). */
export const DEFAULT_TIMEOUT_MS: Record<LlmKind, number> = { planner: 12_000, creative: 15_000 };
/** Room for gpt-oss reasoning tokens plus the JSON (a cap, not a target; free tiers meter tokens). */
export const DEFAULT_MAX_OUTPUT_TOKENS: Record<LlmKind, number> = { planner: 2_000, creative: 3_000 };

export interface ChainOptions {
  /** Slots in priority order (see buildSlots). */
  slots: readonly LlmSlot[];
  /** `GEMINI_ALLOWED_COUNTRIES`. */
  geminiAllowedCountries: string | readonly string[];
  now?: () => number;
}

/** Providers accept `[a-zA-Z0-9_-]{1,64}` as the structured-output name. */
function outputName(name: string): string {
  return name.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64) || 'output';
}

function skipFor(
  slot: LlmSlot,
  model: string,
  state: ChainState,
  country: string | null,
  allowList: string | readonly string[],
): SlotSkip | null {
  if (state.disabled.has(slot.id)) return { slot: slot.id, reason: 'disabled', remainingMs: null };
  if (slot.geoGated && !isGeminiAllowed(country, allowList)) return { slot: slot.id, reason: 'geo_blocked', remainingMs: null };
  const remaining = state.cooldownMs(slot.id, model);
  if (remaining > 0) return { slot: slot.id, reason: 'cooldown', remainingMs: remaining };
  if (state.usedToday(slot.id) >= slot.dailySoftCap) return { slot: slot.id, reason: 'daily_cap', remainingMs: null };
  return null;
}

/** Runs the caller's semantic checks; a throwing validator counts as a rejection, not a crash. */
export function semanticProblems<T>(validate: ((value: T) => string[]) | undefined, value: T): string[] {
  if (!validate) return [];
  try {
    return validate(value).filter(Boolean);
  } catch (error) {
    return [`validate() threw: ${error instanceof Error ? error.message : String(error)}`];
  }
}

function outcomeFor(failure: ErrorClass): AttemptOutcome {
  if (failure.kind === 'aborted') return 'aborted';
  return failure.kind === 'invalid_output' ? 'invalid' : 'error';
}

interface AttemptResult<T> {
  event: AttemptEvent;
  parsed: { value: T } | null;
}

async function attempt<S extends z.ZodType>(
  slot: LlmSlot,
  req: LlmRunRequest<S>,
  index: number,
  now: () => number,
): Promise<AttemptResult<z.output<S>>> {
  const model = slot.modelIds[req.kind];
  const started = now();
  await countAttempt(slot.id, started);

  let parsed: { value: z.output<S> } | null = null;
  let repaired = false;
  let failure: ErrorClass | null = null;
  try {
    const result = await generateText({
      model: slot.models[req.kind],
      instructions: slot.jsonSkeleton ? appendJsonSkeleton(req.instructions, req.schema) : req.instructions,
      prompt: req.prompt,
      output: Output.object<z.output<S>>({ name: outputName(req.name), schema: req.schema }),
      // The chain is the retry policy: one call per slot, then the next slot.
      maxRetries: 0,
      timeout: req.timeoutMs ?? DEFAULT_TIMEOUT_MS[req.kind],
      abortSignal: req.signal,
      maxOutputTokens: req.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS[req.kind],
      ...slot.callOptions,
    });
    parsed = { value: result.output };
  } catch (error) {
    if (!req.signal.aborted && NoObjectGeneratedError.isInstance(error)) {
      const fixed = repairJson(error.text, req.schema);
      if (fixed.ok) {
        parsed = { value: fixed.data };
        repaired = true;
      } else {
        failure = { kind: 'invalid_output', status: null, cooldownMs: null, scope: 'model', schemaFailure: true, detail: fixed.error };
      }
    } else {
      failure = classifyError(error, { callerAborted: req.signal.aborted, now: now() });
    }
  }

  let outcome: AttemptOutcome = repaired ? 'repaired' : 'ok';
  let detail: string | null = repaired ? 'output repaired locally' : null;
  let cooldownMs: number | null = null;

  if (parsed) {
    const problems = semanticProblems(req.validate, parsed.value);
    if (problems.length > 0) {
      // Content problems are about this answer, not the provider: next slot, no cooldown.
      outcome = 'rejected';
      detail = problems.join('; ').slice(0, 240);
      parsed = null;
    }
  } else if (failure) {
    outcome = outcomeFor(failure);
    detail = failure.detail;
    if (failure.kind !== 'aborted') {
      if (failure.cooldownMs) {
        await setCooldown(slot.id, model, failure, now());
        cooldownMs = failure.cooldownMs;
      } else if (failure.schemaFailure) {
        cooldownMs = await recordSchemaFailure(slot.id, model, now());
      }
    }
  }

  const event: AttemptEvent = {
    kind: req.kind,
    attempt: index,
    slot: slot.id,
    model,
    outcome,
    error: failure?.kind ?? null,
    status: failure?.status ?? null,
    cooldownMs,
    ms: Math.max(0, now() - started),
    detail,
  };
  return { event, parsed };
}

/**
 * The live gateway: walks the slots in order, skipping disabled, geo-blocked, cooling-down and capped
 * ones, until a call returns schema-valid output that passes `validate()` or `maxAttempts` calls were
 * made. Never tries another slot once the caller's signal has fired.
 */
export function createChainGateway(options: ChainOptions): LlmGateway {
  const now = options.now ?? Date.now;
  return {
    async run<S extends z.ZodType>(req: LlmRunRequest<S>): Promise<LlmRunResult<z.output<S>>> {
      const attempts: AttemptEvent[] = [];
      const skipped: SlotSkip[] = [];
      const fail = (reason: LlmFailureReason): LlmRunResult<z.output<S>> => ({ ok: false, reason, attempts, skipped });

      if (req.signal.aborted) return fail('aborted');
      const state = await readChainState(options.slots, now());
      // NaN would silently lift the limit; treat it as a single attempt.
      const maxAttempts = Number.isNaN(req.maxAttempts) ? 1 : Math.max(1, Math.floor(req.maxAttempts));

      for (const slot of options.slots) {
        if (attempts.length >= maxAttempts) break;
        if (req.signal.aborted) return fail('aborted');
        const model = slot.modelIds[req.kind];
        const skip = skipFor(slot, model, state, req.country, options.geminiAllowedCountries);
        if (skip) {
          skipped.push(skip);
          continue;
        }
        const { event, parsed } = await attempt(slot, req, attempts.length + 1, now);
        attempts.push(event);
        try {
          req.onAttempt?.(event);
        } catch {
          // A progress callback must never break the chain.
        }
        if (parsed) return { ok: true, data: parsed.value, via: slot.id, model, attempts, skipped };
      }

      // Also covers an abort during the last allowed attempt.
      if (req.signal.aborted) return fail('aborted');
      return fail(attempts.length === 0 ? 'no_slots' : 'exhausted');
    },
  };
}
