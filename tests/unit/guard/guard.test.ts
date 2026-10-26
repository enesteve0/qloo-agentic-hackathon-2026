import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MemoryKV, setKvForTests } from '@/server/kv';
import { briefHash, parseBrief, sanitizeText } from '@/server/guard/brief';
import { admitLiveRun } from '@/server/guard/limits';
import { newSession, readSession } from '@/server/guard/session';
import { claimBrief, completeBrief } from '@/server/guard/singleflight';
import { isRunId, newRunId } from '@/server/store/runs';

let now = Date.parse('2026-10-28T15:00:00Z');
beforeEach(() => {
  now = Date.parse('2026-10-28T15:00:00Z');
  setKvForTests(new MemoryKV(() => now));
});
afterEach(() => setKvForTests(undefined));

describe('brief', () => {
  it('strips contact details and links', () => {
    expect(sanitizeText('Call 212-555-0199 or mail tasha@halfnote.nyc, see https://halfnote.nyc now')).toBe(
      'Call [phone removed] or mail [email removed], see [link removed] now',
    );
  });

  it('validates and normalizes a brief', () => {
    const r = parseBrief({
      business: '  Halfnote Supper Club ',
      description: 'A 48-seat jazz supper club opening on Nostrand Ave in Bed-Stuy.',
      offer: '',
      budgetUsd: '2000',
      weeks: 3,
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.brief).toMatchObject({ business: 'Halfnote Supper Club', offer: null, budgetUsd: 2000, weeks: 3, address: null });
    const bad = parseBrief({ business: 'X', description: 'short', budgetUsd: 5, weeks: 0 });
    expect(bad.ok).toBe(false);
  });

  it('hashes equivalent briefs identically', async () => {
    const a = parseBrief({ business: 'Halfnote', description: 'Jazz supper club in Bed-Stuy', budgetUsd: 2000, weeks: 3 });
    const b = parseBrief({ business: 'HALFNOTE ', description: 'jazz supper club in bed-stuy', budgetUsd: 2000, weeks: 3 });
    if (!a.ok || !b.ok) throw new Error('parse failed');
    expect(await briefHash(a.brief)).toBe(await briefHash(b.brief));
  });
});

describe('session', () => {
  it('round-trips a signed cookie and rejects tampering', () => {
    const s = newSession();
    const cookie = s.setCookie.split(';')[0]!;
    expect(readSession(`foo=1; ${cookie}`)).toBe(s.id);
    expect(readSession(cookie.replace(/.$/, (c) => (c === 'a' ? 'b' : 'a')))).toBeNull();
    expect(readSession(null)).toBeNull();
  });
});

describe('limits', () => {
  it('caps live runs per session in a 15-minute window, then frees up', async () => {
    for (let i = 0; i < 3; i++) expect((await admitLiveRun({ sessionId: 's1', ip: '1.1.1.1', now: new Date(now) })).ok).toBe(true);
    const blocked = await admitLiveRun({ sessionId: 's1', ip: '1.1.1.1', now: new Date(now) });
    expect(blocked).toMatchObject({ ok: false, reason: 'session' });
    expect(blocked.retryAfterS).toBeGreaterThan(0);
    now += 15 * 60_000;
    expect((await admitLiveRun({ sessionId: 's1', ip: '1.1.1.1', now: new Date(now) })).ok).toBe(true);
    expect((await admitLiveRun({ sessionId: 's2', ip: '1.1.1.1', now: new Date(now) })).ok).toBe(true);
  });
});

describe('single-flight', () => {
  it('shares one run per identical brief and remembers finished runs', async () => {
    expect(await claimBrief('h', 'run-a')).toEqual({ claimed: true });
    expect(await claimBrief('h', 'run-b')).toEqual({ claimed: false, existingRunId: 'run-a' });
    await completeBrief('h', 'run-a');
    expect(await claimBrief('h', 'run-c')).toEqual({ claimed: false, existingRunId: 'run-a' });
  });
});

describe('run ids', () => {
  it('are 12 lowercase url-safe characters', () => {
    const id = newRunId();
    expect(isRunId(id)).toBe(true);
    expect(isRunId('../etc/passwd')).toBe(false);
  });
});
