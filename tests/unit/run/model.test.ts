import { describe, expect, it } from 'vitest';
import { fmtCount, fmtWeeks, leftoverNote, tickerHeadline } from '@/components/run/model';
import type { MediaPlan, PlannedScreen, RunState } from '@/shared/types';

const screen = (cost: number, nta = 'BK0301'): PlannedScreen => ({ i: 7, siteId: 'bk-03-1', nta, fit: 90, weeklyImpressions: 3500, cost });
const hood = (nta: string) => ({ nta, screens: 4, spend: 480, tasteWeightedImpressions: 12_000 });

/** A three-neighborhood, three-week plan; next-best screens carry their cost for the whole flight. */
function plan(patch: Partial<MediaPlan>): Pick<MediaPlan, 'byNta' | 'leftoverUsd' | 'nextBest' | 'weeks'> {
  return { weeks: 3, byNta: [hood('BK0301'), hood('BK0302'), hood('BK0303')], leftoverUsd: 0, nextBest: [], ...patch };
}

describe('leftoverNote (PLAN, the money left unspent)', () => {
  it('says when the rest would not buy the next best screen, at that screen’s own price', () => {
    expect(leftoverNote(plan({ leftoverUsd: 80, nextBest: [screen(120)] }))).toBe(
      'Not enough for the next best screen ($120 for 3 weeks). Keep it or add a little.',
    );
    // Manhattan-only next best: $120 a week, so $80 for one week is not enough either.
    expect(leftoverNote(plan({ weeks: 1, leftoverUsd: 80, nextBest: [screen(120, 'MN0201'), screen(130, 'MN0202')] }))).toBe(
      'Not enough for the next best screen ($120 for 1 week). Keep it or add a little.',
    );
  });

  it('explains the per-neighborhood cap when the rest could pay for a next-best screen', () => {
    const note = leftoverNote(plan({ leftoverUsd: 160, nextBest: [screen(80), screen(80), screen(80)] }));
    expect(note).toMatch(/^Enough for another screen, but the best remaining ones are in neighborhoods that already have their share/);
    expect(note).not.toMatch(/listed here|Keep it or add a little/);
  });

  it('never promises a next-best list that is empty: every well-matched screen is already bought', () => {
    const note = leftoverNote(plan({ weeks: 4, leftoverUsd: 6160 }));
    expect(note).toBe(
      'Every well-matched screen in your top three neighborhoods is already in the plan. Stoop won’t spend the rest on poor-fit screens: keep it, or run more weeks.',
    );
    expect(leftoverNote(plan({ leftoverUsd: 500, byNta: [hood('BK0301')] }))).toMatch(/^Every well-matched screen in your top neighborhood is/);
    // Small leftovers get the same answer: adding money would buy nothing more.
    expect(leftoverNote(plan({ leftoverUsd: 20 }))).toMatch(/^Every well-matched screen/);
  });

  it('does not suggest more weeks than a brief allows', () => {
    expect(leftoverNote(plan({ weeks: 8, leftoverUsd: 500 }))).toMatch(/poor-fit screens: keep it\.$/);
  });
});

describe('tickerHeadline', () => {
  const done = (screens: number, hoods: string[]) =>
    ({
      status: 'done',
      stages: [],
      plan: { totals: { screens, spend: 80, impressions: 0, tasteWeightedImpressions: 0 }, byNta: hoods.map(hood), infeasibleReason: null },
    }) as unknown as RunState;

  it('counts screens and neighborhoods with the right plural', () => {
    expect(tickerHeadline(done(1, ['BK0301']), null).text).toBe('Plan ready · 1 screen · 1 neighborhood · $80');
    expect(tickerHeadline(done(5, ['BK0301', 'BK0302']), null).text).toBe('Plan ready · 5 screens · 2 neighborhoods · $80');
  });
});

describe('fmtWeeks and fmtCount', () => {
  it('pluralize', () => {
    expect(fmtWeeks(1)).toBe('1 week');
    expect(fmtWeeks(3)).toBe('3 weeks');
    expect(fmtCount(1, 'screen')).toBe('1 screen');
    expect(fmtCount(1200, 'screen')).toBe('1,200 screens');
  });
});
