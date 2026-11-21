// The profile sheet's language switch against the real data service (docs/profile.md → Language,
// web/src/client/profile.js saveLang): the choice is stored (PUT /api/food/settings {locale}), the page presses
// Sync, the server rebuilds the ONE shared page in that language and the page reloads into it. Project `lan-last`:
// it runs after every other LAN spec, because the rebuild changes the page they all read. It switches back the
// same way, and restores the stored value it found even when a step fails.
import { test, expect, openLan, apiResponse, apiWrite, SYNC_RELOAD_MS, SYNC_TEST_MS } from '../fixtures.mjs';
import { en as pfEn, es as pfEs } from '../../../web/src/i18n/profile-templates.mjs';

const COPY = { en: pfEn, es: pfEs };
const htmlLang = (page) => page.evaluate(() => document.documentElement.lang);

async function storedLocale(page) {
  const res = await page.request.get('/api/food/settings', { headers: { 'X-HC-Food': '1' } });
  expect(res.status()).toBe(200);
  return (await res.json()).settings?.locale ?? null;
}

/** Open the page and its profile sheet once the settings API answered (the Language section needs it). */
async function openProfile(page) {
  await openLan(page);
  await expect.poll(() => page.evaluate(() => Boolean(window.HCSettings && window.HCSettings.ready()))).toBe(true);
  await page.locator('#avatar-btn').click();
  await expect(page.locator('#pf-lang')).toBeVisible();
}

/** Pick `to` in the profile sheet (open on a page built in `from`) and wait for the rebuild's reload. */
async function switchTo(page, from, to) {
  await openProfile(page);
  await expect(page.locator('#pf-lang legend')).toHaveText(COPY[from].language.heading);
  await expect(page.locator(`input[name="pf-lang"][value="${from}"]`)).toBeChecked();

  await page.evaluate(() => { window.__e2eBeforeSync = true; });
  // listening before the change: a fast rebuild cannot reload unseen
  const reloaded = page.waitForEvent('load', { timeout: SYNC_RELOAD_MS });
  const put = apiResponse(page, 'PUT', '/api/food/settings');
  const sync = apiResponse(page, 'POST', '/api/sync');
  await page.locator(`input[name="pf-lang"][value="${to}"]`).check({ force: true });
  const putRes = await put;
  expect(putRes.request().postDataJSON()).toEqual({ locale: to });
  expect(putRes.status()).toBe(200);
  await expect(page.locator('#pf-lang-msg')).toHaveText(COPY[from].language.rebuilding);
  const syncRes = await sync;
  expect(syncRes.status()).toBe(202);
  const { seq } = await syncRes.json();
  await reloaded;
  expect(await page.evaluate(() => window.__e2eBeforeSync)).toBeUndefined();
  const status = await (await page.request.get('/status.json')).json();
  expect(status.processedSeq).toBeGreaterThanOrEqual(seq);
  expect(await storedLocale(page)).toBe(to);

  // the rebuilt page is in the new language: <html lang> and the sheet's labels
  await openProfile(page);
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
  try {
    await switchTo(page, from, to);
    await switchTo(page, to, from);
  } finally {
    // leave the stored value exactly as found (none stored = the server's default language); a page left in
    // the other language is rebuilt once more
    if ((await storedLocale(page)) !== found) await apiWrite(page, 'PUT', '/api/food/settings', 'food', { locale: found });
    await page.goto('/');
    if ((await htmlLang(page)) !== from) await page.request.post('/api/sync');
  }
});
