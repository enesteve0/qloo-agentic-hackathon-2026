import { describe, expect, it } from 'vitest';
import { DEFAULT_ASSUMPTIONS } from '@/server/plan/assumptions';
import { buildMediaPlan } from '@/server/plan/optimizer';
import { belowBaselineShare, computeProof, LLM_MIN_FIT, PROOF_NOTE, type ProofInput } from '@/server/proof/baseline';
import type { Kiosk, MediaPlan, NtaScore, WhereResult } from '@/shared/types';

// Eight Brooklyn neighborhoods ranked by lift; the last three are below the NYC baseline (lift < 0).
const CODES = ['BK0001', 'BK0002', 'BK0003', 'BK0004', 'BK0005', 'BK0006', 'BK0007', 'BK0008'];
const LIFTS = [2.0, 1.5, 1.0, 0.6, 0.3, -0.2, -0.5, -1.0];
const FIT_INDEX = [100, 86, 71, 57, 43, 29, 14, 0];

const SCORES: NtaScore[] = CODES.map((code, j) => ({
  code,
  name: `Area ${j + 1}`,
  short: `Area ${j + 1}`,
  boro: 'Brooklyn',
  lift: LIFTS[j] ?? 0,
  se: 0.1,
  nEff: 5,
  agreement: 1,
  confidence: 'high',
  fitIndex: FIT_INDEX[j] ?? 0,
  multiplier: 1,
  topAnchors: [],
  adKiosks: 3,
}));

// Three kiosks per neighborhood; better neighborhoods have better-fitting kiosks.
const KIOSKS: Kiosk[] = CODES.flatMap((code, j) =>
  [0, 1, 2].map((k) => ({
    i: j * 3 + k,
    siteId: `${code.toLowerCase()}-${k}`,
    lat: 40.65 + j * 0.01,
    lon: -73.95 + k * 0.002,
    type: 'LINK1.0' as const,
    boro: 'Brooklyn',
    address: `${k + 1} TEST STREET`,
    cross1: null,
    cross2: null,
    nta: code,
    gh6: 'dr5rs0',
    ntaReassigned: false,
  })),
);
const KIOSK_FIT = CODES.flatMap((_, j) => [95, 90, 85].map((f) => Math.max(0, f - 10 * j)));

const WHERE: WhereResult = {
  config: {
    metric: 'affinity',
    baseline: 'B0',
    form: 'difference',
    kappa: 1.5,
    thresholds: { defaultMapRho: 0.98, identicalRho: 0.999, densityOnlyRho: 0.99, thinMinCells: 300, thinMinOverlap: 0.5 },
    experimental: false,
  },
  anchors: [],
  // Deliberately not in rank order: computeProof ranks by lift itself.
  ntas: [...SCORES].reverse(),
  kioskFit: KIOSK_FIT,
  heat: [],
  grid: { cells: 0, covered: 0 },
};

const BUDGET = 400;
const OUR_PLAN: MediaPlan = buildMediaPlan({
  kiosks: KIOSKS,
  kioskFit: KIOSK_FIT,
  topNtas: ['BK0001', 'BK0002', 'BK0003'],
  budgetUsd: BUDGET,
  weeks: 1,
  assumptions: DEFAULT_ASSUMPTIONS,
});

const EVIDENCE = { BK0001: ['Live Music', 'Cozy', 'Late Night', 'Soul Food'], BK0002: ['Ramen'] };

function input(llmPicks: ProofInput['llmPicks'], over: Partial<ProofInput> = {}): ProofInput {
  return {
    where: WHERE,
    llmPicks,
    plan: OUR_PLAN,
    kiosks: KIOSKS,
    kioskFit: KIOSK_FIT,
    budgetUsd: BUDGET,
    weeks: 1,
    assumptions: DEFAULT_ASSUMPTIONS,
    evidenceByNta: EVIDENCE,
    ...over,
  };
}

const PICKS: ProofInput['llmPicks'] = [
  { ntaCode: ' bk0002 ', reason: ' Jazz history ' },
  { ntaCode: 'BK0006', reason: 'Busy corners' },
  { ntaCode: 'XX9999', reason: 'Not an eligible neighborhood' },
  { ntaCode: 'BK0002', reason: 'Duplicate' },
  { ntaCode: 'BK0007', reason: 'Nightlife' },
  { ntaCode: 'BK0005', reason: 'Near the park' },
  { ntaCode: 'BK0008', reason: 'Cheap screens' },
  { ntaCode: 'BK0004', reason: 'A sixth valid pick is ignored' },
];

describe('computeProof', () => {
  it('scores the LLM picks on the same lift ranking', () => {
    const proof = computeProof(input(PICKS));
    expect(proof.available).toBe(true);
    expect(proof.llmPicks).toEqual([
      { nta: 'BK0002', reason: 'Jazz history', percentile: 86 },
      { nta: 'BK0006', reason: 'Busy corners', percentile: 29 },
      { nta: 'BK0007', reason: 'Nightlife', percentile: 14 },
      { nta: 'BK0005', reason: 'Near the park', percentile: 43 },
      { nta: 'BK0008', reason: 'Cheap screens', percentile: 0 },
    ]);
    // Stoop's top 5 by lift are BK0001–BK0005; the LLM shares BK0002 and BK0005.
    expect(proof.overlapAt5).toBe(2);
    expect(proof.medianLlmPercentile).toBe(29);
    expect(proof.note).toBe(PROOF_NOTE);
    expect(proof.note).toMatch(/circular/);
  });

  it('compares both plans at the same spend and measures below-baseline spend', () => {
    expect(OUR_PLAN.totals.spend).toBe(360); // nine $40 screens; $40 of the budget stays unplaced
    const proof = computeProof(input(PICKS));
    expect(proof.ours).toEqual({ tasteWeightedImpressions: OUR_PLAN.totals.tasteWeightedImpressions, belowBaselineShare: 0 });
    // The LLM-only plan: same optimizer on its neighborhoods, no fit floor, held to Stoop's $360.
    const llmPlan = buildMediaPlan({
      kiosks: KIOSKS,
      kioskFit: KIOSK_FIT,
      topNtas: ['BK0002', 'BK0006', 'BK0007', 'BK0005', 'BK0008'],
      budgetUsd: 360,
      weeks: 1,
      assumptions: DEFAULT_ASSUMPTIONS,
      minFit: LLM_MIN_FIT,
    });
    expect(llmPlan.totals.spend).toBe(360);
    expect(proof.llmOnly).toEqual({ tasteWeightedImpressions: llmPlan.totals.tasteWeightedImpressions, belowBaselineShare: 0.3333 });
    expect(proof.llmOnly?.tasteWeightedImpressions).toBeLessThan(proof.ours.tasteWeightedImpressions);
  });

  it("names Stoop's best neighborhood the LLM missed, with up to three evidence labels", () => {
    expect(computeProof(input(PICKS)).missedByLlm).toEqual({ nta: 'BK0001', evidence: ['Live Music', 'Cozy', 'Late Night'] });
    const coveredBest = computeProof(input([{ ntaCode: 'BK0001', reason: '' }, { ntaCode: 'BK0008', reason: '' }]));
    expect(coveredBest.missedByLlm).toEqual({ nta: 'BK0002', evidence: ['Ramen'] });
    const coveredAll = computeProof(input(['BK0001', 'BK0002', 'BK0003'].map((ntaCode) => ({ ntaCode, reason: '' }))));
    expect(coveredAll.missedByLlm).toBeNull();
    expect(coveredAll.overlapAt5).toBe(3);
    expect(computeProof(input(PICKS, { evidenceByNta: undefined })).missedByLlm).toEqual({ nta: 'BK0001', evidence: [] });
  });

  it('is unavailable without a valid pick but still reports our plan', () => {
    const proof = computeProof(input([{ ntaCode: 'XX0000', reason: 'nope' }, { ntaCode: '', reason: '' }]));
    expect(proof).toEqual({
      available: false,
      llmPicks: [],
      overlapAt5: 0,
      medianLlmPercentile: null,
      ours: { tasteWeightedImpressions: OUR_PLAN.totals.tasteWeightedImpressions, belowBaselineShare: 0 },
      llmOnly: null,
      missedByLlm: null,
      note: PROOF_NOTE,
    });
  });

  it('leaves llmOnly empty when the LLM plan cannot buy a screen', () => {
    const tiny = buildMediaPlan({ kiosks: KIOSKS, kioskFit: KIOSK_FIT, topNtas: ['BK0001'], budgetUsd: 30, weeks: 1, assumptions: DEFAULT_ASSUMPTIONS });
    const proof = computeProof(input(PICKS, { plan: tiny, budgetUsd: 30 }));
    expect(proof.available).toBe(true);
    expect(proof.llmOnly).toBeNull();
    expect(proof.ours).toEqual({ tasteWeightedImpressions: 0, belowBaselineShare: 0 });
  });

  it('is deterministic', () => {
    expect(computeProof(input(PICKS))).toEqual(computeProof(input(PICKS)));
  });
});

describe('belowBaselineShare', () => {
  it('weights by spend and treats unscored neighborhoods as below baseline', () => {
    const plan = {
      ...OUR_PLAN,
      screens: [
        { i: 0, siteId: 'a', nta: 'BK0001', fit: 90, weeklyImpressions: 3_500, cost: 40 },
        { i: 1, siteId: 'b', nta: 'BK0006', fit: 40, weeklyImpressions: 3_500, cost: 40 },
        { i: 2, siteId: 'c', nta: 'ZZ0000', fit: 40, weeklyImpressions: 10_000, cost: 120 },
      ],
    };
    const lift = new Map(SCORES.map((s) => [s.code, s.lift]));
    expect(belowBaselineShare(plan, lift)).toBe(0.8);
    expect(belowBaselineShare({ ...plan, screens: [] }, lift)).toBe(0);
  });
});
