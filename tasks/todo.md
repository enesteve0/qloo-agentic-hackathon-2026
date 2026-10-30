# Stoop build plan (Qloo Agentic Hackathon 2026)

Deadline: Fri Oct 30 23:45 ET = Sat Oct 31 06:45 Istanbul. Internal target: submitted Fri Oct 30
18:00 Istanbul. Approved plan: `~/.claude/plans/so-for-this-hackathon-playful-newt.md`
(product spec in `docs/PRODUCT.md`, engineering spec in `docs/ARCHITECTURE.md`).

Rule: an item is ticked only when its **verify** step has actually passed. Record lessons from any
correction in `tasks/lessons.md`.

## Owner actions (critical path)

- [ ] Qloo key form submitted + Discord #api-help + Devpost forum post (ask for 50k quota)
- [ ] Free LLM keys: Groq, Google AI Studio, Cloudflare Workers AI (account ID + token), SambaNova,
      OpenRouter (new key); no payment method anywhere
- [x] Vercel project created and connected to GitHub (2026-10-29, CLI; https://usestoop.vercel.app; pushes to master deploy)
- [ ] Upstash Redis (free, autoUpgrade off): owner accepts Upstash terms, then provision via CLI
- [ ] Keys added to Vercel env (Production) and local `.env.local` (git-ignored) — app secrets, modes and prefixes set 2026-10-29; Qloo and Groq keys wait for `.env.local`
- [ ] Explicit "publish the repo" instruction on Fri Oct 30 (recorded in PROVENANCE)

## P0 — must ship (dependency order)

- [x] 0. Specs + task list + lessons + PROVENANCE decisions — verify: docs render, links valid
- [x] 1. Scaffold: Next 16.4.3, pinned deps, env schema, Redis drivers, CI — verify: `pnpm build`,
      typecheck, lint, tests green locally and in CI
- [x] 2. `scripts/build-geo.ts` + committed data + night-mode kiosk map — verify: 2,183 ± 5 kiosks,
      every kiosk in a 2020 NTA, WKT ≤ 4,000 chars encoded, map renders
- [x] 3. Qloo client + mock transport + synthetic fixtures + contract tests + smoke dry-run —
      verify: unit/contract tests; `pnpm qloo:smoke --dry-run` prints the call plan
- [x] 4. Lift engine + kiosk/NTA scoring + flags — verify: planted-bump recovery precision@5 ≥ 0.6
      (raw affinity ≤ 0.3); default-map / density-only / thin detection tests
- [x] 5. LLM chain + planner/creative schemas + fallbacks — verify: live Groq call returns valid
      JSON; disabling slots walks the chain; all disabled → templates (live Groq runs 2026-10-29 night;
      chain walking and template fallback in unit tests)
- [x] 6. Orchestrator + stream + run store + needs_input resume + labels + provenance drawer —
      verify: mock integration test; e2e (new brief streams; picker resumes)
- [x] 7. Evidence + creative + validator + screen mockups — verify: validator tests (≥25 cases);
      grounded variants in a mock run
- [x] 8. Optimizer + PLAN table + CSV + print/PDF + email draft — verify: optimizer tests; e2e CSV
- [x] 9. Per-run PROOF (LLM-only comparison) — verify: integration asserts proof fields
- [x] 10. Guards (WAF rule, limits, slots, single-flight, banners) — verify: e2e rate-limit →
      banner + recorded run (CI); WAF rule active on the project (20/min/IP on POST /api/runs, read back via API 2026-10-29)
- [ ] 11. Production deploy (mock + banner) → live after calibration — verify: new brief < 90 s,
      ≤ 20 fresh Qloo calls, provenance lists every request
- [ ] 12. Calibration (`pnpm qloo:smoke --confirm`, ≤ 30 calls) applied — verify:
      `docs/CALIBRATION.md` + `cfg:calibration`; each anchor's top-10 NTAs sanity-checked
- [ ] 13. ≥ 4 recorded presets — verify: landing cards open RECORDED runs
- [ ] ~~14. Share page (flagged, noindex, derived only)~~ — cut 2026-10-26: `/plan/<id>` links are the share links (unguessable ids, noindex, robots-excluded, expire with the event data)
- [ ] 15. Docs + Devpost assets + public audit + owner-authorized publication + submission —
      verify: audit clean, MIT detected, submission URL recorded in PROVENANCE

## P1 — in order, only after P0 is safe

- [ ] OSM validation backtest + `/validation` page (summary stats only, ODbL notice, failures shown) — OSM arm done 2026-10-26 (22 chains); Qloo arm ready (44 calls), runs on key day; page built 2026-10-29 (404 until the report is committed)
- [ ] Tag evidence per NTA (only if calibration shows tags vary by location)
- [ ] Business's own Qloo entity as an anchor + one-call `filter.results.entities` anchor check
- [ ] Anchor swap on DENSITY_ONLY flag
- [ ] Evidence + creative for 5 NTAs
- [x] LinkLocal "best 6 free screens" mode (wording verified 2026-10-26; picks + PLAN card + tests)
- [ ] "+$1k" next-best suggestion · distance-from-business slider
- [ ] LLM arm in the backtest · PNG export of mockups · grid toggle

## Gates (Istanbul time)

- [x] G0 Mon 01:00 — real-kiosk map on Vercel; CI green — met late, Thu 29 11:00 (usestoop.vercel.app, mock mode)
- [x] G1 Tue 23:00 — browser end-to-end on mocks (SYNTHETIC badge) — met Mon 26 evening: 28 Playwright specs (live run, reload, CSV/PNG, limits → sample plan, picker, axe on 11 pages) pass in CI on the production build
- [ ] G2 Wed 23:00 — live end-to-end with ≥ 3 presets (or escalate per contingencies)
- [ ] G3 Thu 23:00 — feature freeze (prompts + dependencies frozen 18:00)
- [ ] G4 Fri 18:00 — submitted; tag `v1.0.0-submission`

## Progress notes

- 2026-10-26 21:35 Istanbul: backend complete on mocks. Qloo client (111 tests), lift engine (86),
  model chain (155), creative/plan/proof (107), guards, streaming run API with resume, cached briefs,
  sample-plan fallbacks and restricted categories; `/plan/new`, `/plan/[runId]` and `/p/[slug]` stream
  and render through the shared RunScreen (checked in a production build with a headless browser).
  Still open for G1: `/how-it-works`, `/judges`, landing preset cards, Playwright e2e specs. Blocked on
  owner: Vercel import (G0), Qloo key, model keys.

- 2026-10-26 late: UI complete on mocks (landing, /how-it-works, /judges, all seven stations, PNG ads,
  LinkLocal free option); an independent review of the run API found ten issues, all fixed with
  regression tests (606 unit/integration tests). Remaining blockers are owner actions: Vercel + Upstash
  (G0), the Qloo key (calibration, recorded presets), model keys (live copy).

- 2026-10-29 13:20 Istanbul: production live in mock mode at https://usestoop.vercel.app (Vercel CLI,
  GitHub-connected, WAF rule, env per environment). Design polish pass committed (error and 404 pages,
  brief problems in one alert, honest leftover-budget note). README rewritten for submission. `/validation`
  page ready. Blocked on owner: Upstash terms acceptance and `.env.local` with the Qloo and Groq keys.

- 2026-10-29 18:50 Istanbul: Lighthouse on production (6 pages, desktop + mobile): accessibility 100
  everywhere; best practices 96 (missing favicon, now fixed with generated tab and home-screen icons);
  SEO 63 only on the deliberately `noindex` pages (`/plan/*`, `/p/*`, `/status`); performance 79–100 (the
  MapLibre bundle). Groq's `openai/gpt-oss-20b`/`-120b` confirmed current (not on Groq's deprecation list).
  Still blocked on owner: Upstash terms and `.env.local`.

- 2026-10-30 00:30 Istanbul: owner accepted Upstash's terms and created the Groq key; free Upstash database
  `stoopnyc-redis` provisioned and connected; production on c675738 with the live AI writer (gpt-oss-120b,
  20b fallback) and Upstash storage, checked with a live run (13.7 s, 6/6 model ads) — Qloo data still
  synthetic. CI green. Blocked on owner: the Qloo key (inbox search was blocked by the permission system).

## Overnight Thu 29 → Fri 30 (owner asleep; Qloo key waits for the owner)

- [x] Prompts v2: planner anchor guidance (types, no mass-market names, no invented entities); creative
      rule 3 says the evidence phrase must be in the headline or body (B ads kept failing `refs`);
      typographic hyphens normalized; tests; live check on ≥ 6 briefs (anchors by eye, model pass rate)
      — 33/36 then 18/18 model ads passed (was 35/54); planner and writer on gpt-oss-120b, 20b as fallback
- [x] Upstash driver checked against the real database under a throwaway prefix (run persists, limits,
      single-flight), then the prefix deleted
- [x] Production: `LLM_MODE=live` + Upstash (redeploy); health, a live run, data under `p:` — b5c5e7a,
      live runs 13.7 s and 14.6 s with 6/6 model ads, run/limit/cache keys under `p:`
- [x] Qloo key-day prep: production env file for scripts (scratch, 600), commands ready
- [x] Docs: PROVENANCE (Upstash terms accepted by the owner, Groq key), DEPLOYMENT, README status,
      SUBMISSION, Devpost draft numbers that do not depend on Qloo
- [x] Release audit dry run (gitleaks + trufflehog, full history) so Friday's publish is quick — both
      clean on 66 commits; repeat on the release commit

## Submission day Fri 30 (no Qloo key: submit on labelled synthetic data)

- [x] Key status checked: no key email in the owner's inbox; owner requesting one (form, Devpost forum
      thread 45475, Discord, ian@qloo.com) and asking whether a late key may be switched on in judging
- [x] Release audit at 80e9854: gitleaks, trufflehog, `pnpm audit:public` clean (69 commits)
- [x] Six sample plans recorded on production with the live AI on synthetic data (labelled SYNTHETIC);
      Drop Day re-recorded, Halfnote's first take kept — 36/36 model ads pass the copy rules
- [x] Landing cards list each recording's anchors — 7a3d3e7, static with a 5-min refresh, CI green,
      production checked (no stale anchors)
- [x] Devpost draft for the no-key case (`.private/DEVPOST_DRAFT.md`) with the "if the key goes live" swaps
- [x] README, SUBMISSION (kit guide mapped), RESEARCH, PROVENANCE updated for the no-key state
- [ ] Gallery + thumbnail re-shot on production (synthetic labels visible)
- [ ] Judge path checked on production: landing → sample plan (all five views, agent log) → own brief, desktop and phone
- [ ] Owner: "make the repo public" → release audit on the release commit → public, MIT in About,
      description, URL, topics, secret scanning
- [ ] Owner submits on Devpost; tag `v1.0.0-submission`; PROVENANCE submission record

## Review

_Filled in at submission: what shipped, what was cut, measured numbers, open issues._
