import 'server-only';

/**
 * Text helpers shared by the lexicon, the grounding validator and the templates.
 * Matching works on word tokens so it is case-, diacritic- and punctuation-insensitive and can
 * never match inside a longer word ("Queensboro" never contains "Queens").
 */

export interface Token {
  /** The word as written (diacritics removed, case kept). */
  raw: string;
  /** Lower-case form used for matching. */
  norm: string;
  /** Characters between the previous word and this one (or the start of the text). */
  sep: string;
  /** First word of the text or of a sentence or clause (after . ! ? ; : … — – | • or a spaced hyphen). */
  sentenceStart: boolean;
}

const APOSTROPHES = /[‘’ʼ`´′]/g;
const POSSESSIVE = /([\p{L}\p{N}])'[sS](?![\p{L}\p{N}])/gu;
const SENTENCE_BREAK = /[.!?;:…—–|•\n\r]|(?:^|\s)-(?:\s|$)/u;
const WORD = /[\p{L}\p{N}]+/gu;

/** Emoji, flags, keycaps and joiners (also catches pictographs such as ™ and ©). */
export const EMOJI = /[\p{Extended_Pictographic}\p{Regional_Indicator}\u{FE0F}\u{20E3}\u{200D}]/u;
const EMOJI_ALL = new RegExp(EMOJI.source, 'gu');

/**
 * Fold text for matching while keeping case: strip diacritics, unify apostrophes, drop possessive
 * "'s" (so "Brooklyn's" still names Brooklyn), remove other apostrophes and spell out "&".
 */
export function foldText(input: string): string {
  return input
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .replace(APOSTROPHES, "'")
    .replace(POSSESSIVE, '$1')
    .replace(/'/g, '')
    .replace(/&/g, ' and ');
}

export function tokenize(input: string | null | undefined): Token[] {
  if (!input) return [];
  const s = foldText(input);
  const out: Token[] = [];
  let last = 0;
  for (const m of s.matchAll(WORD)) {
    const at = m.index;
    const sep = s.slice(last, at);
    out.push({ raw: m[0], norm: m[0].toLowerCase(), sep, sentenceStart: out.length === 0 || SENTENCE_BREAK.test(sep) });
    last = at + m[0].length;
  }
  return out;
}

/** Lower-case words joined by single spaces: the canonical form for phrase comparison. */
export function normalizeText(input: string | null | undefined): string {
  return tokenize(input)
    .map((t) => t.norm)
    .join(' ');
}

export function words(input: string | null | undefined): string[] {
  return tokenize(input).map((t) => t.norm);
}

/** Start index of `needle` as a contiguous word sequence inside `hay`, or -1. */
export function indexOfSeq(hay: readonly string[], needle: readonly string[], from = 0): number {
  if (needle.length === 0 || needle.length > hay.length) return -1;
  outer: for (let i = Math.max(0, from); i + needle.length <= hay.length; i++) {
    for (let j = 0; j < needle.length; j++) {
      if (hay[i + j] !== needle[j]) continue outer;
    }
    return i;
  }
  return -1;
}

export function containsSeq(hay: readonly string[], needle: readonly string[]): boolean {
  return indexOfSeq(hay, needle) >= 0;
}

/**
 * Digit runs in reading order, with thousands separators removed ("$2,000" → "2000") and leading
 * zeros dropped, so "2,000" in the copy matches "2000" in the offer but "1" never matches "10".
 */
export function digitSequences(input: string | null | undefined): string[] {
  if (!input) return [];
  const s = input.normalize('NFKD').replace(/(\d),(?=\d{3}(?!\d))/g, '$1');
  return (s.match(/\d+/g) ?? []).map((d) => d.replace(/^0+(?=\d)/, ''));
}

/**
 * The digit runs of `digitSequences` that read as money or a discount: after a currency sign, or before
 * "%", "percent" or "off" ("$48", "10% off", "20 off").
 */
export function pricedDigitSequences(input: string | null | undefined): string[] {
  if (!input) return [];
  const s = input.normalize('NFKD').replace(/(\d),(?=\d{3}(?!\d))/g, '$1');
  const out: string[] = [];
  for (const m of s.matchAll(/([$€£]\s*)?(\d+(?:\.\d+)?)(\s*(?:%|percent\b|off\b))?/giu)) {
    if (m[1] || m[3]) for (const d of (m[2] ?? '').split('.')) out.push(d.replace(/^0+(?=\d)/, ''));
  }
  return out;
}

export function hasEmoji(input: string): boolean {
  return EMOJI.test(input);
}

export function stripEmoji(input: string): string {
  return input.replace(EMOJI_ALL, '');
}

/** Visible length in code points (NFC), so "café" counts 4 whichever way it was encoded. */
export function charCount(input: string): number {
  return Array.from(input.normalize('NFC')).length;
}

/** Whitespace-separated chunks that contain a letter or digit ("Bed-Stuy" is one word, "—" none). */
export function wordCount(input: string): number {
  return input
    .trim()
    .split(/\s+/)
    .filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
}

/** Collapse whitespace and trim; null/undefined become ''. */
export function squish(input: string | null | undefined): string {
  return (input ?? '').replace(/\s+/g, ' ').trim();
}

/** Crude English singular for allow-list lookups ("Sundays" → "sunday", "parties" → "party"). */
export function singular(word: string): string {
  if (word.length > 4 && word.endsWith('ies')) return `${word.slice(0, -3)}y`;
  if (word.length > 4 && /(?:ches|shes|sses|xes|zes)$/.test(word)) return word.slice(0, -2);
  if (word.length > 3 && word.endsWith('s') && !word.endsWith('ss')) return word.slice(0, -1);
  return word;
}

/**
 * Candidate dictionary forms of a lower-case word for allow-list lookups: plural, comparative and
 * superlative, -ing, -ed and -ly ("coziest" → "cozy", "hottest" → "hot", "jamming" → "jam").
 */
export function baseForms(word: string): string[] {
  const out = new Set<string>([word, singular(word)]);
  for (const [suffix, replacement] of [
    ['iest', 'y'],
    ['ier', 'y'],
    ['ied', 'y'],
    ['ily', 'y'],
  ] as const) {
    if (word.length > suffix.length + 2 && word.endsWith(suffix)) out.add(word.slice(0, -suffix.length) + replacement);
  }
  for (const suffix of ['est', 'er', 'ed', 'ing', 'ly']) {
    if (word.length <= suffix.length + 2 || !word.endsWith(suffix)) continue;
    const stem = word.slice(0, -suffix.length);
    out.add(stem);
    out.add(`${stem}e`);
    if (/([b-df-hj-np-tv-z])\1$/.test(stem)) out.add(stem.slice(0, -1));
  }
  return [...out];
}

export function isCapitalized(raw: string): boolean {
  return /^\p{Lu}/u.test(raw);
}

export function isAllCaps(raw: string): boolean {
  return /\p{Lu}/u.test(raw) && raw === raw.toUpperCase();
}
