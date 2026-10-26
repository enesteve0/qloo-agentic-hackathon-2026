import 'server-only';
import type { Brief, CreativeSet, Kiosk, MediaPlan, PlannedScreen } from '@/shared/types';
import { formatUsd, formatWeeks } from './format';

/**
 * Exports for the SEND station: a CSV screen list and an editable booking-email draft. Both carry
 * derived plan data only: no Qloo IDs, scores, evidence or place names. The CSV's fit index is our
 * own 0–100 percentile; the email carries no taste data at all.
 */

export const PLAN_DISCLAIMER =
  'Illustrative plan. Prices and impressions are assumptions. Not affiliated with LinkNYC, Intersection or CityBridge.';

export const CSV_COLUMNS = [
  'siteId',
  'address',
  'cross streets',
  'borough',
  'neighborhood (2020 NTA name)',
  'kiosk type',
  'weeks',
  'est. weekly impressions (ASSUMPTION)',
  'est. cost (ASSUMPTION)',
  'fit index',
  'ad variant',
] as const;

export const DRAFT_MARKER = 'Draft — review before sending';

/** Keep the mailto link short enough for common mail clients; the full text stays in `body`. */
const MAILTO_MAX = 1900;

type Cell = string | number | null | undefined;

/** RFC 4180 field; text starting with = + - @ is prefixed with ' so spreadsheets never run it. */
function csvField(value: Cell): string {
  if (value === null || value === undefined) return '';
  let s = String(value);
  if (typeof value === 'string' && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function crossStreets(k: Kiosk | undefined): string {
  return [k?.cross1, k?.cross2].filter((s): s is string => !!s && s.trim() !== '').map((s) => s.trim()).join(' & ');
}

function creativeMap(creative?: Readonly<Record<string, CreativeSet>> | readonly CreativeSet[]): Map<string, CreativeSet> {
  if (!creative) return new Map();
  const sets = Array.isArray(creative) ? (creative as readonly CreativeSet[]) : Object.values(creative as Record<string, CreativeSet>);
  return new Map(sets.map((s) => [s.nta, s]));
}

/**
 * The plan as CSV: header rows with the disclaimer and every assumption, a blank row, then one row
 * per screen. Screens in a neighborhood alternate its variants (A, B, A, …) so the two ads can be
 * compared, e.g. by offer code. Lines end with CRLF (RFC 4180).
 */
export function planToCsv(
  plan: MediaPlan,
  kiosks: readonly Kiosk[],
  ntaNames: Readonly<Record<string, string>>,
  creativeByNta?: Readonly<Record<string, CreativeSet>> | readonly CreativeSet[],
): string {
  const byIndex = new Map(kiosks.map((k) => [k.i, k]));
  const creative = creativeMap(creativeByNta);
  const a = plan.assumptions;
  const rows: Cell[][] = [
    ['Stoop media plan', PLAN_DISCLAIMER],
    ['ASSUMPTION: price per screen-week, Manhattan (USD)', a.pricePerKioskWeek.manhattan],
    ['ASSUMPTION: price per screen-week, other boroughs (USD)', a.pricePerKioskWeek.outer],
    ['ASSUMPTION: impressions per screen-week, Manhattan', a.impressionsPerKioskWeek.manhattan],
    ['ASSUMPTION: impressions per screen-week, other boroughs', a.impressionsPerKioskWeek.outer],
    ['Budget (USD)', plan.budgetUsd],
    ['Weeks', plan.weeks],
    ['Screens', plan.totals.screens],
    ['Est. spend (USD, ASSUMPTION)', plan.totals.spend],
    ['Leftover (USD)', plan.leftoverUsd],
  ];
  if (plan.infeasibleReason) rows.push(['Note', plan.infeasibleReason]);
  rows.push([], [...CSV_COLUMNS]);

  const seenPerNta = new Map<string, number>();
  for (const s of plan.screens) {
    const k = byIndex.get(s.i);
    const n = seenPerNta.get(s.nta) ?? 0;
    seenPerNta.set(s.nta, n + 1);
    const variants = [...(creative.get(s.nta)?.variants ?? [])].sort((x, y) => (x.variant < y.variant ? -1 : x.variant > y.variant ? 1 : 0));
    const v = variants.length > 0 ? variants[n % variants.length] : undefined;
    rows.push([
      s.siteId,
      k?.address ?? '',
      crossStreets(k),
      k?.boro ?? '',
      ntaNames[s.nta] ?? s.nta,
      k?.type ?? '',
      plan.weeks,
      s.weeklyImpressions,
      s.cost,
      Math.round(s.fit),
      v ? `${v.variant}: ${v.headline}` : '',
    ]);
  }
  return `${rows.map((r) => r.map(csvField).join(',')).join('\r\n')}\r\n`;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "Nov 16 – Dec 6, 2026" for an ISO start date and a length in weeks; null for a missing/invalid date. */
function dateRange(startDate: string | null, weeks: number): string | null {
  const m = startDate ? /^(\d{4})-(\d{2})-(\d{2})/.exec(startDate) : null;
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]) - 1, Number(m[3])];
  const start = new Date(Date.UTC(y, mo, d));
  if (start.getUTCFullYear() !== y || start.getUTCMonth() !== mo || start.getUTCDate() !== d) return null;
  const days = Math.max(1, Math.round(weeks * 7));
  const end = new Date(start.getTime() + (days - 1) * 86_400_000);
  const fmt = (x: Date, withYear: boolean) => `${MONTHS[x.getUTCMonth()]} ${x.getUTCDate()}${withYear ? `, ${x.getUTCFullYear()}` : ''}`;
  return `${fmt(start, start.getUTCFullYear() !== end.getUTCFullYear())} – ${fmt(end, true)}`;
}

function screenLine(n: number, s: PlannedScreen, k: Kiosk | undefined, ntaNames: Readonly<Record<string, string>>): string {
  const cross = crossStreets(k);
  const where = [ntaNames[s.nta] ?? s.nta, k?.boro].filter(Boolean).join(', ');
  return `${n + 1}. ${s.siteId}: ${k?.address ?? 'address on file'}${cross ? ` (${cross})` : ''}, ${where}`;
}

function mailtoLink(subject: string, body: string): string {
  return `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body.replace(/\r?\n/g, '\r\n'))}`;
}

/**
 * A polite booking request to a screen seller listing the chosen screens, dates and budget. It is
 * a draft for the owner to review and send: nothing is sent automatically, and it contains no Qloo
 * data, fit scores or evidence. `mailto` may shorten the screen list to stay link-safe.
 */
export function bookingEmailDraft(
  plan: MediaPlan,
  brief: Brief,
  kiosks: readonly Kiosk[],
  ntaNames: Readonly<Record<string, string>>,
): { subject: string; body: string; mailto: string } {
  const byIndex = new Map(kiosks.map((k) => [k.i, k]));
  const business = brief.business.replace(/\s+/g, ' ').trim() || 'my business';
  const range = dateRange(brief.startDate, plan.weeks);
  const length = formatWeeks(plan.weeks);
  const lines = plan.screens.map((s, n) => screenLine(n, s, byIndex.get(s.i), ntaNames));
  const count = plan.screens.length;
  const subject = `Screen booking request: ${business}${range ? `, ${range}` : ''}`;

  const compose = (shown: readonly string[], omitted: number): string =>
    [
      DRAFT_MARKER,
      '',
      'Hello,',
      '',
      count > 0
        ? `I would like to book advertising on ${count} street screen${count === 1 ? '' : 's'} in New York City for ${business}.`
        : `I would like to book advertising on street screens in New York City for ${business}.`,
      '',
      `Dates: ${range ? `${range} (${length})` : `${length}, flexible start date`}`,
      `Budget: up to ${formatUsd(plan.budgetUsd)} in total`,
      '',
      count > 0 ? 'Screens:' : 'Screens: none selected yet.',
      ...shown,
      ...(omitted > 0 ? [`...and ${omitted} more screen${omitted === 1 ? '' : 's'} (full list in the attached CSV).`] : []),
      '',
      'Could you confirm availability and pricing for these screens and dates, and send your creative specifications? If a screen is unavailable, a nearby screen in the same neighborhood would work too.',
      '',
      'Thank you,',
      business,
    ].join('\n');

  const body = compose(lines, 0);
  let mailto = mailtoLink(subject, body);
  for (let keep = lines.length - 1; keep >= 0 && mailto.length > MAILTO_MAX; keep--) {
    mailto = mailtoLink(subject, compose(lines.slice(0, keep), lines.length - keep));
  }
  return { subject, body, mailto };
}
