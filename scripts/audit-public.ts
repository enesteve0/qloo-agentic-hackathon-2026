/**
 * Pre-publication audit: run before the repository goes public and in CI after `pnpm build`.
 *
 *   pnpm audit:public            # tracked files + client bundle (when .next exists)
 *
 * Fails (exit 1) when it finds:
 *  - secret-shaped strings (Groq, Google, OpenRouter, GitHub, Slack, AWS, private keys) in tracked files
 *    or in the browser bundle, or the value of any secret environment variable set while it runs;
 *  - Qloo response data outside the synthetic fixtures (`entity_id` / `affinity` fields in data files);
 *  - fixture UUIDs without the synthetic prefix;
 *  - private paths (.private/, data/raw/, .env files other than .env.example) under version control;
 *  - NEXT_PUBLIC_ variables with secret-like names, or non-placeholder values in .env.example.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const SYNTHETIC_UUID_PREFIX = '5157e7c0-0000-4000-8000-';
const SECRET_ENV = [
  'QLOO_API_KEY',
  'GROQ_API_KEY',
  'GOOGLE_GENERATIVE_AI_API_KEY',
  'CLOUDFLARE_API_TOKEN',
  'SAMBANOVA_API_KEY',
  'OPENROUTER_API_KEY',
  'UPSTASH_REDIS_REST_TOKEN',
  'KV_REST_API_TOKEN',
  'SESSION_SECRET',
  'ADMIN_TOKEN',
];
const SECRET_PATTERNS: [string, RegExp][] = [
  ['Groq key', /\bgsk_[A-Za-z0-9]{20,}/],
  ['Google API key', /\bAIza[0-9A-Za-z_-]{35}\b/],
  ['OpenRouter key', /\bsk-or-(?:v1-)?[0-9a-f]{32,}/],
  ['OpenAI-style key', /\bsk-(?:proj-)?[A-Za-z0-9_-]{32,}/],
  ['GitHub token', /\bgh[pousr]_[A-Za-z0-9]{30,}/],
  ['Slack token', /\bxox[abprs]-[A-Za-z0-9-]{10,}/],
  ['AWS access key', /\bAKIA[0-9A-Z]{16}\b/],
  ['Private key', /-----BEGIN (?:RSA |EC |OPENSSH |)PRIVATE KEY-----/],
];
const TEXT_EXT = /\.(?:ts|tsx|js|mjs|cjs|json|jsonl|ndjson|md|mdx|css|html|yml|yaml|txt|csv|geojson|wkt|example|toml|svg)$/i;
const DATA_EXT = /\.(?:json|jsonl|ndjson|csv)$/i;

const problems: string[] = [];
const fail = (msg: string) => problems.push(msg);

const tracked = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' }).split('\0').filter(Boolean);
const isSyntheticFixture = (f: string) => /^fixtures\/qloo\/synthetic\.[^/]+$/.test(f);
const isTest = (f: string) => f.startsWith('tests/');

// 1. Private paths must never be tracked.
for (const f of tracked) {
  if (f.startsWith('.private/') || f.startsWith('data/raw/')) fail(`private path is tracked: ${f}`);
  if (/(^|\/)\.env(\..+)?$/.test(f) && !f.endsWith('.env.example')) fail(`env file is tracked: ${f}`);
  if (existsSync(f) && statSync(f).size > 5_000_000) fail(`file over 5 MB is tracked: ${f}`);
}

// 2. Secret values from the current environment, plus secret-shaped strings.
const secretValues = SECRET_ENV.map((name) => [name, process.env[name]] as const).filter(
  (entry): entry is readonly [string, string] => typeof entry[1] === 'string' && entry[1].length >= 12,
);
function scanText(label: string, text: string) {
  for (const [name, re] of SECRET_PATTERNS) if (re.test(text)) fail(`${name} pattern in ${label}`);
  for (const [name, value] of secretValues) if (text.includes(value)) fail(`value of ${name} found in ${label}`);
}

for (const f of tracked) {
  if (!TEXT_EXT.test(f) || !existsSync(f)) continue;
  const text = readFileSync(f, 'utf8');
  scanText(f, text);

  // 3. Qloo response data belongs only in the synthetic fixtures (and inline test cases).
  if (DATA_EXT.test(f) && !isSyntheticFixture(f) && !isTest(f) && /"(?:entity_id|affinity_rank|affinity)"\s*:/.test(text)) {
    fail(`Qloo-shaped data outside fixtures/qloo/synthetic.*: ${f}`);
  }

  // 4. Fixture UUIDs must carry the synthetic prefix.
  if (f.startsWith('fixtures/qloo/')) {
    for (const m of text.matchAll(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi)) {
      if (!m[0].toLowerCase().startsWith(SYNTHETIC_UUID_PREFIX)) {
        fail(`non-synthetic UUID ${m[0]} in ${f}`);
        break;
      }
    }
  }

  // 5. No secrets exposed to the browser through NEXT_PUBLIC_ names.
  if (/^(src|app)\//.test(f) && /NEXT_PUBLIC_[A-Z0-9_]*(?:KEY|TOKEN|SECRET|PASSWORD)/.test(text)) {
    fail(`secret-like NEXT_PUBLIC_ variable in ${f}`);
  }
}

// 6. .env.example holds placeholders only.
if (existsSync('.env.example')) {
  for (const line of readFileSync('.env.example', 'utf8').split('\n')) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (!m) continue;
    const [, name, value] = m as unknown as [string, string, string];
    if (SECRET_ENV.includes(name) && value.trim() !== '' && !/^(?:<.*>|(?:your|replace)[-_].*|changeme|x+)$/i.test(value.trim())) {
      fail(`.env.example has a non-placeholder value for ${name}`);
    }
  }
}

// 7. The browser bundle (after `pnpm build`).
function* walk(dir: string): Generator<string> {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(p);
    else if (/\.(?:js|css|html|json|txt)$/.test(entry.name)) yield p;
  }
}
const bundleDir = join('.next', 'static');
let bundleFiles = 0;
if (existsSync(bundleDir)) {
  for (const f of walk(bundleDir)) {
    bundleFiles += 1;
    scanText(f, readFileSync(f, 'utf8'));
  }
}

const summary = `${tracked.length} tracked files, ${bundleFiles} bundle files${existsSync(bundleDir) ? '' : ' (no .next build: run pnpm build first)'}`;
if (problems.length) {
  console.error(`audit:public FAILED (${summary})`);
  for (const p of [...new Set(problems)]) console.error(`  - ${p}`);
  process.exit(1);
}
console.log(`audit:public passed (${summary}).`);
