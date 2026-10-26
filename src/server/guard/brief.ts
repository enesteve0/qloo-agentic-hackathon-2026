import 'server-only';
import { z } from 'zod';
import type { Brief } from '@/shared/types';

/** Strips contact details and links before a brief reaches any model (the brief never goes to Qloo). */
export function sanitizeText(input: string): string {
  return input
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, '[email removed]')
    .replace(/https?:\/\/\S+|www\.\S+/gi, '[link removed]')
    .replace(/(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}/g, '[phone removed]')
    .replace(/\s+/g, ' ')
    .trim();
}

const text = (max: number) =>
  z
    .string()
    .max(max * 2)
    .transform((s) => sanitizeText(s).slice(0, max));

export const briefSchema = z.object({
  business: text(80).pipe(z.string().min(2, 'Tell us the business name')),
  description: text(600).pipe(z.string().min(12, 'Describe the business in a sentence or two')),
  offer: text(120)
    .nullable()
    .optional()
    .transform((v) => (v ? v : null)),
  budgetUsd: z.coerce.number().int().min(100).max(100_000),
  weeks: z.coerce.number().int().min(1).max(8),
  startDate: z.iso
    .date()
    .nullable()
    .optional()
    .transform((v) => v ?? null),
  address: text(120)
    .nullable()
    .optional()
    .transform((v) => (v ? v : null)),
});

export function parseBrief(input: unknown): { ok: true; brief: Brief } | { ok: false; errors: string[] } {
  const r = briefSchema.safeParse(input);
  if (r.success) return { ok: true, brief: r.data };
  return { ok: false, errors: r.error.issues.map((i) => `${i.path.join('.') || 'brief'}: ${i.message}`) };
}

/**
 * Normalized brief hash for single-flight and identical-brief caching. Everything a plan shows is part of
 * it (dates and address appear in mockups and the booking email), and so is the data mode: a synthetic
 * plan is never served as a cached live one.
 */
export async function briefHash(brief: Brief, mode: 'live' | 'mock'): Promise<string> {
  const fold = (s: string | null) => s?.normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim() ?? null;
  const norm = JSON.stringify({
    m: mode,
    b: fold(brief.business),
    d: fold(brief.description),
    o: fold(brief.offer),
    u: brief.budgetUsd,
    w: brief.weeks,
    s: brief.startDate,
    a: fold(brief.address),
  });
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(norm));
  return Buffer.from(digest).toString('hex').slice(0, 32);
}

export type RestrictedCategory = 'political' | 'housing' | 'employment' | 'credit' | 'health' | 'tobacco' | 'weapons' | 'adult' | 'gambling';

/**
 * Categories Stoop does not plan. Choosing neighborhoods by taste can exclude people along lines the
 * law protects (housing, jobs, credit) or needs disclosures (political); the rest are common street-
 * furniture exclusions. Matching is deliberately narrow: a bakery's "sweet treats" or a bar's "happy
 * hour" must still pass.
 */
const RESTRICTED: [RestrictedCategory, RegExp][] = [
  // "Vote for Dana Lee" is political; "vote for your favorite flavor" is not (case-sensitive name check).
  ['political', /\b[Vv]ot(?:e|ing) for (?:[A-Z][a-z]+|Prop(?:osition)?\b)/],
  ['political', /\b(?:vote (?:yes|no) on|re-?elect|election|candidates? for|ballot (?:measures?|questions?|proposals?)|city council|mayoral|for mayor|senator|congress(?:man|woman|member)|assembly ?member|super ?PAC|political (?:campaigns?|ads?|party|parties|action)|campaign for (?:office|mayor|council|senate|congress|governor|president)|referendum)\b/i],
  ['housing', /\b(?:apartments? for (?:rent|sale)|homes? for (?:rent|sale)|condos? for sale|for rent by owner|real estate|realtors?|rental listings?|leasing office|landlords?|tenants? wanted)\b/i],
  ['employment', /\b(?:(?:we(?:'|’)?re|now|is|are) hiring|hiring (?:events?|fairs?|days?)|job (?:openings?|fairs?|postings?|listings?|applications?)|career fairs?|staffing agency|apply for (?:a |the )?jobs?)\b/i],
  ['credit', /\b(?:(?:personal|payday|car|auto|student|business|small[- ]business|home|cash|title|installment) loans?|loans? (?:approved|available|with no)|credit cards?|cash advances?|mortgages?|refinanc(?:e|ing)|credit repair|financing available|0% (?:apr|financing)|buy now,? pay later|bnpl)\b/i],
  ['health', /\b(?:cures? (?:for|your|you|anxiety|pain|depression|insomnia|cancer|diabetes|disease|illness)|treatment for|weight[- ]loss|lose weight|diet pills?|dietary supplements?|prescriptions?|medical (?:cannabis|marijuana)|cbd|detox(?:ify)? your|anti[- ]aging|clinically proven)\b/i],
  ['tobacco', /\b(?:tobacco|vapes?|vaping|e-?cig(?:arette)?s?|cigarettes?|hookah)\b/i],
  ['weapons', /\b(?:firearms?|gun (?:shops?|stores?|ranges?|shows?)|handguns?|ammo|ammunition|rifles?|pistols?)\b/i],
  ['adult', /\b(?:adult entertainment|strip clubs?|escort services?|xxx|sex shops?)\b/i],
  ['gambling', /\b(?:casinos?|sports ?betting|sportsbooks?|online gambling|gambling|slot machines?)\b/i],
];

const RESTRICTED_MESSAGE: Record<RestrictedCategory, string> = {
  political: 'Stoop doesn’t plan political ads.',
  housing: 'Stoop doesn’t plan housing or real-estate ads, because choosing neighborhoods by taste could exclude people in ways fair-housing law protects against.',
  employment: 'Stoop doesn’t plan job or hiring ads, because choosing neighborhoods by taste could exclude people in ways employment law protects against.',
  credit: 'Stoop doesn’t plan loan, credit or financing ads, because choosing neighborhoods by taste could exclude people in ways fair-lending law protects against.',
  health: 'Stoop doesn’t plan ads that make health claims.',
  tobacco: 'Stoop doesn’t plan tobacco or vaping ads.',
  weapons: 'Stoop doesn’t plan ads for weapons.',
  adult: 'Stoop doesn’t plan adult-entertainment ads.',
  gambling: 'Stoop doesn’t plan gambling ads.',
};

/** The first restricted category a brief falls into, with a plain explanation; null when it can be planned. */
export function restrictedCategory(brief: Pick<Brief, 'business' | 'description' | 'offer'>): { category: RestrictedCategory; message: string } | null {
  const text = `${brief.business}\n${brief.description}\n${brief.offer ?? ''}`;
  for (const [category, re] of RESTRICTED) if (re.test(text)) return { category, message: RESTRICTED_MESSAGE[category] };
  return null;
}
