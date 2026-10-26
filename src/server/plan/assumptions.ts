import 'server-only';
import type { PricingAssumptions } from '@/shared/types';

/**
 * Default pricing and audience ASSUMPTIONS for the PLAN station. They are not data.
 *
 * No public rate card exists for LinkNYC screens (Intersection sells them through its LinkDirect
 * portal and programmatically), so these are illustrative, deliberately conservative round numbers.
 * The UI must label every figure derived from them ASSUMPTION and let the owner edit them.
 *
 * - Impressions per screen-week: an outer-borough corridor kiosk is assumed to be passed by about
 *   3,000 people a day and a Manhattan kiosk by about 8,500, with one advertiser's spot shown in
 *   about 1 of 6 loop slots → ~3,500 and ~10,000 impressions per screen-week.
 * - Price per screen-week: about $11–12 per thousand impressions, a typical street-level digital
 *   out-of-home CPM → $40 outside Manhattan and $120 in Manhattan.
 *
 * With these numbers the hero brief ($2,000 over 3 weeks in Brooklyn) buys about 16 screens, inside
 * the 15–25 screens a Stoop plan aims for.
 */
export const DEFAULT_ASSUMPTIONS: Readonly<PricingAssumptions> = Object.freeze({
  label: 'assumption',
  pricePerKioskWeek: Object.freeze({ manhattan: 120, outer: 40 }),
  impressionsPerKioskWeek: Object.freeze({ manhattan: 10_000, outer: 3_500 }),
});

export interface AssumptionOverrides {
  pricePerKioskWeek?: Partial<PricingAssumptions['pricePerKioskWeek']>;
  impressionsPerKioskWeek?: Partial<PricingAssumptions['impressionsPerKioskWeek']>;
}

/** Upper bounds that keep owner edits sane (and integer-cent maths far from float limits). */
const MAX_PRICE_USD = 100_000;
const MAX_IMPRESSIONS = 10_000_000;

function pick(value: unknown, fallback: number, max: number, round: (n: number) => number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value > max) return fallback;
  const rounded = round(value);
  return rounded > 0 ? rounded : fallback;
}

const toCents = (n: number): number => Math.round(n * 100) / 100;

/**
 * Fresh, validated assumptions: owner edits where they are positive finite numbers within bounds,
 * defaults elsewhere. Prices are rounded to cents and impressions to whole numbers.
 */
export function resolveAssumptions(overrides?: AssumptionOverrides | null): PricingAssumptions {
  const d = DEFAULT_ASSUMPTIONS;
  return {
    label: 'assumption',
    pricePerKioskWeek: {
      manhattan: pick(overrides?.pricePerKioskWeek?.manhattan, d.pricePerKioskWeek.manhattan, MAX_PRICE_USD, toCents),
      outer: pick(overrides?.pricePerKioskWeek?.outer, d.pricePerKioskWeek.outer, MAX_PRICE_USD, toCents),
    },
    impressionsPerKioskWeek: {
      manhattan: pick(overrides?.impressionsPerKioskWeek?.manhattan, d.impressionsPerKioskWeek.manhattan, MAX_IMPRESSIONS, Math.round),
      outer: pick(overrides?.impressionsPerKioskWeek?.outer, d.impressionsPerKioskWeek.outer, MAX_IMPRESSIONS, Math.round),
    },
  };
}

/** Manhattan screens use the Manhattan tier; every other borough uses the outer tier. */
export function isManhattan(boro: string): boolean {
  const b = boro.trim().toLowerCase();
  return b === 'manhattan' || b === 'mn' || b === 'new york' || b === 'new york county';
}

export function pricePerWeek(boro: string, a: PricingAssumptions): number {
  return isManhattan(boro) ? a.pricePerKioskWeek.manhattan : a.pricePerKioskWeek.outer;
}

export function impressionsPerWeek(boro: string, a: PricingAssumptions): number {
  return isManhattan(boro) ? a.impressionsPerKioskWeek.manhattan : a.impressionsPerKioskWeek.outer;
}
