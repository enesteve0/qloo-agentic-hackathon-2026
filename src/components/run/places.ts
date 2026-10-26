import 'server-only';
import { kiosks as KIOSKS } from '@/server/data';
import type { Kiosk, RunState } from '@/shared/types';
import type { PlaceLookup, ScreenPlace } from './types';

function toPlace(k: Kiosk): ScreenPlace {
  return { i: k.i, siteId: k.siteId, address: k.address, cross1: k.cross1, cross2: k.cross2, nta: k.nta, boro: k.boro, type: k.type };
}

/**
 * The street-screen slice a run screen needs (server only): every planned and next-best screen, plus
 * the best-fit screen of each neighborhood with ads (for mockup street plates before a plan exists).
 */
export function placesForRun(state: RunState): PlaceLookup {
  const out: PlaceLookup = {};
  const add = (i: number) => {
    const k = KIOSKS[i];
    if (k) out[i] = toPlace(k);
  };
  for (const s of state.plan?.screens ?? []) add(s.i);
  for (const s of state.plan?.nextBest ?? []) add(s.i);

  const fit = state.where?.kioskFit ?? [];
  const wanted = new Set([...state.creative.map((c) => c.nta), ...state.evidence.map((e) => e.nta)]);
  const best = new Map<string, { i: number; fit: number }>();
  for (const k of KIOSKS) {
    if (!wanted.has(k.nta)) continue;
    const f = fit[k.i] ?? -1;
    const current = best.get(k.nta);
    if (!current || f > current.fit) best.set(k.nta, { i: k.i, fit: f });
  }
  for (const { i } of best.values()) add(i);
  return out;
}
