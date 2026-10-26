/**
 * Pure, client-safe helpers that turn a RunState into what the run screen shows. No React, no data files.
 */
import type {
  CopyRule,
  EntityType,
  NtaScore,
  ResultLabel,
  RunState,
  StageId,
  StageInfo,
  StageOperation,
  StageStatus,
} from '@/shared/types';
import type { RunTab, StationId, StationStatus } from './types';

// ---------------------------------------------------------------------------------------------
// Stations
// ---------------------------------------------------------------------------------------------

export const STATION_LABEL: Record<StationId, string> = {
  brief: 'Brief',
  taste: 'Taste',
  where: 'Where',
  what: 'What',
  plan: 'Plan',
  proof: 'Proof',
  send: 'Send',
};

/** One-line description of each station (titles, tooltips, screen-reader announcements). */
export const STATION_BLURB: Record<StationId, string> = {
  brief: 'Business, offer, budget and dates',
  taste: 'Taste anchors matched in Qloo',
  where: 'Where this taste over-indexes',
  what: 'An ad for each neighborhood',
  plan: 'Screens, spend and assumptions',
  proof: 'Compared with an AI that has no Qloo',
  send: 'Your booking package',
};

const STATION_STAGES: Record<StationId, StageId[]> = {
  brief: ['intake'],
  taste: ['plan', 'resolve'],
  where: ['where'],
  what: ['evidence', 'creative'],
  plan: ['optimize'],
  proof: ['proof'],
  send: ['finalize'],
};

export const STAGE_STATION: Record<StageId, StationId> = {
  intake: 'brief',
  plan: 'taste',
  resolve: 'taste',
  where: 'where',
  evidence: 'what',
  creative: 'what',
  optimize: 'plan',
  proof: 'proof',
  finalize: 'send',
};

export const STAGE_ORDER: StageId[] = ['intake', 'plan', 'resolve', 'where', 'evidence', 'creative', 'optimize', 'proof', 'finalize'];

const SETTLED: StageStatus[] = ['done', 'skipped', 'degraded'];

export function stationStatus(state: RunState | null, station: StationId): StationStatus {
  if (!state) return 'pending';
  const stages = state.stages.filter((s) => STATION_STAGES[station].includes(s.stage));
  if (stages.some((s) => s.status === 'error')) return 'error';
  if (stages.some((s) => s.status === 'needs_input')) return 'needs_input';
  if (stages.some((s) => s.status === 'running')) return 'active';
  if (stages.length === STATION_STAGES[station].length && stages.every((s) => SETTLED.includes(s.status))) {
    return stages.some((s) => s.status === 'degraded') ? 'degraded' : 'done';
  }
  if (stages.some((s) => SETTLED.includes(s.status))) return state.status === 'running' ? 'active' : 'done';
  if (stages.length === 0 && state.status === 'done') return 'done';
  return 'pending';
}

export function stationStatuses(state: RunState | null): Record<StationId, StationStatus> {
  return {
    brief: stationStatus(state, 'brief'),
    taste: stationStatus(state, 'taste'),
    where: stationStatus(state, 'where'),
    what: stationStatus(state, 'what'),
    plan: stationStatus(state, 'plan'),
    proof: stationStatus(state, 'proof'),
    send: stationStatus(state, 'send'),
  };
}

/** The station the agent is at now: the first one working or waiting, else the last one reached. */
export function currentStation(state: RunState | null): StationId {
  const statuses = stationStatuses(state);
  const order = Object.keys(statuses) as StationId[];
  const busy = order.find((s) => ['active', 'needs_input', 'error'].includes(statuses[s]));
  if (busy) return busy;
  const reached = order.filter((s) => statuses[s] !== 'pending');
  return reached[reached.length - 1] ?? 'brief';
}

export function stageFor(state: RunState | null, id: StageId): StageInfo | undefined {
  return state?.stages.find((s) => s.stage === id);
}

/** Whether a canvas view has data to show. */
export function tabReady(state: RunState | null, tab: RunTab): boolean {
  if (!state) return false;
  switch (tab) {
    case 'where':
      return state.where !== null;
    case 'what':
      return state.creative.length > 0 || state.evidence.length > 0;
    case 'plan':
      return state.plan !== null;
    case 'proof':
      return state.proof !== null;
    case 'send':
      return state.status === 'done' && (state.plan?.screens.length ?? 0) > 0;
  }
}

// ---------------------------------------------------------------------------------------------
// Lookups
// ---------------------------------------------------------------------------------------------

export function ntaMap(state: RunState | null): Map<string, NtaScore> {
  return new Map((state?.where?.ntas ?? []).map((n) => [n.code, n]));
}

/** Rank (1-based) of each neighborhood in the WHERE list. */
export function ntaRanks(state: RunState | null): Map<string, number> {
  return new Map((state?.where?.ntas ?? []).map((n, k) => [n.code, k + 1]));
}

/** Neighborhoods the run worked on (creative, evidence or plan), strongest first. */
export function planNeighborhoods(state: RunState | null): string[] {
  if (!state) return [];
  const codes = new Set<string>([
    ...state.creative.map((c) => c.nta),
    ...state.evidence.map((e) => e.nta),
    ...(state.plan?.byNta.map((b) => b.nta) ?? []),
  ]);
  const ranks = ntaRanks(state);
  return [...codes].sort((a, b) => (ranks.get(a) ?? 999) - (ranks.get(b) ?? 999));
}

/** Short display name for a neighborhood code, falling back to evidence packs and the code itself. */
export function ntaShort(state: RunState | null, code: string): string {
  return ntaMap(state).get(code)?.short ?? state?.evidence.find((e) => e.nta === code)?.shortName ?? code;
}

// ---------------------------------------------------------------------------------------------
// Formatting (fixed locale and time zone so server and client render identical text)
// ---------------------------------------------------------------------------------------------

const intFmt = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });
const usdFmt = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
const compactFmt = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 });

export const fmtInt = (n: number) => intFmt.format(n);
export const fmtUsd = (n: number) => usdFmt.format(n);
export const fmtCompact = (n: number) => compactFmt.format(n);
export const fmtPct = (share: number) => `${Math.round(share * 100)}%`;

/** 2.62 → "2.6×". */
export const fmtMultiplier = (m: number) => `${m.toFixed(1)}×`;

export function ordinal(n: number): string {
  const v = n % 100;
  if (v >= 11 && v <= 13) return `${n}th`;
  const last = n % 10;
  return `${n}${last === 1 ? 'st' : last === 2 ? 'nd' : last === 3 ? 'rd' : 'th'}`;
}

export function fmtMs(ms: number | null): string {
  if (ms === null) return '';
  return ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(1)} s`;
}

const dayFmt = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
const dateTimeFmt = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
  timeZone: 'America/New_York',
  timeZoneName: 'short',
});
const dateFmt = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'America/New_York' });

/** "2026-11-16" + 3 weeks → "Nov 16 – Dec 6". */
export function fmtDateRange(startDate: string | null, weeks: number): string | null {
  if (!startDate || !/^\d{4}-\d{2}-\d{2}$/.test(startDate)) return null;
  const start = new Date(`${startDate}T00:00:00Z`);
  if (Number.isNaN(start.getTime())) return null;
  const end = new Date(start.getTime() + (weeks * 7 - 1) * 86_400_000);
  return `${dayFmt.format(start)} – ${dayFmt.format(end)}`;
}

export function fmtDateTime(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : dateTimeFmt.format(d);
}

export function fmtDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : dateFmt.format(d);
}

// ---------------------------------------------------------------------------------------------
// Labels and vocabulary
// ---------------------------------------------------------------------------------------------

export const ENTITY_LABEL: Record<EntityType, string> = {
  artist: 'Artist',
  book: 'Book',
  brand: 'Brand',
  movie: 'Film',
  person: 'Person',
  place: 'Place',
  podcast: 'Podcast',
  tv_show: 'TV show',
};

export const CONFIDENCE_LABEL = { high: 'High confidence', medium: 'Medium confidence', low: 'Low confidence' } as const;

export const COPY_RULES: { rule: CopyRule; label: string }[] = [
  { rule: 'length', label: 'Length limits' },
  { rule: 'emoji', label: 'No emoji' },
  { rule: 'refs', label: 'Every local reference has evidence' },
  { rule: 'foreign_local', label: 'No other neighborhood named' },
  { rule: 'ungrounded_proper_noun', label: 'No unknown names' },
  { rule: 'sensitive', label: 'No sensitive or demographic terms' },
  { rule: 'invented_number', label: 'No invented numbers' },
  { rule: 'missing_business', label: 'Business named' },
];

export const OPERATION_LABEL: Record<StageOperation, string> = {
  resolve_anchors: 'Match anchors',
  map_taste_lift: 'Map taste lift',
  neighborhood_evidence: 'Neighborhood evidence',
};

/** "urn:tag:time_of_day_fit:qloo" → "Time of day". */
export function tagTypeLabel(tagType: string): string {
  const key = tagType.replace(/^urn:tag:/, '').split(':')[0] ?? '';
  const known: Record<string, string> = {
    genre: 'Genre',
    category: 'Category',
    cuisine: 'Cuisine',
    ambience: 'Ambience',
    good_for: 'Good for',
    visit_intent: 'Visit intent',
    time_of_day_fit: 'Time of day',
    decor: 'Decor',
    setting: 'Setting',
    menu_highlight: 'Menu',
    beverage_offering: 'Drinks',
    neighborhood_characteristic: 'Neighborhood',
  };
  return known[key] ?? key.replace(/_/g, ' ');
}

export type BadgeKind = 'live' | 'cached' | 'recorded' | 'template' | 'assumption' | 'synthetic' | 'qloo_only';

/** Badge explanations from PRODUCT §3 (tooltips, the labels table on /how-it-works). */
export function badgeExplanation(kind: BadgeKind, detail?: string | null): string {
  switch (kind) {
    case 'live':
      return 'Computed just now: Qloo and the AI model were called for this run.';
    case 'cached':
      return `The saved plan for this exact brief${detail ? `, made ${detail}` : ''}: shown again as it was, without new Qloo or AI calls.`;
    case 'recorded':
      return `A real live run recorded ${detail ?? 'earlier'}, replayed exactly. Press Run live to redo it.`;
    case 'template':
      return 'AI writers were busy, so this copy was assembled by rules from the same Qloo evidence.';
    case 'assumption':
      return 'Not data. A labelled estimate you can change.';
    case 'synthetic':
      return 'Demo data generated locally; not Qloo data (only before the Qloo key is active).';
    case 'qloo_only':
      return detail ?? 'AI writers were busy, so rules and templates built this from Qloo evidence only.';
  }
}

/** Run-level badge for a result label (null while a run has not finished). */
export function badgeForLabel(label: ResultLabel | null, mode?: 'live' | 'mock'): { kind: BadgeKind; detail: string | null } | null {
  if (!label) return mode === 'mock' ? { kind: 'synthetic', detail: null } : null;
  switch (label.kind) {
    case 'live':
      return { kind: 'live', detail: label.model };
    case 'cached':
      return { kind: 'cached', detail: fmtDateTime(label.at) };
    case 'recorded':
      return { kind: 'recorded', detail: fmtDate(label.at) };
    case 'qloo_only':
      return { kind: 'qloo_only', detail: label.reason };
    case 'synthetic':
      return { kind: 'synthetic', detail: null };
  }
}

/** The headline the LED ticker shows for the run's current state. */
export function tickerHeadline(state: RunState | null, progress: string | null): { text: string; tone: 'amber' | 'danger' } {
  if (!state) return { text: progress ?? 'Starting the agent', tone: 'amber' };
  if (state.status === 'error') return { text: 'Stopped. Your brief is saved', tone: 'danger' };
  if (state.status === 'awaiting_input') return { text: 'One quick check before the map', tone: 'amber' };
  if (state.status === 'done' && state.plan && !state.plan.infeasibleReason) {
    const n = state.plan.byNta.length;
    return {
      text: `Plan ready · ${state.plan.totals.screens} screens · ${n} neighborhood${n === 1 ? '' : 's'} · ${fmtUsd(state.plan.totals.spend)}`,
      tone: 'amber',
    };
  }
  if (state.status === 'done') return { text: 'Plan ready', tone: 'amber' };
  const running = state.stages.find((s) => s.status === 'running');
  return { text: progress ?? running?.title ?? 'Working', tone: 'amber' };
}

// ---------------------------------------------------------------------------------------------
// Heat colors (the map's viridis stops, so list swatches match the map)
// ---------------------------------------------------------------------------------------------

const HEAT_STOPS: [m: number, rgb: [number, number, number]][] = [
  [1, [0x3b, 0x52, 0x8b]],
  [1.6, [0x21, 0x91, 0x8c]],
  [2.3, [0x5e, 0xc9, 0x62]],
  [3, [0xfd, 0xe7, 0x25]],
];

/** Display color for a taste multiplier; null below the NYC baseline (the map leaves those clear). */
export function heatColor(m: number): string | null {
  if (!(m >= 1)) return null;
  const top = HEAT_STOPS[HEAT_STOPS.length - 1]!;
  if (m >= top[0]) return `rgb(${top[1].join(' ')})`;
  for (let k = 1; k < HEAT_STOPS.length; k++) {
    const [m1, c1] = HEAT_STOPS[k]!;
    const [m0, c0] = HEAT_STOPS[k - 1]!;
    if (m <= m1) {
      const t = (m - m0) / (m1 - m0);
      const c = c0.map((v, i) => Math.round(v + (c1[i]! - v) * t));
      return `rgb(${c.join(' ')})`;
    }
  }
  return `rgb(${top[1].join(' ')})`;
}

/** CSS gradient for the legend, positioned linearly from 1× to 3×. */
export const HEAT_GRADIENT = `linear-gradient(90deg, #3b528b 0%, #21918c 30%, #5ec962 65%, #fde725 100%)`;
