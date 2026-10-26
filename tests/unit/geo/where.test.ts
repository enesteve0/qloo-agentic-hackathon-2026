import { describe, expect, it } from 'vitest';
import { aggregateNtas, combineLift } from '@/server/geo/aggregate';
import { DEFAULT_LIFT_CONFIG } from '@/server/geo/calibration';
import { projectToGrid } from '@/server/geo/grid';
import { rankZ } from '@/server/geo/rankz';
import { HEAT_MAX_CELLS, computeWhere, liftMultiplier, type WhereInput } from '@/server/geo/where';
import type { HeatmapData, LiftConfig } from '@/shared/types';
import { NON_RESIDENTIAL, ONE_KIOSK, PLANTED_A, PLANTED_B, buildWorld, makeHeatmap, tasteFor, type World } from './world';

const world = buildWorld();
const tasteA = tasteFor(world, PLANTED_A);
const tasteB = tasteFor(world, PLANTED_B);
const PLANTED = new Set<string>([...PLANTED_A, ...PLANTED_B]);
const DENSE = new Set(['T00', 'T01', 'T02']);

function scenario(seed: number) {
  const A = makeHeatmap(world, { seed: seed * 10 + 1, taste: tasteA, mixPrecision: true });
  const B = makeHeatmap(world, { seed: seed * 10 + 2, taste: tasteB, mixPrecision: true });
  const baselines = [3, 4, 5].map((k) => makeHeatmap(world, { seed: seed * 10 + k, taste: null, densityWeight: 1, affNoise: 0.15 }));
  return { A, B, baselines };
}

function input(maps: { A: HeatmapData; B: HeatmapData; baselines: HeatmapData[] }, config: LiftConfig = DEFAULT_LIFT_CONFIG, w: World = world): WhereInput {
  return {
    anchors: [
      { id: 'urn:a', name: 'Anchor A', heatmap: maps.A, userWeight: 1 },
      { id: 'urn:b', name: 'Anchor B', heatmap: maps.B, userWeight: 1 },
    ],
    baselines: maps.baselines,
    config,
    grid: w.grid,
    kiosks: w.kiosks,
    ntas: w.ntas,
  };
}

const precisionAt5 = (codes: string[]) => codes.slice(0, 5).filter((c) => PLANTED.has(c)).length / 5;

/** Eligible neighborhoods ranked by the anchors' RAW affinity (rank-z, no baseline subtraction). */
function rawRanking(maps: { A: HeatmapData; B: HeatmapData }, eligible: Set<string>): string[] {
  const parts = [maps.A, maps.B].map((m, k) => ({ id: String(k), lift: rankZ(projectToGrid(m.cells, world.grid, 'aff').values), weight: 1 }));
  const L = combineLift(parts, world.grid.cells.length);
  return aggregateNtas({ L, grid: world.grid, kappa: 1.5, anchors: parts })
    .filter((r) => eligible.has(r.code))
    .sort((x, y) => y.lift - x.lift)
    .map((r) => r.code);
}

describe('planted-bump recovery', () => {
  const configs: [string, LiftConfig][] = [
    ['B4 difference (default)', DEFAULT_LIFT_CONFIG],
    ['B4 residual', { ...DEFAULT_LIFT_CONFIG, form: 'residual' }],
    ['B0 affinity_rank', { ...DEFAULT_LIFT_CONFIG, baseline: 'B0' }],
    ['B1 baseline map', { ...DEFAULT_LIFT_CONFIG, baseline: 'B1' }],
    ['B3 panel', { ...DEFAULT_LIFT_CONFIG, baseline: 'B3' }],
  ];

  it.each(configs)('%s: lift precision@5 ≥ 0.6 where raw affinity scores ≤ 0.3', (_, config) => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const maps = scenario(seed);
      const { result } = computeWhere(input(maps, config));
      const byLift = result.ntas.map((n) => n.code);
      const byRaw = rawRanking(maps, new Set(byLift));
      expect(precisionAt5(byLift), `seed ${seed} lift top-5 ${byLift.slice(0, 5).join(',')}`).toBeGreaterThanOrEqual(0.6);
      expect(precisionAt5(byRaw), `seed ${seed} raw top-5 ${byRaw.slice(0, 5).join(',')}`).toBeLessThanOrEqual(0.3);
    }
  });
});

describe('computeWhere output', () => {
  const maps = scenario(1);
  const { result, narration } = computeWhere(input(maps));

  it('ranks eligible neighborhoods only, by shrunk lift, with fit index and multiplier', () => {
    const codes = result.ntas.map((n) => n.code);
    expect(codes).toHaveLength(10);
    expect(codes).not.toContain(NON_RESIDENTIAL);
    expect(codes).not.toContain(ONE_KIOSK);
    for (let k = 1; k < result.ntas.length; k++) expect(result.ntas[k - 1]!.lift).toBeGreaterThanOrEqual(result.ntas[k]!.lift);
    // 10 neighborhoods → mid-rank percentiles 95, 85, …, 5.
    expect(result.ntas.map((n) => n.fitIndex)).toEqual([95, 85, 75, 65, 55, 45, 35, 25, 15, 5]);
    result.ntas.forEach((n, k) => {
      // Rounded display value (2 decimals) of 1.6^L̂; non-increasing down the ranking.
      expect(Math.abs(n.multiplier - liftMultiplier(n.lift))).toBeLessThanOrEqual(0.006);
      if (k > 0) expect(result.ntas[k - 1]!.multiplier).toBeGreaterThanOrEqual(n.multiplier);
      expect(n.agreement).toBeGreaterThanOrEqual(0);
      expect(n.agreement).toBeLessThanOrEqual(1);
      expect(n.se).toBeGreaterThan(0);
      expect(n.topAnchors.length).toBeLessThanOrEqual(3);
      for (const t of n.topAnchors) expect(['urn:a', 'urn:b']).toContain(t.anchorId);
      if (PLANTED.has(n.code)) expect(n.confidence).not.toBe('low');
    });
  });

  it('scores kiosks 0–100 and leaves unscored kiosks at -1', () => {
    const { kioskFit } = result;
    expect(kioskFit).toHaveLength(world.kiosks.length);
    kioskFit.forEach((f, i) => {
      if (i === world.kiosks.length - 1) expect(f).toBe(-1); // the orphan cell has no Qloo data
      else {
        expect(Number.isInteger(f)).toBe(true);
        expect(f).toBeGreaterThanOrEqual(0);
        expect(f).toBeLessThanOrEqual(100);
      }
    });
    const mean = (codes: Set<string>) => {
      const fits = world.kiosks.filter((k) => codes.has(k.nta) && !k.ntaReassigned).map((k) => kioskFit[k.i]!);
      return fits.reduce((s, f) => s + f, 0) / fits.length;
    };
    expect(mean(PLANTED)).toBeGreaterThan(mean(DENSE) + 30);
  });

  it('builds a capped heat layer of above-baseline cells, strongest first', () => {
    const cells = new Set(world.grid.cells);
    expect(result.heat.length).toBeGreaterThan(0);
    expect(result.heat.length).toBeLessThanOrEqual(HEAT_MAX_CELLS);
    result.heat.forEach((h, k) => {
      expect(cells.has(h.gh)).toBe(true);
      expect(h.v).toBeGreaterThan(1);
      if (k > 0) expect(result.heat[k - 1]!.v).toBeGreaterThanOrEqual(h.v);
    });
  });

  it('reports grid coverage, anchors, config and narration', () => {
    expect(result.grid).toEqual({ cells: 667, covered: 666 });
    expect(result.anchors.map((a) => [a.anchorId, a.flags, a.weight, a.cells])).toEqual([
      ['urn:a', [], 1, 666],
      ['urn:b', [], 1, 666],
    ]);
    expect(result.config).toEqual(DEFAULT_LIFT_CONFIG);
    expect(result.config).not.toBe(DEFAULT_LIFT_CONFIG);
    expect(narration).toEqual(['Scored 10 neighborhoods from 2 anchor maps on 666 of 667 city cells.']);
  });
});

describe('liftMultiplier', () => {
  it('maps 0 → 1×, one SD → 1.6×, and clamps to [0.3, 4]', () => {
    expect(liftMultiplier(0)).toBe(1);
    expect(liftMultiplier(1)).toBeCloseTo(1.6, 12);
    expect(liftMultiplier(-1)).toBeCloseTo(0.625, 12);
    expect(liftMultiplier(10)).toBe(4);
    expect(liftMultiplier(-10)).toBe(0.3);
    expect(liftMultiplier(0.5)).toBeLessThan(liftMultiplier(0.6));
  });
});

describe('exclusion and degraded inputs', () => {
  const maps = scenario(1);
  const fingerprint = makeHeatmap(world, { seed: 99, taste: null, densityWeight: 1, affNoise: 0.05 });

  it('a DEFAULT_MAP anchor is excluded and changes nothing else', () => {
    const plain = computeWhere(input(maps)).result;
    const base = input(maps);
    const withDefault = computeWhere({
      ...base,
      anchors: [...base.anchors, { id: 'urn:nodata', name: 'Bursaspor', heatmap: structuredClone(fingerprint), userWeight: 1 }],
      defaultFingerprint: fingerprint,
    });
    expect(withDefault.result.anchors[2]).toMatchObject({ anchorId: 'urn:nodata', flags: ['DEFAULT_MAP'], weight: 0 });
    expect(withDefault.result.ntas).toEqual(plain.ntas);
    expect(withDefault.result.kioskFit).toEqual(plain.kioskFit);
    expect(withDefault.result.heat).toEqual(plain.heat);
    expect(withDefault.narration[0]).toBe("Set aside 'Bursaspor': its NYC map matches Qloo's default map, which is just overall density.");
  });

  it('returns an empty but valid result when no anchor map is usable', () => {
    const { result, narration } = computeWhere({
      ...input(maps),
      anchors: [{ id: 'urn:nodata', name: 'Bursaspor', heatmap: fingerprint, userWeight: 1 }],
      defaultFingerprint: fingerprint,
    });
    expect(result.ntas).toEqual([]);
    expect(result.heat).toEqual([]);
    expect(result.kioskFit.every((f) => f === -1)).toBe(true);
    expect(result.grid).toEqual({ cells: 667, covered: 0 });
    expect(narration.at(-1)).toBe('No anchor map was usable, so no neighborhood could be scored.');
  });

  it('leaves neighborhoods without signal unranked and says so', () => {
    const north = (i: number) => (world.cellNta[i] ?? 'T3').charAt(1) !== '3';
    const partial = {
      A: makeHeatmap(world, { seed: 61, taste: tasteA, keep: north }),
      B: makeHeatmap(world, { seed: 62, taste: tasteB, keep: north }),
      baselines: [],
    };
    const { result, narration } = computeWhere(input(partial));
    expect(result.ntas.map((n) => n.code).sort()).toEqual(['T00', 'T01', 'T02', 'T11', 'T20', 'T21', 'T22']);
    expect(narration).toContain('3 neighborhoods had no Qloo signal and stayed unranked.');
    world.kiosks.forEach((k) => {
      if (k.nta.startsWith('T3')) expect(result.kioskFit[k.i]).toBe(-1);
    });
  });

  it('falls back to B4 when the configured baseline map is missing', () => {
    const { result, narration } = computeWhere(input({ ...maps, baselines: [] }, { ...DEFAULT_LIFT_CONFIG, baseline: 'B3' }));
    expect(result.config.baseline).toBe('B4');
    expect(narration[0]).toBe('No B3 baseline map was available, so each anchor was compared with its own popularity map (B4).');
    expect(result.ntas).toEqual(computeWhere(input({ ...maps, baselines: [] })).result.ntas);
  });
});

describe('determinism', () => {
  it('returns identical output for identical input, whatever the order of heatmap cells', () => {
    const maps = scenario(2);
    const first = JSON.stringify(computeWhere(input(maps)));
    expect(JSON.stringify(computeWhere(input(maps)))).toBe(first);
    const shuffled = {
      A: { ...maps.A, cells: [...maps.A.cells].reverse() },
      B: { ...maps.B, cells: [...maps.B.cells].sort((x, y) => (x.aff ?? 0) - (y.aff ?? 0)) },
      baselines: maps.baselines,
    };
    expect(JSON.stringify(computeWhere(input(shuffled)))).toBe(first);
  });
});

describe('performance', () => {
  it('scores ~1,500 cells × 5 anchors well within the WHERE stage budget', () => {
    const big = buildWorld({ minLat: 40.55, minLon: -74.1, maxLat: 40.85, maxLon: -73.8 });
    expect(big.grid.cells.length).toBeGreaterThan(1500);
    const anchors = ['T20', 'T32', 'T22', 'T30', 'T21'].map((c, k) => ({
      id: c,
      name: c,
      heatmap: makeHeatmap(big, { seed: 100 + k, taste: tasteFor(big, [c]), mixPrecision: true }),
      userWeight: 1,
    }));
    const t0 = performance.now();
    const { result } = computeWhere({ anchors, baselines: [], config: DEFAULT_LIFT_CONFIG, grid: big.grid, kiosks: big.kiosks, ntas: big.ntas });
    const ms = performance.now() - t0;
    expect(result.ntas.length).toBeGreaterThan(0);
    expect(ms).toBeLessThan(1500); // measured ≈ 20 ms locally; generous for CI
  });
});
