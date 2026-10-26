import 'server-only';
import type { ProvenanceRequest, ResolutionIssue, ResolutionOutcome, StageEnvelope, StageOperation } from '@/shared/types';

/**
 * Stage envelopes for the provenance drawer (ARCHITECTURE §4). Field semantics mirror the official
 * qloo-harness envelope; no harness code is used. Every envelope says what its result supports and,
 * just as important, what it does not.
 */

export const WHAT_THIS_SUPPORTS: Readonly<Record<StageOperation, string>> = {
  resolve_anchors:
    'Which Qloo entities stand for the taste anchors in your brief. A name match only: not a measure of quality, popularity or fit; says nothing about any individual.',
  map_taste_lift:
    "Where your anchor audience's Qloo signal ranks higher than NYC's overall signal. Not foot traffic, population or visits; says nothing about any individual.",
  neighborhood_evidence:
    'Which kinds of local places and tags Qloo associates with your anchors inside each neighborhood. Describes places, not the people who live or visit there; says nothing about any individual.',
};

type QueryIntent = StageEnvelope['query_intent'];

export interface EnvelopeInput {
  operation: StageOperation;
  status: StageEnvelope['status'];
  /** True when the data came from the synthetic transport. */
  synthetic: boolean;
  correlationId: string;
  durationMs: number;
  requests: readonly ProvenanceRequest[];
  interpretation: string;
  resultCount: number;
  queryIntent?: Partial<QueryIntent>;
  warnings?: readonly string[];
}

export function buildEnvelope(i: EnvelopeInput): StageEnvelope {
  return {
    operation: i.operation,
    status: i.status,
    query_intent: { job: '', target: '', signals: [], filters: [], assumptions: [], unresolved: [], ...i.queryIntent },
    interpretation: i.interpretation,
    result_count: i.resultCount,
    execution: {
      transport: i.synthetic ? 'mock' : 'direct-rest',
      correlation_id: i.correlationId,
      duration_ms: Math.max(0, Math.round(i.durationMs)),
    },
    provenance: { source: i.synthetic ? 'Synthetic Qloo transport' : 'Qloo API', requests: [...i.requests] },
    what_this_supports: WHAT_THIS_SUPPORTS[i.operation],
    warnings: [...(i.warnings ?? [])],
  };
}

interface Common {
  synthetic: boolean;
  correlationId: string;
  durationMs: number;
  requests: readonly ProvenanceRequest[];
  warnings?: readonly string[];
}

const TYPE_WORD: Record<string, string> = {
  artist: 'artist',
  book: 'book',
  brand: 'brand',
  movie: 'film',
  person: 'person',
  place: 'place',
  podcast: 'podcast',
  tv_show: 'TV show',
};

function quoteList(items: readonly string[]): string {
  const q = items.map((s) => `“${s}”`);
  return q.length <= 1 ? (q[0] ?? '') : `${q.slice(0, -1).join(', ')} and ${q[q.length - 1]}`;
}

export interface ResolveEnvelopeInput extends Common {
  anchors: readonly { name: string; type: string }[];
  outcomes: readonly ResolutionOutcome[];
  issues: readonly ResolutionIssue[];
  /** Anchors whose search failed (quota, network…), with a plain message. */
  failures?: readonly { input: string; message: string }[];
}

export function resolveAnchorsEnvelope(i: ResolveEnvelopeInput): StageEnvelope {
  const resolved = i.outcomes.filter((o) => o.status === 'resolved');
  const ambiguous = i.issues.filter((x) => x.kind === 'ambiguous').map((x) => x.input);
  const failed = new Set((i.failures ?? []).map((f) => f.input));
  const missing = i.outcomes.filter((o) => o.status === 'not_found' && !failed.has(o.input)).map((o) => o.input);
  const parts = [`Matched ${resolved.length} of ${i.outcomes.length} anchors in Qloo.`];
  if (ambiguous.length) parts.push(`${quoteList(ambiguous)} could mean more than one thing.`);
  if (missing.length) parts.push(`No Qloo match for ${quoteList(missing)}.`);
  if (failed.size) parts.push(`Qloo could not be searched for ${quoteList([...failed])}.`);
  const warnings = [
    ...resolved.flatMap((o) => (o.status === 'resolved' ? o.warnings : [])),
    ...(i.failures ?? []).map((f) => `${f.input}: ${f.message}`),
    ...(i.warnings ?? []),
  ];
  return buildEnvelope({
    operation: 'resolve_anchors',
    status: ambiguous.length ? 'needs_input' : i.outcomes.length > 0 && failed.size === i.outcomes.length ? 'error' : 'ok',
    synthetic: i.synthetic,
    correlationId: i.correlationId,
    durationMs: i.durationMs,
    requests: i.requests,
    interpretation: parts.join(' '),
    resultCount: resolved.length,
    queryIntent: {
      job: 'Match each taste anchor in the brief to one Qloo entity',
      target: 'Qloo entities (artists, films, TV shows, places, brands, books, podcasts, people)',
      signals: i.anchors.map((a) => `${a.name} (${TYPE_WORD[a.type] ?? a.type})`),
      filters: ['up to 5 candidates per anchor', 'places: within 25 miles of NYC'],
      assumptions: [
        'Names are compared without accents, punctuation or a leading “The”',
        'A match found through the description instead of the exact name is flagged',
      ],
      unresolved: [...ambiguous, ...missing],
    },
    warnings,
  });
}

export interface LiftEnvelopeInput extends Common {
  status?: StageEnvelope['status'];
  anchors: readonly { name: string }[];
  /** Plain description of the baseline, e.g. "each anchor's own popularity map (B4)". */
  baseline: string;
  /** Location form shown to people, e.g. "NYC study polygon". */
  location: string;
  /** Number of grid cells with a lift value. */
  cells: number;
  interpretation?: string;
}

export function mapTasteLiftEnvelope(i: LiftEnvelopeInput): StageEnvelope {
  const names = i.anchors.map((a) => a.name);
  return buildEnvelope({
    operation: 'map_taste_lift',
    status: i.status ?? 'ok',
    synthetic: i.synthetic,
    correlationId: i.correlationId,
    durationMs: i.durationMs,
    requests: i.requests,
    interpretation:
      i.interpretation ??
      `Compared where the Qloo signal for ${quoteList(names)} ranks against ${i.baseline} across ${i.cells.toLocaleString('en-US')} NYC grid cells.`,
    resultCount: i.cells,
    queryIntent: {
      job: 'Map where the anchors’ taste signal ranks higher than NYC’s overall signal',
      target: 'Qloo heatmap cells over New York City',
      signals: names,
      filters: [`location: ${i.location}`],
      assumptions: [
        `Baseline: ${i.baseline}`,
        'Lift compares rank-normalized scores, so only the order of cells matters',
      ],
      unresolved: [],
    },
    warnings: i.warnings,
  });
}

export interface EvidenceEnvelopeInput extends Common {
  status?: StageEnvelope['status'];
  neighborhoods: readonly { code: string; short: string }[];
  anchors: readonly { name: string }[];
  /** Local places read across all neighborhoods. */
  places: number;
  interpretation?: string;
}

export function neighborhoodEvidenceEnvelope(i: EvidenceEnvelopeInput): StageEnvelope {
  return buildEnvelope({
    operation: 'neighborhood_evidence',
    status: i.status ?? 'ok',
    synthetic: i.synthetic,
    correlationId: i.correlationId,
    durationMs: i.durationMs,
    requests: i.requests,
    interpretation:
      i.interpretation ??
      `Read ${i.places} local places Qloo ranks for ${quoteList(i.anchors.map((a) => a.name))} in ${quoteList(i.neighborhoods.map((n) => n.short))}.`,
    resultCount: i.places,
    queryIntent: {
      job: 'Find what each top neighborhood’s local places share with the anchors’ taste',
      target: 'Qloo places inside each neighborhood polygon',
      signals: i.anchors.map((a) => a.name),
      filters: [...i.neighborhoods.map((n) => `location: POLYGON(NTA ${n.code})`), 'up to 15 places each', 'explainability on'],
      assumptions: ['Only tags that describe places (ambience, cuisine, category, good for, time of day …) are used'],
      unresolved: [],
    },
    warnings: i.warnings,
  });
}
