import { beforeEach, describe, expect, it } from 'vitest';
import { createChainGateway } from '@/server/llm/chain';
import type { LlmKind } from '@/server/llm/gateway';
import { buildPlannerInstructions, buildPlannerPrompt } from '@/server/llm/prompts';
import { plannerSchema } from '@/server/llm/schemas';
import { buildSlots, freeOnly, OPENROUTER_FREE_FALLBACKS, SLOT_IDS, SLOT_MODELS, type LlmSlot, type SlotId } from '@/server/llm/slots';
import { HALFNOTE, NEIGHBORHOODS, useFakeKv, validPlan } from './helpers';

const ALL_KEYS = {
  GROQ_API_KEY: 'test-groq',
  GOOGLE_GENERATIVE_AI_API_KEY: 'test-google',
  CLOUDFLARE_ACCOUNT_ID: 'acct123',
  CLOUDFLARE_API_TOKEN: 'test-cf',
  SAMBANOVA_API_KEY: 'test-sn',
  OPENROUTER_API_KEY: 'test-or',
};
const KINDS: LlmKind[] = ['planner', 'creative'];

interface Captured {
  url: string;
  body: Record<string, unknown>;
  headers: Record<string, string>;
}

/** A fetch that records each request and answers with `respond` (default: HTTP 500). */
function recordingFetch(respond?: (url: string) => Response) {
  const calls: Captured[] = [];
  const fetchFn = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const headers = Object.fromEntries(new Headers(init?.headers).entries());
    calls.push({ url, body: JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>, headers });
    return respond?.(url) ?? new Response(JSON.stringify({ error: { message: 'test stop', type: 'server_error' } }), { status: 500, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
  return { calls, fetchFn };
}

async function plannerRequest(slot: LlmSlot) {
  const gateway = createChainGateway({ slots: [slot], geminiAllowedCountries: 'US' });
  return gateway.run({
    kind: 'planner',
    schema: plannerSchema,
    name: 'stoop_plan',
    instructions: buildPlannerInstructions(NEIGHBORHOODS),
    prompt: buildPlannerPrompt(HALFNOTE),
    country: 'US',
    signal: new AbortController().signal,
    maxAttempts: 1,
  });
}

function slotById(slots: LlmSlot[], id: SlotId): LlmSlot {
  const slot = slots.find((s) => s.id === id);
  if (!slot) throw new Error(`missing slot ${id}`);
  return slot;
}

describe('buildSlots', () => {
  it('builds every keyed slot in chain order', () => {
    expect(buildSlots(ALL_KEYS).map((s) => s.id)).toEqual([...SLOT_IDS]);
  });

  it('skips slots whose keys are absent', () => {
    expect(buildSlots({})).toEqual([]);
    expect(buildSlots({ OPENROUTER_API_KEY: 'k', GROQ_API_KEY: 'k' }).map((s) => s.id)).toEqual(['groq', 'groq-20b', 'openrouter']);
    // Cloudflare needs both the account id and the token.
    expect(buildSlots({ CLOUDFLARE_API_TOKEN: 'k' })).toEqual([]);
  });

  it('every slot model is a provider instance (object), never a bare model-id string', () => {
    for (const slot of buildSlots(ALL_KEYS)) {
      for (const kind of KINDS) {
        const model = slot.models[kind];
        expect(typeof model).toBe('object');
        expect(model).not.toBeNull();
        expect(model).toHaveProperty('doGenerate');
        expect(model.specificationVersion).toBe('v4');
        expect(model.modelId).toBe(SLOT_MODELS[slot.id as SlotId][kind]);
        expect(slot.modelIds[kind]).toBe(model.modelId);
      }
    }
  });

  it('uses the specified models', () => {
    // 120b writes both steps; one Groq key also runs 20b as the next slot when 120b is rate-limited.
    expect(SLOT_MODELS.groq).toEqual({ planner: 'openai/gpt-oss-120b', creative: 'openai/gpt-oss-120b' });
    expect(SLOT_MODELS['groq-20b']).toEqual({ planner: 'openai/gpt-oss-20b', creative: 'openai/gpt-oss-20b' });
    expect(SLOT_MODELS.gemini).toEqual({ planner: 'gemini-3.1-flash-lite', creative: 'gemini-3.5-flash-lite' });
    expect(SLOT_MODELS.cloudflare.planner).toBe('@cf/google/gemma-4-26b-a4b-it');
    expect(SLOT_MODELS.sambanova.creative).toBe('gpt-oss-120b');
    expect(SLOT_MODELS.openrouter.planner).toBe('google/gemma-4-31b-it:free');
  });

  it('gates only Gemini by country', () => {
    expect(buildSlots(ALL_KEYS).filter((s) => s.geoGated).map((s) => s.id)).toEqual(['gemini']);
  });

  it('OpenRouter fallbacks are free models only', () => {
    expect(OPENROUTER_FREE_FALLBACKS.every((m) => m.endsWith(':free'))).toBe(true);
    expect(freeOnly(['a/b:free', 'paid/model', 'a/b:free', 'c/d:free'])).toEqual(['a/b:free', 'c/d:free']);
  });
});

describe('provider request bodies (injected fetch, no network)', () => {
  beforeEach(() => {
    useFakeKv();
  });

  it('Groq: strict json_schema, reasoning effort low, system prefix first', async () => {
    const { calls, fetchFn } = recordingFetch();
    const result = await plannerRequest(slotById(buildSlots({ GROQ_API_KEY: 'test-groq' }, { fetch: fetchFn }), 'groq'));
    expect(result.ok).toBe(false);
    const call = calls[0];
    expect(call?.url).toBe('https://api.groq.com/openai/v1/chat/completions');
    expect(call?.headers.authorization).toBe('Bearer test-groq');
    expect(call?.body).toMatchObject({
      model: 'openai/gpt-oss-120b',
      reasoning_effort: 'low',
      max_tokens: 2000,
      response_format: { type: 'json_schema', json_schema: { strict: true, name: 'stoop_plan' } },
    });
    const messages = call?.body.messages as { role: string; content: string }[];
    expect(messages[0]).toEqual({ role: 'system', content: buildPlannerInstructions(NEIGHBORHOODS) });
    expect(messages[1]?.role).toBe('user');
    expect(String(messages[1]?.content)).toContain('<brief>');
  });

  it('Groq (20b): the same key and request shape with the smaller model', async () => {
    const { calls, fetchFn } = recordingFetch();
    await plannerRequest(slotById(buildSlots({ GROQ_API_KEY: 'test-groq' }, { fetch: fetchFn }), 'groq-20b'));
    expect(calls[0]?.headers.authorization).toBe('Bearer test-groq');
    expect(calls[0]?.body).toMatchObject({
      model: 'openai/gpt-oss-20b',
      reasoning_effort: 'low',
      response_format: { type: 'json_schema', json_schema: { strict: true, name: 'stoop_plan' } },
    });
  });

  it('Gemini: native JSON schema and low thinking level', async () => {
    const { calls, fetchFn } = recordingFetch();
    await plannerRequest(slotById(buildSlots({ GOOGLE_GENERATIVE_AI_API_KEY: 'test-google' }, { fetch: fetchFn }), 'gemini'));
    const call = calls[0];
    expect(call?.url).toContain('/models/gemini-3.1-flash-lite:generateContent');
    expect(call?.headers['x-goog-api-key']).toBe('test-google');
    const config = call?.body.generationConfig as Record<string, unknown>;
    expect(config.responseMimeType).toBe('application/json');
    expect(config.responseJsonSchema).toBeTypeOf('object');
    expect(config.thinkingConfig).toEqual({ thinkingLevel: 'low' });
  });

  it('Cloudflare: account URL, no response_format, JSON skeleton in the instructions', async () => {
    const { calls, fetchFn } = recordingFetch();
    await plannerRequest(slotById(buildSlots({ CLOUDFLARE_ACCOUNT_ID: 'acct123', CLOUDFLARE_API_TOKEN: 'test-cf' }, { fetch: fetchFn }), 'cloudflare'));
    const call = calls[0];
    expect(call?.url).toBe('https://api.cloudflare.com/client/v4/accounts/acct123/ai/v1/chat/completions');
    expect(call?.headers.authorization).toBe('Bearer test-cf');
    expect(call?.body.model).toBe('@cf/google/gemma-4-26b-a4b-it');
    expect(call?.body).not.toHaveProperty('response_format');
    expect(call?.body).not.toHaveProperty('reasoning_effort');
    const system = (call?.body.messages as { content: string }[])[0]?.content ?? '';
    expect(system).toContain('OUTPUT FORMAT');
    expect(system.startsWith(buildPlannerInstructions(NEIGHBORHOODS))).toBe(true);
  });

  it('Cloudflare: a fenced JSON answer is repaired locally through the real provider parser', async () => {
    const completion = {
      id: 'chatcmpl-1',
      object: 'chat.completion',
      created: 1_761_480_000,
      model: '@cf/google/gemma-4-26b-a4b-it',
      choices: [{ index: 0, message: { role: 'assistant', content: '```json\n' + JSON.stringify(validPlan()) + '\n```' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
    };
    const { fetchFn } = recordingFetch(() => new Response(JSON.stringify(completion), { status: 200, headers: { 'content-type': 'application/json' } }));
    const result = await plannerRequest(slotById(buildSlots({ CLOUDFLARE_ACCOUNT_ID: 'acct123', CLOUDFLARE_API_TOKEN: 'test-cf' }, { fetch: fetchFn }), 'cloudflare'));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toEqual(validPlan());
      expect(result.attempts[0]?.outcome).toBe('repaired');
    }
  });

  it('SambaNova: best-effort (non-strict) json_schema, reasoning effort low', async () => {
    const { calls, fetchFn } = recordingFetch();
    await plannerRequest(slotById(buildSlots({ SAMBANOVA_API_KEY: 'test-sn' }, { fetch: fetchFn }), 'sambanova'));
    const call = calls[0];
    expect(call?.url).toBe('https://api.sambanova.ai/v1/chat/completions');
    expect(call?.body).toMatchObject({
      model: 'gpt-oss-120b',
      reasoning_effort: 'low',
      response_format: { type: 'json_schema', json_schema: { strict: false } },
    });
    expect(call?.body).not.toHaveProperty('strictJsonSchema');
  });

  it('OpenRouter: free models only, json_object, response-healing, require_parameters', async () => {
    const { calls, fetchFn } = recordingFetch();
    await plannerRequest(slotById(buildSlots({ OPENROUTER_API_KEY: 'test-or' }, { fetch: fetchFn }), 'openrouter'));
    const call = calls[0];
    expect(call?.url).toBe('https://openrouter.ai/api/v1/chat/completions');
    expect(call?.headers.authorization).toBe('Bearer test-or');
    expect(call?.body.model).toBe('google/gemma-4-31b-it:free');
    const models = call?.body.models as string[];
    expect(models.length).toBeGreaterThan(1);
    expect(models.every((m) => m.endsWith(':free'))).toBe(true);
    expect(call?.body.response_format).toEqual({ type: 'json_object' });
    expect(call?.body.plugins).toEqual([{ id: 'response-healing' }]);
    expect(call?.body.provider).toEqual({ require_parameters: true });
  });
});
