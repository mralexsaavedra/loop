/* Playwright E2E config (`npm run test:e2e`, docs/development.md → Tests → Browser end-to-end tests).
 * Not part of `npm test`, which stays browser-free. Chromium only: the page targets the phone browser the
 * owner uses and one engine keeps CI fast.
 *
 * Projects:
 *   - static-phone / static-desktop: the example page (synthetic demo data) opened from file://, so every
 *     LAN-only feature is off — e2e/static/. Phone and desktop sit on both sides of the one layout
 *     breakpoint (900 px, docs/plan-page.md). */
import { defineConfig, devices } from '@playwright/test';

const CI = !!process.env.CI;

export default defineConfig({
  testDir: 'e2e',
  outputDir: 'e2e/.results',
  globalSetup: './e2e/global-setup.mjs',
  fullyParallel: true,
  forbidOnly: CI,
  retries: CI ? 1 : 0,
  reporter: CI ? [['list'], ['html', { open: 'never', outputFolder: 'e2e/.report' }]] : 'list',
  use: {
    locale: 'en-GB',
    timezoneId: 'Europe/Madrid',
    reducedMotion: 'reduce',
    trace: CI ? 'retain-on-failure' : 'off',
  },
  projects: [
    { name: 'static-phone', testMatch: 'static/**/*.spec.mjs', use: { ...devices['Pixel 7'] } },
    {
      name: 'static-desktop',
      testMatch: 'static/**/*.spec.mjs',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 } },
    },
  ],
});
