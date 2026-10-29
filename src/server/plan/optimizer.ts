import 'server-only';
import type { Kiosk, MediaPlan, PlannedScreen, PricingAssumptions } from '@/shared/types';
import { isManhattan, resolveAssumptions } from './assumptions';
import { formatUsd, formatWeeks } from './format';

/** Kiosks below this fit percentile are not candidates (ARCHITECTURE §9). */
export const DEFAULT_MIN_FIT = 50;

export interface MediaPlanInput {
  kiosks: readonly Kiosk[];
  /** Fit percentile per kiosk index (`Kiosk.i`, kiosks.json order); -1 when not scored. */
  kioskFit: readonly number[];
  /** Top neighborhoods in rank order: the ones that also get creative. */
  topNtas: readonly string[];
  budgetUsd: number;
  weeks: number;
  assumptions: PricingAssumptions;
  /** Minimum kiosk fit to be a candidate (default 50; the proof's LLM-only plan uses 0). */
  minFit?: number;
}

interface Candidate {
  kiosk: Kiosk;
  nta: string;
  ntaRank: number;
  fit: number;
  weeklyImpressions: number;
  /** Cost of this screen for the whole flight, in integer cents (exact budget arithmetic). */
  costCents: number;
  /** Taste-weighted impressions over the flight: impressions per week · weeks · fit/100. */
  value: number;
}

/** Best value per dollar first; ties by higher fit, then siteId, then kiosk index. */
function byValuePerCost(a: Candidate, b: Candidate): number {
  const d = b.value * a.costCents - a.value * b.costCents;
  if (d !== 0) return d;
  if (a.fit !== b.fit) return b.fit - a.fit;
  if (a.kiosk.siteId !== b.kiosk.siteId) return a.kiosk.siteId < b.kiosk.siteId ? -1 : 1;
  return a.kiosk.i - b.kiosk.i;
}

function toScreen(c: Candidate): PlannedScreen {
  return {
    i: c.kiosk.i,
    siteId: c.kiosk.siteId,
    nta: c.nta,
    fit: c.fit,
    weeklyImpressions: c.weeklyImpressions,
    cost: c.costCents / 100,
  };
}

/**
 * Deterministic budget allocation over the top neighborhoods' kiosks (ARCHITECTURE §9).
 *
 * 1. Candidates: kiosks in `topNtas` with fit ≥ `minFit`. Value v = weekly impressions · weeks ·
 *    fit/100; cost c = price per screen-week (Manhattan or outer tier) · weeks.
 * 2. N_target = floor(budget / mean c); per-neighborhood cap = max(1, ceil(0.5 · N_target)).
 * 3. Greedy by v/c (ties: fit, then siteId) within budget and caps.
 * 4. Repair: a top neighborhood left without a screen gets its best affordable one, freeing budget
 *    by dropping the lowest-ranked screens of neighborhoods that keep at least one; then refill.
 *
 * Same input, same output: every ordering is total and money is counted in integer cents, so the
 * budget is never exceeded.
 */
export function buildMediaPlan(input: MediaPlanInput): MediaPlan {
  const assumptions = resolveAssumptions(input.assumptions);
  const weeks = Number.isFinite(input.weeks) && input.weeks > 0 ? input.weeks : 0;
  const budgetUsd = Number.isFinite(input.budgetUsd) && input.budgetUsd > 0 ? input.budgetUsd : 0;
  const budgetCents = Math.floor(budgetUsd * 100 + 1e-6);
  const minFit = input.minFit ?? DEFAULT_MIN_FIT;
  const tops = [...new Set(input.topNtas)];
  const rank = new Map(tops.map((code, k) => [code, k]));

  const candidates: Candidate[] = [];
  const seen = new Set<number>();
  for (const kiosk of weeks > 0 ? input.kiosks : []) {
    const ntaRank = rank.get(kiosk.nta);
    const fit = input.kioskFit[kiosk.i];
    if (ntaRank === undefined || seen.has(kiosk.i)) continue;
    if (fit === undefined || !Number.isFinite(fit) || fit < 0 || fit < minFit) continue;
    seen.add(kiosk.i);
    const manhattan = isManhattan(kiosk.boro);
    const price = manhattan ? assumptions.pricePerKioskWeek.manhattan : assumptions.pricePerKioskWeek.outer;
    const weeklyImpressions = manhattan ? assumptions.impressionsPerKioskWeek.manhattan : assumptions.impressionsPerKioskWeek.outer;
    candidates.push({
      kiosk,
      nta: kiosk.nta,
      ntaRank,
      fit,
      weeklyImpressions,
      // Price to whole cents first, then the flight: $10.29 × 1.5 weeks is 1,543.5 cents → 1,544
      // (multiplying in floating point first gives 1,543.4999… → 1,543).
      costCents: Math.round(Math.round(price * 100) * weeks),
      value: (weeklyImpressions * weeks * fit) / 100,
    });
  }
  candidates.sort(byValuePerCost);

  const chosen = new Set<Candidate>();
  const count = new Map<string, number>();
  let spent = 0;
  const pick = (c: Candidate) => {
    chosen.add(c);
    count.set(c.nta, (count.get(c.nta) ?? 0) + 1);
    spent += c.costCents;
  };
  const drop = (c: Candidate) => {
    chosen.delete(c);
    count.set(c.nta, (count.get(c.nta) ?? 0) - 1);
    spent -= c.costCents;
  };

  const cheapest = candidates.length ? candidates.reduce((m, c) => (c.costCents < m.costCents ? c : m)) : null;
  let infeasibleReason: string | null = null;
  if (weeks <= 0) {
    infeasibleReason = 'Set a campaign length of more than zero weeks.';
  } else if (!cheapest) {
    infeasibleReason =
      minFit > 0 ? `No screens with a taste fit of ${minFit} or more in the selected neighborhoods.` : 'No scored screens in the selected neighborhoods.';
  } else if (budgetCents < cheapest.costCents) {
    const perWeek = formatUsd(cheapest.costCents / 100 / weeks);
    infeasibleReason =
      weeks === 1
        ? `Minimum ${perWeek} for one screen-week`
        : `Minimum ${perWeek} for one screen-week (${formatUsd(cheapest.costCents / 100)} for ${formatWeeks(weeks)})`;
  }

  if (!infeasibleReason) {
    const meanCost = candidates.reduce((s, c) => s + c.costCents, 0) / candidates.length;
    const nTarget = Math.floor(budgetCents / meanCost);
    const cap = Math.max(1, Math.ceil(0.5 * nTarget));
    const fill = () => {
      for (const c of candidates) {
        if (chosen.has(c) || spent + c.costCents > budgetCents || (count.get(c.nta) ?? 0) >= cap) continue;
        pick(c);
      }
    };
    fill();

    // Repair: every top neighborhood with candidates should get at least one screen if affordable.
    for (const nta of tops) {
      if ((count.get(nta) ?? 0) > 0) continue;
      for (const option of candidates.filter((c) => c.nta === nta)) {
        let free = budgetCents - spent;
        const removals: Candidate[] = [];
        if (free < option.costCents) {
          const left = new Map(count);
          const worstFirst = candidates.filter((c) => chosen.has(c)).reverse();
          for (const c of worstFirst) {
            if (free >= option.costCents) break;
            const n = left.get(c.nta) ?? 0;
            if (n <= 1) continue;
            removals.push(c);
            left.set(c.nta, n - 1);
            free += c.costCents;
          }
        }
        if (free < option.costCents) continue; // try a cheaper screen in this neighborhood
        for (const r of removals) drop(r);
        pick(option);
        break;
      }
    }
    fill();
  }

  const picked = candidates
    .filter((c) => chosen.has(c))
    .sort((a, b) => a.ntaRank - b.ntaRank || byValuePerCost(a, b));
  const screens = picked.map(toScreen);
  const twi = (c: Candidate) => Math.round(c.value);
  // Only neighborhoods that got screens: a small budget can leave some top neighborhoods out.
  const byNta = tops.flatMap((nta) => {
    const mine = picked.filter((c) => c.nta === nta);
    if (mine.length === 0) return [];
    return {
      nta,
      screens: mine.length,
      spend: mine.reduce((s, c) => s + c.costCents, 0) / 100,
      tasteWeightedImpressions: mine.reduce((s, c) => s + twi(c), 0),
    };
  });

  return {
    budgetUsd,
    weeks,
    assumptions,
    screens,
    byNta,
    totals: {
      spend: spent / 100,
      impressions: Math.round(picked.reduce((s, c) => s + c.weeklyImpressions * weeks, 0)),
      tasteWeightedImpressions: picked.reduce((s, c) => s + twi(c), 0),
      screens: screens.length,
    },
    leftoverUsd: Math.max(0, Math.round(budgetUsd * 100 - spent) / 100),
    nextBest: candidates
      .filter((c) => !chosen.has(c))
      .slice(0, 3)
      .map(toScreen),
    infeasibleReason,
    cheapestScreenUsd: cheapest ? cheapest.costCents / 100 : null,
  };
}
