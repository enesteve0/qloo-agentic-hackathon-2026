import 'server-only';
import { PRESETS } from '@/content/presets';
import type { FallbackReason } from '@/shared/stream';
import type { Brief } from '@/shared/types';

/** Banner copy when a live run can't start. The result badge says whether the sample is recorded or synthetic. */
export const FALLBACK_MESSAGES: Record<FallbackReason, string> = {
  limits: 'You’ve used this session’s live runs for now, so here is a sample plan for a similar business. Live runs reopen in a few minutes.',
  qloo_reserve: 'Live Qloo calls are paused to protect the judging reserve, so here is a sample plan for a similar business.',
  llm_exhausted: 'Every free AI writer is busy, so here is a sample plan for a similar business.',
  busy: 'Stoop is busy with other plans, so here is a sample plan for a similar business. Try a live run again in a minute.',
  qloo_unavailable: 'Live Qloo data is switched off right now, so here is a sample plan for a similar business.',
  error: 'This plan couldn’t start, so here is a sample plan for a similar business.',
};

const STOP = new Set(
  (
    'the and with for our from that this your you are new york nyc city brooklyn manhattan queens bronx staten island ' +
    'opening open opens night nights week weeks people who love loves near local shop store place spot'
  ).split(' '),
);

function tokens(text: string): Set<string> {
  return new Set(
    text
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length > 2 && !STOP.has(w))
      .map((w) => (w.length > 4 && w.endsWith('s') ? w.slice(0, -1) : w)),
  );
}

/** The preset whose brief shares the most words with this one (the hero preset when nothing matches). */
export function nearestPreset(brief: Brief | null): string {
  const fallback = PRESETS[0]!.slug;
  if (!brief) return fallback;
  const want = tokens(`${brief.business} ${brief.description} ${brief.offer ?? ''}`);
  let best = fallback;
  let bestScore = 0;
  for (const p of PRESETS) {
    const have = tokens(`${p.title} ${p.buyer} ${p.brief.business} ${p.brief.description} ${p.brief.offer ?? ''}`);
    let score = 0;
    for (const w of want) if (have.has(w)) score += 1;
    if (score > bestScore) {
      best = p.slug;
      bestScore = score;
    }
  }
  return best;
}
