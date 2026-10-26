import 'server-only';
import ngeohash from 'ngeohash';
import type { z } from 'zod';
import type { Candidate, EntityType, HeatCell, HeatmapData } from '@/shared/types';
import { toEntityType, toQlooType } from './params';
import {
  DemographicsItemSchema,
  DemographicsResponseSchema,
  EntityInsightsResponseSchema,
  EntitySchema,
  ErrorBodySchema,
  HeatCellSchema,
  HeatmapResponseSchema,
  LocalitySchema,
  RootResponseSchema,
  SearchResponseSchema,
  TagInsightsResponseSchema,
  TagSchema,
} from './schemas';
import type { DemographicsEv, PlaceEv, PlaceTag, QlooIssue, RateInfo, RootInfo, TagEv } from './types';

/** Normalization outcome; `dropped` counts records skipped because they lacked essentials. */
export type Normalized<T> = { ok: true; value: T; dropped: number } | { ok: false; message: string };

type RawEntity = z.infer<typeof EntitySchema>;

const GEOHASH_RE = /^[0-9b-hjkmnp-z]{1,12}$/;
const YEAR_RE = /\b(1[89]\d{2}|20\d{2})\b/;

/** Zod issue paths and messages only — never values from the payload. */
function describe(error: z.ZodError): string {
  return error.issues
    .slice(0, 5)
    .map((i) => `${i.path.map(String).join('.') || '(root)'}: ${i.message}`)
    .join('; ');
}

function finite(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

function text(v: unknown): string | null {
  return typeof v === 'string' && v.trim() !== '' ? v.trim() : null;
}

function geohashFrom(loc: { geohash?: string | null; latitude?: number | null; longitude?: number | null; lat?: number | null; lon?: number | null } | null | undefined): string | null {
  if (!loc) return null;
  const gh = loc.geohash?.trim().toLowerCase();
  if (gh && GEOHASH_RE.test(gh)) return gh;
  const lat = finite(loc.latitude ?? loc.lat);
  const lon = finite(loc.longitude ?? loc.lon);
  // A cell without a geohash is placed at precision 7, the finest heatmap precision.
  return lat !== null && lon !== null ? ngeohash.encode(lat, lon, 7) : null;
}

// ---------------------------------------------------------------------------------------------
// Entities → Candidate
// ---------------------------------------------------------------------------------------------

const TYPE_LABEL: Record<EntityType, string> = {
  artist: 'Artist',
  book: 'Book',
  brand: 'Brand',
  movie: 'Film',
  person: 'Person',
  place: 'Place',
  podcast: 'Podcast',
  tv_show: 'TV show',
};

export function typeLabel(type: EntityType): string {
  return TYPE_LABEL[type];
}

function extractYear(props: Record<string, unknown> | null | undefined, disambiguation: string | null): number | null {
  for (const key of ['release_year', 'publication_year', 'year', 'release_date', 'publication_date']) {
    const v = props?.[key];
    if (typeof v === 'number' && v >= 1800 && v <= 2100) return Math.trunc(v);
    if (typeof v === 'string') {
      const m = YEAR_RE.exec(v);
      if (m?.[1]) return Number(m[1]);
    }
  }
  const m = disambiguation ? YEAR_RE.exec(disambiguation) : null;
  return m?.[1] ? Number(m[1]) : null;
}

/** "200 Eastern Pkwy, Brooklyn, NY 11238, USA" → "Brooklyn, NY". */
function shortAddress(address: unknown): string | null {
  if (typeof address !== 'string') return null;
  const parts = address
    .split(',')
    .map((p) => p.trim())
    .filter((p) => p && !/^(usa|us|united states)$/i.test(p));
  if (parts.length < 2) return parts[0] ?? null;
  const city = parts[parts.length - 2] ?? '';
  const state = (parts[parts.length - 1] ?? '').replace(/\s*\d{5}(-\d{4})?$/, '');
  return [city, state].filter(Boolean).join(', ') || null;
}

function pickType(raw: RawEntity, requested?: EntityType): EntityType | null {
  const urns = [raw.subtype, ...(raw.types ?? []), raw.type].filter(
    (u): u is string => typeof u === 'string' && u.startsWith('urn:entity:'),
  );
  if (requested && urns.includes(toQlooType(requested))) return requested;
  for (const u of urns) {
    const t = toEntityType(u);
    if (t) return t;
  }
  // Only a generic `urn:entity` (or nothing): trust the type we asked for.
  return urns.length === 0 ? (requested ?? null) : null;
}

function toCandidate(raw: RawEntity, requested?: EntityType): Candidate | null {
  const type = pickType(raw, requested);
  if (!type) return null;
  const qlooDisambiguation = text(raw.disambiguation);
  const year = extractYear(raw.properties, qlooDisambiguation);
  let disambiguation = qlooDisambiguation;
  if (disambiguation && year && !disambiguation.includes(String(year))) disambiguation = `${disambiguation} · ${year}`;
  if (!disambiguation) {
    const parts = [TYPE_LABEL[type]];
    if (year) parts.push(String(year));
    if (type === 'place') {
      const where = shortAddress(raw.properties?.address);
      if (where) parts.push(where);
    }
    disambiguation = parts.length > 1 ? parts.join(' · ') : null;
  }
  return { id: raw.entity_id, name: raw.name.trim(), type, disambiguation, popularity: finite(raw.popularity), year };
}

/** /search and /entities results (flat `results[]`, or nested `results.entities[]`). */
export function normalizeCandidates(json: unknown, requested?: EntityType): Normalized<Candidate[]> {
  const parsed = SearchResponseSchema.safeParse(json);
  if (!parsed.success) return { ok: false, message: `Unexpected search payload (${describe(parsed.error)})` };
  const rows = Array.isArray(parsed.data.results) ? parsed.data.results : parsed.data.results.entities;
  const out: Candidate[] = [];
  let invalid = 0;
  let dropped = 0;
  for (const row of rows) {
    const e = EntitySchema.safeParse(row);
    if (!e.success) {
      invalid++;
      continue;
    }
    // Entities of types we do not plan with (locality, videogame, …) are skipped, not errors.
    const c = toCandidate(e.data, requested);
    if (c) out.push(c);
    else dropped++;
  }
  if (rows.length > 0 && invalid === rows.length) {
    return { ok: false, message: 'Search results had no usable entities (missing entity_id or name)' };
  }
  return { ok: true, value: out, dropped: dropped + invalid };
}

// ---------------------------------------------------------------------------------------------
// Heatmap
// ---------------------------------------------------------------------------------------------

function firstLocality(filter: unknown): HeatmapData['locality'] {
  const list = Array.isArray(filter) ? filter : filter ? [filter] : [];
  for (const item of list) {
    const p = LocalitySchema.safeParse(item);
    if (!p.success) continue;
    const name = text(p.data.name);
    if (!name) continue;
    return { id: text(p.data.entity_id) ?? text(p.data.id) ?? '', name, disambiguation: text(p.data.disambiguation) };
  }
  return null;
}

export function normalizeHeatmap(json: unknown): Normalized<HeatmapData> {
  const parsed = HeatmapResponseSchema.safeParse(json);
  if (!parsed.success) return { ok: false, message: `Unexpected heatmap payload (${describe(parsed.error)})` };
  const rows = parsed.data.results.heatmap ?? [];
  const cells: HeatCell[] = [];
  const seen = new Set<string>();
  let dropped = 0;
  for (const row of rows) {
    const c = HeatCellSchema.safeParse(row);
    const gh = c.success ? geohashFrom(c.data.location) : null;
    if (!c.success || !gh || seen.has(gh)) {
      dropped++;
      continue;
    }
    seen.add(gh);
    const q = c.data.query;
    cells.push({ gh, aff: finite(q?.affinity), rank: finite(q?.affinity_rank), pop: finite(q?.popularity) });
  }
  if (rows.length > 0 && cells.length === 0) return { ok: false, message: 'Heatmap had no usable cells' };
  return { ok: true, value: { cells, locality: firstLocality(parsed.data.query?.localities?.filter) }, dropped };
}

// ---------------------------------------------------------------------------------------------
// Tags and places
// ---------------------------------------------------------------------------------------------

/** `urn:tag:cuisine:qloo` → `cuisine`; `urn:tag:genre:place` → `genre`. */
export function tagKind(typeOrId: string | null | undefined): string {
  if (!typeOrId) return 'unknown';
  const parts = typeOrId.split(':');
  return parts[0] === 'urn' && parts[1] === 'tag' && parts[2] ? parts[2] : 'unknown';
}

type RawTag = z.infer<typeof TagSchema>;

function toTag(row: unknown): PlaceTag | null {
  const p = TagSchema.safeParse(row);
  return p.success ? tagFrom(p.data) : null;
}

function tagFrom(t: RawTag): PlaceTag | null {
  const id = text(t.id) ?? text(t.tag_id) ?? (text(t.value)?.startsWith('urn:tag:') ? text(t.value) : null);
  const name = text(t.name) ?? (text(t.value) && !text(t.value)?.startsWith('urn:') ? text(t.value) : null);
  if (!id || !name) return null;
  const type = text(t.type) ?? text(t.subtype) ?? (id.startsWith('urn:tag:') ? id.split(':').slice(0, 4).join(':') : 'unknown');
  return { id, name, type, kind: tagKind(type !== 'unknown' ? type : id) };
}

function parseExplain(explainability: Record<string, unknown> | null | undefined): PlaceEv['explain'] {
  const list = explainability?.['signal.interests.entities'];
  if (!Array.isArray(list)) return [];
  const out: PlaceEv['explain'] = [];
  for (const item of list) {
    if (!item || typeof item !== 'object') continue;
    const rec = item as Record<string, unknown>;
    const anchorId = text(rec.entity_id);
    const score = finite(rec.score);
    if (anchorId && score !== null) out.push({ anchorId, score });
  }
  return out;
}

export function normalizePlaces(json: unknown): Normalized<PlaceEv[]> {
  const parsed = EntityInsightsResponseSchema.safeParse(json);
  if (!parsed.success) return { ok: false, message: `Unexpected place-insights payload (${describe(parsed.error)})` };
  const rows = parsed.data.results.entities ?? [];
  const out: PlaceEv[] = [];
  let dropped = 0;
  for (const row of rows) {
    const e = EntitySchema.safeParse(row);
    if (!e.success) {
      dropped++;
      continue;
    }
    const raw = e.data;
    const tags = (raw.tags ?? []).map(toTag).filter((t): t is PlaceTag => t !== null);
    out.push({
      id: raw.entity_id,
      name: raw.name.trim(),
      affinity: finite(raw.query?.affinity),
      popularity: finite(raw.popularity),
      tags,
      categories: [...new Set(tags.filter((t) => t.kind === 'category' || t.kind === 'genre').map((t) => t.name))],
      explain: parseExplain(raw.query?.explainability),
      geohash: geohashFrom(raw.location),
      priceLevel: finite(raw.properties?.price_level),
      rating: finite(raw.properties?.business_rating),
    });
  }
  if (rows.length > 0 && out.length === 0) return { ok: false, message: 'Place insights had no usable entities' };
  return { ok: true, value: out, dropped };
}

export function normalizeTags(json: unknown): Normalized<TagEv[]> {
  const parsed = TagInsightsResponseSchema.safeParse(json);
  if (!parsed.success) return { ok: false, message: `Unexpected tag-insights payload (${describe(parsed.error)})` };
  const rows = parsed.data.results.tags ?? [];
  const out: TagEv[] = [];
  let dropped = 0;
  for (const row of rows) {
    const p = TagSchema.safeParse(row);
    const tag = p.success ? tagFrom(p.data) : null;
    if (!p.success || !tag) {
      dropped++;
      continue;
    }
    out.push({ ...tag, affinity: finite(p.data.query?.affinity) ?? finite(p.data.affinity) });
  }
  if (rows.length > 0 && out.length === 0) return { ok: false, message: 'Tag insights had no usable tags' };
  return { ok: true, value: out, dropped };
}

export function normalizeDemographics(json: unknown): Normalized<DemographicsEv[]> {
  const parsed = DemographicsResponseSchema.safeParse(json);
  if (!parsed.success) return { ok: false, message: `Unexpected demographics payload (${describe(parsed.error)})` };
  const rows = parsed.data.results.demographics ?? [];
  const out: DemographicsEv[] = [];
  let dropped = 0;
  for (const row of rows) {
    const p = DemographicsItemSchema.safeParse(row);
    if (!p.success) {
      dropped++;
      continue;
    }
    const clean = (rec: Record<string, number | null | undefined> | null | undefined) =>
      Object.fromEntries(Object.entries(rec ?? {}).map(([k, v]) => [k, finite(v)]));
    out.push({ entityId: p.data.entity_id, age: clean(p.data.query?.age), gender: clean(p.data.query?.gender) });
  }
  return { ok: true, value: out, dropped };
}

export function normalizeRoot(json: unknown, rate: RateInfo): Normalized<RootInfo> {
  const r = RootResponseSchema.parse(json);
  return { ok: true, value: { name: text(r.name), version: text(r.version) ?? text(r.api_version), rate }, dropped: 0 };
}

// ---------------------------------------------------------------------------------------------
// Error bodies
// ---------------------------------------------------------------------------------------------

export interface ErrorDetails {
  messages: string[];
  issues: QlooIssue[];
  /** The 429 body's `error_msg` ("Rate limit exceeded"). */
  errorMsg: string | null;
}

export function errorDetails(json: unknown): ErrorDetails {
  if (typeof json === 'string') return { messages: json.trim() ? [json.trim().slice(0, 300)] : [], issues: [], errorMsg: null };
  const p = ErrorBodySchema.safeParse(json);
  if (!p.success) return { messages: [], issues: [], errorMsg: null };
  const d = p.data;
  const issues: QlooIssue[] = (d.errors ?? []).map((e) => ({
    message: (text(e.message) ?? 'Invalid request').slice(0, 300),
    path: Array.isArray(e.path) ? e.path.map(String).join('.') : text(e.path),
  }));
  const messages = [d.error_msg, d.message, d.detail, typeof d.error === 'string' ? d.error : d.error?.message]
    .map((m) => text(m)?.slice(0, 300) ?? null)
    .filter((m): m is string => m !== null)
    .concat(issues.map((i) => i.message));
  return { messages, issues, errorMsg: text(d.error_msg) };
}

/** 403 "You do not have permission to access urn:entity:…" → the URN (or 'unknown' when unnamed). */
export function unsupportedTypeFrom(messages: readonly string[]): string | null {
  for (const m of messages) {
    const hit = /permission to access (urn:entity:[a-z_]+)/i.exec(m);
    if (hit?.[1]) return hit[1].toLowerCase();
  }
  return messages.some((m) => /do not have permission/i.test(m)) ? 'unknown' : null;
}
