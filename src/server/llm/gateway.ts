import 'server-only';
import type { z } from 'zod';
import { getEnv } from '@/server/env';
import { createChainGateway } from './chain';
import { readChainState, type ErrorKind } from './cooldowns';
import { createFakeGateway } from './fake';
import { buildSlots, SLOT_IDS } from './slots';

export type LlmKind = 'planner' | 'creative';

/** How one model call ended. */
export type AttemptOutcome =
  /** Schema-valid output straight from the SDK. */
  | 'ok'
  /** Broken JSON fixed locally (fences, jsonrepair, stray keys) and then schema-valid. */
  | 'repaired'
  /** Schema-valid, but the caller's `validate()` reported problems. */
  | 'rejected'
  /** Output could not be turned into the schema. */
  | 'invalid'
  /** HTTP, network or timeout error. */
  | 'error'
  /** The caller's signal fired. */
  | 'aborted';

export interface AttemptEvent {
  kind: LlmKind;
  /** 1-based index among the real model calls of one `run()`. */
  attempt: number;
  slot: string;
  model: string;
  outcome: AttemptOutcome;
  /** Error class for `invalid` and `error` outcomes. */
  error: ErrorKind | null;
  status: number | null;
  /** Cooldown this attempt put on the slot (ms), if any. */
  cooldownMs: number | null;
  ms: number;
  /** Short reason for logs and the agent ticker; never contains secrets. */
  detail: string | null;
}

export type SkipReason = 'disabled' | 'geo_blocked' | 'cooldown' | 'daily_cap';

/** A configured slot that was passed over without a model call. */
export interface SlotSkip {
  slot: string;
  reason: SkipReason;
  /** Remaining cooldown in ms (reason `cooldown` only). */
  remainingMs: number | null;
}

export interface LlmRunRequest<S extends z.ZodType> {
  kind: LlmKind;
  /** Model-facing schema (see schemas.ts for the strictness rules). */
  schema: S;
  /** Output name sent to providers; letters, digits, `_` and `-`. */
  name: string;
  /** Fixed instruction prefix. Keep it byte-identical across calls so providers can cache it. */
  instructions: string;
  /** Per-call content (brief or evidence), sent after the instructions. */
  prompt: string;
  /** End user's ISO country (`x-vercel-ip-country`) for the Gemini geo gate; null when unknown. */
  country: string | null;
  signal: AbortSignal;
  /** Maximum real model calls for this request (planner 2, creative 3). */
  maxAttempts: number;
  /** Semantic checks after schema validation; any problem moves on to the next slot without a cooldown. */
  validate?: (value: z.output<S>) => string[];
  /** Called once per finished attempt (same objects as `attempts`). */
  onAttempt?: (event: AttemptEvent) => void;
  /** Per-attempt timeout; defaults to 12 s (planner) and 15 s (creative). */
  timeoutMs?: number;
  maxOutputTokens?: number;
}

export type LlmFailureReason =
  /** The caller's signal fired; no further slot was tried. */
  | 'aborted'
  /** At least one model call was made and none produced acceptable output. */
  | 'exhausted'
  /** No model call was possible: no keys, or every slot disabled, geo-blocked, cooling down or capped. */
  | 'no_slots';

export type LlmRunResult<T> =
  | { ok: true; data: T; via: string; model: string; attempts: AttemptEvent[]; skipped: SlotSkip[] }
  | { ok: false; reason: LlmFailureReason; attempts: AttemptEvent[]; skipped: SlotSkip[] };

export interface LlmGateway {
  run<S extends z.ZodType>(request: LlmRunRequest<S>): Promise<LlmRunResult<z.output<S>>>;
}

let instance: LlmGateway | undefined;

/** Process-wide gateway: the provider chain when `LLM_MODE=live`, otherwise the deterministic fake. */
export function getLlmGateway(): LlmGateway {
  if (instance) return instance;
  const env = getEnv();
  instance =
    env.LLM_MODE === 'live'
      ? createChainGateway({ slots: buildSlots(env), geminiAllowedCountries: env.GEMINI_ALLOWED_COUNTRIES })
      : createFakeGateway();
  return instance;
}

/** Test helper: replace (or reset with `undefined`) the process-wide gateway. */
export function setLlmGatewayForTests(next: LlmGateway | undefined): void {
  instance = next;
}

export interface LlmSlotStatus {
  id: string;
  label: string;
  models: Record<LlmKind, string>;
  disabled: boolean;
  geoGated: boolean;
  /** Longest remaining cooldown across the slot's models (ms); 0 when ready. */
  cooldownMs: number;
  usedToday: number;
  dailySoftCap: number;
}

export interface LlmStatus {
  mode: 'mock' | 'live';
  slots: LlmSlotStatus[];
  /** Slot ids whose keys are absent. */
  unconfigured: string[];
}

/** Snapshot for `/status` and the admin health route; reads KV once and never calls a model. */
export async function getLlmStatus(now: number = Date.now()): Promise<LlmStatus> {
  const env = getEnv();
  const slots = buildSlots(env);
  const state = await readChainState(slots, now);
  return {
    mode: env.LLM_MODE,
    slots: slots.map((slot) => {
      const provider = slot.provider ?? slot.id;
      return {
        id: slot.id,
        label: slot.label,
        models: { ...slot.modelIds },
        disabled: state.disabled.has(slot.id) || state.disabled.has(provider),
        geoGated: slot.geoGated,
        cooldownMs: Math.max(
          state.cooldownMs(slot.id, slot.modelIds.planner, provider),
          state.cooldownMs(slot.id, slot.modelIds.creative, provider),
        ),
        usedToday: state.usedToday(slot.id),
        dailySoftCap: slot.dailySoftCap,
      };
    }),
    unconfigured: SLOT_IDS.filter((id) => !slots.some((slot) => slot.id === id)),
  };
}
