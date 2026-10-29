import { expect, test, type Page } from '@playwright/test';

/** Letters only: digit runs in a business name are removed as possible phone numbers. */
const uniq = () => Math.random().toString(36).replace(/[^a-z]/g, '').slice(0, 6);

/** The ticker headline that only a finished plan shows (stage titles also say "Plan ready"). */
const finished = (page: Page) => page.getByText(/Plan ready · \d+ screens?/).filter({ visible: true }).first();

test('a new brief streams to a finished plan that survives a reload and exports', async ({ page }) => {
  await page.goto('/plan/new');
  await page.getByRole('button', { name: /Jazz supper club/i }).click();
  await page.getByLabel('Business name').fill(`Halfnote Supper Club ${uniq()}`);
  await page.getByRole('button', { name: /Plan my campaign/i }).click();

  await expect(page).toHaveURL(/\/plan\/[a-z0-9]{12}/, { timeout: 30_000 });
  await expect(finished(page)).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText(/synthetic/i).first()).toBeVisible();

  // A reload renders the saved run from the server.
  await page.reload();
  await expect(page.getByRole('heading', { level: 1, name: /Halfnote Supper Club/i })).toBeVisible();
  await expect(page.getByText(/taste signal/i).first()).toBeVisible();

  // SEND: booking draft with the CSV of the planned screens.
  await page.goto(`${page.url().split('?')[0]}?view=send`);
  const csv = page.getByRole('link', { name: /screen list/i });
  await expect(csv).toBeVisible();
  const res = await page.request.get((await csv.getAttribute('href'))!);
  expect(res.status()).toBe(200);
  const body = await res.text();
  expect(body).toContain('siteId,address,cross streets,borough');
  expect(body).not.toMatch(/urn:|entity_id|affinity/);
});

test('a budget that buys no screen says why and leads back to a new brief', async ({ page }) => {
  await page.goto('/plan/new');
  await page.getByLabel('Business name').fill(`Corner Bakery ${uniq()}`);
  await page.getByLabel('What you do').fill('A neighborhood bakery with sourdough, sweet treats and a sunny window counter.');
  await page.getByLabel(/Budget/i).first().fill('100');
  await page.getByRole('button', { name: /Plan my campaign/i }).click();
  await expect(page.getByText('Done · no screens fit this budget').filter({ visible: true }).first()).toBeVisible({ timeout: 60_000 });

  await page.getByRole('navigation', { name: 'Plan stations' }).getByRole('link', { name: /Plan/i }).first().click();
  await expect(page.getByRole('heading', { name: /No screens fit this budget/i })).toBeVisible();
  // The live run rewrote the URL in place; this link must still open a fresh brief form.
  await page.getByRole('link', { name: 'Start a new brief' }).click();
  await expect(page).toHaveURL(/\/plan\/new$/);
  await expect(page.getByRole('button', { name: /Plan my campaign/i })).toBeVisible();
});

test('briefs Stoop will not plan get a reason instead of a plan', async ({ page }) => {
  await page.goto('/plan/new');
  await page.getByLabel('Business name').fill('Park Lofts');
  await page.getByLabel('What you do').fill('Two-bedroom apartments for rent near the park, move in this month.');
  await page.getByRole('button', { name: /Plan my campaign/i }).click();
  await expect(page.getByRole('alert').filter({ hasText: /fair-housing/i })).toBeVisible();
  await expect(page).toHaveURL(/\/plan\/new/);
  // The refused brief stays in the form, ready to edit.
  await expect(page.getByLabel('Business name')).toHaveValue('Park Lofts');
});

test('a visitor over the live-run limit gets a labelled sample plan, not an error page', async ({ page }) => {
  test.setTimeout(150_000);
  const stamp = uniq();
  for (let i = 1; i <= 4; i++) {
    await page.goto('/plan/new');
    await page.getByLabel('Business name').fill(`Corner Bakery ${stamp}-${i}`);
    await page.getByLabel('What you do').fill('A neighborhood bakery with sourdough, sweet treats and a sunny window counter.');
    await page.getByRole('button', { name: /Plan my campaign/i }).click();
    await expect(finished(page)).toBeVisible({ timeout: 60_000 });
  }
  // The fourth run in 15 minutes is over the per-session limit.
  await expect(page.getByText(/live runs are paused for now/i)).toBeVisible();
  await expect(page.getByRole('heading', { level: 1 })).not.toContainText(/Corner Bakery/i);
});
