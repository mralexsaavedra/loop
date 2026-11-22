/* Playwright E2E config (`npm run test:e2e`, docs/development.md → Tests → Browser end-to-end tests).
 * Not part of `npm test`, which stays browser-free. Two engines: Chromium (Chrome, Edge, Android) and WebKit
 * (Safari and every browser on an iPhone), each on a phone profile; the desktop layout runs on Chromium.
 *
 * Projects:
 *   - static-phone / static-desktop: the example page (synthetic demo data) opened from file://, so every
 *     LAN-only feature is off — e2e/static/. Phone and desktop sit on both sides of the one layout
 *     breakpoint (900 px, docs/plan-page.md).
 *   - lan-setup / lan-phone: the personal page a real data service builds and serves (e2e/lan/stack.mjs: Postgres,
 *     services/loop-ingest in container mode, an nginx stand-in) — e2e/lan/. Only when TEST_DATABASE_URL points at
 *     a Postgres the suite may CREATE DATABASE on (like `npm run test:pg`); without it these projects are left out.
 *     lan-setup completes the first-run assistant every other lan test starts from; lan-last (e2e/lan/last/) runs
 *     after lan-phone, for what changes the whole shared page (the language switch rebuilds it in another locale).
 *   - docker: a browser smoke of the published images (e2e/docker/), against the loop-web E2E_DOCKER_URL points at
 *     (scripts/image-smoke.sh sets it with SMOKE_BROWSER=1). With E2E_DOCKER_URL set it is the ONLY project: no
 *     example build, no LAN stack. */
import { defineConfig, devices } from '@playwright/test';
import { E2E_TZ } from './e2e/paths.mjs';
import { LAN_PORT } from './e2e/lan/stack.mjs';

const CI = !!process.env.CI;
const DOCKER_URL = process.env.E2E_DOCKER_URL || '';

// The LAN stack (a database, the data service, a page build) runs whenever TEST_DATABASE_URL is set; E2E_LAN=0 leaves
// the lan-* projects out (a static-only run with the variable exported for `npm run test:pg`). An environment variable,
// not --project: Playwright's workers reload this file without the command line, and every process must see the same
// projects.
const LAN = !DOCKER_URL && !!process.env.TEST_DATABASE_URL && process.env.E2E_LAN !== '0';
const LAN_URL = `http://127.0.0.1:${LAN_PORT}`;

export default defineConfig({
  testDir: 'e2e',
  outputDir: 'e2e/.results',
  globalSetup: DOCKER_URL ? undefined : './e2e/global-setup.mjs',
  fullyParallel: true,
  forbidOnly: CI,
  retries: CI ? 1 : 0,
  reporter: CI ? [['list'], ['html', { open: 'never', outputFolder: 'e2e/.report' }]] : 'list',
  use: {
    locale: 'en-GB',
    timezoneId: E2E_TZ,
    reducedMotion: 'reduce',
    trace: CI ? 'retain-on-failure' : 'off',
  },
  webServer: LAN
    ? {
      command: 'node e2e/lan/stack.mjs',
      url: `${LAN_URL}/status.json`,
      // migrations + the first page build
      timeout: 300_000,
      reuseExistingServer: false,
      stdout: 'pipe',
      stderr: 'pipe',
      gracefulShutdown: { signal: 'SIGTERM', timeout: 15_000 },
    }
    : undefined,
  projects: DOCKER_URL ? [
    { name: 'docker', testMatch: 'docker/**/*.spec.mjs', use: { ...devices['Pixel 7'], baseURL: DOCKER_URL } },
  ] : [
    { name: 'static-phone', testMatch: 'static/**/*.spec.mjs', use: { ...devices['Pixel 7'] } },
    {
      name: 'static-desktop',
      testMatch: 'static/**/*.spec.mjs',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 } },
    },
    { name: 'webkit-static', testMatch: 'static/**/*.spec.mjs', use: { ...devices['iPhone 15'] } },
    // the owner's own setup: an iPhone, the page in Spanish (the example page built with --locale es)
    {
      name: 'webkit-static-es',
      testMatch: 'static/**/*.spec.mjs',
      metadata: { pageLocale: 'es' },
      use: { ...devices['iPhone 15'], locale: 'es-ES' },
    },
    ...(LAN
      ? [
        { name: 'lan-setup', testMatch: 'lan/setup.spec.mjs', use: { ...devices['Pixel 7'], baseURL: LAN_URL } },
        {
          name: 'lan-phone',
          testMatch: 'lan/**/*.spec.mjs',
          testIgnore: ['lan/setup.spec.mjs', 'lan/last/**'],
          dependencies: ['lan-setup'],
          use: { ...devices['Pixel 7'], baseURL: LAN_URL },
        },
        // the same LAN specs on WebKit, AFTER lan-phone: several specs own whole days of the shared database. They run
        // again on what lan-phone left there, which is why every spec creates unique rows, cleans up, and sets the
        // state it starts from (a goal, a day) instead of assuming an empty database
        {
          name: 'webkit-lan',
          testMatch: 'lan/**/*.spec.mjs',
          testIgnore: ['lan/setup.spec.mjs', 'lan/last/**'],
          dependencies: ['lan-phone'],
          use: { ...devices['iPhone 15'], baseURL: LAN_URL },
        },
        // last: it rebuilds the shared page in another locale under whatever still runs. Behind webkit-lan too, so a
        // WebKit failure also skips it (Playwright skips a project whose dependency failed); the job fails either way
        { name: 'lan-last', testMatch: 'lan/last/**/*.spec.mjs', dependencies: ['lan-phone', 'webkit-lan'], use: { ...devices['Pixel 7'], baseURL: LAN_URL } },
      ]
      : []),
  ],
});
