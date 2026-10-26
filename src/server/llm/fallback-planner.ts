import 'server-only';
import type { Brief, EntityType, PlannerOutput, Tone } from '@/shared/types';
import type { NeighborhoodRef } from './prompts';
import { PLANNER_LIMITS } from './schemas';

/*
 * Deterministic planner used when every model slot is exhausted (and by the fake gateway):
 * keyword rules → taste category → three curated anchors. Every anchor is a real, widely known
 * entity chosen because Qloo is likely to resolve it by name; searchHint disambiguates the search
 * (a year for movies and shows, a city or neighborhood for places, a short descriptor otherwise).
 * Keywords describe what the business offers, never who its customers are.
 */

export interface LibraryAnchor {
  name: string;
  type: EntityType;
  searchHint: string | null;
  why: string;
}

export interface TasteCategory {
  id: string;
  /** Used as `business.category`. */
  label: string;
  /** Matched as whole words or phrases; multi-word phrases score double. */
  keywords: readonly string[];
  tone: Tone;
  audienceSummary: string;
  anchors: readonly [LibraryAnchor, LibraryAnchor, LibraryAnchor];
}

// Order matters only for ties: more specific categories come first.
export const TASTE_CATEGORIES: readonly TasteCategory[] = [
  {
    id: 'jazz',
    label: 'jazz venue',
    keywords: ['jazz', 'supper club', 'jam night', 'jam nights', 'jam session', 'jam sessions', 'bebop', 'big band', 'saxophone', 'trumpet', 'blue note'],
    tone: 'warm',
    audienceSummary: 'A taste for modern jazz, soul and late live-music nights.',
    anchors: [
      { name: 'Robert Glasper', type: 'artist', searchHint: 'jazz pianist', why: 'Modern jazz that crosses into soul and hip-hop, the sound of a new supper club.' },
      { name: 'Esperanza Spalding', type: 'artist', searchHint: 'jazz bassist', why: 'Adventurous, widely loved jazz with a broad listening audience.' },
      { name: 'Kamasi Washington', type: 'artist', searchHint: 'jazz saxophonist', why: 'Big, cinematic spiritual jazz that fills rooms for live sets.' },
    ],
  },
  {
    id: 'comedy',
    label: 'comedy show',
    keywords: ['comedy', 'comedian', 'comedians', 'comic', 'stand up', 'standup', 'improv', 'sketch comedy', 'open mic', 'laughs'],
    tone: 'playful',
    audienceSummary: 'A taste for sharp stand-up and New York comedy on stage and on screen.',
    anchors: [
      { name: 'Comedy Cellar', type: 'place', searchHint: 'New York, NY', why: "New York's best-known stand-up room; a signal for going out to live comedy." },
      { name: 'Broad City', type: 'tv_show', searchHint: '2014', why: 'Loose, very New York comedy with a big local following.' },
      { name: "Chappelle's Show", type: 'tv_show', searchHint: '2003', why: 'Landmark sketch comedy that still defines sharp stand-up taste.' },
    ],
  },
  {
    id: 'latin_music',
    label: 'Latin music event',
    keywords: [
      'latin music', 'latin pop', 'latin night', 'latin alternative', 'alt latin', 'reggaeton', 'bachata', 'cumbia',
      'merengue', 'salsa night', 'salsa dancing', 'salsa club', 'dembow', 'perreo', 'urbano', 'mariachi', 'bossa nova',
    ],
    tone: 'bold',
    audienceSummary: 'A taste for Latin pop, reggaeton and alternative Latin music.',
    anchors: [
      { name: 'Bad Bunny', type: 'artist', searchHint: 'reggaeton', why: 'The biggest name in Latin music; a broad signal for the genre.' },
      { name: 'Rosalía', type: 'artist', searchHint: 'flamenco pop', why: 'Genre-bending Latin pop with an art-school edge.' },
      { name: 'The Marías', type: 'artist', searchHint: 'indie pop band', why: 'Bilingual dream-pop band at the alternative end of Latin music.' },
    ],
  },
  {
    id: 'bbq_soul',
    label: 'barbecue and soul food',
    keywords: [
      'bbq', 'barbecue', 'barbeque', 'bar b que', 'smokehouse', 'brisket', 'ribs', 'pulled pork', 'soul food',
      'fried chicken', 'collard greens', 'cajun', 'creole', 'southern food', 'southern cooking', 'pitmaster',
    ],
    tone: 'warm',
    audienceSummary: 'A taste for smoked meat, soul food and Southern cooking.',
    anchors: [
      { name: 'Hometown Bar-B-Que', type: 'place', searchHint: 'Red Hook, Brooklyn', why: "Brooklyn's destination barbecue; its regulars travel for smoke." },
      { name: "Sylvia's Restaurant", type: 'place', searchHint: 'Harlem, New York', why: 'The landmark soul-food dining room of Harlem.' },
      { name: 'Ugly Delicious', type: 'tv_show', searchHint: '2018', why: 'Food series for people who care about barbecue, fried chicken and big flavors.' },
    ],
  },
  {
    id: 'japanese',
    label: 'Japanese restaurant',
    keywords: ['ramen', 'sushi', 'izakaya', 'japanese', 'udon', 'soba', 'yakitori', 'omakase', 'matcha', 'onigiri', 'tonkatsu', 'gyoza', 'bento'],
    tone: 'warm',
    audienceSummary: 'A taste for ramen, sushi and Japanese food culture.',
    anchors: [
      { name: 'Tampopo', type: 'movie', searchHint: '1985', why: 'The cult "ramen western"; a love letter to noodle-shop craft.' },
      { name: 'Ippudo', type: 'place', searchHint: 'East Village, New York', why: 'A New York ramen destination since 2008.' },
      { name: 'Jiro Dreams of Sushi', type: 'movie', searchHint: '2011', why: 'Documentary loved by people who seek out Japanese craft cooking.' },
    ],
  },
  {
    id: 'wine_bar',
    label: 'wine and cocktail bar',
    keywords: [
      'wine', 'wines', 'natural wine', 'wine bar', 'orange wine', 'sommelier', 'vino', 'cocktail', 'cocktails',
      'mezcal', 'speakeasy', 'aperitivo', 'negroni', 'martini',
    ],
    tone: 'premium',
    audienceSummary: 'A taste for natural wine, cocktails and small, chef-driven bars.',
    anchors: [
      { name: 'Somm', type: 'movie', searchHint: '2012', why: 'Documentary about master sommeliers; a marker of serious wine interest.' },
      { name: 'The Four Horsemen', type: 'place', searchHint: 'Williamsburg, Brooklyn', why: 'Landmark natural-wine bar and restaurant in Brooklyn.' },
      { name: 'Wildair', type: 'place', searchHint: 'Lower East Side, New York', why: 'Small-plates natural-wine spot with a loyal following.' },
    ],
  },
  {
    id: 'coffee',
    label: 'cafe and bakery',
    keywords: [
      'coffee', 'cafe', 'espresso', 'latte', 'cappuccino', 'roaster', 'roasters', 'roastery', 'cold brew', 'pour over',
      'bakery', 'pastry', 'pastries', 'croissant', 'croissants',
    ],
    tone: 'warm',
    audienceSummary: 'A taste for specialty coffee, good pastry and slow mornings.',
    anchors: [
      { name: 'Blue Bottle Coffee', type: 'brand', searchHint: 'coffee roaster', why: 'Third-wave coffee brand with a devoted New York following.' },
      { name: 'Stumptown Coffee Roasters', type: 'brand', searchHint: 'coffee roaster', why: 'Specialty roaster with long-running New York cafes.' },
      { name: 'La Colombe Coffee Roasters', type: 'brand', searchHint: 'coffee roaster', why: 'Craft coffee brand known for draft lattes and neighborhood cafes.' },
    ],
  },
  {
    id: 'streetwear',
    label: 'streetwear shop',
    keywords: [
      'streetwear', 'sneaker', 'sneakers', 'sneakerhead', 'kicks', 'skate', 'skateboard', 'skateboarding', 'skate shop',
      'hoodie', 'hoodies', 'graphic tees', 'sneaker drop', 'limited drop', 'collab', 'hype',
    ],
    tone: 'bold',
    audienceSummary: 'A taste for streetwear, sneaker drops and downtown style.',
    anchors: [
      { name: 'Kith', type: 'brand', searchHint: 'streetwear', why: 'New York streetwear label whose drops draw lines around the block.' },
      { name: 'Supreme', type: 'brand', searchHint: 'streetwear', why: 'The brand that defined downtown drop culture.' },
      { name: 'Air Jordan', type: 'brand', searchHint: 'sneakers', why: 'The sneaker line at the center of collector culture.' },
    ],
  },
  {
    id: 'animation',
    label: 'animation and illustration',
    keywords: [
      'animation', 'animated', 'animator', 'anime', 'cartoon', 'cartoons', 'comic book', 'comic books', 'graphic novel',
      'manga', 'illustration', 'illustrator', 'hand drawn', 'stop motion', 'ghibli', 'pixar',
    ],
    tone: 'playful',
    audienceSummary: 'A taste for hand-drawn animation, anime and illustrated worlds.',
    anchors: [
      { name: 'Spirited Away', type: 'movie', searchHint: '2001', why: "Studio Ghibli's hand-drawn classic; a core signal for animation lovers." },
      { name: 'Spider-Man: Into the Spider-Verse', type: 'movie', searchHint: '2018', why: 'Inventive comic-book animation with a New York setting.' },
      { name: 'Adventure Time', type: 'tv_show', searchHint: '2010', why: 'Cult animated series for lovers of illustration and offbeat worlds.' },
    ],
  },
  {
    id: 'books',
    label: 'independent bookstore',
    keywords: [
      'book', 'books', 'bookstore', 'bookshop', 'bookseller', 'library', 'reading', 'readings', 'poetry', 'author',
      'authors', 'literary', 'novel', 'novels', 'zine', 'zines', 'book club',
    ],
    tone: 'community',
    audienceSummary: 'A taste for independent bookstores, literary fiction and readings.',
    anchors: [
      { name: 'Strand Book Store', type: 'place', searchHint: 'New York, NY', why: "New York's landmark independent bookstore." },
      { name: 'McNally Jackson Books', type: 'place', searchHint: 'New York, NY', why: 'Independent bookseller known for readings and curated tables.' },
      { name: 'Normal People', type: 'book', searchHint: '2018', why: 'Widely read literary novel; a marker of contemporary-fiction taste.' },
    ],
  },
  {
    id: 'fitness',
    label: 'fitness studio',
    keywords: [
      'fitness', 'gym', 'run club', 'running club', 'runners', 'yoga', 'pilates', 'cycling', 'spin class', 'crossfit',
      'workout', 'workouts', 'marathon', 'boxing', 'climbing', 'bouldering', 'athletic', 'athleisure',
    ],
    tone: 'bold',
    audienceSummary: 'A taste for boutique fitness, running and athletic wear.',
    anchors: [
      { name: 'Equinox', type: 'brand', searchHint: 'fitness club', why: 'Premium gym brand; a strong signal for fitness-first routines.' },
      { name: 'SoulCycle', type: 'brand', searchHint: 'indoor cycling', why: 'Boutique fitness studio brand born in New York.' },
      { name: 'Lululemon', type: 'brand', searchHint: 'athletic apparel', why: 'Athletic-wear brand worn to class and on the run.' },
    ],
  },
  {
    id: 'art',
    label: 'art gallery',
    keywords: [
      'art', 'arts', 'gallery', 'galleries', 'museum', 'museums', 'exhibition', 'exhibit', 'exhibits', 'painting',
      'paintings', 'sculpture', 'photography', 'artist', 'artists', 'printmaking', 'ceramics', 'contemporary art',
    ],
    tone: 'premium',
    audienceSummary: 'A taste for museums, contemporary art and gallery openings.',
    anchors: [
      { name: 'Museum of Modern Art', type: 'place', searchHint: 'New York, NY', why: "MoMA is the city's core signal for modern-art interest." },
      { name: 'Whitney Museum of American Art', type: 'place', searchHint: 'New York, NY', why: 'Contemporary American art museum in the Meatpacking District.' },
      { name: 'Jean-Michel Basquiat', type: 'person', searchHint: 'painter', why: 'New York painter whose work bridges galleries and street culture.' },
    ],
  },
  {
    id: 'family',
    label: 'family activity',
    keywords: [
      'family', 'families', 'kids', 'kid', 'children', 'toddler', 'toddlers', 'baby', 'babies', 'playground', 'stroller',
      'toy', 'toys', 'toy store', 'birthday parties', 'storytime', 'story time',
    ],
    tone: 'community',
    audienceSummary: 'A taste for family outings, picture books and family-friendly culture.',
    anchors: [
      { name: 'Bluey', type: 'tv_show', searchHint: '2018', why: 'Beloved family cartoon; a broad signal for family-friendly taste.' },
      { name: 'Sesame Street', type: 'tv_show', searchHint: '1969', why: 'New York-set classic for family viewing.' },
      { name: 'American Museum of Natural History', type: 'place', searchHint: 'New York, NY', why: "The city's classic family museum outing." },
    ],
  },
  {
    id: 'food',
    label: 'restaurant',
    keywords: [
      'restaurant', 'food', 'kitchen', 'dinner', 'lunch', 'brunch', 'pizza', 'pizzeria', 'tacos', 'taqueria', 'burger',
      'burgers', 'bistro', 'diner', 'eatery', 'chef', 'menu', 'deli', 'bagel', 'bagels', 'noodles', 'dumplings',
    ],
    tone: 'warm',
    audienceSummary: 'A taste for chef-driven food and the restaurant culture behind it.',
    anchors: [
      { name: 'The Bear', type: 'tv_show', searchHint: '2022', why: 'Restaurant drama for people who follow kitchens and chefs.' },
      { name: "Chef's Table", type: 'tv_show', searchHint: '2015', why: 'Chef documentary series; a marker of food-first taste.' },
      { name: 'Anthony Bourdain: Parts Unknown', type: 'tv_show', searchHint: '2013', why: 'Food-and-travel series for adventurous eaters.' },
    ],
  },
];

/** Used when no keyword matches: broad New York culture anchors. */
export const DEFAULT_CATEGORY: TasteCategory = {
  id: 'local',
  label: 'local business',
  keywords: [],
  tone: 'community',
  audienceSummary: 'A broad New York taste for indie music, museums and local culture.',
  anchors: [
    { name: 'Vampire Weekend', type: 'artist', searchHint: 'indie rock band', why: 'New York indie band; a broad signal for local culture.' },
    { name: 'Brooklyn Museum', type: 'place', searchHint: 'Brooklyn, NY', why: 'Major Brooklyn museum with a wide local audience.' },
    { name: 'Broad City', type: 'tv_show', searchHint: '2014', why: 'Very New York comedy with a big local following.' },
  ],
};

/** Every curated anchor, for review and tests. */
export const ANCHOR_LIBRARY: readonly LibraryAnchor[] = [...TASTE_CATEGORIES, DEFAULT_CATEGORY].flatMap((c) => c.anchors);

/** Lower-cased words separated by single spaces and padded, so phrases match on word boundaries. */
function wordText(text: string): string {
  const words = text
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
  return ` ${words} `;
}

const COMPILED = TASTE_CATEGORIES.map((category) => ({
  category,
  keywords: category.keywords.map((k) => ({ text: wordText(k), weight: k.trim().includes(' ') ? 2 : 1 })),
}));

/** Picks the taste category whose keywords best match the brief (ties go to the earlier category). */
export function classifyBrief(brief: Pick<Brief, 'business' | 'description' | 'offer'>): TasteCategory {
  const text = wordText([brief.business, brief.description, brief.offer ?? ''].join(' '));
  let best = DEFAULT_CATEGORY;
  let bestScore = 0;
  for (const { category, keywords } of COMPILED) {
    const score = keywords.reduce((sum, k) => (text.includes(k.text) ? sum + k.weight : sum), 0);
    if (score > bestScore) {
      best = category;
      bestScore = score;
    }
  }
  return best;
}

/** Name fragments of the famous, busy areas a general chatbot suggests first. */
export const BUSY_NEIGHBORHOOD_NAMES = [
  'Midtown', 'Times Square', 'SoHo', 'Williamsburg', 'East Village', 'Lower East Side', 'Chelsea', 'West Village',
  'Greenwich Village', 'Financial District', 'Upper West Side', 'Upper East Side', 'Harlem', 'Park Slope', 'Astoria',
  'Long Island City', 'Downtown Brooklyn', 'Bushwick', 'Greenpoint', 'Flushing',
] as const;

const BUSY_REASON = 'Famous, busy area: the obvious pick without taste data.';

/**
 * Five no-data neighborhood picks: the caller's busy codes first, then names matching the famous
 * list, then the remaining eligible codes in code order. Restricted to the eligible list when given.
 */
export function pickBusyNeighborhoods(
  neighborhoods: readonly NeighborhoodRef[],
  busyNtaCodes: readonly string[] = [],
  count: number = PLANNER_LIMITS.llmOnlyNeighborhoods,
): PlannerOutput['llmOnlyNeighborhoods'] {
  const sorted = neighborhoods
    .map((n) => ({ code: n.code.trim().toUpperCase(), name: n.name.toLowerCase() }))
    .sort((a, b) => (a.code < b.code ? -1 : a.code > b.code ? 1 : 0));
  const eligible = new Set(sorted.map((n) => n.code));
  const picked: string[] = [];
  const add = (code: string) => {
    if (picked.length < count && code && !picked.includes(code) && (eligible.size === 0 || eligible.has(code))) picked.push(code);
  };
  for (const code of busyNtaCodes) add(code.trim().toUpperCase());
  for (const fragment of BUSY_NEIGHBORHOOD_NAMES) {
    const match = sorted.find((n) => n.name.includes(fragment.toLowerCase()) && !picked.includes(n.code));
    if (match) add(match.code);
  }
  for (const n of sorted) add(n.code);
  return picked.map((ntaCode) => ({ ntaCode, reason: BUSY_REASON }));
}

export interface FallbackPlannerOptions {
  /** Eligible neighborhoods (the same list the planner prompt shows). */
  neighborhoods?: readonly NeighborhoodRef[];
  /** Famous/busy NTA codes in priority order (e.g. Midtown, SoHo, Williamsburg, East Village). */
  busyNtaCodes?: readonly string[];
}

/** Deterministic plan from keyword rules and the curated library; always `fallback: true`. */
export function fallbackPlanner(brief: Brief, opts: FallbackPlannerOptions = {}): PlannerOutput {
  const category = classifyBrief(brief);
  const name = brief.business.replace(/\s+/g, ' ').trim();
  const offer = brief.offer?.replace(/\s+/g, ' ').trim() ?? '';
  return {
    business: { name: name || null, category: category.label, offer: offer || null },
    audienceSummary: category.audienceSummary,
    anchors: category.anchors.map((a) => ({ ...a })),
    tone: category.tone,
    llmOnlyNeighborhoods: pickBusyNeighborhoods(opts.neighborhoods ?? [], opts.busyNtaCodes ?? []),
    budgetUsd: Number.isFinite(brief.budgetUsd) && brief.budgetUsd > 0 ? brief.budgetUsd : null,
    weeks: Number.isFinite(brief.weeks) && brief.weeks > 0 ? Math.max(1, Math.round(brief.weeks)) : null,
    fallback: true,
  };
}
