// The profile sheet's language switch against the real data service (docs/profile.md → Language,
// web/src/client/profile.js saveLang): the choice is stored (PUT /api/food/settings {locale}), the page presses
// Sync, the server rebuilds the ONE shared page in that language and the page reloads into it. Project `lan-last`:
// it runs after every other LAN spec, because the rebuild changes the page they all read. It switches back the
// same way, and restores the stored value it found even when a step fails.
import { test, expect, openLan, openProfile, apiResponse, apiWrite, syncAndReload, withCleanup, SYNC_TEST_MS } from '../fixtures.mjs';
import { en as pfEn, es as pfEs } from '../../../web/src/i18n/profile-templates.mjs';

const COPY = { en: pfEn, es: pfEs };
const htmlLang = (page) => page.evaluate(() => document.documentElement.lang);

async function storedLocale(page) {
  const res = await page.request.get('/api/food/settings', { headers: { 'X-HC-Food': '1' } });
  expect(res.status()).toBe(200);
  return (await res.json()).settings?.locale ?? null;
}

/** Pick `to` in the profile sheet (open on a page built in `from`) and wait for the rebuild's reload. */
async function switchTo(page, from, to) {
  await openProfile(page);
  await expect(page.locator('#pf-lang')).toBeVisible();
  await expect(page.locator('#pf-lang legend')).toHaveText(COPY[from].language.heading);
  await expect(page.locator(`input[name="pf-lang"][value="${from}"]`)).toBeChecked();

  // the change itself presses Sync: syncAndReload with that trigger (listens for the reload before it, checks the
  // 202, the real reload and processedSeq)
  const put = apiResponse(page, 'PUT', '/api/food/settings');
  await syncAndReload(page, {
    trigger: (p) => p.locator(`input[name="pf-lang"][value="${to}"]`).check({ force: true }),
    whileBusy: async () => {
      const putRes = await put;
      expect(putRes.request().postDataJSON()).toEqual({ locale: to });
      expect(putRes.status()).toBe(200);
    },
  });
  expect(await storedLocale(page)).toBe(to);

  // the rebuilt page is in the new language: <html lang> and the sheet's labels
  await openProfile(page);
  await expect(page.locator('#pf-lang')).toBeVisible();
  expect(await htmlLang(page)).toBe(to);
  await expect(page.locator('#pf-lang legend')).toHaveText(COPY[to].language.heading);
  await expect(page.locator('#pf-goal legend')).toHaveText(COPY[to].goal.heading);
  await expect(page.locator(`input[name="pf-lang"][value="${to}"]`)).toBeChecked();
}

test('the language switch rebuilds the page in the other language, and back', async ({ page }) => {
  // two real page builds
  test.setTimeout(2 * SYNC_TEST_MS);
  const found = await storedLocale(page);
  await openLan(page);
  const from = await htmlLang(page);
  expect(['en', 'es']).toContain(from);
  const to = from === 'es' ? 'en' : 'es';
  await withCleanup(
    async () => {
      await switchTo(page, from, to);
      await switchTo(page, to, from);
    },
    // leave the stored value exactly as found (none stored = the server's default language) and the shared page
    // built in it again, waiting for that rebuild, so a retry or a later run starts where this one did
    async () => {
      if ((await storedLocale(page)) !== found) await apiWrite(page, 'PUT', '/api/food/settings', 'food', { locale: found });
      await openLan(page);
      if ((await htmlLang(page)) !== from) await syncAndReload(page);
    },
  );
});
