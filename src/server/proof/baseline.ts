import 'server-only';
import type { Kiosk, MediaPlan, PricingAssumptions, Proof, WhereResult } from '@/shared/types';
import { buildMediaPlan } from '@/server/plan/optimizer';

/** Always shown with the comparison (ARCHITECTURE §10). */
export const PROOF_NOTE = "Scoring the LLM-only plan on Qloo's map is circular by design; see /proof for an independent test.";

/**
 * The LLM-only plan runs the same optimizer on the LLM's neighborhoods without the fit floor: an
 * LLM-only planner has no Qloo threshold and would spend its budget there anyway. It still ranks
 * screens inside those neighborhoods by our kiosk fit, which favours the LLM (a conservative test).
 */
export const LLM_MIN_FIT = 0;

const MAX_PICKS = 5;

export interface ProofInput {
  where: WhereResult;
  /** The planner's brief-only neighborhood picks (made before any Qloo data). */
  llmPicks: readonly { ntaCode: string; reason: string }[];
  /** Stoop's plan, as shown to the owner. */
  plan: MediaPlan;
  kiosks: readonly Kiosk[];
  kioskFit: readonly number[];
  budgetUsd: number;
  weeks: number;
  assumptions: PricingAssumptions;
  /** Evidence labels per NTA code (strongest first), for the "missed by the LLM" card. */
  evidenceByNta?: Readonly<Record<string, readonly string[]>>;
}

function median(xs: readonly number[]): number | null {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? (s[mid] ?? null) : ((s[mid - 1] ?? 0) + (s[mid] ?? 0)) / 2;
}

/**
 * Share of a plan's spend on screens in below-baseline neighborhoods: neighborhoods whose shrunk
 * lift L̂ is below zero, i.e. where the anchors' Qloo signal ranks lower than NYC's overall signal.
 * Neighborhoods missing from the WHERE ranking count as below baseline (no benefit of the doubt).
 * Rounded to 4 decimals; 0 for a plan without spend.
 */
export function belowBaselineShare(plan: MediaPlan, liftByNta: ReadonlyMap<string, number>): number {
  let total = 0;
  let below = 0;
  for (const s of plan.screens) {
    const cents = Math.round(s.cost * 100);
    total += cents;
    if ((liftByNta.get(s.nta) ?? Number.NEGATIVE_INFINITY) < 0) below += cents;
  }
  return total > 0 ? Math.round((below / total) * 10_000) / 10_000 : 0;
}

/**
 * Per-run proof (ARCHITECTURE §10): how the LLM's brief-only neighborhood picks score on the same
 * Qloo lift ranking, and what the same money buys there. Unknown or duplicate NTA codes are
 * ignored; with no valid pick the comparison is unavailable (but our own figures are still given).
 *
 * Both plans are compared at the same spend: the LLM-only plan may spend what Stoop's plan actually
 * spent (the full budget when Stoop's plan is empty). Stoop's plan can leave budget unplaced when its
 * neighborhoods run out of fitting screens; giving the LLM the full budget then would compare how
 * much money each plan placed instead of where it went.
 */
export function computeProof(input: ProofInput): Proof {
  const ranked = [...input.where.ntas].sort(
    (a, b) => b.lift - a.lift || b.fitIndex - a.fitIndex || (a.code < b.code ? -1 : a.code > b.code ? 1 : 0),
  );
  const byCode = new Map(ranked.map((n) => [n.code, n]));
  const liftByNta = new Map(ranked.map((n) => [n.code, n.lift]));
  const ours = {
    tasteWeightedImpressions: input.plan.totals.tasteWeightedImpressions,
    belowBaselineShare: belowBaselineShare(input.plan, liftByNta),
  };

  const picks: Proof['llmPicks'] = [];
  const picked = new Set<string>();
  for (const p of input.llmPicks) {
    const code = String(p.ntaCode ?? '')
      .replace(/\s+/g, '')
      .toUpperCase();
    const score = byCode.get(code);
    if (!score || picked.has(code)) continue;
    picked.add(code);
    picks.push({ nta: code, reason: String(p.reason ?? '').trim(), percentile: score.fitIndex });
    if (picks.length === MAX_PICKS) break;
  }

  if (picks.length === 0) {
    return {
      available: false,
      llmPicks: [],
      overlapAt5: 0,
      medianLlmPercentile: null,
      ours,
      llmOnly: null,
      missedByLlm: null,
      note: PROOF_NOTE,
    };
  }

  const stoopTop5 = new Set(ranked.slice(0, MAX_PICKS).map((n) => n.code));
  const ourSpend = input.plan.totals.spend;
  const llmPlan = buildMediaPlan({
    kiosks: input.kiosks,
    kioskFit: input.kioskFit,
    topNtas: picks.map((p) => p.nta),
    budgetUsd: ourSpend > 0 ? Math.min(input.budgetUsd, ourSpend) : input.budgetUsd,
    weeks: input.weeks,
    assumptions: input.assumptions,
    minFit: LLM_MIN_FIT,
  });

  // "Missed by the LLM": the best of Stoop's planned neighborhoods that the LLM did not pick.
  const planned = new Set(input.plan.byNta.map((b) => b.nta));
  const pool = planned.size > 0 ? ranked.filter((n) => planned.has(n.code)) : ranked.slice(0, MAX_PICKS);
  const missed = pool.find((n) => !picked.has(n.code));

  return {
    available: true,
    llmPicks: picks,
    overlapAt5: picks.filter((p) => stoopTop5.has(p.nta)).length,
    medianLlmPercentile: median(picks.flatMap((p) => (p.percentile === null ? [] : [p.percentile]))),
    ours,
    llmOnly:
      llmPlan.screens.length > 0
        ? { tasteWeightedImpressions: llmPlan.totals.tasteWeightedImpressions, belowBaselineShare: belowBaselineShare(llmPlan, liftByNta) }
        : null,
    missedByLlm: missed ? { nta: missed.code, evidence: [...(input.evidenceByNta?.[missed.code] ?? [])].slice(0, 3) } : null,
    note: PROOF_NOTE,
  };
}
