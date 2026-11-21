// The profile sheet's settings and the Sync button against the real data service (docs/profile.md,
// docs/plan-page.md → Sync): the goal and the target weight are saved; Sync rebuilds the page on the server and
// reloads it. The language switch is not driven here: it rebuilds the shared page in the other locale under the
// specs running next to it.
import { test, expect, openLan, apiResponse } from './fixtures.mjs';

test('the goal and the target weight are saved from the profile sheet', async ({ page }) => {
  await openLan(page);
  await page.locator('#avatar-btn').click();
  await expect(page.locator('#detail')).toBeVisible();

  let put = apiResponse(page, 'PUT', '/api/food/settings');
  await page.locator('input[name="pf-goal"][value="maintain"]').check({ force: true });
  expect((await put).request().postDataJSON()).toMatchObject({ goal: 'maintain' });

  put = apiResponse(page, 'PUT', '/api/food/settings');
  await page.locator('#pf-target').fill('74.5');
  await page.locator('#pf-target').press('Enter');
  expect((await put).request().postDataJSON()).toMatchObject({ targetWeightKg: 74.5 });
  await expect(page.locator('#pf-target-err')).toBeEmpty();

  // a fresh load shows what the server stored
  await openLan(page, '#profile');
  await expect(page.locator('input[name="pf-goal"][value="maintain"]')).toBeChecked();
  await expect(page.locator('#pf-target')).toHaveValue('74.5');

  // an out-of-range target is refused in the page, nothing is sent
  let sent = false;
  page.on('request', (r) => {
    if (r.method() === 'PUT' && r.url().includes('/api/food/settings')) sent = true;
  });
  await page.locator('#pf-target').fill('20');
  await page.locator('#pf-target').press('Enter');
  await expect(page.locator('#pf-target-err')).not.toBeEmpty();
  expect(sent).toBe(false);
});

test('Sync rebuilds the page on the server and reloads it', async ({ page }) => {
  // a real page build
  test.setTimeout(240_000);
  await openLan(page);
  const before = await (await page.request.get('/status.json')).json();
  await page.evaluate(() => { window.__e2eBeforeSync = true; });

  const sync = apiResponse(page, 'POST', '/api/sync');
  await page.locator('#sync-btn').click();
  const res = await sync;
  expect(res.status()).toBe(202);
  const { seq } = await res.json();
  await expect(page.locator('#sync-btn')).toHaveAttribute('aria-busy', 'true');
  await expect(page.locator('#sync-msg')).not.toBeEmpty();

  await page.waitForEvent('load', { timeout: 200_000 });
  expect(await page.evaluate(() => window.__e2eBeforeSync)).toBeUndefined();
  const after = await (await page.request.get('/status.json')).json();
  expect(after.processedSeq).toBeGreaterThanOrEqual(seq);
  expect(after.publishedAt >= before.publishedAt).toBe(true);
});
