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
- [ ] Vercel project imported from GitHub (private repo) + Upstash Redis (free) via Marketplace
- [ ] Keys added to Vercel env (Production) and local `.env.local` (git-ignored)
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
- [ ] 5. LLM chain + planner/creative schemas + fallbacks — verify: live Groq call returns valid
      JSON; disabling slots walks the chain; all disabled → templates
- [x] 6. Orchestrator + stream + run store + needs_input resume + labels + provenance drawer —
      verify: mock integration test; e2e (new brief streams; picker resumes)
- [x] 7. Evidence + creative + validator + screen mockups — verify: validator tests (≥25 cases);
      grounded variants in a mock run
- [x] 8. Optimizer + PLAN table + CSV + print/PDF + email draft — verify: optimizer tests; e2e CSV
- [x] 9. Per-run PROOF (LLM-only comparison) — verify: integration asserts proof fields
- [ ] 10. Guards (WAF rule, limits, slots, single-flight, banners) — verify: e2e rate-limit →
      banner + recorded run; manual WAF test
- [ ] 11. Production deploy (mock + banner) → live after calibration — verify: new brief < 90 s,
      ≤ 20 fresh Qloo calls, provenance lists every request
- [ ] 12. Calibration (`pnpm qloo:smoke --confirm`, ≤ 30 calls) applied — verify:
      `docs/CALIBRATION.md` + `cfg:calibration`; each anchor's top-10 NTAs sanity-checked
- [ ] 13. ≥ 4 recorded presets — verify: landing cards open RECORDED runs
- [ ] ~~14. Share page (flagged, noindex, derived only)~~ — cut 2026-10-26: `/plan/<id>` links are the share links (unguessable ids, noindex, robots-excluded, expire with the event data)
- [ ] 15. Docs + Devpost assets + public audit + owner-authorized publication + submission —
      verify: audit clean, MIT detected, submission URL recorded in PROVENANCE

## P1 — in order, only after P0 is safe

- [ ] OSM validation backtest + `/proof` page (summary stats only, ODbL notice, failures shown)
- [ ] Tag evidence per NTA (only if calibration shows tags vary by location)
- [ ] Business's own Qloo entity as an anchor + one-call `filter.results.entities` anchor check
- [ ] Anchor swap on DENSITY_ONLY flag
- [ ] Evidence + creative for 5 NTAs
- [x] LinkLocal "best 6 free screens" mode (wording verified 2026-10-26; picks + PLAN card + tests)
- [ ] "+$1k" next-best suggestion · distance-from-business slider
- [ ] LLM arm in the backtest · PNG export of mockups · grid toggle

## Gates (Istanbul time)

- [ ] G0 Mon 01:00 — real-kiosk map on Vercel; CI green
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

## Review

_Filled in at submission: what shipped, what was cut, measured numbers, open issues._
