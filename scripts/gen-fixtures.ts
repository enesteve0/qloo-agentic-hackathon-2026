/**
 * Writes the synthetic Qloo fixtures (fixtures/qloo/synthetic.*.json) from the mock generator.
 * Synthetic only: every file carries `"_synthetic": true`; real Qloo responses never enter the repo.
 *
 *   pnpm fixtures:gen
 *
 * tests/contract checks that the committed files equal a fresh generation, so rerun this after
 * changing src/server/qloo/synthetic.ts or fixtures.ts.
 */
import { mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import path from 'node:path';

// `server-only` throws outside a React Server bundle; this script is trusted server-side tooling.
registerHooks({
  resolve: (specifier, context, nextResolve) =>
    specifier === 'server-only' ? { url: 'data:text/javascript,', shortCircuit: true } : nextResolve(specifier, context),
});

const ROOT = path.resolve(import.meta.dirname, '..');
const OUT = path.join(ROOT, 'fixtures', 'qloo');

const { buildSyntheticFixtures } = await import('@/server/qloo/fixtures');
const files = await buildSyntheticFixtures();

mkdirSync(OUT, { recursive: true });
const keep = new Set(files.map((f) => `synthetic.${f.name}.json`));
for (const existing of readdirSync(OUT)) {
  if (existing.startsWith('synthetic.') && existing.endsWith('.json') && !keep.has(existing)) rmSync(path.join(OUT, existing));
}
for (const f of files) {
  if (f.content._synthetic !== true) throw new Error(`Fixture ${f.name} is not marked synthetic`);
  writeFileSync(path.join(OUT, `synthetic.${f.name}.json`), `${JSON.stringify(f.content, null, 2)}\n`);
}
console.log(`Wrote ${files.length} synthetic fixtures to ${path.relative(ROOT, OUT)}/`);
