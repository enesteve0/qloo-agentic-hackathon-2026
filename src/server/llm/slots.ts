import 'server-only';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createGroq } from '@ai-sdk/groq';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import type { generateText, LanguageModel } from 'ai';
import type { Env } from '@/server/env';
import type { LlmKind } from './gateway';

type GenerateTextOptions = Parameters<typeof generateText>[0];
export type ProviderOptions = NonNullable<GenerateTextOptions['providerOptions']>;
export type ReasoningLevel = NonNullable<GenerateTextOptions['reasoning']>;

/**
 * A provider *instance*. `LanguageModel` also admits a bare model-id string, which the AI SDK routes
 * through the paid AI Gateway; excluding strings makes that mistake a type error.
 */
export type ModelInstance = Exclude<LanguageModel, string>;

export const SLOT_IDS = ['groq', 'groq-20b', 'gemini', 'cloudflare', 'sambanova', 'openrouter'] as const;
export type SlotId = (typeof SLOT_IDS)[number];

export interface SlotCallOptions {
  reasoning?: ReasoningLevel;
  providerOptions?: ProviderOptions;
}

export interface LlmSlot {
  id: string;
  label: string;
  models: Record<LlmKind, ModelInstance>;
  /** Exact provider model ids (logs, labels, cooldown keys). */
  modelIds: Record<LlmKind, string>;
  /** Extra `generateText` options for this slot. */
  callOptions: SlotCallOptions;
  /** The API does not enforce the schema: append a JSON skeleton to the instructions. */
  jsonSkeleton: boolean;
  /** Usable only when the end user's country passes the Gemini geo gate. */
  geoGated: boolean;
  /** Soft daily cap on attempts (both kinds), tracked in KV per UTC day. */
  dailySoftCap: number;
}

export const SLOT_MODELS = {
  groq: { planner: 'openai/gpt-oss-120b', creative: 'openai/gpt-oss-120b' },
  'groq-20b': { planner: 'openai/gpt-oss-20b', creative: 'openai/gpt-oss-20b' },
  gemini: { planner: 'gemini-3.1-flash-lite', creative: 'gemini-3.5-flash-lite' },
  cloudflare: { planner: '@cf/google/gemma-4-26b-a4b-it', creative: '@cf/google/gemma-4-26b-a4b-it' },
  sambanova: { planner: 'gpt-oss-120b', creative: 'gpt-oss-120b' },
  openrouter: { planner: 'google/gemma-4-31b-it:free', creative: 'google/gemma-4-31b-it:free' },
} as const satisfies Record<SlotId, Record<LlmKind, string>>;

/** OpenRouter fallbacks; only `:free` variants so no request can be billed. */
export const OPENROUTER_FREE_FALLBACKS = ['google/gemma-3-27b-it:free', 'meta-llama/llama-3.3-70b-instruct:free'] as const;

/** Soft daily caps (ASSUMPTION: set below each provider's documented free-tier allowance). */
export const DAILY_SOFT_CAPS: Record<SlotId, number> = {
  // Groq allows 1,000 requests a day per model; each Groq slot uses one model.
  groq: 900,
  'groq-20b': 900,
  gemini: 500,
  cloudflare: 200,
  sambanova: 300,
  openrouter: 45,
};

export const CLOUDFLARE_BASE_URL = (accountId: string) =>
  `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountId)}/ai/v1`;
export const SAMBANOVA_BASE_URL = 'https://api.sambanova.ai/v1';

export type SlotEnv = Partial<
  Pick<
    Env,
    | 'GROQ_API_KEY'
    | 'GOOGLE_GENERATIVE_AI_API_KEY'
    | 'CLOUDFLARE_ACCOUNT_ID'
    | 'CLOUDFLARE_API_TOKEN'
    | 'SAMBANOVA_API_KEY'
    | 'OPENROUTER_API_KEY'
  >
>;

/** Keeps only free OpenRouter model ids (deduplicated, order kept). */
export function freeOnly(models: readonly string[]): string[] {
  return [...new Set(models.filter((m) => m.endsWith(':free')))];
}

// Cloudflare's OpenAI-compatible endpoint may reject response_format for models without JSON mode;
// the slot relies on the prompt skeleton, local repair and zod instead.
function withoutResponseFormat(body: Record<string, unknown>): Record<string, unknown> {
  const rest = { ...body };
  delete rest.response_format;
  return rest;
}

export interface BuildSlotsOptions {
  /** Custom fetch for every provider (tests inspect request bodies without network). */
  fetch?: typeof globalThis.fetch;
}

/** Builds the chain in order, skipping any provider whose keys are absent. */
export function buildSlots(env: SlotEnv, opts: BuildSlotsOptions = {}): LlmSlot[] {
  const slots: LlmSlot[] = [];
  const { fetch } = opts;

  if (env.GROQ_API_KEY) {
    const groq = createGroq({ apiKey: env.GROQ_API_KEY, fetch });
    // One key, two slots: Groq's free limits are per model, so when 120b is out of tokens for the
    // minute or the day, 20b answers instead of the rules.
    for (const [id, label] of [
      ['groq', 'Groq'],
      ['groq-20b', 'Groq (20b)'],
    ] as const) {
      const ids = SLOT_MODELS[id];
      slots.push({
        id,
        label,
        models: { planner: groq.languageModel(ids.planner), creative: groq.languageModel(ids.creative) },
        modelIds: { ...ids },
        // Strict json_schema = constrained decoding on gpt-oss.
        callOptions: { reasoning: 'low', providerOptions: { groq: { structuredOutputs: true, strictJsonSchema: true } } },
        jsonSkeleton: false,
        geoGated: false,
        dailySoftCap: DAILY_SOFT_CAPS[id],
      });
    }
  }

  if (env.GOOGLE_GENERATIVE_AI_API_KEY) {
    const google = createGoogleGenerativeAI({ apiKey: env.GOOGLE_GENERATIVE_AI_API_KEY, fetch });
    const ids = SLOT_MODELS.gemini;
    slots.push({
      id: 'gemini',
      label: 'Gemini',
      models: { planner: google.languageModel(ids.planner), creative: google.languageModel(ids.creative) },
      modelIds: { ...ids },
      // Native responseJsonSchema; reasoning 'low' maps to thinkingLevel low.
      callOptions: { reasoning: 'low', providerOptions: { google: { structuredOutputs: true } } },
      jsonSkeleton: false,
      geoGated: true,
      dailySoftCap: DAILY_SOFT_CAPS.gemini,
    });
  }

  if (env.CLOUDFLARE_ACCOUNT_ID && env.CLOUDFLARE_API_TOKEN) {
    const cloudflare = createOpenAICompatible({
      name: 'cloudflare',
      baseURL: CLOUDFLARE_BASE_URL(env.CLOUDFLARE_ACCOUNT_ID),
      apiKey: env.CLOUDFLARE_API_TOKEN,
      // response_format never reaches the wire (see withoutResponseFormat); declaring structured
      // outputs only stops the SDK from logging an "unsupported responseFormat" warning per call.
      supportsStructuredOutputs: true,
      transformRequestBody: withoutResponseFormat,
      fetch,
    });
    const ids = SLOT_MODELS.cloudflare;
    slots.push({
      id: 'cloudflare',
      label: 'Cloudflare Workers AI',
      models: { planner: cloudflare.chatModel(ids.planner), creative: cloudflare.chatModel(ids.creative) },
      modelIds: { ...ids },
      callOptions: {},
      jsonSkeleton: true,
      geoGated: false,
      dailySoftCap: DAILY_SOFT_CAPS.cloudflare,
    });
  }

  if (env.SAMBANOVA_API_KEY) {
    const sambanova = createOpenAICompatible({
      name: 'sambanova',
      baseURL: SAMBANOVA_BASE_URL,
      apiKey: env.SAMBANOVA_API_KEY,
      supportsStructuredOutputs: true,
      fetch,
    });
    const ids = SLOT_MODELS.sambanova;
    slots.push({
      id: 'sambanova',
      label: 'SambaNova',
      models: { planner: sambanova.chatModel(ids.planner), creative: sambanova.chatModel(ids.creative) },
      modelIds: { ...ids },
      // Best-effort schema: json_schema without strict mode, then zod.
      callOptions: { reasoning: 'low', providerOptions: { sambanova: { strictJsonSchema: false } } },
      jsonSkeleton: true,
      geoGated: false,
      dailySoftCap: DAILY_SOFT_CAPS.sambanova,
    });
  }

  if (env.OPENROUTER_API_KEY) {
    const openrouter = createOpenRouter({ apiKey: env.OPENROUTER_API_KEY, compatibility: 'strict', fetch });
    const ids = SLOT_MODELS.openrouter;
    const chat = (modelId: string) => {
      // No payment method is attached, but a paid model id must never be possible here.
      if (!modelId.endsWith(':free')) throw new Error(`OpenRouter slot accepts only :free models, got ${modelId}`);
      return openrouter.chat(modelId, {
        models: freeOnly([modelId, ...OPENROUTER_FREE_FALLBACKS]),
        plugins: [{ id: 'response-healing' }],
        // Route only to endpoints that honour response_format and max_tokens.
        provider: { require_parameters: true },
        // json_object instead of json_schema: most free endpoints lack strict structured outputs.
        extraBody: { response_format: { type: 'json_object' } },
      });
    };
    slots.push({
      id: 'openrouter',
      label: 'OpenRouter (free)',
      models: { planner: chat(ids.planner), creative: chat(ids.creative) },
      modelIds: { ...ids },
      callOptions: {},
      jsonSkeleton: true,
      geoGated: false,
      dailySoftCap: DAILY_SOFT_CAPS.openrouter,
    });
  }

  return slots;
}
