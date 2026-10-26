import { describe, expect, it } from 'vitest';
import { DEFAULT_LIFT_CONFIG } from '@/server/geo/calibration';
import { detectFlags, sameTopOrder, topOrder } from '@/server/geo/detect';
import { projectToGrid } from '@/server/geo/grid';
import { anchorMetric, computeAnchorLifts, type AnchorLift } from '@/server/geo/lift';
import { spearman } from '@/server/geo/rankz';
import type { HeatmapData, LiftConfig } from '@/shared/types';
import { PLANTED_A, PLANTED_B, buildWorld, makeHeatmap, tasteFor } from './world';

const world = buildWorld();
const G = world.grid.cells.length;
const tasteA = makeHeatmap(world, { seed: 11, taste: tasteFor(world, PLANTED_A) });
const tasteB = makeHeatmap(world, { seed: 12, taste: tasteFor(world, PLANTED_B) });
/** Qloo's generic "no data" map: overall density only. */
const defaultMap = makeHeatmap(world, { seed: 99, taste: null, densityWeight: 1, affNoise: 0.05 });

interface Spec {
  id: string;
  name: string;
  heatmap: HeatmapData;
  userWeight?: number;
}

function detect(specs: Spec[], opts: { config?: LiftConfig; baselines?: HeatmapData[]; fingerprint?: HeatmapData } = {}) {
  const config = opts.config ?? DEFAULT_LIFT_CONFIG;
  const lifted = computeAnchorLifts({
    anchors: specs.map((s) => ({ userWeight: 1, ...s })),
    baselines: opts.baselines ?? [],
    config,
    grid: world.grid,
  });
  const fingerprint = opts.fingerprint ? projectToGrid(opts.fingerprint.cells, world.grid, anchorMetric(lifted.config)).values : null;
  return { lifted, ...detectFlags({ anchors: lifted.anchors, config: lifted.config, gridSize: G, fingerprint }) };
}

describe('DEFAULT_MAP', () => {
  it('sets aside an anchor whose map is the identical density-only default map', () => {
    const out = detect(
      [
        { id: 'a', name: 'Anchor A', heatmap: tasteA },
        { id: 'nodata', name: 'Bursaspor', heatmap: structuredClone(defaultMap) },
      ],
      { fingerprint: defaultMap },
    );
    expect(out.infos.map((i) => [i.anchorId, i.flags, i.weight])).toEqual([
      ['a', [], 1],
      ['nodata', ['DEFAULT_MAP'], 0],
    ]);
    expect(out.weights).toEqual([1, 0]);
    expect(out.narration).toEqual(["Set aside 'Bursaspor': its NYC map matches Qloo's default map, which is just overall density."]);
  });

  it('also triggers on an identical top-100 cell order even when overall ρ is low', () => {
    const n = 400;
    const fp = Float64Array.from({ length: n }, (_, i) => i);
    // Same top 100 cells in the same order; the other 300 reversed.
    const anchor = Float64Array.from({ length: n }, (_, i) => (i >= 300 ? i : 299 - i));
    expect(spearman(anchor, fp)).toBeLessThan(0.5);
    expect(topOrder(fp, 3)).toEqual([399, 398, 397]);
    expect(sameTopOrder(anchor, fp)).toBe(true);

    const swapped = Float64Array.from(anchor);
    swapped[399] = 398;
    swapped[398] = 399;
    expect(sameTopOrder(swapped, fp)).toBe(false);

    const lift = (values: Float64Array): AnchorLift => ({
      id: 'x',
      name: 'X',
      userWeight: 1,
      values,
      reference: null,
      rhoReference: Number.NaN,
      lift: values,
      covered: n,
      cells: n,
      overlap: 1,
    });
    const config = { ...DEFAULT_LIFT_CONFIG, thresholds: { ...DEFAULT_LIFT_CONFIG.thresholds, thinMinCells: 10 } };
    expect(detectFlags({ anchors: [lift(anchor)], config, gridSize: n, fingerprint: fp }).infos[0]!.flags).toEqual(['DEFAULT_MAP']);
    expect(detectFlags({ anchors: [lift(swapped)], config, gridSize: n, fingerprint: fp }).infos[0]!.flags).toEqual([]);
    expect(detectFlags({ anchors: [lift(anchor)], config, gridSize: n }).infos[0]!.flags).toEqual([]);
  });
});

describe('IDENTICAL_PAIR', () => {
  it('merges the later of two identical anchor maps', () => {
    const out = detect([
      { id: 'a', name: 'Anchor A', heatmap: tasteA },
      { id: 'b', name: 'Anchor B', heatmap: tasteB },
      { id: 'a2', name: 'Anchor A Again', heatmap: structuredClone(tasteA) },
    ]);
    expect(out.infos.map((i) => i.flags)).toEqual([[], [], ['IDENTICAL_PAIR']]);
    expect(out.weights).toEqual([1, 1, 0]);
    expect(out.narration).toEqual(["Merged 'Anchor A Again' into 'Anchor A': Qloo returned the same NYC map for both."]);
  });

  it('keeps the copy when the earlier anchor is not counted', () => {
    const out = detect([
      { id: 'a', name: 'Anchor A', heatmap: tasteA, userWeight: 0 },
      { id: 'a2', name: 'Anchor A Again', heatmap: structuredClone(tasteA) },
    ]);
    expect(out.infos.map((i) => i.flags)).toEqual([[], []]);
    expect(out.weights).toEqual([0, 1]);
  });
});

describe('DENSITY_ONLY and THIN', () => {
  it('halves an anchor whose map is just overall density', () => {
    const dense = makeHeatmap(world, { seed: 41, taste: null, densityWeight: 1, affNoise: 0.02, popNoise: 0.02 });
    const out = detect([
      { id: 'a', name: 'Anchor A', heatmap: tasteA },
      { id: 'd', name: 'Starbucks', heatmap: dense },
    ]);
    expect(out.lifted.anchors[1]!.rhoReference).toBeGreaterThanOrEqual(0.99);
    expect(out.lifted.anchors[0]!.rhoReference).toBeLessThan(0.99);
    expect(out.infos.map((i) => [i.flags, i.weight])).toEqual([
      [[], 1],
      [['DENSITY_ONLY'], 0.5],
    ]);
    expect(out.narration).toEqual(["Halved the weight of 'Starbucks': its NYC map mostly tracks overall density."]);
  });

  it('down-weights a map with too few cells by its coverage', () => {
    const north = new Set(['T00', 'T01', 'T02']);
    const thin = makeHeatmap(world, { seed: 42, taste: tasteFor(world, ['T01']), keep: (i) => north.has(world.cellNta[i] ?? '') });
    const out = detect([{ id: 't', name: 'Pick n Pay', heatmap: thin, userWeight: 2 }]);
    const cells = out.lifted.anchors[0]!.cells;
    expect(cells).toBeGreaterThan(50);
    expect(cells).toBeLessThan(300);
    expect(out.infos[0]!.flags).toEqual(['THIN']);
    expect(out.weights[0]).toBeCloseTo((2 * cells) / G, 12);
    expect(out.infos[0]!.coverage).toBeCloseTo(cells / G, 4);
    expect(out.narration).toEqual([`Down-weighted 'Pick n Pay': thin signal on ${cells} of ${G} city cells.`]);
  });

  it('down-weights a map that overlaps less than half of the baseline', () => {
    const partial = makeHeatmap(world, { seed: 43, taste: tasteFor(world, PLANTED_A), keep: (i) => i % 5 < 2 });
    const baseline = makeHeatmap(world, { seed: 44, taste: null, densityWeight: 1, affNoise: 0.15 });
    const config: LiftConfig = { ...DEFAULT_LIFT_CONFIG, baseline: 'B1', thresholds: { ...DEFAULT_LIFT_CONFIG.thresholds, thinMinCells: 100 } };
    const out = detect([{ id: 'p', name: 'Partial', heatmap: partial }], { config, baselines: [baseline] });
    const a = out.lifted.anchors[0]!;
    expect(a.cells).toBeGreaterThanOrEqual(100);
    expect(a.overlap).toBeLessThan(0.5);
    expect(out.infos[0]!.flags).toEqual(['THIN']);
    expect(out.weights[0]).toBeCloseTo(a.cells / G, 12);
    expect(out.narration).toEqual([`Down-weighted 'Partial': its map overlaps only ${Math.round(a.overlap * 100)}% of the baseline's cells.`]);
  });

  it('stacks DENSITY_ONLY and THIN', () => {
    const south = new Set(['T30', 'T31', 'T32']);
    const denseThin = makeHeatmap(world, {
      seed: 45,
      taste: null,
      densityWeight: 1,
      affNoise: 0.02,
      popNoise: 0.02,
      keep: (i) => south.has(world.cellNta[i] ?? ''),
    });
    const out = detect([{ id: 'x', name: 'Dense Thin', heatmap: denseThin }]);
    const a = out.lifted.anchors[0]!;
    expect(out.infos[0]!.flags).toEqual(['DENSITY_ONLY', 'THIN']);
    expect(out.weights[0]).toBeCloseTo((0.5 * a.cells) / G, 12);
  });
});
