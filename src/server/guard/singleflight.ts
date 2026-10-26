import 'server-only';
import { kv } from '../kv';

const LOCK_MS = 150_000;
const DONE_MS = 6 * 60 * 60 * 1000;

/** Claims the run slot for an identical brief, or returns the run already working on it / finished. */
export async function claimBrief(hash: string, runId: string): Promise<{ claimed: true } | { claimed: false; existingRunId: string }> {
  const done = await kv().get<string>(`done:run:${hash}`);
  if (done) return { claimed: false, existingRunId: done };
  const ok = await kv().set(`sf:run:${hash}`, runId, { nx: true, px: LOCK_MS });
  if (ok) return { claimed: true };
  const holder = await kv().get<string>(`sf:run:${hash}`);
  return holder ? { claimed: false, existingRunId: holder } : { claimed: true };
}

export async function completeBrief(hash: string, runId: string): Promise<void> {
  await kv().set(`done:run:${hash}`, runId, { px: DONE_MS });
  await kv().del([`sf:run:${hash}`]);
}

export async function releaseBrief(hash: string): Promise<void> {
  await kv().del([`sf:run:${hash}`]);
}
