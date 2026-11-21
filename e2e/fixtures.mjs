/* Shared E2E fixtures.
 *
 * - The browser clock is fixed to mid-morning of the synthetic demo's last day (DEMO_DEFAULTS.end), so the
 *   page shows the demo data as "today" whatever day the suite runs (the day stepper, staleness, the
 *   late-night food logic all read new Date()).
 * - Every test fails on a console error, an uncaught exception or a CSP violation: the page is meant to run
 *   clean, so these are bugs even when the asserted UI looks right. */
import { test as base, expect } from '@playwright/test';
import { DEMO_DEFAULTS } from '../scripts/make-demo-data.mjs';
import { STATIC_URL } from './paths.mjs';

export const DEMO_DAY = DEMO_DEFAULTS.end;
export const DEMO_NOW = new Date(`${DEMO_DAY}T10:00:00+02:00`);

export const test = base.extend({
  page: async ({ page }, use) => {
    await page.clock.setFixedTime(DEMO_NOW);
    await use(page);
  },
  pageErrors: [
    async ({ page }, use) => {
      const errors = [];
      page.on('console', (msg) => {
        if (msg.type() === 'error') errors.push(`console: ${msg.text()}`);
      });
      page.on('pageerror', (err) => errors.push(`uncaught: ${err.message}`));
      await use(errors);
      expect(errors, 'console errors, uncaught exceptions or CSP violations').toEqual([]);
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

/** The hash part of the current URL. */
export const hashOf = (page) => new URL(page.url()).hash;
