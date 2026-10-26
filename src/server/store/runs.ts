import 'server-only';
import { customAlphabet } from 'nanoid';
import type { RunState } from '@/shared/types';
import { kv } from '../kv';

const RUN_TTL_MS = 14 * 24 * 60 * 60 * 1000;
const RUN_ID = /^[a-z0-9]{12}$/;
const PRESET_SLUG = /^[a-z0-9-]{2,40}$/;

/** URL-safe, unguessable-enough run ids (no lookalike characters). */
export const newRunId = customAlphabet('abcdefghjkmnpqrstuvwxyz23456789', 12);

export const isRunId = (id: string) => RUN_ID.test(id);
export const isPresetSlug = (slug: string) => PRESET_SLUG.test(slug);

export async function saveRun(state: RunState): Promise<void> {
  await kv().set(`run:${state.id}`, state, { px: RUN_TTL_MS });
}

export async function loadRun(id: string): Promise<RunState | null> {
  if (!isRunId(id)) return null;
  return kv().get<RunState>(`run:${id}`);
}

/** Presets are recorded live runs kept only in the private store (never in the repository). */
export async function savePreset(slug: string, state: RunState): Promise<void> {
  if (!isPresetSlug(slug)) throw new Error(`invalid preset slug: ${slug}`);
  await kv().set(`preset:${slug}`, state);
}

export async function loadPreset(slug: string): Promise<RunState | null> {
  if (!isPresetSlug(slug)) return null;
  return kv().get<RunState>(`preset:${slug}`);
}
