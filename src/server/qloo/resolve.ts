import 'server-only';
import type {
  Candidate,
  EntityType,
  ResolutionChoice,
  ResolutionIssue,
  ResolutionOutcome,
  StageEnvelope,
} from '@/shared/types';
import { resolveAnchorsEnvelope } from './envelope';
import { toEntityType, toQlooType } from './params';
import type { QlooApi, QlooErrorCode, GuardReason } from './types';

/**
 * Entity resolution (ARCHITECTURE §5): one /search per anchor, then exact → semantic → ambiguous →
 * not_found. Questions use plain words and Qloo's disambiguation text, never URNs, and popularity is
 * never presented as confidence.
 */

export { toEntityType, toQlooType };

export interface AnchorInput {
  name: string;
  type: EntityType;
  /** Planner hint such as "2002 film" or "Brooklyn"; its words count toward a semantic match. */
  searchHint?: string | null;
}

export interface ResolveFailure {
  input: string;
  type: EntityType;
  code: QlooErrorCode;
  reason?: GuardReason;
  message: string;
}

export interface ResolveResult {
  outcomes: ResolutionOutcome[];
  issues: ResolutionIssue[];
  /** Anchors whose lookup failed (quota, network…). They appear as not_found but get no question. */
  failures: ResolveFailure[];
}

const STOPWORDS = new Set(['a', 'an', 'and', 'the', 'of', 'in', 'on', 'at', 'for', 'by', 'with', 'to', 'from']);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_CANDIDATES = 5;

/** NFKD, strip diacritics, lowercase, & → and, strip punctuation, collapse spaces, drop a leading "the". */
export function normalizeName(s: string): string {
  return s
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/['’‘`´]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^the (?=\S)/, '');
}

export function contentTokens(s: string): string[] {
  return normalizeName(s)
    .split(' ')
    .filter((t) => t !== '' && !STOPWORDS.has(t));
}

function describe(c: Candidate): string {
  return c.disambiguation ? `“${c.name}” (${c.disambiguation})` : `“${c.name}”`;
}

/**
 * Pure decision over search candidates.
 * - exact: exactly one candidate's normalized name equals the normalized input;
 * - semantic: ≥2 content tokens (input plus hint words that occur in some candidate) all appear in
 *   exactly one candidate's name/disambiguation/year — returned with a warning;
 * - ambiguous: any other non-empty list (≤5 shown); not_found: no candidates.
 */
export function decideOutcome(input: string, type: EntityType, candidates: readonly Candidate[], searchHint?: string | null): ResolutionOutcome {
  if (candidates.length === 0) return { input, type, status: 'not_found', candidates: [] };
  const target = normalizeName(input);
  const exact = candidates.filter((c) => normalizeName(c.name) === target);
  const resolved = (selected: Candidate, match: 'exact' | 'semantic', warnings: string[]): ResolutionOutcome => ({
    input,
    type,
    status: 'resolved',
    match,
    selected,
    alternatives: candidates.filter((c) => c.id !== selected.id).slice(0, MAX_CANDIDATES - 1),
    warnings,
  });
  if (exact.length === 1 && exact[0]) return resolved(exact[0], 'exact', []);

  const candTokens = candidates.map((c) => new Set(contentTokens(`${c.name} ${c.disambiguation ?? ''} ${c.year ?? ''}`)));
  const inputTokens = contentTokens(input);
  // Hint words that no candidate mentions ("remake", "Pixar") cannot discriminate, so they are ignored.
  const hintTokens = contentTokens(searchHint ?? '').filter((t) => !inputTokens.includes(t) && candTokens.some((s) => s.has(t)));
  const tokens = [...new Set([...inputTokens, ...hintTokens])];
  if (tokens.length >= 2) {
    const matches = candidates.filter((_, i) => tokens.every((t) => candTokens[i]?.has(t)));
    if (matches.length === 1 && matches[0]) {
      const m = matches[0];
      return resolved(m, 'semantic', [`Matched “${input}” to ${describe(m)} by its description, not an exact name.`]);
    }
  }
  return { input, type, status: 'ambiguous', candidates: candidates.slice(0, MAX_CANDIDATES) };
}

const TYPE_WORD: Record<EntityType, string> = {
  artist: 'artist',
  book: 'book',
  brand: 'brand',
  movie: 'film',
  person: 'person',
  place: 'place',
  podcast: 'podcast',
  tv_show: 'TV show',
};

/** Never show URNs or raw IDs in a question. */
function plainName(input: string): string {
  const s = input.replace(/urn:[\w:.-]+/gi, '').trim();
  return s === '' || UUID_RE.test(s) ? 'this anchor' : s;
}

export function issueFor(o: ResolutionOutcome): ResolutionIssue | null {
  if (o.status === 'resolved') return null;
  const word = TYPE_WORD[o.type];
  const name = plainName(o.input);
  const article = /^[aeiou]/i.test(word) ? 'an' : 'a';
  const question =
    o.status === 'ambiguous'
      ? `Which ${word} did you mean by “${name}”?`
      : `We couldn’t find ${article} ${word} called “${name}” in Qloo. Skip it, or try a different name?`;
  return { input: o.input, type: o.type, kind: o.status, question, candidates: o.candidates };
}

export function issuesFor(outcomes: readonly ResolutionOutcome[], exclude: ReadonlySet<string> = new Set()): ResolutionIssue[] {
  return outcomes.flatMap((o) => {
    const issue = exclude.has(o.input) ? null : issueFor(o);
    return issue ? [issue] : [];
  });
}

/**
 * Applies the owner's answers. A choice with `entityId: null` drops that anchor; an id that is not
 * among the candidates leaves the question open.
 */
export function applyChoices(
  outcomes: readonly ResolutionOutcome[],
  choices: readonly ResolutionChoice[],
): { outcomes: ResolutionOutcome[]; issues: ResolutionIssue[]; dropped: string[] } {
  const byInput = new Map(choices.map((c) => [c.input, c]));
  const out: ResolutionOutcome[] = [];
  const dropped: string[] = [];
  for (const o of outcomes) {
    const choice = byInput.get(o.input);
    if (!choice) {
      out.push(o);
      continue;
    }
    if (choice.entityId === null) {
      dropped.push(o.input);
      continue;
    }
    const pool = o.status === 'resolved' ? [o.selected, ...o.alternatives] : o.candidates;
    const picked = pool.find((c) => c.id === choice.entityId);
    if (!picked || (o.status === 'resolved' && o.selected.id === picked.id)) {
      out.push(o);
      continue;
    }
    out.push({
      input: o.input,
      type: o.type,
      status: 'resolved',
      match: 'chosen',
      selected: picked,
      alternatives: pool.filter((c) => c.id !== picked.id),
      warnings: [],
    });
  }
  return { outcomes: out, issues: issuesFor(out), dropped };
}

/** Resolution cache key: `res:{type}:{normalizedName}` (plus `|{hint}` when the planner gave one). */
export function resolutionKey(a: AnchorInput): string {
  const hint = a.searchHint ? normalizeName(a.searchHint) : '';
  return `res:${a.type}:${normalizeName(a.name)}${hint ? `|${hint}` : ''}`;
}

/** Resolves anchors in parallel (the client paces the calls); outcomes keep the input order. */
export async function resolveAnchors(api: QlooApi, anchors: readonly AnchorInput[], opts: { take?: number } = {}): Promise<ResolveResult> {
  const failures: ResolveFailure[] = [];
  const outcomes = await Promise.all(
    anchors.map(async (a): Promise<ResolutionOutcome> => {
      const input = a.name.trim();
      const key = resolutionKey(a);
      const cached = await api.memo.get<ResolutionOutcome>(key);
      // Keep the caller's spelling: "Beyonce" may reuse the outcome cached for "Beyoncé".
      if (cached && cached.type === a.type) return { ...cached, input };

      let outcome: ResolutionOutcome;
      if (UUID_RE.test(input)) {
        const r = await api.entities([input]);
        if (!r.ok) {
          failures.push({ input, type: a.type, code: r.code, reason: r.reason, message: r.message });
          return { input, type: a.type, status: 'not_found', candidates: [] };
        }
        const c = r.data.find((x) => x.id.toLowerCase() === input.toLowerCase()) ?? r.data[0];
        outcome = c
          ? {
              input,
              type: a.type,
              status: 'resolved',
              match: 'identifier',
              selected: c,
              alternatives: [],
              warnings: c.type === a.type ? [] : [`“${c.name}” is listed in Qloo as a ${TYPE_WORD[c.type]}, not a ${TYPE_WORD[a.type]}.`],
            }
          : { input, type: a.type, status: 'not_found', candidates: [] };
      } else {
        const r = await api.search(input, a.type, { take: opts.take ?? MAX_CANDIDATES });
        if (!r.ok) {
          failures.push({ input, type: a.type, code: r.code, reason: r.reason, message: r.message });
          return { input, type: a.type, status: 'not_found', candidates: [] };
        }
        outcome = decideOutcome(input, a.type, r.data, a.searchHint);
      }
      await api.memo.set(key, outcome);
      return outcome;
    }),
  );
  const failed = new Set(failures.map((f) => f.input));
  return { outcomes, issues: issuesFor(outcomes, failed), failures };
}

export interface ResolveStageInput {
  anchors: readonly AnchorInput[];
  choices?: readonly ResolutionChoice[];
  /** Outcomes stored when the run paused; with choices they are applied without calling Qloo. */
  previous?: readonly ResolutionOutcome[] | null;
  now?: () => number;
}

/**
 * The resolve stage behind the orchestrator's `RunDeps.resolve`: fresh resolution, or the stored
 * outcomes with the owner's choices applied on resume, plus the resolve_anchors envelope.
 */
export async function resolveStage(
  api: QlooApi,
  input: ResolveStageInput,
): Promise<ResolveResult & { envelope: StageEnvelope }> {
  const now = input.now ?? Date.now;
  const started = now();
  const firstRequest = api.ctx.requests.length;
  let result: ResolveResult;
  if (input.previous && input.previous.length > 0) {
    const applied = applyChoices(input.previous, input.choices ?? []);
    result = { outcomes: applied.outcomes, issues: applied.issues, failures: [] };
  } else {
    result = await resolveAnchors(api, input.anchors);
  }
  const envelope = resolveAnchorsEnvelope({
    anchors: input.anchors,
    outcomes: result.outcomes,
    issues: result.issues,
    failures: result.failures,
    synthetic: api.synthetic,
    correlationId: api.ctx.runId,
    durationMs: now() - started,
    requests: api.ctx.requests.slice(firstRequest),
  });
  return { ...result, envelope };
}
