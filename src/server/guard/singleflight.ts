import 'server-only';
import { kv } from '../kv';

const LOCK_MS = 150_000;
const DONE_MS = 6 * 60 * 60 * 1000;

/**
 * Claims the run slot for an identical brief, or returns the run already working on it / finished.
 * `existingRunId: null` means the lock was contended and vanished twice; the caller runs without it.
 */
export async function claimBrief(hash: string, runId: string): Promise<{ claimed: true } | { claimed: false; existingRunId: string | null }> {
  const done = await kv().get<string>(`done:run:${hash}`);
  if (done) return { claimed: false, existingRunId: done };
  for (let attempt = 0; attempt < 2; attempt++) {
    if (await kv().set(`sf:run:${hash}`, runId, { nx: true, px: LOCK_MS })) return { claimed: true };
    const holder = await kv().get<string>(`sf:run:${hash}`);
    if (holder) return { claimed: false, existingRunId: holder };
  }
  return { claimed: false, existingRunId: null };
}

/** Deletes the lock only if `runId` still holds it (another run may have claimed the brief since). */
async function releaseIfHeld(hash: string, runId: string): Promise<void> {
  if ((await kv().get<string>(`sf:run:${hash}`)) === runId) await kv().del([`sf:run:${hash}`]);
}

export async function completeBrief(hash: string, runId: string): Promise<void> {
  await kv().set(`done:run:${hash}`, runId, { px: DONE_MS });
  await releaseIfHeld(hash, runId);
}

export async function releaseBrief(hash: string, runId: string): Promise<void> {
  await releaseIfHeld(hash, runId);
}
