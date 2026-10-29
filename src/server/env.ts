import 'server-only';
import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  VERCEL_ENV: z.enum(['development', 'preview', 'production']).optional(),

  QLOO_MODE: z.enum(['mock', 'live', 'cache-only', 'off']).default('mock'),
  QLOO_API_KEY: z.string().min(1).optional(),
  QLOO_BASE_URL: z.url().default('https://hackathon.api.qloo.com'),
  QLOO_RUN_RPS: z.coerce.number().positive().default(2),
  QLOO_RUN_SLOTS: z.coerce.number().int().positive().default(2),
  QLOO_MAX_FRESH_PER_RUN: z.coerce.number().int().positive().default(20),
  QLOO_CAPS_JSON: z.string().optional(),

  LLM_MODE: z.enum(['mock', 'live']).default('mock'),
  GROQ_API_KEY: z.string().min(1).optional(),
  GOOGLE_GENERATIVE_AI_API_KEY: z.string().min(1).optional(),
  CLOUDFLARE_ACCOUNT_ID: z.string().min(1).optional(),
  CLOUDFLARE_API_TOKEN: z.string().min(1).optional(),
  SAMBANOVA_API_KEY: z.string().min(1).optional(),
  OPENROUTER_API_KEY: z.string().min(1).optional(),
  GEMINI_ALLOWED_COUNTRIES: z.string().default('US,CA,TR,MX,BR,AU,NZ,JP,KR,IN,SG,ZA,AE'),

  REDIS_DRIVER: z.enum(['upstash', 'memory']).optional(),
  REDIS_PREFIX: z.string().default('d:'),
  UPSTASH_REDIS_REST_URL: z.url().optional(),
  UPSTASH_REDIS_REST_TOKEN: z.string().min(1).optional(),
  KV_REST_API_URL: z.url().optional(),
  KV_REST_API_TOKEN: z.string().min(1).optional(),

  LIVE_RUNS_PER_HOUR: z.coerce.number().int().positive().default(25),
  EVENT_JUDGING_START: z.iso.datetime().default('2026-11-02T17:00:00Z'),
  EVENT_JUDGING_END: z.iso.datetime().default('2026-11-06T04:45:00Z'),
  EVENT_DATA_EXPIRES_AT: z.iso.datetime().default('2026-11-07T00:00:00Z'),
  SESSION_SECRET: z.string().min(32).optional(),
  ADMIN_TOKEN: z.string().min(24).optional(),
  SITE_URL: z.url().optional(),
});

export type Env = z.infer<typeof schema> & { redisDriver: 'upstash' | 'memory' };

let cached: Env | undefined;

/** Parsed, validated server environment. Throws with a readable message on invalid values. */
export function getEnv(): Env {
  if (cached) return cached;
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Invalid environment: ${issues}`);
  }
  const e = parsed.data;
  const hasUpstash = Boolean((e.UPSTASH_REDIS_REST_URL && e.UPSTASH_REDIS_REST_TOKEN) || (e.KV_REST_API_URL && e.KV_REST_API_TOKEN));
  const redisDriver = e.REDIS_DRIVER ?? (hasUpstash ? 'upstash' : 'memory');
  cached = { ...e, redisDriver };
  return cached;
}

/** Test helper: forget the cached environment so tests can change process.env. */
export function resetEnvForTests(): void {
  cached = undefined;
}
