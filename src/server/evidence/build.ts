import 'server-only';
import type { EvidenceItem, EvidencePack, EvidencePlace } from '@/shared/types';

/** A local place as normalized from Qloo `filter.type=urn:entity:place` (ranked by affinity). */
export interface EvidenceSourcePlace {
  id: string;
  name: string;
  tags: { id: string; name: string; type: string }[];
  explain: { anchorId: string; score: number }[];
}

/**
 * Tag types that describe what a place offers or how it feels. Identity, age, accessibility, payment and
 * parking tags are excluded on purpose: they are either sensitive or useless for street-level creative.
 */
const ALLOWED_TAG_TYPES = [
  'urn:tag:ambience:qloo',
  'urn:tag:category:place',
  'urn:tag:genre:place',
  'urn:tag:cuisine:qloo',
  'urn:tag:neighborhood_characteristic:qloo',
  'urn:tag:good_for:qloo',
  'urn:tag:visit_intent:qloo',
  'urn:tag:time_of_day_fit:qloo',
  'urn:tag:decor:qloo',
  'urn:tag:setting:qloo',
  'urn:tag:menu_highlight:qloo',
  'urn:tag:beverage_offering:qloo',
];
const CATEGORY_TYPES = new Set(['urn:tag:category:place', 'urn:tag:genre:place']);
// Generic labels that carry no taste information for an ad.
const NOISE_LABELS = new Set(['restaurant', 'bar', 'cafe', 'store', 'shop', 'point of interest', 'establishment', 'food']);

const allowed = (type: string) => ALLOWED_TAG_TYPES.some((t) => type === t || type.startsWith(`${t}:`));

interface TagStat {
  id: string;
  label: string;
  type: string;
  weight: number;
  support: number;
}

function tagStats(places: EvidenceSourcePlace[]): Map<string, TagStat> {
  const stats = new Map<string, TagStat>();
  places.forEach((place, rank) => {
    const w = 1 / (1 + rank);
    const seen = new Set<string>();
    for (const tag of place.tags) {
      if (!allowed(tag.type) || seen.has(tag.id)) continue;
      if (NOISE_LABELS.has(tag.name.trim().toLowerCase())) continue;
      seen.add(tag.id);
      const s = stats.get(tag.id) ?? { id: tag.id, label: tag.name.trim(), type: tag.type, weight: 0, support: 0 };
      s.weight += w;
      s.support += 1;
      stats.set(tag.id, s);
    }
  });
  return stats;
}

const shares = (stats: Map<string, TagStat>) => {
  const total = [...stats.values()].reduce((a, s) => a + s.weight, 0) || 1;
  return new Map([...stats.entries()].map(([id, s]) => [id, s.weight / total]));
};

/**
 * Builds one evidence pack per neighborhood from its local Qloo places. Tags are scored by how much this
 * neighborhood's taste over-uses them compared with the other selected neighborhoods, so the creative
 * gets what is distinctive here rather than what is common everywhere.
 */
export function buildEvidencePacks(
  input: { nta: string; shortName: string; places: EvidenceSourcePlace[] }[],
  opts: { maxItems?: number; minSupport?: number; maxPlaces?: number } = {},
): EvidencePack[] {
  const maxItems = opts.maxItems ?? 5;
  const minSupport = opts.minSupport ?? 2;
  const maxPlaces = opts.maxPlaces ?? 5;
  const perNta = input.map((n) => ({ ...n, stats: tagStats(n.places) }));
  const shareMaps = perNta.map((n) => shares(n.stats));

  return perNta.map((n, idx) => {
    const own = shareMaps[idx]!;
    const scored = [...n.stats.values()].map((s) => {
      const others = shareMaps.filter((_, j) => j !== idx).map((m) => m.get(s.id) ?? 0);
      const meanOther = others.length ? others.reduce((a, b) => a + b, 0) / others.length : 0;
      const share = own.get(s.id) ?? 0;
      const contrast = share / (meanOther + 0.02);
      return { s, score: share * Math.log1p(contrast) };
    });
    const pick = (support: number) =>
      scored
        .filter((x) => x.s.support >= support)
        .sort((a, b) => b.score - a.score || b.s.support - a.s.support || a.s.label.localeCompare(b.s.label))
        .slice(0, maxItems);
    // Thin neighborhoods may not have tags shared by two places; fall back to single-place support.
    let chosen = pick(minSupport);
    if (chosen.length < 3) chosen = pick(1);

    const items: EvidenceItem[] = chosen.map(({ s, score }) => ({
      id: `ev:${n.nta}:${s.id}`,
      kind: CATEGORY_TYPES.has(s.type) || s.type.startsWith('urn:tag:genre:place') ? 'category' : 'tag',
      label: s.label,
      tagType: s.type,
      weight: Math.round(score * 1000) / 1000,
      support: s.support,
    }));
    const places: EvidencePlace[] = n.places.slice(0, maxPlaces).map((p) => ({
      id: p.id,
      name: p.name,
      categories: p.tags.filter((t) => CATEGORY_TYPES.has(t.type)).map((t) => t.name).slice(0, 3),
      explain: p.explain,
    }));
    return { nta: n.nta, shortName: n.shortName, items, places };
  });
}
