/**
 * OSM extraction for the validation backtest (docs/ARCHITECTURE.md §18).
 *
 *   pnpm backtest:osm
 *
 * 1. Re-checks every panel QID against Wikidata (cached in data/raw/wikidata/<QID>.json); a brand that fails is
 *    skipped and listed in targets.json as unverified.
 * 2. One Overpass query per verified brand (`nwr["brand:wikidata"=<QID>](area NYC); out center;`) plus one
 *    commercial-POI density query, cached in data/raw/osm/<name>.json. A cached response is reused as long as
 *    it was fetched with the same query (data/raw/osm/index.json).
 * 3. Builds data/raw/osm/targets.json (targets.ts) and prints per-brand counts.
 *
 * Requests go one at a time, at least 2 s apart, with a descriptive User-Agent; 429/502/503/504, network
 * errors and Overpass runtime errors (reported with HTTP 200 in `remark`) back off exponentially. data/raw/ is
 * git-ignored: OSM data is never committed. Overrides: OVERPASS_URL, OVERPASS_USER_AGENT.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { BRANDS, checkWikidata, type BacktestBrand } from './brands';
import { buildTargets, parseNtaGeoJson, type OverpassResponse, type TargetsFile } from './targets';

const ROOT = path.resolve(import.meta.dirname, '../..');
const RAW = path.join(ROOT, 'data/raw');
const OSM_DIR = path.join(RAW, 'osm');
const WIKIDATA_DIR = path.join(RAW, 'wikidata');
const INDEX_FILE = path.join(OSM_DIR, 'index.json');
const TARGETS_FILE = path.join(OSM_DIR, 'targets.json');
const NTA_FILE = path.join(RAW, 'nta2020.geojson');

const OVERPASS_URL = process.env.OVERPASS_URL ?? 'https://overpass-api.de/api/interpreter';
const USER_AGENT = process.env.OVERPASS_USER_AGENT ?? 'stoop-backtest/0.1 (Qloo hackathon research; github.com/enesteve0)';
/** Minimum pause between the end of one request and the start of the next. */
const GAP_MS = { overpass: 2_000, wikidata: 1_000 } as const;
const BACKOFF_MS = [15_000, 30_000, 60_000, 120_000, 240_000];
const RETRY_STATUS = new Set([429, 502, 503, 504]);

/** Brand query, exactly as specified in ARCHITECTURE §18. */
function brandQuery(qid: string): string {
  if (!/^Q\d+$/.test(qid)) throw new Error(`Not a QID: ${qid}`);
  return `[out:json][timeout:90]; area["wikidata"="Q60"]->.nyc; nwr["brand:wikidata"="${qid}"](area.nyc); out center;`;
}

/** Commercial POI density: food and drink amenities plus every shop, as nodes and ways with centres. */
const POI_QUERY =
  '[out:json][timeout:180]; area["wikidata"="Q60"]->.nyc; ' +
  '(nw["amenity"~"^(restaurant|cafe|fast_food|bar|pub)$"](area.nyc); nw["shop"](area.nyc);); out center;';

class Fatal extends Error {}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const lastDone: Record<keyof typeof GAP_MS, number> = { overpass: 0, wikidata: 0 };

/** One polite request: paced, retried with exponential backoff on overload; returns the body text. */
async function politeRequest(
  host: keyof typeof GAP_MS,
  label: string,
  url: string,
  init: RequestInit,
  timeoutMs: number,
  validate: (text: string) => string | null,
): Promise<string> {
  for (let attempt = 0; ; attempt++) {
    const wait = lastDone[host] + GAP_MS[host] - Date.now();
    if (wait > 0) await sleep(wait);
    let problem: string;
    let retryAfterMs = 0;
    try {
      const res = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
      const text = await res.text();
      if (res.ok) {
        const invalid = validate(text);
        if (invalid === null) return text;
        problem = invalid;
      } else {
        if (!RETRY_STATUS.has(res.status)) throw new Fatal(`${label}: HTTP ${res.status} ${text.slice(0, 300)}`);
        problem = `HTTP ${res.status}`;
        retryAfterMs = (Number(res.headers.get('retry-after')) || 0) * 1000;
      }
    } catch (e) {
      if (e instanceof Fatal) throw e;
      problem = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
    } finally {
      lastDone[host] = Date.now();
    }
    const backoff = BACKOFF_MS[attempt];
    if (backoff === undefined) throw new Fatal(`${label}: gave up after ${attempt + 1} attempts (${problem})`);
    const delay = Math.max(backoff, retryAfterMs);
    console.log(`  ${label}: ${problem}; retrying in ${Math.round(delay / 1000)} s`);
    await sleep(delay);
  }
}

/** Accepts a complete Overpass JSON response; a runtime error in `remark` (partial result) is retried. */
function overpassProblem(text: string): string | null {
  let json: Partial<OverpassResponse>;
  try {
    json = JSON.parse(text) as Partial<OverpassResponse>;
  } catch {
    return 'response is not JSON';
  }
  if (!Array.isArray(json.elements)) return 'response has no elements';
  if (json.remark && /error|timed out|out of memory/i.test(json.remark)) return `Overpass: ${json.remark.slice(0, 160)}`;
  return null;
}

function jsonProblem(text: string): string | null {
  try {
    JSON.parse(text);
    return null;
  } catch {
    return 'response is not JSON';
  }
}

function writeAtomic(file: string, text: string): void {
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, text);
  renameSync(tmp, file);
}

interface IndexEntry {
  query: string;
  fetchedAt: string;
  osmBase: string | null;
  elements: number;
}

function readIndex(): Record<string, IndexEntry> {
  if (!existsSync(INDEX_FILE)) return {};
  return JSON.parse(readFileSync(INDEX_FILE, 'utf8')) as Record<string, IndexEntry>;
}

/** Cached Overpass response for `name`, fetched only when missing or fetched with a different query. */
async function overpass(name: string, query: string, timeoutMs: number, index: Record<string, IndexEntry>): Promise<OverpassResponse> {
  const file = path.join(OSM_DIR, `${name}.json`);
  if (existsSync(file) && index[name]?.query === query) {
    return JSON.parse(readFileSync(file, 'utf8')) as OverpassResponse;
  }
  const started = Date.now();
  const text = await politeRequest(
    'overpass',
    name,
    OVERPASS_URL,
    {
      method: 'POST',
      headers: { 'User-Agent': USER_AGENT, Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `data=${encodeURIComponent(query)}`,
    },
    timeoutMs,
    overpassProblem,
  );
  const json = JSON.parse(text) as OverpassResponse;
  writeAtomic(file, text);
  index[name] = { query, fetchedAt: new Date().toISOString(), osmBase: json.osm3s?.timestamp_osm_base ?? null, elements: json.elements.length };
  writeAtomic(INDEX_FILE, `${JSON.stringify(index, null, 2)}\n`);
  console.log(`  ${name}: ${json.elements.length} elements in ${((Date.now() - started) / 1000).toFixed(1)} s (OSM base ${index[name]!.osmBase ?? 'n/a'})`);
  return json;
}

/** Wikidata EntityData for a QID (cached); an unknown QID (HTTP 404) comes back as an empty entity set. */
async function wikidata(qid: string): Promise<unknown> {
  const file = path.join(WIKIDATA_DIR, `${qid}.json`);
  if (existsSync(file)) return JSON.parse(readFileSync(file, 'utf8')) as unknown;
  let text: string;
  try {
    text = await politeRequest(
      'wikidata',
      `wikidata ${qid}`,
      `https://www.wikidata.org/wiki/Special:EntityData/${qid}.json`,
      { headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' } },
      30_000,
      jsonProblem,
    );
  } catch (e) {
    if (e instanceof Fatal && / HTTP 404 /.test(e.message)) return { entities: {} };
    throw e;
  }
  writeAtomic(file, text);
  return JSON.parse(text) as unknown;
}

async function main(): Promise<void> {
  mkdirSync(OSM_DIR, { recursive: true });
  mkdirSync(WIKIDATA_DIR, { recursive: true });
  if (!existsSync(NTA_FILE)) throw new Fatal(`${path.relative(ROOT, NTA_FILE)} is missing (see data/README.md).`);

  console.log(`Stoop · backtest OSM extraction (${OVERPASS_URL})\n\n1. Wikidata check`);
  const verified: BacktestBrand[] = [];
  const unverified: NonNullable<TargetsFile['unverified']> = [];
  for (const b of BRANDS) {
    const check = checkWikidata(b, await wikidata(b.qid));
    if (check.ok) verified.push(b);
    else {
      unverified.push({ id: b.id, name: b.name, qid: b.qid, reason: check.reason });
      console.log(`  ✗ ${b.name} (${b.qid}): ${check.reason} — skipped`);
    }
  }
  console.log(`  ${verified.length} of ${BRANDS.length} QIDs verified`);

  console.log('\n2. Overpass (cached responses are reused)');
  const index = readIndex();
  const responses: { brand: BacktestBrand; response: OverpassResponse }[] = [];
  for (const b of verified) responses.push({ brand: b, response: await overpass(b.id, brandQuery(b.qid), 150_000, index) });
  const poi = await overpass('poi-density', POI_QUERY, 300_000, index);

  console.log('\n3. Targets');
  const areas = parseNtaGeoJson(JSON.parse(readFileSync(NTA_FILE, 'utf8')) as unknown);
  const targets: TargetsFile = { ...buildTargets({ areas, poi, brands: responses, builtAt: new Date().toISOString() }), unverified };
  writeAtomic(TARGETS_FILE, `${JSON.stringify(targets)}\n`);

  const p = targets.poi;
  console.log(
    `  POIs: ${p.elements} elements, ${p.active} active; ${p.residential} in residential NTAs, ${p.nonResidential} in ` +
      `non-residential NTAs, ${p.outside} outside every NTA (OSM base ${p.osmBase ?? 'n/a'})\n`,
  );
  const pad = (s: string | number, n: number) => String(s).padStart(n);
  const num = (x: number | null) => (x === null ? '-' : x.toFixed(2));
  console.log(
    `  ${'brand'.padEnd(24)} ${'QID'.padEnd(11)} ${pad('elem', 5)} ${pad('active', 6)} ${pad('merged', 6)} ${pad('stores', 6)} ` +
      `${pad('resid', 5)} ${pad('nonres', 6)} ${pad('out', 4)} ${pad('a(MoM)', 7)} ${pad('a', 5)}  status`,
  );
  for (const t of targets.brands) {
    const c = t.counts;
    console.log(
      `  ${t.name.padEnd(24)} ${t.qid.padEnd(11)} ${pad(c.elements, 5)} ${pad(c.active, 6)} ${pad(c.merged, 6)} ${pad(c.stores, 6)} ` +
        `${pad(c.residential, 5)} ${pad(c.nonResidential, 6)} ${pad(c.outside, 4)} ${pad(num(t.momentEstimate), 7)} ${pad(num(t.priorVariance), 5)}  ` +
        `${t.status === 'ok' ? 'ok' : `excluded: ${t.reason}`}`,
    );
  }
  console.log(`  a(MoM): Marshall's moment estimate; a: prior variance used (floored at ${targets.method.minPriorVariance}).`);
  const ok = targets.brands.filter((t) => t.status === 'ok').length;
  console.log(`\n  ${ok} brands enter the backtest. Wrote ${path.relative(ROOT, TARGETS_FILE)} (git-ignored).`);
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
