# Data and privacy

Stoop plans street-screen ads from what neighborhoods like, never from who people are. This page lists
every place data goes, what is kept and for how long, and what Stoop refuses to do. Each statement
names the code that enforces it.

## Where data goes

| Destination | What Stoop sends | What it never sends |
|---|---|---|
| **Qloo Insights API** (server-side, `src/server/qloo/`) | Names of taste anchors to search for (for example "Robert Glasper"), Qloo entity IDs, tag types, the public NYC study polygon and public 2020 neighborhood (NTA) polygons | The brief, the business name, the address, anything about visitors |
| **Language models**, free tiers only (`src/server/llm/`) | **Planner:** business name, description, offer, budget, weeks, start date. **Ad writer:** business name, offer, tone, category, a description trimmed to 300 characters, neighborhood names and Qloo evidence *tag labels*. Emails, phone numbers and links are removed from the brief before any model reads it (`sanitizeText` in `src/server/guard/brief.ts`) | The address, Qloo place names, Qloo scores, anything about visitors |
| **Upstash Redis** (private database, `src/server/kv.ts`) | Saved runs (brief, derived plan, ads, scores), the private Qloo response cache, rate-limit counters, model cooldowns | Nothing leaves it: no export or sharing of raw Qloo data |
| **The visitor's browser** | The plan, the ads and the map | Qloo raw responses or entity IDs in exports (the CSV holds public screen data, assumptions and derived fit only) |

Model providers in order of use: Groq, Google Gemini, Cloudflare Workers AI, SambaNova, OpenRouter
(`:free` models only). No payment method is attached to any of them. Gemini is offered only to
visitors whose country, from Vercel's IP-country header, is on an allow-list that excludes the European
Economic Area, Switzerland and the United Kingdom. A visitor whose country is unknown never reaches
Gemini (`src/server/llm/geo-gate.ts`).

## In the browser

- One first-party cookie, `stoop_sid`: a random ID with an HMAC signature, `HttpOnly`, `SameSite=Lax`,
  30 days. It is used only to apply fair-use limits per visitor (`src/server/guard/session.ts`).
- No analytics, no advertising cookies, no third-party trackers.
- Map tiles, glyphs and sprites load from OpenFreeMap. Fonts are bundled with the site at build time,
  so no font request goes to Google.

## What is kept, and for how long

| Data | Kept for |
|---|---|
| Saved runs (`run:*`) | Up to 14 days, and never after `EVENT_DATA_EXPIRES_AT` (7 Nov 2026) |
| Recorded presets (`preset:*`) | Until `EVENT_DATA_EXPIRES_AT` |
| Qloo response cache (`q1:*`) | Until `EVENT_DATA_EXPIRES_AT`; nothing new is stored after it |
| Rate-limit counters | Their window plus a few seconds (at most one day) |
| Session cookie | 30 days in the visitor's browser |

Runs and presets get their expiry from `src/server/store/runs.ts`, and the Qloo cache gets its expiry
from `src/server/qloo/client.ts`. After the event the app switches Qloo off (`QLOO_MODE=off`), and any
keys derived from Qloo data that are still in the database are deleted. No Qloo response data is
committed to the repository. Test fixtures are synthetic (`fixtures/qloo/synthetic.*`), and
`pnpm audit:public` checks this in CI.

Vercel's platform keeps its own request logs (IP address, path, status) under Vercel's retention
policy. Stoop's code doesn't log briefs or plans.

## Fair use

New plans are live, within limits that keep the event's Qloo quota available for everyone: 3 live
runs per visitor in 15 minutes and 8 per day, 25 per network per day, plus global hourly and daily
caps (`src/server/guard/limits.ts`). An identical brief returns the saved plan instead of a new run.
When a limit is reached, the visitor gets a labelled sample plan for a similar business, not an
error page.

## What Stoop will not do

- Track people: no device IDs, location trails, ad cookies or third-party trackers.
- Send anything about the user to Qloo. Qloo receives only taste anchors, entity IDs, tag types and
  NYC polygons.
- Infer race, ethnicity, religion, health, sexuality or politics, or use audience segments to choose
  neighborhoods. The ad-copy rules also reject demographic and sensitive wording
  (`src/server/creative/validate.ts`).
- Plan housing, job, credit, political, health-claim, tobacco, weapons, adult or gambling ads. These
  briefs get an explanation instead of a plan (`restrictedCategory` in `src/server/guard/brief.ts`).
- Put a real person's name or face, or another brand's name or mark, in an ad. The copy rules block
  third-party names.
- Buy media or send email by itself. The booking email is a draft for the owner to review and send.
- Promise sales. Every price and impression figure is a labelled assumption.

**Fairness note.** Taste correlates with culture, and culture correlates with geography. The business
chooses the taste anchors, Stoop shows the evidence for every neighborhood it picks, and the
restricted categories above are blocked because neighborhood choice would matter most there.
