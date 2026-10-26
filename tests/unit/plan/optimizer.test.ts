import { describe, expect, it } from 'vitest';
import { DEFAULT_ASSUMPTIONS, impressionsPerWeek, isManhattan, pricePerWeek, resolveAssumptions } from '@/server/plan/assumptions';
import { buildMediaPlan, DEFAULT_MIN_FIT, type MediaPlanInput } from '@/server/plan/optimizer';
import type { Kiosk } from '@/shared/types';

interface Spec {
  nta: string;
  fit: number;
  siteId?: string;
}

const boroOf = (nta: string) => (nta.startsWith('MN') ? 'Manhattan' : nta.startsWith('QN') ? 'Queens' : 'Brooklyn');

/** Synthetic kiosks (index = position) and their fit array. */
function scene(specs: readonly Spec[]): { kiosks: Kiosk[]; kioskFit: number[] } {
  const kiosks = specs.map((s, i) => ({
    i,
    siteId: s.siteId ?? `${s.nta.toLowerCase()}-${String(i).padStart(3, '0')}`,
    lat: 40.6 + i * 0.001,
    lon: -73.9,
    type: 'LINK1.0' as const,
    boro: boroOf(s.nta),
    address: `${i + 1} TEST AVENUE`,
    cross1: null,
    cross2: null,
    nta: s.nta,
    gh6: 'dr5rs0',
    ntaReassigned: false,
  }));
  return { kiosks, kioskFit: specs.map((s) => s.fit) };
}

function plan(specs: readonly Spec[], over: Partial<MediaPlanInput> = {}) {
  const { kiosks, kioskFit } = scene(specs);
  return buildMediaPlan({ kiosks, kioskFit, topNtas: ['BK1', 'BK2', 'MN1'], budgetUsd: 1_000, weeks: 1, assumptions: DEFAULT_ASSUMPTIONS, ...over });
}

/** Deterministic PRNG for the property test. */
function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

describe('assumptions', () => {
  it('are labelled, frozen illustrative defaults', () => {
    expect(DEFAULT_ASSUMPTIONS).toEqual({
      label: 'assumption',
      pricePerKioskWeek: { manhattan: 120, outer: 40 },
      impressionsPerKioskWeek: { manhattan: 10_000, outer: 3_500 },
    });
    expect(Object.isFrozen(DEFAULT_ASSUMPTIONS) && Object.isFrozen(DEFAULT_ASSUMPTIONS.pricePerKioskWeek)).toBe(true);
  });

  it('accept sane owner edits and fall back to defaults otherwise', () => {
    const a = resolveAssumptions({
      pricePerKioskWeek: { manhattan: 99.999, outer: -5 },
      impressionsPerKioskWeek: { manhattan: 12_345.6, outer: Number.NaN },
    });
    expect(a).toEqual({
      label: 'assumption',
      pricePerKioskWeek: { manhattan: 100, outer: 40 },
      impressionsPerKioskWeek: { manhattan: 12_346, outer: 3_500 },
    });
    expect(resolveAssumptions(null)).toEqual(DEFAULT_ASSUMPTIONS);
    expect(resolveAssumptions({ pricePerKioskWeek: { outer: 1e9 } }).pricePerKioskWeek.outer).toBe(40);
  });

  it('price Manhattan screens on the Manhattan tier only', () => {
    expect(isManhattan('Manhattan') && isManhattan(' manhattan ') && isManhattan('MN')).toBe(true);
    expect(isManhattan('Brooklyn') || isManhattan('Staten Island')).toBe(false);
    expect(pricePerWeek('Manhattan', DEFAULT_ASSUMPTIONS)).toBe(120);
    expect(pricePerWeek('Bronx', DEFAULT_ASSUMPTIONS)).toBe(40);
    expect(impressionsPerWeek('Manhattan', DEFAULT_ASSUMPTIONS)).toBe(10_000);
    expect(impressionsPerWeek('Queens', DEFAULT_ASSUMPTIONS)).toBe(3_500);
  });
});

describe('buildMediaPlan', () => {
  it('only considers scored screens with fit ≥ 50 in the top neighborhoods', () => {
    const p = plan(
      [
        { nta: 'BK1', fit: 90 },
        { nta: 'BK1', fit: 49.9 },
        { nta: 'BK1', fit: -1 },
        { nta: 'BK2', fit: 60 },
        { nta: 'QN9', fit: 100 },
      ],
      { budgetUsd: 10_000 },
    );
    expect(DEFAULT_MIN_FIT).toBe(50);
    expect(p.screens.map((s) => s.i)).toEqual([0, 3]);
    expect(p.infeasibleReason).toBeNull();
  });

  it('reports cost, impressions and taste-weighted impressions for the whole flight', () => {
    const p = plan([{ nta: 'BK1', fit: 80 }], { weeks: 3, budgetUsd: 500 });
    expect(p.screens).toEqual([{ i: 0, siteId: 'bk1-000', nta: 'BK1', fit: 80, weeklyImpressions: 3_500, cost: 120 }]);
    expect(p.totals).toEqual({ spend: 120, impressions: 10_500, tasteWeightedImpressions: 8_400, screens: 1 });
    expect(p.byNta).toEqual([
      { nta: 'BK1', screens: 1, spend: 120, tasteWeightedImpressions: 8_400 },
      { nta: 'BK2', screens: 0, spend: 0, tasteWeightedImpressions: 0 },
      { nta: 'MN1', screens: 0, spend: 0, tasteWeightedImpressions: 0 },
    ]);
    expect(p.leftoverUsd).toBe(380);
    expect(p.assumptions).toEqual(DEFAULT_ASSUMPTIONS);
    expect(p.assumptions).not.toBe(DEFAULT_ASSUMPTIONS);
  });

  it('buys the best value per dollar and caps each neighborhood at half the target count', () => {
    // Five $40 candidates, $200: N_target = 5, cap = ceil(2.5) = 3 per neighborhood.
    const p = plan(
      [
        { nta: 'BK1', fit: 99 },
        { nta: 'BK1', fit: 98 },
        { nta: 'BK1', fit: 97 },
        { nta: 'BK1', fit: 96 },
        { nta: 'BK2', fit: 60 },
      ],
      { budgetUsd: 200 },
    );
    expect(p.screens.map((s) => s.fit)).toEqual([99, 98, 97, 60]);
    expect(p.totals.spend).toBe(160);
    expect(p.nextBest.map((s) => s.fit)).toEqual([96]);
  });

  it('repairs the plan so every top neighborhood gets a screen when affordable', () => {
    // $200 for one week. Greedy alone (cap 2) buys BK1 ×2 and BK2 ×2 and has $40 left: not enough
    // for MN1's $120 screen. Repair drops the two lowest-ranked screens of BK2 and BK1, then adds MN1.
    const specs: Spec[] = [
      { nta: 'BK1', fit: 95 },
      { nta: 'BK1', fit: 94 },
      { nta: 'BK1', fit: 93 },
      { nta: 'BK1', fit: 92 },
      { nta: 'BK2', fit: 90 },
      { nta: 'BK2', fit: 89 },
      { nta: 'BK2', fit: 88 },
      { nta: 'BK2', fit: 87 },
      { nta: 'MN1', fit: 60 },
    ];
    const p = plan(specs, { budgetUsd: 200 });
    expect(p.screens.map((s) => [s.nta, s.fit])).toEqual([
      ['BK1', 95],
      ['BK2', 90],
      ['MN1', 60],
    ]);
    expect(p.totals.spend).toBe(200);
    expect(p.leftoverUsd).toBe(0);
  });

  it('skips the repair when a neighborhood cannot be afforded without emptying another', () => {
    const p = plan(
      [
        { nta: 'BK1', fit: 95 },
        { nta: 'BK2', fit: 90 },
        { nta: 'MN1', fit: 99 },
      ],
      { budgetUsd: 100 },
    );
    expect(p.screens.map((s) => s.nta)).toEqual(['BK1', 'BK2']);
    expect(p.leftoverUsd).toBe(20);
    expect(p.nextBest.map((s) => s.nta)).toEqual(['MN1']);
  });

  it('breaks value ties by fit, then siteId', () => {
    // Outer fit 80: 2,800 impressions for $40; Manhattan fit 84: 8,400 for $120. Same value per dollar.
    const tied = plan(
      [
        { nta: 'BK1', fit: 80, siteId: 'a-outer' },
        { nta: 'MN1', fit: 84, siteId: 'z-manhattan' },
        { nta: 'BK2', fit: 70, siteId: 'b-2' },
        { nta: 'BK2', fit: 70, siteId: 'b-1' },
      ],
      { budgetUsd: 0 },
    );
    expect(tied.nextBest.map((s) => s.siteId)).toEqual(['z-manhattan', 'a-outer', 'b-1']);
    // With $120 only one of the tied pair fits: the higher fit wins.
    const one = plan(
      [
        { nta: 'BK1', fit: 80, siteId: 'a-outer' },
        { nta: 'MN1', fit: 84, siteId: 'z-manhattan' },
      ],
      { budgetUsd: 120 },
    );
    expect(one.screens.map((s) => s.siteId)).toEqual(['z-manhattan']);
  });

  it('is deterministic and independent of kiosk order', () => {
    const specs: Spec[] = Array.from({ length: 30 }, (_, k) => ({ nta: ['BK1', 'BK2', 'MN1'][k % 3] ?? 'BK1', fit: 50 + ((k * 37) % 50) }));
    const { kiosks, kioskFit } = scene(specs);
    const input = { kiosks, kioskFit, topNtas: ['BK1', 'BK2', 'MN1'], budgetUsd: 900, weeks: 2, assumptions: DEFAULT_ASSUMPTIONS };
    const first = buildMediaPlan(input);
    expect(buildMediaPlan(input)).toEqual(first);
    expect(buildMediaPlan({ ...input, kiosks: [...kiosks].reverse() })).toEqual(first);
  });

  it('explains a budget that cannot buy one screen', () => {
    const one = plan([{ nta: 'BK1', fit: 90 }], { budgetUsd: 30 });
    expect(one.infeasibleReason).toBe('Minimum $40 for one screen-week');
    expect(one).toMatchObject({ screens: [], leftoverUsd: 30, totals: { spend: 0, impressions: 0, tasteWeightedImpressions: 0, screens: 0 } });
    expect(one.nextBest.map((s) => s.i)).toEqual([0]);
    const multi = plan([{ nta: 'BK1', fit: 90 }], { budgetUsd: 100, weeks: 3 });
    expect(multi.infeasibleReason).toBe('Minimum $40 for one screen-week ($120 for 3 weeks)');
    expect(multi.screens).toEqual([]);
  });

  it('explains plans with no qualifying screens or no weeks', () => {
    expect(plan([{ nta: 'BK1', fit: 10 }]).infeasibleReason).toBe('No screens with a taste fit of 50 or more in the selected neighborhoods.');
    expect(plan([{ nta: 'BK1', fit: -1 }], { minFit: 0 }).infeasibleReason).toBe('No scored screens in the selected neighborhoods.');
    expect(plan([{ nta: 'BK1', fit: 90 }], { weeks: 0 }).infeasibleReason).toBe('Set a campaign length of more than zero weeks.');
  });

  it('counts money in cents with fractional prices and weeks', () => {
    const assumptions = resolveAssumptions({ pricePerKioskWeek: { outer: 10.29 } });
    const specs: Spec[] = Array.from({ length: 12 }, (_, k) => ({ nta: k % 2 ? 'BK1' : 'BK2', fit: 99 - k }));
    const p = plan(specs, { assumptions, weeks: 1.5, budgetUsd: 77.2 });
    // $10.29 × 1.5 = 1,543.5 cents → $15.44 per screen for the flight; five of them are exactly $77.20.
    expect(p.screens).toHaveLength(5);
    expect(p.screens.every((s) => s.cost === 15.44)).toBe(true);
    expect(p.totals.spend).toBe(77.2);
    expect(p.leftoverUsd).toBe(0);
  });

  it('never exceeds the budget, respects caps and repairs whenever it can (300 random scenarios)', () => {
    const tops = ['BK1', 'BK2', 'MN1'];
    for (let seed = 1; seed <= 300; seed++) {
      const rnd = mulberry32(seed);
      const specs: Spec[] = Array.from({ length: 4 + Math.floor(rnd() * 40) }, () => ({
        nta: ['BK1', 'BK2', 'MN1', 'QN9'][Math.floor(rnd() * 4)] ?? 'BK1',
        fit: rnd() < 0.1 ? -1 : Math.round(rnd() * 1_000) / 10,
      }));
      const budgetUsd = Math.round(rnd() * 3_000);
      const weeks = 1 + Math.floor(rnd() * 6);
      const { kiosks, kioskFit } = scene(specs);
      const input = { kiosks, kioskFit, topNtas: tops, budgetUsd, weeks, assumptions: DEFAULT_ASSUMPTIONS };
      const p = buildMediaPlan(input);
      const ctx = `seed ${seed}`;

      const cents = (usd: number) => Math.round(usd * 100);
      const spent = p.screens.reduce((s, x) => s + cents(x.cost), 0);
      expect(spent, ctx).toBeLessThanOrEqual(cents(budgetUsd));
      expect(cents(p.totals.spend), ctx).toBe(spent);
      expect(cents(p.leftoverUsd), ctx).toBe(cents(budgetUsd) - spent);
      expect(new Set(p.screens.map((s) => s.i)).size, ctx).toBe(p.screens.length);

      const candidates = kiosks.filter((k) => tops.includes(k.nta) && (kioskFit[k.i] ?? -1) >= 50);
      for (const s of p.screens) expect(candidates.some((k) => k.i === s.i), ctx).toBe(true);
      if (candidates.length === 0) continue;

      const cost = (k: Kiosk) => cents((k.boro === 'Manhattan' ? 120 : 40) * weeks);
      const mean = candidates.reduce((s, k) => s + cost(k), 0) / candidates.length;
      const cap = Math.max(1, Math.ceil(0.5 * Math.floor(cents(budgetUsd) / mean)));
      for (const b of p.byNta) expect(b.screens, ctx).toBeLessThanOrEqual(cap);

      // Every top neighborhood with candidates gets a screen when the budget covers one in each.
      const withCandidates = tops.filter((t) => candidates.some((k) => k.nta === t));
      const oneEach = withCandidates.reduce((s, t) => s + cost(candidates.find((k) => k.nta === t) as Kiosk), 0);
      if (oneEach <= cents(budgetUsd)) {
        for (const t of withCandidates) expect(p.byNta.find((b) => b.nta === t)?.screens, `${ctx} ${t}`).toBeGreaterThan(0);
      }
      expect(buildMediaPlan({ ...input, kiosks: [...kiosks].reverse() }), ctx).toEqual(p);
    }
  });
});
