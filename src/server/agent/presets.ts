import 'server-only';
import { presetBySlug } from '@/content/presets';
import type { RunState } from '@/shared/types';
import { kv } from '../kv';
import { loadPreset, saveRun } from '../store/runs';
import { createRunDeps } from './deps-live';
import { executeRun, newRunState } from './orchestrator';

const SYNTHETIC_TTL_MS = 24 * 60 * 60 * 1000;
const inflight = new Map<string, Promise<RunState | null>>();

/** Plans a preset brief on synthetic data with the rule-based writer: no external calls, labelled SYNTHETIC. */
async function syntheticPresetRun(slug: string): Promise<RunState | null> {
  const preset = presetBySlug(slug);
  if (!preset) return null;
  const deps = createRunDeps({ qloo: 'mock', llm: 'mock', country: null });
  const persist = async () => {};
  let state = newRunState({ id: `syn${slug.replace(/[^a-z0-9]/g, '').slice(0, 9).padEnd(9, '0')}`, brief: preset.brief, mode: 'mock', presetSlug: slug, now: new Date() });
  state = await executeRun(state, () => {}, deps, { country: null, persist });
  if (state.status === 'awaiting_input') {
    const choices = (state.resolution?.issues ?? []).map((i) => ({ input: i.input, entityId: i.candidates[0]?.id ?? null }));
    state = await executeRun(state, () => {}, deps, { country: null, choices, persist });
  }
  return state.status === 'done' ? state : null;
}

/**
 * The plan behind a preset page: the recorded live run when there is one, otherwise a synthetic run of
 * the same brief (made once, kept a day).
 */
export async function presetRun(slug: string): Promise<RunState | null> {
  if (!presetBySlug(slug)) return null;
  const recorded = await loadPreset(slug);
  if (recorded) return recorded;
  const key = `presyn:${slug}`;
  const cached = await kv().get<RunState>(key);
  if (cached) return cached;
  let pending = inflight.get(slug);
  if (!pending) {
    pending = syntheticPresetRun(slug)
      .then(async (run) => {
        if (run) {
          // Also saved as a run, so /plan/<id> links to a sample plan keep working.
          await Promise.all([kv().set(key, run, { px: SYNTHETIC_TTL_MS }), saveRun(run)]);
        }
        return run;
      })
      .finally(() => inflight.delete(slug));
    inflight.set(slug, pending);
  }
  return pending;
}
