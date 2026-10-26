# Provenance and decisions

## Initial baseline

- Research date: 2026-10-23.
- Initial contents: original research summaries, checklists and repository configuration only.
- Imported application code, models, datasets and assets: none.
- Product, track, architecture and implementation stack: not selected.
- Credentials, accepted invitations and account-access proofs: not collected.
- Initial foundation preparation was AI-assisted; factual requirements are linked to official sources in the research report. The owner remains responsible for verifying any generated work.

## Decisions

- Keep this workspace private until the owner separately instructs publication.
- Recheck work-period restrictions before implementation.
- Preserve third-party attribution and distinguish existing work from competition-period contributions.
- Do not assume that an event permits identical submissions to other hackathons.

### 2026-10-26 — product, stack and data decisions (owner-approved plan)

- **Implementation start:** 2026-10-26 (inside the submission period Sep 30 – Oct 30 2026). Earlier
  material (2026-10-23) is documentation-only research; no application code existed before today.
- **Product:** "Stoop", an AI media-planner agent for New York City street screens (working name
  "Streetcred" dropped because of an unrelated location-data company with that name). Chosen after
  research into the rules, the judging criteria, Qloo's API and the public competitive landscape.
  Specifications: [PRODUCT.md](PRODUCT.md), [ARCHITECTURE.md](ARCHITECTURE.md).
- **Language models:** free tiers only (owner decision: $0 budget) — Groq first, then Gemini
  (allow-listed countries only), Cloudflare Workers AI, SambaNova and OpenRouter free models, with a
  deterministic fallback. No payment method is attached to any provider.
- **Hosting:** Vercel Hobby. Qloo is called directly over REST from server code; the official
  `qloo mcp` stdio server is not used at runtime (serverless is unsupported) and no hosted MCP
  endpoint is exposed.
- **Qloo data handling:** no Qloo responses in the repository (fixtures are synthetic); private
  server-side caching only; shares and exports contain derived plans only.
- **Public data:** NYC Open Data LinkNYC kiosk locations (`s4kf-3yrf`), 2020 Neighborhood Tabulation
  Areas (`9nt8-h7nd`) and borough boundaries (`gthc-hcne`) — no use restrictions; source, version
  and modifications are recorded in `data/README.md`. OpenStreetMap data (ODbL) is used only offline
  for validation; only summary statistics and the extraction script are published.
- **Reference semantics:** the result envelope mirrors the field semantics of the MIT-licensed
  `@qloo/qloo-harness` 0.1.26; no harness code is copied.
- **AI assistance:** research, planning and implementation are AI-assisted (Claude Code); the owner
  directs decisions and remains responsible for verifying the work.

### 2026-10-26 (evening) — build decisions

- **Restricted categories.** Stoop refuses briefs for housing, job, credit, political, health-claim,
  tobacco, weapons, adult and gambling ads. Choosing neighborhoods by taste can exclude people along
  lines that fair-housing, employment and fair-lending law protect, and political ads need disclosures.
  The patterns are phrase-based and tested against ordinary briefs to avoid false refusals
  (`restrictedCategory` in `src/server/guard/brief.ts`).
- **No error pages for capacity.** When quota, limits or availability block a live run, the visitor gets
  a labelled sample plan for the nearest preset. Before any preset is recorded, that sample is a
  synthetic run of the preset brief, labelled SYNTHETIC.
- **Retention.** Saved runs and recorded presets never outlive `EVENT_DATA_EXPIRES_AT` (2026-11-07),
  the same expiry as the private Qloo cache.
- **LinkLocal / LinkDirect wording** verified against Intersection's announcement of May 1 2025 (see
  [RESEARCH.md](RESEARCH.md)). Stoop names neither program as a partner.
- **Model-output caching** dropped from the plan: identical briefs are served from the saved run, so
  separate planner and creative caches add complexity without saving calls.

## Recording future work

For every imported component, record its upstream URL, immutable commit/version, license, purpose and changes. For every material project decision, record date, rationale and source. If a baseline project is reused, identify its pre-event commit and explain the event-period work separately.

## Submission record

No submission exists yet. At submission, record the exact source commit/tag, official submission URL, demo/video URLs, access checks and applicable freeze period. Do not put secrets or private judge passwords here.
