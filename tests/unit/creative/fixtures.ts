import type { AdVariant, Brief, EvidencePack, NtaInfo } from '@/shared/types';
import { buildLexicon } from '@/server/creative/lexicon';
import type { CreativeContext } from '@/server/creative/validate';

/** Synthetic NTAs modelled on 2020 NTA naming (not read from src/data). */
function nta(code: string, name: string, short: string, boro: string, bbox: [number, number, number, number], residential = true): NtaInfo {
  return {
    code,
    name,
    short,
    boro,
    centroid: [(bbox[0] + bbox[2]) / 2, (bbox[1] + bbox[3]) / 2],
    bbox,
    wkt: 'POLYGON((0 0,1 0,1 1,0 0))',
    adKiosks: residential ? 10 : 0,
    residential,
  };
}

export const NTAS: NtaInfo[] = [
  nta('BK0301', 'Bedford-Stuyvesant (West)', 'Bed-Stuy', 'Brooklyn', [-73.95, 40.68, -73.92, 40.7]),
  nta('BK0302', 'Bedford-Stuyvesant (East)', 'Bed-Stuy', 'Brooklyn', [-73.92, 40.68, -73.9, 40.7]),
  nta('BK0102', 'Williamsburg', 'Williamsburg', 'Brooklyn', [-73.97, 40.7, -73.94, 40.73]),
  nta('BK0104', 'East Williamsburg', 'East Williamsburg', 'Brooklyn', [-73.94, 40.7, -73.91, 40.73]),
  nta('BK0502', 'East New York (North)', 'East New York', 'Brooklyn', [-73.9, 40.66, -73.87, 40.69]),
  nta('BK0601', 'Carroll Gardens-Cobble Hill-Gowanus-Red Hook', 'Carroll Gardens', 'Brooklyn', [-74.02, 40.67, -73.99, 40.69]),
  nta('BK0602', 'Park Slope', 'Park Slope', 'Brooklyn', [-73.99, 40.66, -73.975, 40.68]),
  nta('BK0702', 'Sunset Park (West)', 'Sunset Park', 'Brooklyn', [-74.02, 40.64, -74.0, 40.66]),
  nta('BK0771', 'Green-Wood Cemetery', 'Green', 'Brooklyn', [-74.0, 40.65, -73.99, 40.66], false),
  nta('BK1703', 'East Flatbush-Rugby', 'East Flatbush', 'Brooklyn', [-73.93, 40.64, -73.91, 40.66]),
  nta('BK5591', 'Prospect Park', 'Prospect Park', 'Brooklyn', [-73.98, 40.65, -73.96, 40.67], false),
  nta('MN0302', 'Lower East Side', 'Lower East Side', 'Manhattan', [-73.99, 40.71, -73.97, 40.72]),
  nta('MN0401', 'Chelsea-Hudson Yards', 'Chelsea', 'Manhattan', [-74.01, 40.74, -73.99, 40.76]),
  nta('MN0402', "Hell's Kitchen", "Hell's Kitchen", 'Manhattan', [-74.0, 40.76, -73.98, 40.77]),
  nta('MN0502', 'Midtown-Times Square', 'Midtown', 'Manhattan', [-73.99, 40.75, -73.97, 40.77]),
  nta('MN1001', 'Harlem (South)', 'Harlem', 'Manhattan', [-73.96, 40.8, -73.94, 40.81]),
  nta('MN1101', 'East Harlem (South)', 'East Harlem', 'Manhattan', [-73.95, 40.79, -73.93, 40.8]),
  nta('QN0102', 'Old Astoria-Hallets Point', 'Old Astoria', 'Queens', [-73.94, 40.77, -73.92, 40.78]),
  nta('QN0103', 'Astoria (Central)', 'Astoria', 'Queens', [-73.93, 40.76, -73.91, 40.77]),
  nta('QN0201', 'Long Island City-Hunters Point', 'Long Island City', 'Queens', [-73.96, 40.74, -73.94, 40.75]),
  nta('QN0706', 'Queensboro Hill', 'Queensboro Hill', 'Queens', [-73.83, 40.74, -73.81, 40.75]),
  nta('QN0707', 'Flushing-Willets Point', 'Flushing', 'Queens', [-73.84, 40.75, -73.82, 40.77]),
  nta('QN1201', 'Jamaica', 'Jamaica', 'Queens', [-73.81, 40.69, -73.79, 40.71]),
  nta('BX0101', 'Mott Haven-Port Morris', 'Mott Haven', 'Bronx', [-73.93, 40.8, -73.91, 40.82]),
  nta('SI0101', 'St. George-New Brighton', 'St. George', 'Staten Island', [-74.09, 40.63, -74.07, 40.65]),
];

export const LEXICON = buildLexicon(NTAS);

export function ntaInfo(code: string): NtaInfo {
  const found = NTAS.find((n) => n.code === code);
  if (!found) throw new Error(`fixture NTA ${code} missing`);
  return found;
}

/** Qloo tag types as emitted by the evidence builder. */
export const TAG = {
  category: 'urn:tag:category:place',
  cuisine: 'urn:tag:cuisine:qloo',
  beverage: 'urn:tag:beverage_offering:qloo',
  ambience: 'urn:tag:ambience:qloo',
  time: 'urn:tag:time_of_day_fit:qloo',
  goodFor: 'urn:tag:good_for:qloo',
} as const;

/** A label, or a label with its Qloo tag type (default: a place category). */
export type LabelSpec = string | readonly [label: string, tagType: string];

export const DEFAULT_LABELS: readonly LabelSpec[] = [
  ['Live Music', TAG.category],
  ['Soul Food', TAG.cuisine],
  ['Craft Cocktails', TAG.beverage],
  ['Late Night', TAG.time],
];

export function packFor(code: string, labels: readonly LabelSpec[] = DEFAULT_LABELS, places: readonly string[] = []): EvidencePack {
  return {
    nta: code,
    shortName: ntaInfo(code).short,
    items: labels.map((spec, k) => {
      const [label, tagType] = typeof spec === 'string' ? [spec, TAG.category] : spec;
      return {
        id: evId(code, label),
        kind: tagType === TAG.category ? ('category' as const) : ('tag' as const),
        label,
        tagType,
        weight: 1 - k / 10,
        support: 3,
      };
    }),
    places: places.map((name, k) => ({ id: `synthetic_place_${k}`, name, categories: ['bar'], explain: [] })),
  };
}

export function evId(code: string, label: string): string {
  return `ev:${code}:${label.toLowerCase().replace(/[^a-z0-9]+/g, '_')}`;
}

export interface CtxOptions {
  businessName?: string | null;
  offer?: string | null;
  description?: string;
  labels?: readonly LabelSpec[];
  places?: readonly string[];
  blockedNames?: readonly string[];
}

export function brief(opts: CtxOptions = {}): Brief {
  return {
    business: opts.businessName ?? 'Halfnote',
    description: opts.description ?? 'A jazz supper club with Tuesday jam nights and a soul-food menu.',
    offer: opts.offer === undefined ? 'Free entry before 9pm on Tuesdays' : opts.offer,
    budgetUsd: 2000,
    weeks: 3,
    startDate: '2026-11-16',
    address: null,
  };
}

export function ctxFor(code: string, opts: CtxOptions = {}): CreativeContext {
  return {
    pack: packFor(code, opts.labels, opts.places),
    nta: ntaInfo(code),
    brief: brief(opts),
    businessName: opts.businessName === undefined ? 'Halfnote' : opts.businessName,
    lexicon: LEXICON,
    blockedNames: opts.blockedNames,
  };
}

/** A variant for `code` that cites "Live Music" unless references are given. */
export function ad(code: string, copy: Partial<AdVariant> = {}): AdVariant {
  return {
    nta: code,
    variant: 'A',
    headline: 'Live music, Bed-Stuy style.',
    body: 'Halfnote opens on the block. Soul food Sundays, jam Tuesdays.',
    cta: 'Book a table',
    references: [{ evidenceId: evId(code, 'Live Music'), phrase: 'live music' }],
    rationale: 'Leads with the local live-music evidence.',
    ...copy,
  };
}
