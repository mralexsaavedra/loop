// The detail sheet (docs/detail-views.md) and the views it hosts (profile, keyboard help) on the static
// example page: every opener on every tab, the ways to close it, focus, and the deep links.
import { test, expect, openStatic, TABS, hashOf, settle } from '../fixtures.mjs';

const sheet = (/** @type {import('@playwright/test').Page} */ page) => page.locator('#detail');
const title = (/** @type {import('@playwright/test').Page} */ page) => page.locator('#dt-title');

/** @param {import('@playwright/test').Page} page */
async function expectOpen(page) {
  await expect(sheet(page)).toBeVisible();
  await expect(title(page)).not.toBeEmpty();
  await expect(page.locator('.wrap')).toHaveAttribute('inert', '');
}

/** @param {import('@playwright/test').Page} page */
async function expectClosed(page) {
  await expect(sheet(page)).toBeHidden();
  await expect(page.locator('.wrap')).not.toHaveAttribute('inert', '');
}

for (const tab of TABS) {
  test(`every visible card on ${tab} opens its sheet and Esc closes it`, async ({ page }) => {
    // every card's sheet, one by one: dozens of open / close cycles, which WebKit takes about four times as long for
    test.slow(test.info().project.use.defaultBrowserType === 'webkit', 'WebKit opens and closes each sheet more slowly');
    await openStatic(page, `#${tab}`);
    const openers = page.locator(`.tab-panel[data-tab="${tab}"] [data-detail]:visible`);
    const count = await openers.count();
    expect(count, `openers on ${tab}`).toBeGreaterThan(0);
    for (let i = 0; i < count; i++) {
      const opener = openers.nth(i);
      const key = await opener.getAttribute('data-detail');
      await opener.scrollIntoViewIfNeeded();
      await opener.click();
      await expectOpen(page);
      await expect.poll(() => hashOf(page), `hash for ${key}`).not.toBe(`#${tab}`);
      await page.keyboard.press('Escape');
      await expectClosed(page);
      // closing goes back in history, which can land just after the sheet hides (seen on WebKit)
      await expect.poll(() => hashOf(page), `hash after closing ${key}`).toBe(`#${tab}`);
    }
  });
}

test('the close button closes the sheet and focus returns to the opener', async ({ page }) => {
  await openStatic(page, '#health');
  const opener = page.locator('.tab-panel[data-tab="health"] [data-detail="weight"]:visible').first();
  await opener.click();
  await expectOpen(page);
  await page.locator('#detail [data-dt-act="close"]').first().click();
  await expectClosed(page);
  await expect(opener).toBeFocused();
});

test('browser Back closes the sheet and keeps the tab', async ({ page }) => {
  await openStatic(page, '#health');
  await page.locator('.tab-panel[data-tab="health"] [data-detail="weight"]:visible').first().click();
  await expectOpen(page);
  await page.goBack();
  await expectClosed(page);
  expect(hashOf(page)).toBe('#health');
});

test('a #detail deep link opens the sheet over its host tab', async ({ page }) => {
  await openStatic(page, '#detail/weight');
  await expectOpen(page);
  await expect(page.locator('#t-health')).toHaveAttribute('aria-current', 'page');
});

test('a deep link to an unknown metric opens nothing and is replaced by the tab hash', async ({ page }) => {
  await openStatic(page, '#detail/no-such-metric');
  await expectClosed(page);
  await expect.poll(() => hashOf(page)).toBe('#home');
});

test('the avatar opens the profile sheet, and #profile deep-links to it', async ({ page }) => {
  await openStatic(page);
  await page.locator('#avatar-btn').click();
  await expectOpen(page);
  await page.keyboard.press('Escape');
  await expectClosed(page);

  await openStatic(page, '#profile');
  await expectOpen(page);
});

test('? opens the keyboard help, and no shortcut fires while it is open', async ({ page }) => {
  await openStatic(page);
  await page.keyboard.press('?');
  await expectOpen(page);
  expect(hashOf(page)).toBe('#shortcuts');
  await page.keyboard.press('3');
  await settle(page);
  await expect(page.locator('.tab-panel[data-tab="health"]')).toBeHidden();
  expect(hashOf(page)).toBe('#shortcuts');
  await page.keyboard.press('Escape');
  await expectClosed(page);
});
