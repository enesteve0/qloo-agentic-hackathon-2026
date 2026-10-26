import 'server-only';
import type { KV } from '@/server/kv';

/**
 * Pacing (ARCHITECTURE §4 step 4). Qloo allows ~5 requests/second per key. Each run sends at most 2
 * requests at a time with starts ≥500 ms apart, and at most QLOO_RUN_SLOTS runs hold a slot at once,
 * so the whole deployment stays ≤4 req/s without a central queue.
 */

export type SleepFn = (ms: number, signal?: AbortSignal) => Promise<void>;

export function abortReason(signal: AbortSignal | undefined): unknown {
  return signal?.reason ?? new DOMException('The operation was aborted', 'AbortError');
}

/** setTimeout-based sleep that rejects with the signal's reason when aborted. */
export const defaultSleep: SleepFn = (ms, signal) =>
  new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortReason(signal));
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      reject(abortReason(signal));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, Math.max(0, ms));
    signal?.addEventListener('abort', onAbort, { once: true });
  });

export interface RunLimiterOptions {
  maxInFlight: number;
  minGapMs: number;
  now: () => number;
  sleep: SleepFn;
}

/** FIFO gate: ≤maxInFlight concurrent requests and ≥minGapMs between request starts. */
export class RunLimiter {
  private inFlight = 0;
  private lastStart = Number.NEGATIVE_INFINITY;
  private tail: Promise<void> = Promise.resolve();
  private readonly waiters: (() => void)[] = [];

  constructor(private readonly o: RunLimiterOptions) {}

  /** Resolves with a release function once this request may start. */
  acquire(signal?: AbortSignal): Promise<() => void> {
    const turn = this.tail.then(() => this.waitTurn(signal));
    // A cancelled waiter must not block the queue behind it.
    this.tail = turn.then(
      () => undefined,
      () => undefined,
    );
    return turn.then(() => this.releaser());
  }

  get active(): number {
    return this.inFlight;
  }

  private async waitTurn(signal?: AbortSignal): Promise<void> {
    while (this.inFlight >= this.o.maxInFlight) await this.waitForRelease(signal);
    const wait = this.lastStart + this.o.minGapMs - this.o.now();
    if (wait > 0) await this.o.sleep(wait, signal);
    if (signal?.aborted) throw abortReason(signal);
    this.lastStart = this.o.now();
    this.inFlight++;
  }

  private waitForRelease(signal?: AbortSignal): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      if (signal?.aborted) {
        reject(abortReason(signal));
        return;
      }
      const onAbort = () => {
        const i = this.waiters.indexOf(wake);
        if (i >= 0) this.waiters.splice(i, 1);
        reject(abortReason(signal));
      };
      const wake = () => {
        signal?.removeEventListener('abort', onAbort);
        resolve();
      };
      this.waiters.push(wake);
      signal?.addEventListener('abort', onAbort, { once: true });
    });
  }

  private releaser(): () => void {
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.inFlight--;
      this.waiters.shift()?.();
    };
  }
}

// ---------------------------------------------------------------------------------------------
// Cross-run slots in KV
// ---------------------------------------------------------------------------------------------

export const SLOT_TTL_MS = 150_000;

export function slotKey(prefix: string, n: number): string {
  return `${prefix}sem:slot:${n}`;
}

export interface SlotOptions {
  kv: KV;
  /** Namespace prefix ('' live, 'syn:' synthetic). */
  prefix: string;
  slots: number;
  runId: string;
  ttlMs?: number;
  /** How long to wait for a free slot before giving up. */
  waitMs: number;
  pollMs?: number;
  now: () => number;
  sleep: SleepFn;
  random?: () => number;
  signal?: AbortSignal;
}

/**
 * Takes one of `slots` keys with `SET sem:slot:{n} {runId} NX PX 150000`. A run that already holds a
 * slot (e.g. resumed in another invocation) gets it back. Returns the slot index or null on timeout.
 */
export async function acquireSlot(o: SlotOptions): Promise<number | null> {
  const keys = Array.from({ length: o.slots }, (_, n) => slotKey(o.prefix, n));
  const ttlMs = o.ttlMs ?? SLOT_TTL_MS;
  const pollMs = o.pollMs ?? 400;
  const random = o.random ?? Math.random;
  const giveUpAt = o.now() + o.waitMs;
  for (;;) {
    const holders = await o.kv.mget<string>(keys);
    const mine = holders.indexOf(o.runId);
    if (mine >= 0) return mine;
    for (let n = 0; n < keys.length; n++) {
      const key = keys[n];
      if (key && holders[n] == null && (await o.kv.set(key, o.runId, { nx: true, px: ttlMs }))) return n;
    }
    const left = giveUpAt - o.now();
    if (left <= 0) return null;
    await o.sleep(Math.min(left, pollMs + Math.floor(random() * pollMs * 0.5)), o.signal);
  }
}

/** Frees a slot if this run still holds it (get-then-delete; a stale slot simply expires). */
export async function releaseSlot(kv: KV, prefix: string, slot: number, runId: string): Promise<void> {
  const key = slotKey(prefix, slot);
  if ((await kv.get<string>(key)) === runId) await kv.del([key]);
}
