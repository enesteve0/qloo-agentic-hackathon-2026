import { NoObjectGeneratedError, RetryError } from 'ai';
import { beforeEach, describe, expect, it } from 'vitest';
import { kv } from '@/server/kv';
import {
  classifyError,
  COOLDOWN_MS,
  countAttempt,
  LLM_KEYS,
  parseDurationMs,
  rateLimitCooldownMs,
  readChainState,
  recordSchemaFailure,
  setCooldown,
  utcDay,
} from '@/server/llm/cooldowns';
import { apiError, T0, useFakeKv } from './helpers';

const ctx = { callerAborted: false, now: T0 };

describe('parseDurationMs (Groq x-ratelimit-reset-*)', () => {
  it.each([
    ['2m59.56s', 179_560],
    ['7.66s', 7_660],
    ['120ms', 120],
    ['1h2m3s', 3_723_000],
    ['0s', 0],
    ['500us', 1],
  ])('%s → %d ms', (input, ms) => {
    expect(parseDurationMs(input)).toBe(ms);
  });

  it.each(['', '12', 'abc', '5 s', '1d', '-3s', 's'])('rejects %j', (input) => {
    expect(parseDurationMs(input)).toBeNull();
  });
});

describe('rateLimitCooldownMs', () => {
  it('prefers retry-after (seconds, ms or HTTP date)', () => {
    expect(rateLimitCooldownMs({ 'retry-after': '7' }, undefined, T0)).toBe(7_000);
    expect(rateLimitCooldownMs({ 'retry-after-ms': '2500', 'retry-after': '9' }, undefined, T0)).toBe(2_500);
    expect(rateLimitCooldownMs({ 'retry-after': new Date(T0 + 90_000).toUTCString() }, undefined, T0)).toBe(90_000);
  });

  it('uses the exhausted Groq limit when there is no retry-after', () => {
    const headers = {
      'x-ratelimit-remaining-requests': '0',
      'x-ratelimit-reset-requests': '2m59.56s',
      'x-ratelimit-remaining-tokens': '5000',
      'x-ratelimit-reset-tokens': '7.66s',
    };
    expect(rateLimitCooldownMs(headers, undefined, T0)).toBe(179_560);
    expect(rateLimitCooldownMs({ ...headers, 'x-ratelimit-remaining-requests': '10', 'x-ratelimit-remaining-tokens': '0' }, undefined, T0)).toBe(7_660);
  });

  it('takes the shorter Groq reset when it cannot tell which limit tripped', () => {
    expect(rateLimitCooldownMs({ 'x-ratelimit-reset-requests': '1h', 'x-ratelimit-reset-tokens': '120ms' }, undefined, T0)).toBe(COOLDOWN_MS.min);
  });

  it('reads OpenRouter epoch resets from headers or the error body', () => {
    expect(rateLimitCooldownMs({ 'x-ratelimit-reset': String(T0 + 45_000) }, undefined, T0)).toBe(45_000);
    const data = { error: { code: 429, message: 'Rate limit exceeded: free-models-per-day', metadata: { headers: { 'X-RateLimit-Reset': String(T0 + 3_600_000) } } } };
    expect(rateLimitCooldownMs({}, data, T0)).toBe(3_600_000);
  });

  it('defaults to 60 s and caps at 24 h', () => {
    expect(rateLimitCooldownMs(undefined, undefined, T0)).toBe(60_000);
    expect(rateLimitCooldownMs({ 'retry-after': '999999' }, undefined, T0)).toBe(COOLDOWN_MS.max);
  });
});

describe('classifyError', () => {
  it.each([
    [429, 'rate_limit', 60_000, 'model'],
    [500, 'server', COOLDOWN_MS.server, 'model'],
    [503, 'server', COOLDOWN_MS.server, 'model'],
    [401, 'auth', COOLDOWN_MS.auth, 'provider'],
    [402, 'auth', COOLDOWN_MS.auth, 'provider'],
    [403, 'auth', COOLDOWN_MS.auth, 'provider'],
    [404, 'not_found', COOLDOWN_MS.notFound, 'model'],
    [408, 'timeout', COOLDOWN_MS.timeout, 'model'],
    [200, 'error_body', COOLDOWN_MS.errorBody, 'model'],
  ] as const)('HTTP %d → %s', (status, kind, cooldownMs, scope) => {
    const cls = classifyError(apiError(status), ctx);
    expect(cls).toMatchObject({ kind, status, cooldownMs, scope, schemaFailure: false });
  });

  it('sends 400s to the schema breaker without an immediate cooldown', () => {
    expect(classifyError(apiError(400), ctx)).toMatchObject({ kind: 'bad_request', cooldownMs: null, schemaFailure: true });
  });

  it('treats network errors and our own timeouts as 30 s cooldowns', () => {
    expect(classifyError(apiError(undefined, { isRetryable: true }), ctx)).toMatchObject({ kind: 'network', cooldownMs: 30_000 });
    expect(classifyError(new DOMException('Total timeout of 12000ms exceeded', 'TimeoutError'), ctx)).toMatchObject({ kind: 'timeout', cooldownMs: 30_000 });
  });

  it('never blames the provider for a caller abort or our own bugs', () => {
    expect(classifyError(new DOMException('aborted', 'AbortError'), { ...ctx, callerAborted: true })).toMatchObject({ kind: 'aborted', cooldownMs: null });
    expect(classifyError(new TypeError('x is undefined'), ctx)).toMatchObject({ kind: 'unknown', cooldownMs: null, schemaFailure: false });
  });

  it('counts unparseable output as a schema failure and unwraps RetryError', () => {
    const noObject = new NoObjectGeneratedError({
      text: 'nope',
      response: { id: 'r', timestamp: new Date(T0), modelId: 'm' },
      usage: {
        inputTokens: 1,
        outputTokens: 1,
        totalTokens: 2,
        inputTokenDetails: { noCacheTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0 },
        outputTokenDetails: { textTokens: 1, reasoningTokens: 0 },
      },
      finishReason: 'stop',
    });
    expect(classifyError(noObject, ctx)).toMatchObject({ kind: 'invalid_output', schemaFailure: true });
    const retry = new RetryError({ message: 'failed', reason: 'maxRetriesExceeded', errors: [apiError(404)] });
    expect(classifyError(retry, ctx)).toMatchObject({ kind: 'not_found' });
  });

  it('keeps details short and free of whitespace runs', () => {
    const cls = classifyError(apiError(500, { message: `<html>\n\n${'x'.repeat(1000)}</html>` }), ctx);
    expect(cls.detail.length).toBeLessThanOrEqual(240);
    expect(cls.detail).not.toMatch(/\n/);
  });
});

describe('KV state', () => {
  let env: ReturnType<typeof useFakeKv>;
  beforeEach(() => {
    env = useFakeKv();
  });

  const slots = [{ id: 'groq', modelIds: { planner: 'a', creative: 'b' } }];

  it('reads cooldowns (model and provider scope), usage and the kill switch in one pass', async () => {
    await setCooldown('groq', 'a', { kind: 'rate_limit', status: 429, cooldownMs: 7_000, scope: 'model' }, env.now());
    await countAttempt('groq', env.now());
    await countAttempt('groq', env.now());
    await kv().set(LLM_KEYS.disabled, ['openrouter', ' sambanova ']);
    const state = await readChainState(slots, env.now());
    expect(state.cooldownMs('groq', 'a')).toBe(7_000);
    expect(state.cooldownMs('groq', 'b')).toBe(0);
    expect(state.usedToday('groq')).toBe(2);
    expect([...state.disabled]).toEqual(['openrouter', 'sambanova']);

    await setCooldown('groq', 'a', { kind: 'auth', status: 401, cooldownMs: COOLDOWN_MS.auth, scope: 'provider' }, env.now());
    const after = await readChainState(slots, env.now());
    expect(after.cooldownMs('groq', 'b')).toBe(COOLDOWN_MS.auth);
  });

  it('accepts a comma-separated kill switch and ignores junk', async () => {
    await kv().set(LLM_KEYS.disabled, 'groq, gemini');
    expect([...(await readChainState(slots, env.now())).disabled]).toEqual(['groq', 'gemini']);
    await kv().set(LLM_KEYS.disabled, { nope: true });
    expect((await readChainState(slots, env.now())).disabled.size).toBe(0);
  });

  it('expires cooldowns with the clock and never shortens a longer one', async () => {
    await setCooldown('groq', 'a', { kind: 'not_found', status: 404, cooldownMs: COOLDOWN_MS.notFound, scope: 'model' }, env.now());
    await setCooldown('groq', 'a', { kind: 'server', status: 500, cooldownMs: COOLDOWN_MS.server, scope: 'model' }, env.now());
    expect((await readChainState(slots, env.now())).cooldownMs('groq', 'a')).toBe(COOLDOWN_MS.notFound);
    env.clock.now += COOLDOWN_MS.notFound + 1;
    expect((await readChainState(slots, env.now())).cooldownMs('groq', 'a')).toBe(0);
  });

  it('trips the schema breaker on the third failure inside ten minutes', async () => {
    expect(await recordSchemaFailure('groq', 'a', env.now())).toBeNull();
    env.clock.now += 60_000;
    expect(await recordSchemaFailure('groq', 'a', env.now())).toBeNull();
    env.clock.now += 60_000;
    expect(await recordSchemaFailure('groq', 'a', env.now())).toBe(COOLDOWN_MS.schemaBreaker);
    expect((await readChainState(slots, env.now())).cooldownMs('groq', 'a')).toBe(COOLDOWN_MS.schemaBreaker);
    // The counter restarts after tripping.
    expect(await kv().get(LLM_KEYS.schemaFailures('groq', 'a'))).toBeNull();
  });

  it('forgets schema failures older than the window', async () => {
    await recordSchemaFailure('groq', 'a', env.now());
    await recordSchemaFailure('groq', 'a', env.now());
    env.clock.now += 10 * 60_000 + 1;
    expect(await recordSchemaFailure('groq', 'a', env.now())).toBeNull();
  });

  it('keys daily usage by UTC day', async () => {
    await countAttempt('groq', env.now());
    expect(await kv().get(`llm:use:groq:${utcDay(env.now())}`)).toBe(1);
    expect(utcDay(Date.parse('2026-10-26T23:59:59Z'))).toBe('2026-10-26');
    env.clock.now = Date.parse('2026-10-27T00:00:01Z');
    expect((await readChainState(slots, env.now())).usedToday('groq')).toBe(0);
  });

  it('degrades to empty state when KV is down', async () => {
    const broken = {
      get: async () => {
        throw new Error('down');
      },
      mget: async () => {
        throw new Error('down');
      },
      set: async () => {
        throw new Error('down');
      },
      del: async () => {
        throw new Error('down');
      },
      incrby: async () => {
        throw new Error('down');
      },
      pttl: async () => {
        throw new Error('down');
      },
    };
    const { setKvForTests } = await import('@/server/kv');
    setKvForTests(broken);
    const warn = console.warn;
    console.warn = () => {};
    try {
      const state = await readChainState(slots, env.now());
      expect(state.disabled.size).toBe(0);
      expect(state.cooldownMs('groq', 'a')).toBe(0);
      await expect(countAttempt('groq', env.now())).resolves.toBeUndefined();
      await expect(recordSchemaFailure('groq', 'a', env.now())).resolves.toBeNull();
      await expect(setCooldown('groq', 'a', { kind: 'server', status: 500, cooldownMs: 1_000, scope: 'model' }, env.now())).resolves.toBeUndefined();
    } finally {
      console.warn = warn;
    }
  });
});
