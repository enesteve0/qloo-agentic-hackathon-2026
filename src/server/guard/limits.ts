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

async function window(key: string, limit: number, windowMs: number, now: number): Promise<{ ok: boolean; retryAfterS: number }> {
  const bucket = Math.floor(now / windowMs);
  const count = await kv().incrby(`rl:${key}:${bucket}`, 1, windowMs + 5_000);
  const retryAfterS = Math.ceil(((bucket + 1) * windowMs - now) / 1000);
  return { ok: count <= limit, retryAfterS };
}

/**
 * Admission for one live run. Per-session limits are primary; per-IP is loose because several judges
 * may share an office network. Exceeding any limit means "serve a recorded/cached result", never an error.
 */
export async function admitLiveRun(input: { sessionId: string | null; ip: string | null; now?: Date }): Promise<LimitDecision> {
  const now = input.now ?? new Date();
  const t = now.getTime();
  const env = getEnv();
  if (input.sessionId) {
    const short = await window(`sess15:${input.sessionId}`, 3, 15 * MIN, t);
    if (!short.ok) return { ok: false, reason: 'session', retryAfterS: short.retryAfterS };
    const day = await window(`sessday:${input.sessionId}`, 8, DAY, t);
    if (!day.ok) return { ok: false, reason: 'session', retryAfterS: day.retryAfterS };
  }
  if (input.ip) {
    const ipDay = await window(`ip:${input.ip}`, 25, DAY, t);
    if (!ipDay.ok) return { ok: false, reason: 'ip', retryAfterS: ipDay.retryAfterS };
  }
  const hour = await window('global:hour', env.LIVE_RUNS_PER_HOUR, HOUR, t);
  if (!hour.ok) return { ok: false, reason: 'hour', retryAfterS: hour.retryAfterS };
  const day = await window('global:day', dailyLiveRuns(now), DAY, t);
  if (!day.ok) return { ok: false, reason: 'day', retryAfterS: day.retryAfterS };
  return { ok: true, reason: null, retryAfterS: null };
}
