import { NextResponse } from 'next/server';
import { dataMeta } from '@/server/data';
import { getEnv } from '@/server/env';

export const dynamic = 'force-dynamic';

/** Public health: modes and data snapshot only — never quotas, keys or internal numbers. */
export async function GET() {
  const env = getEnv();
  return NextResponse.json(
    {
      ok: true,
      qloo: env.QLOO_MODE,
      ai: env.LLM_MODE,
      data: { retrievedAt: dataMeta.retrievedAt, screens: dataMeta.counts.kiosks },
      build: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? 'local',
    },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
