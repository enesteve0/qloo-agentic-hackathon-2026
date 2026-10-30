import { afterEach, describe, expect, it } from 'vitest';
import { getEnv, resetEnvForTests } from '@/server/env';

const KEYS = ['GROQ_API_KEY', 'SESSION_SECRET', 'UPSTASH_REDIS_REST_URL', 'REDIS_PREFIX'] as const;
const before = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));

function setEnv(values: Partial<Record<(typeof KEYS)[number], string>>) {
  Object.assign(process.env, values);
  resetEnvForTests();
}

describe('getEnv', () => {
  afterEach(() => {
    for (const k of KEYS) {
      if (before[k] === undefined) delete process.env[k];
      else process.env[k] = before[k];
    }
    resetEnvForTests();
  });

  it('treats empty values (KEY= in a copy of .env.example) as unset', () => {
    setEnv({ GROQ_API_KEY: '', SESSION_SECRET: '', UPSTASH_REDIS_REST_URL: '', REDIS_PREFIX: '' });
    const env = getEnv();
    expect(env.GROQ_API_KEY).toBeUndefined();
    expect(env.SESSION_SECRET).toBeUndefined();
    expect(env.UPSTASH_REDIS_REST_URL).toBeUndefined();
    expect(env.REDIS_PREFIX).toBe('d:');
  });

  it('still rejects a value that is set but invalid', () => {
    setEnv({ SESSION_SECRET: 'too-short' });
    expect(() => getEnv()).toThrow(/Invalid environment: SESSION_SECRET/);
  });
});
