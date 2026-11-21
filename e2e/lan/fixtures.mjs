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
  now: async ({}, use) => use(zonedInstant(todayIso(), 12)),
});

export { expect };

/** A name no other test (or retry) uses. */
export const unique = (prefix) => `${prefix} ${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

/** Open the served page at a hash and wait until the food API answered (the "+" button shows then). */
export async function openLan(page, hash = '') {
  await page.goto('/' + hash);
  await expect(page.locator('#act-btn')).toBeVisible();
}

/** Wait for the response to `method path` (a path under /api/, query ignored) and return it. */
export function apiResponse(page, method, pathname) {
  return page.waitForResponse((r) => r.request().method() === method && new URL(r.url()).pathname === pathname);
}
