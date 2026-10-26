import 'server-only';

/** Same-origin POSTs only: blocks cross-site form posts and casual scripted abuse of the run endpoint. */
export function isSameOrigin(req: Request): boolean {
  const site = req.headers.get('sec-fetch-site');
  if (site) return site === 'same-origin' || site === 'none';
  const origin = req.headers.get('origin');
  if (!origin) return true; // Non-browser clients without Origin are rate-limited like everyone else.
  try {
    return new URL(origin).host === new URL(req.url).host;
  } catch {
    return false;
  }
}
