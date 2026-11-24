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
import { staticUrl, E2E_TZ } from './paths.mjs';
import { en as dateEn, es as dateEs } from '../web/src/i18n/date-templates.mjs';

/** @typedef {import('@playwright/test').Page} Page */

/** The `pageErrors` fixture: `allow(re)` accepts console errors matching `re` for the current test. */
/** @typedef {{ allow: (re: RegExp) => void }} PageErrors */

/** The fixtures this file adds to Playwright's own: the fixed browser clock and the page-error guard. */
/** @typedef {{ now: Date, pageErrors: PageErrors }} E2EFixtures */

/** @typedef {import('@playwright/test').PlaywrightTestArgs & import('@playwright/test').PlaywrightTestOptions} BaseTestArgs */
/** @typedef {import('@playwright/test').PlaywrightWorkerArgs & import('@playwright/test').PlaywrightWorkerOptions} BaseWorkerArgs */

export const DEMO_DAY = DEMO_DEFAULTS.end;

/** The instant that is `hour`:00 on `day` in E2E_TZ, whatever the season (CET or CEST) and the host's zone.
 * @param {string} day an ISO calendar date (YYYY-MM-DD)
 * @param {number} hour
 * @returns {Date} */
export function zonedInstant(day, hour) {
  const hh = String(hour).padStart(2, '0');
  const probe = new Date(`${day}T${hh}:00:00Z`);
  const part = /** @type {Intl.DateTimeFormatPart} */ (
    new Intl.DateTimeFormat('en-GB', { timeZone: E2E_TZ, timeZoneName: 'longOffset' })
      .formatToParts(probe)
      .find((p) => p.type === 'timeZoneName')
  );
  const name = part.value; // "GMT+02:00", or "GMT" at offset 0
  return new Date(`${day}T${hh}:00:00${name.slice(3) || 'Z'}`);
}

export const DEMO_NOW = zonedInstant(DEMO_DAY, 10);

export const test = base.extend(
  /** @type {import('@playwright/test').Fixtures<E2EFixtures, {}, BaseTestArgs, BaseWorkerArgs>} */ ({
    // the instant the browser clock is fixed to (e2e/lan/fixtures.mjs overrides it)
    now: async ({}, use) => use(DEMO_NOW),
    page: async ({ page, now }, use) => {
      await page.clock.setFixedTime(now);
      await use(page);
    },
    pageErrors: [
      async ({ page }, use) => {
        /** @type {string[]} */
        const errors = [];
        /** @type {RegExp[]} */
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
  }),
);

export { expect };

/** Go to `url` with a real page load. From a page already open, a goto that changes only the hash is a same-document
 * navigation: no reload, and a deep link is then handled by `hashchange` instead of the page's own load. Going
 * through about:blank first makes every open a load, so a deep-link test proves what a link opened cold does. */
/** @param {Page} page @param {string} url */
export async function loadPage(page, url) {
  if (page.url() !== 'about:blank') await page.goto('about:blank');
  return page.goto(url);
}

/** The page language of this project's static page (project metadata.pageLocale, default English). */
export const staticLocale = () => test.info().project.metadata?.pageLocale || 'en';

/** The page's own date names (web/src/i18n/date-templates.mjs, baked as I18N_DATE) in this project's language. */
export const dateCopy = () => (staticLocale() === 'es' ? dateEs : dateEn);

/** Open the static example page, in this project's language, with a real load, optionally at a hash
 * (`'#health'`, `'#detail/weight'`).
 * @param {Page} page
 * @param {string} [hash] */
export async function openStatic(page, hash = '') {
  await loadPage(page, staticUrl(staticLocale()) + hash);
  await expect(page.locator('#t-home')).toBeVisible();
}

/** The tab keys in dock order (lib/nav/tabs.mjs TAB_KEYS). */
export const TABS = ['home', 'entreno', 'health', 'nutricion'];

/** Let any asynchronous handler run before asserting that something did NOT happen. */
export const settle = (/** @type {Page} */ page) => page.waitForTimeout(300);

/** The hash part of the current URL. */
export const hashOf = (/** @type {Page} */ page) => new URL(page.url()).hash;
