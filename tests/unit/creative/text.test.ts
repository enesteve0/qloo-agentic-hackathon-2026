import { describe, expect, it } from 'vitest';
import { digitSequences, pricedDigitSequences } from '@/server/creative/text';

describe('pricedDigitSequences', () => {
  it('finds money and discounts, not bare counts or times', () => {
    expect(pricedDigitSequences('Dinner for $48, 10% off, 20 off drinks')).toEqual(['48', '10', '20']);
    expect(pricedDigitSequences('$4.50 coffee and £1,200 tabs')).toEqual(['4', '50', '1200']);
    expect(pricedDigitSequences('48 seats from 7pm, 3 sets')).toEqual([]);
    expect(pricedDigitSequences(null)).toEqual([]);
  });

  it('returns the same digit runs digitSequences reports', () => {
    const text = 'Win $2,000 or 15 percent off';
    expect(pricedDigitSequences(text)).toEqual(['2000', '15']);
    for (const d of pricedDigitSequences(text)) expect(digitSequences(text)).toContain(d);
  });
});
