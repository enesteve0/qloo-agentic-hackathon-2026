# Stoop — AI media planner for NYC street screens

> Most ad tech knows where phones go. Stoop knows what neighborhoods love.

Stoop is an AI agent for small businesses. Describe your business, budget and dates. In about a minute
Stoop picks New York street screens (LinkNYC kiosks) where people with your customers' taste already
spend time, writes an ad for each neighborhood from Qloo taste evidence, fits the budget, compares its
plan with an AI that has no taste data, and drafts the booking email for you to send. Stoop never sends
or buys anything itself.

It doesn't track anyone. Qloo receives taste anchors and neighborhood shapes, never the brief or anything
about people ([data and privacy](docs/DATA_AND_PRIVACY.md)).

Built for the [Qloo Agentic Hackathon 2026](https://qloo.devpost.com/).

## Status (2026-10-26)

| | |
|---|---|
| End-to-end run | Works in **mock mode**: synthetic Qloo data and a deterministic writer, labelled SYNTHETIC everywhere |
| Live Qloo data | Waiting for the hackathon API key; the client, calibration script and contract checks are ready |
| Live AI writers | Free-tier chain (Groq, Gemini, Cloudflare Workers AI, SambaNova, OpenRouter `:free`) ready; needs provider keys |
| Public demo | Not deployed yet |
| Source | Private until submission |

## One run, seven stations

| Station | What happens | Who decides |
|---|---|---|
| Brief | Business, offer, budget, weeks, optional address (never sent to Qloo) | Owner |
| Taste | The agent proposes 2–6 taste anchors (artists, places, brands, films, shows) and matches them in Qloo; if a name is ambiguous it asks one question | Model proposes, Qloo resolves |
| Where | Qloo heatmaps for each anchor, compared with an NYC baseline (rank-based lift), scored onto 2,183 live ad-capable LinkNYC kiosks in 2020 neighborhoods | Qloo measures, code ranks |
| What | Local Qloo place evidence for the top neighborhoods; two ads per neighborhood, each phrase traced to evidence and checked against eight copy rules | Model writes, code verifies |
| Plan | Screens per dollar under per-neighborhood caps, with every price and impression figure labelled as an assumption; plus the six best free screens for LinkNYC's LinkLocal program | Code |
| Proof | The same brief planned by the AI alone, scored on the same map (with the circularity stated) | Code |
| Send | Checklist, CSV screen list, each ad as a print-ready 1080×1920 PNG, and an editable booking email that opens only after the owner confirms review | Owner |

## Run it locally (no keys needed)

```bash
pnpm install
pnpm build && pnpm start      # or: pnpm dev
# open http://localhost:3000/plan/new
```

Without keys the app uses `QLOO_MODE=mock`, `LLM_MODE=mock` and an in-memory store. See
[.env.example](.env.example) for the live settings (placeholders only) and
[docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) for Vercel.

## Checks

```bash
pnpm typecheck && pnpm lint
pnpm test                       # unit + integration (mock pipeline, run API)
pnpm build && pnpm exec playwright test   # browser end-to-end on the production build
pnpm audit:public               # secrets, Qloo data and private paths
pnpm qloo:smoke --dry-run       # the first-key calibration plan (26 calls, hard stop 30)
```

CI runs all of these on every push, plus a gitleaks scan of the full history.

## Documentation

- [Product](docs/PRODUCT.md) · [Architecture](docs/ARCHITECTURE.md) · [Data and privacy](docs/DATA_AND_PRIVACY.md)
- [Deployment](docs/DEPLOYMENT.md) · [Research and sources](docs/RESEARCH.md)
- [Submission checklist](docs/SUBMISSION.md) · [Provenance and decisions](docs/PROVENANCE.md)
- [Third-party notices](THIRD_PARTY_NOTICES.md) · [Data sources](data/README.md)

## Data and licenses

Street screens and neighborhoods come from NYC Open Data (LinkNYC Locations `s4kf-3yrf`, 2020 NTAs
`9nt8-h7nd`, Borough Boundaries `gthc-hcne`). The basemap is OpenFreeMap / OpenMapTiles,
© OpenStreetMap contributors. Taste data comes from the Qloo Insights API at run time. No Qloo response data
is stored in this repository; test fixtures are synthetic. Stoop is not affiliated with LinkNYC,
Intersection, CityBridge or the City of New York.

Code: [MIT](LICENSE). Third-party code, data and services keep their own terms.
