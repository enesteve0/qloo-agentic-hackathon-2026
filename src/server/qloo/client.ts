import 'server-only';
import type { EntityType, ProvenanceRequest, QlooPurpose } from '@/shared/types';
import { getEnv, type Env } from '@/server/env';
import type { KV } from '@/server/kv';
import { cacheKey } from './keys';
import {
  QuotaLedger,
  evaluateGuard,
  parseCaps,
  parseRateHeaders,
  type CapsConfig,
  type LedgerSnapshot,
} from './ledger';
import {
  errorDetails,
  normalizeCandidates,
  normalizeDemographics,
  normalizeHeatmap,
  normalizePlaces,
  normalizeRoot,
  normalizeTags,
  unsupportedTypeFrom,
  type Normalized,
} from './normalize';
import { RunLimiter, abortReason, acquireSlot, defaultSleep, releaseSlot, type SleepFn } from './pacing';
import {
  buildDemographics,
  buildEntities,
  buildHeatmap,
  buildPlaces,
  buildSearch,
  buildTagInsights,
  redactQuery,
  toQlooType,
} from './params';
import type {
  CacheMode,
  CallOptions,
  GuardReason,
  QlooApi,
  QlooErrorCode,
  QlooIssue,
  QlooMeta,
  QlooMode,
  QlooResult,
  QlooTransport,
  RateInfo,
  RequestKind,
  RunCtx,
  RunCtxOptions,
  TransportResponse,
} from './types';

/**
 * The Qloo client (ARCHITECTURE §4). Per call: allow-list (builders) → cache + in-flight
 * de-duplication → budget guard → pacing → count attempt → fetch with timeout → ledger → status table
 * → normalize → cache. Raw payloads stay inside this module.
 */

export const TIMEOUTS = {
  root: 8_000,
  search: 8_000,
  entities: 8_000,
  heatmap: 25_000,
  places: 20_000,
  tags: 20_000,
  /** Tag insights with `signal.location` are slower. */
  tagsWithLocation: 25_000,
  demographics: 20_000,
} as const;

/** Transient failures (5xx/timeout/network) are retried only with this much stage budget left. */
export const RETRY_MIN_STAGE_MS = 8_000;
/** Per-second 429s retry after the reset; skip when the stage would be left with less than this. */
export const RATE_RETRY_MIN_STAGE_MS = 2_000;
const CACHE_VERSION = 1;

export type QlooEnv = Pick<
  Env,
  | 'QLOO_MAX_FRESH_PER_RUN'
  | 'QLOO_RUN_RPS'
  | 'QLOO_RUN_SLOTS'
  | 'QLOO_CAPS_JSON'
  | 'EVENT_DATA_EXPIRES_AT'
  | 'EVENT_JUDGING_START'
  | 'EVENT_JUDGING_END'
>;

export interface QlooClient {
  readonly mode: QlooMode;
  /** True for the synthetic transport: label everything SYNTHETIC. */
  readonly synthetic: boolean;
  /** Typed calls bound to one run (per-run cap, pacing, slot and provenance). */
  forRun(ctx: RunCtx): QlooApi;
  /** Frees the run's cross-run slot early (it also expires after 150 s). */
  releaseRun(ctx: RunCtx): Promise<void>;
  /** Current ledger state (admin health, status page, scripts). */
  ledger(): Promise<LedgerSnapshot>;
}

export interface CreateQlooClientOptions {
  /** null for cache-only/off clients. */
  transport: QlooTransport | null;
  kv: KV;
  /** Defaults to the transport kind ('off' without a transport). */
  mode?: QlooMode;
  /** Defaults to getEnv(). */
  env?: QlooEnv;
  /** Defaults to defaults + QLOO_CAPS_JSON. */
  caps?: CapsConfig;
  now?: () => number;
  sleep?: SleepFn;
  random?: () => number;
  /** Daily caps/floors are enforced for live keys and only tracked for the synthetic transport. */
  quota?: 'enforce' | 'track';
  maxInFlight?: number;
  /** Longest wait for a cross-run slot (default 20 s, never past the stage deadline). */
  slotWaitMs?: number;
}

interface CallSpec<T> {
  kind: RequestKind;
  path: string;
  query: URLSearchParams;
  purpose: QlooPurpose;
  timeoutMs: number;
  normalize: (json: unknown, rate: RateInfo) => Normalized<T>;
  cache: CacheMode;
  wktLabel?: string;
  /** Entity type URN the request is about (remembered when Qloo answers 403 for it). */
  typeUrn?: string;
  deadlineAt?: number;
}

interface CacheEntry<T> {
  v: number;
  at: string;
  data: T;
}

interface RunInternal {
  limiter: RunLimiter;
  slot: number | null;
  slotPromise: Promise<number | null> | null;
}

type SendOutcome =
  | { res: TransportResponse }
  | { error: 'aborted' | 'timeout' | 'network'; message: string };

type Decision =
  | { kind: 'ok' }
  | { kind: 'retry'; code: QlooErrorCode; message: string; waitMs: number; minStageMs: number }
  | {
      kind: 'fail';
      code: QlooErrorCode;
      message: string;
      issues?: QlooIssue[];
      breaker?: 'exhausted' | 'auth';
      unsupported?: string;
    };

export function createRunCtx(o: RunCtxOptions): RunCtx {
  const actor = o.actor ?? 'public';
  return {
    runId: o.runId,
    signal: o.signal,
    deadlineAt: o.deadlineAt,
    maxFresh: o.maxFresh,
    actor,
    // Only scripts may bypass phase caps; a public run asking for it is ignored.
    force: actor === 'script' && o.force === true,
    retries: o.retries ?? true,
    onRequest: o.onRequest,
    stats: { fresh: 0, cached: 0, attempts: 0, guarded: 0 },
    requests: [],
  };
}

const stepRuns = new WeakMap<object, RunCtx>();

/**
 * One RunCtx per orchestrator step context (`{ runId, signal, onRequest }`), so the per-run cap,
 * pacing and slot span the resolve, where and evidence stages of a run.
 */
export function runCtxFor(
  step: { runId: string; signal?: AbortSignal; onRequest?: (r: ProvenanceRequest) => void },
  opts: Omit<RunCtxOptions, 'runId' | 'signal' | 'onRequest'> = {},
): RunCtx {
  let ctx = stepRuns.get(step);
  if (!ctx) {
    ctx = createRunCtx({ ...opts, runId: step.runId, signal: step.signal, onRequest: step.onRequest });
    stepRuns.set(step, ctx);
  }
  return ctx;
}

/**
 * How a failure should surface: `quota` (budget guards, monthly quota — show the reserve banner),
 * `unavailable` (auth, mode, network, busy — Qloo cannot be reached now) or `request` (a problem with
 * this particular request).
 */
export function failureKind(f: { code: QlooErrorCode; reason?: GuardReason }): 'quota' | 'unavailable' | 'request' {
  switch (f.code) {
    case 'QUOTA_EXHAUSTED':
      return 'quota';
    case 'BUDGET_GUARD':
      return f.reason === 'auth' || f.reason === 'mode' || f.reason === 'ledger_unavailable' ? 'unavailable' : 'quota';
    case 'AUTH':
    case 'DISABLED':
    case 'CACHE_ONLY':
    case 'BUSY':
    case 'RATE_LIMITED':
    case 'UPSTREAM':
    case 'TIMEOUT':
    case 'NETWORK':
    case 'ABORTED':
      return 'unavailable';
    default:
      return 'request';
  }
}

/** Status table (§4 step 8). Pure so it can be tested and reused by scripts. */
export function decideStatus(outcome: SendOutcome, rate: RateInfo | null, random: () => number, timeoutMs: number): Decision {
  const transientWait = () => 800 + Math.floor(random() * 700);
  if ('error' in outcome) {
    if (outcome.error === 'aborted') return { kind: 'fail', code: 'ABORTED', message: 'The run was cancelled or hit its deadline.' };
    if (outcome.error === 'timeout') {
      return {
        kind: 'retry',
        code: 'TIMEOUT',
        message: `Qloo did not answer within ${Math.round(timeoutMs / 1000)} s.`,
        waitMs: transientWait(),
        minStageMs: RETRY_MIN_STAGE_MS,
      };
    }
    return {
      kind: 'retry',
      code: 'NETWORK',
      message: `Could not reach Qloo (${outcome.message}).`,
      waitMs: transientWait(),
      minStageMs: RETRY_MIN_STAGE_MS,
    };
  }
  const { status, json } = outcome.res;
  if (status >= 200 && status < 300) return { kind: 'ok' };
  const details = errorDetails(json);
  if (status === 429) {
    const month = rate?.month ?? null;
    const bodySaysLimit = /rate limit exceeded/i.test(details.errorMsg ?? details.messages.join(' '));
    // Without a month header the body is the only clue; a per-second header at 0 still means per-second.
    const monthly = month ? month.remaining === 0 : bodySaysLimit && rate?.second?.remaining !== 0;
    if (monthly) {
      return { kind: 'fail', code: 'QUOTA_EXHAUSTED', message: 'Qloo monthly quota is exhausted.', breaker: 'exhausted' };
    }
    const resetMs = Math.max(0, (rate?.second?.resetSec ?? 0) * 1000);
    return {
      kind: 'retry',
      code: 'RATE_LIMITED',
      message: 'Qloo per-second rate limit reached.',
      waitMs: Math.max(resetMs, 1_100) + Math.floor(random() * 250),
      minStageMs: RATE_RETRY_MIN_STAGE_MS,
    };
  }
  if (status === 401) {
    return { kind: 'fail', code: 'AUTH', message: 'Qloo rejected the API key (401).', breaker: 'auth' };
  }
  if (status === 403) {
    const urn = unsupportedTypeFrom(details.messages);
    if (urn) {
      return {
        kind: 'fail',
        code: 'TYPE_UNSUPPORTED',
        message: `This Qloo key cannot use ${urn === 'unknown' ? 'this entity type' : urn}.`,
        unsupported: urn,
      };
    }
    return { kind: 'fail', code: 'FORBIDDEN', message: details.messages[0] ?? 'Qloo refused the request (403).' };
  }
  if (status === 400) {
    return {
      kind: 'fail',
      code: 'BAD_REQUEST',
      message: details.messages.join('; ') || 'Qloo rejected the request (400).',
      issues: details.issues,
    };
  }
  if (status === 404) return { kind: 'fail', code: 'NOT_FOUND', message: 'Qloo endpoint not found (404).' };
  if (status >= 500) {
    return {
      kind: 'retry',
      code: 'UPSTREAM',
      message: `Qloo server error (${status}).`,
      waitMs: transientWait(),
      minStageMs: RETRY_MIN_STAGE_MS,
    };
  }
  return { kind: 'fail', code: 'UPSTREAM', message: `Unexpected Qloo status ${status}.` };
}

/** Rejects as soon as the signal aborts, even if the transport ignores it. */
function raceAbort<T>(p: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) {
    p.catch(() => undefined);
    return Promise.reject(abortReason(signal));
  }
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => {
      p.catch(() => undefined);
      reject(abortReason(signal));
    };
    signal.addEventListener('abort', onAbort, { once: true });
    p.then(
      (v) => {
        signal.removeEventListener('abort', onAbort);
        resolve(v);
      },
      (e: unknown) => {
        signal.removeEventListener('abort', onAbort);
        reject(e);
      },
    );
  });
}

function deferred<T>(): { promise: Promise<T>; resolve: (v: T) => void } {
  let resolve: (v: T) => void = () => undefined;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

function errorText(e: unknown): string {
  if (e instanceof Error) {
    const cause = e.cause instanceof Error ? `: ${e.cause.message}` : '';
    return `${e.message}${cause}`.slice(0, 200);
  }
  return String(e).slice(0, 200);
}

export function createQlooClient(o: CreateQlooClientOptions): QlooClient {
  const env = o.env ?? getEnv();
  const now = o.now ?? Date.now;
  const sleep = o.sleep ?? defaultSleep;
  const random = o.random ?? Math.random;
  const { kv, transport } = o;
  const mode: QlooMode = o.mode ?? transport?.kind ?? 'off';
  if ((mode === 'live' || mode === 'mock') && transport?.kind !== mode) {
    throw new Error(`QLOO_MODE=${mode} needs a ${mode} transport`);
  }
  const synthetic = mode === 'mock';
  // Synthetic data and its fake quota live in their own namespace so they can never pass as live.
  const prefix = synthetic ? 'syn:' : '';
  const caps =
    o.caps ?? parseCaps(env.QLOO_CAPS_JSON, { judgingStart: env.EVENT_JUDGING_START, judgingEnd: env.EVENT_JUDGING_END });
  const ledger = new QuotaLedger({ kv, prefix, now, caps });
  const enforceQuota = (o.quota ?? (synthetic ? 'track' : 'enforce')) === 'enforce';
  const cacheExpiresAt = Date.parse(env.EVENT_DATA_EXPIRES_AT);
  const minGapMs = Math.ceil(1000 / env.QLOO_RUN_RPS);
  const runs = new WeakMap<RunCtx, RunInternal>();
  const inflight = new Map<string, Promise<QlooResult<unknown>>>();

  function internal(ctx: RunCtx): RunInternal {
    let st = runs.get(ctx);
    if (!st) {
      st = {
        limiter: new RunLimiter({ maxInFlight: o.maxInFlight ?? 2, minGapMs, now, sleep }),
        slot: null,
        slotPromise: null,
      };
      runs.set(ctx, st);
    }
    return st;
  }

  async function kvGet<T>(key: string): Promise<T | null> {
    try {
      return await kv.get<T>(key);
    } catch {
      return null; // a cache outage is a miss, not a failed plan
    }
  }

  async function kvSetUntilExpiry(key: string, value: unknown): Promise<void> {
    const ttl = cacheExpiresAt - now();
    if (!(ttl > 0)) return; // after the event data expiry nothing new is stored
    try {
      await kv.set(key, value, { px: ttl });
    } catch {
      // best effort
    }
  }

  async function send(
    spec: Pick<CallSpec<unknown>, 'path' | 'query' | 'timeoutMs'>,
    runSignal: AbortSignal | undefined,
  ): Promise<SendOutcome> {
    if (!transport) return { error: 'network', message: 'no transport' };
    const timeout = new AbortController();
    const timer = setTimeout(
      () => timeout.abort(new DOMException('Qloo request timed out', 'TimeoutError')),
      spec.timeoutMs,
    );
    const signal = runSignal ? AbortSignal.any([runSignal, timeout.signal]) : timeout.signal;
    try {
      return { res: await raceAbort(transport.fetch(spec.path, spec.query, signal), signal) };
    } catch (e) {
      if (runSignal?.aborted) return { error: 'aborted', message: errorText(runSignal.reason) };
      if (timeout.signal.aborted) return { error: 'timeout', message: 'timeout' };
      return { error: 'network', message: errorText(e) };
    } finally {
      clearTimeout(timer);
    }
  }

  async function fresh<T>(
    ctx: RunCtx,
    spec: CallSpec<T>,
    meta: (m?: Partial<QlooMeta>) => QlooMeta,
    report: (status: number | null, ms: number, attempt: number) => void,
    key: string,
  ): Promise<QlooResult<T>> {
    const deadlineAt = spec.deadlineAt ?? ctx.deadlineAt;
    let attempts = 0;
    let last: { status: number | null; rate: RateInfo | null; bytes: number | null } = { status: null, rate: null, bytes: null };
    const fail = (code: QlooErrorCode, message: string, extra: { reason?: GuardReason; issues?: QlooIssue[] } = {}): QlooResult<T> => ({
      ok: false,
      code,
      message,
      ...extra,
      meta: meta({
        attempts,
        status: last.status,
        requestId: last.rate?.requestId ?? null,
        monthRemaining: last.rate?.month?.remaining ?? null,
        bytes: last.bytes,
      }),
    });
    const st = internal(ctx);

    for (let attempt = 1; attempt <= 2; attempt++) {
      // Guard before every attempt: a retry is charged like any other call.
      let snap: LedgerSnapshot;
      try {
        snap = await ledger.read(spec.typeUrn);
      } catch {
        ctx.stats.guarded++;
        return fail('BUDGET_GUARD', 'The quota ledger is unavailable; not calling Qloo blind.', { reason: 'ledger_unavailable' });
      }
      if (snap.unsupported) {
        ctx.stats.guarded++;
        return fail('TYPE_UNSUPPORTED', `This Qloo key cannot use ${spec.typeUrn ?? 'this type'} (remembered from an earlier 403).`);
      }
      const block = evaluateGuard(snap, {
        attemptsThisRun: ctx.stats.attempts,
        maxFresh: ctx.maxFresh ?? env.QLOO_MAX_FRESH_PER_RUN,
        force: ctx.force,
        enforceQuota,
        absoluteFloor: caps.absoluteFloor,
      });
      if (block) {
        if (attempt === 1) ctx.stats.guarded++;
        return fail('BUDGET_GUARD', block.message, { reason: block.reason });
      }

      // A run's first fresh call takes a cross-run slot (≤QLOO_RUN_SLOTS runs call Qloo at once).
      if (st.slot === null) {
        st.slotPromise ??= acquireSlot({
          kv,
          prefix,
          slots: env.QLOO_RUN_SLOTS,
          runId: ctx.runId,
          waitMs: Math.max(0, Math.min(o.slotWaitMs ?? 20_000, (deadlineAt ?? Number.POSITIVE_INFINITY) - now() - 2_000)),
          now,
          sleep,
          random,
          signal: ctx.signal,
        });
        let slot: number | null;
        try {
          slot = await st.slotPromise;
        } catch {
          st.slotPromise = null;
          return ctx.signal?.aborted
            ? fail('ABORTED', 'The run was cancelled before Qloo was called.')
            : fail('BUDGET_GUARD', 'The slot store is unavailable; not calling Qloo blind.', { reason: 'ledger_unavailable' });
        }
        if (slot === null) {
          st.slotPromise = null;
          ctx.stats.guarded++;
          return fail('BUSY', 'Qloo is busy with other plans right now; try again in a moment.');
        }
        st.slot = slot;
      }

      let release: () => void;
      try {
        release = await st.limiter.acquire(ctx.signal);
      } catch {
        return fail('ABORTED', 'The run was cancelled before Qloo was called.');
      }

      // Counted before sending: Qloo charges every attempt, including ones that fail in flight.
      if (attempt === 1) ctx.stats.fresh++;
      ctx.stats.attempts++;
      attempts++;
      try {
        await ledger.recordAttempt();
      } catch {
        // the guard already passed; an uncounted attempt is better than a dropped plan
      }
      const t0 = now();
      let outcome: SendOutcome;
      try {
        outcome = await send(spec, ctx.signal);
      } finally {
        release();
      }
      const ms = now() - t0;
      let rate: RateInfo | null = null;
      if ('res' in outcome) {
        rate = parseRateHeaders(outcome.res.headers);
        last = { status: outcome.res.status, rate, bytes: outcome.res.bytes ?? null };
        try {
          await ledger.recordRate(rate);
        } catch {
          // best effort
        }
      }
      report('res' in outcome ? outcome.res.status : null, ms, attempt);

      const d = decideStatus(outcome, rate, random, spec.timeoutMs);
      if (d.kind === 'retry') {
        const canRetry =
          attempt === 1 &&
          ctx.retries &&
          (deadlineAt === undefined || deadlineAt - now() - d.waitMs >= d.minStageMs);
        if (!canRetry) return fail(d.code, d.message);
        try {
          await sleep(d.waitMs, ctx.signal);
        } catch {
          return fail('ABORTED', 'The run was cancelled while waiting to retry Qloo.');
        }
        continue;
      }
      if (d.kind === 'fail') {
        try {
          if (d.breaker === 'exhausted') await ledger.tripExhausted(rate?.month?.resetSec ?? null);
          if (d.breaker === 'auth') await ledger.tripAuth();
          const urn = d.unsupported === 'unknown' ? spec.typeUrn : d.unsupported;
          if (urn) await ledger.rememberUnsupported(urn);
        } catch {
          // best effort
        }
        return fail(d.code, d.message, d.issues ? { issues: d.issues } : {});
      }

      // 2xx
      const res = (outcome as { res: TransportResponse }).res;
      const n = spec.normalize(res.json, rate ?? parseRateHeaders(res.headers));
      if (!n.ok) return fail('BAD_RESPONSE', n.message);
      if (spec.cache !== 'skip') {
        const entry: CacheEntry<T> = { v: CACHE_VERSION, at: new Date(now()).toISOString(), data: n.value };
        await kvSetUntilExpiry(key, entry);
      }
      return { ok: true, data: n.value, meta: meta({ attempts, status: res.status, requestId: rate?.requestId ?? null, monthRemaining: rate?.month?.remaining ?? null, bytes: res.bytes ?? null }) };
    }
    // Unreachable: the loop returns on every path of the second attempt.
    return fail('UPSTREAM', 'Qloo call failed.');
  }

  async function call<T>(ctx: RunCtx, spec: CallSpec<T>): Promise<QlooResult<T>> {
    const started = now();
    const key = prefix + cacheKey(spec.path, spec.query);
    const redacted = redactQuery(spec.query, spec.wktLabel);
    const meta = (m: Partial<QlooMeta> = {}): QlooMeta => ({
      key,
      cache: 'miss',
      attempts: 0,
      ms: now() - started,
      status: null,
      requestId: null,
      monthRemaining: null,
      cachedAt: null,
      bytes: null,
      ...m,
    });
    const report = (status: number | null, cache: 'hit' | 'miss', ms: number, attempt: number) => {
      const r: ProvenanceRequest = { method: 'GET', path: spec.path, query: redacted, status, cache, ms, attempt, purpose: spec.purpose };
      ctx.requests.push(r);
      try {
        ctx.onRequest?.(r);
      } catch {
        // a provenance sink must never break a call
      }
    };
    if (mode === 'off') return { ok: false, code: 'DISABLED', message: 'Qloo is turned off (QLOO_MODE=off).', meta: meta() };

    const shareable = spec.cache === 'default';
    if (shareable) {
      const pending = inflight.get(key);
      if (pending) {
        const joined = await pending;
        // Only successes are shared; a failure may be specific to the other run (e.g. its cap).
        if (joined.ok) {
          ctx.stats.cached++;
          const ms = now() - started;
          report(joined.meta.status, 'hit', ms, 0);
          return { ok: true, data: joined.data as T, meta: { ...joined.meta, cache: 'hit', attempts: 0, ms } };
        }
      }
    }
    const gate = shareable && !inflight.has(key) ? deferred<QlooResult<unknown>>() : null;
    if (gate) inflight.set(key, gate.promise);
    let result: QlooResult<T> | null = null;
    try {
      if (spec.cache === 'default') {
        const hit = await kvGet<CacheEntry<T>>(key);
        if (hit && hit.v === CACHE_VERSION) {
          ctx.stats.cached++;
          const ms = now() - started;
          report(200, 'hit', ms, 0);
          result = { ok: true, data: hit.data, meta: meta({ cache: 'hit', status: 200, cachedAt: hit.at, ms }) };
          return result;
        }
      }
      if (mode === 'cache-only' || !transport) {
        result = { ok: false, code: 'CACHE_ONLY', message: 'This Qloo result is not cached and live calls are off (cache-only).', meta: meta() };
        return result;
      }
      result = await fresh(ctx, spec, meta, (status, ms, attempt) => report(status, 'miss', ms, attempt), key);
      return result;
    } finally {
      if (gate) {
        inflight.delete(key);
        gate.resolve(result ?? { ok: false, code: 'UPSTREAM', message: 'Qloo call failed unexpectedly.', meta: meta() });
      }
    }
  }

  function forRun(ctx: RunCtx): QlooApi {
    const base = <T>(
      kind: RequestKind,
      path: string,
      query: URLSearchParams,
      opts: CallOptions,
      defaults: { purpose: QlooPurpose; timeoutMs: number; cache?: CacheMode },
      normalize: CallSpec<T>['normalize'],
      extra: Pick<CallSpec<T>, 'wktLabel' | 'typeUrn'> = {},
    ): Promise<QlooResult<T>> =>
      call<T>(ctx, {
        kind,
        path,
        query,
        purpose: opts.purpose ?? defaults.purpose,
        timeoutMs: opts.timeoutMs ?? defaults.timeoutMs,
        cache: opts.cache ?? defaults.cache ?? 'default',
        deadlineAt: opts.deadlineAt,
        normalize,
        ...extra,
      });

    return {
      ctx,
      mode,
      synthetic,
      // `async` so parameter errors from the builders surface as rejected promises.
      search: async (query, type: EntityType, opts = {}) =>
        base(
          'search',
          '/search',
          buildSearch({ query, type, take: opts.take, location: opts.location }),
          opts,
          { purpose: 'resolve', timeoutMs: TIMEOUTS.search },
          (json) => normalizeCandidates(json, type),
          { typeUrn: toQlooType(type) },
        ),
      entities: async (ids, opts = {}) =>
        base('entities', '/entities', buildEntities(ids), opts, { purpose: 'resolve', timeoutMs: TIMEOUTS.entities }, (json) =>
          normalizeCandidates(json),
        ),
      heatmap: async (req) =>
        base(
          'heatmap',
          '/v2/insights',
          buildHeatmap(req),
          req,
          { purpose: 'heatmap', timeoutMs: TIMEOUTS.heatmap },
          normalizeHeatmap,
          { wktLabel: 'wkt' in req.location ? req.location.label : undefined },
        ),
      places: async (req) =>
        base(
          'places',
          '/v2/insights',
          buildPlaces(req),
          req,
          { purpose: 'evidence', timeoutMs: TIMEOUTS.places },
          normalizePlaces,
          { wktLabel: req.label, typeUrn: 'urn:entity:place' },
        ),
      tagInsights: async (req) =>
        base(
          'tags',
          '/v2/insights',
          buildTagInsights(req),
          req,
          { purpose: 'evidence', timeoutMs: req.location ? TIMEOUTS.tagsWithLocation : TIMEOUTS.tags },
          normalizeTags,
          { wktLabel: req.location?.label },
        ),
      demographics: async (ids, opts = {}) =>
        base(
          'demographics',
          '/v2/insights',
          buildDemographics(ids),
          opts,
          { purpose: 'baseline', timeoutMs: TIMEOUTS.demographics },
          normalizeDemographics,
        ),
      root: async (opts = {}) =>
        base('root', '/', new URLSearchParams(), opts, { purpose: 'health', timeoutMs: TIMEOUTS.root, cache: 'skip' }, (json, rate) =>
          normalizeRoot(json, rate),
        ),
      memo: {
        get: <T>(k: string) => kvGet<T>(prefix + k),
        set: (k: string, value: unknown) => kvSetUntilExpiry(prefix + k, value),
      },
    };
  }

  return {
    mode,
    synthetic,
    forRun,
    async releaseRun(ctx) {
      const st = runs.get(ctx);
      if (st?.slot == null) return;
      const slot = st.slot;
      st.slot = null;
      st.slotPromise = null;
      try {
        await releaseSlot(kv, prefix, slot, ctx.runId);
      } catch {
        // the slot expires on its own
      }
    },
    ledger: () => ledger.read(),
  };
}
