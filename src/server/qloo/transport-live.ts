import 'server-only';
import type { QlooTransport, TransportResponse } from './types';

/**
 * Live Qloo transport: one GET with the key in the `X-Api-Key` header. It never logs anything, so
 * the key cannot leak through logs, and it refuses redirects so the header is never replayed to
 * another host.
 */

export const USER_AGENT = 'stoop/0.1';

export interface LiveTransportOptions {
  apiKey: string;
  baseUrl: string;
  fetchImpl?: typeof fetch;
  userAgent?: string;
}

export function createLiveTransport(o: LiveTransportOptions): QlooTransport {
  if (!o.apiKey) throw new Error('The live Qloo transport needs QLOO_API_KEY');
  const base = new URL(o.baseUrl);
  const fetchImpl = o.fetchImpl ?? fetch;
  const headers = {
    'X-Api-Key': o.apiKey,
    Accept: 'application/json',
    'User-Agent': o.userAgent ?? USER_AGENT,
  };
  return {
    kind: 'live',
    async fetch(path, query, signal): Promise<TransportResponse> {
      const url = new URL(path, base);
      // URLSearchParams writes spaces as '+'; %20 is unambiguous everywhere (a literal '+' is %2B).
      url.search = query.toString().replace(/\+/g, '%20');
      const res = await fetchImpl(url, { method: 'GET', headers, signal, redirect: 'error' });
      const text = await res.text();
      let json: unknown = null;
      if (text) {
        try {
          json = JSON.parse(text);
        } catch {
          json = text.slice(0, 2_000); // non-JSON error pages are kept as text for the error message
        }
      }
      return { status: res.status, headers: res.headers, json, bytes: Buffer.byteLength(text) };
    },
  };
}
