/* Shared E2E fixtures.
 *
 * - The browser clock is fixed to mid-morning of the synthetic demo's last day (DEMO_DEFAULTS.end), so the
 *   page shows the demo data as "today" whatever day the suite runs (the day stepper, staleness, the
 *   late-night food logic all read new Date()).
 * - Every test fails on a console error, an uncaught exception or a CSP violation: the page is meant to run
 *   clean, so these are bugs even when the asserted UI looks right. A test that provokes one on purpose (an API
 *   answering 400, which Chromium logs as "Failed to load resource") names it: `pageErrors.allow(/400/)`. */
import { test as base, expect } from '@playwright/test';
import { DEMO_DEFAULTS } from '../scripts/make-demo-data.mjs';
import { STATIC_URL, E2E_TZ } from './paths.mjs';

export const DEMO_DAY = DEMO_DEFAULTS.end;

/** The instant that is `hour`:00 on `day` in E2E_TZ, whatever the season (CET or CEST) and the host's zone. */
export function zonedInstant(day, hour) {
  const hh = String(hour).padStart(2, '0');
  const probe = new Date(`${day}T${hh}:00:00Z`);
  const name = new Intl.DateTimeFormat('en-GB', { timeZone: E2E_TZ, timeZoneName: 'longOffset' })
    .formatToParts(probe)
    .find((p) => p.type === 'timeZoneName').value; // "GMT+02:00", or "GMT" at offset 0
  return new Date(`${day}T${hh}:00:00${name.slice(3) || 'Z'}`);
}

export const DEMO_NOW = zonedInstant(DEMO_DAY, 10);

export const test = base.extend({
  // the instant the browser clock is fixed to (e2e/lan/fixtures.mjs overrides it)
  now: async ({}, use) => use(DEMO_NOW),
  page: async ({ page, now }, use) => {
    await page.clock.setFixedTime(now);
    await use(page);
  },
  pageErrors: [
    async ({ page }, use) => {
      const errors = [];
      const allowed = [];
      page.on('console', (msg) => {
        if (msg.type() === 'error') errors.push(`console: ${msg.text()}`);
      });
      page.on('pageerror', (err) => errors.push(`uncaught: ${err.message}`));
      await use({ allow: (re) => allowed.push(re) });
      const unexpected = errors.filter((e) => !(e.startsWith('console: ') && allowed.some((re) => re.test(e))));
      expect(unexpected, 'console errors, uncaught exceptions or CSP violations').toEqual([]);
    },
    { auto: true },
  ],
});

export { expect };

/** Open the static example page, optionally at a hash (`'#health'`, `'#detail/weight'`). */
export async function openStatic(page, hash = '') {
  await page.goto(STATIC_URL + hash);
  await expect(page.locator('#t-home')).toBeVisible();
}

/** The tab keys in dock order (lib/nav/tabs.mjs TAB_KEYS). */
export const TABS = ['home', 'entreno', 'health', 'nutricion'];

/** Let any asynchronous handler run before asserting that something did NOT happen. */
export const settle = (page) => page.waitForTimeout(300);

/** The hash part of the current URL. */
export const hashOf = (page) => new URL(page.url()).hash;
