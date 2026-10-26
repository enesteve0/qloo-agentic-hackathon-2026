import 'server-only';
import { createHash, timingSafeEqual } from 'node:crypto';
import { getEnv } from '../env';

const digest = (s: string) => createHash('sha256').update(s).digest();

/** Bearer-token check for /api/admin/*. Without ADMIN_TOKEN configured, admin routes stay closed. */
export function isAdmin(req: Request): boolean {
  const token = getEnv().ADMIN_TOKEN;
  if (!token) return false;
  const header = req.headers.get('authorization') ?? '';
  const given = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  return given.length > 0 && timingSafeEqual(digest(given), digest(token));
}
