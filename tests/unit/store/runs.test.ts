import { afterEach, describe, expect, it, vi } from 'vitest';
import { resetEnvForTests } from '@/server/env';
import { MemoryKV, setKvForTests } from '@/server/kv';
import { loadPreset, saveRun, savePreset } from '@/server/store/runs';
import type { RunState } from '@/shared/types';

const DAY = 24 * 60 * 60 * 1000;
const run = (id: string) => ({ id, status: 'done' }) as unknown as RunState;

describe('run store retention', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    resetEnvForTests();
    setKvForTests(undefined);
  });

  it('never keeps runs or presets past the event data expiry', async () => {
    const kv = new MemoryKV();
    setKvForTests(kv);
    vi.stubEnv('EVENT_DATA_EXPIRES_AT', new Date(Date.now() + 2 * DAY).toISOString());
    resetEnvForTests();

    await saveRun(run('abcdefghjkmn'));
    await savePreset('halfnote', run('abcdefghjkmn'));
    const runTtl = await kv.pttl('run:abcdefghjkmn');
    const presetTtl = await kv.pttl('preset:halfnote');
    expect(runTtl).toBeGreaterThan(2 * DAY - 60_000);
    expect(runTtl).toBeLessThanOrEqual(2 * DAY);
    expect(presetTtl).toBeLessThanOrEqual(2 * DAY);
    expect(await loadPreset('halfnote')).toMatchObject({ id: 'abcdefghjkmn' });
  });

  it('keeps the normal 14-day life when the expiry is far away, and an hour after it has passed', async () => {
    const kv = new MemoryKV();
    setKvForTests(kv);
    vi.stubEnv('EVENT_DATA_EXPIRES_AT', new Date(Date.now() + 60 * DAY).toISOString());
    resetEnvForTests();
    await saveRun(run('bbbbbbbbbbbb'));
    expect(await kv.pttl('run:bbbbbbbbbbbb')).toBeGreaterThan(14 * DAY - 60_000);

    vi.stubEnv('EVENT_DATA_EXPIRES_AT', new Date(Date.now() - DAY).toISOString());
    resetEnvForTests();
    await saveRun(run('cccccccccccc'));
    expect(await kv.pttl('run:cccccccccccc')).toBeLessThanOrEqual(60 * 60 * 1000);
  });
});
