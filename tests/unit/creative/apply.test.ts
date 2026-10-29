import { describe, expect, it } from 'vitest';
import type { AdVariant } from '@/shared/types';
import { finalizeCreative } from '@/server/creative/apply';
import type { CreativeContext } from '@/server/creative/validate';
import { ad, ctxFor, evId } from './fixtures';

const BK = 'BK0301';
const QN = 'QN0103';

function contexts(): Record<string, CreativeContext> {
  return { [BK]: ctxFor(BK), [QN]: ctxFor(QN) };
}

const good = (code: string, variant: 'A' | 'B', overrides: Partial<AdVariant> = {}): AdVariant => {
  const short = code === BK ? 'Bed-Stuy' : 'Astoria';
  return ad(code, {
    variant,
    headline: variant === 'A' ? `Live music, ${short} style.` : 'Free entry before 9pm on Tuesdays',
    body: `Halfnote brings live music to ${short}.`,
    references: [{ evidenceId: evId(code, 'Live Music'), phrase: 'live music' }],
    ...overrides,
  });
};

const allGood = () => [good(BK, 'A'), good(BK, 'B'), good(QN, 'A'), good(QN, 'B')];

describe('finalizeCreative', () => {
  it('keeps passing model variants as they are', () => {
    const r = finalizeCreative(allGood(), contexts(), { via: 'groq', tone: 'warm' });
    expect(r).toMatchObject({ expected: 4, passed: 4, failover: false });
    expect(r.sets.map((s) => s.nta)).toEqual([BK, QN]);
    for (const set of r.sets) {
      expect(set.via).toBe('groq');
      expect(set.variants.map((v) => [v.variant, v.source])).toEqual([
        ['A', 'model'],
        ['B', 'model'],
      ]);
      for (const v of set.variants) expect(v.grounding).toEqual({ ok: true, failed: [], replacedByTemplate: false });
    }
  });

  it('replaces a failing variant with a template and keeps the reason', () => {
    const variants = allGood();
    variants[0] = good(BK, 'A', { headline: 'Live music, Harlem style.' });
    const r = finalizeCreative(variants, contexts(), { via: 'groq', tone: 'warm' });
    expect(r).toMatchObject({ expected: 4, passed: 3, failover: false });
    const [a, b] = r.sets[0]?.variants ?? [];
    expect(a?.source).toBe('template');
    expect(a?.grounding).toEqual({
      ok: true,
      failed: [{ rule: 'foreign_local', detail: 'names another neighborhood: Harlem' }],
      replacedByTemplate: true,
    });
    expect(a?.headline).not.toContain('Harlem');
    expect(b?.source).toBe('model');
    expect(r.sets[0]?.via).toBe('groq');
  });

  it('fills missing variants and counts them as failures', () => {
    const onlyA = [good(BK, 'A'), good(QN, 'A')];
    const half = finalizeCreative(onlyA, contexts(), { via: 'groq' });
    expect(half).toMatchObject({ expected: 4, passed: 2, failover: false }); // exactly half is enough
    expect(half.sets.map((s) => s.variants.map((v) => `${v.variant}:${v.source}`))).toEqual([
      ['A:model', 'B:template'],
      ['A:model', 'B:template'],
    ]);
    for (const set of half.sets) {
      const b = set.variants[1];
      expect(b?.grounding).toEqual({ ok: true, failed: [], replacedByTemplate: true });
    }

    const one = finalizeCreative([good(BK, 'A')], contexts(), { via: 'groq' });
    expect(one).toMatchObject({ expected: 4, passed: 1, failover: true });
  });

  it('uses the first passing variant when the model repeats a slot', () => {
    const variants = [good(BK, 'A', { body: 'A new jazz room.' }), good(BK, 'A', { body: 'Halfnote: the second take.' }), good(BK, 'A')];
    const r = finalizeCreative(variants, contexts(), { via: 'groq' });
    const a = r.sets[0]?.variants[0];
    expect(a?.source).toBe('model');
    expect(a?.body).toBe('Halfnote: the second take.');
    expect(r.sets[0]?.variants).toHaveLength(2);
    expect(r.passed).toBe(1);
  });

  it('ignores variants for neighborhoods it was not asked about', () => {
    const r = finalizeCreative([...allGood(), good('MN0402', 'A')], contexts(), { via: 'groq' });
    expect(r.sets.map((s) => s.nta)).toEqual([BK, QN]);
    expect(r).toMatchObject({ expected: 4, passed: 4 });
  });

  it('builds everything from templates when no model is available', () => {
    const r = finalizeCreative([], contexts(), { via: 'template', tone: 'bold' });
    expect(r).toMatchObject({ expected: 4, passed: 0, failover: true });
    for (const set of r.sets) {
      expect(set.via).toBe('template');
      expect(set.variants.map((v) => v.variant)).toEqual(['A', 'B']);
      for (const v of set.variants) {
        expect(v.source).toBe('template');
        expect(v.grounding).toEqual({ ok: true, failed: [], replacedByTemplate: true });
        expect(`${v.headline} ${v.body}`).toContain('Halfnote');
      }
    }
  });

  it('stores trimmed copy (what was validated)', () => {
    const variants = allGood();
    variants[0] = good(BK, 'A', { headline: '  Live music,   Bed-Stuy style. ', cta: ' Book a table ' });
    const a = finalizeCreative(variants, contexts(), { via: 'groq' }).sets[0]?.variants[0];
    expect(a).toMatchObject({ source: 'model', headline: 'Live music, Bed-Stuy style.', cta: 'Book a table' });
  });

  it('stores plain hyphens where the model wrote typographic ones', () => {
    const variants = allGood();
    variants[0] = good(BK, 'A', { headline: 'Live music, Bed‑Stuy style.', body: 'Halfnote brings live music to Bed‐Stuy.' });
    const a = finalizeCreative(variants, contexts(), { via: 'groq' }).sets[0]?.variants[0];
    expect(a).toMatchObject({ source: 'model', headline: 'Live music, Bed-Stuy style.', body: 'Halfnote brings live music to Bed-Stuy.' });
  });

  it('reports template failures too when even the template cannot pass', () => {
    const ctx = { [BK]: ctxFor(BK, { labels: [] }) };
    const a = finalizeCreative([], ctx, { via: 'template' }).sets[0]?.variants[0];
    expect(a?.grounding.ok).toBe(false);
    expect(a?.grounding.replacedByTemplate).toBe(true);
    expect(a?.grounding.failed).toEqual([{ rule: 'refs', detail: 'template: no evidence reference' }]);
  });

  it('is deterministic', () => {
    const variants = allGood();
    variants[3] = good(QN, 'B', { body: 'Halfnote: 2 sets nightly.' });
    expect(finalizeCreative(variants, contexts(), { via: 'groq' })).toEqual(finalizeCreative(variants, contexts(), { via: 'groq' }));
  });
});
