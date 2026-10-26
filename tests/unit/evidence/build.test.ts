import { describe, expect, it } from 'vitest';
import { buildEvidencePacks, type EvidenceSourcePlace } from '@/server/evidence/build';

const tag = (name: string, type = 'urn:tag:ambience:qloo') => ({ id: `${type}:${name.toLowerCase().replace(/\W+/g, '_')}`, name, type });
const place = (id: string, tags: ReturnType<typeof tag>[]): EvidenceSourcePlace => ({ id, name: `Place ${id}`, tags, explain: [] });

describe('buildEvidencePacks', () => {
  const jazz = tag('Live jazz');
  const cozy = tag('Cozy');
  const late = tag('Late night', 'urn:tag:time_of_day_fit:qloo');
  const soul = tag('Soul food', 'urn:tag:cuisine:qloo');
  const brunch = tag('Brunch', 'urn:tag:time_of_day_fit:qloo');
  const ident = tag('Women-owned', 'urn:tag:customer_identity:qloo');
  const bar = tag('Bar', 'urn:tag:genre:place');

  const packs = buildEvidencePacks([
    {
      nta: 'BK0302',
      shortName: 'Bed-Stuy',
      places: [
        place('a', [jazz, soul, cozy, ident, bar]),
        place('b', [jazz, late, soul]),
        place('c', [cozy, late, brunch]),
        place('d', [jazz, brunch]),
      ],
    },
    {
      nta: 'MN0201',
      shortName: 'Greenwich Village',
      places: [place('e', [brunch, cozy]), place('f', [brunch, cozy]), place('g', [brunch])],
    },
  ]);

  it('keeps allowed, informative tags and drops sensitive or generic ones', () => {
    const labels = packs[0]!.items.map((i) => i.label);
    expect(labels).toContain('Live jazz');
    expect(labels).toContain('Soul food');
    expect(labels).not.toContain('Women-owned');
    expect(labels).not.toContain('Bar');
  });

  it('ranks distinctive tags above tags common to other neighborhoods', () => {
    const items = packs[0]!.items;
    const idx = (l: string) => items.findIndex((i) => i.label === l);
    expect(idx('Live jazz')).toBeLessThan(idx('Brunch') === -1 ? Infinity : idx('Brunch'));
    expect(items.every((i) => i.id.startsWith('ev:BK0302:'))).toBe(true);
  });

  it('falls back to single-place support for thin neighborhoods and is deterministic', () => {
    const thin = buildEvidencePacks([{ nta: 'X', shortName: 'X', places: [place('p', [jazz, cozy, late])] }]);
    expect(thin[0]!.items.length).toBe(3);
    expect(buildEvidencePacks([{ nta: 'X', shortName: 'X', places: [place('p', [jazz, cozy, late])] }])).toEqual(thin);
  });
});
