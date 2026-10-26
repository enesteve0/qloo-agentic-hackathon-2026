import { NextResponse } from 'next/server';
import { z } from 'zod';
import { presetBySlug, type Preset } from '@/content/presets';
import { createRunDeps } from '@/server/agent/deps-live';
import { executeRun, newRunState } from '@/server/agent/orchestrator';
import { getEnv } from '@/server/env';
import { isAdmin } from '@/server/guard/admin';
import { newRunId, savePreset, saveRun } from '@/server/store/runs';
import type { ResolutionChoice, ResolutionIssue, RunState } from '@/shared/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 150;

const bodySchema = z.object({ slug: z.string().max(40) });

/** For the recording only: answer the picker the way the preset intends (its search hint), else the first match. */
function presetChoices(preset: Preset, issues: ResolutionIssue[]): ResolutionChoice[] {
  return issues.map((issue) => {
    const hint = preset.anchors.find((a) => a.name.toLowerCase() === issue.input.toLowerCase())?.searchHint?.toLowerCase();
    const hinted = hint
      ? issue.candidates.find((c) => `${c.disambiguation ?? ''} ${c.year ?? ''}`.toLowerCase().includes(hint))
      : undefined;
    return { input: issue.input, entityId: (hinted ?? issue.candidates[0])?.id ?? null };
  });
}

/**
 * Records a preset: runs its brief through the live pipeline once and stores the result privately as a
 * RECORDED run (never in the repository). Bearer ADMIN_TOKEN only.
 */
export async function POST(req: Request) {
  if (!isAdmin(req)) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  const preset = parsed.success ? presetBySlug(parsed.data.slug) : undefined;
  if (!preset) return NextResponse.json({ error: 'Unknown preset' }, { status: 400 });

  const env = getEnv();
  const deps = createRunDeps({ qloo: env.QLOO_MODE, llm: env.LLM_MODE, country: 'US' });
  const persist = async (s: RunState) => saveRun(s);
  let state = newRunState({ id: newRunId(), brief: preset.brief, mode: deps.mode, presetSlug: preset.slug, now: new Date() });
  const asked: ResolutionIssue[] = [];
  state = await executeRun(state, () => {}, deps, { country: 'US', persist });
  if (state.status === 'awaiting_input') {
    const issues = state.resolution?.issues ?? [];
    asked.push(...issues);
    state = await executeRun(state, () => {}, deps, { country: 'US', choices: presetChoices(preset, issues), persist });
  }
  if (state.status !== 'done') {
    return NextResponse.json({ ok: false, runId: state.id, status: state.status, error: state.error }, { status: 502 });
  }

  const model = state.llm.via.filter((v) => v !== 'rules' && v !== 'template').at(-1) ?? null;
  const recorded: RunState = {
    ...state,
    label: state.mode === 'mock' ? { kind: 'synthetic' } : { kind: 'recorded', at: state.updatedAt, model, qlooCalls: state.qlooCalls.fresh + state.qlooCalls.cached },
  };
  await savePreset(preset.slug, recorded);
  return NextResponse.json({
    ok: true,
    slug: preset.slug,
    runId: state.id,
    label: recorded.label,
    asked: asked.map((i) => i.input),
    anchors: state.resolution?.outcomes.map((o) => ({ input: o.input, status: o.status, name: o.status === 'resolved' ? o.selected.name : null })),
    top: state.where?.ntas.slice(0, 5).map((n) => ({ nta: n.short, multiplier: n.multiplier, confidence: n.confidence })),
    plan: state.plan?.totals,
    qlooCalls: state.qlooCalls,
    llm: state.llm,
  });
}
