/**
 * Brand panel for the validation backtest (docs/ARCHITECTURE.md §18).
 *
 * A chain is found in OpenStreetMap by its `brand:wikidata` tag. Every QID below is the one the
 * name-suggestion-index assigns (except Bluestone Lane and Levain, which the index does not list; their QIDs
 * come from a Wikidata search). Each QID was checked against Wikidata on 2026-10-26: the entity exists, is not
 * a redirect, and its English label equals `wikidataLabel`. `pnpm backtest:osm` repeats that check before any
 * Overpass query. No candidate failed the check, so none was dropped at this stage.
 *
 * The ≥15-store rule is applied after extraction (targets.ts) from OSM counts alone, before any Qloo data
 * exists, so the panel cannot be tuned to the result.
 *
 * Qloo search hints are unverified until the first key works. Every chain is searched as a `brand`: a `place`
 * entity is one store, whose map describes that store's visitors rather than the chain's audience.
 */

export type BrandCategory =
  | 'coffee'
  | 'fast_food'
  | 'fast_casual'
  | 'bakery_cafe'
  | 'dessert'
  | 'grocery'
  | 'pharmacy'
  | 'bank'
  | 'fitness'
  | 'retail';

export interface QlooSearchHint {
  type: 'brand' | 'place';
  /** Text sent to Qloo /search. */
  query: string;
  /** A word or two that may appear in the right candidate's name or description (the planner's searchHint). */
  hint: string | null;
  /** Other names the Qloo entity may carry; used only to settle an ambiguous search by exact (normalized) name. */
  aliases: readonly string[];
}

export interface BacktestBrand {
  /** Stable slug; also the cache file name `data/raw/osm/<id>.json`. */
  id: string;
  name: string;
  /** Wikidata QID matched against OSM `brand:wikidata`. */
  qid: string;
  /** English Wikidata label of `qid` (verified 2026-10-26). */
  wikidataLabel: string;
  category: BrandCategory;
  qloo: QlooSearchHint;
}

const brand = (query: string, hint: string | null, aliases: readonly string[] = []): QlooSearchHint => ({
  type: 'brand',
  query,
  hint,
  aliases,
});

export const BRANDS: readonly BacktestBrand[] = [
  { id: 'starbucks', name: 'Starbucks', qid: 'Q37158', wikidataLabel: 'Starbucks', category: 'coffee', qloo: brand('Starbucks', 'coffee', ['Starbucks Coffee']) },
  { id: 'dunkin', name: "Dunkin'", qid: 'Q847743', wikidataLabel: "Dunkin'", category: 'coffee', qloo: brand("Dunkin'", 'donuts', ["Dunkin' Donuts"]) },
  { id: 'blue-bottle', name: 'Blue Bottle Coffee', qid: 'Q4928917', wikidataLabel: 'Blue Bottle Coffee Company', category: 'coffee', qloo: brand('Blue Bottle Coffee', 'coffee', ['Blue Bottle', 'Blue Bottle Coffee Company']) },
  { id: 'bluestone-lane', name: 'Bluestone Lane', qid: 'Q130381059', wikidataLabel: 'Bluestone Lane', category: 'coffee', qloo: brand('Bluestone Lane', 'coffee') },
  { id: 'joe-and-the-juice', name: 'Joe & The Juice', qid: 'Q26221514', wikidataLabel: 'Joe & The Juice', category: 'coffee', qloo: brand('Joe & The Juice', 'juice') },
  { id: 'mcdonalds', name: "McDonald's", qid: 'Q38076', wikidataLabel: "McDonald's", category: 'fast_food', qloo: brand("McDonald's", 'fast food') },
  { id: 'burger-king', name: 'Burger King', qid: 'Q177054', wikidataLabel: 'Burger King', category: 'fast_food', qloo: brand('Burger King', 'burger') },
  { id: 'popeyes', name: 'Popeyes', qid: 'Q1330910', wikidataLabel: 'Popeyes', category: 'fast_food', qloo: brand('Popeyes', 'chicken', ['Popeyes Louisiana Kitchen']) },
  { id: 'five-guys', name: 'Five Guys', qid: 'Q1131810', wikidataLabel: 'Five Guys', category: 'fast_food', qloo: brand('Five Guys', 'burger', ['Five Guys Burgers and Fries']) },
  { id: 'sweetgreen', name: 'Sweetgreen', qid: 'Q18636413', wikidataLabel: 'Sweetgreen', category: 'fast_casual', qloo: brand('Sweetgreen', 'salad') },
  { id: 'shake-shack', name: 'Shake Shack', qid: 'Q1058722', wikidataLabel: 'Shake Shack', category: 'fast_casual', qloo: brand('Shake Shack', 'burger') },
  { id: 'chipotle', name: 'Chipotle', qid: 'Q465751', wikidataLabel: 'Chipotle Mexican Grill', category: 'fast_casual', qloo: brand('Chipotle Mexican Grill', 'mexican', ['Chipotle']) },
  { id: 'pret', name: 'Pret A Manger', qid: 'Q2109109', wikidataLabel: 'Pret a Manger', category: 'fast_casual', qloo: brand('Pret A Manger', 'sandwich', ['Pret']) },
  { id: 'le-pain-quotidien', name: 'Le Pain Quotidien', qid: 'Q2046903', wikidataLabel: 'Le Pain Quotidien', category: 'bakery_cafe', qloo: brand('Le Pain Quotidien', 'bakery') },
  { id: 'levain', name: 'Levain Bakery', qid: 'Q6534818', wikidataLabel: 'Levain Bakery', category: 'bakery_cafe', qloo: brand('Levain Bakery', 'bakery', ['Levain']) },
  { id: 'van-leeuwen', name: 'Van Leeuwen Ice Cream', qid: 'Q113632545', wikidataLabel: 'Van Leeuwen Ice Cream', category: 'dessert', qloo: brand('Van Leeuwen Ice Cream', 'ice cream', ['Van Leeuwen']) },
  { id: 'whole-foods', name: 'Whole Foods Market', qid: 'Q1809448', wikidataLabel: 'Whole Foods Market', category: 'grocery', qloo: brand('Whole Foods Market', 'supermarket', ['Whole Foods']) },
  { id: 'trader-joes', name: "Trader Joe's", qid: 'Q688825', wikidataLabel: "Trader Joe's", category: 'grocery', qloo: brand("Trader Joe's", 'grocery') },
  { id: 'target', name: 'Target', qid: 'Q1046951', wikidataLabel: 'Target Corporation', category: 'retail', qloo: brand('Target', 'retailer', ['Target Corporation']) },
  { id: 'cvs', name: 'CVS Pharmacy', qid: 'Q2078880', wikidataLabel: 'CVS Pharmacy', category: 'pharmacy', qloo: brand('CVS Pharmacy', 'pharmacy', ['CVS']) },
  { id: 'duane-reade', name: 'Duane Reade', qid: 'Q5310380', wikidataLabel: 'Duane Reade', category: 'pharmacy', qloo: brand('Duane Reade', 'pharmacy') },
  { id: 'chase', name: 'Chase', qid: 'Q524629', wikidataLabel: 'Chase Bank', category: 'bank', qloo: brand('Chase', 'bank', ['Chase Bank', 'JPMorgan Chase']) },
  { id: 'td-bank', name: 'TD Bank', qid: 'Q7669891', wikidataLabel: 'TD Bank', category: 'bank', qloo: brand('TD Bank', 'bank') },
  { id: 'equinox', name: 'Equinox', qid: 'Q5384535', wikidataLabel: 'Equinox Fitness', category: 'fitness', qloo: brand('Equinox', 'fitness', ['Equinox Fitness']) },
  { id: 'planet-fitness', name: 'Planet Fitness', qid: 'Q7201095', wikidataLabel: 'Planet Fitness', category: 'fitness', qloo: brand('Planet Fitness', 'gym') },
  { id: 'lululemon', name: 'Lululemon', qid: 'Q6702957', wikidataLabel: 'Lululemon Athletica', category: 'retail', qloo: brand('Lululemon', 'athletic', ['Lululemon Athletica']) },
  { id: 'apple-store', name: 'Apple Store', qid: 'Q421253', wikidataLabel: 'Apple Store', category: 'retail', qloo: brand('Apple', 'technology', ['Apple Store', 'Apple Inc.']) },
];

/** Accent-, case- and punctuation-insensitive comparison of labels ("Pret a Manger" = "Pret A Manger"). */
export function foldLabel(s: string): string {
  return s
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/['’‘`´]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

export type WikidataCheck = { ok: true; label: string } | { ok: false; reason: string };

/**
 * Checks a Wikidata `Special:EntityData/<QID>.json` response against the panel entry: the entity must exist,
 * must not be a redirect (EntityData answers a redirected QID under the target's id) and its English label
 * must equal `wikidataLabel` after folding.
 */
export function checkWikidata(b: Pick<BacktestBrand, 'qid' | 'wikidataLabel'>, response: unknown): WikidataCheck {
  const entities = (response as { entities?: Record<string, unknown> } | null)?.entities;
  if (!entities || typeof entities !== 'object') return { ok: false, reason: 'no entities in the response' };
  const entity = entities[b.qid] as { id?: string; missing?: unknown; labels?: { en?: { value?: string } } } | undefined;
  if (!entity) {
    const other = Object.keys(entities)[0];
    return { ok: false, reason: other ? `${b.qid} redirects to ${other}` : `${b.qid} not found` };
  }
  if (entity.missing !== undefined || entity.id !== b.qid) return { ok: false, reason: `${b.qid} does not exist` };
  const label = entity.labels?.en?.value;
  if (!label) return { ok: false, reason: `${b.qid} has no English label` };
  if (foldLabel(label) !== foldLabel(b.wikidataLabel)) {
    return { ok: false, reason: `label is “${label}”, expected “${b.wikidataLabel}”` };
  }
  return { ok: true, label };
}
