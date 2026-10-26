# Qloo Agentic Hackathon 2026: research

First checked **2026-10-23**; rechecked and extended **2026-10-26**. Sources are official
organizer/sponsor pages unless marked. This report summarizes them; it does not replace the official
rules. **Confirmed** = stated in a cited source; **Unverified** = not tested by us; **Unresolved** =
sources conflict.

## Event and schedule (confirmed 2026-10-26)

- Registration and submission period: Sep 30 2026 09:00 ET – **Oct 30 2026 23:45 ET** (Oct 31 06:45
  Istanbul). The schedule page shows submissions opening at 09:30 EDT; the deadline agrees.
  [Rules §1](https://qloo.devpost.com/rules), [schedule](https://qloo.devpost.com/details/dates)
- Judging: Nov 2 12:00 ET – Nov 5 23:45 ET (rules); the schedule page shows judging ending Nov 5
  09:00 EST. Plan availability through the later time. Winners "on or around Nov 5 3:00 pm ET".
  US daylight saving time ends Nov 1, so 3:00 pm EST = 23:00 Istanbul.
- **Finale:** the top 3 finalists appear live on air on Nov 5 with Jason Calacanis, Cedric the
  Entertainer and Alex Elias, who pick the winner; finalists must be available to appear and to
  prepare. [Update](https://qloo.devpost.com/updates/47166-top-3-finalists-to-appear-live-for-final-judging)
- Prizes: $15,000 / $6,000 / $4,000; one prize per project. Jason Calacanis will personally invest an
  additional $25,000 in his favorite entry (overview page).

## What must be built and submitted (confirmed)

- A working software application that integrates the Qloo API and either functions as an agentic
  tool, is built with an agent framework, or integrates Qloo into an existing agent. "If your
  submission would work the same without Qloo, you're building the wrong thing." [Overview](https://qloo.devpost.com/)
- Submit: a link to a functional demo that judges can use end to end; a public GitHub/GitLab/Bitbucket
  repository with all source, assets and instructions and an open-source licence detectable in the
  repository's About section; an English text description. A video is optional.
- The demo must be externally hosted; local-only or private-access-only demos do not qualify. The
  project must stay free and unrestricted for judges until judging ends. Organizer reply (Oct 26,
  forum topic 45690): "Judges must be able to use the submission as a live tool/app."
- Judges may judge from the text, images and video alone; judging may use expert panels, peer review
  or automated AI-driven analysis. [Rules §4, §6](https://qloo.devpost.com/rules)

## Judging (confirmed)

Stage 1 pass/fail: fits the theme and reasonably applies the Qloo API. Stage 2, equally weighted:
Technological Implementation (how thoroughly and skillfully the project uses Qloo; non-trivial
working code), Design (complete, coherent product experience), Potential Impact (credible, specific
case for a real problem and audience, addressed by what is demonstrated), Quality of the Idea
(creative, non-obvious use of Qloo; genuine understanding of the problem space). Ties are broken in
that criteria order. Listed judges: Jason Calacanis, Mike Diolosa (Qloo CTO), Nicole Seligman, Todd
Boehly, Cedric the Entertainer, Michael Abrams.

## Eligibility and existing work (confirmed)

Individuals above the local age of majority, teams and organizations; standard exclusions
(including comprehensively sanctioned countries). Existing projects must be significantly updated
with Qloo during the submission period (the clause's wording is partly corrupted on the page).
Multiple submissions must be substantially different. [Rules §3–4](https://qloo.devpost.com/rules)

## Qloo access (confirmed unless marked)

- API key via the Google form linked from the
  [developer guide](https://docs.qloo.com/reference/qloo-llm-hackathon-developer-guide) (same form as
  the Devpost Resources page). Keys are issued manually by email from hackathon@qloo.com, usually
  within a few business days; check spam; resubmit if nothing arrives.
- Base URL `https://hackathon.api.qloo.com`; header `X-Api-Key`; `GET /v2/insights` (query-string
  parameters, `filter.type` required), `/search`, `/v2/tags`, entity endpoints. Invalid parameters are
  silently ignored. Keys have rate and monthly quotas (raise via Discord #api-help); keys stay active
  through judging and are deactivated afterwards. Private server-side caching is allowed with no time
  limit; Qloo response data must not be stored in a public repository.
- Observed by other participants (unverified by us): 5 requests/second and 10,000 requests per 30-day
  window from first use (some newer keys 10/s and 50,000); errors count against the quota.
- Official kit: [qloo-hackathon-kit](https://github.com/qloo/qloo-hackathon-kit) with the
  `@qloo/qloo-harness` package (`qloo explore | exec | api | mcp`). `qloo mcp` is a local stdio server;
  "Serverless functions are not a supported route." Hosted Qloo API MCP endpoints are excluded.
- Safe use: results describe aggregate affinities; never send personal data to Qloo; do not infer
  identity, health, finances or politics; show source and limits.
  [SAFE_USE](https://github.com/qloo/qloo-hackathon-kit/blob/main/docs/SAFE_USE.md)

## Public data used by the project (confirmed 2026-10-26)

- LinkNYC kiosk locations, NYC Open Data [`s4kf-3yrf`](https://data.cityofnewyork.us/d/s4kf-3yrf)
  (updated 2026-04-02): 2,255 rows; 2,183 live, ad-capable kiosks (Link1.0 and Link5G_Ad). Its
  neighborhood field uses 2010 names.
- 2020 Neighborhood Tabulation Areas [`9nt8-h7nd`](https://data.cityofnewyork.us/d/9nt8-h7nd)
  (262 areas) and borough boundaries [`gthc-hcne`](https://data.cityofnewyork.us/d/gthc-hcne).
- NYC Open Data terms: no use restrictions; identify source and version and describe modifications;
  no warranty; do not imply city endorsement. [FAQ](https://www.nyc.gov/opendata/get-started/FAQs)
- OpenStreetMap (validation only): ODbL — publish attribution and the extraction method.
  [Licence](https://opendatacommons.org/licenses/odbl/1-0/)

## Market context (confirmed 2026-10-26)

- US out-of-home advertising revenue: $9.46B in 2025, 19 straight growth quarters; digital
  out-of-home 36.3% of 2025 revenue. [OAAA, Mar 17 2026](https://oaaa.org/news/out-of-home-advertising-revenue-reaches-record-9-46-billion/)
- Q2 2026: $3.16B (+10.7%); digital 38.4% of the quarter (+18.5%). [OAAA, Aug 18 2026](https://oaaa.org/news/from-coca-cola-to-openai-brands-are-betting-bigger-on-ooh/)
- 36.2M US small businesses. [SBA Office of Advocacy, Feb 3 2026](https://advocacy.sba.gov/2026/02/03/advocacy-releases-frequently-asked-questions-about-small-businesses-2026/)
- Qloo and JCDecaux have used Qloo taste data for hyper-localized out-of-home campaigns since 2020.
  [PR Newswire, Apr 3 2025](https://www.prnewswire.com/news-releases/qloo-and-jcdecaux-use-ai-powered-taste-data-to-deliver-hyper-localized-dooh-campaigns-302419224.html)
- LinkNYC advertising is sold by Intersection, including the LinkDirect self-serve portal and the
  free LinkLocal program for eligible community groups and small businesses. (Program details to be
  re-verified before being described in the product.)
- FTC orders against location-data brokers 2024–2026 (X-Mode/Outlogic, InMarket, Gravy
  Analytics/Venntel, Mobilewalla, Kochava). [FTC](https://www.ftc.gov/news-events/news/press-releases/2025/01/ftc-finalizes-order-prohibiting-gravy-analytics-venntel-selling-sensitive-location-data)

## Maintenance

Recheck official updates before submission (Fri Oct 30 morning). Record changes with source URL and
check date. Keep application claims tied to actual evidence and update the
[submission checklist](SUBMISSION.md). Track decisions and reused material in
[provenance](PROVENANCE.md).
