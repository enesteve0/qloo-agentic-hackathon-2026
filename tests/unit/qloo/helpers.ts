import { MemoryKV } from '@/server/kv';
import { createQlooClient, type CreateQlooClientOptions, type QlooEnv } from '@/server/qloo/client';
import type { QlooTransport } from '@/server/qloo/types';

/** Test environment (no process.env): event dates as in production defaults. */
export const TEST_ENV: QlooEnv = {
  QLOO_MAX_FRESH_PER_RUN: 20,
  QLOO_RUN_RPS: 2,
  QLOO_RUN_SLOTS: 2,
  QLOO_CAPS_JSON: undefined,
  EVENT_DATA_EXPIRES_AT: '2026-11-07T00:00:00Z',
  EVENT_JUDGING_START: '2026-11-02T17:00:00Z',
  EVENT_JUDGING_END: '2026-11-06T04:45:00Z',
};

/** Tue Oct 27 2026 11:00 EDT — build phase (daily cap 400, floor 6,500). */
export const BUILD_DAY = Date.parse('2026-10-27T15:00:00Z');

export interface Reply {
  status: number;
  json?: unknown;
  headers?: Record<string, string>;
  /** 'hang' waits until the request is aborted; an Error is thrown as a network failure. */
  fail?: Error | 'hang';
}

export type Script = Reply | ((path: string, query: URLSearchParams, n: number) => Reply);

/** Answers with the scripted replies in order (the last one repeats) and records every request. */
export function scripted(replies: Script[], kind: 'live' | 'mock' = 'live') {
  const calls: { path: string; query: URLSearchParams }[] = [];
  const transport: QlooTransport = {
    kind,
    fetch(path, query, signal) {
      calls.push({ path, query });
      const s = replies[Math.min(calls.length - 1, replies.length - 1)];
      if (!s) throw new Error('no scripted reply');
      const r = typeof s === 'function' ? s(path, query, calls.length) : s;
      if (r.fail === 'hang') {
        return new Promise((_, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }));
      }
      if (r.fail) return Promise.reject(r.fail);
      return Promise.resolve({ status: r.status, headers: new Headers(r.headers ?? {}), json: r.json ?? null });
    },
  };
  return { transport, calls };
}

export function monthHeaders(remaining: number, limit = 10_000, resetSec = 2_000_000): Record<string, string> {
  return {
    'x-month-ratelimit-limit': String(limit),
    'x-month-ratelimit-remaining': String(remaining),
    'x-month-ratelimit-reset': String(resetSec),
  };
}

export function secondHeaders(remaining: number, resetSec = 1, limit = 5): Record<string, string> {
  return {
    'x-second-ratelimit-limit': String(limit),
    'x-second-ratelimit-remaining': String(remaining),
    'x-second-ratelimit-reset': String(resetSec),
  };
}

export const searchBody = (...names: string[]) => ({
  results: names.map((name, i) => ({
    name,
    entity_id: `5157E7C0-0000-4000-8000-00000000000${i}`,
    types: ['urn:entity:brand'],
    popularity: 0.5,
  })),
});

export const ok = (json: unknown = searchBody('Sweetgreen'), headers: Record<string, string> = monthHeaders(9_000)): Reply => ({
  status: 200,
  json,
  headers,
});

/** A client on a fake clock: `sleep` advances time instantly and is recorded. */
export function makeClient(
  transport: QlooTransport | null,
  opts: Partial<Omit<CreateQlooClientOptions, 'transport' | 'kv'>> & { kv?: MemoryKV; start?: number } = {},
) {
  const { start, kv: sharedKv, ...rest } = opts;
  const clock = { t: start ?? BUILD_DAY };
  const sleeps: number[] = [];
  const kv = sharedKv ?? new MemoryKV(() => clock.t);
  const client = createQlooClient({
    transport,
    kv,
    env: TEST_ENV,
    now: () => clock.t,
    sleep: async (ms, signal) => {
      if (signal?.aborted) throw signal.reason;
      sleeps.push(ms);
      clock.t += ms;
    },
    random: () => 0.5,
    ...rest,
  });
  return { client, kv, clock, sleeps };
}
