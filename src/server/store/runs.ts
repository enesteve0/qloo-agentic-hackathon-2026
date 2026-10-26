import 'server-only';
import { customAlphabet } from 'nanoid';
import type { RunState } from '@/shared/types';
import { getEnv } from '../env';
import { kv } from '../kv';

const RUN_TTL_MS = 14 * 24 * 60 * 60 * 1000;
const MIN_TTL_MS = 60 * 60 * 1000;
const RUN_ID = /^[a-z0-9]{12}$/;
const PRESET_SLUG = /^[a-z0-9-]{2,40}$/;

/** URL-safe, unguessable-enough run ids (no lookalike characters). */
export const newRunId = customAlphabet('abcdefghjkmnpqrstuvwxyz23456789', 12);

export const isRunId = (id: string) => RUN_ID.test(id);
export const isPresetSlug = (slug: string) => PRESET_SLUG.test(slug);

/**
 * Runs and presets carry Qloo-derived results, so they never outlive the event's data window
 * (EVENT_DATA_EXPIRES_AT). Synthetic runs made after it keep a short life of their own.
 */
function ttlMs(max: number, now = Date.now()): number {
  const untilExpiry = Date.parse(getEnv().EVENT_DATA_EXPIRES_AT) - now;
  return Math.max(MIN_TTL_MS, Math.min(max, untilExpiry));
}

export async function saveRun(state: RunState): Promise<void> {
  await kv().set(`run:${state.id}`, state, { px: ttlMs(RUN_TTL_MS) });
}

export async function loadRun(id: string): Promise<RunState | null> {
  if (!isRunId(id)) return null;
  return kv().get<RunState>(`run:${id}`);
}

/** Presets are recorded live runs kept only in the private store (never in the repository). */
export async function savePreset(slug: string, state: RunState): Promise<void> {
  if (!isPresetSlug(slug)) throw new Error(`invalid preset slug: ${slug}`);
  await kv().set(`preset:${slug}`, state, { px: ttlMs(Number.POSITIVE_INFINITY) });
}

export async function loadPreset(slug: string): Promise<RunState | null> {
  if (!isPresetSlug(slug)) return null;
  return kv().get<RunState>(`preset:${slug}`);
}

/** A run still marked running this long after its last checkpoint was cut off (the run deadline is 110 s). */
const STALE_MS = 180_000;

/** Reports a run that stopped checkpointing mid-flight as stopped, so pages and polls don't wait forever. */
export function settleStale(run: RunState, now = Date.now()): RunState {
  if (run.status !== 'running' || now - Date.parse(run.updatedAt) <= STALE_MS) return run;
  return { ...run, status: 'error', error: 'This plan stopped before it finished. Start it again.' };
}
