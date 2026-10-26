import 'server-only';
import type { z } from 'zod';
import type { Brief, Tone } from '@/shared/types';
import { semanticProblems } from './chain';
import { fallbackPlanner } from './fallback-planner';
import type { AttemptEvent, AttemptOutcome, LlmGateway, LlmRunRequest, LlmRunResult } from './gateway';
import { COPY_LIMITS, readNeighborhoodList, readTaggedJson, type CreativeInputData } from './prompts';
import { TONES, toPlannerModelOutput, type CreativeModelOutput, type PlannerModelOutput } from './schemas';

/*
 * Deterministic stand-in for the model chain (`LLM_MODE=mock`). It reads the same prompts the real
 * models get, so mock runs exercise the prompt builders end to end: the planner answer comes from the
 * fallback planner, the creative answer is assembled from the evidence labels within the copy rules.
 */

export const FAKE_SLOT = 'fake';
export const FAKE_MODEL = 'stoop-deterministic-1';

type Rec = Record<string, unknown>;
type Hood = CreativeInputData['neighborhoods'][number];
type Evidence = Hood['evidence'][number];
type ModelVariant = CreativeModelOutput['variants'][number];

const asRecord = (v: unknown): Rec => (typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Rec) : {});
const asArray = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const text = (v: unknown): string => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : '');
const textOrNull = (v: unknown): string | null => text(v) || null;
const finite = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

/** The brief carried by a planner prompt (see buildPlannerPrompt); untagged text becomes the description. */
export function briefFromPrompt(prompt: string): Brief {
  const data = readTaggedJson(prompt, 'brief');
  const r = asRecord(data);
  return {
    business: text(r.business),
    description: data === null ? text(prompt) : text(r.description),
    offer: textOrNull(r.offer),
    budgetUsd: finite(r.budgetUsd),
    weeks: finite(r.weeks),
    startDate: textOrNull(r.startDate),
    address: null,
  };
}

export function fakePlannerOutput(instructions: string, prompt: string): PlannerModelOutput {
  const plan = fallbackPlanner(briefFromPrompt(prompt), { neighborhoods: readNeighborhoodList(instructions) });
  return toPlannerModelOutput(plan);
}

/** The input carried by a creative prompt (see buildCreativePrompt). */
export function creativeInputFromPrompt(prompt: string): CreativeInputData {
  const r = asRecord(readTaggedJson(prompt, 'creative_input'));
  return {
    business: text(r.business),
    offer: textOrNull(r.offer),
    tone: TONES.find((t) => t === r.tone) ?? 'warm',
    category: textOrNull(r.category),
    about: textOrNull(r.about),
    neighborhoods: asArray(r.neighborhoods)
      .map(asRecord)
      .map((h) => ({
        nta: text(h.nta),
        name: text(h.name),
        evidence: asArray(h.evidence)
          .map(asRecord)
          .map((e) => ({ id: text(e.id), label: text(e.label) }))
          .filter((e) => e.id && e.label),
      }))
      .filter((h) => h.nta),
  };
}

const TONE_CTA: Record<Tone, string> = {
  playful: 'Swing by',
  warm: 'Come say hello',
  bold: "Don't miss it",
  premium: 'Plan your visit',
  community: 'Join your neighbors',
};

const wordCount = (s: string) => s.split(' ').filter(Boolean).length;

/** First candidate within the limits; otherwise the last candidate cut at a word boundary. */
function fit(candidates: readonly string[], max: number, maxWords = Number.POSITIVE_INFINITY): string {
  const usable = candidates.map((c) => c.replace(/\s+/g, ' ').trim()).filter(Boolean);
  const found = usable.find((c) => c.length <= max && wordCount(c) <= maxWords);
  if (found) return found;
  const last = usable[usable.length - 1] ?? '';
  let out = '';
  for (const word of last.split(' ')) {
    const next = out ? `${out} ${word}` : word;
    if (next.length > max || wordCount(next) > maxWords) break;
    out = next;
  }
  return out || last.slice(0, max);
}

/** Labels with numbers are usable only when every number also appears in the offer. */
function usableLabel(label: string, offer: string | null): boolean {
  return label.length <= 24 && (label.match(/\d+/g) ?? []).every((n) => offer?.includes(n));
}

function withReferences(v: Omit<ModelVariant, 'references' | 'rationale'>, item: Evidence | null, rationale: string): ModelVariant {
  const copy = `${v.headline} ${v.body} ${v.cta}`;
  const references = item && copy.includes(item.label) ? [{ evidenceId: item.id, phrase: item.label }] : [];
  return { ...v, references, rationale };
}

/** Variant A leads with the neighborhood's strongest usable taste label. */
function variantA(input: CreativeInputData, hood: Hood, item: Evidence | null): ModelVariant {
  const { business: biz, offer } = input;
  const short = hood.name;
  const label = item?.label;
  const offerTail = offer ? ` ${offer}` : '';
  const headline = fit(
    label ? [`${short} loves ${label}`, `${label} in ${short}`, `${label}, ${biz}`, biz] : [`${biz} in ${short}`, biz],
    COPY_LIMITS.headline,
    COPY_LIMITS.headlineWords,
  );
  const body = fit(
    label
      ? [`${biz} brings ${label} to ${short}.${offerTail}`, `${biz} brings ${label} to ${short}.`, `${biz}: ${label} in ${short}.`, `${biz}: ${label}.`]
      : [`${biz} in ${short}.${offerTail}`, `${biz} in ${short}.`, biz],
    COPY_LIMITS.body,
  );
  const cta = fit([TONE_CTA[input.tone]], COPY_LIMITS.cta);
  const rationale = label
    ? `Leads with "${label}", a taste tag that over-indexes in ${short}.`
    : `No usable evidence for ${short}, so the ad leads with the business.`;
  return withReferences({ nta: hood.nta, variant: 'A', headline, body, cta }, item ?? null, rationale);
}

/**
 * Variant B leads with the offer (or the business when there is none) and ties it to local taste.
 * The body carries whatever the headline could not: the business name, the evidence label and,
 * when it still fits, the offer.
 */
function variantB(input: CreativeInputData, hood: Hood, item: Evidence | null): ModelVariant {
  const { business: biz, offer } = input;
  const short = hood.name;
  const label = item?.label;
  const headline = fit(
    [...(offer ? [offer] : []), biz, label ? `${label} in ${short}` : short],
    COPY_LIMITS.headline,
    COPY_LIMITS.headlineWords,
  );
  const offerLed = offer !== null && headline === offer;
  const lead = headline === biz ? '' : `${biz}: `;
  const bodyCandidates: string[] = [];
  if (offer && !offerLed) {
    bodyCandidates.push(label ? `${lead}${offer} For ${label} in ${short}.` : `${lead}${offer}`);
  }
  if (label) {
    bodyCandidates.push(
      lead ? `${biz}, made for ${short}'s love of ${label}.` : `Made for ${short}'s love of ${label}.`,
      lead ? `${biz}, for ${label} in ${short}.` : `For ${label} in ${short}.`,
      `${lead}${label}.`,
    );
  } else {
    bodyCandidates.push(lead ? `${biz} in ${short}.` : `In ${short}.`, lead ? biz : short);
  }
  const body = fit(bodyCandidates, COPY_LIMITS.body);
  const cta = fit([`Visit ${biz}`, TONE_CTA[input.tone]], COPY_LIMITS.cta);
  const leadsWith = offerLed ? 'the offer' : lead ? 'local taste' : 'the business';
  const rationale = label
    ? `Leads with ${leadsWith} and ties it to ${short}'s "${label}" signal.`
    : `Leads with ${leadsWith}; no usable evidence for ${short}.`;
  return withReferences({ nta: hood.nta, variant: 'B', headline, body, cta }, item ?? null, rationale);
}

export function fakeCreativeOutput(prompt: string): CreativeModelOutput {
  const input = creativeInputFromPrompt(prompt);
  const variants: ModelVariant[] = [];
  for (const hood of input.neighborhoods) {
    const usable = hood.evidence.filter((e) => usableLabel(e.label, input.offer));
    // A and B lean on different tags when the pack has two.
    variants.push(variantA(input, hood, usable[0] ?? null), variantB(input, hood, usable[1] ?? usable[0] ?? null));
  }
  return { variants };
}

/** Deterministic gateway for `LLM_MODE=mock`: one synthetic attempt, same result shape as the chain. */
export function createFakeGateway(opts: { now?: () => number } = {}): LlmGateway {
  const now = opts.now ?? Date.now;
  return {
    async run<S extends z.ZodType>(req: LlmRunRequest<S>): Promise<LlmRunResult<z.output<S>>> {
      if (req.signal.aborted) return { ok: false, reason: 'aborted', attempts: [], skipped: [] };
      const started = now();
      const candidate = req.kind === 'planner' ? fakePlannerOutput(req.instructions, req.prompt) : fakeCreativeOutput(req.prompt);
      const parsed = req.schema.safeParse(candidate);
      let outcome: AttemptOutcome = 'ok';
      let detail: string | null = null;
      if (!parsed.success) {
        outcome = 'invalid';
        detail = 'fake output does not match the requested schema';
      } else {
        const problems = semanticProblems(req.validate, parsed.data);
        if (problems.length > 0) {
          outcome = 'rejected';
          detail = problems.join('; ').slice(0, 240);
        }
      }
      const event: AttemptEvent = {
        kind: req.kind,
        attempt: 1,
        slot: FAKE_SLOT,
        model: FAKE_MODEL,
        outcome,
        error: outcome === 'invalid' ? 'invalid_output' : null,
        status: null,
        cooldownMs: null,
        ms: Math.max(0, now() - started),
        detail,
      };
      try {
        req.onAttempt?.(event);
      } catch {
        // A progress callback must never break the run.
      }
      if (parsed.success && outcome === 'ok') {
        return { ok: true, data: parsed.data, via: FAKE_SLOT, model: FAKE_MODEL, attempts: [event], skipped: [] };
      }
      return { ok: false, reason: 'exhausted', attempts: [event], skipped: [] };
    },
  };
}
