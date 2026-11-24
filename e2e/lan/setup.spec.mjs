// First run on an empty server (docs/onboarding.md, web/src/client/onboarding.js): the assistant opens by itself,
// walks every screen, saves the profile and the goal, and its Sync rebuilds and reloads the page. Project
// `lan-setup`: every other LAN spec runs after it, against a server that has a profile. A retry after the save
// went through (a slow rebuild timed out) finds that profile: it checks what was stored and proves the rebuild
// again with the Sync button, so the LAN specs that depend on it still run and a broken rebuild still fails.
import { test, expect, apiResponse, syncAndReload, SYNC_RELOAD_MS, SYNC_TEST_MS } from './fixtures.mjs';

/** @param {import('@playwright/test').Page} page */
const sheet = (page) => page.locator('#detail');
/** @param {import('@playwright/test').Page} page */
const next = (page) => page.locator('#detail [data-onb-act="next"]');

test('the first-run assistant saves the profile and the goal, then the page rebuilds', async ({ page }) => {
  // the save's Sync waits for a real page build
  test.setTimeout(SYNC_TEST_MS);
  const existing = await page.request.get('/api/food/profile', { headers: { 'X-HC-Food': '1' } });
  if ((await existing.json()).profile && test.info().retry > 0) {
    test.info().annotations.push({ type: 'retry', description: 'the profile was saved by an earlier attempt' });
    const stored = await page.request.get('/api/food/settings', { headers: { 'X-HC-Food': '1' } });
    expect(await stored.json()).toMatchObject({ settings: { goal: 'cut', targetWeightKg: 76 } });
    await page.goto('/');
    await expect(page.locator('#act-btn')).toBeVisible();
    await expect(sheet(page)).toBeHidden();
    await syncAndReload(page);
    return;
  }
  await page.goto('/');
  await expect(sheet(page)).toBeVisible();
  expect(new URL(page.url()).hash).toBe('#onboarding');

  await next(page).click(); // welcome
  await page.locator('#onb-name').fill('E2E Runner');
  await next(page).click();
  await page.locator('input[name="onb-sex"][value="male"]').check({ force: true });
  await next(page).click();
  await page.locator('#onb-birthdate').fill('1990-05-10');
  await next(page).click();
  await page.locator('#onb-heightCm').fill('178');
  await next(page).click();
  await page.locator('#onb-weightKg').fill('80');
  await next(page).click();
  await page.locator('input[name="onb-activity"][value="active"]').check({ force: true });
  await next(page).click();
  await page.locator('input[name="onb-sport"][value="strength"]').check({ force: true });
  await next(page).click();
  // the sport's screen: its defaults (60 min, 3 a week) stand
  await next(page).click();
  // the safety screen: none of the boxes applies
  await expect(page.locator('#detail [data-onb-field="medical"]')).toBeVisible();
  await next(page).click();

  // goal → target weight (a cut asks for one) → summary → data, whose button saves
  await page.locator('input[name="onb-goal"][value="cut"]').check({ force: true });
  await next(page).click();
  await page.locator('#detail [data-onb-field="target"]').fill('76');
  await next(page).click();
  await next(page).click(); // summary
  await expect(page.locator('#detail [data-onb-act="save"]')).toBeVisible();

  const profile = apiResponse(page, 'PUT', '/api/food/profile');
  const settings = apiResponse(page, 'PUT', '/api/food/settings');
  const sync = apiResponse(page, 'POST', '/api/sync');
  // listening before the click: the reload cannot come and go unseen
  const reloaded = page.waitForEvent('load', { timeout: SYNC_RELOAD_MS });
  await page.locator('#detail [data-onb-act="save"]').click();
  expect((await profile).status()).toBe(200);
  expect((await settings).status()).toBe(200);
  expect((await sync).status()).toBe(202);
  await expect(sheet(page)).toBeHidden();

  // the Sync the save pressed rebuilds the page and reloads it once status.json reports the new seq
  await reloaded;
  await expect(page.locator('#act-btn')).toBeVisible();
  // a profile now exists: the assistant no longer opens by itself
  await expect(sheet(page)).toBeHidden();
  const stored = await page.request.get('/api/food/settings', { headers: { 'X-HC-Food': '1' } });
  expect(await stored.json()).toMatchObject({ settings: { goal: 'cut', targetWeightKg: 76 } });
});
