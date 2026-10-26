import 'server-only';
import { z } from 'zod';
import type { KV } from '@/server/kv';
import type { GuardReason, RateInfo, RateWindow } from './types';

/**
 * Quota ledger (ARCHITECTURE §4 step 5/7, §15). Every attempt is counted before it is sent, because
 * Qloo charges errors too. The month counter from response headers is min-merged (concurrent
 * responses arrive out of order) and cross-checked against our own attempt count.
 */

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const MONTH_TTL = 31 * DAY;

export const AUTH_BREAKER_MS = 10 * MINUTE;
/** Breaker length when a monthly 429 carries no reset header. */
export const EXHAUSTED_FALLBACK_MS = HOUR;
export const UNSUPPORTED_TTL_MS = DAY;
export const DAY_KEY_TTL_MS = 14 * DAY;

export const LEDGER_KEYS = {
  total: 'qloo:attempts:total',
  day: (etDayKey: string) => `qloo:attempts:${etDayKey}`,
  monthRemaining: 'qloo:month:remaining',
  monthLimit: 'qloo:month:limit',
  monthResetAt: 'qloo:month:reset_at',
  secondLimit: 'qloo:second:limit',
  exhausted: 'qloo:exhausted',
  authFail: 'qloo:auth_fail',
  unsupported: (urn: string) => `qloo:unsupported:${urn}`,
} as const;

/** Runtime switch shared by every mode (not namespaced): `cache-only` or `off` stop fresh calls. */
export const CFG_MODE_KEY = 'cfg:qloo:mode';

// ---------------------------------------------------------------------------------------------
// Eastern-time calendar day
// ---------------------------------------------------------------------------------------------

const ET_PARTS = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** `YYYY-MM-DD` in America/New_York (DST-aware; Nov 1 2026 ends EDT). */
export function etDay(epochMs: number): string {
  const parts = ET_PARTS.formatToParts(new Date(epochMs));
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '00';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

// ---------------------------------------------------------------------------------------------
// Rate-limit headers
// ---------------------------------------------------------------------------------------------

function headerNumber(headers: Headers, name: string): number | null {
  const raw = headers.get(name);
  if (raw === null || raw.trim() === '') return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

function windowFrom(headers: Headers, prefix: string): RateWindow | null {
  const w = {
    limit: headerNumber(headers, `${prefix}-limit`),
    remaining: headerNumber(headers, `${prefix}-remaining`),
    resetSec: headerNumber(headers, `${prefix}-reset`),
  };
  return w.limit === null && w.remaining === null && w.resetSec === null ? null : w;
}

export function parseRateHeaders(headers: Headers): RateInfo {
  return {
    second: windowFrom(headers, 'x-second-ratelimit'),
    month: windowFrom(headers, 'x-month-ratelimit'),
    requestId: headers.get('x-qloo-request-id') ?? headers.get('x-request-id') ?? headers.get('request-id'),
  };
}

// ---------------------------------------------------------------------------------------------
// Phases and caps (§15); QLOO_CAPS_JSON overrides any field
// ---------------------------------------------------------------------------------------------

export const PHASE_IDS = ['build', 'pre_judging', 'judging', 'finale', 'after'] as const;
export type PhaseId = (typeof PHASE_IDS)[number];
export type QuotaProfile = '10k' | '50k';

export interface PhaseCaps {
  id: PhaseId;
  /** Phase end (exclusive, ISO); null for the last phase. */
  until: string | null;
  /** Qloo attempts per ET day. */
  dailyCap: number;
  /** Live runs per day (enforced by the run guards, exposed here for them). */
  liveRunsPerDay: number;
  /** Stop fresh public calls when the effective remaining quota would drop below this. */
  floor: number | null;
}

export interface CapsConfig {
  profile: 'auto' | QuotaProfile;
  /** Multiplier for caps and floors when the key has the 50k profile. */
  scale50k: number;
  /** Floor for scripts run with --force. */
  absoluteFloor: number;
  phases: PhaseCaps[];
}

export interface ActivePhase extends PhaseCaps {
  profile: QuotaProfile;
  scale: number;
}

export interface CapsDates {
  /** EVENT_JUDGING_START: end of the pre-judging phase (Nov 2 12:00 ET). */
  judgingStart?: string;
  /** EVENT_JUDGING_END: end of the finale (Nov 5 23:45 ET). */
  judgingEnd?: string;
}

export function defaultCaps(dates: CapsDates = {}): CapsConfig {
  return {
    profile: 'auto',
    scale50k: 5,
    absoluteFloor: 300,
    phases: [
      // Submission deadline Oct 30 23:45 EDT.
      { id: 'build', until: '2026-10-31T03:45:00Z', dailyCap: 400, liveRunsPerDay: 25, floor: 6_500 },
      { id: 'pre_judging', until: dates.judgingStart ?? '2026-11-02T17:00:00Z', dailyCap: 300, liveRunsPerDay: 25, floor: 6_500 },
      // Nov 5 00:00 EST.
      { id: 'judging', until: '2026-11-05T05:00:00Z', dailyCap: 1_500, liveRunsPerDay: 100, floor: 600 },
      { id: 'finale', until: dates.judgingEnd ?? '2026-11-06T04:45:00Z', dailyCap: 1_500, liveRunsPerDay: 100, floor: 150 },
      { id: 'after', until: null, dailyCap: 0, liveRunsPerDay: 0, floor: null },
    ],
  };
}

const PhaseOverride = z.strictObject({
  until: z.iso.datetime().nullable().optional(),
  dailyCap: z.number().int().nonnegative().optional(),
  liveRunsPerDay: z.number().int().nonnegative().optional(),
  floor: z.number().int().nonnegative().nullable().optional(),
});

const CapsOverride = z.strictObject({
  profile: z.enum(['auto', '10k', '50k']).optional(),
  scale50k: z.number().positive().optional(),
  absoluteFloor: z.number().int().nonnegative().optional(),
  phases: z
    .strictObject({
      build: PhaseOverride.optional(),
      pre_judging: PhaseOverride.optional(),
      judging: PhaseOverride.optional(),
      finale: PhaseOverride.optional(),
      after: PhaseOverride.optional(),
    })
    .optional(),
});

/**
 * Defaults merged with QLOO_CAPS_JSON, e.g. `{"profile":"50k","phases":{"build":{"dailyCap":200}}}`.
 * Throws on invalid JSON or unknown fields: a silently ignored typo in a quota cap is worse than a
 * loud startup error.
 */
export function parseCaps(json: string | undefined, dates: CapsDates = {}): CapsConfig {
  const caps = defaultCaps(dates);
  if (!json || json.trim() === '') return caps;
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    throw new Error('QLOO_CAPS_JSON is not valid JSON');
  }
  const parsed = CapsOverride.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ');
    throw new Error(`QLOO_CAPS_JSON is invalid: ${issues}`);
  }
  const o = parsed.data;
  return {
    profile: o.profile ?? caps.profile,
    scale50k: o.scale50k ?? caps.scale50k,
    absoluteFloor: o.absoluteFloor ?? caps.absoluteFloor,
    phases: caps.phases.map((p) => {
      const po = o.phases?.[p.id];
      if (!po) return p;
      return {
        ...p,
        ...(po.until !== undefined ? { until: po.until } : {}),
        ...(po.dailyCap !== undefined ? { dailyCap: po.dailyCap } : {}),
        ...(po.liveRunsPerDay !== undefined ? { liveRunsPerDay: po.liveRunsPerDay } : {}),
        ...(po.floor !== undefined ? { floor: po.floor } : {}),
      };
    }),
  };
}

/** Keys with a 50,000-call month are the "50k" profile; anything else (or unknown) is "10k". */
export function profileFromLimit(limit: number | null | undefined): QuotaProfile {
  return typeof limit === 'number' && limit >= 50_000 ? '50k' : '10k';
}

export function resolveProfile(caps: CapsConfig, monthLimit: number | null): QuotaProfile {
  return caps.profile === 'auto' ? profileFromLimit(monthLimit) : caps.profile;
}

/** The phase in force at `now`, with caps and floors scaled for the 50k profile. */
export function phaseAt(now: number, caps: CapsConfig, profile: QuotaProfile): ActivePhase {
  const phase =
    caps.phases.find((p) => p.until === null || now < Date.parse(p.until)) ?? caps.phases[caps.phases.length - 1];
  if (!phase) throw new Error('Qloo caps define no phases');
  const scale = profile === '50k' ? caps.scale50k : 1;
  return {
    ...phase,
    dailyCap: Math.floor(phase.dailyCap * scale),
    liveRunsPerDay: Math.floor(phase.liveRunsPerDay * scale),
    floor: phase.floor === null ? null : Math.floor(phase.floor * scale),
    profile,
    scale,
  };
}

// ---------------------------------------------------------------------------------------------
// Ledger
// ---------------------------------------------------------------------------------------------

export interface LedgerSnapshot {
  etDay: string;
  attemptsTotal: number;
  attemptsToday: number;
  /** Min-merged `x-month-ratelimit-remaining`, null until a response carried it. */
  headerRemaining: number | null;
  /** `x-month-ratelimit-limit` when known. */
  monthLimit: number | null;
  /** Limit used for the attempt-based estimate (header, else the profile default). */
  limit: number;
  /** min(headerRemaining, limit − attemptsTotal). */
  effectiveRemaining: number;
  monthResetAt: string | null;
  secondLimit: number | null;
  profile: QuotaProfile;
  phase: ActivePhase;
  exhaustedUntil: string | null;
  authFailUntil: string | null;
  cfgMode: string | null;
  /** Whether the type asked about in read() was remembered as unsupported (403). */
  unsupported: boolean;
}

export interface LedgerOptions {
  kv: KV;
  /** Namespace prefix: '' for live, 'syn:' for the synthetic transport. */
  prefix: string;
  now: () => number;
  caps: CapsConfig;
}

function toNum(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return Number(v);
  return null;
}

function toStr(v: unknown): string | null {
  return typeof v === 'string' && v !== '' ? v : null;
}

function ttlFromReset(resetSec: number | null, fallbackMs: number): number {
  return resetSec !== null && resetSec > 0 ? Math.min(Math.ceil(resetSec * 1000), MONTH_TTL) : fallbackMs;
}

export class QuotaLedger {
  private lastSecondLimit: number | null = null;

  constructor(private readonly o: LedgerOptions) {}

  key(name: string): string {
    return this.o.prefix + name;
  }

  /** One KV round-trip with everything the guard needs. */
  async read(unsupportedUrn?: string | null): Promise<LedgerSnapshot> {
    const now = this.o.now();
    const day = etDay(now);
    const keys = [
      LEDGER_KEYS.exhausted,
      LEDGER_KEYS.authFail,
      LEDGER_KEYS.total,
      LEDGER_KEYS.day(day),
      LEDGER_KEYS.monthRemaining,
      LEDGER_KEYS.monthLimit,
      LEDGER_KEYS.monthResetAt,
      LEDGER_KEYS.secondLimit,
    ].map((k) => this.key(k));
    keys.push(CFG_MODE_KEY);
    if (unsupportedUrn) keys.push(this.key(LEDGER_KEYS.unsupported(unsupportedUrn)));
    const v = await this.o.kv.mget<unknown>(keys);
    const monthLimit = toNum(v[5]);
    const profile = resolveProfile(this.o.caps, monthLimit);
    const limit = monthLimit ?? (profile === '50k' ? 50_000 : 10_000);
    const attemptsTotal = toNum(v[2]) ?? 0;
    const headerRemaining = toNum(v[4]);
    const fromAttempts = limit - attemptsTotal;
    return {
      etDay: day,
      attemptsTotal,
      attemptsToday: toNum(v[3]) ?? 0,
      headerRemaining,
      monthLimit,
      limit,
      effectiveRemaining: headerRemaining === null ? fromAttempts : Math.min(headerRemaining, fromAttempts),
      monthResetAt: toStr(v[6]),
      secondLimit: toNum(v[7]),
      profile,
      phase: phaseAt(now, this.o.caps, profile),
      exhaustedUntil: v[0] ? (toStr(v[0]) ?? 'set') : null,
      authFailUntil: v[1] ? (toStr(v[1]) ?? 'set') : null,
      cfgMode: toStr(v[8]),
      unsupported: Boolean(unsupportedUrn && v[9]),
    };
  }

  /** Counted before sending: a request that dies mid-flight has still been charged. */
  async recordAttempt(): Promise<void> {
    const day = etDay(this.o.now());
    await Promise.all([
      this.o.kv.incrby(this.key(LEDGER_KEYS.total), 1),
      this.o.kv.incrby(this.key(LEDGER_KEYS.day(day)), 1, DAY_KEY_TTL_MS),
    ]);
  }

  /** Min-merges the month counter (out-of-order responses never raise it) and stores limits. */
  async recordRate(rate: RateInfo): Promise<void> {
    const { kv } = this.o;
    const writes: Promise<unknown>[] = [];
    const m = rate.month;
    if (m && (m.remaining !== null || m.limit !== null)) {
      const [storedRemaining, storedLimit] = await kv.mget<unknown>([
        this.key(LEDGER_KEYS.monthRemaining),
        this.key(LEDGER_KEYS.monthLimit),
      ]);
      const ttl = ttlFromReset(m.resetSec, MONTH_TTL);
      const prev = toNum(storedRemaining);
      if (m.remaining !== null && (prev === null || m.remaining < prev)) {
        writes.push(kv.set(this.key(LEDGER_KEYS.monthRemaining), m.remaining, { px: ttl }));
        if (m.resetSec !== null && m.resetSec > 0) {
          const resetAt = new Date(this.o.now() + m.resetSec * 1000).toISOString();
          writes.push(kv.set(this.key(LEDGER_KEYS.monthResetAt), resetAt, { px: ttl }));
        }
      }
      if (m.limit !== null && toNum(storedLimit) !== m.limit) {
        writes.push(kv.set(this.key(LEDGER_KEYS.monthLimit), m.limit, { px: MONTH_TTL }));
      }
    }
    const sl = rate.second?.limit ?? null;
    if (sl !== null && sl !== this.lastSecondLimit) {
      this.lastSecondLimit = sl;
      writes.push(kv.set(this.key(LEDGER_KEYS.secondLimit), sl, { px: MONTH_TTL }));
    }
    await Promise.all(writes);
  }

  async tripExhausted(resetSec: number | null): Promise<void> {
    const ttl = ttlFromReset(resetSec, EXHAUSTED_FALLBACK_MS);
    await this.o.kv.set(this.key(LEDGER_KEYS.exhausted), new Date(this.o.now() + ttl).toISOString(), { px: ttl });
  }

  async tripAuth(): Promise<void> {
    const until = new Date(this.o.now() + AUTH_BREAKER_MS).toISOString();
    await this.o.kv.set(this.key(LEDGER_KEYS.authFail), until, { px: AUTH_BREAKER_MS });
  }

  async rememberUnsupported(urn: string): Promise<void> {
    const until = new Date(this.o.now() + UNSUPPORTED_TTL_MS).toISOString();
    await this.o.kv.set(this.key(LEDGER_KEYS.unsupported(urn)), until, { px: UNSUPPORTED_TTL_MS });
  }
}

// ---------------------------------------------------------------------------------------------
// Guard decision (pure; the client supplies the snapshot)
// ---------------------------------------------------------------------------------------------

export interface GuardInput {
  attemptsThisRun: number;
  maxFresh: number;
  /** Scripts with --force: skip the daily cap, use the absolute floor instead of the phase floor. */
  force: boolean;
  /** Daily caps and floors apply to the live quota only; the synthetic ledger is tracked, not enforced. */
  enforceQuota: boolean;
  absoluteFloor: number;
}

export interface GuardBlock {
  reason: GuardReason;
  message: string;
}

export function evaluateGuard(s: LedgerSnapshot, g: GuardInput): GuardBlock | null {
  if (s.cfgMode === 'off' || s.cfgMode === 'cache-only') {
    return { reason: 'mode', message: `Fresh Qloo calls are paused (runtime switch: ${s.cfgMode}).` };
  }
  if (s.exhaustedUntil) {
    return { reason: 'exhausted', message: `Qloo monthly quota is exhausted (breaker open until ${s.exhaustedUntil}).` };
  }
  if (s.authFailUntil) {
    return { reason: 'auth', message: `Qloo rejected the API key; fresh calls paused until ${s.authFailUntil}.` };
  }
  if (g.attemptsThisRun >= g.maxFresh) {
    return { reason: 'run_cap', message: `This run reached its cap of ${g.maxFresh} fresh Qloo calls.` };
  }
  if (!g.enforceQuota) return null;
  const phase = s.phase;
  if (!g.force && s.attemptsToday >= phase.dailyCap) {
    return phase.id === 'after'
      ? { reason: 'after_event', message: 'The event is over; Stoop serves cached results only.' }
      : { reason: 'daily_cap', message: `Today's Qloo budget (${phase.dailyCap} calls, phase ${phase.id}) is used up.` };
  }
  const floor = g.force ? g.absoluteFloor : (phase.floor ?? 0);
  if (s.effectiveRemaining <= floor) {
    return {
      reason: 'floor',
      message: `Qloo quota is at its reserve (${s.effectiveRemaining} left, floor ${floor} in phase ${phase.id}).`,
    };
  }
  return null;
}
