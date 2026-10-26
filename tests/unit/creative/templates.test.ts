import { describe, expect, it } from 'vitest';
import type { Tone } from '@/shared/types';
import { templateVariant, templateVariants } from '@/server/creative/templates';
import { normalizeText } from '@/server/creative/text';
import { validateVariant } from '@/server/creative/validate';
import { ctxFor, evId, TAG, type LabelSpec } from './fixtures';

const TONES: Tone[] = ['playful', 'warm', 'bold', 'premium', 'community'];
const BK = 'BK0301';

describe('templateVariant', () => {
  it.each(TONES)('writes passing, evidence-grounded A and B variants (%s)', (tone) => {
    const ctx = ctxFor(BK);
    const [a, b] = templateVariants(ctx, tone);
    for (const v of [a, b]) {
      expect(validateVariant(v, ctx)).toEqual({ ok: true, failed: [], replacedByTemplate: false });
      expect(v.nta).toBe(BK);
    }
    expect([a.variant, b.variant]).toEqual(['A', 'B']);
    // "Soul Food" matches the brief ("soul-food menu"), so A may say the business offers it.
    expect(a.headline).toBe('Soul food, the Bed-Stuy way.');
    expect(a.references).toEqual([{ evidenceId: evId(BK, 'Soul Food'), phrase: 'soul food' }]);
    // B leads with the offer and cites the next-best evidence (a time-of-day tag, in the plural).
    expect(b.headline).toBe('Free entry before 9pm on Tuesdays');
    expect(b.body).toBe('Late nights in Bed-Stuy, meet Halfnote.');
    expect(b.references).toEqual([{ evidenceId: evId(BK, 'Late Night'), phrase: 'late nights' }]);
    expect(a.rationale).toContain('local taste hook');
    expect(b.rationale).toContain('offer hook');
  });

  it('varies the business line and call to action by tone', () => {
    const ctx = ctxFor(BK);
    const as = TONES.map((tone) => templateVariant('A', ctx, tone));
    expect(new Set(as.map((v) => v.body)).size).toBe(TONES.length);
    expect(new Set(as.map((v) => v.cta)).size).toBe(TONES.length);
    expect(as[1]).toMatchObject({ body: "Halfnote can't wait to meet you.", cta: 'See you soon' });
  });

  it.each<[string, LabelSpec, string, string]>([
    ['a mood', ['Cozy', TAG.ambience], 'Cozy is very Bed-Stuy.', 'Halfnote. Cozy, the Bed-Stuy way.'],
    ['a time of day', ['Evening', TAG.time], 'Made for Bed-Stuy evenings.', 'Evenings in Bed-Stuy, meet Halfnote.'],
    ['an occasion', ['Date Night', TAG.goodFor], 'Date night in Bed-Stuy?', 'Halfnote, made for date night.'],
    ['an offering the brief does not mention', ['Record Store', TAG.category], 'Bed-Stuy: record store territory.', "Halfnote, for Bed-Stuy's record store lovers."],
    ['a proper adjective', ['Greek', TAG.cuisine], 'Bed-Stuy: Greek territory.', "Halfnote, for Bed-Stuy's Greek lovers."],
  ])('phrases %s without claiming the business offers it', (_kind, label, headlineA, bodyB) => {
    const ctx = ctxFor(BK, { labels: [label] });
    const [a, b] = templateVariants(ctx, 'warm');
    expect(a.headline).toBe(headlineA);
    expect(b.body).toBe(bodyB);
    expect(validateVariant(a, ctx).ok && validateVariant(b, ctx).ok).toBe(true);
  });

  it('never claims the business is in the neighborhood', () => {
    for (const tone of TONES) {
      for (const v of templateVariants(ctxFor('QN0103'), tone)) {
        expect(`${v.headline} ${v.body} ${v.cta}`).not.toMatch(/right here|on the block|around the corner|in your neighborhood/i);
      }
    }
  });

  it('is deterministic', () => {
    expect(templateVariants(ctxFor('QN0103'), 'bold')).toEqual(templateVariants(ctxFor('QN0103'), 'bold'));
  });

  it('leads B with the business when there is no offer', () => {
    const ctx = ctxFor(BK, { offer: null });
    const b = templateVariant('B', ctx, 'warm');
    expect(validateVariant(b, ctx).ok).toBe(true);
    expect(b).toMatchObject({ headline: 'Meet Halfnote.', body: 'Late nights in Bed-Stuy.', cta: 'See you soon' });
    expect(b.rationale).toContain('business hook');
  });

  it('writes without a business name', () => {
    const ctx = ctxFor(BK, { businessName: null, offer: null });
    const [a, b] = templateVariants(ctx, 'community');
    expect(validateVariant(a, ctx).ok && validateVariant(b, ctx).ok).toBe(true);
    expect(b.headline).toBe("Bed-Stuy, this one's for you.");
  });

  it('trims long labels at a word boundary and keeps the cited phrase in the copy', () => {
    const ctx = ctxFor(BK, { labels: ['Late-Night Dining Spots For Big Groups'] });
    const a = templateVariant('A', ctx, 'playful');
    expect(validateVariant(a, ctx).ok).toBe(true);
    const phrase = a.references[0]?.phrase ?? '';
    expect(phrase).toBe('late-night dining spots');
    expect(normalizeText(`${a.headline} ${a.body}`)).toContain(normalizeText(phrase));
  });

  it('cites a clean part of a label when the full label breaks a rule', () => {
    const ctx = ctxFor(BK, { labels: ['LGBTQ+ Friendly Bar'] });
    const a = templateVariant('A', ctx, 'warm');
    expect(validateVariant(a, ctx).ok).toBe(true);
    expect(a.references[0]?.phrase).toBe('friendly bar');
  });

  it('still passes when no label can be used at all', () => {
    const ctx = ctxFor(BK, { labels: ['Seniors', 'Harlem'] });
    for (const v of templateVariants(ctx, 'community')) {
      expect(validateVariant(v, ctx).ok).toBe(true);
      expect(v.headline).toBe('Hello, neighbor.');
      expect(v.references[0]?.evidenceId).toBe(evId(BK, 'Seniors'));
    }
  });

  it('returns (failing) copy instead of throwing when the pack is empty', () => {
    const ctx = ctxFor(BK, { labels: [] });
    const a = templateVariant('A', ctx);
    expect(a.references).toEqual([]);
    expect(validateVariant(a, ctx).failed.map((f) => f.rule)).toEqual(['refs']);
  });

  describe('passes the validator across awkward inputs', () => {
    const businesses = [null, 'Halfnote', 'Lot 45', 'Smoke & Sons', 'Astoria Bagel Co.', 'Queensboro Animation House', 'The Very Long Name Neighborhood Supper Club & Bar'];
    const offers = [null, '2-for-1 drinks Tuesdays', 'Free entry before 9pm on Tuesdays with this ad only', 'Seniors eat free', 'Free delivery to Harlem', '🎷 Free set 🎷'];
    const labelSets: LabelSpec[][] = [
      [['Live Music', TAG.category]],
      [['Late-Night Dining Spots For Big Groups', TAG.goodFor], ['Cozy', TAG.ambience]],
      [['Harlem Renaissance', TAG.category], ['Craft Cocktails', TAG.beverage]],
      [['24 Hour Diner', TAG.category]],
      [['Cozy 🎷', TAG.ambience]],
      [['LGBTQ+ Friendly Bar', TAG.goodFor]],
      [['Late Night', TAG.time], ['Date Night', TAG.goodFor]],
      [['Tex-Mex', TAG.cuisine], ['BBQ', TAG.cuisine]],
    ];
    const codes = ['BK0301', 'MN0402', 'QN0103', 'SI0101'];
    const cases = codes.flatMap((code) =>
      businesses.flatMap((businessName) => offers.flatMap((offer) => labelSets.map((labels) => ({ code, businessName, offer, labels })))),
    );

    it(`covers ${cases.length} combinations for every tone`, () => {
      const failures: string[] = [];
      for (const { code, businessName, offer, labels } of cases) {
        const ctx = ctxFor(code, { businessName, offer, labels });
        for (const tone of TONES) {
          for (const v of templateVariants(ctx, tone)) {
            const result = validateVariant(v, ctx);
            if (!result.ok) failures.push(`${code} ${tone} ${v.variant} ${JSON.stringify({ businessName, offer, labels })}: ${JSON.stringify(result.failed)}`);
          }
        }
      }
      expect(failures).toEqual([]);
    });
  });
});
