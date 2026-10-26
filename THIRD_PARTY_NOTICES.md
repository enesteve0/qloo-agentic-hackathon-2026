# Third-party notices

Stoop's own code is released under the [MIT License](LICENSE). It builds on the third-party software,
data and services below, which keep their own licenses and terms. Nothing here relicenses them.

## Data and services

| Item | Use | License / terms |
|---|---|---|
| [Qloo](https://www.qloo.com) Insights API (hackathon environment) | Taste heatmaps, entity search and neighborhood place evidence, called live from the server | Qloo Terms of Use; hackathon key for event use only. No Qloo response data is stored in this repository |
| NYC Open Data — LinkNYC Locations (`s4kf-3yrf`), 2020 Neighborhood Tabulation Areas (`9nt8-h7nd`), Borough Boundaries (`gthc-hcne`) | Street-screen inventory, neighborhoods, study area | NYC Open Data: no use restrictions; source, version and modifications are documented in [data/README.md](data/README.md). Not affiliated with or endorsed by the City of New York, LinkNYC, Intersection or CityBridge |
| [OpenFreeMap](https://openfreemap.org) tiles and styles | Basemap | OpenFreeMap terms; attribution shown on the map |
| [OpenMapTiles](https://openmaptiles.org) schema | Basemap vector schema | BSD-3-Clause (code) / CC-BY 4.0 (design); attribution shown on the map |
| [OpenStreetMap](https://www.openstreetmap.org/copyright) data | Basemap features; offline validation of brand store locations | ODbL 1.0. "© OpenStreetMap contributors". Validation publishes only summary statistics and the extraction script |

## Fonts

Barlow Condensed, Public Sans and IBM Plex Mono, served through Google Fonts via `next/font` — SIL Open
Font License 1.1.

## Reference semantics

The run envelope (`query_intent`, `resolution`, `provenance`, `execution`, `what_this_supports`) mirrors
the field semantics of Qloo's MIT-licensed [`@qloo/qloo-harness`](https://www.npmjs.com/package/@qloo/qloo-harness)
0.1.26. No harness code is copied or bundled.

## Software packages (direct dependencies)

| Package | Version | License |
|---|---|---|
| next | 16.4.3 | MIT |
| react, react-dom | 19.3.1 | MIT |
| ai (Vercel AI SDK) | 7.0.153 | Apache-2.0 |
| @ai-sdk/react, @ai-sdk/groq, @ai-sdk/google, @ai-sdk/openai-compatible | 4.0.157, 4.0.70, 4.0.105, 3.0.78 | Apache-2.0 |
| @openrouter/ai-sdk-provider | 3.1.0 | Apache-2.0 |
| @vercel/functions | 3.10.3 | Apache-2.0 |
| maplibre-gl | 6.15.0 | BSD-3-Clause |
| react-map-gl | 8.1.3 | MIT |
| ngeohash | 0.6.4 | MIT |
| zod | 4.6.7 | MIT |
| jsonrepair | 3.15.0 | ISC |
| @upstash/redis, @upstash/ratelimit | 1.39.0, 2.2.0 | MIT |
| nanoid | 6.0.2 | MIT |
| lucide-react | 1.61.0 | ISC |
| sonner | 2.0.8 | MIT |
| server-only | 0.0.1 | MIT |
| tailwindcss, @tailwindcss/postcss | 4.3.3 | MIT |

Development-only tools (not shipped to users): TypeScript (Apache-2.0), ESLint and eslint-config-next
(MIT), Vitest and Vite (MIT), Playwright (Apache-2.0), tsx (MIT), Turf (MIT), mapshaper (MPL-2.0, used
unmodified as a build tool), simple-statistics (ISC). Full license texts ship with each package in
`node_modules`.
