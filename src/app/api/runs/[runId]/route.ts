import { NextResponse } from 'next/server';
import { csvHref, runExtras } from '@/server/agent/extras';
import { loadRun, settleStale } from '@/server/store/runs';

export const dynamic = 'force-dynamic';

/**
 * A saved run (derived plan data only; raw Qloo payloads are never stored with runs), plus its street
 * places and booking draft once the plan exists, so a client that follows a run by polling gets the same
 * screen as one that streamed it.
 */
export async function GET(_req: Request, ctx: { params: Promise<{ runId: string }> }) {
  const { runId } = await ctx.params;
  const run = await loadRun(runId);
  if (!run) return NextResponse.json({ error: 'Run not found' }, { status: 404 });
  const state = settleStale(run);
  const extras = state.plan ? runExtras(state, csvHref({ runId })) : null;
  return NextResponse.json({ ...state, extras }, { headers: { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' } });
}
