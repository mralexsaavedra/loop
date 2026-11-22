// The profile sheet's settings and the Sync button against the real data service (docs/profile.md,
// docs/plan-page.md → Sync): the goal and the target weight are saved; Sync rebuilds the page on the server and
// reloads it. The language switch is not driven here: it rebuilds the shared page in the other locale under the
// specs running next to it.
import { test, expect, openLan, apiResponse, apiWrite, syncAndReload, withCleanup, SYNC_TEST_MS } from './fixtures.mjs';
import { settle } from '../fixtures.mjs';

test('the goal and the target weight are saved from the profile sheet', async ({ page }) => {
  // start from a goal and a target this test then changes: picking what is already stored sends nothing (the
  // shared database keeps what an earlier project or run left); what it found is put back at the end
  const res = await page.request.get('/api/food/settings', { headers: { 'X-HC-Food': '1' } });
  expect(res.status()).toBe(200);
  const found = (await res.json()).settings;
  // lan-setup stored a goal; the API cannot store "no goal" back, so a goal is required to restore it
  expect(found.goal, 'a stored goal to restore').toBeTruthy();
  await apiWrite(page, 'PUT', '/api/food/settings', 'food', { goal: 'cut', targetWeightKg: null });
  await withCleanup(() => goalAndTarget(page), () => restoreSettings(page, found));
});

/** Put the goal and the target weight back as they were (a missing target is stored as none). */
function restoreSettings(page, { goal, targetWeightKg }) {
  return apiWrite(page, 'PUT', '/api/food/settings', 'food', { goal, targetWeightKg: targetWeightKg ?? null });
}

async function goalAndTarget(page) {
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
  await settle(page);
  expect(sent).toBe(false);
}

test('Sync rebuilds the page on the server and reloads it', async ({ page }) => {
  test.setTimeout(SYNC_TEST_MS);
  await openLan(page);
  const before = await (await page.request.get('/status.json')).json();
  await syncAndReload(page, {
    whileBusy: async (p) => {
      await expect(p.locator('#sync-btn')).toHaveAttribute('aria-busy', 'true');
      await expect(p.locator('#sync-msg')).not.toBeEmpty();
    },
  });
  const after = await (await page.request.get('/status.json')).json();
  expect(after.publishedAt >= before.publishedAt).toBe(true);
});
