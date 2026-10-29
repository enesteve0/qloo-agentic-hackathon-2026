import 'server-only';
import {
  APICallError,
  EmptyResponseBodyError,
  InvalidResponseDataError,
  LoadAPIKeyError,
  NoContentGeneratedError,
  NoObjectGeneratedError,
  NoOutputGeneratedError,
  RetryError,
} from 'ai';
import { kv } from '@/server/kv';

export type ErrorKind =
  | 'rate_limit'
  | 'server'
  | 'timeout'
  | 'network'
  | 'auth'
  | 'not_found'
  | 'error_body'
  | 'bad_request'
  | 'invalid_output'
  | 'aborted'
  | 'unknown';

export const COOLDOWN_MS = {
  rateLimitDefault: 60_000,
  min: 1_000,
  max: 24 * 60 * 60_000,
  server: 20_000,
  timeout: 30_000,
  network: 30_000,
  auth: 30 * 60_000,
  notFound: 6 * 60 * 60_000,
  errorBody: 30_000,
  schemaBreaker: 10 * 60_000,
} as const;

/** Three schema failures inside a ten-minute window bench the model for ten minutes. */
export const SCHEMA_BREAKER = { failures: 3, windowMs: 10 * 60_000 } as const;

export interface ErrorClass {
  kind: ErrorKind;
  status: number | null;
  /** Cooldown to apply (ms); null = none. */
  cooldownMs: number | null;
  /** `provider` benches every model of the slot (bad key, no credit); `model` benches one model. */
  scope: 'provider' | 'model';
  /** Counts toward the schema-failure breaker instead of an immediate cooldown. */
  schemaFailure: boolean;
  detail: string;
}

// ---------------------------------------------------------------------------------------------
// Rate-limit headers
// ---------------------------------------------------------------------------------------------

const DURATION_UNIT_MS: Record<string, number> = { h: 3_600_000, m: 60_000, s: 1_000, ms: 1, us: 0.001, 'µs': 0.001, ns: 0.000_001 };
const DURATION_RE = /^(?:\d+(?:\.\d+)?(?:h|ms|us|µs|ns|m|s))+$/;
const DURATION_PART_RE = /(\d+(?:\.\d+)?)(h|ms|us|µs|ns|m|s)/g;

/** Parses Go-style durations as sent by Groq (`2m59.56s`, `7.66s`, `120ms`, `1h2m3s`) into ms. */
export function parseDurationMs(text: string | null | undefined): number | null {
  const value = text?.trim();
  if (!value || !DURATION_RE.test(value)) return null;
  let total = 0;
  for (const [, amount, unit] of value.matchAll(DURATION_PART_RE)) total += Number(amount) * (DURATION_UNIT_MS[unit ?? ''] ?? 0);
  return Math.round(total);
}

function plainNumber(text: string | null | undefined): number | null {
  const value = text?.trim();
  return value && /^\d+(?:\.\d+)?$/.test(value) ? Number(value) : null;
}

function lowerKeys(headers: Record<string, unknown> | undefined | null): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers ?? {})) if (typeof value === 'string') out[key.toLowerCase()] = value;
  return out;
}

/** `retry-after-ms`, then `retry-after` as seconds, a duration or an HTTP date. */
function retryAfterMs(h: Record<string, string>, now: number): number | null {
  const ms = plainNumber(h['retry-after-ms']);
  if (ms !== null) return ms;
  const raw = h['retry-after'];
  if (!raw) return null;
  const seconds = plainNumber(raw);
  if (seconds !== null) return seconds * 1000;
  const duration = parseDurationMs(raw);
  if (duration !== null) return duration;
  const date = Date.parse(raw);
  return Number.isFinite(date) ? Math.max(0, date - now) : null;
}

/** Groq `x-ratelimit-reset-{requests,tokens}`; the exhausted limit decides. */
function groqResetMs(h: Record<string, string>): number | null {
  const limits = (['requests', 'tokens'] as const)
    .map((name) => {
      const raw = h[`x-ratelimit-reset-${name}`];
      const plain = plainNumber(raw);
      return {
        remaining: plainNumber(h[`x-ratelimit-remaining-${name}`]),
        reset: parseDurationMs(raw) ?? (plain === null ? null : plain * 1000),
      };
    })
    .filter((l): l is { remaining: number | null; reset: number } => l.reset !== null);
  if (limits.length === 0) return null;
  const exhausted = limits.filter((l) => l.remaining !== null && l.remaining <= 0);
  // When we cannot tell which limit tripped, take the shorter reset: a wasted retry costs one fast
  // 429, while benching the best slot for hours costs every run in between.
  return exhausted.length > 0 ? Math.max(...exhausted.map((l) => l.reset)) : Math.min(...limits.map((l) => l.reset));
}

/** Generic `x-ratelimit-reset` (OpenRouter sends epoch ms): epoch ms, epoch s, seconds or a duration. */
function resetHeaderMs(raw: string | undefined, now: number): number | null {
  const n = plainNumber(raw);
  if (n !== null) {
    if (n > 1e12) return Math.max(0, n - now);
    if (n > 1e9) return Math.max(0, n * 1000 - now);
    return n * 1000;
  }
  return parseDurationMs(raw);
}

/** OpenRouter repeats upstream rate-limit headers inside the error body (`error.metadata.headers`). */
function bodyHeaders(data: unknown): Record<string, string> {
  if (typeof data !== 'object' || data === null) return {};
  const error = (data as { error?: unknown }).error;
  if (typeof error !== 'object' || error === null) return {};
  const metadata = (error as { metadata?: unknown }).metadata;
  if (typeof metadata !== 'object' || metadata === null) return {};
  const headers = (metadata as { headers?: unknown }).headers;
  return typeof headers === 'object' && headers !== null ? lowerKeys(headers as Record<string, unknown>) : {};
}

export function clampCooldownMs(ms: number): number {
  return Math.min(COOLDOWN_MS.max, Math.max(COOLDOWN_MS.min, Math.round(ms)));
}

/** Cooldown for a 429: retry-after → Groq resets → x-ratelimit-reset → body headers → 60 s; 1 s–24 h. */
export function rateLimitCooldownMs(headers: Record<string, string> | undefined, data: unknown, now: number): number {
  const h = lowerKeys(headers);
  const body = bodyHeaders(data);
  const ms =
    retryAfterMs(h, now) ??
    groqResetMs(h) ??
    resetHeaderMs(h['x-ratelimit-reset'], now) ??
    retryAfterMs(body, now) ??
    resetHeaderMs(body['x-ratelimit-reset'], now) ??
    COOLDOWN_MS.rateLimitDefault;
  return clampCooldownMs(ms);
}

// ---------------------------------------------------------------------------------------------
// Error classification
// ---------------------------------------------------------------------------------------------

function isAbortLike(error: unknown): boolean {
  const name = typeof error === 'object' && error !== null ? (error as { name?: unknown }).name : undefined;
  return name === 'AbortError' || name === 'TimeoutError' || name === 'ResponseAborted';
}

function errorDetail(error: unknown): string {
  const text =
    error instanceof Error ? `${error.name}: ${error.message}` : typeof error === 'string' ? error : 'non-error thrown';
  // Collapse whitespace and keep it short: provider messages can be long HTML pages.
  return text.replace(/\s+/g, ' ').slice(0, 240);
}

function result(kind: ErrorKind, status: number | null, cooldownMs: number | null, detail: string, extra: Partial<ErrorClass> = {}): ErrorClass {
  return { kind, status, cooldownMs, scope: 'model', schemaFailure: false, detail, ...extra };
}

/** Maps any error thrown by `generateText` to a cooldown policy (ARCHITECTURE §11). */
export function classifyError(error: unknown, ctx: { callerAborted: boolean; now: number }): ErrorClass {
  const err = RetryError.isInstance(error) ? error.lastError : error;
  const detail = errorDetail(err);
  if (ctx.callerAborted) return result('aborted', null, null, detail);
  // Not the caller's signal, so it was our own per-attempt timeout.
  if (isAbortLike(err)) return result('timeout', null, COOLDOWN_MS.timeout, detail);
  if (APICallError.isInstance(err)) {
    const status = err.statusCode ?? null;
    if (status === null) return result('network', null, COOLDOWN_MS.network, detail);
    // OpenRouter reports upstream failures as HTTP 200 with an error body; a malformed success body lands here too.
    if (status === 200) return result('error_body', 200, COOLDOWN_MS.errorBody, detail);
    if (status === 429) return result('rate_limit', 429, rateLimitCooldownMs(err.responseHeaders, err.data, ctx.now), detail);
    if (status === 401 || status === 402 || status === 403) return result('auth', status, COOLDOWN_MS.auth, detail, { scope: 'provider' });
    if (status === 404) return result('not_found', 404, COOLDOWN_MS.notFound, detail);
    if (status === 408) return result('timeout', 408, COOLDOWN_MS.timeout, detail);
    // 498 is Groq's flex-capacity status; 409 is a transient conflict.
    if (status >= 500 || status === 498 || status === 409) return result('server', status, COOLDOWN_MS.server, detail);
    // Other 4xx (400 json_validate_failed, 413, 422): likely this request on this model; let the breaker decide.
    return result('bad_request', status, null, detail, { schemaFailure: true });
  }
  if (LoadAPIKeyError.isInstance(err)) return result('auth', null, COOLDOWN_MS.auth, detail, { scope: 'provider' });
  if (
    NoObjectGeneratedError.isInstance(err) ||
    NoOutputGeneratedError.isInstance(err) ||
    NoContentGeneratedError.isInstance(err) ||
    InvalidResponseDataError.isInstance(err) ||
    EmptyResponseBodyError.isInstance(err)
  ) {
    return result('invalid_output', null, null, detail, { schemaFailure: true });
  }
  // Our own bugs (TypeError and friends) would fail on every slot; do not blame the provider.
  return result('unknown', null, null, detail);
}

// ---------------------------------------------------------------------------------------------
// KV state: kill switch, cooldowns, schema breaker, daily soft caps
// ---------------------------------------------------------------------------------------------

const DAY_MS = 86_400_000;

export const LLM_KEYS = {
  /** Kill switch: JSON array of slot ids to skip (a comma-separated string also works). */
  disabled: 'cfg:llm:disabled',
  /** Provider-wide cooldown (auth/payment errors). */
  providerCooldown: (slot: string) => `llm:cd:${slot}`,
  /** Model cooldown (rate limits, 5xx, timeouts, 404, schema breaker). */
  modelCooldown: (slot: string, model: string) => `llm:cd:${slot}:${model}`,
  schemaFailures: (slot: string, model: string) => `llm:sf:${slot}:${model}`,
  dailyUse: (slot: string, day: string) => `llm:use:${slot}:${day}`,
};

/** UTC calendar day used for daily soft caps. */
export function utcDay(now: number): string {
  return new Date(now).toISOString().slice(0, 10);
}

interface CooldownRecord {
  until: number;
  kind: ErrorKind;
  status: number | null;
}

export interface ChainState {
  disabled: ReadonlySet<string>;
  /**
   * Remaining cooldown for a slot's model (max of provider-wide and model-specific), ms; 0 when ready.
   * `provider` defaults to the slot id.
   */
  cooldownMs(slot: string, model: string, provider?: string): number;
  usedToday(slot: string): number;
}

function warnKv(op: string, error: unknown): void {
  console.warn(`[llm] KV ${op} failed; continuing without it: ${errorDetail(error)}`);
}

function parseDisabled(value: unknown): Set<string> {
  const items = Array.isArray(value) ? value : typeof value === 'string' ? value.split(',') : [];
  return new Set(items.filter((v): v is string => typeof v === 'string').map((v) => v.trim()).filter(Boolean));
}

function remainingMs(record: unknown, now: number): number {
  if (typeof record !== 'object' || record === null) return 0;
  const until = (record as Partial<CooldownRecord>).until;
  return typeof until === 'number' && until > now ? until - now : 0;
}

/**
 * Reads the kill switch, cooldowns and today's usage for every slot in one KV round trip.
 * A KV outage degrades to "no state" so the language models stay usable.
 */
export async function readChainState(
  slots: readonly { id: string; provider?: string; modelIds: Readonly<Record<string, string>> }[],
  now: number,
): Promise<ChainState> {
  const day = utcDay(now);
  const keys = new Set<string>([LLM_KEYS.disabled]);
  for (const slot of slots) {
    keys.add(LLM_KEYS.providerCooldown(slot.provider ?? slot.id));
    keys.add(LLM_KEYS.dailyUse(slot.id, day));
    for (const model of Object.values(slot.modelIds)) keys.add(LLM_KEYS.modelCooldown(slot.id, model));
  }
  const list = [...keys];
  let values: unknown[] = [];
  try {
    values = await kv().mget<unknown>(list);
  } catch (error) {
    warnKv('read', error);
  }
  const byKey = new Map(list.map((key, i) => [key, values[i] ?? null]));
  return {
    disabled: parseDisabled(byKey.get(LLM_KEYS.disabled)),
    cooldownMs: (slot, model, provider = slot) =>
      Math.max(
        remainingMs(byKey.get(LLM_KEYS.providerCooldown(provider)), now),
        remainingMs(byKey.get(LLM_KEYS.modelCooldown(slot, model)), now),
      ),
    usedToday: (slot) => {
      const used = byKey.get(LLM_KEYS.dailyUse(slot, day));
      return typeof used === 'number' ? used : 0;
    },
  };
}

/**
 * Benches a slot's model (or the whole provider, which defaults to the slot id). Never shortens a longer
 * cooldown set concurrently.
 */
export async function setCooldown(
  slot: string,
  model: string,
  cls: Pick<ErrorClass, 'kind' | 'status' | 'cooldownMs' | 'scope'>,
  now: number,
  provider: string = slot,
): Promise<void> {
  const ms = cls.cooldownMs;
  if (!ms || ms <= 0) return;
  const key = cls.scope === 'provider' ? LLM_KEYS.providerCooldown(provider) : LLM_KEYS.modelCooldown(slot, model);
  try {
    if ((await kv().pttl(key)) > ms) return;
    const record: CooldownRecord = { until: now + ms, kind: cls.kind, status: cls.status };
    await kv().set(key, record, { px: ms });
  } catch (error) {
    warnKv('cooldown write', error);
  }
}

/** Counts a schema failure; returns the cooldown (ms) when this one tripped the breaker. */
export async function recordSchemaFailure(slot: string, model: string, now: number): Promise<number | null> {
  const key = LLM_KEYS.schemaFailures(slot, model);
  try {
    const count = await kv().incrby(key, 1, SCHEMA_BREAKER.windowMs);
    if (count < SCHEMA_BREAKER.failures) return null;
    await kv().del([key]);
  } catch (error) {
    warnKv('schema counter', error);
    return null;
  }
  await setCooldown(slot, model, { kind: 'invalid_output', status: null, cooldownMs: COOLDOWN_MS.schemaBreaker, scope: 'model' }, now);
  return COOLDOWN_MS.schemaBreaker;
}

/** Every attempt counts toward the slot's daily soft cap, errors included. */
export async function countAttempt(slot: string, now: number): Promise<void> {
  try {
    await kv().incrby(LLM_KEYS.dailyUse(slot, utcDay(now)), 1, 2 * DAY_MS);
  } catch (error) {
    warnKv('usage counter', error);
  }
}
