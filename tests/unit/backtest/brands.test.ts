import { describe, expect, it } from 'vitest';
import { BRANDS, checkWikidata, foldLabel } from '../../../scripts/backtest/brands';

describe('brand panel', () => {
  it('has 20–30 chains with unique slugs and unique, well-formed QIDs', () => {
    expect(BRANDS.length).toBeGreaterThanOrEqual(20);
    expect(BRANDS.length).toBeLessThanOrEqual(30);
    expect(new Set(BRANDS.map((b) => b.id)).size).toBe(BRANDS.length);
    expect(new Set(BRANDS.map((b) => b.qid)).size).toBe(BRANDS.length);
    for (const b of BRANDS) {
      expect(b.id).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
      expect(b.id).not.toBe('poi-density'); // reserved cache name
      expect(b.qid).toMatch(/^Q\d+$/);
      expect(b.wikidataLabel.trim()).not.toBe('');
    }
  });

  it('searches every chain as a Qloo brand with a non-empty query', () => {
    for (const b of BRANDS) {
      expect(b.qloo.type).toBe('brand');
      expect(b.qloo.query.trim()).not.toBe('');
      expect(b.qloo.aliases.every((a) => a.trim() !== '')).toBe(true);
    }
  });
});

describe('checkWikidata', () => {
  const entry = { qid: 'Q2109109', wikidataLabel: 'Pret a Manger' };
  const response = (key: string, label?: string, extra: Record<string, unknown> = {}) => ({
    entities: { [key]: { id: key, ...(label ? { labels: { en: { language: 'en', value: label } } } : {}), ...extra } },
  });

  it('accepts the expected label regardless of case, punctuation and accents', () => {
    expect(checkWikidata(entry, response('Q2109109', 'Pret A Manger'))).toEqual({ ok: true, label: 'Pret A Manger' });
    expect(foldLabel("Trader Joe's")).toBe(foldLabel('Trader Joe’s'));
    expect(foldLabel('Joe & The Juice')).toBe('joe and the juice');
    expect(foldLabel('Café')).toBe('cafe');
  });

  it('rejects a different label, a redirect, a missing entity, a missing English label and garbage', () => {
    expect(checkWikidata(entry, response('Q2109109', 'Prêt Immobilier'))).toEqual({ ok: false, reason: 'label is “Prêt Immobilier”, expected “Pret a Manger”' });
    expect(checkWikidata(entry, response('Q1', 'Pret a Manger'))).toEqual({ ok: false, reason: 'Q2109109 redirects to Q1' });
    expect(checkWikidata(entry, { entities: {} })).toEqual({ ok: false, reason: 'Q2109109 not found' });
    expect(checkWikidata(entry, response('Q2109109', 'Pret a Manger', { missing: '' })).ok).toBe(false);
    expect(checkWikidata(entry, response('Q2109109'))).toEqual({ ok: false, reason: 'Q2109109 has no English label' });
    expect(checkWikidata(entry, null).ok).toBe(false);
    expect(checkWikidata(entry, 'not json').ok).toBe(false);
  });
});
