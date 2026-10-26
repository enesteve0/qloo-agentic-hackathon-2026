import { describe, expect, it } from 'vitest';
import { buildLexicon, canonicalBorough } from '@/server/creative/lexicon';
import { LEXICON, NTAS } from './fixtures';

const terms = (text: string) => LEXICON.find(text).map((m) => m.term);
const codes = (text: string) => LEXICON.find(text).map((m) => m.codes);

describe('buildLexicon', () => {
  it('matches names and aliases case-, diacritic- and punctuation-insensitively', () => {
    expect(codes('Live jazz in Bed-Stuy')).toEqual([['BK0301', 'BK0302']]);
    expect(codes('BED STUY nights')).toEqual([['BK0301', 'BK0302']]);
    expect(codes('Bedstuy')).toEqual([['BK0301', 'BK0302']]);
    expect(codes('Bedford–Stuyvesant')).toEqual([['BK0301', 'BK0302']]);
    expect(codes('West Bedford-Stuyvesant')).toEqual([['BK0301']]);
    expect(codes('Hell’s Kitchen and HELLS KITCHEN')).toEqual([['MN0402'], ['MN0402']]);
    expect(codes('Brooklyn’s best')).toEqual([[]]);
    expect(LEXICON.find('Brooklyn’s best')[0]).toMatchObject({ kind: 'borough', borough: 'Brooklyn' });
  });

  it('splits compound NTA names into their neighborhoods', () => {
    expect(codes('Gowanus and Red Hook')).toEqual([['BK0601'], ['BK0601']]);
    expect(codes('Hallets Point')).toEqual([['QN0102']]);
    expect(codes('St. George ferry')).toEqual([]); // "St. George" + "ferry" is the ferry, a landmark
    expect(codes('Sunset in St. George')).toEqual([['SI0101']]);
  });

  it('prefers the longest match and never matches inside a word', () => {
    expect(terms('East Williamsburg, not Williamsburg')).toEqual(['East Williamsburg', 'Williamsburg']);
    expect(terms('East Harlem and Harlem')).toEqual(['East Harlem', 'Harlem']);
    expect(terms('NYC, New York and East New York')).toEqual(['NYC', 'New York', 'East New York']);
    expect(terms('Queensboro Plaza, Bronxville, Jamaican patties')).toEqual([]);
    expect(terms('Old Astoria and Astoria')).toEqual(['Old Astoria', 'Astoria']);
  });

  it('keeps the words of one place name together', () => {
    expect(terms('Sunset Park tacos')).toEqual(['Sunset Park']);
    expect(terms('Catch the sunset. Park yourself here.')).toEqual([]);
  });

  it('knows boroughs and the city, with casing and context rules for ambiguous words', () => {
    expect(LEXICON.find('The Bronx and the bronx').map((m) => m.borough)).toEqual(['Bronx', 'Bronx']);
    expect(LEXICON.find('Staten Island')[0]?.borough).toBe('Staten Island');
    expect(LEXICON.find('BK finest')[0]?.borough).toBe('Brooklyn');
    expect(LEXICON.find('bk finest')).toEqual([]);
    expect(LEXICON.find('Queens best ramen')[0]?.borough).toBe('Queens');
    expect(LEXICON.find('queens of the night')).toEqual([]);
    expect(LEXICON.find('Drag Queens Brunch')).toEqual([]);
    expect(LEXICON.find('Kings and Queens night')).toEqual([]);
    expect(LEXICON.find('grab a smoked Manhattan')).toEqual([]);
    expect(LEXICON.find('Manhattan cocktails')).toEqual([]);
    expect(LEXICON.find('Manhattan views')[0]?.borough).toBe('Manhattan');
  });

  it('treats acronyms as case-sensitive and skips ambiguous or common single words', () => {
    expect(codes('LES streetwear')).toEqual([['MN0302']]);
    expect(codes('les miserables')).toEqual([]);
    expect(codes('LIC lofts')).toEqual([['QN0201']]);
    expect(terms('Rugby on the big screen, a taste of Jamaica, green tea')).toEqual([]);
    expect(terms('flushing out the menu')).toEqual([]);
    expect(terms('Flushing dumplings')).toEqual(['Flushing']);
  });

  it('ignores streets, bridges and institutions named after places', () => {
    expect(terms('off Flushing Ave')).toEqual([]);
    expect(terms('under the Manhattan Bridge')).toEqual([]);
    expect(terms('Williamsburg Bridge views')).toEqual([]);
    expect(terms('Williamsburg views')).toEqual(['Williamsburg']);
  });

  it('decides which mentions are local to a neighborhood', () => {
    const first = (text: string) => {
      const m = LEXICON.find(text)[0];
      if (!m) throw new Error(`no mention in ${text}`);
      return m;
    };
    expect(LEXICON.isLocal(first('Bed-Stuy'), 'BK0301')).toBe(true);
    expect(LEXICON.isLocal(first('Brooklyn'), 'BK0301')).toBe(true);
    expect(LEXICON.isLocal(first('NYC'), 'BK0301')).toBe(true);
    expect(LEXICON.isLocal(first('Queens'), 'BK0301')).toBe(false);
    expect(LEXICON.isLocal(first('Harlem'), 'BK0301')).toBe(false);
    // Part of the NTA's own name.
    expect(LEXICON.isLocal(first('Williamsburg'), 'BK0104')).toBe(true);
    expect(LEXICON.isLocal(first('East Williamsburg'), 'BK0102')).toBe(false);
    expect(LEXICON.isLocal(first('Harlem'), 'MN1101')).toBe(true);
    // A non-residential park may be named by neighborhoods it borders only.
    expect(LEXICON.isLocal(first('Prospect Park'), 'BK0602')).toBe(true);
    expect(LEXICON.isLocal(first('Prospect Park'), 'BK0301')).toBe(false);
  });

  it('exposes neighborhood words and place words', () => {
    expect([...LEXICON.ntaTokens('BK0301')].sort()).toEqual(['bed', 'bedford', 'bedstuy', 'stuy', 'stuyvesant', 'west']);
    expect(LEXICON.isPlaceWord('astoria')).toBe(true);
    expect(LEXICON.isPlaceWord('brooklyn')).toBe(true);
    expect(LEXICON.isPlaceWord('queensboro')).toBe(false);
    expect(LEXICON.boroughOf('QN0103')).toBe('Queens');
    expect(LEXICON.boroughOf('XX0000')).toBeNull();
  });

  it('does not depend on input order', () => {
    const reversed = buildLexicon([...NTAS].reverse());
    const text = 'Bed-Stuy, Harlem, Astoria, the Bronx, LIC and Old Astoria';
    expect(reversed.find(text)).toEqual(LEXICON.find(text));
  });

  it('canonicalizes borough spellings', () => {
    expect(canonicalBorough('The Bronx')).toBe('Bronx');
    expect(canonicalBorough('MANHATTAN')).toBe('Manhattan');
    expect(canonicalBorough(' Staten Island ')).toBe('Staten Island');
    expect(canonicalBorough('Elsewhere')).toBe('Elsewhere');
  });
});
