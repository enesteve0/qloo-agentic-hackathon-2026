import 'server-only';
import { placesForRun } from '@/components/run/places';
import { kiosks, ntas } from '@/server/data';
import { bookingEmailDraft } from '@/server/plan/export';
import type { RunExtras, RunState } from '@/shared/types';

const NTA_NAMES = Object.fromEntries(ntas.map((n) => [n.code, n.name]));

/** CSV link for a run saved under its id, or for a preset (recorded or synthetic). */
export const csvHref = (o: { runId: string } | { presetSlug: string }) =>
  'runId' in o ? `/api/export?run=${encodeURIComponent(o.runId)}` : `/api/export?preset=${encodeURIComponent(o.presetSlug)}`;

/** Street places for mockups and the plan table, plus the SEND draft, derived from a run on the server. */
export function runExtras(state: RunState, csv: string | null): RunExtras {
  const send = state.plan && state.plan.screens.length > 0 ? { ...bookingEmailDraft(state.plan, state.brief, kiosks, NTA_NAMES), csvHref: csv } : null;
  return { places: placesForRun(state), send };
}
