import { NextResponse } from 'next/server';
import { kiosks, ntas } from '@/server/data';
import { planToCsv } from '@/server/plan/export';
import { presetRun } from '@/server/agent/presets';
import { loadRun } from '@/server/store/runs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const NTA_NAMES = Object.fromEntries(ntas.map((n) => [n.code, n.name]));

/**
 * The screen list as CSV: `?run=<id>` or `?preset=<slug>`. Derived plan data only (public screen
 * locations, assumptions, fit index, ad variant); no Qloo identifiers, scores or evidence.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const runId = url.searchParams.get('run');
  const slug = url.searchParams.get('preset');
  const state = runId ? await loadRun(runId) : slug ? await presetRun(slug) : null;
  if (!state?.plan) return NextResponse.json({ error: 'Plan not found' }, { status: 404 });
  const csv = planToCsv(state.plan, kiosks, NTA_NAMES, state.creative);
  const name = `stoop-plan-${(slug ?? runId ?? 'plan').replace(/[^a-z0-9-]/gi, '')}.csv`;
  return new Response(`﻿${csv}`, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${name}"`,
      'Cache-Control': 'no-store',
      'X-Robots-Tag': 'noindex',
    },
  });
}
