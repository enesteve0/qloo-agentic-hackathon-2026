// Copies browser assets that bundlers cannot resolve into public/vendor/ (git-ignored).
// MapLibre GL 6 loads its tile worker from `new URL(..., import.meta.url)`, which Turbopack does not
// preserve, so the app points MapLibre at this copied, version-pinned worker via setWorkerUrl().
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'node_modules/maplibre-gl/package.json'), 'utf8'));
const outDir = path.join(root, 'public/vendor');
fs.mkdirSync(outDir, { recursive: true });
const target = path.join(outDir, `maplibre-gl-worker-${pkg.version}.mjs`);
fs.copyFileSync(path.join(root, 'node_modules/maplibre-gl/dist/maplibre-gl-worker.mjs'), target);
console.log(`copied ${path.relative(root, target)}`);
