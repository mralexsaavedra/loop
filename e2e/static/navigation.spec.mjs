// Tabs, the dock, keyboard shortcuts and the URL hash on the static example page (docs/plan-page.md →
// Tabs and sections, URL hash & navigation, Keyboard shortcuts).
import { test, expect, openStatic, TABS, hashOf, settle, staticLocale } from '../fixtures.mjs';

/** @param {import('@playwright/test').Page} page @param {string} key */
async function expectTab(page, key) {
  await expect(page.locator(`#t-${key}`)).toHaveAttribute('aria-current', 'page');
  for (const other of TABS) {
    const panel = page.locator(`.tab-panel[data-tab="${other}"]`);
    if (other === key) await expect(panel).toBeVisible();
    else await expect(panel).toBeHidden();
  }
}

test('the page is in this project\'s language', async ({ page }) => {
  await openStatic(page);
  expect(await page.evaluate(() => document.documentElement.lang)).toBe(staticLocale());
});

test('opens Home by default and writes #home', async ({ page }) => {
  await openStatic(page);
  await expectTab(page, 'home');
  expect(hashOf(page)).toBe('#home');
});

test('each dock button shows its tab and replaces the hash without adding history', async ({ page }) => {
  await openStatic(page);
  const start = await page.evaluate(() => history.length);
  for (const key of [...TABS.slice(1), 'home']) {
    await page.locator(`#t-${key}`).click();
    await expectTab(page, key);
    expect(hashOf(page)).toBe(`#${key}`);
  }
  expect(await page.evaluate(() => history.length)).toBe(start);
});

test('keys 1 to 4 press the tab buttons in dock order', async ({ page }) => {
  await openStatic(page);
  for (const [i, key] of [...TABS.entries()].reverse()) {
    await page.keyboard.press(String(i + 1));
    await expectTab(page, key);
  }
});

for (const key of TABS) {
  test(`deep link #${key} opens that tab and survives a reload`, async ({ page }) => {
    await openStatic(page, `#${key}`);
    await expectTab(page, key);
    await page.reload();
    await expectTab(page, key);
  });
}

test('an unknown hash falls back to Home and is replaced', async ({ page }) => {
  await openStatic(page, '#no-such-tab');
  await expectTab(page, 'home');
  expect(hashOf(page)).toBe('#home');
});

test('the #monitor anchor opens Health and keeps the hash', async ({ page }) => {
  await openStatic(page, '#monitor');
  await expectTab(page, 'health');
  expect(hashOf(page)).toBe('#monitor');
});

test('LAN-only controls stay hidden on file://', async ({ page }) => {
  await openStatic(page);
  await expect(page.locator('#act')).toBeHidden();
  // shortcuts for missing actions do nothing
  await page.keyboard.press('a');
  await page.keyboard.press('d');
  await settle(page);
  await expect(page.locator('#detail')).toBeHidden();
  expect(hashOf(page)).toBe('#home');
});
