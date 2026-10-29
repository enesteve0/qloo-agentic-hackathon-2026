import { describe, expect, it } from 'vitest';
import { fmtWeeks, leftoverNote } from '@/components/run/model';
import type { MediaPlan, PlannedScreen } from '@/shared/types';

const screen: PlannedScreen = { i: 7, siteId: 'bk-03-1', nta: 'BK0301', fit: 90, weeklyImpressions: 3500, cost: 120 };
const hood = (nta: string) => ({ nta, screens: 4, spend: 480, tasteWeightedImpressions: 12_000 });

/** A three-neighborhood, three-week plan at the default assumption prices ($120 Manhattan, $40 elsewhere). */
function plan(patch: Partial<MediaPlan>): Pick<MediaPlan, 'assumptions' | 'byNta' | 'leftoverUsd' | 'nextBest' | 'weeks'> {
  return {
    weeks: 3,
    assumptions: {
      label: 'assumption',
      pricePerKioskWeek: { manhattan: 120, outer: 40 },
      impressionsPerKioskWeek: { manhattan: 10_000, outer: 3_500 },
    },
    byNta: [hood('BK0301'), hood('BK0302'), hood('BK0303')],
    leftoverUsd: 0,
    nextBest: [],
    ...patch,
  };
}

describe('leftoverNote (PLAN, the money left unspent)', () => {
  it('says when the rest would not buy one more screen for the flight', () => {
    expect(leftoverNote(plan({ leftoverUsd: 80, nextBest: [screen] }))).toBe(
      'Less than one more screen for 3 weeks ($120). Keep it or add a little.',
    );
    expect(leftoverNote(plan({ weeks: 1, leftoverUsd: 20 }))).toBe('Less than one more screen for 1 week ($40). Keep it or add a little.');
  });

  it('points to the next-best screens when there is room for more', () => {
    expect(leftoverNote(plan({ leftoverUsd: 600, nextBest: [screen] }))).toBe('Room for more screens: the next best are listed here.');
  });

  it('never promises a next-best list that is empty: every well-matched screen is already bought', () => {
    const note = leftoverNote(plan({ weeks: 4, leftoverUsd: 6160 }));
    expect(note).toBe(
      'Every well-matched screen in your top three neighborhoods is already in the plan. Stoop won’t spend the rest on poor-fit screens: keep it, or run more weeks.',
    );
    expect(note).not.toMatch(/listed here/);
    expect(leftoverNote(plan({ leftoverUsd: 500, byNta: [hood('BK0301')] }))).toMatch(/^Every well-matched screen in your top neighborhood is/);
  });
});

describe('fmtWeeks', () => {
  it('pluralizes', () => {
    expect(fmtWeeks(1)).toBe('1 week');
    expect(fmtWeeks(3)).toBe('3 weeks');
  });
});
