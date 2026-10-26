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

/** Normalized brief hash for single-flight and identical-brief caching. */
export async function briefHash(brief: Brief): Promise<string> {
  const norm = JSON.stringify({
    b: brief.business.normalize('NFKC').toLowerCase(),
    d: brief.description.normalize('NFKC').toLowerCase(),
    o: brief.offer?.normalize('NFKC').toLowerCase() ?? null,
    u: brief.budgetUsd,
    w: brief.weeks,
  });
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(norm));
  return Buffer.from(digest).toString('hex').slice(0, 32);
}
