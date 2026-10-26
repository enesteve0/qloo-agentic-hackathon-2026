import 'server-only';
import { Redis } from '@upstash/redis';
import { getEnv } from './env';

export interface SetOptions {
  /** Expiry in milliseconds. */
  px?: number;
  /** Only set when the key does not exist. */
  nx?: boolean;
}

/** The small key-value surface Stoop needs; implemented by Upstash Redis and an in-memory map. */
export interface KV {
  get<T>(key: string): Promise<T | null>;
  mget<T>(keys: string[]): Promise<(T | null)[]>;
  /** Returns true when the value was written (false when `nx` blocked it). */
  set(key: string, value: unknown, opts?: SetOptions): Promise<boolean>;
  del(keys: string[]): Promise<number>;
  incrby(key: string, by: number, ttlMs?: number): Promise<number>;
  /** Remaining time to live in ms; -1 when the key has no expiry, -2 when it does not exist. */
  pttl(key: string): Promise<number>;
}

class UpstashKV implements KV {
  constructor(
    private readonly redis: Redis,
    private readonly prefix: string,
  ) {}
  private k(key: string) {
    return this.prefix + key;
  }
  async get<T>(key: string) {
    return (await this.redis.get<T>(this.k(key))) ?? null;
  }
  async mget<T>(keys: string[]) {
    if (keys.length === 0) return [];
    return this.redis.mget<(T | null)[]>(...keys.map((k) => this.k(k)));
  }
  async set(key: string, value: unknown, opts: SetOptions = {}) {
    const res = opts.nx
      ? opts.px
        ? await this.redis.set(this.k(key), value, { px: opts.px, nx: true })
        : await this.redis.set(this.k(key), value, { nx: true })
      : opts.px
        ? await this.redis.set(this.k(key), value, { px: opts.px })
        : await this.redis.set(this.k(key), value);
    return res === 'OK';
  }
  async del(keys: string[]) {
    if (keys.length === 0) return 0;
    return this.redis.del(...keys.map((k) => this.k(k)));
  }
  async incrby(key: string, by: number, ttlMs?: number) {
    const full = this.k(key);
    const value = await this.redis.incrby(full, by);
    if (ttlMs && value === by) await this.redis.pexpire(full, ttlMs);
    return value;
  }
  async pttl(key: string) {
    return this.redis.pttl(this.k(key));
  }
}

interface Entry {
  value: unknown;
  expiresAt: number | null;
}

/** In-memory driver for tests, CI and local mock mode. Values are cloned to mimic serialization. */
export class MemoryKV implements KV {
  private readonly store = new Map<string, Entry>();
  constructor(private readonly now: () => number = () => Date.now()) {}

  private live(key: string): Entry | undefined {
    const entry = this.store.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt !== null && entry.expiresAt <= this.now()) {
      this.store.delete(key);
      return undefined;
    }
    return entry;
  }
  async get<T>(key: string) {
    const entry = this.live(key);
    return entry ? (structuredClone(entry.value) as T) : null;
  }
  async mget<T>(keys: string[]) {
    return Promise.all(keys.map((k) => this.get<T>(k)));
  }
  async set(key: string, value: unknown, opts: SetOptions = {}) {
    if (opts.nx && this.live(key)) return false;
    this.store.set(key, { value: structuredClone(value), expiresAt: opts.px ? this.now() + opts.px : null });
    return true;
  }
  async del(keys: string[]) {
    let n = 0;
    for (const k of keys) if (this.store.delete(k)) n++;
    return n;
  }
  async incrby(key: string, by: number, ttlMs?: number) {
    const entry = this.live(key);
    const next = (typeof entry?.value === 'number' ? entry.value : 0) + by;
    const expiresAt = entry ? entry.expiresAt : ttlMs ? this.now() + ttlMs : null;
    this.store.set(key, { value: next, expiresAt });
    return next;
  }
  async pttl(key: string) {
    const entry = this.live(key);
    if (!entry) return -2;
    return entry.expiresAt === null ? -1 : entry.expiresAt - this.now();
  }
}

let instance: KV | undefined;

/** Process-wide KV client chosen from the environment (Upstash when configured, else memory). */
export function kv(): KV {
  if (instance) return instance;
  const env = getEnv();
  if (env.redisDriver === 'upstash') {
    const url = env.UPSTASH_REDIS_REST_URL ?? env.KV_REST_API_URL;
    const token = env.UPSTASH_REDIS_REST_TOKEN ?? env.KV_REST_API_TOKEN;
    if (!url || !token) throw new Error('REDIS_DRIVER=upstash but no Upstash URL/token is configured');
    instance = new UpstashKV(new Redis({ url, token }), env.REDIS_PREFIX);
  } else {
    // Next.js loads route handlers and pages as separate module instances in one process; keep a single
    // in-memory store on globalThis so a run saved by the API is visible to the page that renders it.
    const g = globalThis as typeof globalThis & { __stoopMemoryKv?: MemoryKV };
    instance = g.__stoopMemoryKv ??= new MemoryKV();
  }
  return instance;
}

/** Test helper: replace the process-wide KV (e.g. with a MemoryKV using a fake clock). */
export function setKvForTests(next: KV | undefined): void {
  instance = next;
}
