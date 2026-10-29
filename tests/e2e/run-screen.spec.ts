import { expect, test } from '@playwright/test';

test('the station rail switches views in place and keeps them addressable', async ({ page }) => {
  await page.goto('/p/halfnote');
  const rail = page.getByRole('navigation', { name: 'Plan stations' });
  await rail.getByRole('link', { name: /Proof/ }).click();
  await expect(page).toHaveURL(/view=proof/);
  await expect(page.getByRole('heading', { level: 2, name: /One of them had Qloo/i })).toBeVisible();
  await expect(rail.getByRole('link', { name: /Proof/ })).toHaveAttribute('aria-current', 'page');
});

test('the agent log lists every Qloo request and copies a redacted trace', async ({ page }) => {
  await page.goto('/p/halfnote');
  await page.getByRole('button', { name: 'Agent log', exact: true }).click();
  const drawer = page.getByRole('dialog', { name: 'Agent log' });
  await expect(drawer).toBeVisible();
  await drawer.getByRole('button', { name: /Qloo requests/ }).click();
  await expect(drawer.getByText(/POLYGON\(/).first()).toBeVisible();
  await expect(drawer.getByRole('button', { name: /Copy redacted trace/ })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(drawer).toBeHidden();
});

test('each ad downloads as a print-ready PNG', async ({ page }) => {
  await page.goto('/p/halfnote?view=what');
  const link = page.getByRole('link', { name: /Download ad A .*PNG, 1080×1920/ }).first();
  await expect(link).toBeVisible();
  const res = await page.request.get((await link.getAttribute('href'))!);
  expect(res.status()).toBe(200);
  expect(res.headers()['content-type']).toContain('image/png');
});

test('the landing page leads to a plan, the samples and the judges’ tour', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('link', { name: /Plan my campaign/i })).toHaveAttribute('href', '/plan/new');
  await expect(page.getByRole('link', { name: /Open a sample plan/i })).toHaveAttribute('href', '/p/halfnote');
  await expect(page.getByRole('link', { name: /60-second tour/i })).toHaveAttribute('href', '/judges');
  await expect(page.locator('a[href^="/p/"]')).not.toHaveCount(0);
});

test('pages declare tab and home-screen icons that load', async ({ page, request }) => {
  await page.goto('/');
  for (const rel of ['icon', 'apple-touch-icon']) {
    const href = await page.locator(`link[rel="${rel}"]`).first().getAttribute('href');
    const res = await request.get(href ?? '');
    expect(res.status()).toBe(200);
    expect(res.headers()['content-type']).toContain('image/png');
  }
});

test.describe('on a phone', () => {
  test.use({ viewport: { width: 360, height: 800 } });
  for (const path of ['/p/halfnote', '/p/halfnote?view=plan', '/how-it-works', '/judges', '/']) {
    test(`${path} has no sideways scrolling`, async ({ page }) => {
      await page.goto(path);
      await page.waitForLoadState('load');
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow).toBeLessThanOrEqual(0);
    });
  }
});
