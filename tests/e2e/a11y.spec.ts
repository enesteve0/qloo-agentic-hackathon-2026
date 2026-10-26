import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

const PAGES = [
  '/',
  '/how-it-works',
  '/judges',
  '/plan/new',
  '/p/halfnote',
  '/p/halfnote?view=what',
  '/p/halfnote?view=plan',
  '/p/halfnote?view=proof',
  '/p/halfnote?view=send',
  '/plan/demo?state=needs-input',
  '/status',
];

for (const path of PAGES) {
  test(`no serious accessibility violations on ${path}`, async ({ page }) => {
    await page.goto(path);
    // Not 'networkidle': link prefetches keep the network busy. Give client components a moment to render.
    await page.waitForLoadState('load');
    await page.waitForTimeout(1500);
    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
      // The WebGL map canvas is decorative; its content is repeated in the neighborhood list.
      .exclude('.maplibregl-canvas')
      .analyze();
    const serious = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
    expect(
      serious.map((v) => `${v.id} (${v.impact}): ${v.nodes.length} × ${v.nodes[0]?.target.join(' ')} — ${v.help}`),
    ).toEqual([]);
  });
}
