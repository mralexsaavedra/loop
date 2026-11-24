// Browser smoke of the Docker images (project `docker`, E2E_DOCKER_URL = loop-web of a running stack): what only
// the published images can break — nginx's headers and CSP as served, its /api proxy, the page build inside the
// loop-server container. scripts/image-smoke.sh runs it with SMOKE_BROWSER=1 after its curl checks, on the fresh
// stack it started (empty database). The flows themselves are covered in depth by e2e/lan/.
import { test, expect, openLan, unique, apiResponse, syncAndReload, SYNC_RELOAD_MS, SYNC_TEST_MS } from '../lan/fixtures.mjs';
import { openAddSheet, saveEntry } from '../lan/food-ui.mjs';

test.describe.configure({ mode: 'serial' });

test('the served page loads without console errors or CSP violations, and the first-run assistant opens', async ({ page }) => {
  const res = /** @type {import('@playwright/test').Response} */ (await page.goto('/'));
  expect(res.status()).toBe(200);
  // loop-web's security headers as served (services/loop-web/nginx.conf.template)
  expect(res.headers()).toMatchObject({
    'x-content-type-options': 'nosniff',
    'x-frame-options': 'DENY',
    'content-security-policy': "frame-ancestors 'none'",
  });
  await expect(page.locator('#detail')).toBeVisible();
  expect(new URL(page.url()).hash).toBe('#onboarding');
  // "Later" closes it for this browser
  await page.locator('#detail [data-onb-act="later"]').first().click();
  await expect(page.locator('#detail')).toBeHidden();
  await expect(page.locator('#act-btn')).toBeVisible();
});

test('a food entry is saved through nginx and the data service, then deleted', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('hc.onboarding.later', '1'));
  await openLan(page);
  await openAddSheet(page);
  const label = unique('Smoke quick');
  await page.locator('#detail [data-food-act="tab"][data-tab="quick"]').click();
  await page.locator('#fa-label').fill(label);
  await page.locator('#fa-kcal').fill('250');
  const { entry } = await (await saveEntry(page)).json();

  await page.locator('#t-nutricion').click();
  const del = page.locator(`#food-log [data-food-act="del"][data-id="${entry.id}"]`);
  await expect(del).toBeVisible();
  const deleted = apiResponse(page, 'DELETE', `/api/food/log/${entry.id}`);
  await del.click();
  expect((await deleted).status()).toBe(200);
});

test('Sync rebuilds the page inside loop-server and the page reloads', async ({ page }) => {
  // the build runs inside the loop-server container, on a CI runner (arm64 included): a wider budget than the LAN stack
  const reloadMs = SYNC_RELOAD_MS + 80_000;
  test.setTimeout(SYNC_TEST_MS + 80_000);
  await page.addInitScript(() => localStorage.setItem('hc.onboarding.later', '1'));
  await openLan(page);
  await syncAndReload(page, { reloadMs });
});
