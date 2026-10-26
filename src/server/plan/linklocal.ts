import 'server-only';
import type { Kiosk, PlannedScreen, PricingAssumptions } from '@/shared/types';
import { impressionsPerWeek } from './assumptions';

/** LinkNYC's free LinkLocal program shows an eligible small business's ads on six screens at a time. */
export const LINKLOCAL_SCREENS = 6;
/** Two free screens on the same block would reach the same people. */
export const LINKLOCAL_MIN_SPACING_M = 150;

export interface LinkLocalInput {
  kiosks: readonly Kiosk[];
  /** Fit percentile per kiosk index; -1 when not scored. */
  kioskFit: readonly number[];
  /** Top neighborhoods in rank order (the ones with ads). */
  topNtas: readonly string[];
  assumptions: PricingAssumptions;
  count?: number;
}

const EARTH_M = 6_371_000;
function distanceM(a: Pick<Kiosk, 'lat' | 'lon'>, b: Pick<Kiosk, 'lat' | 'lon'>): number {
  const rad = Math.PI / 180;
  const x = (b.lon - a.lon) * rad * Math.cos(((a.lat + b.lat) / 2) * rad);
  const y = (b.lat - a.lat) * rad;
  return Math.hypot(x, y) * EARTH_M;
}

/**
 * The best free screens for an owner who qualifies for LinkLocal: the highest-fit screens of the top
 * neighborhoods, taken round-robin so every top neighborhood gets one before any gets two, never two on
 * the same block. Deterministic; cost is zero and impressions are the usual ASSUMPTION.
 */
export function linkLocalPicks(input: LinkLocalInput): PlannedScreen[] {
  const count = input.count ?? LINKLOCAL_SCREENS;
  const fit = (k: Kiosk) => input.kioskFit[k.i] ?? -1;
  const queues = input.topNtas.map((nta) =>
    input.kiosks
      .filter((k) => k.nta === nta && fit(k) >= 0)
      .sort((a, b) => fit(b) - fit(a) || (a.siteId < b.siteId ? -1 : a.siteId > b.siteId ? 1 : a.i - b.i)),
  );
  const picked: Kiosk[] = [];
  const spaced = (k: Kiosk) => picked.every((p) => distanceM(p, k) >= LINKLOCAL_MIN_SPACING_M);
  for (let round = true; round && picked.length < count; ) {
    round = false;
    for (const queue of queues) {
      if (picked.length >= count) break;
      const at = queue.findIndex(spaced);
      if (at === -1) continue;
      picked.push(queue.splice(at, 1)[0]!);
      round = true;
    }
  }
  return picked.map((k) => ({
    i: k.i,
    siteId: k.siteId,
    nta: k.nta,
    fit: fit(k),
    weeklyImpressions: impressionsPerWeek(k.boro, input.assumptions),
    cost: 0,
  }));
}
