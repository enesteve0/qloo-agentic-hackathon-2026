import { describe, expect, it } from 'vitest';
import type { CopyRule } from '@/shared/types';
import { validateVariant } from '@/server/creative/validate';
import { ad, ctxFor, evId } from './fixtures';

const BK = 'BK0301';
const rules = (failed: { rule: CopyRule }[]) => failed.map((f) => f.rule);

describe('validateVariant: passing copy', () => {
  const passing: [string, Parameters<typeof ad>[1], Parameters<typeof ctxFor>[1]?][] = [
    ['grounded hero copy', {}],
    [
      'Title Case built from common words',
      { headline: 'Live Music Every Tuesday Night', body: 'Halfnote: Soul Food And Craft Cocktails In Bed-Stuy.', cta: 'Book A Table' },
    ],
    [
      'inflected Title Case words',
      { headline: 'The Coolest Live Music Spot', body: 'Halfnote: Jamming Nightly, Freshest Cocktails.', cta: 'Get Tickets' },
    ],
    [
      'Soul food Sundays (no sensitive or name false positive)',
      { headline: 'Soul food Sundays', body: 'Halfnote serves soul food and live music.', references: [{ evidenceId: evId(BK, 'Soul Food'), phrase: 'soul food' }] },
    ],
    ['Live jazz Tuesday', { headline: 'Live jazz Tuesday', body: 'Halfnote brings live music to Bed-Stuy.' }],
    ['phrase matched without case or punctuation', { references: [{ evidenceId: evId(BK, 'Live Music'), phrase: 'LIVE-MUSIC' }] }],
    ['own NTA long name, own borough and the city', { body: "Bedford-Stuyvesant's jazz room: Halfnote, Brooklyn, NYC." }],
    ['business name with digits', { headline: 'Lot 45: live music', body: 'Lot 45 brings live music to Bed-Stuy.' }, { businessName: 'Lot 45', offer: null }],
    ['digits from the offer', { headline: 'Free entry before 9pm', body: 'Halfnote: live music, Tuesdays.' }],
    ['thousands separators match', { headline: 'Win $2,000 of live music', body: 'Halfnote, Bed-Stuy.' }, { offer: 'Win $2000 in tabs' }],
    ['drag queens are not a borough', { body: 'Halfnote: live music and drag queens on Sundays.' }],
    ['a Manhattan cocktail is not a borough', { body: 'Halfnote: live music and a smoked Manhattan.' }],
    ['business name naming another neighborhood', { body: 'Astoria Bagel Co. brings live music to Bed-Stuy.' }, { businessName: 'Astoria Bagel Co.' }],
    ['street named after another neighborhood, mentioned in the brief', { body: 'Halfnote, just off Flushing Ave.' }, { description: 'Jazz club on Flushing Ave.' }],
    ['possessive business name', { body: "Halfnote's new room for live music." }],
    ['distinctive word of a longer business name', { body: 'Halfnote opens on the block.' }, { businessName: 'Halfnote Supper Club' }],
    ['ampersand business name written with "and"', { body: 'Smoke and Sons: live music, Bed-Stuy.' }, { businessName: 'Smoke & Sons' }],
    ['no business name required when none is given', { body: 'A new supper club on the block.' }, { businessName: null }],
    ['a one-word anchor that is a common word does not block it', { body: 'Halfnote: soul food, live music.' }, { blockedNames: ['Soul'] }],
    ['capitalized words the brief uses are allowed', { body: 'Halfnote, steps from Nostrand.' }, { description: 'Jazz club on Nostrand Ave.' }],
    ['digits from the owner\'s description', { body: 'Halfnote: live music from 7pm.' }, { description: 'A jazz supper club open from 7pm with Tuesday jam nights.' }],
    ['an anchor word at a sentence start that the brief also uses', { cta: 'Climb in free' }, { blockedNames: ['The Climb'], offer: 'First climb free' }],
  ];
  it.each(passing)('%s', (_name, copy, opts) => {
    const result = validateVariant(ad(BK, copy), ctxFor(BK, opts));
    expect(result.failed).toEqual([]);
    expect(result).toEqual({ ok: true, failed: [], replacedByTemplate: false });
  });

  it('allows a smaller part of its own NTA name and a bordering park', () => {
    const ew = ctxFor('BK0104');
    expect(validateVariant(ad('BK0104', { headline: 'Live music, Williamsburg.', references: [{ evidenceId: evId('BK0104', 'Live Music'), phrase: 'live music' }] }), ew).ok).toBe(true);
    const slope = ctxFor('BK0602');
    const v = ad('BK0602', { headline: 'Live music by Prospect Park', body: 'Halfnote, Park Slope.', references: [{ evidenceId: evId('BK0602', 'Live Music'), phrase: 'live music' }] });
    expect(validateVariant(v, slope).failed).toEqual([]);
  });

  it.each(['Latin jazz nights', 'black coffee and live music', 'Jewish deli classics', 'Italian family recipes', 'egg whites to order', 'kids eat free', 'Black Friday live music', 'race day specials', 'Asian fusion, late'])(
    'does not flag "%s" as a targeting term',
    (phrase) => {
      const result = validateVariant(ad(BK, { body: `Halfnote: ${phrase}.` }), ctxFor(BK));
      expect(rules(result.failed)).not.toContain('sensitive');
    },
  );
});

describe('validateVariant: failing copy', () => {
  const failing: [string, Parameters<typeof ad>[1], CopyRule, string, Parameters<typeof ctxFor>[1]?][] = [
    ['headline over 38 characters', { headline: 'Live music in Bed-Stuy every single nite' }, 'length', 'headline is 40 characters (max 38)'],
    ['headline over 6 words', { headline: 'Live music in Bed-Stuy all week long' }, 'length', 'headline has 7 words (max 6)'],
    ['body over 90 characters', { body: `Halfnote brings live music to Bed-Stuy. ${'Come early, stay late. '.repeat(3)}` }, 'length', 'body is'],
    ['CTA over 22 characters', { cta: 'Reserve your table today' }, 'length', 'CTA is 24 characters (max 22)'],
    ['empty headline', { headline: '   ' }, 'length', 'headline is empty'],
    ['emoji', { body: 'Halfnote: live music 🎷 in Bed-Stuy.' }, 'emoji', 'emoji in body'],
    ['flag emoji', { cta: 'Book now 🇺🇸' }, 'emoji', 'emoji in CTA'],
    ['no references', { references: [] }, 'refs', 'no evidence reference'],
    ['evidence from another neighborhood', { references: [{ evidenceId: evId('BK0302', 'Live Music'), phrase: 'live music' }] }, 'refs', 'is not from this neighborhood'],
    ['phrase missing from the copy', { references: [{ evidenceId: evId(BK, 'Late Night'), phrase: 'late night' }] }, 'refs', 'is not in the headline or body'],
    ['phrase only in the CTA', { cta: 'Late night here', references: [{ evidenceId: evId(BK, 'Late Night'), phrase: 'late night' }] }, 'refs', 'is not in the headline or body'],
    ['empty phrase', { references: [{ evidenceId: evId(BK, 'Live Music'), phrase: ' - ' }] }, 'refs', 'empty phrase'],
    ['variant for another neighborhood', { nta: 'BK0302' }, 'refs', 'variant is for BK0302'],
    ['another neighborhood', { headline: 'Live music, Harlem style.' }, 'foreign_local', 'another neighborhood: Harlem'],
    ['another borough', { body: 'Halfnote: the best live music in Queens.' }, 'foreign_local', 'another borough: Queens'],
    ['a park that does not border the neighborhood', { body: 'Halfnote: live music by Prospect Park.' }, 'foreign_local', 'Prospect Park'],
    ['unverified mid-sentence name', { headline: 'Live music, Glasper vibes.' }, 'ungrounded_proper_noun', 'unverified names "Glasper"'],
    ['street not in the brief', { body: 'Halfnote: live music off Flushing Ave.' }, 'ungrounded_proper_noun', '"Flushing"'],
    ['third-party name, even at a sentence start', { headline: 'Robert Glasper fans?', body: 'Halfnote brings live music to Bed-Stuy.' }, 'ungrounded_proper_noun', 'third-party name "Robert Glasper"', { blockedNames: ['Robert Glasper'] }],
    ['one distinctive word of a third-party name', { body: 'Halfnote: live music for Glasper lovers.' }, 'ungrounded_proper_noun', 'third-party name "Robert Glasper"', { blockedNames: ['Robert Glasper'] }],
    ['an anchor word at a sentence start that the brief never uses', { cta: 'Climb in free' }, 'ungrounded_proper_noun', 'third-party name "The Climb"', { blockedNames: ['The Climb'] }],
    ['local place name from the evidence', { body: 'Halfnote, around the corner from Bar Lunatico.' }, 'ungrounded_proper_noun', 'local place name "Bar Lunatico"', { places: ['Bar Lunatico'] }],
    ['age targeting', { body: 'Halfnote: live music for seniors.' }, 'sensitive', '"seniors" (age)'],
    ['generation label', { headline: 'Live music for Gen-Z' }, 'sensitive', '"gen z" (age)'],
    ['ethnicity targeting', { body: 'Halfnote: Black-owned live music.' }, 'sensitive', 'race or ethnicity'],
    ['ethnic group as audience', { body: 'Halfnote welcomes Latino families.' }, 'sensitive', 'race or ethnicity'],
    ['health condition', { body: 'Halfnote: live music, menus for diabetics.' }, 'sensitive', '(health)'],
    ['politics', { body: 'Halfnote: live music for voters.' }, 'sensitive', '(politics)'],
    ['sexuality', { body: 'Halfnote: LGBTQ+ live music night.' }, 'sensitive', 'sexuality'],
    ['income', { body: 'Halfnote: live music for affluent locals.' }, 'sensitive', '(income)'],
    ['invented date', { body: 'Halfnote opens Nov 19 with live music.' }, 'invented_number', 'numbers not in the brief: 19'],
    ['digit that is only a substring of the offer', { headline: 'Live music, 1 night only' }, 'invented_number', 'numbers not in the brief: 1', { offer: '10% off all week' }],
    ['digits with no offer', { headline: 'Live music, 2 sets' }, 'invented_number', '2', { offer: null }],
    ['missing business name', { body: 'A new supper club brings live music.' }, 'missing_business', 'business name "Halfnote" is missing'],
    ['business name made of common words must appear whole', { body: 'Smoke brings live music.' }, 'missing_business', '"Smoke & Sons"', { businessName: 'Smoke & Sons' }],
  ];
  it.each(failing)('%s', (_name, copy, rule, detail, opts) => {
    const result = validateVariant(ad(BK, copy), ctxFor(BK, opts));
    expect(result.ok).toBe(false);
    expect(result.replacedByTemplate).toBe(false);
    const hit = result.failed.find((f) => f.rule === rule);
    expect(hit, JSON.stringify(result.failed)).toBeDefined();
    expect(hit?.detail).toContain(detail);
  });

  it('names a longer neighborhood exactly ("East Williamsburg" in Williamsburg copy)', () => {
    const code = 'BK0102';
    const v = ad(code, { headline: 'Live music, East Williamsburg.', references: [{ evidenceId: evId(code, 'Live Music'), phrase: 'live music' }] });
    expect(validateVariant(v, ctxFor(code)).failed).toEqual([{ rule: 'foreign_local', detail: 'names another neighborhood: East Williamsburg' }]);
  });

  it('reports every failed rule once, in rule order', () => {
    const v = ad(BK, {
      headline: 'Harlem 🎷 nights for millennials, 2 jazz sets',
      body: 'Live jazz with Glasper.',
      cta: 'Reserve your table today',
      references: [{ evidenceId: 'ev:QN0103:live_music', phrase: 'karaoke' }],
    });
    const result = validateVariant(v, ctxFor(BK, { offer: null }));
    expect(rules(result.failed)).toEqual([
      'length',
      'emoji',
      'refs',
      'foreign_local',
      'ungrounded_proper_noun',
      'sensitive',
      'invented_number',
      'missing_business',
    ]);
    expect(result.failed.find((f) => f.rule === 'length')?.detail).toBe(
      'headline is 44 characters (max 38); CTA is 24 characters (max 22); headline has 7 words (max 6)',
    );
    expect(result.failed.find((f) => f.rule === 'refs')?.detail).toBe(
      'evidence "ev:QN0103:live_music" is not from this neighborhood; phrase "karaoke" is not in the headline or body',
    );
  });

  it('is deterministic', () => {
    const v = ad(BK, { headline: 'Harlem nights, 2 sets' });
    expect(validateVariant(v, ctxFor(BK))).toEqual(validateVariant(v, ctxFor(BK)));
  });
});
