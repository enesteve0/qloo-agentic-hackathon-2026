import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { GET } from '@/app/api/ad/route';
import { presetRun } from '@/server/agent/presets';
import { resetEnvForTests } from '@/server/env';
import { MemoryKV, setKvForTests } from '@/server/kv';
import { resetQlooClientForTests } from '@/server/qloo';

describe('GET /api/ad', () => {
  beforeAll(() => {
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

  it('renders an ad as a 1080×1920 PNG download', async () => {
    const run = (await presetRun('halfnote'))!;
    const nta = run.creative[0]!.nta;
    const res = await GET(new Request(`http://localhost:3000/api/ad?preset=halfnote&nta=${nta}&v=B`));
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/png');
    expect(res.headers.get('content-disposition')).toMatch(/attachment; filename="halfnote-supper-club-[a-z0-9]+-b\.png"/);
    const bytes = new Uint8Array(await res.arrayBuffer());
    expect([...bytes.slice(1, 4)].map((b) => String.fromCharCode(b)).join('')).toBe('PNG');
    // IHDR: width and height as big-endian 32-bit integers at bytes 16–23.
    const view = new DataView(bytes.buffer, bytes.byteOffset);
    expect([view.getUint32(16), view.getUint32(20)]).toEqual([1080, 1920]);
  }, 30_000);

  it('answers 404 for an unknown ad', async () => {
    expect((await GET(new Request('http://localhost:3000/api/ad?preset=halfnote&nta=XX9999&v=A'))).status).toBe(404);
    expect((await GET(new Request('http://localhost:3000/api/ad?run=nosuchrun123&nta=BK0302&v=A'))).status).toBe(404);
  });
});
