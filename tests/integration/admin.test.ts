import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { GET as health } from '@/app/api/admin/health/route';
import { POST as record } from '@/app/api/admin/record/route';
import { resetEnvForTests } from '@/server/env';
import { MemoryKV, setKvForTests } from '@/server/kv';
import { resetQlooClientForTests } from '@/server/qloo';
import { loadPreset } from '@/server/store/runs';

const TOKEN = 'test-admin-token-0123456789abcdef';
const req = (url: string, init: RequestInit = {}, token: string | null = TOKEN) =>
  new Request(`http://localhost:3000${url}`, {
    ...init,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
  });

describe('admin routes', () => {
  beforeAll(() => {
    vi.stubEnv('ADMIN_TOKEN', TOKEN);
    vi.stubEnv('QLOO_RUN_RPS', '50');
    resetEnvForTests();
    resetQlooClientForTests();
    setKvForTests(new MemoryKV());
  });
  afterAll(() => {
    vi.unstubAllEnvs();
    resetEnvForTests();
    resetQlooClientForTests();
    setKvForTests(undefined);
  });

  it('hide themselves without the bearer token', async () => {
    expect((await health(req('/api/admin/health', {}, null))).status).toBe(404);
    expect((await health(req('/api/admin/health', {}, 'wrong-token-wrong-token-wrong'))).status).toBe(404);
    expect((await record(req('/api/admin/record', { method: 'POST', body: '{"slug":"halfnote"}' }, null))).status).toBe(404);
  });

  it('records a preset and reports it in health', async () => {
    expect((await record(req('/api/admin/record', { method: 'POST', body: '{"slug":"nope"}' }))).status).toBe(400);

    const res = await record(req('/api/admin/record', { method: 'POST', body: '{"slug":"halfnote"}' }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; label: { kind: string }; top: unknown[] };
    expect(body.ok).toBe(true);
    expect(body.label.kind).toBe('synthetic'); // mock mode never claims RECORDED
    expect(body.top.length).toBeGreaterThan(0);
    expect((await loadPreset('halfnote'))?.status).toBe('done');

    const h = (await (await health(req('/api/admin/health'))).json()) as {
      modes: { qloo: string };
      presets: { slug: string; recorded: boolean }[];
    };
    expect(h.modes.qloo).toBe('mock');
    expect(h.presets.find((p) => p.slug === 'halfnote')?.recorded).toBe(true);
    expect(JSON.stringify(h)).not.toContain(TOKEN);
  });
});
