import 'server-only';
import type { AdVariant, Brief, CopyRule, EvidencePack, GroundingResult, NtaInfo } from '@/shared/types';
import type { Lexicon } from './lexicon';
import {
  baseForms,
  charCount,
  containsSeq,
  digitSequences,
  hasEmoji,
  indexOfSeq,
  isCapitalized,
  squish,
  tokenize,
  wordCount,
  words,
  type Token,
} from './text';
import { isCommonWord, SENSITIVE_TERMS } from './words';

/** Copy limits from PRODUCT §5 / ARCHITECTURE §8. */
export const COPY_LIMITS = { headline: 38, headlineWords: 6, body: 90, cta: 22 } as const;

export interface CreativeContext {
  /** This neighborhood's Qloo evidence pack (its items are the only citable evidence). */
  pack: EvidencePack;
  nta: NtaInfo;
  brief: Brief;
  /** Business name the copy must contain; null when the brief has none. */
  businessName: string | null;
  lexicon: Lexicon;
  /** Third-party names that must never appear in copy, e.g. the run's taste anchors. */
  blockedNames?: readonly string[];
}

type Field = 'headline' | 'body' | 'cta';
type Issue = { rule: CopyRule; detail: string };

const FIELDS: readonly Field[] = ['headline', 'body', 'cta'];
const FIELD_LABEL: Record<Field, string> = { headline: 'headline', body: 'body', cta: 'CTA' };
const RULE_ORDER: readonly CopyRule[] = [
  'length',
  'emoji',
  'refs',
  'foreign_local',
  'ungrounded_proper_noun',
  'sensitive',
  'invented_number',
  'missing_business',
];
/** Trailing words that a business name may drop in copy ("Smoke & Sons NYC" → "Smoke & Sons"). */
const BUSINESS_SUFFIXES = new Set(['co', 'company', 'inc', 'llc', 'ltd', 'corp', 'nyc', 'ny', 'bk']);

interface FieldText {
  field: Field;
  text: string;
  tokens: Token[];
  norms: string[];
  /** Word is part of the business name as written in the copy. */
  business: boolean[];
  /** Word belongs to a place mention (judged by the foreign-neighborhood rule instead). */
  handled: boolean[];
}

function quote(s: string): string {
  return `"${s}"`;
}

function uniq<T>(xs: readonly T[]): T[] {
  return [...new Set(xs)];
}

function markOccurrences(norms: readonly string[], seq: readonly string[], mask: boolean[]): void {
  if (seq.length === 0) return;
  let at = indexOfSeq(norms, seq);
  while (at >= 0) {
    for (let k = at; k < at + seq.length; k++) mask[k] = true;
    at = indexOfSeq(norms, seq, at + 1);
  }
}

/** The business name as words, plus a core form without a leading "the" or trailing "LLC"/"NYC". */
function businessForms(name: string | null): string[][] {
  const full = words(name);
  if (full.length === 0) return [];
  let core = full;
  if (core[0] === 'the' && core.length > 1) core = core.slice(1);
  while (core.length > 1 && BUSINESS_SUFFIXES.has(core[core.length - 1] ?? '')) core = core.slice(0, -1);
  return core.join(' ') === full.join(' ') ? [full] : [full, core];
}

/**
 * Check one ad variant against the deterministic copy rules (PRODUCT §5, ARCHITECTURE §8). Every
 * failed rule is returned once, with short human-readable details. `replacedByTemplate` is always
 * false here; `finalizeCreative` sets it when it swaps in a template.
 *
 * Choices beyond the letter of the spec, all in the direction of fewer false alarms on grounded copy:
 * - Mid-sentence capitalized words may also come from the brief (the owner's own words), from this
 *   pack's evidence labels, or appear elsewhere in the same copy in lower case. Third-party names
 *   (`blockedNames`) and the pack's place names are reported even at a sentence start.
 * - Digits may also come from `brief.business` and from this pack's evidence labels ("24 Hour Diner").
 * - The business name counts as present when written in full, without "The"/"LLC"-style affixes, or
 *   by one distinctive word ("Halfnote" for "Halfnote Supper Club"). Its words never count as
 *   another neighborhood or a targeting term ("Astoria Bagel Co." may advertise in Bed-Stuy).
 */
export function validateVariant(variant: AdVariant, ctx: CreativeContext): GroundingResult {
  const { pack, nta, brief, lexicon } = ctx;
  const businessName = squish(ctx.businessName) || null;
  const issues: Issue[] = [];
  const fail = (rule: CopyRule, detail: string) => issues.push({ rule, detail });

  const bizForms = businessForms(businessName);
  const bizTokens = new Set(bizForms[0] ?? []);
  const labelTokens = new Set(pack.items.flatMap((item) => words(item.label)));
  const ownTokens = lexicon.ntaTokens(nta.code);

  const fields: FieldText[] = FIELDS.map((field) => {
    const text = squish(variant[field]);
    const tokens = tokenize(text);
    const norms = tokens.map((t) => t.norm);
    const business = norms.map(() => false);
    for (const form of bizForms) markOccurrences(norms, form, business);
    const handled = norms.map(() => false);
    return { field, text, tokens, norms, business, handled };
  });

  // length -------------------------------------------------------------------------------------
  const limits: Record<Field, number> = { headline: COPY_LIMITS.headline, body: COPY_LIMITS.body, cta: COPY_LIMITS.cta };
  for (const f of fields) {
    const n = charCount(f.text);
    if (n === 0) fail('length', `${FIELD_LABEL[f.field]} is empty`);
    else if (n > limits[f.field]) fail('length', `${FIELD_LABEL[f.field]} is ${n} characters (max ${limits[f.field]})`);
  }
  const headlineWords = wordCount(fields[0]?.text ?? '');
  if (headlineWords > COPY_LIMITS.headlineWords) {
    fail('length', `headline has ${headlineWords} words (max ${COPY_LIMITS.headlineWords})`);
  }

  // emoji --------------------------------------------------------------------------------------
  const withEmoji = fields.filter((f) => hasEmoji(f.text)).map((f) => FIELD_LABEL[f.field]);
  if (withEmoji.length > 0) fail('emoji', `emoji in ${withEmoji.join(' and ')}`);

  // refs: at least one, each from this neighborhood's pack, each phrase visible in headline/body --
  const packIds = new Set(pack.nta === nta.code ? pack.items.map((item) => item.id) : []);
  const references = variant.references ?? [];
  if (variant.nta !== nta.code) fail('refs', `variant is for ${variant.nta}, not ${nta.code}`);
  if (references.length === 0) fail('refs', 'no evidence reference');
  const headlineNorms = fields[0]?.norms ?? [];
  const bodyNorms = fields[1]?.norms ?? [];
  for (const ref of references) {
    if (!packIds.has(ref.evidenceId)) fail('refs', `evidence ${quote(ref.evidenceId)} is not from this neighborhood`);
    const phrase = words(ref.phrase);
    if (phrase.length === 0) fail('refs', `empty phrase for ${quote(ref.evidenceId)}`);
    else if (!containsSeq(headlineNorms, phrase) && !containsSeq(bodyNorms, phrase)) {
      fail('refs', `phrase ${quote(squish(ref.phrase))} is not in the headline or body`);
    }
  }

  // foreign_local: no other neighborhood or borough names -----------------------------------------
  const foreign: string[] = [];
  const bizFull = bizForms[0] ?? [];
  for (const f of fields) {
    for (const m of lexicon.findInTokens(f.tokens)) {
      for (let k = m.start; k < m.end; k++) f.handled[k] = true;
      // The business's own name may contain a place ("Astoria Bagel Co." advertising in Bed-Stuy).
      const span = f.norms.slice(m.start, m.end);
      const inBusiness = f.business.slice(m.start, m.end).every(Boolean) || containsSeq(bizFull, span);
      if (inBusiness || lexicon.isLocal(m, nta.code)) continue;
      foreign.push(m.kind === 'borough' ? `another borough: ${m.term}` : `another neighborhood: ${m.term}`);
    }
  }
  if (foreign.length > 0) fail('foreign_local', `names ${uniq(foreign).join('; ')}`);

  // ungrounded_proper_noun: third-party names, local place names, unverified capitalized words ----
  const named: string[] = [];
  const namedTokens = new Set<string>();
  const blockedTokens = new Set<string>();
  const entities = [
    ...(ctx.blockedNames ?? []).map((name) => ({ name, kind: 'third-party name' })),
    ...pack.places.map((p) => ({ name: p.name, kind: 'local place name' })),
  ];
  for (const { name, kind } of entities) {
    let seq = words(name);
    if (seq[0] === 'the' && seq.length > 1) seq = seq.slice(1);
    // The business may itself be an anchor or an evidence place; its own name is always allowed.
    if (seq.length === 0 || containsSeq(bizFull, seq)) continue;
    const distinctive = seq.filter(
      (w) => w.length >= 4 && !isCommonWord(w) && !lexicon.isPlaceWord(w) && !bizTokens.has(w) && !ownTokens.has(w) && !labelTokens.has(w),
    );
    for (const w of distinctive) blockedTokens.add(w);
    const fullMatch = seq.length > 1 && !seq.every((w) => isCommonWord(w)) && fields.some((f) => containsSeq(f.norms, seq));
    const tokenMatch = fields.some((f) => f.tokens.some((t) => distinctive.includes(t.norm) && isCapitalized(t.raw)));
    if (fullMatch || tokenMatch) {
      named.push(`${kind} ${quote(squish(name))}`);
      for (const w of seq) namedTokens.add(w);
    }
  }

  const allowed = new Set<string>([...bizTokens, ...ownTokens, ...words(pack.shortName), ...lexicon.regionTokens, ...labelTokens]);
  for (const w of [...words(brief.description), ...words(brief.offer), ...words(brief.business)]) allowed.add(w);
  // A word the copy also uses in lower case is an ordinary word, not a name.
  for (const f of fields) for (const t of f.tokens) if (!isCapitalized(t.raw)) allowed.add(t.norm);
  for (const w of blockedTokens) if (!bizTokens.has(w)) allowed.delete(w);

  const unverified: string[] = [];
  for (const f of fields) {
    f.tokens.forEach((t, k) => {
      if (t.sentenceStart || t.raw.length < 2 || !isCapitalized(t.raw) || f.business[k] || f.handled[k]) return;
      if (namedTokens.has(t.norm) || baseForms(t.norm).some((w) => isCommonWord(w) || allowed.has(w))) return;
      unverified.push(t.raw);
    });
  }
  const nounDetails = [...named];
  if (unverified.length > 0) nounDetails.push(`unverified names ${uniq(unverified).map(quote).join(', ')}`);
  if (nounDetails.length > 0) fail('ungrounded_proper_noun', nounDetails.join('; '));

  // sensitive: demographic or targeting terms (the business's own name is exempt) -----------------
  const sensitive: string[] = [];
  for (const f of fields) {
    const text = f.norms.map((w, k) => (f.business[k] ? '#' : w)).join(' ');
    for (const { pattern, category } of SENSITIVE_TERMS) {
      const m = pattern.exec(text);
      if (m) sensitive.push(`${quote(m[0])} (${category})`);
    }
  }
  if (sensitive.length > 0) fail('sensitive', `targeting term ${uniq(sensitive).join(', ')}`);

  // invented_number: digits must come from the offer, the business name or an evidence label ------
  const allowedDigits = new Set([
    ...digitSequences(brief.offer),
    ...digitSequences(businessName),
    ...digitSequences(brief.business),
    ...pack.items.flatMap((item) => digitSequences(item.label)),
  ]);
  const invented = uniq(fields.flatMap((f) => digitSequences(f.text)).filter((d) => !allowedDigits.has(d)));
  if (invented.length > 0) fail('invented_number', `numbers not in the offer: ${invented.join(', ')}`);

  // missing_business ----------------------------------------------------------------------------
  if (businessName && bizForms.length > 0) {
    const distinctive = new Set(
      bizFull.filter((w) => w.length >= 4 && !isCommonWord(w) && !lexicon.isPlaceWord(w) && !BUSINESS_SUFFIXES.has(w)),
    );
    const present = fields.some(
      (f) => bizForms.some((form) => containsSeq(f.norms, form)) || f.norms.some((w) => distinctive.has(w)),
    );
    if (!present) fail('missing_business', `business name ${quote(businessName)} is missing`);
  }

  const failed = RULE_ORDER.flatMap((rule) => {
    const details = issues.filter((i) => i.rule === rule).map((i) => i.detail);
    return details.length > 0 ? [{ rule, detail: uniq(details).join('; ') }] : [];
  });
  return { ok: failed.length === 0, failed, replacedByTemplate: false };
}
