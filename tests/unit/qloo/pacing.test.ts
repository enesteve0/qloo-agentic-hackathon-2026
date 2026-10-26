import { describe, expect, it } from 'vitest';
import { MemoryKV } from '@/server/kv';
import { RunLimiter, acquireSlot, defaultSleep, releaseSlot } from '@/server/qloo/pacing';

/** A fake clock whose sleep advances time after a microtask, so concurrent waiters interleave. */
function fakeTime() {
  const clock = { t: 0 };
  const sleep = async (ms: number, signal?: AbortSignal) => {
    await Promise.resolve();
    if (signal?.aborted) throw signal.reason;
    clock.t += ms;
  };
  return { clock, sleep, now: () => clock.t };
}

describe('per-run limiter', () => {
  it('spaces starts ≥500 ms apart and keeps ≤2 requests in flight', async () => {
    const { clock, sleep, now } = fakeTime();
    const limiter = new RunLimiter({ maxInFlight: 2, minGapMs: 500, now, sleep });
    const starts: number[] = [];
    const releases: (() => void)[] = [];
    const take = (i: number) =>
      limiter.acquire().then((release) => {
        starts[i] = clock.t;
        releases[i] = release;
      });
    const p0 = take(0);
    const p1 = take(1);
    const p2 = take(2);
    await Promise.all([p0, p1]);
    expect(starts).toEqual([0, 500]);
    expect(limiter.active).toBe(2);
    // The third waits for a release even though the gap has passed.
    clock.t = 5_000;
    await new Promise((r) => setTimeout(r, 5));
    expect(starts[2]).toBeUndefined();
    releases[0]?.();
    await p2;
    expect(starts[2]).toBe(5_000);
    releases[0]?.(); // releasing twice is harmless
    expect(limiter.active).toBe(2);
  });

  it('a cancelled waiter does not block the queue', async () => {
    const { sleep, now } = fakeTime();
    const limiter = new RunLimiter({ maxInFlight: 1, minGapMs: 0, now, sleep });
    const first = await limiter.acquire();
    const controller = new AbortController();
    const cancelled = limiter.acquire(controller.signal);
    const next = limiter.acquire();
    controller.abort();
    await expect(cancelled).rejects.toBeDefined();
    first();
    const release = await next;
    expect(limiter.active).toBe(1);
    release();
    expect(limiter.active).toBe(0);
  });

  it('defaultSleep resolves after the delay and rejects when aborted', async () => {
    await expect(defaultSleep(1)).resolves.toBeUndefined();
    const c = new AbortController();
    const pending = defaultSleep(10_000, c.signal);
    c.abort(new Error('stop'));
    await expect(pending).rejects.toThrow('stop');
    await expect(defaultSleep(5, c.signal)).rejects.toThrow('stop');
  });
});

describe('cross-run slots', () => {
  it('hands out QLOO_RUN_SLOTS slots, reuses a run’s own slot and frees on release or expiry', async () => {
    const { clock, sleep, now } = fakeTime();
    const kv = new MemoryKV(now);
    const take = (runId: string, waitMs = 1_000) => acquireSlot({ kv, prefix: '', slots: 2, runId, waitMs, now, sleep, random: () => 0 });

    expect(await take('a')).toBe(0);
    expect(await take('b')).toBe(1);
    expect(await kv.get('sem:slot:0')).toBe('a');
    expect(await kv.pttl('sem:slot:1')).toBe(150_000);
    expect(await take('a')).toBe(0); // a resumed run gets its slot back
    const before = clock.t;
    expect(await take('c')).toBeNull();
    expect(clock.t - before).toBeGreaterThanOrEqual(1_000);

    await releaseSlot(kv, '', 1, 'not-b'); // only the holder can release
    expect(await kv.get('sem:slot:1')).toBe('b');
    await releaseSlot(kv, '', 1, 'b');
    expect(await take('c')).toBe(1);

    clock.t += 150_001; // a crashed run's slot expires on its own
    expect(await take('d')).toBe(0);
  });

  it('uses the namespace prefix', async () => {
    const { sleep, now } = fakeTime();
    const kv = new MemoryKV(now);
    expect(await acquireSlot({ kv, prefix: 'syn:', slots: 1, runId: 'x', waitMs: 0, now, sleep })).toBe(0);
    expect(await kv.get('syn:sem:slot:0')).toBe('x');
  });
});
