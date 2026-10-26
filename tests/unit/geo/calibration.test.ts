import { describe, expect, it } from 'vitest';
import { DEFAULT_LIFT_CONFIG, distinctness, scoreConfigs, scoreTrial, type ConfigTrial } from '@/server/geo/calibration';
import type { LiftConfig } from '@/shared/types';

const cfg = (patch: Partial<LiftConfig>): LiftConfig => ({ ...DEFAULT_LIFT_CONFIG, ...patch });
const ranking = (boros: string[]) => boros.map((boro, k) => ({ code: `N${k}`, boro }));
const BK = 'Brooklyn';
const MN = 'Manhattan';

/** Anchor lift maps with a chosen similarity: identical maps give DISC 0, independent ones ≈ 1. */
const ORDERED = [1, 2, 3, 4, 5, 6, 7, 8];
const REVERSED = [8, 7, 6, 5, 4, 3, 2, 1];
const MIXED = [3, 8, 1, 6, 2, 7, 4, 5];

function trial(config: LiftConfig, face1Share: number, rho: 'pos' | 'neg', maps: number[][], coverage: number[]): ConfigTrial {
  const hits = Math.round(face1Share * 10);
  return {
    config,
    face1: [{ expectedBoro: BK, ranking: ranking([...Array(hits).fill(BK), ...Array(10 - hits).fill(MN), BK]) }],
    face2: [
      {
        lift: { a: 1, b: 2, c: 3, d: 4 },
        target: rho === 'pos' ? { a: 10, b: 20, c: 30, d: 40, e: 50 } : { a: 40, b: 30, c: 20, d: 10 },
      },
    ],
    anchorLifts: maps,
    coverage,
  };
}

describe('DEFAULT_LIFT_CONFIG', () => {
  it('is the zero-extra-call B4 configuration from the spec, frozen', () => {
    expect(DEFAULT_LIFT_CONFIG).toEqual({
      metric: 'affinity',
      baseline: 'B4',
      form: 'difference',
      kappa: 1.5,
      thresholds: { defaultMapRho: 0.98, identicalRho: 0.999, densityOnlyRho: 0.99, thinMinCells: 300, thinMinOverlap: 0.5 },
      experimental: false,
    });
    expect(Object.isFrozen(DEFAULT_LIFT_CONFIG)).toBe(true);
    expect(Object.isFrozen(DEFAULT_LIFT_CONFIG.thresholds)).toBe(true);
  });
});

describe('scoreTrial', () => {
  it('computes FACE1, FACE2, FACE, DISC and COV', () => {
    const s = scoreTrial(trial(cfg({}), 0.7, 'pos', [ORDERED, REVERSED], [0.95, 0.91]));
    expect(s.FACE1).toBeCloseTo(0.7, 12); // only the top 10 count
    expect(s.FACE2).toBeCloseTo(1, 12); // spearman over the 4 common neighborhoods
    expect(s.FACE).toBeCloseTo(0.85, 12);
    expect(s.DISC).toBeCloseTo(2, 12); // 1 − ρ with ρ = −1
    expect(s.COV).toBeCloseTo(0.93, 12);
    expect(s.passesGates).toBe(true);
  });

  it('gates on DISC and COV; unmeasurable metrics do not block', () => {
    expect(scoreTrial(trial(cfg({}), 0.7, 'pos', [ORDERED, ORDERED], [0.95])).passesGates).toBe(false);
    expect(scoreTrial(trial(cfg({}), 0.7, 'pos', [ORDERED, MIXED], [0.8])).passesGates).toBe(false);
    const single = scoreTrial(trial(cfg({}), 0.7, 'pos', [ORDERED], []));
    expect(single.DISC).toBeNull();
    expect(single.COV).toBeNull();
    expect(single.passesGates).toBe(true);
    expect(distinctness([ORDERED, ORDERED, REVERSED])).toBeCloseTo(1 - (1 - 1 - 1) / 3, 12);
  });
});

describe('scoreConfigs', () => {
  const distinct = [ORDERED, MIXED];

  it('picks the highest FACE among gated trials and breaks near-ties toward cheaper baselines', () => {
    const trials = [
      trial(cfg({ baseline: 'B3' }), 0.7, 'pos', distinct, [0.95]),
      trial(cfg({ baseline: 'B4', form: 'residual' }), 0.7, 'pos', distinct, [0.95]),
      trial(cfg({ baseline: 'B4' }), 0.7, 'pos', distinct, [0.95]),
      trial(cfg({ baseline: 'B1' }), 1, 'pos', distinct, [0.8]), // best FACE but fails COV
      trial(cfg({ baseline: 'B2' }), 0.2, 'neg', distinct, [0.95]),
    ];
    const choice = scoreConfigs(trials);
    expect(choice.chosen).toBe(2);
    expect(choice.config).toEqual({ ...DEFAULT_LIFT_CONFIG, baseline: 'B4', experimental: false });
    expect(choice.ranking).toEqual([2, 1, 0, 4, 3]);
    // ρ(ORDERED, MIXED) = 1 − 6·76/(8·63) → DISC = 456/504 ≈ 0.90.
    expect(choice.scores[2]!.DISC).toBeCloseTo(456 / 504, 12);
    expect(choice.reason).toBe('affinity · B4 · difference: FACE 0.85 (FACE1 0.70, FACE2 1.00), DISC 0.90, COV 0.95.');
  });

  it('ships the most distinctive configuration as experimental when every FACE ≤ 0.2', () => {
    const trials = [
      trial(cfg({ baseline: 'B4' }), 0.1, 'neg', [ORDERED, MIXED], [0.95]),
      trial(cfg({ baseline: 'B0' }), 0.2, 'neg', [ORDERED, REVERSED], [0.95]),
    ];
    const choice = scoreConfigs(trials);
    expect(choice.chosen).toBe(1);
    expect(choice.config.baseline).toBe('B0');
    expect(choice.config.experimental).toBe(true);
    expect(choice.reason).toBe(
      'Every configuration scored FACE ≤ 0.2; shipping the most distinctive one (affinity · B0 · difference, DISC 2.00) as experimental.',
    );
  });

  it('labels the pick experimental when no trial passes the gates', () => {
    const choice = scoreConfigs([trial(cfg({ baseline: 'B2' }), 0.9, 'pos', [ORDERED, ORDERED], [0.5])]);
    expect(choice.chosen).toBe(0);
    expect(choice.config.experimental).toBe(true);
    expect(choice.reason).toContain('No configuration passed the DISC/COV gates');
  });

  it('rejects an empty trial list', () => {
    expect(() => scoreConfigs([])).toThrow('at least one trial');
  });
});
