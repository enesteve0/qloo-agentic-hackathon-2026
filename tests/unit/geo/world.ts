/**
 * Synthetic NYC-like test world for the lift engine: real gh6 cells over a Brooklyn/Manhattan bbox,
 * 12 rectangular fake NTAs (4 rows × 3 columns, row 0 = north), fake kiosks, a density surface D
 * and seeded heatmaps `aff = pctl(0.9·z(D) + 0.4·z(T) + ε)`, `pop = pctl(z(D) + η)`, `rank = pctl(z(T) + ν)`.
 * Everything is deterministic (mulberry32 PRNG); no network, no src/data imports.
 */
import ngeohash from 'ngeohash';
import type { HeatCell, HeatmapData, Kiosk, NtaInfo } from '@/shared/types';
import type { GridSpec } from '@/server/geo/types';

export const BBOX = { minLat: 40.6, minLon: -74.04, maxLat: 40.8, maxLon: -73.86 } as const;
const ROWS = 4;
const COLS = 3;
const COS_LAT = Math.cos((40.7 * Math.PI) / 180);

/** Taste bumps for anchor A and anchor B sit in sparse, low-density neighborhoods. */
export const PLANTED_A = ['T20', 'T32'] as const;
export const PLANTED_B = ['T22', 'T30'] as const;
/** Non-residential (ineligible) and single-kiosk (ineligible) neighborhoods. */
export const NON_RESIDENTIAL = 'T10';
export const ONE_KIOSK = 'T12';
/** Precision mix like Qloo's: gh7 children in "Manhattan", gh5 parents on "Staten Island". */
export const P7_NTA = 'T00';
export const P5_NTA = 'T31';

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function gaussian(rng: () => number): number {
  const u = 1 - rng();
  const v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

export interface World {
  grid: GridSpec;
  ntas: NtaInfo[];
  kiosks: Kiosk[];
  /** Cell centre [lat, lon] per grid cell. */
  centers: [number, number][];
  /** NTA code per grid cell (null for the orphan kiosk cell). */
  cellNta: (string | null)[];
  /** Index of the extra kiosk cell that no heatmap covers. */
  orphan: number;
  ntaCenter: Record<string, [number, number]>;
  /** Density score z(D) per cell: standardized uniform rank of closeness to the dense core. */
  zD: Float64Array;
}

function distance(a: [number, number], b: [number, number]): number {
  return Math.hypot(a[0] - b[0], (a[1] - b[1]) * COS_LAT);
}

/** Uniform rank scores with unit variance (no flat tails, so tiny noise barely reorders). */
function uniformScores(values: number[]): Float64Array {
  const order = values.map((_, i) => i).sort((a, b) => values[a]! - values[b]! || a - b);
  const out = new Float64Array(values.length);
  order.forEach((i, r) => {
    out[i] = ((r + 0.5) / values.length - 0.5) * Math.sqrt(12);
  });
  return out;
}

function standardize(values: Float64Array): Float64Array {
  const n = values.length;
  const mean = values.reduce((s, v) => s + v, 0) / n;
  const sd = Math.sqrt(values.reduce((s, v) => s + (v - mean) ** 2, 0) / n);
  return values.map((v) => (v - mean) / sd);
}

/** Percentile (0–1, 4 decimals like Qloo's values) of each entry among `values`. */
export function pctl(values: number[]): number[] {
  const order = values.map((_, i) => i).sort((a, b) => values[a]! - values[b]! || a - b);
  const out = new Array<number>(values.length);
  order.forEach((i, r) => {
    out[i] = Math.round(((r + 0.5) / values.length) * 1e4) / 1e4;
  });
  return out;
}

export function buildWorld(bbox: { minLat: number; minLon: number; maxLat: number; maxLon: number } = BBOX): World {
  const main = ngeohash.bboxes(bbox.minLat, bbox.minLon, bbox.maxLat, bbox.maxLon, 6).sort();
  const orphanGh = ngeohash.encode(40.92, -73.7, 6);
  const cells = [...main, orphanGh];
  const centers = cells.map((gh): [number, number] => {
    const { latitude, longitude } = ngeohash.decode(gh);
    return [latitude, longitude];
  });

  const cellNta = cells.map((_, i) => {
    if (i === main.length) return null;
    const [lat, lon] = centers[i]!;
    const row = Math.min(ROWS - 1, Math.max(0, Math.floor(((bbox.maxLat - lat) / (bbox.maxLat - bbox.minLat)) * ROWS)));
    const col = Math.min(COLS - 1, Math.max(0, Math.floor(((lon - bbox.minLon) / (bbox.maxLon - bbox.minLon)) * COLS)));
    return `T${row}${col}`;
  });

  const codes: string[] = [];
  for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) codes.push(`T${r}${c}`);

  // Fractional land weights so n_eff differs from the raw cell count.
  const rng = mulberry32(7);
  const ntaWeights: GridSpec['ntaWeights'] = Object.fromEntries(codes.map((c) => [c, []]));
  cellNta.forEach((code, i) => {
    if (code) ntaWeights[code]!.push([i, Math.round((0.5 + 0.5 * rng()) * 1000) / 1000]);
  });

  const ntaCenter: Record<string, [number, number]> = {};
  for (const code of codes) {
    const members = ntaWeights[code]!.map(([i]) => centers[i]!);
    ntaCenter[code] = [
      members.reduce((s, p) => s + p[0], 0) / members.length,
      members.reduce((s, p) => s + p[1], 0) / members.length,
    ];
  }

  // Density: a dense core in the north (T01) plus a broad secondary centre (T11).
  const core = ntaCenter.T01!;
  const second = ntaCenter.T11!;
  const bump = (p: [number, number], c: [number, number], sigma: number) => Math.exp(-(distance(p, c) ** 2) / (2 * sigma ** 2));
  const D = centers.map((p) => bump(p, core, 0.05) + 0.5 * bump(p, second, 0.08));
  const zD = uniformScores(D);

  // Kiosks: 3 per NTA (1 in ONE_KIOSK) on cells near the NTA centre, plus one in the orphan cell.
  const kiosks: Kiosk[] = [];
  const kioskCell: number[] = [];
  const boroOf = (code: string) => ['Manhattan', 'Brooklyn', 'Queens', 'Staten Island'][Number(code[1])]!;
  const addKiosk = (cell: number, nta: string, reassigned: boolean) => {
    const i = kiosks.length;
    const [lat, lon] = centers[cell]!;
    kiosks.push({
      i,
      siteId: `TEST-${i}`,
      lat,
      lon,
      type: 'LINK5G_AD',
      boro: boroOf(nta),
      address: `${i} Test Avenue`,
      cross1: null,
      cross2: null,
      nta,
      gh6: cells[cell]!,
      ntaReassigned: reassigned,
    });
    kioskCell.push(cell);
  };
  for (const code of codes) {
    const centre = ntaCenter[code]!;
    const byDistance = ntaWeights[code]!.map(([i]) => i).sort((a, b) => distance(centers[a]!, centre) - distance(centers[b]!, centre) || a - b);
    const picks = code === ONE_KIOSK ? [0] : [0, 4, 9];
    for (const p of picks) addKiosk(byDistance[p]!, code, false);
  }
  addKiosk(main.length, 'T02', true);

  const ntas: NtaInfo[] = codes.map((code) => {
    const members = ntaWeights[code]!.map(([i]) => centers[i]!);
    const lats = members.map((p) => p[0]);
    const lons = members.map((p) => p[1]);
    return {
      code,
      name: `Test ${code}`,
      short: code,
      boro: boroOf(code),
      centroid: [ntaCenter[code]![1], ntaCenter[code]![0]],
      bbox: [Math.min(...lons), Math.min(...lats), Math.max(...lons), Math.max(...lats)],
      wkt: '',
      adKiosks: kiosks.filter((k) => k.nta === code && !k.ntaReassigned).length,
      residential: code !== NON_RESIDENTIAL,
    };
  });

  return {
    grid: { precision: 6, cells, ntaWeights, kioskCell },
    ntas,
    kiosks,
    centers,
    cellNta,
    orphan: main.length,
    ntaCenter,
    zD,
  };
}

/** Standardized taste surface T with a Gaussian bump on each listed NTA's centre. */
export function tasteFor(world: World, codes: readonly string[], sigma = 0.02): Float64Array {
  const T = new Float64Array(world.centers.length);
  world.centers.forEach((p, i) => {
    T[i] = codes.reduce((s, c) => s + Math.exp(-(distance(p, world.ntaCenter[c]!) ** 2) / (2 * sigma ** 2)), 0);
  });
  return standardize(T);
}

export interface MapSpec {
  seed: number;
  /** Standardized taste surface (null: density-only map). */
  taste?: Float64Array | null;
  densityWeight?: number;
  tasteWeight?: number;
  affNoise?: number;
  popNoise?: number;
  rankNoise?: number;
  /** Emit gh7 children in P7_NTA and gh5 parents in P5_NTA instead of gh6 cells. */
  mixPrecision?: boolean;
  /** Restrict coverage to these cells (the orphan cell is never covered). */
  keep?: (cell: number) => boolean;
}

/** A synthetic Qloo heatmap response over the world. */
export function makeHeatmap(world: World, spec: MapSpec): HeatmapData {
  const { taste = null, densityWeight = 0.9, tasteWeight = 0.4, affNoise = 0.35, popNoise = 0.15, rankNoise = 0.15 } = spec;
  const rng = mulberry32(spec.seed);
  const n = world.centers.length;
  // Draw noise for every cell in a fixed order so coverage choices never change a cell's noise.
  const eps = Array.from({ length: n }, () => [gaussian(rng), gaussian(rng), gaussian(rng)] as const);
  const kept = world.cellNta.flatMap((code, i) => (code !== null && (spec.keep?.(i) ?? true) ? [i] : []));

  const x = kept.map((i) => densityWeight * world.zD[i]! + (taste ? tasteWeight * taste[i]! : 0) + affNoise * eps[i]![0]);
  const aff = pctl(x);
  const pop = pctl(kept.map((i) => world.zD[i]! + popNoise * eps[i]![1]));
  const rank = taste ? pctl(kept.map((i) => taste[i]! + rankNoise * eps[i]![2])) : aff;

  const cells: HeatCell[] = [];
  const parents = new Map<string, { aff: number; rank: number; pop: number; n: number }>();
  kept.forEach((i, k) => {
    const gh = world.grid.cells[i]!;
    const v = { aff: aff[k]!, rank: rank[k]!, pop: pop[k]! };
    const code = world.cellNta[i];
    if (spec.mixPrecision && code === P7_NTA) {
      const d = 0.0004;
      cells.push({ gh: `${gh}k`, aff: v.aff + d, rank: v.rank + d, pop: v.pop + d });
      cells.push({ gh: `${gh}s`, aff: v.aff - d, rank: v.rank - d, pop: v.pop - d });
    } else if (spec.mixPrecision && code === P5_NTA) {
      const key = gh.slice(0, 5);
      const acc = parents.get(key) ?? { aff: 0, rank: 0, pop: 0, n: 0 };
      parents.set(key, { aff: acc.aff + v.aff, rank: acc.rank + v.rank, pop: acc.pop + v.pop, n: acc.n + 1 });
    } else {
      cells.push({ gh, ...v });
    }
  });
  for (const [gh, acc] of parents) cells.push({ gh, aff: acc.aff / acc.n, rank: acc.rank / acc.n, pop: acc.pop / acc.n });
  return { cells, locality: null };
}
