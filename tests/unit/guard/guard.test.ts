import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PRESETS } from '@/content/presets';
import { MemoryKV, setKvForTests } from '@/server/kv';
import { briefHash, parseBrief, restrictedCategory, sanitizeText } from '@/server/guard/brief';
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

describe('restricted categories', () => {
  const b = (description: string, offer: string | null = null) => ({ business: 'Test Co', description, offer });

  it('refuses briefs Stoop will not plan, with a reason', () => {
    expect(restrictedCategory(b('Vote for Dana Lee in the city council election'))?.category).toBe('political');
    expect(restrictedCategory(b('Two-bedroom apartments for rent in a new building'))?.category).toBe('housing');
    expect(restrictedCategory(b('We are a cafe and we’re hiring baristas'))?.category).toBe('employment');
    expect(restrictedCategory(b('Fast payday loans with no credit check'))?.category).toBe('credit');
    expect(restrictedCategory(b('Our tea is a natural cure for anxiety'))?.category).toBe('health');
    expect(restrictedCategory(b('A new vape lounge'))?.category).toBe('tobacco');
    expect(restrictedCategory(b('Sports betting app launch'))?.category).toBe('gambling');
    expect(restrictedCategory(b('Real estate open house this weekend'))?.message).toMatch(/fair-housing/);
    expect(restrictedCategory(b('Vote YES on Proposition 2'))?.category).toBe('political');
    expect(restrictedCategory(b('Rally to re-elect the mayor'))?.category).toBe('political');
  });

  it('lets ordinary small-business briefs through', () => {
    for (const ok of [
      b('A 48-seat jazz supper club with Tuesday jam nights and a soul-food menu', 'Free first set on Tuesdays'),
      b('Neighborhood bakery with sweet treats and a happy hour on day-old bread'),
      b('A St. Louis-style barbecue pop-up for two weekends: ribs, burnt ends and sides'),
      b('A fictional promoter selling an 1,800-capacity Brooklyn show; 10-day presale'),
      b('A six-week exhibition of hand-drawn animation', 'Members get in free'),
      b('A 7-day sneaker collab drop for a streetwear shop'),
      b('Comedy club with a cocktail bar and late shows'),
      b('A political satire comedy night for fans of The Cure and Guns N’ Roses'),
      b('Limited time slots for our book-lending library; paintings on loan from a private collection'),
      b('Sneaker raffle and lottery entries open all week', 'Members vote on the next colorway'),
      b('Vote for your favorite cupcake flavor every Friday'),
      b('A wine bar where bartenders cure their own olives'),
      ...PRESETS.map((p) => p.brief),
    ]) {
      expect(restrictedCategory(ok)).toBeNull();
    }
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
    // Another session is unaffected; refused attempts don't count, so the window frees up on time.
    expect((await admitLiveRun({ sessionId: 's2', ip: '1.1.1.1', now: new Date(now) })).ok).toBe(true);
    now += 30 * 60_000;
    expect((await admitLiveRun({ sessionId: 's1', ip: '1.1.1.1', now: new Date(now) })).ok).toBe(true);
  });

  it('does not reset at a bucket boundary (sliding window)', async () => {
    const window = 15 * 60_000;
    const boundary = Math.ceil(now / window) * window + window;
    for (let i = 0; i < 3; i++) {
      expect((await admitLiveRun({ sessionId: 's3', ip: null, now: new Date(boundary - 1_000) })).ok).toBe(true);
    }
    // Two seconds later the fixed bucket has rolled over, but the three runs still count.
    expect((await admitLiveRun({ sessionId: 's3', ip: null, now: new Date(boundary + 1_000) })).ok).toBe(false);
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
