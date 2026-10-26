import 'server-only';
import { getEnv } from '../env';
import { kv } from '../kv';

export interface LimitDecision {
  ok: boolean;
  reason: 'session' | 'ip' | 'hour' | 'day' | null;
  retryAfterS: number | null;
}

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

/** Live-run caps per phase (ET); judging gets the largest share. Matches docs/ARCHITECTURE.md §15. */
function dailyLiveRuns(now: Date): number {
  const env = getEnv();
  const judgingStart = Date.parse(env.EVENT_JUDGING_START);
  const judgingEnd = Date.parse(env.EVENT_JUDGING_END);
  const t = now.getTime();
  if (t >= judgingStart && t <= judgingEnd) return 100;
  if (t > judgingEnd) return 10;
  return 40;
}

interface Window {
  key: string;
  limit: number;
  windowMs: number;
  reason: LimitDecision['reason'];
}

/**
 * Sliding-window counter: the current bucket plus the previous bucket weighted by how much of it still
 * overlaps the window. Fixed buckets alone would let a burst straddling a boundary through twice.
 */
async function take(w: Window, now: number): Promise<{ ok: boolean; retryAfterS: number; counted: string }> {
  const bucket = Math.floor(now / w.windowMs);
  const counted = `rl:${w.key}:${bucket}`;
  const [count, previous] = await Promise.all([
    kv().incrby(counted, 1, 2 * w.windowMs + 5_000),
    kv().get<number>(`rl:${w.key}:${bucket - 1}`),
  ]);
  const overlap = 1 - (now - bucket * w.windowMs) / w.windowMs;
  const ok = count + (previous ?? 0) * overlap <= w.limit;
  return { ok, retryAfterS: Math.ceil(((bucket + 1) * w.windowMs - now) / 1000), counted };
}

/**
 * Admission for one live run. Per-session limits are primary; per-IP is loose because several judges
 * may share an office network. Exceeding any limit means "serve a recorded/cached result", never an error.
 */
export async function admitLiveRun(input: { sessionId: string | null; ip: string | null; now?: Date }): Promise<LimitDecision> {
  const now = input.now ?? new Date();
  const t = now.getTime();
  const env = getEnv();
  const windows: Window[] = [
    ...(input.sessionId
      ? [
          { key: `sess15:${input.sessionId}`, limit: 3, windowMs: 15 * MIN, reason: 'session' as const },
          { key: `sessday:${input.sessionId}`, limit: 8, windowMs: DAY, reason: 'session' as const },
        ]
      : []),
    ...(input.ip ? [{ key: `ip:${input.ip}`, limit: 25, windowMs: DAY, reason: 'ip' as const }] : []),
    { key: 'global:hour', limit: env.LIVE_RUNS_PER_HOUR, windowMs: HOUR, reason: 'hour' },
    { key: 'global:day', limit: dailyLiveRuns(now), windowMs: DAY, reason: 'day' },
  ];
  const counted: string[] = [];
  for (const w of windows) {
    const r = await take(w, t);
    counted.push(r.counted);
    if (!r.ok) {
      // A refused attempt doesn't count against any window.
      await Promise.all(counted.map((key) => kv().incrby(key, -1).catch(() => 0)));
      return { ok: false, reason: w.reason, retryAfterS: r.retryAfterS };
    }
  }
  return { ok: true, reason: null, retryAfterS: null };
}
