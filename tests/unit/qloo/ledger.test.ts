import { describe, expect, it } from 'vitest';
import { MemoryKV } from '@/server/kv';
import {
  QuotaLedger,
  defaultCaps,
  etDay,
  evaluateGuard,
  parseCaps,
  parseRateHeaders,
  phaseAt,
  profileFromLimit,
  type GuardInput,
  type LedgerSnapshot,
} from '@/server/qloo/ledger';

const at = (iso: string) => Date.parse(iso);

function ledger(start: string, caps = defaultCaps()) {
  const clock = { t: at(start) };
  const kv = new MemoryKV(() => clock.t);
  return { clock, kv, ledger: new QuotaLedger({ kv, prefix: '', now: () => clock.t, caps }) };
}

const rate = (remaining: number | null, limit: number | null = 10_000, resetSec: number | null = 86_400) => ({
  second: null,
  month: { limit, remaining, resetSec },
  requestId: null,
});

describe('Eastern-time day keys', () => {
  it('follow America/New_York across the Nov 1 2026 DST change', () => {
    expect(etDay(at('2026-10-31T03:59:59Z'))).toBe('2026-10-30'); // 23:59:59 EDT
    expect(etDay(at('2026-11-01T03:59:59Z'))).toBe('2026-10-31');
    expect(etDay(at('2026-11-01T04:00:00Z'))).toBe('2026-11-01'); // midnight EDT
    expect(etDay(at('2026-11-01T05:30:00Z'))).toBe('2026-11-01'); // 01:30 EDT
    expect(etDay(at('2026-11-01T06:30:00Z'))).toBe('2026-11-01'); // 01:30 EST (repeated hour)
    expect(etDay(at('2026-11-02T04:30:00Z'))).toBe('2026-11-01'); // 23:30 EST — a fixed −4 h offset says Nov 2
    expect(etDay(at('2026-11-02T05:00:00Z'))).toBe('2026-11-02'); // midnight EST
  });

  it('count every attempt in the total and the right ET day', async () => {
    const { clock, kv, ledger: l } = ledger('2026-11-02T04:30:00Z');
    await l.recordAttempt();
    clock.t = at('2026-11-02T05:00:00Z');
    await l.recordAttempt();
    await l.recordAttempt();
    expect(await kv.get('qloo:attempts:total')).toBe(3);
    expect(await kv.get('qloo:attempts:2026-11-01')).toBe(1);
    expect(await kv.get('qloo:attempts:2026-11-02')).toBe(2);
    expect(await kv.pttl('qloo:attempts:2026-11-02')).toBe(14 * 24 * 3_600_000);
    const snap = await l.read();
    expect(snap).toMatchObject({ etDay: '2026-11-02', attemptsTotal: 3, attemptsToday: 2 });
  });
});

describe('rate-limit headers', () => {
  it('parses both windows and the request id', () => {
    const h = new Headers({
      'x-second-ratelimit-limit': '5',
      'x-second-ratelimit-remaining': '4',
      'x-second-ratelimit-reset': '1',
      'x-month-ratelimit-limit': '10000',
      'x-month-ratelimit-remaining': '9876',
      'x-month-ratelimit-reset': '2591000',
      'x-request-id': 'req-1',
    });
    expect(parseRateHeaders(h)).toEqual({
      second: { limit: 5, remaining: 4, resetSec: 1 },
      month: { limit: 10_000, remaining: 9_876, resetSec: 2_591_000 },
      requestId: 'req-1',
    });
    expect(parseRateHeaders(new Headers({ 'x-qloo-request-id': 'q', 'request-id': 'r' })).requestId).toBe('q');
    expect(parseRateHeaders(new Headers({ 'request-id': 'r' })).requestId).toBe('r');
    expect(parseRateHeaders(new Headers({ 'x-month-ratelimit-remaining': 'n/a' }))).toEqual({ second: null, month: null, requestId: null });
  });
});

describe('month counter', () => {
  it('min-merges out-of-order responses and expires with the window', async () => {
    const { kv, ledger: l } = ledger('2026-10-27T15:00:00Z');
    await l.recordRate(rate(9_990));
    await l.recordRate(rate(9_995)); // an older response arriving late never raises the counter
    expect(await kv.get('qloo:month:remaining')).toBe(9_990);
    await l.recordRate(rate(9_980, 10_000, 3_600));
    expect(await kv.get('qloo:month:remaining')).toBe(9_980);
    expect(await kv.pttl('qloo:month:remaining')).toBe(3_600_000);
    expect(await kv.get('qloo:month:reset_at')).toBe('2026-10-27T16:00:00.000Z');
    expect(await kv.get('qloo:month:limit')).toBe(10_000);
  });

  it('effective remaining = min(header, limit − attempts)', async () => {
    const { kv, ledger: l } = ledger('2026-10-27T15:00:00Z');
    expect((await l.read()).effectiveRemaining).toBe(10_000);
    await kv.set('qloo:attempts:total', 50);
    expect((await l.read()).effectiveRemaining).toBe(9_950);
    await l.recordRate(rate(9_990));
    expect((await l.read()).effectiveRemaining).toBe(9_950);
    await l.recordRate(rate(9_900));
    expect((await l.read()).effectiveRemaining).toBe(9_900);
  });

  it('detects the 50k profile from the month limit and scales caps and floors ×5', async () => {
    const { ledger: l } = ledger('2026-10-27T15:00:00Z');
    expect(profileFromLimit(10_000)).toBe('10k');
    expect(profileFromLimit(50_000)).toBe('50k');
    expect(profileFromLimit(null)).toBe('10k');
    await l.recordRate(rate(49_000, 50_000));
    const snap = await l.read();
    expect(snap).toMatchObject({ profile: '50k', limit: 50_000, effectiveRemaining: 49_000 });
    expect(snap.phase).toMatchObject({ id: 'build', dailyCap: 2_000, liveRunsPerDay: 125, floor: 32_500, scale: 5 });
  });
});

describe('phases and guard', () => {
  const caps = defaultCaps();
  it('switch phases at the documented ET boundaries', () => {
    expect(phaseAt(at('2026-10-31T03:44:59Z'), caps, '10k')).toMatchObject({ id: 'build', dailyCap: 400, floor: 6_500 });
    expect(phaseAt(at('2026-10-31T03:45:00Z'), caps, '10k')).toMatchObject({ id: 'pre_judging', dailyCap: 300, floor: 6_500 });
    expect(phaseAt(at('2026-11-02T17:00:00Z'), caps, '10k')).toMatchObject({ id: 'judging', dailyCap: 1_500, floor: 600 });
    expect(phaseAt(at('2026-11-05T05:00:00Z'), caps, '10k')).toMatchObject({ id: 'finale', dailyCap: 1_500, floor: 150 });
    expect(phaseAt(at('2026-11-06T04:45:00Z'), caps, '10k')).toMatchObject({ id: 'after', dailyCap: 0, floor: null });
  });

  const snap = (over: Partial<LedgerSnapshot>, now = '2026-10-27T15:00:00Z'): LedgerSnapshot => ({
    etDay: '2026-10-27',
    attemptsTotal: 0,
    attemptsToday: 0,
    headerRemaining: null,
    monthLimit: null,
    limit: 10_000,
    effectiveRemaining: 10_000,
    monthResetAt: null,
    secondLimit: null,
    profile: '10k',
    phase: phaseAt(at(now), caps, '10k'),
    exhaustedUntil: null,
    authFailUntil: null,
    cfgMode: null,
    unsupported: false,
    ...over,
  });
  const g = (over: Partial<GuardInput> = {}): GuardInput => ({ attemptsThisRun: 0, maxFresh: 20, force: false, enforceQuota: true, absoluteFloor: 300, ...over });

  it('apply each phase floor to public calls', () => {
    expect(evaluateGuard(snap({ effectiveRemaining: 6_501 }), g())).toBeNull();
    expect(evaluateGuard(snap({ effectiveRemaining: 6_500 }), g())?.reason).toBe('floor');
    expect(evaluateGuard(snap({ effectiveRemaining: 601 }, '2026-11-03T15:00:00Z'), g())).toBeNull();
    expect(evaluateGuard(snap({ effectiveRemaining: 600 }, '2026-11-03T15:00:00Z'), g())?.reason).toBe('floor');
    expect(evaluateGuard(snap({ effectiveRemaining: 151 }, '2026-11-05T15:00:00Z'), g())).toBeNull();
    expect(evaluateGuard(snap({ effectiveRemaining: 150 }, '2026-11-05T15:00:00Z'), g())?.reason).toBe('floor');
  });

  it('let forced scripts pass the phase floor and daily cap, never the absolute floor', () => {
    expect(evaluateGuard(snap({ effectiveRemaining: 6_000, attemptsToday: 500 }), g({ force: true }))).toBeNull();
    expect(evaluateGuard(snap({ effectiveRemaining: 300 }), g({ force: true }))?.reason).toBe('floor');
    expect(evaluateGuard(snap({ attemptsToday: 400 }), g())?.reason).toBe('daily_cap');
    expect(evaluateGuard(snap({}, '2026-11-07T00:00:00Z'), g())?.reason).toBe('after_event');
  });

  it('checks the mode switch, breakers and run cap first; the synthetic ledger is tracked only', () => {
    expect(evaluateGuard(snap({ cfgMode: 'off' }), g())?.reason).toBe('mode');
    expect(evaluateGuard(snap({ exhaustedUntil: 'x' }), g({ force: true }))?.reason).toBe('exhausted');
    expect(evaluateGuard(snap({ authFailUntil: 'x' }), g())?.reason).toBe('auth');
    expect(evaluateGuard(snap({}), g({ attemptsThisRun: 20 }))?.reason).toBe('run_cap');
    expect(evaluateGuard(snap({ effectiveRemaining: 10, attemptsToday: 10_000 }), g({ enforceQuota: false }))).toBeNull();
  });

  it('trips the breakers with the right lifetimes', async () => {
    const { kv, ledger: l } = ledger('2026-10-27T15:00:00Z');
    await l.tripExhausted(7_200);
    await l.tripAuth();
    await l.rememberUnsupported('urn:entity:podcast');
    expect(await kv.pttl('qloo:exhausted')).toBe(7_200_000);
    expect(await kv.pttl('qloo:auth_fail')).toBe(600_000);
    expect(await kv.pttl('qloo:unsupported:urn:entity:podcast')).toBe(86_400_000);
    const s = await l.read('urn:entity:podcast');
    expect(s.exhaustedUntil).toBe('2026-10-27T17:00:00.000Z');
    expect(s.unsupported).toBe(true);
    await l.tripExhausted(null);
    expect(await kv.pttl('qloo:exhausted')).toBe(3_600_000);
  });
});

describe('QLOO_CAPS_JSON', () => {
  it('overrides individual fields and keeps the rest', () => {
    const caps = parseCaps('{"profile":"50k","absoluteFloor":500,"phases":{"build":{"dailyCap":200,"floor":7000}}}');
    expect(caps.profile).toBe('50k');
    expect(caps.absoluteFloor).toBe(500);
    expect(caps.phases[0]).toMatchObject({ id: 'build', dailyCap: 200, floor: 7_000, liveRunsPerDay: 25 });
    expect(caps.phases[2]).toMatchObject({ id: 'judging', dailyCap: 1_500 });
  });

  it('takes the judging window from the event dates', () => {
    const caps = parseCaps(undefined, { judgingStart: '2026-11-02T18:00:00Z', judgingEnd: '2026-11-06T06:00:00Z' });
    expect(caps.phases.find((p) => p.id === 'pre_judging')?.until).toBe('2026-11-02T18:00:00Z');
    expect(caps.phases.find((p) => p.id === 'finale')?.until).toBe('2026-11-06T06:00:00Z');
  });

  it('fails loudly on invalid JSON or unknown fields', () => {
    expect(() => parseCaps('{nope')).toThrow(/not valid JSON/);
    expect(() => parseCaps('{"phases":{"buidl":{"dailyCap":1}}}')).toThrow(/QLOO_CAPS_JSON is invalid/);
    expect(() => parseCaps('{"phases":{"build":{"dailyCap":-1}}}')).toThrow(/invalid/);
  });
});
