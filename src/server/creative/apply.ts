import 'server-only';
import type { AdVariant, CreativeSet, CreativeVariant, GroundingResult, Tone } from '@/shared/types';
import { squish } from './text';
import { templateVariant } from './templates';
import { validateVariant, type CreativeContext } from './validate';

export interface FinalizeOptions {
  /** Model slot id that wrote `variants`; becomes CreativeSet.via when any model copy is kept. */
  via: string;
  /** Planner tone for template wording (default "warm"). */
  tone?: Tone;
}

export interface FinalizeResult {
  /** One set per neighborhood, in `ctxPerNta` order, each with exactly variants A and B. */
  sets: CreativeSet[];
  /** Model variants expected: two per neighborhood. */
  expected: number;
  /** Expected slots filled by a model variant that passed every rule. */
  passed: number;
  /** Fewer than half of the expected model variants passed: the caller should try the next model slot. */
  failover: boolean;
}

const SLOTS = ['A', 'B'] as const;

/** Trim model output so stored copy matches what was validated. */
function tidy(v: AdVariant): AdVariant {
  return {
    nta: v.nta,
    variant: v.variant,
    headline: squish(v.headline),
    body: squish(v.body),
    cta: squish(v.cta),
    references: (v.references ?? [])
      .filter((r) => typeof r?.evidenceId === 'string' && typeof r.phrase === 'string')
      .map((r) => ({ evidenceId: r.evidenceId.trim(), phrase: squish(r.phrase) })),
    rationale: squish(v.rationale),
  };
}

/**
 * Validate the model's variants and fill every neighborhood with exactly one A and one B.
 * For each slot the first model variant that passes is kept (source "model"); otherwise an
 * evidence-filled template takes its place (source "template", `replacedByTemplate` true) and the
 * model variant's failed rules are kept in `grounding.failed` so the UI can say why. A missing model
 * variant counts as a failure. `grounding.ok` describes the copy that ships (the template).
 */
export function finalizeCreative(
  variants: readonly AdVariant[],
  ctxPerNta: Readonly<Record<string, CreativeContext>>,
  opts: FinalizeOptions,
): FinalizeResult {
  const tone = opts.tone ?? 'warm';
  const sets: CreativeSet[] = [];
  let expected = 0;
  let passed = 0;

  for (const ctx of Object.values(ctxPerNta)) {
    const code = ctx.nta.code;
    const out: CreativeVariant[] = [];
    for (const slot of SLOTS) {
      expected++;
      let kept: CreativeVariant | null = null;
      let firstFailure: GroundingResult | null = null;
      for (const candidate of variants.filter((v) => v.nta === code && v.variant === slot).map(tidy)) {
        const grounding = validateVariant(candidate, ctx);
        if (grounding.ok) {
          kept = { ...candidate, grounding, source: 'model' };
          break;
        }
        firstFailure ??= grounding;
      }
      if (kept) {
        passed++;
        out.push(kept);
        continue;
      }
      const template = templateVariant(slot, ctx, tone);
      const own = validateVariant(template, ctx);
      out.push({
        ...template,
        source: 'template',
        grounding: {
          ok: own.ok,
          failed: [...(firstFailure?.failed ?? []), ...own.failed.map((f) => ({ rule: f.rule, detail: `template: ${f.detail}` }))],
          replacedByTemplate: true,
        },
      });
    }
    sets.push({ nta: code, variants: out, via: out.some((v) => v.source === 'model') ? opts.via : 'template' });
  }

  return { sets, expected, passed, failover: passed * 2 < expected };
}
