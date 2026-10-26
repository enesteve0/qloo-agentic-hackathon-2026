import { NextResponse } from 'next/server';
import { loadRun } from '@/server/store/runs';

export const dynamic = 'force-dynamic';

/** A run still marked running this long after its last checkpoint was cut off (the run deadline is 110 s). */
const STALE_MS = 180_000;

/** A saved run (derived plan data only; raw Qloo payloads are never stored with runs). */
export async function GET(_req: Request, ctx: { params: Promise<{ runId: string }> }) {
  const { runId } = await ctx.params;
  const run = await loadRun(runId);
  if (!run) return NextResponse.json({ error: 'Run not found' }, { status: 404 });
  const stale = run.status === 'running' && Date.now() - Date.parse(run.updatedAt) > STALE_MS;
  const body = stale ? { ...run, status: 'error' as const, error: 'This plan stopped before it finished. Start it again.' } : run;
  return NextResponse.json(body, { headers: { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' } });
}
