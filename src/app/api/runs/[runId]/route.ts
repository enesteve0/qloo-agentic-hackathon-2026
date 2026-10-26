import { NextResponse } from 'next/server';
import { loadRun } from '@/server/store/runs';

export const dynamic = 'force-dynamic';

/** A saved run (derived plan data only; raw Qloo payloads are never stored with runs). */
export async function GET(_req: Request, ctx: { params: Promise<{ runId: string }> }) {
  const { runId } = await ctx.params;
  const run = await loadRun(runId);
  if (!run) return NextResponse.json({ error: 'Run not found' }, { status: 404 });
  return NextResponse.json(run, { headers: { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' } });
}
