import { describe, expect, it } from 'vitest';
import { isBrandSafe } from '@/server/agent/brand-safety';

describe('isBrandSafe', () => {
  it('flags listed names however they are written', () => {
    for (const name of ['The Cosby Show', 'cosby show', 'Bill Cosby', 'R. Kelly', 'R Kelly', 'Kanye  West', 'Ye']) {
      expect(isBrandSafe(name)).toBe(false);
    }
  });

  it('passes everything else, including names that only contain a listed word', () => {
    for (const name of ['Robert Glasper', 'Blue Note', 'The Cosby Kids Cookbook', 'Kanye Live Tribute Band', 'Yeah Yeah Yeahs']) {
      expect(isBrandSafe(name)).toBe(true);
    }
  });
});
