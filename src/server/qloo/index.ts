import 'server-only';
import { getEnv } from '@/server/env';
import { kv } from '@/server/kv';
import { createQlooClient, type QlooClient } from './client';
import { createLiveTransport } from './transport-live';
import { createDefaultMockTransport } from './transport-mock';

/**
 * Public surface of the Qloo module. Typical use in a run:
 *
 *   const qloo = getQlooClient().forRun(runCtxFor(stepCtx));
 *   const r = await qloo.heatmap({ signals: { entities: ids }, location: { wkt, label: 'NYC study' } });
 *   if (!r.ok) … r.code / failureKind(r)
 */

export type * from './types';
export {
  createQlooClient,
  createRunCtx,
  runCtxFor,
  failureKind,
  decideStatus,
  TIMEOUTS,
  RETRY_MIN_STAGE_MS,
  type QlooClient,
  type CreateQlooClientOptions,
  type QlooEnv,
} from './client';
export { QlooParamError, NYC_SEARCH_CENTER, polygonLabel, redactQuery, toEntityType, toQlooType } from './params';
export { cacheKey, canonicalQuery } from './keys';
export {
  CFG_MODE_KEY,
  LEDGER_KEYS,
  defaultCaps,
  etDay,
  parseCaps,
  parseRateHeaders,
  phaseAt,
  profileFromLimit,
  type ActivePhase,
  type CapsConfig,
  type LedgerSnapshot,
  type PhaseId,
  type QuotaProfile,
} from './ledger';
export {
  applyChoices,
  decideOutcome,
  issueFor,
  issuesFor,
  normalizeName,
  resolutionKey,
  resolveAnchors,
  resolveStage,
  type AnchorInput,
  type ResolveFailure,
  type ResolveResult,
} from './resolve';
export {
  WHAT_THIS_SUPPORTS,
  buildEnvelope,
  mapTasteLiftEnvelope,
  neighborhoodEvidenceEnvelope,
  resolveAnchorsEnvelope,
} from './envelope';
export { createLiveTransport, USER_AGENT } from './transport-live';
export { createDefaultMockTransport, createMockTransport, type MockTransport, type MockTransportOptions } from './transport-mock';
export { NODATA_PREFIX, SYNTHETIC_UUID_PREFIX, THIN_PREFIX, plantedBumps, prepareGrid } from './synthetic';

let singleton: QlooClient | undefined;

function build(): QlooClient {
  const env = getEnv();
  const store = kv();
  switch (env.QLOO_MODE) {
    case 'live':
      if (!env.QLOO_API_KEY) {
        throw new Error('QLOO_MODE=live requires QLOO_API_KEY (server-side only). Without a key use QLOO_MODE=mock or cache-only.');
      }
      return createQlooClient({
        transport: createLiveTransport({ apiKey: env.QLOO_API_KEY, baseUrl: env.QLOO_BASE_URL }),
        kv: store,
        env,
      });
    case 'mock':
      return createQlooClient({ transport: createDefaultMockTransport(), kv: store, env });
    case 'cache-only':
    case 'off':
      return createQlooClient({ transport: null, mode: env.QLOO_MODE, kv: store, env });
  }
}

/**
 * Process-wide client for QLOO_MODE: `live` (needs QLOO_API_KEY), `mock` (synthetic, labelled),
 * `cache-only` (serves cached live results, never calls Qloo) or `off` (every call → DISABLED).
 */
export function getQlooClient(): QlooClient {
  singleton ??= build();
  return singleton;
}

/** Test helper: forget the process-wide client (e.g. after changing QLOO_MODE). */
export function resetQlooClientForTests(): void {
  singleton = undefined;
}
