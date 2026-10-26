import type { Brief, EntityType } from '@/shared/types';

/**
 * Demo presets: fictional businesses with real taste anchors (confirmed against Qloo search when the key
 * is live). Only the briefs live in the repository; recorded runs are stored privately (see docs).
 */
export interface Preset {
  slug: string;
  buyer: string;
  title: string;
  brief: Brief;
  /** Anchor hints for the recorded run; the live agent proposes its own. */
  anchors: { name: string; type: EntityType; searchHint: string | null }[];
}

export const PRESETS: Preset[] = [
  {
    slug: 'halfnote',
    buyer: 'Small business',
    title: 'Jazz supper club opening in Bed-Stuy',
    brief: {
      business: 'Halfnote Supper Club',
      description:
        'A 48-seat jazz supper club opening on Nostrand Avenue in Bed-Stuy, with Tuesday jam nights and a soul-food menu.',
      offer: 'Free first set on Tuesdays',
      budgetUsd: 2000,
      weeks: 3,
      startDate: '2026-11-16',
      address: 'Nostrand Av & Fulton St, Brooklyn',
    },
    anchors: [
      { name: 'Robert Glasper', type: 'artist', searchHint: null },
      { name: 'Esperanza Spalding', type: 'artist', searchHint: null },
      { name: 'Blue Note Jazz Club', type: 'place', searchHint: 'New York' },
      { name: 'Soul', type: 'movie', searchHint: '2020' },
    ],
  },
  {
    slug: 'three-nights',
    buyer: 'Comedy promoter',
    title: 'A comic’s three-night Manhattan run',
    brief: {
      business: 'Dee Marcus Live',
      description:
        'A fictional stand-up comic’s three-night run at a 300-seat Manhattan club; 900 seats to sell in two weeks.',
      offer: 'Two-for-one on Thursday',
      budgetUsd: 3000,
      weeks: 2,
      startDate: '2026-11-09',
      address: null,
    },
    anchors: [
      { name: 'The Original Kings of Comedy', type: 'movie', searchHint: '2000' },
      { name: 'Barbershop', type: 'movie', searchHint: '2002' },
      { name: 'Def Comedy Jam', type: 'tv_show', searchHint: null },
      { name: 'The Neighborhood', type: 'tv_show', searchHint: '2018' },
    ],
  },
  {
    slug: 'smoke-and-sons',
    buyer: 'Food pop-up',
    title: 'St. Louis-style BBQ pop-up in Gowanus',
    brief: {
      business: 'Smoke & Sons',
      description: 'A St. Louis-style barbecue pop-up in Gowanus for two weekends: ribs, burnt ends and sides.',
      offer: 'Free side with any plate',
      budgetUsd: 1200,
      weeks: 2,
      startDate: '2026-11-13',
      address: null,
    },
    anchors: [
      { name: 'Hometown Bar-B-Que', type: 'place', searchHint: 'Brooklyn' },
      { name: 'Nelly', type: 'artist', searchHint: null },
      { name: 'Ugly Delicious', type: 'tv_show', searchHint: null },
    ],
  },
  {
    slug: 'puente',
    buyer: 'Promoter',
    title: 'Alt-Latin pop show presale push',
    brief: {
      business: 'Puente Presents',
      description: 'A fictional promoter selling an 1,800-capacity Brooklyn show for an alt-Latin pop band; 10-day presale.',
      offer: 'Presale code PUENTE',
      budgetUsd: 5000,
      weeks: 2,
      startDate: '2026-11-12',
      address: null,
    },
    anchors: [
      { name: 'The Marías', type: 'artist', searchHint: null },
      { name: 'Cuco', type: 'artist', searchHint: null },
      { name: 'Rosalía', type: 'artist', searchHint: null },
    ],
  },
  {
    slug: 'hand-drawn',
    buyer: 'Museum',
    title: 'Animation exhibition in Astoria',
    brief: {
      business: 'Queensboro Animation House',
      description: 'A fictional Astoria museum opening "Hand-Drawn", a six-week exhibition of hand-drawn animation.',
      offer: 'Free entry on opening weekend',
      budgetUsd: 4000,
      weeks: 4,
      startDate: '2026-11-15',
      address: null,
    },
    anchors: [
      { name: 'Spirited Away', type: 'movie', searchHint: '2001' },
      { name: 'Hayao Miyazaki', type: 'person', searchHint: null },
      { name: 'Adventure Time', type: 'tv_show', searchHint: null },
    ],
  },
  {
    slug: 'drop-day',
    buyer: 'Agency',
    title: 'Streetwear collab drop on the Lower East Side',
    brief: {
      business: 'Corner Office',
      description: 'A fictional agency launching a 7-day sneaker collab drop for a Lower East Side streetwear shop.',
      offer: 'Raffle entry in store',
      budgetUsd: 7500,
      weeks: 1,
      startDate: '2026-11-20',
      address: null,
    },
    anchors: [
      { name: 'Kith', type: 'brand', searchHint: null },
      { name: 'Aimé Leon Dore', type: 'brand', searchHint: null },
      { name: 'A$AP Rocky', type: 'artist', searchHint: null },
    ],
  },
];

export const presetBySlug = (slug: string) => PRESETS.find((p) => p.slug === slug);
