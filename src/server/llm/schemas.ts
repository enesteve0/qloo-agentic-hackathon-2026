import 'server-only';
import { z } from 'zod';
import { ENTITY_TYPES, type PlannerOutput, type Tone } from '@/shared/types';

/*
 * Schemas the language models see. Strict-mode providers (Groq json_schema, Gemini native schema)
 * accept only a small JSON Schema subset, so every schema here follows the same rules:
 * - z.strictObject everywhere (additionalProperties: false);
 * - every field required; `.nullable()` instead of `.optional()`;
 * - no .default/.transform/.refine and no numeric/length bounds (.int(), .min(), .max() emit
 *   keywords some providers reject); limits are enforced after parsing (finalizePlannerOutput,
 *   the creative grounding validator);
 * - object nesting depth ≤ 3; small enums.
 */

export const TONES = ['playful', 'warm', 'bold', 'premium', 'community'] as const satisfies readonly Tone[];

export const PLANNER_LIMITS = {
  minAnchors: 2,
  maxAnchors: 6,
  llmOnlyNeighborhoods: 5,
  /** Fewer valid LLM-only picks than this rejects the attempt (the proof needs a real arm). */
  minLlmOnlyNeighborhoods: 3,
} as const;

export const plannerSchema = z.strictObject({
  business: z.strictObject({
    name: z.string().nullable(),
    category: z.string(),
    offer: z.string().nullable(),
  }),
  audienceSummary: z.string(),
  anchors: z.array(
    z.strictObject({
      name: z.string(),
      type: z.enum(ENTITY_TYPES),
      searchHint: z.string().nullable(),
      why: z.string(),
    }),
  ),
  tone: z.enum(TONES),
  llmOnlyNeighborhoods: z.array(
    z.strictObject({
      ntaCode: z.string(),
      reason: z.string(),
    }),
  ),
  budgetUsd: z.number().nullable(),
  weeks: z.number().nullable(),
});

export type PlannerModelOutput = z.output<typeof plannerSchema>;

export const creativeSchema = z.strictObject({
  variants: z.array(
    z.strictObject({
      nta: z.string(),
      variant: z.enum(['A', 'B']),
      headline: z.string(),
      body: z.string(),
      cta: z.string(),
      references: z.array(
        z.strictObject({
          evidenceId: z.string(),
          phrase: z.string(),
        }),
      ),
      rationale: z.string(),
    }),
  ),
});

export type CreativeModelOutput = z.output<typeof creativeSchema>;

// ---------------------------------------------------------------------------------------------
// Post-parse normalization (limits live here, not in the schema)
// ---------------------------------------------------------------------------------------------

/** Collapse whitespace; plain hyphens, since models write U+2010/U+2011 ("Off‑White") and names go to Qloo search. */
function clean(text: string | null | undefined): string {
  return (text ?? '').replace(/\s+/g, ' ').replace(/[‐‑]/g, '-').trim();
}

function cleanOrNull(text: string | null | undefined): string | null {
  return clean(text) || null;
}

/** Name key for de-duplication (mirrors the resolver's normalization). */
export function normalizeName(name: string): string {
  return name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .replace(/^the /, '');
}

function normalizeCode(code: string): string {
  return code.trim().toUpperCase();
}

function positiveOrNull(n: number | null, round = false): number | null {
  if (n === null || !Number.isFinite(n) || n <= 0) return null;
  return round ? Math.max(1, Math.round(n)) : n;
}

/**
 * Turns schema-valid model output into the shared `PlannerOutput`: trims text, drops empty and
 * duplicate anchors (and the business itself), caps anchors at 6 and LLM-only picks at 5 eligible,
 * distinct codes.
 */
export function finalizePlannerOutput(raw: PlannerModelOutput, opts: { eligibleCodes?: Iterable<string> } = {}): PlannerOutput {
  const eligible = opts.eligibleCodes ? new Set([...opts.eligibleCodes].map(normalizeCode)) : null;
  const businessName = cleanOrNull(raw.business.name);
  const businessKey = businessName ? normalizeName(businessName) : null;

  const seen = new Set<string>();
  const anchors: PlannerOutput['anchors'] = [];
  for (const anchor of raw.anchors) {
    const name = clean(anchor.name);
    const key = normalizeName(name);
    if (!key || key === businessKey || seen.has(`${anchor.type}:${key}`)) continue;
    seen.add(`${anchor.type}:${key}`);
    anchors.push({ name, type: anchor.type, searchHint: cleanOrNull(anchor.searchHint), why: clean(anchor.why) });
    if (anchors.length === PLANNER_LIMITS.maxAnchors) break;
  }

  const codes = new Set<string>();
  const llmOnlyNeighborhoods: PlannerOutput['llmOnlyNeighborhoods'] = [];
  for (const pick of raw.llmOnlyNeighborhoods) {
    const code = normalizeCode(pick.ntaCode);
    if (!code || codes.has(code) || (eligible && !eligible.has(code))) continue;
    codes.add(code);
    llmOnlyNeighborhoods.push({ ntaCode: code, reason: clean(pick.reason) });
    if (llmOnlyNeighborhoods.length === PLANNER_LIMITS.llmOnlyNeighborhoods) break;
  }

  return {
    business: { name: businessName, category: clean(raw.business.category), offer: cleanOrNull(raw.business.offer) },
    audienceSummary: clean(raw.audienceSummary),
    anchors,
    tone: raw.tone,
    llmOnlyNeighborhoods,
    budgetUsd: positiveOrNull(raw.budgetUsd),
    weeks: positiveOrNull(raw.weeks, true),
    fallback: false,
  };
}

/** Semantic checks for `run({ validate })`: enough distinct anchors and real LLM-only picks. */
export function createPlannerValidator(eligibleCodes?: Iterable<string>): (raw: PlannerModelOutput) => string[] {
  const codes = eligibleCodes ? [...eligibleCodes] : undefined;
  return (raw) => {
    const out = finalizePlannerOutput(raw, { eligibleCodes: codes });
    const problems: string[] = [];
    if (out.anchors.length < PLANNER_LIMITS.minAnchors) {
      problems.push(`needs at least ${PLANNER_LIMITS.minAnchors} distinct anchors, got ${out.anchors.length}`);
    }
    if (codes && out.llmOnlyNeighborhoods.length < PLANNER_LIMITS.minLlmOnlyNeighborhoods) {
      problems.push(`needs at least ${PLANNER_LIMITS.minLlmOnlyNeighborhoods} eligible neighborhood codes, got ${out.llmOnlyNeighborhoods.length}`);
    }
    return problems;
  };
}

/** The model-facing part of a full `PlannerOutput` (drops `fallback`). */
export function toPlannerModelOutput(plan: PlannerOutput): PlannerModelOutput {
  return {
    business: { ...plan.business },
    audienceSummary: plan.audienceSummary,
    anchors: plan.anchors.map((a) => ({ ...a })),
    tone: plan.tone,
    llmOnlyNeighborhoods: plan.llmOnlyNeighborhoods.map((n) => ({ ...n })),
    budgetUsd: plan.budgetUsd,
    weeks: plan.weeks,
  };
}
