import 'server-only';
import { placesForRun } from '@/components/run/places';
import { kiosks, ntas } from '@/server/data';
import { DEFAULT_ASSUMPTIONS } from '@/server/plan/assumptions';
import { bookingEmailDraft } from '@/server/plan/export';
import { linkLocalPicks } from '@/server/plan/linklocal';
import type { RunExtras, RunState } from '@/shared/types';

const TOP_NTAS = 3;

const NTA_NAMES = Object.fromEntries(ntas.map((n) => [n.code, n.name]));

/** CSV link for a run saved under its id, or for a preset (recorded or synthetic). */
export const csvHref = (o: { runId: string } | { presetSlug: string }) =>
  'runId' in o ? `/api/export?run=${encodeURIComponent(o.runId)}` : `/api/export?preset=${encodeURIComponent(o.presetSlug)}`;

/** Street places for mockups and the plan table, the SEND draft and the free LinkLocal picks, derived on the server. */
export function runExtras(state: RunState, csv: string | null): RunExtras {
  const send = state.plan && state.plan.screens.length > 0 ? { ...bookingEmailDraft(state.plan, state.brief, kiosks, NTA_NAMES), csvHref: csv } : null;
  const linkLocal = state.where
    ? linkLocalPicks({
        kiosks,
        kioskFit: state.where.kioskFit,
        topNtas: state.where.ntas.slice(0, TOP_NTAS).map((n) => n.code),
        assumptions: state.plan?.assumptions ?? DEFAULT_ASSUMPTIONS,
      })
    : null;
  const places = placesForRun(state);
  for (const s of linkLocal ?? []) {
    const k = kiosks[s.i];
    if (k && !places[s.i]) places[s.i] = { i: k.i, siteId: k.siteId, address: k.address, cross1: k.cross1, cross2: k.cross2, nta: k.nta, boro: k.boro, type: k.type };
  }
  return { places, send, linkLocal };
}
