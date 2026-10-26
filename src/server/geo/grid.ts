import 'server-only';
import ngeohash from 'ngeohash';
import type { HeatCell } from '@/shared/types';
import type { GridProjection, GridSpec, HeatMetric } from './types';

const indexCache = new WeakMap<GridSpec, ReadonlyMap<string, number>>();
const neighborCache = new WeakMap<GridSpec, GridNeighbors>();

/** gh6 → cell index, cached per grid object (the grid is static data loaded once per process). */
export function gridIndex(grid: GridSpec): ReadonlyMap<string, number> {
  let index = indexCache.get(grid);
  if (!index) {
    const map = new Map<string, number>();
    grid.cells.forEach((gh, i) => map.set(gh.toLowerCase(), i));
    index = map;
    indexCache.set(grid, index);
  }
  return index;
}

/** N8 neighbours of each cell that are themselves in G, in compressed-row form. */
export interface GridNeighbors {
  /** Neighbours of cell g are `indices[offsets[g]] … indices[offsets[g + 1] − 1]`. */
  offsets: Int32Array;
  indices: Int32Array;
}

/** N8 adjacency restricted to G (via ngeohash.neighbors), cached per grid object. */
export function gridNeighbors(grid: GridSpec): GridNeighbors {
  let nb = neighborCache.get(grid);
  if (!nb) {
    const index = gridIndex(grid);
    const offsets = new Int32Array(grid.cells.length + 1);
    const list: number[] = [];
    grid.cells.forEach((gh, i) => {
      for (const n of ngeohash.neighbors(gh.toLowerCase())) {
        const j = index.get(n);
        if (j !== undefined && j !== i) list.push(j);
      }
      offsets[i + 1] = list.length;
    });
    nb = { offsets, indices: Int32Array.from(list) };
    neighborCache.set(grid, nb);
  }
  return nb;
}

interface Acc {
  sum: number;
  n: number;
}

function add(map: Map<string, Acc>, key: string, v: number) {
  const acc = map.get(key);
  if (acc) {
    acc.sum += v;
    acc.n += 1;
  } else {
    map.set(key, { sum: v, n: 1 });
  }
}

/**
 * Projects one heatmap metric onto G. Qloo mixes geohash precisions 5–7 in one response, so each gh6
 * cell takes: its own cell → the mean of its gh7 children → its gh5 parent → NaN. Cells with a null
 * value for `metric` count as absent; duplicates are averaged; other precisions are ignored.
 */
export function projectToGrid(cells: readonly HeatCell[], grid: GridSpec, metric: HeatMetric): GridProjection {
  const entries: { gh: string; v: number }[] = [];
  for (const cell of cells) {
    const v = cell[metric];
    if (typeof v === 'number' && Number.isFinite(v) && typeof cell.gh === 'string') entries.push({ gh: cell.gh.toLowerCase(), v });
  }
  // Canonical order: floating-point sums (and therefore ties) never depend on the response's order.
  entries.sort((a, b) => (a.gh < b.gh ? -1 : a.gh > b.gh ? 1 : a.v - b.v));

  const exact = new Map<string, Acc>();
  const children = new Map<string, Acc>();
  const parents = new Map<string, Acc>();
  for (const { gh, v } of entries) {
    if (gh.length === 6) add(exact, gh, v);
    else if (gh.length === 7) add(children, gh.slice(0, 6), v);
    else if (gh.length === 5) add(parents, gh, v);
  }

  const values = new Float64Array(grid.cells.length);
  const sources = { exact: 0, children: 0, parent: 0 };
  let covered = 0;
  grid.cells.forEach((raw, i) => {
    const gh = raw.toLowerCase();
    const own = exact.get(gh);
    const kids = own ? undefined : children.get(gh);
    const parent = own || kids ? undefined : parents.get(gh.slice(0, 5));
    const acc = own ?? kids ?? parent;
    if (own) sources.exact++;
    else if (kids) sources.children++;
    else if (parent) sources.parent++;
    if (acc) {
      values[i] = acc.sum / acc.n;
      covered++;
    } else {
      values[i] = NaN;
    }
  });
  return { values, covered, coverage: grid.cells.length ? covered / grid.cells.length : 0, sources };
}
