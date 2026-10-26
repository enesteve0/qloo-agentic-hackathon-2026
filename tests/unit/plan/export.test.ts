import { describe, expect, it } from 'vitest';
import { DEFAULT_ASSUMPTIONS } from '@/server/plan/assumptions';
import { bookingEmailDraft, CSV_COLUMNS, DRAFT_MARKER, PLAN_DISCLAIMER, planToCsv } from '@/server/plan/export';
import { buildMediaPlan } from '@/server/plan/optimizer';
import type { Brief, CreativeSet, CreativeVariant, Kiosk, MediaPlan } from '@/shared/types';

function kiosk(i: number, nta: string, boro: string, address: string, cross1: string | null, cross2: string | null): Kiosk {
  return { i, siteId: `site-${String(i).padStart(3, '0')}`, lat: 40.68, lon: -73.94, type: i % 2 ? 'LINK5G_AD' : 'LINK1.0', boro, address, cross1, cross2, nta, gh6: 'dr5rs0', ntaReassigned: false };
}

const KIOSKS: Kiosk[] = [
  kiosk(0, 'BK0301', 'Brooklyn', '1200 FULTON STREET', 'Nostrand Avenue', 'Bedford Avenue'),
  kiosk(1, 'BK0301', 'Brooklyn', '12 MAIN ST, "REAR"', 'Halsey St', null),
  kiosk(2, 'BK0301', 'Brooklyn', '-5 CORNER LOT', null, null),
  kiosk(3, 'MN0302', 'Manhattan', '100 DELANCEY STREET', 'Essex Street', 'Ludlow Street'),
];
const FIT = [92.4, 88, 75.6, 81];
const NTA_NAMES = { BK0301: 'Bedford-Stuyvesant (West)', MN0302: 'Lower East Side' };

const BRIEF: Brief = {
  business: 'Halfnote',
  description: 'Jazz supper club',
  offer: 'Free first set on Tuesdays',
  budgetUsd: 2_000,
  weeks: 3,
  startDate: '2026-11-16',
  address: '1200 Fulton St',
};

function planFor(budgetUsd = 2_000, weeks = 3, kiosks = KIOSKS, fit = FIT): MediaPlan {
  return buildMediaPlan({ kiosks, kioskFit: fit, topNtas: ['BK0301', 'MN0302'], budgetUsd, weeks, assumptions: DEFAULT_ASSUMPTIONS });
}

function variant(nta: string, v: 'A' | 'B', headline: string): CreativeVariant {
  return {
    nta,
    variant: v,
    headline,
    body: 'Halfnote. Come by.',
    cta: 'Come by',
    references: [{ evidenceId: `ev:${nta}:live_music`, phrase: 'live music' }],
    rationale: '',
    grounding: { ok: true, failed: [], replacedByTemplate: false },
    source: 'model',
  };
}

const CREATIVE: CreativeSet[] = [
  // B listed first on purpose: the CSV still starts each neighborhood with A.
  { nta: 'BK0301', via: 'groq', variants: [variant('BK0301', 'B', '=HYPERLINK("http://x")'), variant('BK0301', 'A', 'Live music, Bed-Stuy style.')] },
];

describe('planToCsv', () => {
  const csv = planToCsv(planFor(), KIOSKS, NTA_NAMES, CREATIVE);
  const lines = csv.split('\r\n');

  it('starts with the disclaimer and every assumption, then the column header', () => {
    expect(lines.slice(0, 11)).toEqual([
      `Stoop media plan,"${PLAN_DISCLAIMER}"`,
      '"ASSUMPTION: price per screen-week, Manhattan (USD)",120',
      '"ASSUMPTION: price per screen-week, other boroughs (USD)",40',
      '"ASSUMPTION: impressions per screen-week, Manhattan",10000',
      '"ASSUMPTION: impressions per screen-week, other boroughs",3500',
      'Budget (USD),2000',
      'Weeks,3',
      'Screens,4',
      '"Est. spend (USD, ASSUMPTION)",720',
      'Leftover (USD),1280',
      '',
    ]);
    expect(lines[11]).toBe(CSV_COLUMNS.join(','));
    expect(lines[11]).toBe(
      'siteId,address,cross streets,borough,neighborhood (2020 NTA name),kiosk type,weeks,est. weekly impressions (ASSUMPTION),est. cost (ASSUMPTION),fit index,ad variant',
    );
  });

  it('writes one RFC 4180 row per screen and alternates the ad variants within a neighborhood', () => {
    expect(lines.slice(12)).toEqual([
      'site-000,1200 FULTON STREET,Nostrand Avenue & Bedford Avenue,Brooklyn,Bedford-Stuyvesant (West),LINK1.0,3,3500,120,92,"A: Live music, Bed-Stuy style."',
      `site-001,"12 MAIN ST, ""REAR""",Halsey St,Brooklyn,Bedford-Stuyvesant (West),LINK5G_AD,3,3500,120,88,"B: =HYPERLINK(""http://x"")"`,
      "site-002,'-5 CORNER LOT,,Brooklyn,Bedford-Stuyvesant (West),LINK1.0,3,3500,120,76,\"A: Live music, Bed-Stuy style.\"",
      'site-003,100 DELANCEY STREET,Essex Street & Ludlow Street,Manhattan,Lower East Side,LINK5G_AD,3,10000,360,81,',
      '',
    ]);
    expect(csv.endsWith('\r\n')).toBe(true);
    expect(csv.replace(/\r\n/g, '')).not.toMatch(/[\r\n]/);
  });

  it('neutralizes text that a spreadsheet would run as a formula', () => {
    const plan = planFor();
    const evil: CreativeSet[] = [{ nta: 'BK0301', via: 'groq', variants: [variant('BK0301', 'A', 'x')] }];
    const kiosks = KIOSKS.map((k) => (k.i === 0 ? { ...k, address: '=1+1', cross1: '@SUM(A1)', cross2: null } : k));
    const row = planToCsv(plan, kiosks, NTA_NAMES, evil).split('\r\n').find((l) => l.startsWith('site-000'));
    expect(row).toBe("site-000,'=1+1,'@SUM(A1),Brooklyn,Bedford-Stuyvesant (West),LINK1.0,3,3500,120,92,A: x");
  });

  it('carries the infeasible reason and no rows when nothing can be bought', () => {
    const empty = planToCsv(planFor(30, 1), KIOSKS, NTA_NAMES);
    const emptyLines = empty.split('\r\n');
    expect(emptyLines).toContain('Note,Minimum $40 for one screen-week');
    expect(emptyLines[emptyLines.length - 2]).toBe(CSV_COLUMNS.join(','));
  });

  it('contains derived data only', () => {
    expect(csv).not.toMatch(/urn:|ev:|affinity|lift/i);
  });
});

describe('bookingEmailDraft', () => {
  it('drafts a polite request listing screens, dates and budget', () => {
    const draft = bookingEmailDraft(planFor(), BRIEF, KIOSKS, NTA_NAMES);
    expect(draft.subject).toBe('Screen booking request: Halfnote, Nov 16 – Dec 6, 2026');
    const body = draft.body.split('\n');
    expect(body[0]).toBe(DRAFT_MARKER);
    expect(DRAFT_MARKER).toBe('Draft — review before sending');
    expect(body).toContain('I would like to book advertising on 4 street screens in New York City for Halfnote.');
    expect(body).toContain('Dates: Nov 16 – Dec 6, 2026 (3 weeks)');
    expect(body).toContain('Budget: up to $2,000 in total');
    expect(body).toContain('1. site-000: 1200 FULTON STREET (Nostrand Avenue & Bedford Avenue), Bedford-Stuyvesant (West), Brooklyn');
    expect(body).toContain('4. site-003: 100 DELANCEY STREET (Essex Street & Ludlow Street), Lower East Side, Manhattan');
    expect(body[body.length - 1]).toBe('Halfnote');
  });

  it('contains no Qloo data, scores or prices we assumed', () => {
    const { subject, body } = bookingEmailDraft(planFor(), BRIEF, KIOSKS, NTA_NAMES);
    const text = `${subject}\n${body}`;
    expect(text).not.toMatch(/qloo|taste|fit|lift|evidence|score|impression|assumption/i);
    for (const f of FIT) expect(text).not.toContain(String(f));
  });

  it('builds a mailto link that decodes back to the draft', () => {
    const draft = bookingEmailDraft(planFor(), BRIEF, KIOSKS, NTA_NAMES);
    expect(draft.mailto.startsWith('mailto:?subject=')).toBe(true);
    const url = new URL(draft.mailto);
    expect(url.searchParams.get('subject')).toBe(draft.subject);
    expect(url.searchParams.get('body')).toBe(draft.body.replace(/\n/g, '\r\n'));
  });

  it('shortens the screen list in the link when it would be too long', () => {
    const many = Array.from({ length: 40 }, (_, i) => kiosk(i, 'BK0301', 'Brooklyn', `${100 + i} NOSTRAND AVENUE`, 'Fulton Street', 'Herkimer Street'));
    const plan = planFor(10_000, 1, many, many.map(() => 90));
    const draft = bookingEmailDraft(plan, BRIEF, many, NTA_NAMES);
    expect(draft.body.split('\n').filter((l) => /^\d+\. site-/.test(l))).toHaveLength(plan.screens.length);
    expect(draft.mailto.length).toBeLessThanOrEqual(1_900);
    const shortBody = new URL(draft.mailto).searchParams.get('body') ?? '';
    expect(shortBody).toMatch(/\.\.\.and \d+ more screens \(full list in the attached CSV\)\./);
  });

  it('handles flexible, year-crossing and invalid dates and an empty plan', () => {
    expect(bookingEmailDraft(planFor(), { ...BRIEF, startDate: null }, KIOSKS, NTA_NAMES).body).toContain('Dates: 3 weeks, flexible start date');
    const crossing = bookingEmailDraft(planFor(2_000, 2), { ...BRIEF, startDate: '2026-12-28' }, KIOSKS, NTA_NAMES);
    expect(crossing.subject).toBe('Screen booking request: Halfnote, Dec 28, 2026 – Jan 10, 2027');
    expect(bookingEmailDraft(planFor(), { ...BRIEF, startDate: '2026-02-30' }, KIOSKS, NTA_NAMES).subject).toBe('Screen booking request: Halfnote');
    const none = bookingEmailDraft(planFor(30, 1), BRIEF, KIOSKS, NTA_NAMES).body;
    expect(none).toContain('Screens: none selected yet.');
    expect(none).toContain('Dates: Nov 16 – Nov 22, 2026 (1 week)');
  });
});
