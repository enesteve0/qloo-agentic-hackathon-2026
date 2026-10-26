import { createUIMessageStream, createUIMessageStreamResponse } from 'ai';
import { after, NextResponse } from 'next/server';
import { z } from 'zod';
import { presetBySlug } from '@/content/presets';
import type { RunDeps } from '@/server/agent/deps';
import { createRunDeps, liveAvailability } from '@/server/agent/deps-live';
import { GENERIC_ERROR } from '@/server/agent/errors';
import { csvHref, runExtras } from '@/server/agent/extras';
import { FALLBACK_MESSAGES, nearestPreset } from '@/server/agent/fallback';
import { executeRun, newRunState } from '@/server/agent/orchestrator';
import { presetRun } from '@/server/agent/presets';
import { getEnv } from '@/server/env';
import { briefHash, parseBrief, restrictedCategory } from '@/server/guard/brief';
import { admitLiveRun } from '@/server/guard/limits';
import { isSameOrigin } from '@/server/guard/origin';
import { newSession, readSession } from '@/server/guard/session';
import { claimBrief, completeBrief, releaseBrief } from '@/server/guard/singleflight';
import { kv } from '@/server/kv';
import { loadRun, newRunId, saveRun } from '@/server/store/runs';
import type { FallbackReason, StoopMessage, StoopPart } from '@/shared/stream';
import type { Brief, ResolutionChoice, RunState } from '@/shared/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 150;

const MAX_BODY_CHARS = 8_000;
const KEEP_ALIVE_MS = 10_000;
const RESUME_LOCK_MS = 150_000;

const bodySchema = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('start'), brief: z.unknown(), presetSlug: z.string().max(40).nullish() }),
  z.object({
    mode: z.literal('resume'),
    runId: z.string().max(40),
    choices: z.array(z.object({ input: z.string().max(200), entityId: z.string().max(200).nullable() })).max(8),
  }),
]);

interface Ctx {
  headers: Record<string, string>;
  sessionId: string;
  ip: string | null;
  country: string | null;
}

/**
 * Starts or resumes a plan and streams it as typed UI-message data parts (see src/shared/stream.ts).
 * JSON replies are reserved for problems with the request itself and for "follow this run" answers;
 * every capacity problem streams a labelled sample plan instead of an error page.
 */
export async function POST(req: Request) {
  if (!isSameOrigin(req)) return json({ error: 'Plans can only be started from the Stoop site.' }, 403);
  const raw = await req.text();
  if (raw.length > MAX_BODY_CHARS) return json({ error: 'That brief is too long.' }, 413);
  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(JSON.parse(raw));
  } catch {
    return json({ error: 'That request could not be read.' }, 400);
  }

  const known = readSession(req.headers.get('cookie'));
  const fresh = known ? null : newSession();
  const ctx: Ctx = {
    headers: { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex', ...(fresh ? { 'Set-Cookie': fresh.setCookie } : {}) },
    sessionId: known ?? fresh!.id,
    ip: clientIp(req),
    country: req.headers.get('x-vercel-ip-country'),
  };
  return body.mode === 'start' ? start(body.brief, body.presetSlug ?? null, ctx) : resume(body.runId, body.choices, ctx);
}

async function start(input: unknown, presetSlug: string | null, ctx: Ctx): Promise<Response> {
  const parsed = parseBrief(input);
  if (!parsed.ok) return json({ error: 'Please check the brief.', errors: parsed.errors }, 400, ctx.headers);
  const brief = parsed.brief;
  const restricted = restrictedCategory(brief);
  if (restricted) return json({ error: restricted.message, errors: [restricted.message], restricted: restricted.category }, 422, ctx.headers);
  const env = getEnv();
  const mode = env.QLOO_MODE === 'mock' ? 'mock' : 'live';
  const hash = await briefHash(brief, mode);
  const runId = newRunId();

  // An identical brief is either finished (serve it, no new calls) or still running (follow it).
  const claim = await claimBrief(hash, runId);
  if (!claim.claimed && claim.existingRunId) {
    const prior = await waitForRun(claim.existingRunId);
    if (prior?.status === 'done') {
      // A synthetic plan keeps its SYNTHETIC label; only a live plan becomes CACHED.
      const label = prior.mode === 'mock' ? (prior.label ?? { kind: 'synthetic' as const }) : { kind: 'cached' as const, at: prior.updatedAt };
      return snapshotResponse({ ...prior, label }, null, csvHref({ runId: prior.id }), ctx);
    }
    if (prior?.status === 'running') return json({ runId: prior.id, follow: true }, 202, ctx.headers);
  }
  const lockHash = claim.claimed ? hash : null;

  let blocked: FallbackReason | null = env.QLOO_MODE === 'off' ? 'qloo_unavailable' : await liveAvailability();
  if (!blocked && !(await admitLiveRun({ sessionId: ctx.sessionId, ip: ctx.ip })).ok) blocked = 'limits';
  if (blocked) {
    if (lockHash) await releaseBrief(lockHash, runId);
    return fallbackResponse(blocked, brief, ctx);
  }

  const slug = presetSlug && presetBySlug(presetSlug) ? presetSlug : null;
  const state = newRunState({ id: runId, brief, mode, presetSlug: slug, now: new Date() });
  await saveRun(state);
  const deps = createRunDeps({ qloo: env.QLOO_MODE, llm: env.LLM_MODE, country: ctx.country });
  return runResponse(state, { deps, hash: lockHash }, ctx);
}

async function resume(runId: string, choices: ResolutionChoice[], ctx: Ctx): Promise<Response> {
  const state = await loadRun(runId);
  if (!state) return json({ error: 'That plan has expired. Start a new one.' }, 404, ctx.headers);
  if (state.status !== 'awaiting_input') return json({ runId: state.id, follow: state.status === 'running' }, 409, ctx.headers);
  const issues = state.resolution?.issues ?? [];
  const valid = choices.every((c) => {
    const issue = issues.find((i) => i.input === c.input);
    return issue !== undefined && (c.entityId === null || issue.candidates.some((cand) => cand.id === c.entityId));
  });
  if (!valid) return json({ error: 'That answer doesn’t match this plan’s question.' }, 400, ctx.headers);
  if (!(await kv().set(`sf:resume:${state.id}`, ctx.sessionId, { nx: true, px: RESUME_LOCK_MS }))) {
    return json({ runId: state.id, follow: true }, 202, ctx.headers);
  }

  state.status = 'running';
  await saveRun(state);
  const env = getEnv();
  const deps = createRunDeps({ qloo: state.mode === 'mock' ? 'mock' : env.QLOO_MODE, llm: env.LLM_MODE, country: ctx.country });
  const hash = await briefHash(state.brief, state.mode);
  // A copy: the run mutates `state` before the stream serializes this part.
  return runResponse(state, { deps, hash, choices, before: [{ type: 'data-snapshot', data: structuredClone(state) }] }, ctx);
}

/**
 * A sample plan for a similar business: the recorded preset, or (before any recording) its cached synthetic
 * run. Never a fresh pipeline, so a visitor past a limit costs one cache read, not a run.
 */
async function fallbackResponse(reason: FallbackReason, brief: Brief, ctx: Ctx): Promise<Response> {
  const slug = nearestPreset(brief);
  const notice: StoopPart = { type: 'data-fallback', data: { reason, presetSlug: slug, message: FALLBACK_MESSAGES[reason] } };
  const sample = await presetRun(slug);
  if (!sample) return json({ error: FALLBACK_MESSAGES[reason] }, 503, ctx.headers);
  return snapshotResponse(sample, notice, csvHref({ presetSlug: slug }), ctx);
}

function snapshotResponse(state: RunState, notice: StoopPart | null, csv: string, ctx: Ctx): Response {
  const stream = createUIMessageStream<StoopMessage>({
    execute: ({ writer }) => {
      if (notice) writer.write(notice);
      writer.write({ type: 'data-snapshot', data: state });
      writer.write({ type: 'data-extras', data: runExtras(state, csv) });
      writer.write({ type: 'data-done', data: { runId: state.id, status: state.status, error: state.error } });
    },
  });
  return createUIMessageStreamResponse({ stream, headers: { ...ctx.headers, 'x-run-id': state.id } });
}

/** Capacity failures mid-run end with a labelled sample plan, like capacity problems before a run starts. */
const CAPACITY: Partial<Record<NonNullable<RunState['errorCode']>, FallbackReason>> = {
  qloo_busy: 'busy',
  qloo_quota: 'qloo_reserve',
  qloo_unavailable: 'qloo_unavailable',
};

function runResponse(
  state: RunState,
  o: { deps: RunDeps; hash: string | null; choices?: ResolutionChoice[]; before?: StoopPart[] },
  ctx: Ctx,
): Response {
  const stream = createUIMessageStream<StoopMessage>({
    execute: async ({ writer }) => {
      for (const part of o.before ?? []) writer.write(part);
      const emit = (part: StoopPart) => {
        writer.write(part);
        // Once the plan exists the screen needs street places and the booking draft (server-only data).
        if (part.type === 'data-plan') writer.write({ type: 'data-extras', data: runExtras(state, csvHref({ runId: state.id })) });
      };
      const persist = async (s: RunState) => {
        try {
          await saveRun(s);
        } catch (err) {
          console.error(`[runs] could not save run ${s.id}:`, err instanceof Error ? err.message : err);
          throw err;
        }
      };
      const task = executeRun(state, emit, o.deps, { country: ctx.country, choices: o.choices, persist }).then(async (final) => {
        if (o.hash) {
          if (final.status === 'done') await completeBrief(o.hash, final.id);
          else await releaseBrief(o.hash, final.id);
        }
        const reason = final.status === 'error' && final.errorCode ? CAPACITY[final.errorCode] : undefined;
        if (!reason) return;
        const slug = nearestPreset(final.brief);
        const sample = await presetRun(slug).catch(() => null);
        if (!sample) return;
        writer.write({ type: 'data-fallback', data: { reason, presetSlug: slug, message: FALLBACK_MESSAGES[reason] } });
        writer.write({ type: 'data-snapshot', data: sample });
        writer.write({ type: 'data-extras', data: runExtras(sample, csvHref({ presetSlug: slug })) });
        writer.write({ type: 'data-done', data: { runId: sample.id, status: sample.status, error: sample.error } });
      });
      // The run keeps going if the browser disconnects; reloads read the saved state.
      after(task.catch((err) => console.error(`[runs] run ${state.id} failed to finish:`, err instanceof Error ? err.message : err)));
      await task;
    },
    onError: () => GENERIC_ERROR,
  });
  return createUIMessageStreamResponse({ stream, headers: { ...ctx.headers, 'x-run-id': state.id }, keepAliveMs: KEEP_ALIVE_MS });
}

/** The holder of an identical brief's lock saves its run moments after claiming; wait briefly for it. */
async function waitForRun(id: string): Promise<RunState | null> {
  for (let i = 0; i < 8; i++) {
    const run = await loadRun(id);
    if (run) return run;
    await new Promise((r) => setTimeout(r, 250));
  }
  return null;
}

function json(body: unknown, status: number, headers: Record<string, string> = { 'Cache-Control': 'no-store' }): Response {
  return NextResponse.json(body, { status, headers });
}

function clientIp(req: Request): string | null {
  const real = req.headers.get('x-real-ip')?.trim();
  if (real) return real;
  return req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || null;
}
