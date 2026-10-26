import 'server-only';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { getEnv } from '../env';

export const SESSION_COOKIE = 'stoop_sid';
const MAX_AGE_S = 60 * 60 * 24 * 30;

let fallbackSecret: string | undefined;

function secret(): string {
  const configured = getEnv().SESSION_SECRET;
  if (configured) return configured;
  // Without a configured secret, sessions still work per instance; limits fall back to IP keys.
  fallbackSecret ??= randomBytes(32).toString('hex');
  return fallbackSecret;
}

const sign = (id: string) => createHmac('sha256', secret()).update(id).digest('base64url').slice(0, 22);

export function readSession(cookieHeader: string | null): string | null {
  const raw = cookieHeader
    ?.split(';')
    .map((c) => c.trim())
    .find((c) => c.startsWith(`${SESSION_COOKIE}=`))
    ?.slice(SESSION_COOKIE.length + 1);
  if (!raw) return null;
  const [id, mac] = raw.split('.');
  if (!id || !mac || !/^[A-Za-z0-9_-]{16,32}$/.test(id)) return null;
  // Compare bytes, not characters: a tampered non-ASCII signature must not throw.
  const given = Buffer.from(mac);
  const expected = Buffer.from(sign(id));
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  return id;
}

export function newSession(): { id: string; setCookie: string } {
  const id = randomBytes(16).toString('base64url');
  const secure = getEnv().NODE_ENV === 'production' ? '; Secure' : '';
  return { id, setCookie: `${SESSION_COOKIE}=${id}.${sign(id)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${MAX_AGE_S}${secure}` };
}
