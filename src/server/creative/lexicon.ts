import 'server-only';
import type { NtaInfo } from '@/shared/types';
import { containsSeq, isAllCaps, isCapitalized, tokenize, words, type Token } from './text';
import { isCommonWord } from './words';

/**
 * Place-name lexicon: every 2020 NTA name, short name and derived alias, the five boroughs and the
 * city itself, matched on word tokens (longest match wins, so "East Williamsburg" is never read as
 * "Williamsburg"). The validator uses it to reject copy that names another neighborhood.
 */

export type PlaceKind = 'nta' | 'borough' | 'city';

export interface PlaceMention {
  /** Display form of the matched term, e.g. "Bed-Stuy". */
  term: string;
  /** The words as written in the copy. */
  text: string;
  kind: PlaceKind;
  /** NTA codes that answer to this term (several NTAs can share one, e.g. both Bed-Stuy halves). */
  codes: string[];
  /** Canonical borough for borough terms; null otherwise. */
  borough: string | null;
  /** Token range [start, end) in the tokenized text. */
  start: number;
  end: number;
}

export interface Lexicon {
  /** Place mentions in `text`, left to right, longest match first, never overlapping. */
  find(text: string): PlaceMention[];
  findInTokens(tokens: readonly Token[]): PlaceMention[];
  /**
   * True when copy for neighborhood `code` may use this mention: its own names, a part of its own
   * name, its borough, the city, or a non-residential area (park, cemetery) that borders it.
   */
  isLocal(mention: PlaceMention, code: string): boolean;
  /** Lower-case words that name this neighborhood (all its names and aliases). */
  ntaTokens(code: string): ReadonlySet<string>;
  /** Normalized names and aliases of this neighborhood. */
  ntaNames(code: string): readonly string[];
  /** Lower-case words of every borough and city term. */
  readonly regionTokens: ReadonlySet<string>;
  /** True when this lower-case word names a place on its own ("astoria", "brooklyn"; not "hill"). */
  isPlaceWord(word: string): boolean;
  /** Canonical borough of an NTA code, or null when unknown. */
  boroughOf(code: string): string | null;
}

type Casing = 'any' | 'capital' | 'upper';

interface Term {
  key: string;
  tokens: string[];
  display: string;
  codes: Set<string>;
  borough: string | null;
  city: boolean;
  casing: Casing;
}

interface TrieNode {
  next: Map<string, TrieNode>;
  term: Term | null;
}

const BOROUGH_ALIASES: Record<string, string> = {
  manhattan: 'Manhattan',
  mn: 'Manhattan',
  brooklyn: 'Brooklyn',
  bk: 'Brooklyn',
  queens: 'Queens',
  qn: 'Queens',
  bronx: 'Bronx',
  'the bronx': 'Bronx',
  bx: 'Bronx',
  'staten island': 'Staten Island',
  si: 'Staten Island',
};

/** "The Bronx", "BRONX" and "bx" all become "Bronx"; unknown values are returned trimmed. */
export function canonicalBorough(boro: string): string {
  return BOROUGH_ALIASES[words(boro).join(' ')] ?? boro.trim();
}

const CITY_TERMS: { display: string; casing: Casing }[] = [
  { display: 'NYC', casing: 'any' },
  { display: 'New York', casing: 'any' },
  { display: 'New York City', casing: 'any' },
  { display: 'NY', casing: 'upper' },
];

// "Queens" must be capitalized ("drag queens" is not a borough); "BK" must be upper case.
const BOROUGH_TERMS: { display: string; borough: string; casing: Casing }[] = [
  { display: 'Manhattan', borough: 'Manhattan', casing: 'any' },
  { display: 'Brooklyn', borough: 'Brooklyn', casing: 'any' },
  { display: 'Bklyn', borough: 'Brooklyn', casing: 'any' },
  { display: 'BK', borough: 'Brooklyn', casing: 'upper' },
  { display: 'Queens', borough: 'Queens', casing: 'capital' },
  { display: 'Bronx', borough: 'Bronx', casing: 'any' },
  { display: 'The Bronx', borough: 'Bronx', casing: 'any' },
  { display: 'Staten Island', borough: 'Staten Island', casing: 'any' },
];

/** Words that make "Queens" / "Manhattan" mean something else (drag queens, a smoked Manhattan). */
const SKIP_BEFORE: Record<string, ReadonlySet<string>> = {
  queens: new Set(['drag', 'dancing', 'dance', 'disco', 'beauty', 'prom', 'homecoming', 'pageant', 'drama', 'dairy', 'snow', 'ice', 'scream', 'rodeo']),
  manhattan: new Set(['a', 'perfect', 'smoked', 'smoky', 'classic', 'rye', 'bourbon', 'dry', 'sweet', 'black', 'reverse', 'our', 'your', 'house', 'one', 'two']),
};
const SKIP_AFTER: Record<string, ReadonlySet<string>> = {
  queens: new Set(['of']),
  manhattan: new Set(['cocktail', 'cocktails', 'clam', 'chowder']),
};
/**
 * A place name followed by one of these is a street, bridge or institution, not a claim about the
 * neighborhood ("Flushing Ave" borders Bed-Stuy, "Manhattan Ave" is Greenpoint's main street, the
 * "Williamsburg Bridge" lands on the Lower East Side). The proper-noun rule still sees the words.
 */
const LANDMARK_AFTER = new Set([
  'ave', 'av', 'avenue', 'st', 'street', 'blvd', 'boulevard', 'rd', 'road', 'pkwy', 'parkway', 'expressway', 'expy',
  'bridge', 'tunnel', 'plaza', 'terminal', 'station', 'turnpike', 'highway', 'hwy', 'drive', 'lane', 'mall', 'ferry',
  'museum', 'zoo', 'college',
]);
/** ~200 m in degrees: bounding boxes this close count as bordering. */
const BORDER_MARGIN_DEG = 0.002;

/** Curated colloquial aliases, keyed by the normalized base name of an NTA segment. */
const EXTRA_ALIASES: Record<string, { display: string; casing?: Casing }[]> = {
  'bedford stuyvesant': [{ display: 'Bed-Stuy' }, { display: 'Bedstuy' }],
  'lower east side': [{ display: 'LES', casing: 'upper' }],
  'long island city': [{ display: 'LIC', casing: 'upper' }],
  'upper east side': [{ display: 'UES', casing: 'upper' }],
  'upper west side': [{ display: 'UWS', casing: 'upper' }],
  'financial district': [{ display: 'FiDi' }],
  'east harlem': [{ display: 'El Barrio' }, { display: 'Spanish Harlem' }],
  'washington heights': [{ display: 'WaHi' }],
  'prospect lefferts gardens': [{ display: 'PLG', casing: 'upper' }, { display: 'Lefferts Gardens' }],
  'stuyvesant town': [{ display: 'Stuy Town' }, { display: 'StuyTown' }],
  'east village': [{ display: 'Alphabet City' }],
  'little italy': [{ display: 'Nolita' }],
  'brighton beach': [{ display: 'Little Odessa' }],
  midtown: [{ display: 'Theater District' }, { display: 'Theatre District' }],
  'midtown south': [{ display: 'Koreatown' }],
  'rockaway beach': [{ display: 'Rockaway' }, { display: 'Rockaways' }],
  'far rockaway': [{ display: 'Rockaway' }, { display: 'Rockaways' }],
};

/**
 * Single words that are NTA names but far more often mean something else ("Rugby", the
 * "Charleston", "Jamaica" the country, "Madison", "Concourse", "Utopia"). They are not matched as
 * places; mid-sentence they still meet the proper-noun rule unless they are the ad's own NTA.
 */
const AMBIGUOUS_SINGLE = new Set(['rugby', 'charleston', 'jamaica', 'travis', 'madison', 'utopia', 'battery', 'concourse', 'woodrow']);
const EXCLUDED_TERMS = new Set(['country club']);

/** Single-word NTA names that double as ordinary words: matched only when capitalized. */
const CAPITAL_SINGLE = new Set([
  'flushing', 'corona', 'sunnyside', 'bayside', 'clearview', 'hillcrest', 'woodside', 'longwood', 'woodlawn', 'norwood',
  'oakwood', 'rosedale', 'parkville', 'brookville', 'wingate', 'melrose', 'belmont', 'chelsea', 'clifton', 'arlington',
  'hollis', 'steinway', 'wakefield', 'kensington', 'tremont', 'highbridge', 'inwood', 'glendale', 'bayswater', 'edgemere',
]);

/** Hyphenated names that are one place, not two ("Bedford-Stuyvesant", "Co-op City", "Green-Wood"). */
const PROTECTED_HYPHENS = ['bedford-stuyvesant', 'co-op', 'green-wood'];
const DIRECTIONS = new Set(['north', 'south', 'east', 'west', 'central']);
const FUNCTION_WORDS = new Set(['the', 'of', 'and', 'at', 'on']);
const ABBREVIATIONS = new Set(['st', 'mt', 'ft', 'jr', 'sr', 'dr']);
const PLACEHOLDER = '';

function splitSegments(name: string): string[] {
  let s = name;
  for (const p of PROTECTED_HYPHENS) {
    s = s.replace(new RegExp(p, 'gi'), (m) => m.replace(/-/g, PLACEHOLDER));
  }
  return s
    .split(/\s*[-–]\s*/)
    .map((part) => part.split(PLACEHOLDER).join('-').trim())
    .filter(Boolean);
}

/** Names, short name, hyphen segments, direction variants and curated aliases of one NTA. */
function aliasForms(nta: NtaInfo): { display: string; casing?: Casing }[] {
  const forms: { display: string; casing?: Casing }[] = [{ display: nta.name }, { display: nta.short }];
  const withoutParens = nta.name.replace(/\s*\([^)]*\)/g, '').trim();
  forms.push({ display: withoutParens });
  for (const segment of [withoutParens, ...splitSegments(nta.name)]) {
    const m = /^(.*?)\s*\(([^)]*)\)\s*$/.exec(segment);
    const base = (m ? (m[1] ?? '') : segment).trim();
    const dir = m ? (m[2] ?? '').trim() : '';
    if (!base) continue;
    forms.push({ display: base });
    if (/^the\s+/i.test(base)) forms.push({ display: base.replace(/^the\s+/i, '') });
    if (dir && DIRECTIONS.has(dir.toLowerCase())) forms.push({ display: `${dir} ${base}` }, { display: `${base} ${dir}` });
    for (const extra of EXTRA_ALIASES[words(base).join(' ')] ?? []) forms.push(extra);
  }
  // "Mariner's Harbor" is also written "Mariners Harbor": keep an apostrophe-free spelling too.
  for (const f of [...forms]) {
    if (/['’]/.test(f.display)) forms.push({ display: f.display.replace(/['’]/g, ''), casing: f.casing });
  }
  return forms;
}

/** How strictly a term must be cased in the copy before it counts as a place, or null to skip it. */
function ntaCasing(tokens: string[], requested: Casing | undefined): Casing | null {
  const key = tokens.join(' ');
  if (EXCLUDED_TERMS.has(key)) return null;
  if (requested) return requested;
  if (tokens.length === 1) {
    const w = tokens[0] ?? '';
    if (AMBIGUOUS_SINGLE.has(w) || isCommonWord(w) || w.length < 3) return null;
    return CAPITAL_SINGLE.has(w) ? 'capital' : 'any';
  }
  // "Union Square", "Two Bridges", "Lower East Side": ordinary words, so only Title Case counts.
  return tokens.every((w) => isCommonWord(w) || FUNCTION_WORDS.has(w)) ? 'capital' : 'any';
}

export function buildLexicon(ntas: readonly NtaInfo[]): Lexicon {
  const root: TrieNode = { next: new Map(), term: null };
  const terms = new Map<string, Term>();
  const ownTokens = new Map<string, Set<string>>();
  const ownNames = new Map<string, Set<string>>();
  const boroughByCode = new Map<string, string>();
  const regionTokens = new Set<string>();
  const placeWords = new Set<string>();
  const infoByCode = new Map<string, NtaInfo>();

  function addTerm(display: string, opts: { code?: string; borough?: string; city?: boolean; casing: Casing }): void {
    const tokens = words(display);
    if (tokens.length === 0) return;
    const key = tokens.join(' ');
    let term = terms.get(key);
    if (!term) {
      term = { key, tokens, display: display.trim(), codes: new Set(), borough: null, city: false, casing: opts.casing };
      terms.set(key, term);
      let node = root;
      for (const t of tokens) {
        let child = node.next.get(t);
        if (!child) {
          child = { next: new Map(), term: null };
          node.next.set(t, child);
        }
        node = child;
      }
      node.term = term;
    }
    if (opts.code) term.codes.add(opts.code);
    if (opts.borough) term.borough = opts.borough;
    if (opts.city) term.city = true;
  }

  for (const c of CITY_TERMS) {
    addTerm(c.display, { city: true, casing: c.casing });
    for (const w of words(c.display)) regionTokens.add(w);
  }
  for (const b of BOROUGH_TERMS) {
    addTerm(b.display, { borough: b.borough, casing: b.casing });
    for (const w of words(b.display)) regionTokens.add(w);
  }
  for (const t of [...CITY_TERMS, ...BOROUGH_TERMS]) {
    const ws = words(t.display);
    if (ws.length === 1 && ws[0]) placeWords.add(ws[0]);
  }

  // Sort by code so merged terms keep a stable display form whatever order the data arrives in.
  for (const nta of [...ntas].sort((a, b) => (a.code < b.code ? -1 : a.code > b.code ? 1 : 0))) {
    boroughByCode.set(nta.code, canonicalBorough(nta.boro));
    infoByCode.set(nta.code, nta);
    const tokensForCode = ownTokens.get(nta.code) ?? new Set<string>();
    const namesForCode = ownNames.get(nta.code) ?? new Set<string>();
    ownTokens.set(nta.code, tokensForCode);
    ownNames.set(nta.code, namesForCode);
    for (const form of aliasForms(nta)) {
      const tokens = words(form.display);
      if (tokens.length === 0) continue;
      for (const t of tokens) tokensForCode.add(t);
      if (tokens.length === 1 && tokens[0]) placeWords.add(tokens[0]);
      namesForCode.add(tokens.join(' '));
      const casing = ntaCasing(tokens, form.casing);
      if (casing) addTerm(form.display, { code: nta.code, casing });
    }
  }

  function casingOk(term: Term, tokens: readonly Token[], start: number, end: number): boolean {
    if (term.casing === 'any') return true;
    for (let i = start; i < end; i++) {
      const t = tokens[i];
      if (!t) return false;
      if (term.casing === 'upper' && !isAllCaps(t.raw)) return false;
      if (term.casing === 'capital' && !FUNCTION_WORDS.has(t.norm) && !isCapitalized(t.raw)) return false;
    }
    return true;
  }

  function contextOk(term: Term, tokens: readonly Token[], start: number, end: number): boolean {
    const before = SKIP_BEFORE[term.key];
    const after = SKIP_AFTER[term.key];
    const prev = tokens[start - 1];
    const next = tokens[end];
    if (before && prev && !tokens[start]?.sentenceStart && before.has(prev.norm)) return false;
    if (after && next && !next.sentenceStart && after.has(next.norm)) return false;
    if (next && !next.sentenceStart && LANDMARK_AFTER.has(next.norm)) return false;
    // "Kings and Queens" is a party theme, not a borough.
    if (term.key === 'queens' && prev?.norm === 'and' && tokens[start - 2]?.norm === 'kings') return false;
    return true;
  }

  /** Words of one place name must be adjacent: "sunset. Park yourself" is not "Sunset Park". */
  function joinable(tokens: readonly Token[], k: number): boolean {
    const t = tokens[k];
    if (!t) return false;
    if (/^[\s\-‐-–/]*$/.test(t.sep)) return true;
    const prev = tokens[k - 1];
    return t.sep.trim() === '.' && !!prev && (ABBREVIATIONS.has(prev.norm) || prev.norm.length === 1);
  }

  function findInTokens(tokens: readonly Token[]): PlaceMention[] {
    const out: PlaceMention[] = [];
    let i = 0;
    while (i < tokens.length) {
      const hits: { end: number; term: Term }[] = [];
      let node: TrieNode | undefined = root;
      for (let j = i; j < tokens.length; j++) {
        const t = tokens[j];
        if (!t || (j > i && !joinable(tokens, j))) break;
        node = node.next.get(t.norm);
        if (!node) break;
        if (node.term) hits.push({ end: j + 1, term: node.term });
      }
      let matched = false;
      for (let h = hits.length - 1; h >= 0; h--) {
        const hit = hits[h];
        if (!hit || !casingOk(hit.term, tokens, i, hit.end) || !contextOk(hit.term, tokens, i, hit.end)) continue;
        const { term } = hit;
        out.push({
          term: term.display,
          text: tokens
            .slice(i, hit.end)
            .map((t) => t.raw)
            .join(' '),
          kind: term.city ? 'city' : term.borough ? 'borough' : 'nta',
          codes: [...term.codes].sort(),
          borough: term.borough,
          start: i,
          end: hit.end,
        });
        i = hit.end;
        matched = true;
        break;
      }
      if (!matched) i++;
    }
    return out;
  }

  const empty: ReadonlySet<string> = new Set();

  /** Parks, cemeteries and other non-residential areas may be named by the neighborhoods they border. */
  function bordersNonResidential(codes: readonly string[], code: string): boolean {
    const own = infoByCode.get(code)?.bbox;
    if (!own || codes.length === 0) return false;
    return codes.every((c) => {
      const other = infoByCode.get(c);
      if (!other || other.residential) return false;
      const [minLon, minLat, maxLon, maxLat] = other.bbox;
      return (
        minLon <= own[2] + BORDER_MARGIN_DEG &&
        maxLon >= own[0] - BORDER_MARGIN_DEG &&
        minLat <= own[3] + BORDER_MARGIN_DEG &&
        maxLat >= own[1] - BORDER_MARGIN_DEG
      );
    });
  }

  return {
    find: (text) => findInTokens(tokenize(text)),
    findInTokens,
    isLocal(mention, code) {
      if (mention.kind === 'city') return true;
      if (mention.kind === 'borough') return mention.borough === (boroughByCode.get(code) ?? null);
      if (mention.codes.includes(code)) return true;
      // A part of this NTA's own name is still this NTA ("Williamsburg" in East Williamsburg copy).
      const needle = mention.term ? words(mention.term) : [];
      if ([...(ownNames.get(code) ?? [])].some((name) => containsSeq(name.split(' '), needle))) return true;
      return bordersNonResidential(mention.codes, code);
    },
    ntaTokens: (code) => ownTokens.get(code) ?? empty,
    ntaNames: (code) => [...(ownNames.get(code) ?? [])],
    regionTokens,
    isPlaceWord: (word) => placeWords.has(word),
    boroughOf: (code) => boroughByCode.get(code) ?? null,
  };
}
