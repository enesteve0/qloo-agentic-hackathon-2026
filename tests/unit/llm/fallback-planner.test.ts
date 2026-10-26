import { describe, expect, it } from 'vitest';
import {
  ANCHOR_LIBRARY,
  classifyBrief,
  DEFAULT_CATEGORY,
  fallbackPlanner,
  pickBusyNeighborhoods,
  TASTE_CATEGORIES,
} from '@/server/llm/fallback-planner';
import { normalizeName, plannerSchema, toPlannerModelOutput } from '@/server/llm/schemas';
import { ENTITY_TYPES, type Brief } from '@/shared/types';
import { HALFNOTE, NEIGHBORHOODS } from './helpers';

const brief = (description: string, extra: Partial<Brief> = {}): Brief => ({
  business: 'Test Co',
  description,
  offer: null,
  budgetUsd: 1000,
  weeks: 2,
  startDate: null,
  address: null,
  ...extra,
});

describe('curated anchor library', () => {
  it('has ~40 real entities across the required categories, 3 per category', () => {
    expect(ANCHOR_LIBRARY.length).toBeGreaterThanOrEqual(40);
    for (const id of ['jazz', 'comedy', 'bbq_soul', 'latin_music', 'animation', 'streetwear', 'coffee', 'wine_bar', 'books', 'fitness', 'art', 'family']) {
      const category = TASTE_CATEGORIES.find((c) => c.id === id);
      expect(category, id).toBeDefined();
      expect(category?.anchors).toHaveLength(3);
    }
  });

  it('every entry has a name, an EntityType, a search hint and a reason', () => {
    for (const anchor of ANCHOR_LIBRARY) {
      expect(anchor.name.trim()).toBe(anchor.name);
      expect(anchor.name.length).toBeGreaterThan(1);
      expect(ENTITY_TYPES).toContain(anchor.type);
      expect(anchor.searchHint?.length ?? 0).toBeGreaterThan(0);
      expect(anchor.why.length).toBeGreaterThan(10);
    }
  });

  it('never repeats an anchor inside a category', () => {
    for (const category of [...TASTE_CATEGORIES, DEFAULT_CATEGORY]) {
      expect(new Set(category.anchors.map((a) => normalizeName(a.name))).size).toBe(3);
    }
  });

  it('keywords and reasons stay away from identity and demographic terms', () => {
    const banned = /\b(latino|latina|latinx|hispanic|black|white|asian|african|gay|lesbian|queer|christian|jewish|muslim|millennials?|gen z|seniors?|young|old|teen(s|agers?)?|women|men|female|male)\b/i;
    for (const category of [...TASTE_CATEGORIES, DEFAULT_CATEGORY]) {
      for (const keyword of category.keywords) expect(keyword, category.id).not.toMatch(banned);
      expect(category.audienceSummary).not.toMatch(banned);
      for (const anchor of category.anchors) expect(anchor.why, anchor.name).not.toMatch(banned);
    }
  });
});

describe('classifyBrief', () => {
  it.each([
    [HALFNOTE.description, 'jazz'],
    ['Dee Marcus (fictional comic): a 3-night run at a 300-seat Manhattan club', 'comedy'],
    ['Smoke & Sons, a St. Louis-style BBQ pop-up in Gowanus, two weekends', 'bbq_soul'],
    ['1,800-cap Brooklyn show for an alt-Latin pop band; 10-day presale push', 'latin_music'],
    ['Queensboro Animation House (Astoria): "Hand-Drawn" exhibition, 6 weeks', 'animation'],
    ['7-day sneaker collab drop for a Lower East Side streetwear shop', 'streetwear'],
    ['Ramen counter in Astoria, $1,000, 2 weeks', 'japanese'],
    ['Third-wave café and bakery with cold brew', 'coffee'],
    ['Natural wine bar with small plates', 'wine_bar'],
    ['Indie bookstore hosting poetry readings', 'books'],
    ['Run club and yoga studio', 'fitness'],
    ['Contemporary art gallery opening', 'art'],
    ['Toy store with storytime for kids', 'family'],
    ['Neighborhood pizzeria', 'food'],
    ['A comic book store', 'animation'],
  ])('%s → %s', (description, id) => {
    expect(classifyBrief(brief(description)).id).toBe(id);
  });

  it('falls back to the broad default category', () => {
    expect(classifyBrief(brief('We fix bicycles.')).id).toBe(DEFAULT_CATEGORY.id);
  });

  it('matches whole words only', () => {
    // "party" must not match "art", "started" must not match "art" either.
    expect(classifyBrief(brief('We started a party planning service.')).id).toBe(DEFAULT_CATEGORY.id);
  });
});

describe('fallbackPlanner', () => {
  it('is deterministic', () => {
    const a = fallbackPlanner(HALFNOTE, { neighborhoods: NEIGHBORHOODS });
    const b = fallbackPlanner({ ...HALFNOTE }, { neighborhoods: [...NEIGHBORHOODS].reverse() });
    expect(b).toEqual(a);
  });

  it('produces a valid plan with fallback: true and 3 anchors', () => {
    const plan = fallbackPlanner(HALFNOTE, { neighborhoods: NEIGHBORHOODS });
    expect(plan.fallback).toBe(true);
    expect(plan.anchors).toHaveLength(3);
    expect(plan.anchors[0]?.name).toBe('Robert Glasper');
    expect(plan.business).toEqual({ name: 'Halfnote', category: 'jazz venue', offer: 'Half-price first round on Tuesdays' });
    expect(plan.budgetUsd).toBe(2000);
    expect(plan.weeks).toBe(3);
    expect(plannerSchema.safeParse(toPlannerModelOutput(plan)).success).toBe(true);
  });

  it('is schema-valid for every category', () => {
    for (const category of TASTE_CATEGORIES) {
      const plan = fallbackPlanner(brief(category.keywords[0] ?? ''), { neighborhoods: NEIGHBORHOODS });
      expect(plannerSchema.safeParse(toPlannerModelOutput(plan)).success, category.id).toBe(true);
    }
  });

  it('picks 5 busy neighborhoods: caller codes first, then famous names, eligible only', () => {
    const plan = fallbackPlanner(HALFNOTE, { neighborhoods: NEIGHBORHOODS, busyNtaCodes: ['mn0201', 'ZZ9999', 'MN0502'] });
    expect(plan.llmOnlyNeighborhoods.map((n) => n.ntaCode)).toEqual(['MN0201', 'MN0502', 'BK0102', 'MN0303', 'BK0601']);
    expect(new Set(plan.llmOnlyNeighborhoods.map((n) => n.ntaCode)).size).toBe(5);
  });

  it('derives famous areas from names when the caller gives no codes', () => {
    const picks = pickBusyNeighborhoods(NEIGHBORHOODS).map((n) => n.ntaCode);
    expect(picks).toEqual(['MN0502', 'MN0201', 'BK0102', 'MN0303', 'BK0601']);
  });

  it('uses caller codes as-is without an eligible list, and nothing without either', () => {
    expect(pickBusyNeighborhoods([], ['MN0502', 'MN0201']).map((n) => n.ntaCode)).toEqual(['MN0502', 'MN0201']);
    expect(pickBusyNeighborhoods([])).toEqual([]);
  });

  it('nulls missing budget and weeks', () => {
    const plan = fallbackPlanner(brief('coffee', { budgetUsd: 0, weeks: Number.NaN, business: '  ' }));
    expect(plan.budgetUsd).toBeNull();
    expect(plan.weeks).toBeNull();
    expect(plan.business.name).toBeNull();
  });
});
