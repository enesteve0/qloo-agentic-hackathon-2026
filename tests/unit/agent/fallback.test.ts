import { describe, expect, it } from 'vitest';
import { nearestPreset } from '@/server/agent/fallback';
import type { Brief } from '@/shared/types';

const brief = (description: string, business = 'Test Co'): Brief => ({
  business,
  description,
  offer: null,
  budgetUsd: 1500,
  weeks: 2,
  startDate: null,
  address: null,
});

describe('nearestPreset', () => {
  it('matches a brief to the preset that shares the most words', () => {
    expect(nearestPreset(brief('Slow-smoked barbecue ribs and burnt ends for a weekend pop-up'))).toBe('smoke-and-sons');
    expect(nearestPreset(brief('A limited sneaker collab drop for our streetwear shop'))).toBe('drop-day');
    expect(nearestPreset(brief('Stand-up comedy club with weekend shows', 'Laugh Track'))).toBe('three-nights');
    expect(nearestPreset(brief('An exhibition of hand-drawn animation cels at our museum'))).toBe('hand-drawn');
  });

  it('falls back to the hero preset when nothing matches', () => {
    expect(nearestPreset(brief('Quantum accounting services'))).toBe('halfnote');
    expect(nearestPreset(null)).toBe('halfnote');
  });
});
