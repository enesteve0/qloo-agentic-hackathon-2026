/**
 * SYNTHETIC demo run — NOT Qloo data.
 *
 * A complete, deterministic `RunState` for the fictional Halfnote Supper Club, used as the design canvas
 * (`/plan/demo`) and as an e2e target until recorded live runs exist. The geography is real public data
 * (NYC Open Data LinkNYC kiosks, 2020 neighborhoods and the gh6 analysis grid); every taste value, tag,
 * place, ad, plan figure and comparison below is generated locally and labelled `{ kind: 'synthetic' }`.
 *
 * Server-side only: it imports the full kiosk/NTA/grid JSON, which must never reach a client bundle.
 */
import gridData from '@/data/grid-gh6.json';
import kioskData from '@/data/kiosks.json';
import ntaData from '@/data/nta2020.json';
import type {
  AnchorMapInfo,
  Brief,
  Candidate,
  Confidence,
  CreativeSet,
  CreativeVariant,
  EntityType,
  EvidencePack,
  Kiosk,
  LiftConfig,
  MediaPlan,
  NtaInfo,
  NtaScore,
  PlannedScreen,
  PlannerOutput,
  PricingAssumptions,
  Proof,
  ProvenanceRequest,
  ResolutionIssue,
  ResolutionOutcome,
  RunState,
  StageEnvelope,
  StageId,
  StageInfo,
  WhereResult,
} from '@/shared/types';

interface GridFile {
  precision: number;
  cells: string[];
  ntaWeights: Record<string, [cellIndex: number, weight: number][]>;
  kioskCell: number[];
}

const KIOSKS = kioskData as unknown as Kiosk[];
const NTAS = ntaData as unknown as NtaInfo[];
const GRID = gridData as unknown as GridFile;

// ---------------------------------------------------------------------------------------------
// Deterministic helpers (no Math.random: the demo must render identically on every request)
// ---------------------------------------------------------------------------------------------

/** FNV-1a → [0, 1). */
function hash01(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0) / 4294967296;
}

/** Symmetric noise in [-1, 1). */
const noise = (key: string) => hash01(key) * 2 - 1;

const round = (x: number, digits: number) => {
  const f = 10 ** digits;
  const r = Math.round(x * f) / f;
  return r === 0 ? 0 : r;
};

const GH32 = '0123456789bcdefghjkmnpqrstuvwxyz';

/** Center of a geohash cell. */
function geohashCenter(gh: string): { lon: number; lat: number } {
  const lon: [number, number] = [-180, 180];
  const lat: [number, number] = [-90, 90];
  let even = true;
  for (const ch of gh) {
    const bits = GH32.indexOf(ch);
    for (let mask = 16; mask >= 1; mask >>= 1) {
      const range = even ? lon : lat;
      const mid = (range[0] + range[1]) / 2;
      if (bits & mask) range[0] = mid;
      else range[1] = mid;
      even = !even;
    }
  }
  return { lon: (lon[0] + lon[1]) / 2, lat: (lat[0] + lat[1]) / 2 };
}

function km(a: { lon: number; lat: number }, b: { lon: number; lat: number }): number {
  const dx = (a.lon - b.lon) * Math.cos(((a.lat + b.lat) / 2) * (Math.PI / 180)) * 111.32;
  const dy = (a.lat - b.lat) * 110.57;
  return Math.hypot(dx, dy);
}

/** Same rule and display device as the live engine (src/server/geo/where.ts): clamp(1.6^L̂, 0.3, 4). */
const multiplier = (lift: number) => Math.min(4, Math.max(0.3, 1.6 ** lift));

/** Percentile (0–100) of each value among the defined ones, average ranks for ties: 100·(rank − 0.5)/n. */
function percentiles(values: number[]): number[] {
  const idx = values.map((v, i) => [v, i] as const).filter(([v]) => !Number.isNaN(v));
  idx.sort((a, b) => a[0] - b[0]);
  const out = values.map(() => NaN);
  let k = 0;
  while (k < idx.length) {
    let j = k;
    while (j + 1 < idx.length && idx[j + 1]![0] === idx[k]![0]) j++;
    const rank = (k + j) / 2 + 1;
    for (let m = k; m <= j; m++) out[idx[m]![1]] = (100 * (rank - 0.5)) / idx.length;
    k = j + 1;
  }
  return out;
}

const SYN_UUID = (n: number) => `5157E7C0-0000-4000-8000-${n.toString().padStart(12, '0')}`;

// ---------------------------------------------------------------------------------------------
// The brief, anchors and the four hero neighborhoods
// ---------------------------------------------------------------------------------------------

const CREATED_AT = '2026-10-26T18:00:00.000Z';

const BRIEF: Brief = {
  business: 'Halfnote Supper Club',
  description:
    'A 48-seat jazz supper club opening on Nostrand Avenue in Bed-Stuy, with Tuesday jam nights and a soul-food menu.',
  offer: 'Free first set on Tuesdays',
  budgetUsd: 2000,
  weeks: 3,
  startDate: '2026-11-16',
  address: 'Nostrand Av & Fulton St, Brooklyn',
};

interface AnchorSeed {
  input: string;
  type: EntityType;
  match: 'exact' | 'semantic';
  candidate: Candidate;
  alternatives: Candidate[];
  warnings: string[];
  flags: AnchorMapInfo['flags'];
  weight: number;
  why: string;
  searchHint: string | null;
}

const ANCHORS: AnchorSeed[] = [
  {
    input: 'Robert Glasper',
    type: 'artist',
    match: 'exact',
    candidate: { id: SYN_UUID(1), name: 'Robert Glasper', type: 'artist', disambiguation: 'Jazz pianist and producer', popularity: null, year: null },
    alternatives: [],
    warnings: [],
    flags: [],
    weight: 1,
    why: 'Modern jazz that crosses into soul and hip-hop: the sound of the room.',
    searchHint: null,
  },
  {
    input: 'Esperanza Spalding',
    type: 'artist',
    match: 'exact',
    candidate: { id: SYN_UUID(2), name: 'Esperanza Spalding', type: 'artist', disambiguation: 'Jazz bassist and singer', popularity: null, year: null },
    alternatives: [],
    warnings: [],
    flags: [],
    weight: 1,
    why: 'Listeners who seek out live, adventurous jazz.',
    searchHint: null,
  },
  {
    input: 'Blue Note Jazz Club',
    type: 'place',
    match: 'semantic',
    candidate: { id: SYN_UUID(3), name: 'Blue Note', type: 'place', disambiguation: 'Jazz club · New York, NY', popularity: null, year: null },
    alternatives: [
      { id: SYN_UUID(31), name: 'Blue Note Records', type: 'place', disambiguation: 'Record label office · New York, NY', popularity: null, year: null },
    ],
    warnings: ['Matched by meaning: “Blue Note Jazz Club” → “Blue Note”.'],
    flags: [],
    weight: 1,
    why: 'People who already go out for a ticketed jazz set and dinner.',
    searchHint: 'New York',
  },
  {
    input: 'Soul',
    type: 'movie',
    match: 'exact',
    candidate: { id: SYN_UUID(4), name: 'Soul', type: 'movie', disambiguation: 'Film · 2020', popularity: null, year: 2020 },
    alternatives: [
      { id: SYN_UUID(41), name: 'Soul Food', type: 'movie', disambiguation: 'Film · 1997', popularity: null, year: 1997 },
    ],
    warnings: [],
    flags: ['DENSITY_ONLY'],
    weight: 0.5,
    why: 'A widely loved jazz film: broad reach, softer signal.',
    searchHint: '2020',
  },
];

interface HeroSeed {
  code: string;
  /** Target shrunk lift L̂ (z units); the display multiplier follows from the live engine's rule. */
  lift: number;
  confidence: Confidence;
  screens: number;
}

/** The four neighborhoods the synthetic plan buys, strongest first. */
// Screen counts follow the live optimizer's logic under the default assumptions: Manhattan screens cost
// three times as much, so Harlem gets the one screen the repair pass guarantees each top neighborhood.
const HEROES: HeroSeed[] = [
  { code: 'BK0301', lift: 2.05, confidence: 'high', screens: 6 },
  { code: 'BK0802', lift: 1.79, confidence: 'high', screens: 5 },
  { code: 'MN1001', lift: 1.6, confidence: 'high', screens: 1 },
  { code: 'BK0203', lift: 1.38, confidence: 'medium', screens: 2 },
];

/** What an AI model with no taste data suggested for the same brief (synthetic). */
const LLM_PICKS: { nta: string; reason: string }[] = [
  { nta: 'MN0502', reason: 'Highest foot traffic in the city: maximum eyeballs for a launch.' },
  { nta: 'MN0201', reason: 'Shoppers and evening crowds who go out to eat.' },
  { nta: 'BK0102', reason: 'Brooklyn’s best-known nightlife strip.' },
  { nta: 'MN0303', reason: 'Dense bar and live-music scene.' },
  { nta: 'BK0301', reason: 'The club’s own neighborhood.' },
];

// Synthetic taste surface: Gaussian bumps (km) over the real gh6 grid; negative bumps are busy cores
// whose synthetic taste signal sits below the NYC baseline.
const BUMPS: { lon: number; lat: number; amp: number; sigma: number }[] = [
  { lon: -73.95116, lat: 40.68882, amp: 3.0, sigma: 0.95 }, // Bed-Stuy (West)
  { lon: -73.94133, lat: 40.674, amp: 2.7, sigma: 0.9 }, // Crown Heights (North)
  { lon: -73.95168, lat: 40.80387, amp: 2.6, sigma: 1.0 }, // Harlem (South)
  { lon: -73.97417, lat: 40.69277, amp: 2.2, sigma: 0.7 }, // Fort Greene
  { lon: -73.93709, lat: 40.82706, amp: 1.0, sigma: 1.0 },
  { lon: -73.95736, lat: 40.64313, amp: 0.9, sigma: 1.1 },
  { lon: -73.9822, lat: 40.72626, amp: 0.45, sigma: 0.7 },
  { lon: -73.957, lat: 40.716, amp: 0.5, sigma: 0.8 },
  { lon: -73.98, lat: 40.756, amp: -1.7, sigma: 2.0 },
  { lon: -74.009, lat: 40.707, amp: -1.0, sigma: 1.0 },
  { lon: -73.958, lat: 40.772, amp: -0.9, sigma: 1.4 },
  { lon: -74.003, lat: 40.723, amp: -0.7, sigma: 0.8 },
];
const BASE_OFFSET = -0.12;

function surface(p: { lon: number; lat: number }): number {
  let v = BASE_OFFSET;
  for (const b of BUMPS) {
    const d = km(p, b);
    v += b.amp * Math.exp(-(d * d) / (2 * b.sigma * b.sigma));
  }
  return v;
}

// ---------------------------------------------------------------------------------------------
// WHERE: cells → neighborhoods, kiosks and heat (same shapes and rules as the live engine)
// ---------------------------------------------------------------------------------------------

interface WhereBuild {
  where: WhereResult;
  /** Smoothed surface per grid cell (kiosk scores, heat, taste-weighted impressions). */
  S: number[];
}

function buildWhere(): WhereBuild {
  const centers = GRID.cells.map(geohashCenter);
  // L: unsmoothed (noisier) surface for neighborhood aggregation; S: smoothed surface for kiosks and heat.
  const L = centers.map((c, g) => surface(c) + 0.35 * noise(`L:${GRID.cells[g]}`));
  const S = centers.map((c, g) => surface(c) + 0.12 * noise(`S:${GRID.cells[g]}`));

  const eligible = NTAS.filter((n) => n.residential && n.adKiosks >= 2);
  const kappa = 1.5;
  const rows = eligible.flatMap((nta) => {
    const pairs = GRID.ntaWeights[nta.code] ?? [];
    let W = 0;
    let W2 = 0;
    let sum = 0;
    for (const [g, w] of pairs) {
      const l = L[g];
      if (l === undefined || !(w > 0)) continue;
      W += w;
      W2 += w * w;
      sum += w * l;
    }
    if (W === 0) return [];
    const mean = sum / W;
    const nEff = (W * W) / W2;
    let ss = 0;
    for (const [g, w] of pairs) {
      const l = L[g];
      if (l === undefined || !(w > 0)) continue;
      ss += w * (l - mean) ** 2;
    }
    const sd = nEff > 1 ? Math.sqrt((ss / W) * (nEff / (nEff - 1))) : 0.6;
    return [{ nta, lift: mean * (nEff / (nEff + kappa)), se: Math.max(sd, 0.25) / Math.sqrt(nEff), nEff }];
  });

  // Pin the four hero neighborhoods to their targets and keep everyone else below them.
  const heroLift = new Map(HEROES.map((h) => [h.code, h.lift]));
  const floor = HEROES[HEROES.length - 1]!.lift - 0.12;
  const maxOther = Math.max(...rows.filter((r) => !heroLift.has(r.nta.code)).map((r) => r.lift));
  const squeeze = maxOther > floor ? floor / maxOther : 1;
  for (const r of rows) {
    const pinned = heroLift.get(r.nta.code);
    r.lift = pinned ?? (r.lift > 0 ? r.lift * squeeze : r.lift);
  }

  const fit = percentiles(rows.map((r) => r.lift));
  const totalWeight = ANCHORS.reduce((a, x) => a + x.weight, 0);
  const ntas: NtaScore[] = rows
    .map((r, k) => {
      const perAnchor = ANCHORS.map((a) => r.lift + 0.35 * noise(`agree:${r.nta.code}:${a.candidate.id}`));
      const agreement = perAnchor.filter((v) => v > 0).length / perAnchor.length;
      const t = r.lift / r.se;
      const computed: Confidence =
        t >= 2 && agreement >= 2 / 3 && r.nEff >= 3 ? 'high' : t >= 1 && agreement >= 1 / 2 ? 'medium' : 'low';
      const hero = HEROES.find((h) => h.code === r.nta.code);
      const contributions = ANCHORS.map((a, i) => ({
        anchorId: a.candidate.id,
        contribution: (a.weight / totalWeight) * perAnchor[i]!,
      }))
        .sort((x, y) => y.contribution - x.contribution)
        .slice(0, 3)
        .map((c) => ({ anchorId: c.anchorId, contribution: round(c.contribution, 4) }));
      return {
        code: r.nta.code,
        name: r.nta.name,
        short: r.nta.short,
        boro: r.nta.boro,
        lift: round(r.lift, 4),
        se: round(r.se, 4),
        nEff: round(r.nEff, 2),
        agreement: round(hero ? Math.max(agreement, 0.75) : agreement, 3),
        confidence: hero ? hero.confidence : computed,
        fitIndex: Math.round(fit[k]!),
        multiplier: round(multiplier(r.lift), 2),
        topAnchors: contributions,
        adKiosks: r.nta.adKiosks,
      } satisfies NtaScore;
    })
    .sort((a, b) => b.lift - a.lift || (a.code < b.code ? -1 : 1));

  // Kiosk fit: percentile of the smoothed surface at each kiosk's cell.
  const atKiosk = KIOSKS.map((_, i) => {
    const cell = GRID.kioskCell[i] ?? -1;
    return cell >= 0 ? (S[cell] ?? NaN) : NaN;
  });
  const kioskFit = percentiles(atKiosk).map((p) => (Number.isNaN(p) ? -1 : Math.round(p)));

  // Heat: strongest 400 above-baseline cells, displayed as multipliers.
  const heat = S.map((v, g) => ({ g, v }))
    .filter((x) => x.v > 0)
    .sort((a, b) => b.v - a.v || a.g - b.g)
    .slice(0, 400)
    .map((x) => ({ gh: GRID.cells[x.g]!, v: round(multiplier(x.v), 2) }))
    .filter((h) => h.v > 1);

  const config: LiftConfig = {
    metric: 'affinity_rank',
    baseline: 'B2',
    form: 'difference',
    kappa,
    thresholds: { defaultMapRho: 0.98, identicalRho: 0.999, densityOnlyRho: 0.99, thinMinCells: 300, thinMinOverlap: 0.5 },
    experimental: false,
  };
  const covered = GRID.cells.length - 68;
  const anchors: AnchorMapInfo[] = ANCHORS.map((a, i) => ({
    anchorId: a.candidate.id,
    name: a.candidate.name,
    flags: a.flags,
    weight: a.weight,
    coverage: round(0.93 + 0.01 * i, 2),
    cells: covered - 9 * i,
  }));

  return { where: { config, anchors, ntas, kioskFit, heat, grid: { cells: GRID.cells.length, covered } }, S };
}

// ---------------------------------------------------------------------------------------------
// WHAT: evidence packs and creative (synthetic tags; copy obeys PRODUCT §5 rules)
// ---------------------------------------------------------------------------------------------

type TagSeed = [slug: string, label: string, tagType: string, support: number];

const TAG_TYPES = {
  genre: 'urn:tag:genre:place',
  cuisine: 'urn:tag:cuisine:qloo',
  time: 'urn:tag:time_of_day_fit:qloo',
  ambience: 'urn:tag:ambience:qloo',
  goodFor: 'urn:tag:good_for:qloo',
  drink: 'urn:tag:beverage_offering:qloo',
} as const;

const EVIDENCE_SEEDS: Record<string, { tags: TagSeed[]; places: [name: string, categories: string[]][] }> = {
  BK0301: {
    tags: [
      ['live_jazz', 'Live jazz', TAG_TYPES.genre, 6],
      ['soul_food', 'Soul food', TAG_TYPES.cuisine, 5],
      ['late_night', 'Late night', TAG_TYPES.time, 7],
      ['cozy', 'Cozy', TAG_TYPES.ambience, 4],
      ['cocktails', 'Cocktails', TAG_TYPES.drink, 4],
    ],
    places: [
      ['Jazz room (synthetic)', ['Jazz club', 'Bar']],
      ['Soul food kitchen (synthetic)', ['Restaurant', 'Soul food']],
      ['Corner cocktail bar (synthetic)', ['Cocktail bar']],
      ['Brownstone café (synthetic)', ['Café']],
    ],
  },
  BK0802: {
    tags: [
      ['listening_bar', 'Listening bar', TAG_TYPES.genre, 4],
      ['vinyl', 'Vinyl', TAG_TYPES.ambience, 5],
      ['natural_wine', 'Natural wine', TAG_TYPES.drink, 4],
      ['late_night', 'Late night', TAG_TYPES.time, 6],
      ['lively', 'Lively', TAG_TYPES.ambience, 3],
    ],
    places: [
      ['Hi-fi listening bar (synthetic)', ['Listening bar']],
      ['Record shop and bar (synthetic)', ['Record store', 'Bar']],
      ['Natural wine bar (synthetic)', ['Wine bar']],
      ['Late kitchen (synthetic)', ['Restaurant']],
    ],
  },
  MN1001: {
    tags: [
      ['jazz_club', 'Jazz club', TAG_TYPES.genre, 7],
      ['supper_club', 'Supper club', TAG_TYPES.genre, 3],
      ['date_night', 'Date night', TAG_TYPES.goodFor, 6],
      ['live_music', 'Live music', TAG_TYPES.genre, 8],
      ['classic_cocktails', 'Classic cocktails', TAG_TYPES.drink, 5],
    ],
    places: [
      ['Jazz club (synthetic)', ['Jazz club']],
      ['Supper club (synthetic)', ['Supper club', 'Restaurant']],
      ['Piano bar (synthetic)', ['Bar']],
      ['Cocktail lounge (synthetic)', ['Cocktail bar']],
    ],
  },
  BK0203: {
    tags: [
      ['wine_bar', 'Wine bar', TAG_TYPES.genre, 5],
      ['date_night', 'Date night', TAG_TYPES.goodFor, 6],
      ['live_music', 'Live music', TAG_TYPES.genre, 4],
      ['bistro', 'Bistro', TAG_TYPES.genre, 4],
      ['intimate', 'Intimate', TAG_TYPES.ambience, 3],
    ],
    places: [
      ['Neighborhood bistro (synthetic)', ['Bistro']],
      ['Wine bar (synthetic)', ['Wine bar']],
      ['Small music venue (synthetic)', ['Music venue']],
    ],
  },
};

const evId = (nta: string, slug: string) => `ev:${nta}:synthetic_tag_${slug}`;

function buildEvidence(ntaByCode: Map<string, NtaScore>): EvidencePack[] {
  return HEROES.map((h) => {
    const seed = EVIDENCE_SEEDS[h.code]!;
    const nta = ntaByCode.get(h.code)!;
    return {
      nta: h.code,
      shortName: nta.short,
      items: seed.tags.map(([slug, label, tagType, support], k) => ({
        id: evId(h.code, slug),
        kind: tagType === TAG_TYPES.genre ? 'category' : 'tag',
        label,
        tagType,
        weight: round(0.42 - 0.06 * k + 0.02 * noise(`w:${h.code}:${slug}`), 3),
        support,
      })),
      places: seed.places.map(([name, categories], k) => ({
        id: `synthetic_place_${h.code.toLowerCase()}_${k + 1}`,
        name,
        categories,
        explain: ANCHORS.slice(0, 3).map((a, j) => ({
          anchorId: a.candidate.id,
          score: round(0.9 - 0.12 * j - 0.05 * k + 0.03 * noise(`x:${h.code}:${k}:${j}`), 2),
        })),
      })),
    };
  });
}

const PASSED = { ok: true, failed: [], replacedByTemplate: false } as const;

type CopySeed = Pick<CreativeVariant, 'headline' | 'body' | 'cta' | 'rationale'> & { refs: [slug: string, phrase: string][] };

const COPY: Record<string, [CopySeed, CopySeed]> = {
  BK0301: [
    {
      headline: 'Bed-Stuy, your jazz room is open',
      body: 'Halfnote Supper Club: live jazz, soul food and a cozy room that stays up late.',
      cta: 'Book a table',
      rationale: 'Leads with the three tags that over-index most in this neighborhood’s evidence.',
      refs: [
        ['live_jazz', 'live jazz'],
        ['soul_food', 'soul food'],
        ['cozy', 'cozy'],
      ],
    },
    {
      headline: 'Free first set on Tuesdays',
      body: 'Halfnote Supper Club brings late night live jazz and soul food to Bed-Stuy.',
      cta: 'Reserve a Tuesday',
      rationale: 'Leads with the offer; the body keeps the local late-night and jazz signal.',
      refs: [
        ['late_night', 'late night'],
        ['live_jazz', 'live jazz'],
        ['soul_food', 'soul food'],
      ],
    },
  ],
  BK0802: [
    {
      headline: 'Crown Heights, lend us your ears',
      body: 'Halfnote Supper Club: a listening bar feel, vinyl between sets and natural wine.',
      cta: 'Book a table',
      rationale: 'Speaks to the listening-bar and vinyl tags that set this neighborhood apart.',
      refs: [
        ['listening_bar', 'listening bar'],
        ['vinyl', 'vinyl'],
        ['natural_wine', 'natural wine'],
      ],
    },
    {
      headline: 'Free first set on Tuesdays',
      body: 'Late night jazz, vinyl and natural wine at Halfnote Supper Club.',
      cta: 'Reserve a Tuesday',
      rationale: 'Offer first, then the local late-night and natural-wine evidence.',
      refs: [
        ['late_night', 'late night'],
        ['vinyl', 'vinyl'],
        ['natural_wine', 'natural wine'],
      ],
    },
  ],
  MN1001: [
    {
      headline: 'Harlem, jazz has a new address',
      body: 'Halfnote Supper Club: live music, classic cocktails and a table for date night.',
      cta: 'Book a table',
      rationale: 'Jazz-club and date-night tags lead here; the footer carries the address.',
      refs: [
        ['live_music', 'live music'],
        ['classic_cocktails', 'classic cocktails'],
        ['date_night', 'date night'],
      ],
    },
    {
      headline: 'Free first set on Tuesdays',
      body: 'Halfnote Supper Club: supper club service, jazz club nights, classic cocktails.',
      cta: 'Reserve a Tuesday',
      rationale: 'Offer first; supper-club and jazz-club tags are unusually strong here.',
      refs: [
        ['supper_club', 'supper club'],
        ['jazz_club', 'jazz club'],
        ['classic_cocktails', 'classic cocktails'],
      ],
    },
  ],
  BK0203: [
    {
      headline: 'Fort Greene date night, upgraded',
      body: 'Halfnote Supper Club: intimate tables, live music and a wine list worth the trip.',
      cta: 'Book a table',
      rationale: 'Date-night and intimate tags lead; live music ties it to the club.',
      refs: [
        ['date_night', 'date night'],
        ['intimate', 'intimate'],
        ['live_music', 'live music'],
      ],
    },
    {
      headline: 'Free first set on Tuesdays',
      body: 'Halfnote Supper Club. Live music, wine bar energy and date night tables.',
      cta: 'Reserve a Tuesday',
      rationale: 'Template: rebuilt by rules from this neighborhood’s evidence after the model draft failed a check.',
      refs: [
        ['live_music', 'live music'],
        ['wine_bar', 'wine bar'],
        ['date_night', 'date night'],
      ],
    },
  ],
};

function buildCreative(): CreativeSet[] {
  return HEROES.map((h) => {
    const variants = COPY[h.code]!.map((seed, k): CreativeVariant => {
      // One synthetic model draft named another neighborhood, so rules rebuilt it (shows the TEMPLATE path).
      const templated = h.code === 'BK0203' && k === 1;
      return {
        nta: h.code,
        variant: k === 0 ? 'A' : 'B',
        headline: seed.headline,
        body: seed.body,
        cta: seed.cta,
        references: seed.refs.map(([slug, phrase]) => ({ evidenceId: evId(h.code, slug), phrase })),
        rationale: seed.rationale,
        grounding: templated
          ? {
              ok: true,
              failed: [{ rule: 'foreign_local', detail: 'The model’s draft named another neighborhood (Bed-Stuy).' }],
              replacedByTemplate: true,
            }
          : { ...PASSED, failed: [] },
        source: templated ? 'template' : 'model',
      };
    });
    return { nta: h.code, variants, via: 'synthetic' };
  });
}

// ---------------------------------------------------------------------------------------------
// PLAN and PROOF
// ---------------------------------------------------------------------------------------------

/** The live defaults (src/server/plan/assumptions.ts), copied so the sample prices like a real plan. */
const ASSUMPTIONS: PricingAssumptions = {
  label: 'assumption',
  pricePerKioskWeek: { manhattan: 120, outer: 40 },
  impressionsPerKioskWeek: { manhattan: 10000, outer: 3500 },
};

function screenFor(k: Kiosk, fit: number, s: number, weeks: number): PlannedScreen & { tw: number } {
  const manhattan = k.boro === 'Manhattan';
  const weekly = manhattan ? ASSUMPTIONS.impressionsPerKioskWeek.manhattan : ASSUMPTIONS.impressionsPerKioskWeek.outer;
  const price = manhattan ? ASSUMPTIONS.pricePerKioskWeek.manhattan : ASSUMPTIONS.pricePerKioskWeek.outer;
  return { i: k.i, siteId: k.siteId, nta: k.nta, fit, weeklyImpressions: weekly, cost: price * weeks, tw: weekly * weeks * Math.max(s, 0) };
}

function candidatesIn(nta: string, kioskFit: number[], S: number[]) {
  return KIOSKS.filter((k) => k.nta === nta && (kioskFit[k.i] ?? -1) >= 0)
    .map((k) => {
      const cell = GRID.kioskCell[k.i] ?? -1;
      return screenFor(k, kioskFit[k.i]!, cell >= 0 ? (S[cell] ?? 0) : 0, BRIEF.weeks);
    })
    .sort((a, b) => b.fit - a.fit || (a.siteId < b.siteId ? -1 : 1));
}

function buildPlan(where: WhereResult, S: number[]): { plan: MediaPlan; tw: number } {
  const chosen: (PlannedScreen & { tw: number })[] = [];
  const spare: (PlannedScreen & { tw: number })[] = [];
  for (const h of HEROES) {
    const list = candidatesIn(h.code, where.kioskFit, S);
    chosen.push(...list.slice(0, h.screens));
    spare.push(...list.slice(h.screens));
  }
  const strip = (s: PlannedScreen & { tw: number }): PlannedScreen => ({
    i: s.i,
    siteId: s.siteId,
    nta: s.nta,
    fit: s.fit,
    weeklyImpressions: s.weeklyImpressions,
    cost: s.cost,
  });
  const byNta = HEROES.map((h) => {
    const mine = chosen.filter((s) => s.nta === h.code);
    return {
      nta: h.code,
      screens: mine.length,
      spend: mine.reduce((a, s) => a + s.cost, 0),
      tasteWeightedImpressions: Math.round(mine.reduce((a, s) => a + s.tw, 0)),
    };
  });
  const spend = chosen.reduce((a, s) => a + s.cost, 0);
  const tw = Math.round(chosen.reduce((a, s) => a + s.tw, 0));
  const plan: MediaPlan = {
    budgetUsd: BRIEF.budgetUsd,
    weeks: BRIEF.weeks,
    assumptions: ASSUMPTIONS,
    screens: chosen.map(strip),
    byNta,
    totals: {
      spend,
      impressions: chosen.reduce((a, s) => a + s.weeklyImpressions * BRIEF.weeks, 0),
      tasteWeightedImpressions: tw,
      screens: chosen.length,
    },
    leftoverUsd: BRIEF.budgetUsd - spend,
    nextBest: spare
      .sort((a, b) => b.fit - a.fit || (a.siteId < b.siteId ? -1 : 1))
      .slice(0, 3)
      .map(strip),
    infeasibleReason: null,
  };
  return { plan, tw };
}

/** The same budget spread over the LLM's picks (best-fit screens first, round robin). */
function llmOnlyPlan(where: WhereResult, S: number[], ntaByCode: Map<string, NtaScore>) {
  const queues = LLM_PICKS.map((p) => candidatesIn(p.nta, where.kioskFit, S));
  let budget = BRIEF.budgetUsd;
  let tw = 0;
  let below = 0;
  let spent = 0;
  for (let round = 0; round < 20; round++) {
    let bought = false;
    queues.forEach((q, k) => {
      const next = q[round];
      if (!next || next.cost > budget) return;
      budget -= next.cost;
      spent += next.cost;
      tw += next.tw;
      if ((ntaByCode.get(LLM_PICKS[k]!.nta)?.lift ?? 0) < 0) below += next.cost;
      bought = true;
    });
    if (!bought) break;
  }
  return { tasteWeightedImpressions: Math.round(tw), belowBaselineShare: round(spent ? below / spent : 0, 3) };
}

function buildProof(where: WhereResult, ntaByCode: Map<string, NtaScore>, packs: EvidencePack[], oursTw: number, S: number[]): Proof {
  const llmPicks = LLM_PICKS.map((p) => ({ nta: p.nta, reason: p.reason, percentile: ntaByCode.get(p.nta)?.fitIndex ?? null }));
  const ourTop5 = new Set(where.ntas.slice(0, 5).map((n) => n.code));
  const pct = llmPicks.map((p) => p.percentile).filter((p): p is number => p !== null).sort((a, b) => a - b);
  const missed = HEROES.find((h) => !LLM_PICKS.some((p) => p.nta === h.code));
  const missedPack = missed ? packs.find((p) => p.nta === missed.code) : undefined;
  return {
    available: true,
    llmPicks,
    overlapAt5: LLM_PICKS.filter((p) => ourTop5.has(p.nta)).length,
    medianLlmPercentile: pct.length ? pct[Math.floor(pct.length / 2)]! : null,
    ours: { tasteWeightedImpressions: oursTw, belowBaselineShare: 0 },
    llmOnly: llmOnlyPlan(where, S, ntaByCode),
    missedByLlm: missed && missedPack ? { nta: missed.code, evidence: missedPack.items.slice(0, 3).map((i) => i.label) } : null,
    note:
      'Both plans are scored on the same taste maps Stoop optimizes, so this comparison is partly circular. It shows what changes when the AI gets taste data, not that either plan will sell more.',
  };
}

// ---------------------------------------------------------------------------------------------
// Agent narration, stages and provenance envelopes
// ---------------------------------------------------------------------------------------------

const STAGES: [StageId, string, string | null, number][] = [
  ['intake', 'Reading the brief', 'Halfnote Supper Club · $2,000 · 3 wk', 40],
  ['plan', 'Choosing taste anchors', '4 anchors: 2 artists, a venue, a film', 2310],
  ['resolve', 'Matching anchors in Qloo', '4 of 4 matched', 1840],
  ['where', 'Mapping where this taste over-indexes', '106 neighborhoods scored', 6420],
  ['evidence', 'Reading each neighborhood’s taste', '4 neighborhoods read', 4130],
  ['creative', 'Writing the ads', '8 ads, 1 rebuilt by rules', 5260],
  ['optimize', 'Fitting the budget', null, 30],
  ['proof', 'Comparing with an AI that has no Qloo', '1 of 5 picks overlap', 20],
  ['finalize', 'Plan ready', null, 10],
];

function req(path: string, query: string, purpose: ProvenanceRequest['purpose'], ms: number, cache: 'hit' | 'miss' = 'miss'): ProvenanceRequest {
  return { method: 'GET', path, query, status: 200, cache, ms, attempt: 1, purpose };
}

function buildEnvelopes(where: WhereResult): StageEnvelope[] {
  const ids = ANCHORS.map((a) => a.candidate.id);
  const top = where.ntas.slice(0, 3).map((n) => `${n.short} ${n.multiplier.toFixed(1)}×`).join(', ');
  const base = { transport: 'mock' as const };
  return [
    {
      operation: 'resolve_anchors',
      status: 'ok',
      query_intent: {
        job: 'Match the planner’s taste anchors to Qloo entities',
        target: 'urn:entity:artist, urn:entity:place, urn:entity:movie',
        signals: ANCHORS.map((a) => a.input),
        filters: ['take=5', 'places: within 25 miles of NYC'],
        assumptions: ['“Soul” means the 2020 film (year hint from the planner)'],
        unresolved: [],
      },
      interpretation: 'Matched 4 of 4 anchors; 1 by meaning (“Blue Note Jazz Club” → “Blue Note”).',
      result_count: 4,
      execution: { ...base, correlation_id: 'syn-resolve-0001', duration_ms: 1840 },
      provenance: {
        source: 'Synthetic Qloo transport',
        requests: [
          req('/search', 'query=Robert%20Glasper&types=urn:entity:artist&take=5', 'resolve', 412),
          req('/search', 'query=Esperanza%20Spalding&types=urn:entity:artist&take=5', 'resolve', 388),
          req('/search', 'query=Blue%20Note%20Jazz%20Club&types=urn:entity:place&filter.location=40.7128,-74.0060&filter.radius=25&take=5', 'resolve', 547),
          req('/search', 'query=Soul&types=urn:entity:movie&take=5', 'resolve', 401),
        ],
      },
      what_this_supports: 'Which real-world entities stand for this business’s taste. Nothing about the owner or customers is sent.',
      warnings: ['Matched by meaning: “Blue Note Jazz Club” → “Blue Note”.'],
    },
    {
      operation: 'map_taste_lift',
      status: 'ok',
      query_intent: {
        job: 'Map where each anchor’s taste over-indexes against the NYC baseline',
        target: 'urn:heatmap',
        signals: ANCHORS.map((a) => a.candidate.name),
        filters: ['filter.location=POLYGON(NYC study area)'],
        assumptions: ['Baseline: NYC-wide restaurant taste map (B2)', 'Lift = z(anchor rank) − z(baseline), shrunk per neighborhood'],
        unresolved: [],
      },
      interpretation: `Scored ${where.ntas.length} neighborhoods; strongest: ${top}.`,
      result_count: where.ntas.length,
      execution: { ...base, correlation_id: 'syn-where-0001', duration_ms: 6420 },
      provenance: {
        source: 'Synthetic Qloo transport',
        requests: [
          ...ids.map((id, k) =>
            req('/v2/insights', `filter.type=urn:heatmap&signal.interests.entities=${id}&filter.location=POLYGON(NYC study area)`, 'heatmap', 1180 + 140 * k),
          ),
          req(
            '/v2/insights',
            'filter.type=urn:heatmap&signal.interests.tags=urn:tag:genre:place:restaurant&filter.location=POLYGON(NYC study area)',
            'baseline',
            6,
            'hit',
          ),
        ],
      },
      what_this_supports:
        'Where your anchor audience’s Qloo signal ranks higher than NYC’s overall signal. Not foot traffic, population or visits; says nothing about any individual.',
      warnings: ['Half weight for “Soul”: its NYC map mostly follows overall density.'],
    },
    {
      operation: 'neighborhood_evidence',
      status: 'ok',
      query_intent: {
        job: 'Read what each top neighborhood’s taste looks like on the ground',
        target: 'urn:entity:place',
        signals: ANCHORS.slice(0, 3).map((a) => a.candidate.name),
        filters: HEROES.map((h) => `filter.location=POLYGON(NTA ${h.code})`),
        assumptions: ['Allowed tag types only: genre, cuisine, ambience, good for, time of day, drinks'],
        unresolved: [],
      },
      interpretation: 'Read local places in 4 neighborhoods; kept the 5 most distinctive tags in each.',
      result_count: HEROES.length,
      execution: { ...base, correlation_id: 'syn-evidence-0001', duration_ms: 4130 },
      provenance: {
        source: 'Synthetic Qloo transport',
        requests: HEROES.map((h, k) =>
          req(
            '/v2/insights',
            `filter.type=urn:entity:place&filter.location=POLYGON(NTA ${h.code})&signal.interests.entities=${ids.slice(0, 3).join(',')}&take=15&feature.explainability=true`,
            'evidence',
            930 + 85 * k,
          ),
        ),
      },
      what_this_supports: 'The local taste evidence behind every line of ad copy. Place names stay in the app, never in the ads.',
      warnings: [],
    },
  ];
}

// ---------------------------------------------------------------------------------------------
// Assembly
// ---------------------------------------------------------------------------------------------

let memo: RunState | null = null;

function build(): RunState {
  const { where, S } = buildWhere();
  const ntaByCode = new Map(where.ntas.map((n) => [n.code, n]));
  const evidence = buildEvidence(ntaByCode);
  const creative = buildCreative();
  const { plan, tw } = buildPlan(where, S);
  const proof = buildProof(where, ntaByCode, evidence, tw, S);

  const outcomes: ResolutionOutcome[] = ANCHORS.map((a) => ({
    input: a.input,
    type: a.type,
    status: 'resolved',
    match: a.match,
    selected: a.candidate,
    alternatives: a.alternatives,
    warnings: a.warnings,
  }));
  const planner: PlannerOutput = {
    business: { name: BRIEF.business, category: 'Jazz supper club', offer: BRIEF.offer },
    audienceSummary: 'People who go out for live jazz and a long dinner, and follow modern players as much as classic clubs.',
    anchors: ANCHORS.map((a) => ({ name: a.input, type: a.type, searchHint: a.searchHint, why: a.why })),
    tone: 'warm',
    llmOnlyNeighborhoods: LLM_PICKS.map((p) => ({ ntaCode: p.nta, reason: p.reason })),
    budgetUsd: BRIEF.budgetUsd,
    weeks: BRIEF.weeks,
    fallback: false,
  };
  const stages: StageInfo[] = STAGES.map(([stage, title, detail, ms]) => ({
    stage,
    status: 'done',
    title,
    detail: stage === 'optimize' ? `${plan.totals.screens} screens · $${plan.totals.spend.toLocaleString('en-US')}` : detail,
    ms,
  }));
  const top = where.ntas.slice(0, 3).map((n) => `${n.short} ${n.multiplier.toFixed(1)}×`).join(', ');
  const llmNames = LLM_PICKS.map((p) => ntaByCode.get(p.nta)?.short ?? p.nta).join(', ');

  return {
    id: 'demo-halfnote',
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
    status: 'done',
    mode: 'mock',
    presetSlug: 'halfnote',
    brief: BRIEF,
    planner,
    resolution: { outcomes, issues: [] },
    where,
    evidence,
    creative,
    plan,
    proof,
    stages,
    decisions: [
      {
        stage: 'plan',
        text: 'Anchors for this audience: Robert Glasper (artist), Esperanza Spalding (artist), Blue Note Jazz Club (place), Soul (movie).',
      },
      { stage: 'resolve', text: '“Blue Note Jazz Club” matched “Blue Note” by meaning; flagged for a check.' },
      { stage: 'resolve', text: 'Matched 4 of 4 anchors in Qloo.' },
      { stage: 'where', text: 'Half weight for “Soul”: its NYC map mostly follows overall density, not taste.' },
      {
        stage: 'where',
        text: `Scored ${where.ntas.length} neighborhoods from 4 anchor maps on ${where.grid.covered.toLocaleString('en-US')} of ${where.grid.cells.toLocaleString('en-US')} city cells.`,
      },
      { stage: 'where', text: `Strongest fit: ${top}.` },
      { stage: 'evidence', text: 'Kept the 5 most distinctive local tags per neighborhood: live jazz, listening bars, supper clubs, wine bars.' },
      { stage: 'creative', text: 'Checked every line; 1 variant(s) were rewritten from evidence by rules.' },
      {
        stage: 'optimize',
        text: `${plan.totals.screens} screens in ${plan.byNta.length} neighborhoods for $${plan.totals.spend.toLocaleString('en-US')}.`,
      },
      { stage: 'proof', text: `An AI with no taste data picked ${llmNames}; ${proof.overlapAt5} of 5 overlap with Stoop’s top 5.` },
      { stage: 'finalize', text: 'Plan ready. Nothing is booked or sent until you approve it.' },
    ],
    envelopes: buildEnvelopes(where),
    label: { kind: 'synthetic' },
    qlooCalls: { fresh: 12, cached: 1 },
    llm: { via: ['synthetic', 'synthetic'], attempts: 2 },
    error: null,
  };
}

/** The complete synthetic Halfnote run (deterministic; a fresh copy per call so callers may modify it). */
export function syntheticDemoRun(): RunState {
  memo ??= build();
  return structuredClone(memo);
}

/** A synthetic "which one did you mean?" question, for the picker's design state and tests. */
export function syntheticDemoQuestion(): ResolutionIssue[] {
  return [
    {
      input: 'Soul',
      type: 'movie',
      kind: 'ambiguous',
      question: 'Which “Soul” did you mean?',
      candidates: [
        { id: SYN_UUID(4), name: 'Soul', type: 'movie', disambiguation: 'Film · 2020 · animated, a jazz pianist', popularity: null, year: 2020 },
        { id: SYN_UUID(41), name: 'Soul Food', type: 'movie', disambiguation: 'Film · 1997 · family drama', popularity: null, year: 1997 },
        { id: SYN_UUID(42), name: 'Soul Men', type: 'movie', disambiguation: 'Film · 2008 · music comedy', popularity: null, year: 2008 },
      ],
    },
  ];
}
