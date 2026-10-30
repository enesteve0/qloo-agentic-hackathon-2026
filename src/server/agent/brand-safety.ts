import 'server-only';
import { normalizeName } from '../qloo/resolve';

/**
 * Brand safety for taste anchors: a short list of names that advertisers widely avoid. The planner may
 * still propose one; the run sets it aside before anything reaches Qloo and says so in the agent log.
 * Names are compared the way Qloo matches are (case, accents, punctuation and a leading "The" ignored).
 */
const AVOIDED = new Set(['Bill Cosby', 'The Cosby Show', 'R. Kelly', 'Kanye West', 'Ye'].map(normalizeName));

export function isBrandSafe(name: string): boolean {
  return !AVOIDED.has(normalizeName(name));
}
