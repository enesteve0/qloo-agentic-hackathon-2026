import { beforeEach, describe, expect, it } from 'vitest';
import { kv } from '@/server/kv';
import { createChainGateway } from '@/server/llm/chain';
import { COOLDOWN_MS, LLM_KEYS, utcDay } from '@/server/llm/cooldowns';
import type { AttemptEvent, LlmKind } from '@/server/llm/gateway';
import { plannerSchema } from '@/server/llm/schemas';
import type { LlmSlot } from '@/server/llm/slots';
import { apiError, hangUntilAborted, jsonResult, mockSlot, textResult, useFakeKv, validPlan } from './helpers';

let env: ReturnType<typeof useFakeKv>;

beforeEach(() => {
  env = useFakeKv();
});

const ok = async () => jsonResult(validPlan());
const fail = (status: number, extra = {}) => async () => {
  throw apiError(status, extra);
};

function gateway(slots: LlmSlot[], allow = 'US,TR') {
  return createChainGateway({ slots, geminiAllowedCountries: allow, now: env.now });
}

function request(overrides: Partial<Parameters<ReturnType<typeof gateway>['run']>[0]> = {}) {
  const events: AttemptEvent[] = [];
  return {
    events,
    req: {
      kind: 'planner' as LlmKind,
      schema: plannerSchema,
      name: 'stoop_plan',
      instructions: 'INSTRUCTIONS',
      prompt: 'PROMPT',
      country: 'US' as string | null,
      signal: new AbortController().signal,
      maxAttempts: 5,
      onAttempt: (e: AttemptEvent) => events.push(e),
      ...overrides,
    },
  };
}

describe('LLM chain', () => {
  it('returns the first slot that answers with schema-valid output', async () => {
    const a = mockSlot('groq', { behavior: ok });
    const b = mockSlot('cloudflare', { behavior: ok });
    const { req, events } = request();
    const result = await gateway([a, b]).run(req);
    expect(result).toMatchObject({ ok: true, via: 'groq', model: 'groq-planner-model', data: validPlan() });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ slot: 'groq', outcome: 'ok', attempt: 1, error: null, cooldownMs: null });
    expect(b.mocks.planner.doGenerateCalls).toHaveLength(0);
    expect(await kv().get(LLM_KEYS.dailyUse('groq', utcDay(env.now())))).toBe(1);
  });

  it('passes the AI SDK call settings to the model', async () => {
    const a = mockSlot('groq', { behavior: ok });
    await gateway([a]).run(request({ maxOutputTokens: 1234 }).req);
    const call = a.mocks.planner.doGenerateCalls[0];
    expect(call?.maxOutputTokens).toBe(1234);
    expect(call?.responseFormat).toMatchObject({ type: 'json', name: 'stoop_plan' });
    expect(call?.prompt[0]).toMatchObject({ role: 'system', content: 'INSTRUCTIONS' });
    expect(call?.abortSignal).toBeInstanceOf(AbortSignal);
  });

  it('uses the creative model for creative requests', async () => {
    const a = mockSlot('groq', { behavior: { creative: async () => jsonResult({ variants: [] }) } });
    const { creativeSchema } = await import('@/server/llm/schemas');
    const result = await gateway([a]).run({ ...request().req, kind: 'creative', schema: creativeSchema, name: 'stoop_ads' });
    expect(result).toMatchObject({ ok: true, model: 'groq-creative-model', data: { variants: [] } });
  });

  it('429 with headers → cooldown in KV, next slot used, slot skipped until the cooldown ends', async () => {
    const headers = { 'x-ratelimit-remaining-tokens': '0', 'x-ratelimit-reset-tokens': '7.66s', 'x-ratelimit-reset-requests': '2m59.56s' };
    const a = mockSlot('groq', { behavior: fail(429, { responseHeaders: headers }) });
    const b = mockSlot('cloudflare', { behavior: ok });
    const gw = gateway([a, b]);

    const first = request();
    const result = await gw.run(first.req);
    expect(result).toMatchObject({ ok: true, via: 'cloudflare' });
    expect(first.events.map((e) => [e.slot, e.outcome, e.error, e.status, e.cooldownMs])).toEqual([
      ['groq', 'error', 'rate_limit', 429, 7_660],
      ['cloudflare', 'ok', null, null, null],
    ]);
    expect(await kv().pttl(LLM_KEYS.modelCooldown('groq', 'groq-planner-model'))).toBe(7_660);

    const second = await gw.run(request().req);
    expect(second).toMatchObject({ ok: true, via: 'cloudflare', skipped: [{ slot: 'groq', reason: 'cooldown', remainingMs: 7_660 }] });
    expect(a.mocks.planner.doGenerateCalls).toHaveLength(1);

    env.clock.now += 7_661;
    await gw.run(request().req);
    expect(a.mocks.planner.doGenerateCalls).toHaveLength(2);
  });

  it('a cooldown on one model leaves the other kind usable', async () => {
    const a = mockSlot('groq', { behavior: { planner: fail(429), creative: async () => jsonResult({ variants: [] }) } });
    const { creativeSchema } = await import('@/server/llm/schemas');
    const gw = gateway([a]);
    await gw.run(request().req);
    const creative = await gw.run({ ...request().req, kind: 'creative', schema: creativeSchema });
    expect(creative.ok).toBe(true);
  });

  it('schema failure → local repair (fences, trailing comma, stray key) succeeds without a cooldown', async () => {
    const messy = '```json\n' + JSON.stringify({ ...validPlan(), note: 'extra' }).replace(/}$/, ',}') + '\n```';
    const a = mockSlot('cloudflare', { behavior: async () => textResult(messy) });
    const { req, events } = request();
    const result = await gateway([a]).run(req);
    expect(result).toMatchObject({ ok: true, via: 'cloudflare', data: validPlan() });
    expect(events[0]).toMatchObject({ outcome: 'repaired', cooldownMs: null });
  });

  it('unrepairable output → next slot, counted toward the schema breaker (3 in 10 min → 10 min cooldown)', async () => {
    const a = mockSlot('sambanova', { behavior: async () => textResult('Sorry, I cannot produce JSON today.') });
    const b = mockSlot('openrouter', { behavior: ok });
    const gw = gateway([a, b]);
    for (let i = 1; i <= 2; i++) {
      const { req, events } = request();
      expect(await gw.run(req)).toMatchObject({ ok: true, via: 'openrouter' });
      expect(events[0]).toMatchObject({ slot: 'sambanova', outcome: 'invalid', error: 'invalid_output', cooldownMs: null });
    }
    const { req, events } = request();
    await gw.run(req);
    expect(events[0]).toMatchObject({ outcome: 'invalid', cooldownMs: COOLDOWN_MS.schemaBreaker });
    const next = await gw.run(request().req);
    expect(next.skipped).toEqual([{ slot: 'sambanova', reason: 'cooldown', remainingMs: COOLDOWN_MS.schemaBreaker }]);
  });

  it('empty output with a non-stop finish counts as invalid output', async () => {
    const a = mockSlot('groq', { behavior: async () => textResult('', 'length') });
    const { req, events } = request();
    const result = await gateway([a]).run(req);
    expect(result).toMatchObject({ ok: false, reason: 'exhausted' });
    expect(events[0]).toMatchObject({ outcome: 'invalid', error: 'invalid_output' });
  });

  it('OpenRouter HTTP 200 with an error body → 30 s cooldown, next slot', async () => {
    const a = mockSlot('openrouter', {
      behavior: fail(200, { message: 'Provider returned error', data: { code: 502, message: 'Provider returned error' } }),
    });
    const b = mockSlot('groq', { behavior: ok });
    const { req, events } = request();
    const result = await gateway([a, b]).run(req);
    expect(result).toMatchObject({ ok: true, via: 'groq' });
    expect(events[0]).toMatchObject({ slot: 'openrouter', outcome: 'error', error: 'error_body', status: 200, cooldownMs: 30_000 });
    expect(await kv().pttl(LLM_KEYS.modelCooldown('openrouter', 'openrouter-planner-model'))).toBe(30_000);
  });

  it.each([
    [401, COOLDOWN_MS.auth, true],
    [403, COOLDOWN_MS.auth, true],
    [404, COOLDOWN_MS.notFound, false],
    [500, COOLDOWN_MS.server, false],
  ])('HTTP %d → %d ms cooldown (provider-wide: %s)', async (status, ms, providerWide) => {
    const a = mockSlot('groq', { behavior: fail(status) });
    await gateway([a]).run(request().req);
    const key = providerWide ? LLM_KEYS.providerCooldown('groq') : LLM_KEYS.modelCooldown('groq', 'groq-planner-model');
    expect(await kv().pttl(key)).toBe(ms);
  });

  it('our own per-attempt timeout → 30 s cooldown and the next slot', async () => {
    const a = mockSlot('groq', {
      behavior: async () => {
        throw new DOMException('Total timeout of 12000ms exceeded', 'TimeoutError');
      },
    });
    const b = mockSlot('cloudflare', { behavior: ok });
    const { req, events } = request();
    expect(await gateway([a, b]).run(req)).toMatchObject({ ok: true, via: 'cloudflare' });
    expect(events[0]).toMatchObject({ outcome: 'error', error: 'timeout', cooldownMs: 30_000 });
  });

  it('all slots failing → { ok: false, reason: "exhausted" } with every attempt recorded', async () => {
    const slots = [mockSlot('groq', { behavior: fail(503) }), mockSlot('cloudflare', { behavior: fail(500) }), mockSlot('openrouter', { behavior: fail(429) })];
    const { req, events } = request();
    const result = await gateway(slots).run(req);
    expect(result).toMatchObject({ ok: false, reason: 'exhausted' });
    expect(result.attempts.map((e) => e.slot)).toEqual(['groq', 'cloudflare', 'openrouter']);
    expect(events).toEqual(result.attempts);
  });

  it('respects maxAttempts', async () => {
    const slots = [mockSlot('groq', { behavior: fail(500) }), mockSlot('cloudflare', { behavior: fail(500) }), mockSlot('openrouter', { behavior: ok })];
    const result = await gateway(slots).run(request({ maxAttempts: 2 }).req);
    expect(result).toMatchObject({ ok: false, reason: 'exhausted' });
    expect(slots[2]?.mocks.planner.doGenerateCalls).toHaveLength(0);
    // A NaN limit must not lift the cap.
    const nan = await gateway(slots).run(request({ maxAttempts: Number.NaN }).req);
    expect(nan.attempts).toHaveLength(1);
  });

  it('abort mid-call stops the chain: no other slot is tried and no cooldown is set', async () => {
    const controller = new AbortController();
    // The caller aborts while the request is in flight.
    const a = mockSlot('groq', {
      behavior: (options) => {
        const pending = hangUntilAborted(options);
        controller.abort();
        return pending;
      },
    });
    const b = mockSlot('cloudflare', { behavior: ok });
    const { req, events } = request({ signal: controller.signal });
    const result = await gateway([a, b]).run(req);
    expect(result).toMatchObject({ ok: false, reason: 'aborted' });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ outcome: 'aborted', error: 'aborted', cooldownMs: null });
    expect(b.mocks.planner.doGenerateCalls).toHaveLength(0);
    expect(await kv().pttl(LLM_KEYS.modelCooldown('groq', 'groq-planner-model'))).toBe(-2);
  });

  it('an already-aborted signal makes no call at all', async () => {
    const controller = new AbortController();
    controller.abort();
    const a = mockSlot('groq', { behavior: ok });
    const result = await gateway([a]).run(request({ signal: controller.signal }).req);
    expect(result).toMatchObject({ ok: false, reason: 'aborted', attempts: [] });
    expect(a.mocks.planner.doGenerateCalls).toHaveLength(0);
  });

  it('kill switch (cfg:llm:disabled) skips a slot', async () => {
    await kv().set(LLM_KEYS.disabled, ['groq']);
    const a = mockSlot('groq', { behavior: ok });
    const b = mockSlot('cloudflare', { behavior: ok });
    const result = await gateway([a, b]).run(request().req);
    expect(result).toMatchObject({ ok: true, via: 'cloudflare', skipped: [{ slot: 'groq', reason: 'disabled', remainingMs: null }] });
    expect(a.mocks.planner.doGenerateCalls).toHaveLength(0);
  });

  it('the kill switch by provider id stops every slot on that key', async () => {
    await kv().set(LLM_KEYS.disabled, ['groq']);
    const a = { ...mockSlot('groq', { behavior: ok }), provider: 'groq' };
    const b = { ...mockSlot('groq-20b', { behavior: ok }), provider: 'groq' };
    const c = mockSlot('cloudflare', { behavior: ok });
    const result = await gateway([a, b, c]).run(request().req);
    expect(result).toMatchObject({ ok: true, via: 'cloudflare' });
    expect(result.skipped.map((s) => [s.slot, s.reason])).toEqual([
      ['groq', 'disabled'],
      ['groq-20b', 'disabled'],
    ]);
    expect(b.mocks.planner.doGenerateCalls).toHaveLength(0);
  });

  it("a key failure benches the provider's other slots in this run and the next", async () => {
    const a = { ...mockSlot('groq', { behavior: fail(401) }), provider: 'groq' };
    const b = { ...mockSlot('groq-20b', { behavior: ok }), provider: 'groq' };
    const c = mockSlot('cloudflare', { behavior: ok });
    // Two attempts, as the planner allows: the second goes to another provider, not the same bad key.
    const first = await gateway([a, b, c]).run(request({ maxAttempts: 2 }).req);
    expect(first).toMatchObject({ ok: true, via: 'cloudflare' });
    expect(first.attempts.map((e) => e.slot)).toEqual(['groq', 'cloudflare']);
    expect(first.skipped).toEqual([{ slot: 'groq-20b', reason: 'cooldown', remainingMs: COOLDOWN_MS.auth }]);
    expect(b.mocks.planner.doGenerateCalls).toHaveLength(0);
    expect(await kv().pttl(LLM_KEYS.providerCooldown('groq'))).toBe(COOLDOWN_MS.auth);

    const second = await gateway([a, b, c]).run(request({ maxAttempts: 2 }).req);
    expect(second).toMatchObject({ ok: true, via: 'cloudflare' });
    expect(second.skipped.map((s) => s.slot)).toEqual(['groq', 'groq-20b']);
    expect(a.mocks.planner.doGenerateCalls).toHaveLength(1);
  });

  it('every slot skipped → { ok: false, reason: "no_slots" }', async () => {
    await kv().set(LLM_KEYS.disabled, ['groq', 'cloudflare']);
    const result = await gateway([mockSlot('groq', { behavior: ok }), mockSlot('cloudflare', { behavior: ok })]).run(request().req);
    expect(result).toMatchObject({ ok: false, reason: 'no_slots', attempts: [] });
    expect(result.skipped.map((s) => s.reason)).toEqual(['disabled', 'disabled']);
    expect((await gateway([]).run(request().req)).ok).toBe(false);
  });

  it.each([
    ['US', true],
    ['TR', true],
    ['DE', false],
    ['GB', false],
    [null, false],
  ])('Gemini slot for country %s used: %s', async (country, used) => {
    const gemini = mockSlot('gemini', { behavior: ok, geoGated: true });
    const b = mockSlot('cloudflare', { behavior: ok });
    const result = await gateway([gemini, b]).run(request({ country }).req);
    expect(result).toMatchObject({ ok: true, via: used ? 'gemini' : 'cloudflare' });
    if (!used) expect(result.skipped).toEqual([{ slot: 'gemini', reason: 'geo_blocked', remainingMs: null }]);
  });

  it('daily soft cap skips the slot', async () => {
    await kv().set(LLM_KEYS.dailyUse('groq', utcDay(env.now())), 3);
    const a = mockSlot('groq', { behavior: ok, dailySoftCap: 3 });
    const b = mockSlot('cloudflare', { behavior: ok });
    const result = await gateway([a, b]).run(request().req);
    expect(result).toMatchObject({ ok: true, via: 'cloudflare', skipped: [{ slot: 'groq', reason: 'daily_cap' }] });
  });

  it('validate() problems → next slot without a cooldown', async () => {
    const a = mockSlot('groq', { behavior: ok });
    const b = mockSlot('cloudflare', { behavior: ok });
    let calls = 0;
    const validate = () => (++calls === 1 ? ['needs at least 2 distinct anchors'] : []);
    const { req, events } = request({ validate });
    const result = await gateway([a, b]).run(req);
    expect(result).toMatchObject({ ok: true, via: 'cloudflare' });
    expect(events[0]).toMatchObject({ outcome: 'rejected', detail: 'needs at least 2 distinct anchors', cooldownMs: null, error: null });
    expect(await kv().pttl(LLM_KEYS.modelCooldown('groq', 'groq-planner-model'))).toBe(-2);
  });

  it('a throwing validate() or onAttempt() never crashes the run', async () => {
    const a = mockSlot('groq', { behavior: ok });
    const result = await gateway([a]).run(
      request({
        validate: () => {
          throw new Error('boom');
        },
        onAttempt: () => {
          throw new Error('listener boom');
        },
      }).req,
    );
    expect(result).toMatchObject({ ok: false, reason: 'exhausted' });
    expect(result.attempts[0]).toMatchObject({ outcome: 'rejected', detail: 'validate() threw: boom' });
  });

  it('appends the JSON skeleton only for slots that do not enforce the schema', async () => {
    const strict = mockSlot('groq', { behavior: fail(500) });
    const loose = mockSlot('cloudflare', { behavior: ok, jsonSkeleton: true });
    await gateway([strict, loose]).run(request().req);
    expect(strict.mocks.planner.doGenerateCalls[0]?.prompt[0]).toMatchObject({ content: 'INSTRUCTIONS' });
    const system = loose.mocks.planner.doGenerateCalls[0]?.prompt[0];
    expect(system?.role === 'system' ? system.content : '').toMatch(/^INSTRUCTIONS\n\nOUTPUT FORMAT/);
  });
});
