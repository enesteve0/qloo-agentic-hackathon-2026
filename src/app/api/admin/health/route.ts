import { NextResponse } from 'next/server';
import { PRESETS } from '@/content/presets';
import { loadCalibration } from '@/server/agent/deps-live';
import { dataMeta } from '@/server/data';
import { getEnv } from '@/server/env';
import { isAdmin } from '@/server/guard/admin';
import { getLlmStatus } from '@/server/llm/gateway';
import { getQlooClient } from '@/server/qloo';
import { loadPreset } from '@/server/store/runs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Operator view: quota ledger, model slots, calibration and recorded presets. Never returns keys. */
export async function GET(req: Request) {
  if (!isAdmin(req)) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const env = getEnv();
  const [ledger, llm, calibration, presets] = await Promise.all([
    getQlooClient()
      .ledger()
      .catch((e: unknown) => ({ error: e instanceof Error ? e.message : 'ledger unavailable' })),
    getLlmStatus(),
    loadCalibration(),
    Promise.all(
      PRESETS.map(async (p) => {
        const run = await loadPreset(p.slug);
        return { slug: p.slug, recorded: Boolean(run), label: run?.label ?? null, top: run?.where?.ntas.slice(0, 3).map((n) => n.short) ?? [] };
      }),
    ),
  ]);
  return NextResponse.json(
    {
      modes: { qloo: env.QLOO_MODE, llm: env.LLM_MODE, redis: env.redisDriver },
      qloo: ledger,
      llm,
      calibration: { ...calibration.config, location: calibration.location, decidedAt: calibration.decidedAt },
      presets,
      data: dataMeta,
      build: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? 'local',
    },
    { headers: { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' } },
  );
}
