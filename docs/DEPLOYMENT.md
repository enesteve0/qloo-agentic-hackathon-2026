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
| `SHARING_ENABLED` | `false` (enable later) | `false` | share pages are derived-only |

## 3. Firewall rule (Vercel WAF, free on Hobby)

Project → Firewall → Configure → New rule: **if** Request Path starts with `/api/runs` **and** Method is
POST **then** Rate Limit, fixed window 60 s, 20 requests, key: IP, action: 429. Stoop's own per-session
limits sit behind this and always fall back to a recorded result instead of an error page.

## 4. After each deploy

- `GET /api/health` returns `{ ok: true, qloo, ai, data, build }` (no quotas or keys).
- Open `/` and `/plan/demo`; the map shows 2,183 screens.
- After the Qloo key arrives: run `pnpm qloo:smoke --dry-run`, then `--confirm` locally with the key in
  `.env.local`, record the decisions in `docs/CALIBRATION.md`, switch `QLOO_MODE=live` in Production and
  redeploy.
