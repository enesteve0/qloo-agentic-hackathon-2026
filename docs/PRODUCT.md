# Stoop — product specification

> Most ad tech knows where phones go. Stoop knows what neighborhoods love.

Stoop is an AI media planner for New York City street screens. A small business describes itself
and its budget; in about a minute the agent picks which ad-capable street screens to use, writes an
ad for each neighborhood, and shows the Qloo taste evidence behind every choice. Nothing about any
person is tracked or sent to Qloo.

Status: specification for the hackathon build (started 2026-10-26). Claims about what works are made
only in the README and submission once verified.

## 1. Problem and audience

**Hero scene (illustrative composite — always labelled as such).** Tasha Reid opens *Halfnote
Supper Club* (fictional: 48 seats, live jazz, Nostrand Av & Fulton St, Bed-Stuy) on Nov 19 with
$2,000 left for launch ads over 21 days. Her options today:

- a self-serve screen marketplace that shows thousands of screen dots and traffic counts but has no
  notion of *fit*;
- a general chatbot that suggests the busiest corners (Times Square, SoHo);
- social-media boosts she already runs.

Stoop answers one decision: **which 15–25 ad-capable screens, in which 3–5 neighborhoods, saying
what, for $X over N days — and why.**

**Buyers.** NYC small businesses (hero) · independent venues, promoters and comedy clubs (per show)
· museums and cultural organisations (per exhibition) · boutique agencies (white-label plans) ·
self-serve screen platforms and media owners (embedded "Plan with Stoop").

**Paths to buy.** Paid: Intersection's LinkDirect self-serve portal lets buyers pick specific
screens and dates; LinkNYC inventory is also sold programmatically. Free: LinkNYC's LinkLocal program
lets eligible NYC small businesses and community organizations run ads on six screens at a time at no
cost (over $4 million of free space in 2024, per Intersection, May 1 2025; see docs/RESEARCH.md). Stoop
names neither program as a partner and never claims eligibility on the owner's behalf.

**Division of labour.** The language model proposes taste anchors and writes copy. Qloo measures
taste. Code ranks screens, enforces caps and copy rules, and allocates the budget. The owner
approves and sends.

## 2. The flow: seven stations

`BRIEF → TASTE → WHERE → WHAT → PLAN → PROOF → SEND`

| Station | What happens | Notes |
|---|---|---|
| BRIEF | Business, offer, budget, dates, optional address | The address and brief text are never sent to Qloo |
| TASTE | Agent proposes 2–5 Qloo anchors (artists, places, brands, films/TV, people, podcasts) | Ambiguity → one "Quick check: which one did you mean?" screen (max one per run, enforced in code) |
| WHERE | Qloo heatmap lift vs an NYC baseline, mapped onto 2,183 live ad-capable LinkNYC kiosk locations, grouped by 2020 neighborhoods | Map + ranked list; "skipped" busy-but-wrong areas (P1) |
| WHAT | Per top neighborhood: Qloo neighborhood taste evidence → two ad variants on portrait screen mockups | Evidence sits beside the ad, never inside it |
| PLAN | Deterministic budget optimizer with labelled assumptions | Instant recalculation, no AI or Qloo call |
| PROOF | Same brief, same budget, same AI model — one plan had Qloo | Circularity disclosed; independent validation on `/validation` |
| SEND | Checklist, editable booking email (mailto), CSV screen list, creatives, print/PDF | "Stoop drafts. You send." Nothing is sent or bought automatically |

**Why it is an agent.** It plans its own taste anchors from a plain-language brief, calls Qloo
tools, decides which maps to trust (default-map, density-only and thin-signal checks, narrated),
asks the human only when ambiguity would change the result, verifies its own output (grounding
validator, copy rules, LLM-only comparison) and follows through with a booking package the owner
approves.

## 3. Provenance labels (everywhere)

| Badge | Meaning (tooltip) |
|---|---|
| LIVE · model | Computed just now: Qloo and the AI model were called for this run |
| CACHED · time | Qloo results reused from our private cache (fetched {time}); the plan was computed now |
| RECORDED · date | A real live run recorded {date}, replayed exactly. Press Run live to redo it |
| TEMPLATE | AI writers were busy, so this copy was assembled by rules from the same Qloo evidence |
| ASSUMPTION | Not data. A labelled estimate you can change |
| SYNTHETIC | Demo data generated locally; not Qloo data (only before the Qloo key is active) |

The badge appears per run (header), per step (agent log) and per figure (impressions, costs).

## 4. Screens and routes

| Route | Purpose |
|---|---|
| `/` | Landing: tagline, 15-second loop from a real recorded run, "Open a sample plan" (RECORDED) and "Plan my campaign" (LIVE), presets, how-it-works strip, privacy line, credits |
| `/plan/new` | Brief form (also embedded on the landing page) |
| `/plan/[runId]?view=where\|what\|plan\|proof\|send` | Run view: agent ticker + canvas while streaming, then the seven stations |
| `/p/[slug]` | Preset: opens its recorded run |
| `/validation` | Validation: do Qloo taste maps know where chains open stores? |
| `/how-it-works` | `#method #data #privacy #limits #labels #fairness` |
| `/judges` | 60-second path, what is live vs recorded, fair-use note |
| `/status` | Public health: mode, Qloo reachability, AI writers, cache warmth, data snapshot dates, build SHA |

**State rules (all screens).** Loading skeletons say what is happening (no bare spinners). Partial
results stream in (heat → kiosks → list). Degraded = amber banner stating what fell back and what
still holds. Empty = one sentence why plus 2–3 one-click fixes. Error = what happened, brief saved,
Retry and "Open a recorded plan" — never a dead end or stack trace. Limits reached = presets and
cached plans with a banner saying when live runs resume.

**Copy rules.** Voice: a sharp New York media buyer who respects small owners; short sentences;
numbers with units. Use: neighborhood, screens, taste, over-indexes, evidence, assumption, approve.
Never: track, target people, audience profile, guaranteed, ROI, "AI magic", demographic labels,
"fans live here" (heatmaps measure where a taste signal concentrates, not where people live).

## 5. Ad creative rules (enforced in code)

- No third-party names, logos or likenesses; no demographic references; one message per ad.
- Headline ≤ 38 characters (≤ 6 words), body ≤ 90, call to action ≤ 22; no emoji.
- Every local reference points to an evidence item from that neighborhood's Qloo evidence pack.
- No other neighborhood's name; no invented numbers (digits must come from the offer or the business
  name; the owner's own description counts for plain facts such as seats or hours, never for prices or
  discounts).
- Text contrast ≥ 7:1 on the mockup; mockups are labelled "Illustrative mockup. Not affiliated
  with LinkNYC, Intersection or CityBridge."
- Restricted categories are refused: political, housing, employment, credit and health-claim ads.

## 6. Visual design — "the block at night"

Signage, not dashboards: NYC street-name plates, subway countdown-clock LED amber, wet asphalt. The
map is always in night mode.

| Token | Light | Dark |
|---|---|---|
| bg | `#F4F2ED` | `#0E0F11` |
| surface / surface-2 | `#FBFAF7` / `#E9E5DC` | `#17191C` / `#22252A` |
| text / muted | `#121315` / `#4A4D52` | `#F2F0EA` / `#A6A9AE` |
| border | `#8E897D` | `#6B7078` |
| sign green | `#00653F` (white text) | `#00804F` (white text) |
| amber | fill `#F2B705`, text `#7A5200` | `#FFB547` |
| link | `#0A58A8` | `#7CC0FF` |
| danger | `#B3261E` | `#FF6B5E` |
| heat (viridis) | — | `#3B528B → #21918C → #5EC962 → #FDE725`; lift < 1 transparent |

Typography (SIL OFL): Barlow Condensed 600/700 for signs, headings, ticker and ad headlines
(uppercase, +2% tracking); Public Sans 400/600 for body and UI; IBM Plex Mono 400 for IDs, trace
and table numbers. Scale 14/16/20/28/40/64 on an 8 px grid. Hard edges, 2 px rules, asymmetric
grid, numbers as heroes. Avoid purple gradients, glassmorphism, sparkle icons, chat bubbles as the
main UI, emoji, and transit route-bullet look-alikes.

Motion: 120 ms micro, 240 ms panels, 700 ms map fly-to, `cubic-bezier(0.2,0,0,1)`; ticker text
rolls in; selected kiosks "ping" with a 20 ms stagger (max 25); ads cross-fade A/B every 6 s with a
pause control. Reduced motion disables all of it.

**Screen mockup.** 1080×1920 (9:16) canvas in a dark bezel on a generic plinth (not a copy of the
real kiosk silhouette); a green street-name plate showing the real cross streets from the dataset;
96 px safe margins; headline zone top 45% (≤3 lines); footer with business name, offer, address and
an optional QR code carrying only a campaign-level UTM.

## 7. Accessibility (WCAG 2.2 AA) and mobile

Map has an equivalent list; kiosks are not individually focusable; zoom/pan buttons (no drag-only
interactions). Colour is never the only carrier of meaning (lift printed as "2.3×"). Text ≥ 4.5:1,
UI ≥ 3:1. Polite `aria-live` for station changes only. Pause controls for moving content. Visible
2 px focus ring not hidden by sticky bars. Targets ≥ 24×24 px. No CAPTCHA, no timers. Reflow at
320 px and 200% zoom; skip link; one H1 per page. Mockup alt text = the ad copy + "illustrative
mockup". Tests: axe + Lighthouse ≥ 95, keyboard-only full run, VoiceOver pass.

Mobile (test 360×800, 390×844): station rail as horizontal chips; ticker collapses to one status
line; agent log as a bottom sheet; map at 45% viewport height above the list; mockups as a swipe
carousel with buttons; sticky bottom call to action.

## 8. Demo presets (anchors confirmed with Qloo `/search` once the key works)

| Slug | Brief | Budget · dates | Anchors (alternates) |
|---|---|---|---|
| `halfnote` (hero) | Halfnote, a 48-seat jazz supper club opening on Nostrand Ave in Bed-Stuy; Tuesday jam nights, soul-food menu | $2,000 · Nov 16–Dec 6 | Robert Glasper, Esperanza Spalding, Blue Note Jazz Club, *Soul* (2020) (Kamasi Washington, Erykah Badu, *Whiplash*) |
| `three-nights` | Dee Marcus (fictional comic): a 3-night run at a 300-seat Manhattan club; 900 seats to sell in 14 days | $3,000 · Nov 9–22 | *The Original Kings of Comedy*, *Barbershop*, *Def Comedy Jam*, *The Neighborhood* (*Martin*, *Friday*, *Chappelle's Show*) |
| `smoke-and-sons` | Smoke & Sons, a St. Louis-style BBQ pop-up in Gowanus, two weekends | $1,200 · Nov 13–22 | Hometown Bar-B-Que, Nelly, *Chef's Table: BBQ*, *Diners, Drive-Ins and Dives* (*Ugly Delicious*, Franklin Barbecue) |
| `puente` | Puente Presents (fictional): 1,800-cap Brooklyn show for an alt-Latin pop band; 10-day presale push | $5,000 · Nov 12–21 | The Marías, Cuco, Rosalía, Bad Bunny (Kali Uchis, Omar Apollo) |
| `hand-drawn` | Queensboro Animation House (fictional, Astoria): "Hand-Drawn" exhibition, 6 weeks | $4,000 · Nov 15–Dec 27 | *Spirited Away*, Hayao Miyazaki, *Adventure Time*, *Avatar: The Last Airbender* (*Spider-Verse*, Cartoon Network) |
| `drop-day` | Corner Office (fictional agency): 7-day sneaker collab drop for a Lower East Side streetwear shop | $7,500 · Nov 20–26 | Kith, Aimé Leon Dore, Air Jordan, A$AP Rocky (Supreme, Travis Scott) |

Presets are real live runs recorded after the prompt freeze and stored only in the private cache,
labelled RECORDED with date, Qloo call count and model. "Run live" re-executes. New briefs always
run live within fair-use limits. The final hero is the scenario with the clearest *honest*
Qloo-vs-LLM difference after the first live runs.

## 9. Judge paths

**60 seconds:** landing loop (real recorded run) → Halfnote preset (WHERE: screens, neighborhoods,
legend) → top neighborhood (WHAT: two ads + evidence chips) → PROOF (LLM-only vs Stoop + circularity
note) → Run live (watch the Qloo calls stream).

**Check it in 2 minutes:** open the demo (no login) → Halfnote preset → #1 neighborhood and an
evidence chip → PROOF → type your own brief (e.g. "Ramen counter in Astoria, $1,000, 2 weeks") and
answer the one question if asked → open the agent log → visit `/validation`, `/how-it-works#limits`,
`/status`.

## 10. What Stoop will not do

- Track people: no device IDs, location trails, ad cookies or third-party trackers.
- Send anything about the user to Qloo: Qloo receives entity IDs, tag types and NYC polygons only.
- Infer race, ethnicity, religion, health, sexuality or politics, or use audience segments to choose
  neighborhoods.
- Plan political, housing, employment, credit or health-claim ads.
- Put a real person's name or face, or another brand's mark, into an ad.
- Buy media or send email by itself.
- Promise sales: prices and impressions are labelled assumptions.

**Fairness note.** Taste correlates with culture, and culture with geography. Stoop reports what
neighborhoods love; the business chooses the anchors; restricted categories are blocked.

**Known limitations.** NYC only; kiosk locations come from an NYC Open Data snapshot (availability
and per-screen buying depend on the seller); heatmaps are relative signals at roughly
neighborhood-block resolution and thin anchors produce noisy maps (flagged in the UI); copy checks
catch rule violations, not blandness; free AI tiers can run out (templates take over); validation is
small and partly circular for each brand's own map; no campaign has run yet.

## 11. Business model (all figures projected)

Small businesses plan free; a 12% fee on media booked through partner sellers ($240 on a $2,000
flight; agencies traditionally take ~15%). Screen platforms pay per plan or a revenue share to embed
planning. Agencies pay per seat. Pilot design: split each budget between a Stoop plan and
run-of-network, measured by offer-code redemptions — an outcome measured without tracking anyone.
