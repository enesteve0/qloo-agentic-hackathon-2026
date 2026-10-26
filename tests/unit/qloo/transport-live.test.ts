import { describe, expect, it } from 'vitest';
import { buildHeatmap } from '@/server/qloo/params';
import { USER_AGENT, createLiveTransport } from '@/server/qloo/transport-live';

const KEY = 'test-key-not-real';

function fakeFetch(body: string, status = 200, headers: Record<string, string> = {}) {
  const seen: { url: string; init: RequestInit }[] = [];
  const impl = (async (url: URL | RequestInfo, init?: RequestInit) => {
    seen.push({ url: String(url), init: init ?? {} });
    return new Response(body === '' ? null : body, { status, headers });
  }) as typeof fetch;
  return { impl, seen };
}

describe('live transport', () => {
  it('sends the key only in X-Api-Key, with Accept and User-Agent, and refuses redirects', async () => {
    const { impl, seen } = fakeFetch('{"results":[]}', 200, { 'x-month-ratelimit-remaining': '9000' });
    const t = createLiveTransport({ apiKey: KEY, baseUrl: 'https://hackathon.api.qloo.com', fetchImpl: impl });
    const query = buildHeatmap({ signals: { entities: ['a'] }, location: { wkt: 'POLYGON((-73.9 40.7, -73.8 40.7, -73.8 40.8, -73.9 40.7))' } });
    const res = await t.fetch('/v2/insights', query, new AbortController().signal);

    expect(t.kind).toBe('live');
    expect(res).toMatchObject({ status: 200, json: { results: [] }, bytes: 14 });
    expect(res.headers.get('x-month-ratelimit-remaining')).toBe('9000');
    const [call] = seen;
    expect(call?.init).toMatchObject({ method: 'GET', redirect: 'error', headers: { 'X-Api-Key': KEY, Accept: 'application/json', 'User-Agent': USER_AGENT } });
    expect(USER_AGENT).toBe('stoop/0.1');
    expect(call?.url.startsWith('https://hackathon.api.qloo.com/v2/insights?filter.type=urn%3Aheatmap&filter.location=POLYGON%28%28-73.9%2040.7')).toBe(true);
    expect(call?.url).not.toContain(KEY);
    expect(call?.url).not.toContain('+');
  });

  it('keeps non-JSON bodies as text and empty bodies as null', async () => {
    const html = createLiveTransport({ apiKey: KEY, baseUrl: 'https://hackathon.api.qloo.com', fetchImpl: fakeFetch('<html>Bad gateway</html>', 502).impl });
    expect(await html.fetch('/', new URLSearchParams(), new AbortController().signal)).toMatchObject({ status: 502, json: '<html>Bad gateway</html>' });
    const empty = createLiveTransport({ apiKey: KEY, baseUrl: 'https://hackathon.api.qloo.com', fetchImpl: fakeFetch('', 204).impl });
    expect(await empty.fetch('/', new URLSearchParams(), new AbortController().signal)).toMatchObject({ status: 204, json: null, bytes: 0 });
  });

  it('requires a key', () => {
    expect(() => createLiveTransport({ apiKey: '', baseUrl: 'https://hackathon.api.qloo.com' })).toThrow(/QLOO_API_KEY/);
  });
});
