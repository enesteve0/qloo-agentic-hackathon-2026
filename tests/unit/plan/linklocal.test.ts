import { describe, expect, it } from 'vitest';
import { DEFAULT_ASSUMPTIONS } from '@/server/plan/assumptions';
import { LINKLOCAL_MIN_SPACING_M, linkLocalPicks } from '@/server/plan/linklocal';
import type { Kiosk } from '@/shared/types';

let n = 0;
const kiosk = (nta: string, lat: number, lon: number): Kiosk => ({
  i: n++,
  siteId: `site-${String(n).padStart(3, '0')}`,
  lat,
  lon,
  type: 'LINK1.0',
  boro: nta.startsWith('MN') ? 'Manhattan' : 'Brooklyn',
  address: `${n} Test Av`,
  cross1: null,
  cross2: null,
  nta,
  gh6: 'dr5rs0',
  ntaReassigned: false,
});

describe('linkLocalPicks', () => {
  // Three neighborhoods; BK1 has a tight cluster on one block plus spread-out screens.
  const ks = [
    kiosk('BK1', 40.68, -73.95),
    kiosk('BK1', 40.6801, -73.9501), // ~14 m from the first: same block
    kiosk('BK1', 40.684, -73.95),
    kiosk('BK1', 40.688, -73.95),
    kiosk('BK2', 40.7, -73.92),
    kiosk('BK2', 40.704, -73.92),
    kiosk('MN1', 40.75, -73.99),
    kiosk('XX9', 40.6, -73.9), // not a top neighborhood
  ];
  const fit = [99, 98, 90, 80, 95, 70, 85, 100];
  const input = { kiosks: ks, kioskFit: fit, topNtas: ['BK1', 'BK2', 'MN1'], assumptions: DEFAULT_ASSUMPTIONS };

  it('picks six free screens round-robin across the top neighborhoods, best fit first', () => {
    const picks = linkLocalPicks(input);
    expect(picks).toHaveLength(6);
    expect(picks.slice(0, 3).map((p) => p.nta)).toEqual(['BK1', 'BK2', 'MN1']);
    expect(picks.every((p) => p.cost === 0)).toBe(true);
    expect(picks.some((p) => p.nta === 'XX9')).toBe(false);
    expect(picks[0]?.fit).toBe(99);
  });

  it('never puts two free screens on the same block', () => {
    const picks = linkLocalPicks(input);
    expect(picks.map((p) => p.i)).not.toContain(1);
    for (const a of picks) {
      for (const b of picks) {
        if (a === b) continue;
        const ka = ks[a.i]!;
        const kb = ks[b.i]!;
        const d = Math.hypot((kb.lon - ka.lon) * 111_320 * Math.cos((ka.lat * Math.PI) / 180), (kb.lat - ka.lat) * 110_540);
        expect(d).toBeGreaterThanOrEqual(LINKLOCAL_MIN_SPACING_M - 1);
      }
    }
  });

  it('is deterministic and returns fewer picks when there are not enough screens', () => {
    expect(linkLocalPicks(input)).toEqual(linkLocalPicks(input));
    expect(linkLocalPicks({ ...input, topNtas: ['MN1'] })).toHaveLength(1);
  });
});
