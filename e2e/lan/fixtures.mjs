/* Fixtures for the LAN specs (e2e/lan/): the page a real data service serves (e2e/lan/stack.mjs).
 *
 * The browser clock is fixed to 12:00 (E2E_TZ) of the REAL current day, not the demo's: the data service
 * stores what the page sends against its own calendar, and noon keeps the page away from its clock-dependent
 * branches (the food log opens on yesterday before 04:00, the meal is guessed from the hour).
 *
 * Every LAN spec shares one database (the stack is started once per run): name what you create with
 * `unique()` and assert on your own rows, never on counts. */
import { test as base, expect, zonedInstant } from '../fixtures.mjs';
import { E2E_TZ } from '../paths.mjs';

/** Today's date (YYYY-MM-DD) in E2E_TZ. */
export const todayIso = () => new Intl.DateTimeFormat('en-CA', { timeZone: E2E_TZ }).format(new Date());

export const test = base.extend({
  // every test is its own client of the data service (its own rate-limit budget, like one phone): see stack.mjs
  context: async ({ context }, use, testInfo) => {
    await context.setExtraHTTPHeaders({ 'x-e2e-client': testInfo.testId });
    await use(context);
  },
  // the day the test runs on, read once: a test crossing midnight still compares against one day
  today: async ({}, use) => use(todayIso()),
  now: async ({ today }, use) => use(zonedInstant(today, 12)),
});

export { expect };

/** A name no other test (or retry) uses. */
export const unique = (prefix) => `${prefix} ${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

/** Open the served page at a hash and wait until the food API answered (the "+" button shows then). */
export async function openLan(page, hash = '') {
  await page.goto('/' + hash);
  await expect(page.locator('#act-btn')).toBeVisible();
}

/** A write straight to the data service (no Origin: the service's LAN trust model, like curl), for clean-up
 * that must run even when the UI steps failed. `kind` 'food' or 'journal' picks the required X-HC-* header. */
export async function apiWrite(page, method, pathname, kind, data) {
  const header = kind === 'journal' ? 'X-HC-Journal' : 'X-HC-Food';
  const res = await page.request.fetch(pathname, { method, headers: { [header]: '1' }, data });
  expect(res.status(), `${method} ${pathname}: ${await res.text()}`).toBeLessThan(300);
  return res;
}

/** How long a Sync may take: POST /api/sync, a real page build on the server, the page's 5 s status polling, the
 * reload. SYNC_TEST_MS is the timeout of a test that waits for one (the reload's budget plus the steps around it). */
export const SYNC_RELOAD_MS = 200_000;
export const SYNC_TEST_MS = SYNC_RELOAD_MS + 40_000;

/**
 * Press Sync and wait until the server has rebuilt the page and the page reloaded itself (docs/plan-page.md → Sync):
 * POST /api/sync answers 202 {seq}, the load event fires (listened for before the click, so a fast rebuild cannot
 * reload unseen), a marker set before the click is gone (a real reload, not the same document) and status.json
 * reports a processedSeq at least `seq`. `whileBusy(page)` runs between the 202 and the reload. Returns { seq }.
 */
export async function syncAndReload(page, { reloadMs = SYNC_RELOAD_MS, whileBusy = async () => {} } = {}) {
  await page.evaluate(() => { window.__e2eBeforeSync = true; });
  const reloaded = page.waitForEvent('load', { timeout: reloadMs });
  const posted = apiResponse(page, 'POST', '/api/sync');
  await page.locator('#sync-btn').click();
  const res = await posted;
  expect(res.status()).toBe(202);
  const { seq } = await res.json();
  await whileBusy(page);
  await reloaded;
  expect(await page.evaluate(() => window.__e2eBeforeSync)).toBeUndefined();
  const status = await (await page.request.get('/status.json')).json();
  expect(status.processedSeq).toBeGreaterThanOrEqual(seq);
  return { seq };
}

/** Wait for the response to `method path` (a path under /api/, query ignored) and return it. */
export function apiResponse(page, method, pathname) {
  return page.waitForResponse((r) => r.request().method() === method && new URL(r.url()).pathname === pathname);
}
