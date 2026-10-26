import 'server-only';
import type { Candidate, EntityType, HeatmapData, ProvenanceRequest, QlooPurpose } from '@/shared/types';

/**
 * Server-side types of the Qloo client. Raw Qloo payload shapes live only in schemas.ts and never
 * leave this module; everything exported here is normalized.
 */

// ---------------------------------------------------------------------------------------------
// Transport
// ---------------------------------------------------------------------------------------------

export interface TransportResponse {
  status: number;
  headers: Headers;
  json: unknown;
  /** Response body size in bytes when known (used by calibration to measure payloads). */
  bytes?: number;
}

/** One GET against the Qloo API (live) or the synthetic generator (mock). */
export interface QlooTransport {
  readonly kind: 'live' | 'mock';
  fetch(path: string, query: URLSearchParams, signal: AbortSignal): Promise<TransportResponse>;
}

export type QlooMode = 'live' | 'mock' | 'cache-only' | 'off';

/** Request families we use; each has its own parameter allow-list and timeout. */
export type RequestKind = 'root' | 'search' | 'entities' | 'heatmap' | 'places' | 'tags' | 'demographics';

// ---------------------------------------------------------------------------------------------
// Results
// ---------------------------------------------------------------------------------------------

export type QlooErrorCode =
  /** A local guard refused the call before reaching Qloo (run cap, daily cap, floor, breaker, mode). */
  | 'BUDGET_GUARD'
  /** Monthly quota exhausted (429 with month remaining 0); breaker open until reset. */
  | 'QUOTA_EXHAUSTED'
  /** Per-second 429 that persisted after one retry (or retries disabled). */
  | 'RATE_LIMITED'
  /** 401: wrong host/header or key; auth breaker open for 10 minutes. */
  | 'AUTH'
  /** 403 "You do not have permission to access urn:entity:…" — the key cannot use that type. */
  | 'TYPE_UNSUPPORTED'
  /** Any other 403. */
  | 'FORBIDDEN'
  /** 400 with Qloo's `errors[]` messages. */
  | 'BAD_REQUEST'
  | 'NOT_FOUND'
  /** 5xx after one retry, or an unexpected status. */
  | 'UPSTREAM'
  | 'TIMEOUT'
  | 'NETWORK'
  /** The caller's signal (run deadline or cancel) aborted the call. */
  | 'ABORTED'
  /** 200 whose body does not match even the loose schema. */
  | 'BAD_RESPONSE'
  /** All run slots are held by other runs (cross-run pacing). */
  | 'BUSY'
  /** QLOO_MODE=cache-only and the request is not cached. */
  | 'CACHE_ONLY'
  /** QLOO_MODE=off. */
  | 'DISABLED';

export type GuardReason =
  | 'mode'
  | 'exhausted'
  | 'auth'
  | 'run_cap'
  | 'daily_cap'
  | 'after_event'
  | 'floor'
  | 'ledger_unavailable';

export interface QlooMeta {
  /** Cache key (`q1:{sha256}`, prefixed `syn:` for the synthetic transport). */
  key: string;
  cache: 'hit' | 'miss';
  /** HTTP attempts made for this logical call (0 for cache hits and guarded calls). */
  attempts: number;
  ms: number;
  status: number | null;
  requestId: string | null;
  /** Month quota remaining from the last response headers, when present. */
  monthRemaining: number | null;
  /** When a cache hit was originally fetched (ISO). */
  cachedAt: string | null;
  bytes: number | null;
}

export interface QlooIssue {
  message: string;
  path: string | null;
}

export type QlooResult<T> =
  | { ok: true; data: T; meta: QlooMeta }
  | { ok: false; code: QlooErrorCode; message: string; meta: QlooMeta; reason?: GuardReason; issues?: QlooIssue[] };

export type QlooFailure = Extract<QlooResult<unknown>, { ok: false }>;

// ---------------------------------------------------------------------------------------------
// Normalized data
// ---------------------------------------------------------------------------------------------

export interface PlaceTag {
  id: string;
  name: string;
  /** Qloo tag type URN, e.g. `urn:tag:cuisine:qloo`. */
  type: string;
  /** Short kind derived from the type: `cuisine`, `ambience`, `category`, `genre`, `good_for`, … */
  kind: string;
}

/** A place returned by place insights, in Qloo's rank order. */
export interface PlaceEv {
  id: string;
  name: string;
  affinity: number | null;
  popularity: number | null;
  tags: PlaceTag[];
  /** Names of category/genre tags (for EvidencePlace.categories). */
  categories: string[];
  /** Explainability: which signal entities drove this place's affinity. */
  explain: { anchorId: string; score: number }[];
  geohash: string | null;
  priceLevel: number | null;
  rating: number | null;
}

export interface TagEv {
  id: string;
  name: string;
  type: string;
  kind: string;
  affinity: number | null;
}

export interface DemographicsEv {
  entityId: string;
  age: Record<string, number | null>;
  gender: Record<string, number | null>;
}

export interface RateWindow {
  limit: number | null;
  remaining: number | null;
  /** Seconds until the window resets. */
  resetSec: number | null;
}

export interface RateInfo {
  second: RateWindow | null;
  month: RateWindow | null;
  requestId: string | null;
}

export interface RootInfo {
  name: string | null;
  version: string | null;
  rate: RateInfo;
}

export type { Candidate, EntityType, HeatmapData };

// ---------------------------------------------------------------------------------------------
// Run context
// ---------------------------------------------------------------------------------------------

export interface RunCtxOptions {
  runId: string;
  /** Run-level abort signal (run deadline or cancellation). */
  signal?: AbortSignal;
  /** Current stage deadline (epoch ms); transient retries need ≥8 s of it left. */
  deadlineAt?: number;
  /** Fresh-attempt cap for this run; defaults to QLOO_MAX_FRESH_PER_RUN. */
  maxFresh?: number;
  actor?: 'public' | 'script';
  /** Scripts only: bypass the phase daily cap and floor (absolute floor still applies). */
  force?: boolean;
  /** Scripts may disable retries (the calibration script aborts on any 429 instead). */
  retries?: boolean;
  /** Called once per attempt / cache hit with a redacted request record. */
  onRequest?: (req: ProvenanceRequest) => void;
}

export interface RunStats {
  /** Logical calls that went to Qloo. */
  fresh: number;
  /** Logical calls served from cache (including in-flight de-duplication). */
  cached: number;
  /** HTTP attempts (fresh calls plus retries); the per-run cap applies to this. */
  attempts: number;
  /** Calls refused locally (guards, busy slots, remembered unsupported types). */
  guarded: number;
}

export interface RunCtx {
  readonly runId: string;
  readonly signal: AbortSignal | undefined;
  deadlineAt: number | undefined;
  readonly maxFresh: number | undefined;
  readonly actor: 'public' | 'script';
  readonly force: boolean;
  readonly retries: boolean;
  onRequest: ((req: ProvenanceRequest) => void) | undefined;
  readonly stats: RunStats;
  /** Every request record of this run, in order (also delivered via onRequest). */
  readonly requests: ProvenanceRequest[];
}

export type CacheMode = 'default' | 'refresh' | 'skip';

export interface CallOptions {
  purpose?: QlooPurpose;
  /** `refresh` skips the cache read but stores the result; `skip` neither reads nor writes. */
  cache?: CacheMode;
  timeoutMs?: number;
  /** Overrides RunCtx.deadlineAt for this call. */
  deadlineAt?: number;
}

export interface SearchOptions extends CallOptions {
  take?: number;
  /** Places only; defaults to NYC (40.7128,-74.0060) within 25 miles. */
  location?: { lat: number; lon: number; radiusMiles: number } | null;
}

export interface WktLocation {
  wkt: string;
  /** Shown in provenance instead of the polygon, e.g. `NTA BK0102` → `POLYGON(NTA BK0102)`. */
  label?: string;
}

export interface HeatmapSignals {
  entities?: string[];
  tags?: string[];
  demographics?: { age?: string[]; gender?: string[] };
}

export interface HeatmapRequest extends CallOptions {
  signals: HeatmapSignals;
  location: WktLocation | { query: string };
  /** Optional `output.heatmap.boundary` (calibration H1 only). */
  boundary?: string;
}

export interface PlacesRequest extends CallOptions, WktLocation {
  entityIds: string[];
  take?: number;
  explain?: boolean;
}

export interface TagInsightsRequest extends CallOptions {
  tagTypes?: string[];
  location?: WktLocation;
  entityIds?: string[];
  take?: number;
}

/** Typed Qloo calls bound to one run. */
export interface QlooApi {
  readonly ctx: RunCtx;
  readonly mode: QlooMode;
  /** True when data comes from the synthetic transport (label results SYNTHETIC). */
  readonly synthetic: boolean;
  search(query: string, type: EntityType, opts?: SearchOptions): Promise<QlooResult<Candidate[]>>;
  entities(ids: string[], opts?: CallOptions): Promise<QlooResult<Candidate[]>>;
  heatmap(req: HeatmapRequest): Promise<QlooResult<HeatmapData>>;
  places(req: PlacesRequest): Promise<QlooResult<PlaceEv[]>>;
  tagInsights(req: TagInsightsRequest): Promise<QlooResult<TagEv[]>>;
  demographics(ids: string[], opts?: CallOptions): Promise<QlooResult<DemographicsEv[]>>;
  root(opts?: CallOptions): Promise<QlooResult<RootInfo>>;
  /** Small derived-data cache in the client's namespace (used for resolution outcomes). */
  readonly memo: {
    get<T>(key: string): Promise<T | null>;
    set(key: string, value: unknown): Promise<void>;
  };
}
