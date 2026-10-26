import { describe, expect, it } from 'vitest';
import { DEFAULT_LIFT_CONFIG } from '@/server/geo/calibration';
import { projectToGrid } from '@/server/geo/grid';
import { anchorMetric, computeAnchorLifts, liftOver, panelMeanZ } from '@/server/geo/lift';
import { pearson, probit, rankZ } from '@/server/geo/rankz';
import type { LiftConfig } from '@/shared/types';
import { PLANTED_A, buildWorld, gaussian, makeHeatmap, mulberry32, tasteFor } from './world';

const world = buildWorld();
const taste = tasteFor(world, PLANTED_A);
const anchorMap = makeHeatmap(world, { seed: 11, taste });
const baseline = (seed: number) => makeHeatmap(world, { seed, taste: null, densityWeight: 1, affNoise: 0.15 });
const cfg = (patch: Partial<LiftConfig>): LiftConfig => ({ ...DEFAULT_LIFT_CONFIG, ...patch });
const run = (config: LiftConfig, baselines = [baseline(21)], userWeight = 1) =>
  computeAnchorLifts({ anchors: [{ id: 'a', name: 'Anchor A', heatmap: anchorMap, userWeight }], baselines, config, grid: world.grid });

describe('anchorMetric', () => {
  it('reads affinity_rank under B0 and config.metric otherwise', () => {
    expect(anchorMetric(cfg({ baseline: 'B0', metric: 'affinity' }))).toBe('rank');
    expect(anchorMetric(cfg({ baseline: 'B4', metric: 'affinity' }))).toBe('aff');
    expect(anchorMetric(cfg({ baseline: 'B1', metric: 'affinity_rank' }))).toBe('rank');
  });
});

describe('liftOver', () => {
  it('difference form re-ranks both maps on their co-covered cells', () => {
    const values = Float64Array.from([0.1, 0.5, 0.9, NaN, 0.3]);
    const reference = Float64Array.from([0.2, 0.4, NaN, 0.7, 0.6]);
    const lift = liftOver(values, reference, 'difference');
    const hi = probit(5 / 6);
    expect(lift[0]).toBeCloseTo(0, 12);
    expect(lift[1]).toBeCloseTo(hi, 12);
    expect(lift[2]).toBeNaN();
    expect(lift[3]).toBeNaN();
    expect(lift[4]).toBeCloseTo(-hi, 12);
  });

  it('residual form removes the baseline component and has unit SD', () => {
    const rng = mulberry32(5);
    const b = Float64Array.from({ length: 500 }, () => gaussian(rng));
    const a = b.map((v) => 0.8 * v + 0.6 * gaussian(rng));
    const lift = liftOver(a, b, 'residual');
    expect(Math.abs(pearson(lift, rankZ(b)))).toBeLessThan(1e-9);
    const mean = lift.reduce((s, v) => s + v, 0) / lift.length;
    const sd = Math.sqrt(lift.reduce((s, v) => s + (v - mean) ** 2, 0) / lift.length);
    expect(sd).toBeCloseTo(1, 9);
  });

  it('gives 0 lift where a map equals its baseline', () => {
    const v = Float64Array.from([0.3, 0.1, 0.8, NaN, 0.5]);
    expect(Array.from(liftOver(v, v, 'difference'))).toEqual([0, 0, 0, NaN, 0]);
    expect(Array.from(liftOver(v, v, 'residual'))).toEqual([0, 0, 0, NaN, 0]);
  });
});

describe('computeAnchorLifts', () => {
  const values = (metric: 'aff' | 'rank' | 'pop', map = anchorMap) => projectToGrid(map.cells, world.grid, metric).values;

  it('B4 (default) subtracts the same response’s popularity', () => {
    const { anchors, config, notes } = run(DEFAULT_LIFT_CONFIG, []);
    const [a] = anchors;
    expect(config.baseline).toBe('B4');
    expect(notes).toEqual([]);
    expect(Array.from(a!.lift)).toEqual(Array.from(liftOver(values('aff'), values('pop'), 'difference')));
    expect(a!.cells).toBe(world.grid.cells.length - 1); // every cell but the orphan kiosk cell
    expect(a!.overlap).toBe(1);
    expect(a!.rhoReference).toBeGreaterThan(0.6);
    expect(a!.rhoReference).toBeLessThan(0.95);
  });

  it('B0 uses the anchor’s own affinity_rank directly', () => {
    const [a] = run(cfg({ baseline: 'B0', form: 'residual' })).anchors;
    expect(Array.from(a!.lift)).toEqual(Array.from(rankZ(values('rank'))));
    expect(Array.from(a!.values)).toEqual(Array.from(values('rank')));
    expect(a!.overlap).toBe(1);
  });

  it('B1/B2 subtract the first supplied baseline map', () => {
    const first = baseline(21);
    const [a] = run(cfg({ baseline: 'B2' }), [first, baseline(22)]).anchors;
    expect(Array.from(a!.lift)).toEqual(Array.from(liftOver(values('aff'), values('aff', first), 'difference')));
  });

  it('B3 subtracts the mean rank-z of the panel', () => {
    const panel = [baseline(31), baseline(32), baseline(33)];
    const [a] = run(cfg({ baseline: 'B3' }), panel).anchors;
    const mean = panelMeanZ(panel.map((m) => values('aff', m)));
    expect(Array.from(a!.lift)).toEqual(Array.from(liftOver(values('aff'), mean, 'difference')));
    const z = panel.map((m) => rankZ(values('aff', m)));
    expect(mean[0]).toBeCloseTo((z[0]![0]! + z[1]![0]! + z[2]![0]!) / 3, 12);
  });

  it('falls back to B4 with a note when a B1–B3 baseline is missing', () => {
    const out = run(cfg({ baseline: 'B1' }), []);
    expect(out.config.baseline).toBe('B4');
    expect(out.notes).toEqual(['No B1 baseline map was available, so each anchor was compared with its own popularity map (B4).']);
    expect(Array.from(out.anchors[0]!.lift)).toEqual(Array.from(run(DEFAULT_LIFT_CONFIG, []).anchors[0]!.lift));
  });

  it('measures overlap against the baseline and sanitizes user weights', () => {
    const half = makeHeatmap(world, { seed: 12, taste, keep: (i) => i % 2 === 0 });
    const out = computeAnchorLifts({
      anchors: [
        { id: 'h', name: 'Half', heatmap: half, userWeight: Number.NaN },
        { id: 'n', name: 'Negative', heatmap: anchorMap, userWeight: -2 },
        { id: 'w', name: 'Weighted', heatmap: anchorMap, userWeight: 2.5 },
      ],
      baselines: [baseline(21)],
      config: cfg({ baseline: 'B1' }),
      grid: world.grid,
    });
    const [h, n, w] = out.anchors;
    expect(h!.overlap).toBeCloseTo(h!.cells / (world.grid.cells.length - 1), 12);
    expect(h!.overlap).toBeGreaterThan(0.45);
    expect(h!.overlap).toBeLessThan(0.55);
    expect([h!.userWeight, n!.userWeight, w!.userWeight]).toEqual([0, 0, 2.5]);
  });

  it('cannot score an anchor without popularity values under B4', () => {
    const noPop = { cells: anchorMap.cells.map((c) => ({ ...c, pop: null })), locality: null };
    const out = computeAnchorLifts({
      anchors: [{ id: 'x', name: 'No Pop', heatmap: noPop, userWeight: 1 }],
      baselines: [],
      config: DEFAULT_LIFT_CONFIG,
      grid: world.grid,
    });
    expect(out.anchors[0]!.cells).toBe(0);
    expect(out.anchors[0]!.reference).toBeNull();
    expect(out.notes).toEqual(["Could not compare 'No Pop' with the NYC baseline: its map came back without popularity values."]);
  });
});
