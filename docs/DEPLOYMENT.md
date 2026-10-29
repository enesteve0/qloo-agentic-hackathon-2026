# Deployment (Vercel Hobby)

Stoop runs as one Next.js app on Vercel. Qloo, the language models and Redis are called only from
server code. Without keys the app runs in SYNTHETIC mock mode, so a fresh deployment always works.

## 1. Create the project

1. vercel.com/new → import `enesteve0/qloo-agentic-hackathon-2026` (a private repository is fine).
2. Framework preset: Next.js (auto-detected). Build command: default (`pnpm build`, which copies the
   MapLibre worker into `public/vendor/` first). Install command: default (`pnpm install`).
3. Project → Settings → Functions: Node.js **22.x**, region **Washington, D.C. (iad1)**. Fluid compute is
   on by default.
4. Storage → Marketplace → **Upstash for Redis** → Free plan, region us-east-1 → connect to the project
   (this injects `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` or the `KV_REST_API_*` pair).

## 2. Environment variables

Set these in Project → Settings → Environment Variables. **Production only** for the Qloo key, so
preview deployments never spend Qloo quota. Never use a `NEXT_PUBLIC_` prefix for any of them.

| Variable | Production | Preview | Notes |
|---|---|---|---|
| `QLOO_MODE` | `mock` until the key works, then `live` | `mock` | `live`, `mock`, `cache-only`, `off` |
| `QLOO_API_KEY` | the hackathon key | — | never in client code or logs |
| `QLOO_BASE_URL` | `https://hackathon.api.qloo.com` | same | |
| `LLM_MODE` | `live` once a model key is set | `mock` | |
| `GROQ_API_KEY` | console.groq.com/keys | — | first in the free chain |
| `GOOGLE_GENERATIVE_AI_API_KEY` | aistudio.google.com/apikey | — | never enable billing; EEA/CH/UK visitors are excluded in code |
| `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN` | Workers AI token | — | |
| `SAMBANOVA_API_KEY` | cloud.sambanova.ai | — | do not attach a payment method |
| `OPENROUTER_API_KEY` | openrouter.ai/settings/keys | — | free models only |
| `SESSION_SECRET` | 32+ random bytes | different value | `openssl rand -hex 32` |
| `ADMIN_TOKEN` | 24+ random characters | different value | protects `/api/admin/*` |
| `REDIS_PREFIX` | `p:` | `pv:` | keeps production and previews apart in one free database |

## 3. Firewall rule (Vercel WAF, free on Hobby)

Project → Firewall → Configure → New rule: **if** Request Path starts with `/api/runs` **and** Method is
POST **then** Rate Limit, fixed window 60 s, 20 requests, key: IP, action: 429. Stoop's own per-session
limits sit behind this and always fall back to a recorded result instead of an error page.

## 4. After each deploy

- `GET /api/health` returns `{ ok: true, qloo, ai, data, build }` (no quotas or keys).
- Open `/` and `/plan/demo`; the map shows 2,183 screens.

## 5. When the Qloo key arrives

1. Add `QLOO_API_KEY` in Vercel (Production only). Locally, put the same key in `.env.local` together with
   the production database's Upstash URL and token and `REDIS_PREFIX=p:`, so that the smoke test's quota
   ledger and `cfg:calibration` land where production reads them.
2. `pnpm qloo:smoke --dry-run` (prints the 26 planned calls, makes none), then
   `pnpm qloo:smoke --confirm` (at most 30 calls, sequential; stops on any 401 or 429).
3. Review `.private/calibration/<timestamp>/decisions.json` and summarize the choices in
   `docs/CALIBRATION.md` (configuration only, no Qloo data). The app picks up `cfg:calibration` within a
   minute.
4. Set `QLOO_MODE=live` in Production and redeploy. `/status` should say "Live".
5. Record the sample plans, one call per preset (about 10 Qloo calls each):

   ```bash
   curl -X POST "https://<domain>/api/admin/record" \
     -H "Authorization: Bearer $ADMIN_TOKEN" -H 'Content-Type: application/json' \
     -d '{"slug":"halfnote"}'
   ```

   Slugs: `halfnote`, `three-nights`, `smoke-and-sons`, `puente`, `hand-drawn`, `drop-day`. The reply lists
   the matched anchors, the top neighborhoods and the calls used; check each anchor's top neighborhoods by
   eye before keeping a recording. `GET /api/admin/health` (same header) shows every preset's state.
6. Open `/p/halfnote`: the badge should read RECORDED.
7. Run the validation backtest once (44 calls, sequential, stops on any 401/429):
   `pnpm backtest:run --dry-run`, then `QLOO_MODE=live pnpm backtest:run --confirm`. It writes summary
   statistics only to `src/content/validation.json`; commit that file. Publish the result whatever it is.

## 6. After the event

Set `QLOO_MODE=off` and redeploy, then delete the remaining Qloo-derived keys (`q1:*`, `res:*`, `run:*`,
`preset:*`, `presyn:*`) from the database. They expire on their own at `EVENT_DATA_EXPIRES_AT`.
