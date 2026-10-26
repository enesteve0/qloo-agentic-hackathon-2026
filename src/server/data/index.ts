import 'server-only';
import type { Kiosk, NtaInfo } from '@/shared/types';
import grid from '@/data/grid-gh6.json';
import kiosksJson from '@/data/kiosks.json';
import meta from '@/data/meta.json';
import ntasJson from '@/data/nta2020.json';
import study from '@/data/study.json';

/** Geohash-6 analysis grid built by scripts/build-geo.ts (see docs/ARCHITECTURE.md §3). */
export interface GridSpec {
  precision: 6;
  cells: string[];
  ntaWeights: Record<string, [cellIndex: number, weight: number][]>;
  kioskCell: number[];
}

export const kiosks = kiosksJson as Kiosk[];
export const ntas = ntasJson as NtaInfo[];
export const gridSpec = grid as unknown as GridSpec;
export const dataMeta = meta;

const ntaByCode = new Map(ntas.map((n) => [n.code, n]));

export function getNta(code: string): NtaInfo | undefined {
  return ntaByCode.get(code);
}

/** Residential neighborhoods with at least two ad-capable screens — the ones Stoop can plan. */
export const eligibleNtas: NtaInfo[] = ntas.filter((n) => n.residential && n.adKiosks >= 2);

/** NYC study area for heatmap requests (MULTIPOLYGON of simplified boroughs, lon-lat). */
export const nycStudyWkt: string = study.study;
/** Convex-hull fallback POLYGON if a MULTIPOLYGON filter is rejected during calibration. */
export const nycHullWkt: string = study.hull;
