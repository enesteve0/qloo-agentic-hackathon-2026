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
- **Share page cut.** `/plan/<id>` links serve as share links (unguessable ids, noindex, excluded in
  robots.txt, expiring with the event data); a separate derived-only share snapshot was dropped to keep
  scope.
- **Validation backtest pre-declared (before any Qloo data).** 22 chains from an OpenStreetMap snapshot
  of 2026-10-26; the target's prior variance floored at 0.25; the headline is the median ρ with a placebo
  test (own map vs other chains' maps), because the within-borough shuffle null proved optimistic on
  synthetic data. Main analysis on the 106 neighborhoods the app ranks, secondary on all 197 residential.
- **Model-output caching** dropped from the plan: identical briefs are served from the saved run, so
  separate planner and creative caches add complexity without saving calls.

### 2026-10-29 — deployment

- **Vercel project** `stoopnyc` (Hobby, region iad1, Node 22, Fluid compute) created with the Vercel CLI
  and connected to this GitHub repository; every push to `master` deploys to production. Public URL:
  **https://usestoop.vercel.app** (`stoopnyc.vercel.app` belonged to another account). Preview
  deployments stay behind Vercel Authentication.
- **Environment:** production and preview get separate session secrets and admin tokens and separate
  Redis key prefixes (`p:` / `pv:`). The Qloo key goes to production only. Values live in Vercel and in
  git-ignored local files, never in the repository.
- **Firewall:** a Vercel WAF rule rate-limits `POST /api/runs` to 20 requests per minute per IP, in
  front of Stoop's own per-session and per-IP limits.
- **Redis:** Upstash for Redis through the Vercel Marketplace, free plan, `autoUpgrade=false` (the
  CLI default is true), so the database can never move to a paid plan. The owner accepts Upstash's
  terms; the database is created after that.
- **Removed:** the unused `SHARING_ENABLED` / `SHARE_EXPIRES_AT` settings left from the cut share page.
- **Validation page** is `/validation` (not `/proof`, which is the PROOF station's name). It is built
  from the committed report and does not exist until the live Qloo arm has run.

### 2026-10-29 (night) — database, model key and first live model runs

- **Upstash:** the owner signed in to Vercel and accepted the Marketplace terms for Upstash (Vercel
  requires a person to accept them). The free database `stoopnyc-redis` (iad1, `autoUpgrade=false`,
  `prodPack=false`) was then created with the Vercel CLI and connected to the project for production,
  preview and development. The Upstash driver was checked against the real database under a throwaway
  key prefix (same results as the in-memory store, except that Upstash decodes JSON-looking strings;
  Stoop stores none it reads back as strings, apart from run ids that cannot look like JSON in practice).
- **Groq key:** created by the owner (free tier, no payment method) and added to production as a
  sensitive variable and to the git-ignored `.env.local`. The Qloo key is still with the owner.
- **Model chain after the first live runs:** planner and copywriter both run on Groq's
  `openai/gpt-oss-120b`; a second Groq slot on the same key runs `openai/gpt-oss-20b` and answers when
  120b is rate-limited (Groq's free limits are per model). Side by side on the same briefs, 20b picked
  wrong-type, mass-market or made-up anchors and passed fewer copy checks (12/24 vs 17/24 ads).
- **Prompts v2:** anchor types defined; mass-market names, invented entities and filler picks ("three
  strong anchors beat six weak ones") ruled out; each anchor must connect to what the business offers,
  never to its neighborhood or who lives there (an earlier run picked a sitcom for a jazz club in
  Bed-Stuy). The copywriter is asked for a margin under the length limits, keeps the business name in
  every ad, makes ad B's headline the offer itself and puts each evidence phrase in the headline or body
  (the validator never looked at the CTA). Typographic hyphens are normalized in names and copy.
- **Copy rules, fewer false alarms:** digits from the owner's own description count as the brief's
  numbers; a capitalized word at a sentence start that the brief itself uses is not read as an
  anchor's name. When no model answer gets half its ads through, the best answer's passing ads are
  kept instead of templating all six.

## Recording future work

For every imported component, record its upstream URL, immutable commit/version, license, purpose and changes. For every material project decision, record date, rationale and source. If a baseline project is reused, identify its pre-event commit and explain the event-period work separately.

## Submission record

No submission exists yet. At submission, record the exact source commit/tag, official submission URL, demo/video URLs, access checks and applicable freeze period. Do not put secrets or private judge passwords here.
