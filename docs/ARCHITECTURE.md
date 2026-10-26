# Stoop — architecture

Engineering specification for the hackathon build. Product behaviour lives in
[PRODUCT.md](PRODUCT.md). Qloo-specific evidence will live in `docs/QLOO_INTEGRATION.md` once
real calls exist.

## 0. Principles

1. **One app.** A single Next.js 16 App Router app at the repo root, deployed to Vercel Hobby (iad1,
   Node 22, Fluid compute). Qloo, the language models and Redis are reached only from server code
   (`import 'server-only'`). No secret is ever exposed through `NEXT_PUBLIC_*`.
2. **The agent is a fixed plan → act → verify pipeline**, not a tool-calling loop: two language-model
   steps (planner, creative writer), Qloo-backed decision steps, deterministic self-checks, one human
   checkpoint (ambiguous anchors) and follow-through the owner approves. Free Groq models cannot
   combine structured output with tools; a pipeline is also cheaper, faster and testable.
3. **Model interprets, Qloo measures, code decides.** Rankings, caps, budgets and copy rules are
   deterministic code.
4. **Direct Qloo REST** (`GET https://hackathon.api.qloo.com`, header `X-Api-Key`). No `qloo mcp`
   (stdio only; serverless unsupported) and no hosted MCP endpoint. Response semantics mirror the
   official `@qloo/qloo-harness` envelope (MIT) — semantics only, no code copied.
5. **Mock-first.** A synthetic Qloo transport and a fake model gateway run the whole product before
   the key arrives; everything they produce is labelled SYNTHETIC. Fixtures are synthetic only.
6. **Quota is the binding constraint.** Plan for 5 requests/second and 10,000 requests per 30-day
   window starting at first use; every attempt (including errors) counts.

## 1. Stack (pinned; lockfile committed; dependency freeze Thu Oct 29 18:00 Istanbul)

| Layer | Pin |
|---|---|
| Runtime | Node 22.x (`.nvmrc`), pnpm 10.30.2, typescript 5.9.3 |
| Web | next 16.4.3, react/react-dom 19.3.1, tailwindcss + @tailwindcss/postcss 4.3.3, lucide-react 1.61.0, sonner 2.0.8 |
| Map | maplibre-gl 6.15.0, react-map-gl 8.1.3 (`react-map-gl/maplibre`, client-only), ngeohash 0.6.4, OpenFreeMap tiles with a custom night style (attribution kept) |
| AI | ai 7.0.153, @ai-sdk/react 4.0.157, @ai-sdk/groq 4.0.70, @ai-sdk/google 4.0.105, @ai-sdk/openai-compatible 3.0.78, @openrouter/ai-sdk-provider 3.1.0, zod 4.6.7, jsonrepair 3.15.0 |
| Infra | @upstash/redis 1.39.0, @upstash/ratelimit 2.2.0, @vercel/functions 3.10.3, server-only, nanoid |
| Build-time geo | @turf/boolean-point-in-polygon, @turf/area, @turf/helpers 7.4.0, mapshaper 0.7.98 |
| Tests/scripts | vitest 5.0.5 + vite 8.3.5, @playwright/test 1.64.1, tsx, eslint + eslint-config-next 16.4.3, simple-statistics 7.12.1 |
| Fonts | next/font/google (SIL OFL): Barlow Condensed, Public Sans, IBM Plex Mono |

AI SDK 7 notes: use `generateText({ output: Output.object(...) })` (`generateObject` is deprecated);
`system` → `instructions`; `stepCountIs` → `isStepCount`; always pass **provider instances** (a bare
model-ID string routes through the paid AI Gateway).

## 2. Repository layout

```
src/app/                 pages + api routes
src/server/qloo/         client, transports (live/mock), pacing, ledger, cache, params, schemas, resolve, envelope
src/server/geo/          grid, projection, rank-z, lift, smoothing, aggregation, flags, kiosks, wkt
src/server/evidence/     neighborhood place/tag evidence packs
src/server/creative/     schemas, prompts, grounding validator, templates, lexicon
src/server/plan/         assumptions, optimizer, exports (CSV, booking email)
src/server/proof/        LLM-only baseline comparison
src/server/llm/          gateway, chain, slots, cooldowns, geo-gate, schemas, prompts, fake
src/server/agent/        orchestrator, run state, stages, event bus, narration, labels
src/server/guard/        session, origin, limits, budget, semaphore, single-flight, sanitize, fallback
src/server/store/        runs, shares, presets
src/shared/              client-safe types and stream part definitions
src/components/          UI components
src/data/                committed build outputs from public data (kiosks, NTA 2020, grid, NYC polygon)
src/content/             preset briefs, validation summary, copy
public/geo/              simplified GeoJSON for the map
scripts/                 build-geo, gen-fixtures, qloo-smoke, qloo-contract-live, record-presets, audit-public, backtest/*
fixtures/qloo/           synthetic.*.json only
tests/                   unit, contract, integration, e2e
data/README.md           sources, dataset IDs, retrieval dates, licences (data/raw/ is git-ignored)
```

## 3. Static geo build (`scripts/build-geo.ts`, outputs committed)

Sources (NYC Open Data — no use restrictions; cite dataset ID, retrieval date and our
modifications): LinkNYC kiosks `s4kf-3yrf`; 2020 Neighborhood Tabulation Areas `9nt8-h7nd` (262
areas); borough boundaries `gthc-hcne`.

1. **Kiosks:** keep `link_installation_status = "Live"` and upper-cased `planned_kiosk_type ∈
   {LINK1.0, LINK5G_AD}`; drop rows without coordinates; assert **2,183 ± 5**. Compute geohash
   precision 6 and 7. Assign each kiosk to the 2020 NTA polygon that contains it (the dataset's own
   NTA field uses 2010 names — never join on it); non-residential NTAs fall back to the nearest
   residential NTA with a flag. Output `src/data/kiosks.json`
   `{i, siteId, lat, lon, type, boro, address, cross1, cross2, nta, gh6}`.
2. **Neighborhoods:** simplified display GeoJSON (`public/geo/nta2020.min.geojson`, ≤600 KB) and,
   per residential NTA, a Qloo WKT `POLYGON` (largest part, lon-lat order, closed ring, ≤80
   vertices, URL-encoded ≤4,000 characters) + curated short names. Output `src/data/nta2020.json`
   `{code, name, short, boro, centroid, bbox, wkt, adKiosks}`.
3. **NYC study polygon:** dissolved NTAs simplified to ≤120 vertices → `src/data/nyc-study.wkt`.
4. **Analysis grid G (geohash precision 6):** every land gh6 cell plus every kiosk's gh6 cell, with
   per-NTA land weights `w_gj` from gh7 sub-cells (~1,400–1,600 cells) → `src/data/grid-gh6.json`.

## 4. Qloo client (`src/server/qloo/`)

Request: `{ path, params, normalize, purpose, timeoutMs, cacheTtlSec }`; result:
`{ ok: true, data, meta } | { ok: false, code, message, meta }` with
`meta = { key, cache: hit|miss, attempts, ms, status, requestId, monthRemaining }`.

Per call, in order:

1. **Parameter allow-list** per `filter.type` (Qloo silently ignores unknown parameters, so unknown
   keys throw locally and cost nothing).
2. **Cache:** key `q1:{sha256(path + canonical query)}` (sorted keys, sorted order-free lists, WKT
   replaced by `wkt:{sha1}`); Redis plus an in-process map for in-flight de-duplication.
3. **Budget guard:** per-run fresh-call cap (20), daily ET cap, phase floor, breakers
   (`qloo:exhausted`, `qloo:auth_fail`) → `BUDGET_GUARD` without calling Qloo.
4. **Pacing:** ≤2 in flight per run and ≥500 ms between starts; a run's first fresh call takes one
   of `QLOO_RUN_SLOTS` (2) Redis slots (`SET sem:slot:{n} {runId} NX PX 150000`) → ≤4 req/s overall.
5. **Count** every attempt (`qloo:attempts:total`, `qloo:attempts:{etDay}`) before sending.
6. **Fetch** with `X-Api-Key`, `Accept: application/json`, `User-Agent: stoop/<version>` and
   `AbortSignal.any([run, timeout])` (search 8 s, heatmap 25 s, places 20 s, tag + signal.location 25 s).
7. **Ledger:** parse `x-month-ratelimit-{limit,remaining,reset}` (reset = seconds until reset),
   `x-second-ratelimit-*` and the request ID; min-merge the remaining count;
   `effectiveRemaining = min(headerRemaining, limit − attemptsTotal)`.
8. **Status handling** (≤2 attempts per logical call, never past the run deadline):

| Status | Handling |
|---|---|
| 200 | normalize, cache, return (empty is still success) |
| 429 with month remaining 0 (or no month header + body `Rate limit exceeded`) | `QUOTA_EXHAUSTED`; breaker until reset; no retry |
| 429 per-second | wait `max(x-second-ratelimit-reset·1000, 1100)` + jitter; retry once |
| 5xx / timeout / network | retry once after 0.8–1.5 s if ≥8 s of stage budget remain |
| 401 | `AUTH`; breaker 10 min; app switches to cache-only |
| 403 "permission to access urn:entity…" | `TYPE_UNSUPPORTED` (not AUTH); remember the type |
| 400 | `BAD_REQUEST` with `errors[].message/path`; no retry |

Normalized shapes: `HeatCell {gh, aff, rank, pop}`, `HeatmapData {cells, locality}`,
`Candidate {id, name, type, disambiguation, popularity}`, `PlaceEv {id, name, affinity, tags, explain}`.
Zod schemas are loose (ignore extra fields; accept `subtype` or `types[]`, flat `/search`
`results[]`, the locality echo as object or array, null scores). Raw payloads never leave the module.

**Envelope (per stage, shown in the provenance drawer):** `operation`, `status`
(`ok | needs_input | error`), `query_intent {job, target, signals, filters, assumptions,
unresolved}`, `interpretation`, `resolution {outcomes, issues}`, `results`, `result_count`,
`execution {transport: 'direct-rest', correlation_id, duration_ms}`, `provenance {source:
'Qloo API', requests[]}` (method, path, redacted query, status, cache, ms, attempt — WKT shown as
`POLYGON(NTA BK0102)`), `what_this_supports`, `warnings`.

## 5. Entity resolution and `needs_input` (`resolve.ts`)

Normalize names (NFKD, strip diacritics, lowercase, `&` → and, strip punctuation, collapse
whitespace, drop a leading "the"). Call `/search?query=…&types=urn:entity:<t>&take=5` (places add
`filter.location=40.7128,-74.0060&filter.radius=25` — **miles** in `/search`).

| Outcome | When |
|---|---|
| exact | exactly one candidate's normalized name equals the input |
| semantic (warned) | the input has ≥2 content tokens and all appear in exactly one candidate's name/disambiguation (planner `searchHint` counts) |
| ambiguous | anything else with candidates (show ≤5) |
| not_found | no candidates |

Any ambiguous anchor pauses the run (one question screen). Not-found anchors are skipped with a
visible warning unless fewer than 2 anchors resolve. Questions use plain words and disambiguation
text — never URNs; popularity is never shown as confidence. "Search again" ≤3 per run. Resolution
outcomes are cached by `(normalizedName, type, locationHint)`.

## 6. Lift engine (`src/server/geo/`, pure functions)

One heatmap per included anchor plus one baseline, all with the same location form (default
`filter.location=<NYC study WKT>`, fallback `filter.location.query=NYC`; never "New York", which
resolves to the state).

1. **Project** each map onto G: own cell → mean of precision-7 children → precision-5 parent → NA.
   Coverage = share of G that is not NA.
2. **Rank-normalize** each map: average ranks with ties → `u = (rank − 0.5)/n` → `z = Φ⁻¹(u)`
   (Acklam). Qloo heatmap values behave like percentile ranks over ~1,345 NYC cells, so rank-based
   math is invariant to their scale.
3. **Lift per anchor:** `ℓ_a(g) = z_a(g) − z_b(g)` on co-covered cells (residual form
   `(z_a − ρ̂·z_b)/sd` evaluated during calibration).
4. **Baseline** (chosen by calibration, fetched once, cached): B0 `affinity_rank` directly · B1
   demographics-only signal covering all age buckets · B2 broad tag
   `urn:tag:genre:place:restaurant` · B3 mean of a mass-market entity panel · B4 the response's own
   `popularity` field.
5. **Flags per anchor:** `DEFAULT_MAP` (Spearman ≥ 0.98 vs the stored default-map fingerprint, or
   identical top-100 order) → excluded; `IDENTICAL_PAIR` (ρ ≥ 0.999 between anchors); `DENSITY_ONLY`
   (ρ(z_a, z_b) ≥ 0.99) → weight × 0.5; `THIN` (<300 cells or <50% overlap) → weight × coverage.
   Each flag produces a narration line.
6. **Combine:** `L(g) = Σ w_a ℓ_a(g) / Σ w_a` (user weight × flag weight).
7. **Smooth (kiosk scores only):** `S(g) = (4·L(g) + Σ_{n∈N8(g)} L(n)) / (4 + k_g)`.
8. **Neighborhood aggregation** (unsmoothed `L`): `L_j = Σ w_gj L(g) / Σ w_gj`,
   `n_eff = (Σw)² / Σw²`, weighted SD, `SE_j = s_j/√n_eff`, empirical-Bayes shrinkage
   `L̂_j = L_j · n_eff/(n_eff + κ)` with κ = 1.5.
9. **Confidence:** high if `L̂/SE ≥ 2`, agreement ≥ 2/3 and `n_eff ≥ 3`; medium if `L̂/SE ≥ 1` and
   agreement ≥ 1/2; otherwise low (tooltip notes SE is optimistic under spatial correlation).
10. **Outputs:** Taste Fit Index (percentile of `L̂` among residential NTAs with ≥2 ad kiosks),
    kiosk fit (percentile of `S`), display multiplier.

What this supports (UI text): *"Where your anchor audience's Qloo signal ranks higher than NYC's
overall signal. Not foot traffic, population or visits; says nothing about any individual."*

## 7. Neighborhood evidence (`src/server/evidence/`)

For the top 3 neighborhoods (5 in P1), one call each:
`/v2/insights?filter.type=urn:entity:place&filter.location=<NTA WKT>&signal.interests.entities=<anchors>&take=15&feature.explainability=true`.
Aggregate tags of allowed types only (ambience, category/genre of place, cuisine,
neighborhood_characteristic, good_for, visit_intent, time_of_day_fit, decor, setting) — never
customer_identity, age_range, accessibility, payments or parking — weighted `1/(1+rank)`, scored by
share × log(1 + contrast vs the other selected neighborhoods), top 5 with support ≥2 places →
`EvidencePack { nta, shortName, items[{ id: ev:<nta>:<tag>, kind, label, weight, support }], places[] }`.
Place names may appear as evidence in the app but never in ad copy, share pages or CSV.
P1 (only if calibration shows location sensitivity): `filter.type=urn:tag` with
`signal.location=<NTA polygon>` and `filter.tag.types=<music/media genres>`.

## 8. Creative and grounding validator (`src/server/creative/`)

One synthesis call returns two variants per neighborhood:
`AdVariant { nta, variant: A|B, headline, body, cta, references[{ evidenceId, phrase }], rationale }`
(A leads with local taste, B with the offer). Deterministic rules: length (headline ≤38, body ≤90,
cta ≤22, no emoji) · ≥1 reference and every `evidenceId` from this neighborhood's pack with its
phrase present in the copy · no foreign neighborhood names (lexicon of all NTA names, short names,
aliases, boroughs) · mid-sentence proper nouns must be allow-listed (business name, this NTA,
referenced labels, boroughs, days/months, common words) · no sensitive or demographic targeting terms ·
digits only if present in the brief's offer · business name present. A failed variant is replaced by
an evidence-filled template (reason shown); if fewer than half pass, the attempt fails over to the
next model slot (≤3 attempts).

## 9. Budget optimizer (`src/server/plan/`, deterministic)

Candidates: kiosks in the top-K neighborhoods (K = 3, the same ones that get creative) with fit ≥50.
Value `v = impressions_week · weeks · max(S, 0)` ("taste-weighted impressions"); cost
`price_tier · weeks` (Manhattan and outer-borough tiers, all labelled ASSUMPTION and editable).
`N_target = floor(B / mean c)`; per-NTA cap `max(1, ceil(0.5·N_target))`; greedy by `v/c` (ties:
fit, then siteId); repair pass guarantees ≥1 screen per top neighborhood when affordable; infeasible
budgets return "Minimum $X for one screen-week". Output `MediaPlan { screens, byNta, totals,
leftoverUsd, nextBest, infeasibleReason }`.

## 10. Per-run proof (`src/server/proof/`)

The planner call (brief only, before any Qloo data) also returns five LLM-only neighborhood picks
from the same eligible list — no extra model call. Metrics: overlap@5; each LLM pick's percentile on
`L̂` (same Qloo responses ⇒ comparable); optimizer run on the LLM's neighborhoods → taste-weighted
impressions vs ours and share of budget in below-baseline areas; "missed by the LLM" best
neighborhood with its evidence. Always-on disclosure: scoring LLM picks on Qloo's map is circular —
see `/proof` for the independent test.

## 11. Language-model chain (`src/server/llm/`)

`LlmGateway.run({ kind, schema, name, instructions, prompt, country, signal, maxAttempts, validate,
onAttempt })` → `generateText({ model: <provider instance>, instructions, prompt,
output: Output.object({ name, schema }), maxRetries: 0, timeout, abortSignal, reasoning: 'low',
maxOutputTokens })` → on `NoObjectGeneratedError`, local `jsonrepair` + `safeParse` → semantic
`validate()` → Redis-shared cooldowns. Real and fake (deterministic) implementations.

| Slot | Planner (≤2 attempts) | Creative (≤3 attempts) | JSON enforcement |
|---|---|---|---|
| Groq | `openai/gpt-oss-20b` | `openai/gpt-oss-120b` | strict `json_schema`, reasoning effort low |
| Gemini (allow-listed countries only via `x-vercel-ip-country`; never EEA/CH/UK/unknown) | `gemini-3.1-flash-lite` | `gemini-3.5-flash-lite` | native schema |
| Cloudflare Workers AI | `@cf/google/gemma-4-26b-a4b-it` (OpenAI-compatible) | same | JSON skeleton in prompt + repair + zod |
| SambaNova | `gpt-oss-120b` | same | best-effort schema + zod |
| OpenRouter | `google/gemma-4-31b-it:free` with `:free`-only `models` fallback | same | `json_object`, response-healing, `require_parameters` |
| Deterministic | keyword rules + curated anchor library (or ask the owner for 2–3 loved names) | templates | — (labelled "Qloo data only") |

Schemas the model sees: `z.strictObject`, every field required, `.nullable()` instead of
`.optional()`, no default/transform/refine, ≤3 levels; array lengths enforced after the call.
Cooldowns: 429 → retry-after / Groq reset (default 60 s, max 24 h); 5xx/timeout 20–30 s;
401/402/403 30 min; 404 6 h; OpenRouter HTTP-200 error body 30 s; 3 schema failures in 10 min →
10 min. Keys: provider-wide `llm:cd:{slot}` for 401/402/403, per model `llm:cd:{slot}:{model}` for
everything else (a 404 on one Gemini model doesn't bench the other), `llm:sf:{slot}:{model}` for the
schema-failure breaker and `llm:use:{slot}:{UTC day}` for daily soft caps. A `validate()` rejection
moves to the next slot with no cooldown. Per-attempt timeouts: planner 12 s, creative 15 s (three
attempts fit the 45 s creative budget). Kill switch `cfg:llm:disabled`. Model outputs are not cached
separately: identical briefs are served from the saved run. Budget: 2 calls per run (≤5 attempts).
The fixed instruction prefix (including the eligible NTA list) comes first for prompt caching. Place
names and the business address are never sent to a model.

Planner output: `{ business {name, category, offer}, audienceSummary, anchors[{ name, type,
searchHint, why }] (≤6), tone, llmOnlyNeighborhoods[{ ntaCode, reason }] (5), budgetUsd, weeks }`.

## 12. Orchestrator and streaming (`src/server/agent/`)

Stages: intake → plan (model 1) → resolve (may pause) → where → evidence → creative (model 2) ∥
optimize ∥ proof → finalize. Budgets: plan 25 s, resolve 15 s, where 35 s, evidence 30 s, creative
45 s; run deadline 110 s; `maxDuration` 150. A stage that would cross the deadline degrades and labels
itself.

`POST /api/runs { mode: 'start', brief, presetSlug? } | { mode: 'resume', runId, choices }`
(`src/app/api/runs/route.ts`) → same-origin check → brief parse + restricted-category check (422 with
a plain reason) → identical brief: a finished run streams back as a `snapshot` labelled CACHED, a running
one answers `{ runId, follow: true }` → availability (`liveAvailability`: Qloo mode, runtime switch,
breakers, daily cap and reserve floor with a 20-call margin) → per-session/IP/global limits → `RunState`
saved → `executeRun` registered with Next's `after()` (a client disconnect never loses the run) →
`createUIMessageStream` writing typed data parts → `createUIMessageStreamResponse` with 10 s keep-alives
and an `x-run-id` header. JSON replies are reserved for problems with the request itself and for
"follow this run"; every capacity problem streams a `fallback` part and a sample plan for the nearest
preset (the recorded run, or a synthetic run of its brief before any recording).

Data parts (same `id` updates in place): `run`, `stage`, `decision`, `anchors`, `needsInput`,
`where`, `evidence` (per NTA), `creative` (per NTA), `plan`, `proof`, `envelope` (per stage),
`label`, `fallback`, `snapshot` (a complete saved run: cached brief, recorded preset or the start of a
resume), `done`; transient `progress` and `attempt`. A `run` part for a run the client already holds
keeps its state (resume). `needs_input` persists state and ends the stream; the picker resumes with
choices, and anything left unanswered takes its first candidate (one question per run). The client
(`src/components/live/useLiveRun.ts`) reads the SSE body with `readUiMessageSse`, folds parts with the
shared `applyPart` reducer, moves the URL to `/plan/{id}` (or `/p/{slug}` for a recorded preset), and
polls `GET /api/runs/{id}` when the stream drops or a reload lands mid-run. `GET /api/runs/{id}` reports
a run still marked running three minutes after its last checkpoint as stopped.

Production wiring lives in `src/server/agent/deps-live.ts` (`createRunDeps`). The cross-run Qloo slot is
released right after the evidence stage (no Qloo calls follow) and again on exit, so a slow model step
never blocks other plans. The lift configuration comes from `cfg:calibration`
(`{ config, location, baselineSignals, fingerprintSignals, decidedAt }`, no Qloo data inside; baseline
and fingerprint maps are re-requested through the client cache) and defaults to B4 on the NYC polygon.

## 13. Storage (Upstash Redis; key prefix per environment `p:` / `pv:` / `d:`)

| Key | Content | TTL |
|---|---|---|
| `run:{id}` | `RunState` (~35 KB, no raw Qloo) | 14 days, capped at the event data expiry |
| `share:{id}` | derived snapshot (no Qloo IDs, raw scores, place names or images) | until 2026-11-07 |
| `preset:{slug}` | recorded run (RECORDED) | until the event data expiry |
| `q1:{hash}` | normalized Qloo data | until event data expiry |
| `res:{type}:{name}` | resolution outcome | same |
| `sf:run:{briefHash}` / `done:run:{briefHash}` / `sf:resume:{id}` | single-flight lock / completed identical brief / resume lock | 150 s / 6 h / 150 s |
| `qloo:*`, `llm:use:*`, `llm:cd:*`, `rl:*`, `sem:*`, `cfg:*` | ledgers, cooldowns, limits, slots, config | various |

`ResultLabel`: `live {model, qloo {fresh, cached}}` · `cached {at}` · `recorded {at, model}` ·
`qloo_only {reason}` · `synthetic`.

## 14. Guards (no login, no CAPTCHA)

Vercel WAF rule: `POST /api/runs`, 20 requests / 60 s / IP. Signed session cookie (HMAC); per session
3 live runs / 15 min and 8 / day; per IP 25 / day (loose for shared networks); global per-phase daily
caps and 25 / hour. Same-origin POST; brief ≤1,200 characters with emails, phones and URLs stripped
before the model; brief text never sent to Qloo. Briefs for housing, job, credit, political,
health-claim, tobacco, weapons, adult or gambling ads are refused with a reason (`restrictedCategory`).
Exhausting any budget streams a `fallback` part plus the nearest preset's sample plan with a banner —
never an error page. Admin routes need `Authorization: Bearer $ADMIN_TOKEN` and answer 404 otherwise.

## 15. Qloo call budget

Per fresh run: worst 17, typical 7–10 (resolve 2–5, heatmaps 2–5, baseline 0 when warm, evidence 3);
hard cap 20; presets and identical briefs 0. One-time ≈650 (calibration ≤30, baseline panel ≤6,
contract ≤10, presets ≈60, backtest ≈55, development ≤500; Preview deployments have no key).

| Phase (ET) | 10k profile: Qloo calls/day · live runs/day | Stop fresh public calls below |
|---|---|---|
| Build → Oct 30 23:45 | 400 · 25 | 6,500 remaining |
| Oct 31 → Nov 2 12:00 | 300 · 25 | 6,500 |
| Judging Nov 2–4 | 1,500 · 100 | 600 |
| Finale Nov 5 | 1,500 · 100 | 150 |
| After Nov 5 23:45 | 0 (cache-only → showcase) | — |

The 50k profile scales caps ×5. Scripts bypass public floors only with `--force` (absolute floor 300).

## 16. Mock mode

Seeded synthetic heatmaps over G: density `D` from kiosk density + borough base, 2–3 Gaussian taste
bumps on hash-chosen neighborhoods; `aff = pctl(0.9·z(D) + 0.4·z(T) + ε)`, `pop = pctl(D) + noise`,
`rank = pctl(T) + noise`; precision 7 in Manhattan, 5 on Staten Island; IDs starting `nodata-`
return one identical density map (planted default map). Synthetic search candidates include a planted
ambiguity ("Solaris": two films). Synthetic places and tags use `synthetic_` IDs; synthetic UUIDs use
the prefix `5157E7C0-0000-4000-8000-`. Committed fixtures are generator snapshots named
`synthetic.*.json`.

## 17. First-key smoke test and calibration (`scripts/qloo-smoke.ts`)

26 planned calls, hard stop 30; `--dry-run` / `--confirm`; sequential, 1 per 600 ms; aborts on any
401 or 429; writes decisions (config only) to `.private/calibration/<ts>/` and Redis
`cfg:calibration`, summary to `docs/CALIBRATION.md`.

| # | Call | Decides |
|---|---|---|
| A1 | `GET /` | profile (10k/50k), window end after Nov 6, per-second limit → slots |
| B1–B4 | `/search` Sweetgreen (brand), Vampire Weekend (artist), Brooklyn Museum (place, NYC location), Broad City (tv_show) | resolution rule, picker fields, search timeout |
| C1–C3 | Sweetgreen heatmap with `filter.location.query=NYC`; same with the NYC WKT; repeat | location form, coverage, precision mix, payload, latency, determinism (cache TTL) |
| D1–D3 | heatmaps for the other three | types work; geohash sets |
| E1–E6 | baselines B1 (all ages), B2 (restaurant tag), B3 (Starbucks + McDonald's) | baseline candidates |
| F1–F4 | Bursaspor + Pick n Pay (search + heatmap) | default-map fingerprint / thin thresholds |
| G1–G2 | place evidence in Williamsburg and Astoria with two anchors | P0 evidence viability (≥8 places, median ≥10 useful tags); explainability |
| G3–G4 | `urn:tag` + `signal.location` for the same NTAs | P1 tag evidence if tag-set Jaccard ≤ 0.6 |
| H1 | optional `output.heatmap.boundary=urn:entity:locality` | P1 cross-check |

Configuration choice (local, no more calls): evaluate metric (affinity, affinity_rank) × baseline
(B0–B4), difference form, then residual for the best two. Score FACE1 (share of Brooklyn Museum's
top-10 neighborhoods in Brooklyn), FACE2 (Sweetgreen lift vs OSM Sweetgreen over-index), DISC
(anchor maps distinct, ≥0.3), COV (≥0.9). Pick the highest mean FACE; ties go to cheaper baselines.
If every combination has FACE ≤ 0.2, ship the most distinctive one labelled "experimental".

## 18. Validation backtest (P1, `scripts/backtest/`)

**Question.** Do a chain's Qloo taste maps say where its real stores over-index, beyond what overall
density explains? The test is independent of Qloo, unlike the per-run PROOF.

**OSM arm (run 2026-10-26, snapshot 19:10–19:36Z).** 27 candidate chains with Wikidata QIDs verified
against Wikidata and matching name-suggestion-index tagging. Overpass
(`area["wikidata"="Q60"]; nwr["brand:wikidata"="<Q>"](area); out center;`) with a descriptive User-Agent,
one query at a time, cached in git-ignored `data/raw/osm/`. Closed (`disused:*`) stores, ATMs and outlines
duplicating a mapped point are removed. **22 chains** have ≥ 15 active NYC stores (Dunkin' 409 … Joe &
The Juice 16). One POI-density query (42,794 restaurants, cafés, bars and shops) gives the expected count.
The target per neighborhood is an empirical-Bayes smoothed over-index of the chain's stores against POI
density. The prior variance is floored at 0.25; without the floor, half of the chains with 20–30 stores
collapse to a constant target. This was decided on OSM data alone, before any Qloo data exists.

**Qloo arm (needs the key; 44 calls).** Per chain: `/search` (brand) and one NYC heatmap through the
production client and lift engine (`computeWhere` with the calibrated configuration, the same location
form via `heatmapLocation`). Sequential, no retries, hard stop 50, stops on any 401/429; `--dry-run`
prints the plan, `--mock` rehearses on synthetic data.

**Statistics (pre-declared).** Spearman ρ per chain over the 106 neighborhoods the app ranks (secondary:
all 197 residential neighborhoods). The headline is the median ρ with a bootstrap CI, together with a
**placebo test**: does a chain's own map predict its stores better than the other chains' maps do? The
within-borough shuffle null is reported too, but it is optimistic. On synthetic maps that know nothing
about stores it flagged 12.8% of pairs at p < 0.05, because neighboring neighborhoods aren't independent.

**Publishing.** Summary statistics only (`src/content/validation.json`: per-chain ρ, n, baselines;
no Qloo values, no OSM coordinates), the scripts, the caveats (volunteer-mapped OSM, one snapshot, store
networks reflect rent and strategy as well as taste, spatial autocorrelation, chains chosen not sampled,
stores are not audiences) and the ODbL notice ("Contains information from OpenStreetMap, which is made
available here under the Open Database License"). Publish whatever the result is, including failures.

## 19. Routes

Pages: `/`, `/plan/new`, `/plan/[runId]`, `/p/[slug]`, `/proof` (once validation results exist),
`/how-it-works`, `/judges`, `/status`. API: `POST /api/runs`, `GET /api/runs/[id]`,
`GET /api/export?run=<id>|preset=<slug>` (CSV, derived only, assumptions in header rows),
`GET /api/ad?run=<id>|preset=<slug>&nta=<code>&v=A|B` (one ad as a 1080×1920 PNG, `next/og` with bundled
fonts), `GET /api/health` (public, no numbers),
`GET /api/admin/health` and `POST /api/admin/record` (bearer `ADMIN_TOKEN`). `robots.txt` disallows
`/api/`, `/s/`, `/plan/`.

## 20. Environment variables (server-only)

`QLOO_API_KEY` (Production only; absent in Preview), `QLOO_BASE_URL`, `QLOO_MODE`
(`mock|live|cache-only|off`), `LLM_MODE` (`mock|live`), `QLOO_RUN_RPS`, `QLOO_RUN_SLOTS`,
`QLOO_MAX_FRESH_PER_RUN`, `QLOO_CAPS_JSON`, `EVENT_JUDGING_START`, `EVENT_JUDGING_END`,
`EVENT_DATA_EXPIRES_AT`, `SHARE_EXPIRES_AT`, `LIVE_RUNS_PER_HOUR`, `UPSTASH_REDIS_REST_URL` /
`UPSTASH_REDIS_REST_TOKEN` (or `KV_REST_API_*`), `REDIS_PREFIX`, `REDIS_DRIVER` (`upstash|memory`),
`GROQ_API_KEY`, `GOOGLE_GENERATIVE_AI_API_KEY`, `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN`,
`SAMBANOVA_API_KEY`, `OPENROUTER_API_KEY`, `GEMINI_ALLOWED_COUNTRIES`, `SESSION_SECRET`,
`ADMIN_TOKEN`, `SHARING_ENABLED`, `SITE_URL`; scripts only: `OVERPASS_URL`, `OVERPASS_USER_AGENT`.
Runtime switches in Redis: `cfg:qloo:mode`, `cfg:llm:disabled`.

## 21. Tests and CI

CI runs with `REDIS_DRIVER=memory`, `QLOO_MODE=mock`, `LLM_MODE=mock` (no secrets): frozen install →
typecheck → lint → vitest → build → `audit:public` (bundle grep for key shapes; no `affinity_rank` /
`entity_id` outside synthetic fixtures and tests; synthetic UUID prefix enforced; `.private/` and
`data/raw/` untracked) → Playwright e2e → gitleaks on full history.

Unit: grid/projection, rank-z, lift (planted-bump recovery precision@5 ≥0.6 vs raw ≤0.3),
aggregation, flags, cache keys, ledger (incl. Nov 1 DST), client status table, param allow-list,
resolution, validator (≥25 cases), optimizer, proof, schema strictness, chain error → cooldown,
Gemini geo-gate, provider-object slots, guards. Contract: schemas vs synthetic fixtures and edge
variants. Integration: `executeRun` end-to-end in mock mode (needs_input resume; no Qloo IDs or raw
scores in share/CSV). E2E: preset renders; new brief streams; picker resumes; rate limit → banner +
recorded run; share page noindex without affinity values; CSV header.
