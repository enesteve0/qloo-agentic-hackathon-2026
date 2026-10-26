import ngeohash from 'ngeohash';
import { describe, expect, it } from 'vitest';
import { gridIndex, gridNeighbors, projectToGrid } from '@/server/geo/grid';
import type { GridSpec } from '@/server/geo/types';
import type { HeatCell } from '@/shared/types';

const CENTER = ngeohash.encode(40.7505, -73.9934, 6); // Midtown
const [N, NE, E, SE, S, SW, W, NW] = ngeohash.neighbors(CENTER) as [string, string, string, string, string, string, string, string];
const FAR = ngeohash.encode(40.58, -74.15, 6); // Staten Island: a different gh5 parent, no data

function gridOf(cells: string[]): GridSpec {
  return { precision: 6, cells, ntaWeights: {}, kioskCell: [] };
}

describe('projectToGrid', () => {
  const grid = gridOf([CENTER, E, W, FAR]);
  const cells: HeatCell[] = [
    { gh: CENTER, aff: 0.7, rank: 0.2, pop: null }, // own cell (pop is null → falls through to children)
    { gh: `${CENTER}b`, aff: 0.1, rank: 0.1, pop: 0.6 },
    { gh: `${CENTER}c`, aff: 0.3, rank: 0.1, pop: 0.8 },
    { gh: `${E}0`, aff: 0.2, rank: 0.5, pop: 0.3 }, // gh7 children only
    { gh: `${E}h`, aff: 0.4, rank: null, pop: 0.5 },
    { gh: `${E}z`, aff: null, rank: 0.9, pop: 0.4 },
    { gh: W.slice(0, 5), aff: 0.55, rank: 0.35, pop: 0.45 }, // gh5 parent only
  ];

  it('uses own cell → mean of gh7 children → gh5 parent → NA', () => {
    expect(FAR.slice(0, 5)).not.toBe(W.slice(0, 5));
    const p = projectToGrid(cells, grid, 'aff');
    expect(p.values[0]).toBe(0.7); // own cell wins over its children
    expect(p.values[1]).toBeCloseTo(0.3, 12); // mean of children with a value (null child ignored)
    expect(p.values[2]).toBe(0.55); // parent fallback
    expect(p.values[3]).toBeNaN();
    expect(p.covered).toBe(3);
    expect(p.coverage).toBe(0.75);
    expect(p.sources).toEqual({ exact: 1, children: 1, parent: 1 });
  });

  it('treats a null metric as absent, per metric', () => {
    const pop = projectToGrid(cells, grid, 'pop');
    expect(pop.values[0]).toBeCloseTo(0.7, 12); // own pop is null → children 0.6 and 0.8
    expect(pop.sources).toEqual({ exact: 0, children: 2, parent: 1 });
    const rank = projectToGrid(cells, grid, 'rank');
    expect(rank.values[0]).toBe(0.2);
    expect(rank.values[1]).toBeCloseTo(0.7, 12); // 0.5 and 0.9 (null child ignored)
  });

  it('does not depend on the order of cells and averages duplicates', () => {
    const forward = projectToGrid(cells, grid, 'aff').values;
    const reversed = projectToGrid([...cells].reverse(), grid, 'aff').values;
    expect(Array.from(reversed)).toEqual(Array.from(forward));

    const dup = projectToGrid(
      [
        { gh: CENTER.toUpperCase(), aff: 0.2, rank: null, pop: null },
        { gh: CENTER, aff: 0.4, rank: null, pop: null },
      ],
      grid,
      'aff',
    );
    expect(dup.values[0]).toBeCloseTo(0.3, 12);
    expect(dup.covered).toBe(1);
  });

  it('returns all-NA for an empty response', () => {
    const p = projectToGrid([], grid, 'aff');
    expect(p.covered).toBe(0);
    expect(p.coverage).toBe(0);
    expect(Array.from(p.values).every(Number.isNaN)).toBe(true);
  });
});

describe('grid neighbours', () => {
  const block = [NW, N, NE, W, CENTER, E, SW, S, SE];
  const grid = gridOf(block);

  function neighboursOf(g: number): number[] {
    const { offsets, indices } = gridNeighbors(grid);
    return Array.from(indices.subarray(offsets[g]!, offsets[g + 1]!)).sort((a, b) => a - b);
  }

  it('keeps only N8 neighbours inside G', () => {
    expect(neighboursOf(4)).toEqual([0, 1, 2, 3, 5, 6, 7, 8]);
    expect(neighboursOf(0)).toEqual([1, 3, 4]); // NW corner
    expect(neighboursOf(1)).toEqual([0, 2, 3, 4, 5]); // N edge
    for (let i = 0; i < block.length; i++) for (const j of neighboursOf(i)) expect(neighboursOf(j)).toContain(i);
  });

  it('caches per grid object', () => {
    expect(gridNeighbors(grid)).toBe(gridNeighbors(grid));
    expect(gridIndex(grid)).toBe(gridIndex(grid));
    expect(gridIndex(grid).get(CENTER)).toBe(4);
    expect(gridNeighbors(gridOf(block))).not.toBe(gridNeighbors(grid));
  });
});
