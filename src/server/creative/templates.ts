import 'server-only';
import type { AdVariant, EvidenceItem, Tone } from '@/shared/types';
import { baseForms, charCount, isAllCaps, squish, stripEmoji, wordCount, words } from './text';
import { COPY_LIMITS, validateVariant, type CreativeContext } from './validate';
import { PROPER_ADJECTIVES } from './words';

/**
 * Deterministic, evidence-filled ad templates. They replace model copy that failed the grounding
 * rules and carry the WHAT station on their own when every model is busy. Every candidate is run
 * through the same validator and the first passing one is returned, so a template passes whenever
 * the neighborhood's pack has at least one item.
 *
 * Honesty rules the wording follows:
 * - Screens run where the taste fits, which is often not where the business is, so templates never
 *   say "right here", "on the block" or "around the corner"; the mockup footer carries the address.
 * - Evidence describes the neighborhood's taste, not the business. A label is written as something
 *   the business offers ("Soul food at Halfnote") only when the brief itself mentions it.
 */

/** How a label reads in copy, from its Qloo tag type (and the brief). */
type LabelClass = 'offering-match' | 'mood' | 'time' | 'occasion' | 'offering';

/** Preferred label kinds for a hook, best first; ties keep the pack's evidence order. */
const CLASS_RANK: Record<LabelClass, number> = { 'offering-match': 0, mood: 1, time: 2, occasion: 3, offering: 4 };

/** Words too generic to prove that a label matches the brief. */
const GENERIC = new Set(['food', 'foods', 'place', 'places', 'spot', 'spots', 'style', 'new', 'good', 'great', 'live', 'night', 'nights', 'day', 'days', 'bar', 'bars', 'restaurant', 'restaurants', 'shop', 'shops', 'store', 'stores']);
const TIME_PLURALS = new Set(['morning', 'afternoon', 'evening', 'night', 'weekend', 'weekday', 'day']);
const FUNCTION_WORDS = new Set(['a', 'an', 'and', 'the', 'of', 'for', 'to', 'in', 'on', 'at', 'with', 'or', 'by']);
/** Longest evidence label we put into copy; longer labels are cut at a word boundary. */
const MAX_LABEL = 24;

interface Fill {
  item: EvidenceItem;
  cls: LabelClass;
  /** Label as written mid-sentence ("live music", "Greek", "BBQ"). */
  x: string;
  /** Label at the start of a sentence ("Live music"). */
  X: string;
  /** Time-of-day label in the plural ("late nights"); same as `x` otherwise. */
  xs: string;
  short: string;
  biz: string | null;
  offer: string | null;
}

interface Draft {
  headline: string;
  body: string;
  cta: string;
  /** The evidence words exactly as they appear in the headline or body. */
  phrase: string;
  usesOffer: boolean;
}

interface ToneCopy {
  /** Variant A body: the business line, free of location claims. */
  line(biz: string | null): string;
  ctaA: string;
  /** CTA under an offer headline. */
  ctaB: string;
}

const TONES: Record<Tone, ToneCopy> = {
  playful: { line: (b) => (b ? `${b} is your new go-to. Come play.` : 'Your new go-to. Come play.'), ctaA: 'Come play', ctaB: 'Grab the deal' },
  warm: { line: (b) => (b ? `${b} can't wait to meet you.` : "We can't wait to meet you."), ctaA: 'See you soon', ctaB: 'Come say hi' },
  bold: { line: (b) => (b ? `${b}. Don't miss it.` : "Don't miss it."), ctaA: 'Be there', ctaB: 'Claim it' },
  premium: { line: (b) => (b ? `${b}: worth the trip.` : 'Worth the trip.'), ctaA: 'Plan your visit', ctaB: 'Plan your visit' },
  community: {
    line: (b) => (b ? `${b} welcomes the whole neighborhood.` : 'The whole neighborhood is welcome.'),
    ctaA: 'Stop by',
    ctaB: 'Bring a friend',
  },
};

/** Variant A headline: a statement about the neighborhood's taste. */
const HEAD_A: Record<LabelClass, (f: Fill) => Pick<Draft, 'headline' | 'phrase'>> = {
  'offering-match': (f) => ({ headline: `${f.X}, the ${f.short} way.`, phrase: f.x }),
  mood: (f) => ({ headline: `${f.X} is very ${f.short}.`, phrase: f.x }),
  time: (f) => ({ headline: `Made for ${f.short} ${f.xs}.`, phrase: f.xs }),
  occasion: (f) => ({ headline: `${f.X} in ${f.short}?`, phrase: f.x }),
  offering: (f) => ({ headline: `${f.short}: ${f.x} territory.`, phrase: f.x }),
};

/** Variant B body under an offer headline: ties the business to the neighborhood's taste. */
const BODY_B: Record<LabelClass, (f: Fill) => Pick<Draft, 'body' | 'phrase'>> = {
  'offering-match': (f) => ({ body: f.biz ? `${f.X} at ${f.biz}, made for ${f.short}.` : `${f.X}, made for ${f.short}.`, phrase: f.x }),
  mood: (f) => ({ body: `${f.biz ? `${f.biz}. ` : ''}${f.X}, the ${f.short} way.`, phrase: f.x }),
  time: (f) => ({ body: `${cap(f.xs)} in ${f.short}${f.biz ? `, meet ${f.biz}` : ''}.`, phrase: f.xs }),
  occasion: (f) => ({ body: f.biz ? `${f.biz}, made for ${f.x}.` : `Made for ${f.x} in ${f.short}.`, phrase: f.x }),
  offering: (f) => ({ body: f.biz ? `${f.biz}, for ${f.short}'s ${f.x} lovers.` : `For ${f.short}'s ${f.x} lovers.`, phrase: f.x }),
};

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function clean(input: string | null | undefined): string {
  return squish(stripEmoji(input ?? '')).replace(/[\s.,;:!?]+$/, '');
}

/** The label cut to MAX_LABEL characters at a word boundary ('' when even one word is too long). */
function fitLabel(label: string): string {
  const text = clean(label);
  if (charCount(text) <= MAX_LABEL) return text;
  let out = '';
  for (const w of text.split(' ')) {
    const next = out ? `${out} ${w}` : w;
    if (charCount(next) > MAX_LABEL) break;
    out = next;
  }
  return out.replace(/[\s,;:&/+-]+$/, '');
}

/** Contiguous word runs of a label, longest first, that still carry a content word. */
function subPhrases(label: string): string[] {
  const ws = clean(label).split(' ').filter(Boolean);
  const out: string[] = [];
  for (let len = ws.length - 1; len >= 1; len--) {
    for (let start = 0; start + len <= ws.length; start++) {
      const run = ws.slice(start, start + len);
      if (!/[\p{L}\p{N}]/u.test(run[0] ?? '') || !/[\p{L}\p{N}]/u.test(run[run.length - 1] ?? '')) continue;
      if (!run.some((w) => /\p{L}{3,}/u.test(w) && !FUNCTION_WORDS.has(w.toLowerCase()))) continue;
      const phrase = fitLabel(run.join(' '));
      if (phrase && !out.includes(phrase)) out.push(phrase);
    }
  }
  return out;
}

/** Mid-sentence form: lower case, except acronyms ("BBQ") and proper adjectives ("Greek", "Tex-Mex"). */
function midForm(label: string): string {
  return label
    .split(' ')
    .map((word) =>
      word
        .split('-')
        .map((part) => {
          if (isAllCaps(part) && /\p{L}{2,}/u.test(part)) return part;
          const lower = part.toLowerCase();
          return PROPER_ADJECTIVES.has(lower.replace(/[^\p{L}]/gu, '')) ? cap(lower) : lower;
        })
        .join('-'),
    )
    .join(' ');
}

function timePlural(mid: string): string {
  const parts = mid.split(' ');
  const last = parts[parts.length - 1] ?? '';
  if (TIME_PLURALS.has(last)) parts[parts.length - 1] = `${last}s`;
  return parts.join(' ');
}

function classify(item: EvidenceItem, briefWords: ReadonlySet<string>): LabelClass {
  const type = item.tagType.toLowerCase();
  if (/:(?:ambience|decor|setting|neighborhood_characteristic)(?::|$)/.test(type)) return 'mood';
  if (/:time_of_day_fit(?::|$)/.test(type)) return 'time';
  if (/:(?:good_for|visit_intent)(?::|$)/.test(type)) return 'occasion';
  const content = words(item.label).filter((w) => w.length >= 3 && !GENERIC.has(w));
  return content.some((w) => baseForms(w).some((b) => briefWords.has(b))) ? 'offering-match' : 'offering';
}

/**
 * Evidence choices: full labels by class rank, then sub-phrases for labels with a bad word.
 * Variant B starts from the second-best label so the pair shows two different pieces of evidence.
 */
function* labelChoices(ctx: CreativeContext, slot: 'A' | 'B'): Generator<{ item: EvidenceItem; cls: LabelClass; label: string }> {
  const briefWords = new Set(
    [ctx.brief.description, ctx.brief.offer, ctx.brief.business, ctx.businessName].flatMap((s) => words(s)).flatMap((w) => baseForms(w)),
  );
  const ranked = ctx.pack.items
    .map((item, k) => ({ item, k, cls: classify(item, briefWords) }))
    .sort((a, b) => CLASS_RANK[a.cls] - CLASS_RANK[b.cls] || a.k - b.k);
  if (slot === 'B' && ranked.length > 1) ranked.unshift(...ranked.splice(1, 1));
  for (const { item, cls } of ranked) {
    const label = fitLabel(item.label);
    if (label) yield { item, cls, label };
  }
  for (const { item, cls } of ranked) {
    for (const label of subPhrases(item.label)) yield { item, cls, label };
  }
}

function* drafts(slot: 'A' | 'B', tone: ToneCopy, f: Fill): Generator<Draft> {
  const classHead = HEAD_A[f.cls](f);
  const shortHeads: Pick<Draft, 'headline' | 'phrase'>[] = [
    { headline: `${f.X}, ${f.short}.`, phrase: f.x },
    { headline: `${f.X}.`, phrase: f.x },
  ];
  const plainA = (cta: string): Draft[] =>
    [classHead, ...shortHeads].flatMap((h) => [
      { ...h, body: tone.line(f.biz), cta, usesOffer: false },
      { ...h, body: f.biz ? `${f.biz}.` : 'Come by.', cta, usesOffer: false },
    ]);

  if (slot === 'A') {
    yield* plainA(tone.ctaA);
    return;
  }

  const classBody = BODY_B[f.cls](f);
  if (f.offer) {
    const offer = cap(f.offer);
    if (charCount(offer) <= COPY_LIMITS.headline && wordCount(offer) <= COPY_LIMITS.headlineWords) {
      yield { headline: offer, ...classBody, cta: tone.ctaB, usesOffer: true };
      yield { headline: offer, body: f.biz ? `${f.X}, meet ${f.biz}.` : `${f.X}, ${f.short}.`, phrase: f.x, cta: tone.ctaB, usesOffer: true };
    }
    // Offer too long for a headline: lead the body with it instead.
    for (const h of [classHead, ...shortHeads]) {
      yield { ...h, body: f.biz ? `${offer} at ${f.biz}.` : `${offer}.`, cta: tone.ctaB, usesOffer: true };
    }
  }
  // No usable offer: lead with the business; the body then needs no second mention of it.
  yield { headline: f.biz ? `Meet ${f.biz}.` : `${f.short}, this one's for you.`, ...BODY_B[f.cls]({ ...f, biz: null }), cta: tone.ctaA, usesOffer: false };
  yield* plainA(tone.ctaA);
}

function rationale(slot: 'A' | 'B', f: Fill, usesOffer: boolean): string {
  const hook = slot === 'A' ? 'local taste hook' : usesOffer ? 'offer hook' : 'business hook (no usable offer)';
  return `Template (${hook}) built from Qloo evidence "${f.item.label}" for ${f.short}.`;
}

/**
 * One deterministic template variant for this neighborhood: A leads with local taste, B with the
 * offer. Same input, same output.
 */
export function templateVariant(slot: 'A' | 'B', ctx: CreativeContext, tone: Tone = 'warm'): AdVariant {
  const copy = TONES[tone] ?? TONES.warm;
  const short = clean(ctx.nta.short) || clean(ctx.pack.shortName) || clean(ctx.nta.name);
  const biz = clean(ctx.businessName) || null;
  const offer = clean(ctx.brief.offer) || null;
  const base = { nta: ctx.nta.code, variant: slot };

  let first: AdVariant | null = null;
  for (const { item, cls, label } of labelChoices(ctx, slot)) {
    const x = midForm(label);
    const fill: Fill = { item, cls, x, X: cap(x), xs: cls === 'time' ? timePlural(x) : x, short, biz, offer };
    for (const d of drafts(slot, copy, fill)) {
      const v: AdVariant = {
        ...base,
        headline: d.headline,
        body: d.body,
        cta: d.cta,
        references: [{ evidenceId: item.id, phrase: d.phrase }],
        rationale: rationale(slot, fill, d.usesOffer),
      };
      first ??= v;
      if (validateVariant(v, ctx).ok) return v;
    }
  }

  // No label fits the rules even in part (e.g. every label names another area): greet the
  // neighborhood and cite the strongest item, so the variant stays tied to this pack.
  const item = ctx.pack.items[0];
  if (item) {
    const v: AdVariant = {
      ...base,
      headline: 'Hello, neighbor.',
      body: biz ? `${biz}. Come by.` : 'Come by and say hi.',
      cta: 'Come by',
      references: [{ evidenceId: item.id, phrase: 'neighbor' }],
      rationale: `Template: no evidence label passed the copy rules, so this greeting cites "${item.label}" generally.`,
    };
    if (validateVariant(v, ctx).ok || !first) return v;
  }
  return (
    first ?? {
      ...base,
      headline: 'Hello, neighbor.',
      body: biz ? `${biz}. Come by.` : 'Come by and say hi.',
      cta: 'Come by',
      references: [],
      rationale: 'Template: this neighborhood has no evidence items to cite.',
    }
  );
}

/** Both template variants for one neighborhood, A then B. */
export function templateVariants(ctx: CreativeContext, tone: Tone = 'warm'): [AdVariant, AdVariant] {
  return [templateVariant('A', ctx, tone), templateVariant('B', ctx, tone)];
}
