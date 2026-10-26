/**
 * Client-safe domain types shared by server modules and the UI.
 * This file is the contract between the Qloo client, the lift engine, the evidence/creative/plan/proof
 * stages, the agent orchestrator and the React UI. Never put secrets or raw Qloo payload types here.
 */

// ---------------------------------------------------------------------------------------------
// Qloo entities and resolution
// ---------------------------------------------------------------------------------------------

export const ENTITY_TYPES = ['artist', 'book', 'brand', 'movie', 'person', 'place', 'podcast', 'tv_show'] as const;
export type EntityType = (typeof ENTITY_TYPES)[number];

/** A Qloo entity candidate as shown to people (never show raw URNs in questions). */
export interface Candidate {
  id: string;
  name: string;
  type: EntityType;
  /** Short human context from Qloo (e.g. "Film · 2020", "Brooklyn, NY"). */
  disambiguation: string | null;
  popularity: number | null;
  year: number | null;
}

export type MatchKind = 'exact' | 'semantic' | 'identifier' | 'chosen';

export type ResolutionOutcome =
  | {
      input: string;
      type: EntityType;
      status: 'resolved';
      match: MatchKind;
      selected: Candidate;
      alternatives: Candidate[];
      warnings: string[];
    }
  | {
      input: string;
      type: EntityType;
      status: 'ambiguous' | 'not_found';
      candidates: Candidate[];
    };

export interface ResolutionIssue {
  input: string;
  type: EntityType;
  kind: 'ambiguous' | 'not_found';
  /** Plain-language question for the picker. */
  question: string;
  candidates: Candidate[];
}

/** The owner's answer to one issue; `entityId: null` means "drop this anchor". */
export interface ResolutionChoice {
  input: string;
  entityId: string | null;
}

// ---------------------------------------------------------------------------------------------
// Provenance (mirrors the official harness envelope semantics; no raw payloads)
// ---------------------------------------------------------------------------------------------

export type QlooPurpose = 'resolve' | 'heatmap' | 'baseline' | 'evidence' | 'calibration' | 'backtest' | 'contract' | 'health';

export interface ProvenanceRequest {
  method: 'GET';
  path: string;
  /** Redacted query string: no key; WKT polygons replaced by labels like POLYGON(NTA BK0102). */
  query: string;
  status: number | null;
  cache: 'hit' | 'miss';
  ms: number;
  attempt: number;
  purpose: QlooPurpose;
}

export type StageOperation = 'resolve_anchors' | 'map_taste_lift' | 'neighborhood_evidence';

export interface StageEnvelope {
  operation: StageOperation;
  status: 'ok' | 'needs_input' | 'error';
  query_intent: {
    job: string;
    target: string;
    signals: string[];
    filters: string[];
    assumptions: string[];
    unresolved: string[];
  };
  interpretation: string;
  result_count: number;
  execution: { transport: 'direct-rest' | 'mock'; correlation_id: string; duration_ms: number };
  provenance: { source: 'Qloo API' | 'Synthetic Qloo transport'; requests: ProvenanceRequest[] };
  what_this_supports: string;
  warnings: string[];
}

// ---------------------------------------------------------------------------------------------
// Static public data (built by scripts/build-geo.ts from NYC Open Data)
// ---------------------------------------------------------------------------------------------

export type KioskType = 'LINK1.0' | 'LINK5G_AD';

export interface Kiosk {
  /** Stable index into kiosks.json; used for compact per-kiosk arrays. */
  i: number;
  siteId: string;
  lat: number;
  lon: number;
  type: KioskType;
  boro: string;
  address: string;
  cross1: string | null;
  cross2: string | null;
  /** 2020 NTA code (assigned by coordinates). */
  nta: string;
  gh6: string;
  /** Set when the kiosk sat in a non-residential NTA and was reassigned to the nearest residential one. */
  ntaReassigned: boolean;
}

export interface NtaInfo {
  code: string;
  name: string;
  /** Short display name used on street plates and in ad copy. */
  short: string;
  boro: string;
  centroid: [lon: number, lat: number];
  bbox: [minLon: number, minLat: number, maxLon: number, maxLat: number];
  /** WKT POLYGON in lon-lat order, ≤80 vertices, for Qloo filter.location / signal.location. */
  wkt: string;
  adKiosks: number;
  residential: boolean;
}

// ---------------------------------------------------------------------------------------------
// WHERE — heatmaps and lift
// ---------------------------------------------------------------------------------------------

/** One heatmap cell as normalized from Qloo (lat/lon are decoded from the geohash when needed). */
export interface HeatCell {
  gh: string;
  aff: number | null;
  rank: number | null;
  pop: number | null;
}

export interface HeatmapData {
  cells: HeatCell[];
  locality: { id: string; name: string; disambiguation: string | null } | null;
}

export type AnchorFlag = 'DEFAULT_MAP' | 'IDENTICAL_PAIR' | 'DENSITY_ONLY' | 'THIN';

export interface LiftConfig {
  metric: 'affinity' | 'affinity_rank';
  baseline: 'B0' | 'B1' | 'B2' | 'B3' | 'B4';
  form: 'difference' | 'residual';
  kappa: number;
  thresholds: {
    defaultMapRho: number;
    identicalRho: number;
    densityOnlyRho: number;
    thinMinCells: number;
    thinMinOverlap: number;
  };
  /** True when calibration could not validate the configuration; the UI then says "experimental". */
  experimental: boolean;
}

export interface AnchorMapInfo {
  anchorId: string;
  name: string;
  flags: AnchorFlag[];
  weight: number;
  coverage: number;
  cells: number;
}

export type Confidence = 'high' | 'medium' | 'low';

export interface NtaScore {
  code: string;
  name: string;
  short: string;
  boro: string;
  /** Shrunk aggregate lift L̂ (z units). */
  lift: number;
  se: number;
  nEff: number;
  /** Share of included anchors with positive lift here. */
  agreement: number;
  confidence: Confidence;
  /** 0–100 percentile of lift among eligible neighborhoods. */
  fitIndex: number;
  /** Display multiplier, e.g. 2.3 for "2.3× taste signal vs NYC baseline". */
  multiplier: number;
  topAnchors: { anchorId: string; contribution: number }[];
  adKiosks: number;
}

export interface WhereResult {
  config: LiftConfig;
  anchors: AnchorMapInfo[];
  /** Eligible neighborhoods sorted by lift, descending. */
  ntas: NtaScore[];
  /** Per kiosk index (kiosks.json order): 0–100 fit percentile, or -1 when not scored. */
  kioskFit: number[];
  /** Heat layer for the map: geohash cells with display lift (only cells above baseline). */
  heat: { gh: string; v: number }[];
  grid: { cells: number; covered: number };
}

// ---------------------------------------------------------------------------------------------
// WHAT — neighborhood evidence and creative
// ---------------------------------------------------------------------------------------------

export interface EvidenceItem {
  /** Stable id: `ev:<nta>:<tagId>`. */
  id: string;
  kind: 'tag' | 'category';
  label: string;
  tagType: string;
  weight: number;
  /** Number of local places carrying this tag. */
  support: number;
}

export interface EvidencePlace {
  id: string;
  name: string;
  categories: string[];
  /** Explainability: which anchors drove this place's affinity. */
  explain: { anchorId: string; score: number }[];
}

export interface EvidencePack {
  nta: string;
  shortName: string;
  items: EvidenceItem[];
  places: EvidencePlace[];
}

export interface AdReference {
  evidenceId: string;
  phrase: string;
}

export interface AdVariant {
  nta: string;
  variant: 'A' | 'B';
  headline: string;
  body: string;
  cta: string;
  references: AdReference[];
  rationale: string;
}

export type CopyRule =
  | 'length'
  | 'emoji'
  | 'refs'
  | 'foreign_local'
  | 'ungrounded_proper_noun'
  | 'sensitive'
  | 'invented_number'
  | 'missing_business';

export interface GroundingResult {
  ok: boolean;
  failed: { rule: CopyRule; detail: string }[];
  replacedByTemplate: boolean;
}

export interface CreativeVariant extends AdVariant {
  grounding: GroundingResult;
  source: 'model' | 'template';
}

export interface CreativeSet {
  nta: string;
  variants: CreativeVariant[];
  /** Model slot id that wrote it, or "template". */
  via: string;
}

// ---------------------------------------------------------------------------------------------
// PLAN — deterministic budget optimizer
// ---------------------------------------------------------------------------------------------

export interface PricingAssumptions {
  label: 'assumption';
  pricePerKioskWeek: { manhattan: number; outer: number };
  impressionsPerKioskWeek: { manhattan: number; outer: number };
}

export interface PlannedScreen {
  i: number;
  siteId: string;
  nta: string;
  fit: number;
  weeklyImpressions: number;
  cost: number;
}

export interface MediaPlan {
  budgetUsd: number;
  weeks: number;
  assumptions: PricingAssumptions;
  screens: PlannedScreen[];
  byNta: { nta: string; screens: number; spend: number; tasteWeightedImpressions: number }[];
  totals: { spend: number; impressions: number; tasteWeightedImpressions: number; screens: number };
  leftoverUsd: number;
  nextBest: PlannedScreen[];
  infeasibleReason: string | null;
}

// ---------------------------------------------------------------------------------------------
// PROOF — LLM-only comparison
// ---------------------------------------------------------------------------------------------

export interface Proof {
  available: boolean;
  llmPicks: { nta: string; reason: string; percentile: number | null }[];
  /** Overlap between the LLM's 5 picks and Stoop's top 5 neighborhoods. */
  overlapAt5: number;
  medianLlmPercentile: number | null;
  ours: { tasteWeightedImpressions: number; belowBaselineShare: number };
  llmOnly: { tasteWeightedImpressions: number; belowBaselineShare: number } | null;
  missedByLlm: { nta: string; evidence: string[] } | null;
  note: string;
}

// ---------------------------------------------------------------------------------------------
// Brief, planner output, labels and run state
// ---------------------------------------------------------------------------------------------

export interface Brief {
  business: string;
  description: string;
  offer: string | null;
  budgetUsd: number;
  weeks: number;
  startDate: string | null;
  /** Optional; used only locally (never sent to Qloo or written into ads beyond the footer). */
  address: string | null;
}

export type Tone = 'playful' | 'warm' | 'bold' | 'premium' | 'community';

export interface PlannerOutput {
  business: { name: string | null; category: string; offer: string | null };
  audienceSummary: string;
  anchors: { name: string; type: EntityType; searchHint: string | null; why: string }[];
  tone: Tone;
  llmOnlyNeighborhoods: { ntaCode: string; reason: string }[];
  budgetUsd: number | null;
  weeks: number | null;
  /** Set when the deterministic fallback produced this plan instead of a model. */
  fallback: boolean;
}

/**
 * The client-safe slice of one street screen, picked on the server from kiosks.json
 * (`placesForRun`). The full kiosk file never ships to the browser.
 */
export type ScreenPlace = Pick<Kiosk, 'i' | 'siteId' | 'address' | 'cross1' | 'cross2' | 'nta' | 'boro' | 'type'>;

/** Kiosk index (Kiosk.i) → place. */
export type PlaceLookup = Record<number, ScreenPlace>;

/** The booking package for SEND, drafted on the server from the plan. */
export interface SendDraft {
  subject: string;
  body: string;
  /** `mailto:` URL (recipient and optional params); subject and body are re-encoded from the edited text. */
  mailto: string;
  /** Link to the screen list CSV, or null when exports are unavailable. */
  csvHref: string | null;
}

/** Server-derived extras for a run's screen: street places for mockups and the plan table, and the SEND draft. */
export interface RunExtras {
  places: PlaceLookup;
  send: SendDraft | null;
  /**
   * The six best free screens for an owner who qualifies for LinkNYC's LinkLocal program (six screens at
   * a time at no cost), spread across the top neighborhoods; null before WHERE.
   */
  linkLocal: PlannedScreen[] | null;
}

export type ResultLabel =
  | { kind: 'live'; model: string | null; qloo: { fresh: number; cached: number } }
  | { kind: 'cached'; at: string }
  | { kind: 'recorded'; at: string; model: string | null; qlooCalls: number }
  | { kind: 'qloo_only'; reason: string }
  | { kind: 'synthetic' };

export type StageId = 'intake' | 'plan' | 'resolve' | 'where' | 'evidence' | 'creative' | 'optimize' | 'proof' | 'finalize';
export type StageStatus = 'pending' | 'running' | 'done' | 'skipped' | 'needs_input' | 'degraded' | 'error';

export interface StageInfo {
  stage: StageId;
  status: StageStatus;
  title: string;
  detail: string | null;
  ms: number | null;
}

export type RunStatus = 'running' | 'awaiting_input' | 'done' | 'error';

export interface RunState {
  id: string;
  createdAt: string;
  updatedAt: string;
  status: RunStatus;
  mode: 'live' | 'mock';
  presetSlug: string | null;
  brief: Brief;
  planner: PlannerOutput | null;
  resolution: { outcomes: ResolutionOutcome[]; issues: ResolutionIssue[] } | null;
  where: WhereResult | null;
  evidence: EvidencePack[];
  creative: CreativeSet[];
  plan: MediaPlan | null;
  proof: Proof | null;
  stages: StageInfo[];
  decisions: { stage: StageId; text: string }[];
  envelopes: StageEnvelope[];
  label: ResultLabel | null;
  qlooCalls: { fresh: number; cached: number };
  llm: { via: string[]; attempts: number };
  error: string | null;
  /** Why a run stopped, for the server's fallback decision (absent on runs saved before it existed). */
  errorCode?: 'anchors' | 'no_signal' | 'qloo_quota' | 'qloo_unavailable' | 'qloo_busy' | 'deadline' | 'other' | null;
}
