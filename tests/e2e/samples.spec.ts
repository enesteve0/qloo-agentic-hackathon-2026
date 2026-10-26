import { expect, test } from '@playwright/test';

test('a sample plan opens with the map, ranked neighborhoods and a provenance badge', async ({ page }) => {
  await page.goto('/p/halfnote');
  await expect(page.getByRole('heading', { level: 1, name: /Halfnote Supper Club/i })).toBeVisible();
  await expect(page.getByText(/synthetic/i).first()).toBeVisible();
  await expect(page.getByText(/taste signal/i).first()).toBeVisible();
  await expect(page.getByText(/What this map shows/i)).toBeVisible();
});

test('every ad is shown on a labelled mockup with its copy-rule check', async ({ page }) => {
  await page.goto('/p/halfnote?view=what');
  await expect(page.getByText(/Illustrative mockup/i).first()).toBeVisible();
  await expect(page.getByText(/copy rules/i).first()).toBeVisible();
});

test('the screen list of a sample plan downloads as CSV without Qloo data', async ({ request }) => {
  const res = await request.get('/api/export?preset=halfnote');
  expect(res.status()).toBe(200);
  expect(res.headers()['content-type']).toContain('text/csv');
  const body = await res.text();
  expect(body).toContain('ASSUMPTION');
  expect(body).not.toMatch(/urn:|entity_id|affinity/);
});

test('the ambiguity question offers candidates and continues the plan', async ({ page }) => {
  await page.goto('/plan/demo?state=needs-input');
  await expect(page.getByRole('heading', { name: /which one did you mean/i })).toBeVisible();
  await page.getByRole('radio').first().check();
  await page.locator('form button[type=submit]').click();
  await expect(page).toHaveURL(/view=where/);
});

test('status and health answer without exposing quotas', async ({ page, request }) => {
  const health = await (await request.get('/api/health')).json();
  expect(health).toMatchObject({ ok: true, qloo: 'mock' });
  expect(JSON.stringify(health)).not.toMatch(/remaining|quota|key/i);
  await page.goto('/status');
  await expect(page.getByRole('heading', { name: 'Status' })).toBeVisible();
});
