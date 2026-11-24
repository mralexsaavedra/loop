// The profile sheet's language switch against the real data service (docs/profile.md → Language,
// web/src/client/profile.js saveLang): the choice is stored (PUT /api/food/settings {locale}), the page presses
// Sync, the server rebuilds the ONE shared page in that language and the page reloads into it. Project `lan-last`:
// it runs after every other LAN spec, because the rebuild changes the page they all read. It switches back the
// same way, and restores the stored value it found even when a step fails.
import { test, expect, openLan, openProfile, apiResponse, apiWrite, syncAndReload, withCleanup, unique, SYNC_TEST_MS } from '../fixtures.mjs';
import { en as pfEn, es as pfEs } from '../../../web/src/i18n/profile-templates.mjs';
import { en as foodEn, es as foodEs } from '../../../web/src/i18n/food-templates.mjs';
import { openAddSheet, saveEntry } from '../food-ui.mjs';

/** @typedef {import('@playwright/test').Page} Page */
/** The two languages the page is built in. */
/** @typedef {'en' | 'es'} Lang */

const FOOD = { en: foodEn, es: foodEs };
/** The fixed text before a template's first placeholder ("Añadido: " of "Añadido: {label} ({k} kcal)."). */
/** @param {string} template */
const lead = (template) => template.slice(0, template.indexOf('{'));

const COPY = { en: pfEn, es: pfEs };
/** The page's <html lang> (asserted to be one of Lang where it matters).
 * @param {Page} page
 * @returns {Promise<Lang>} */
const htmlLang = (page) => page.evaluate(() => /** @type {Lang} */ (document.documentElement.lang));

/** @param {Page} page
 * @returns {Promise<Lang | null>} */
async function storedLocale(page) {
  const res = await page.request.get('/api/food/settings', { headers: { 'X-HC-Food': '1' } });
  expect(res.status()).toBe(200);
  return (await res.json()).settings?.locale ?? null;
}

/** Pick `to` in the profile sheet (open on a page built in `from`) and wait for the rebuild's reload.
 * @param {Page} page
 * @param {Lang} from
 * @param {Lang} to */
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

/** What the page does in `lang` after the switch rebuilt it: a quick entry logged and deleted, today's journal saved
 * and read back, each with the copy of that language. Here because lan-last runs alone: the one shared page is in
 * that language only between the two switches.
 * @param {Page} page
 * @param {Lang} lang
 * @param {string} today */
async function coreFlowsIn(page, lang, today) {
  await openLan(page);
  expect(await htmlLang(page)).toBe(lang);
  const F = FOOD[lang];

  await openAddSheet(page);
  await expect(page.locator('#dt-title')).toHaveText(F.sheet.title);
  const label = unique('E2E idioma');
  await page.locator('#detail [data-food-act="tab"][data-tab="quick"]').click();
  await page.locator('#fa-label').fill(label);
  await page.locator('#fa-kcal').fill('300');
  const { entry } = await (await saveEntry(page)).json();
  await expect(page.locator('#food-msg')).toContainText(lead(F.added) + label);
  await page.locator('#t-nutricion').click();
  const del = page.locator(`#food-log [data-food-act="del"][data-id="${entry.id}"]`);
  await expect(del).toHaveAttribute('aria-label', F.delAria.replace('{label}', label));
  const deleted = apiResponse(page, 'DELETE', `/api/food/log/${entry.id}`);
  await del.click();
  expect((await deleted).status()).toBe(200);
  await expect(page.locator('#food-msg')).toContainText(F.deleted.replace('{label}', label));

  // today's journal: saved in this language and read back after a reload; emptied first, since earlier LAN specs may
  // have answered today (a set mobility would make the click below turn it off)
  await apiWrite(page, 'PUT', '/api/journal/day', 'journal', { date: today, answers: {} });
  await openLan(page);
  await expect.poll(() => page.evaluate(() => !!(/** @type {any} */ (window).HCViews && /** @type {any} */ (window).HCViews.journal))).toBe(true);
  await page.keyboard.press('d');
  await expect(page.locator('#jr-save')).toBeVisible();
  await page.locator('#jr-yes-mobility').click();
  const saved = apiResponse(page, 'PUT', '/api/journal/day');
  await page.locator('#jr-save').click();
  expect((await saved).request().postDataJSON()).toMatchObject({ date: today, answers: { mobility: true } });
  await openLan(page);
  await page.keyboard.press('d');
  await expect(page.locator('#jr-yes-mobility')).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('Escape');
}

test('the language switch rebuilds the page in the other language, and back', async ({ page, today }) => {
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
      await coreFlowsIn(page, to, today);
      await switchTo(page, to, from);
    },
    // leave the stored value exactly as found (none stored = the server's default language) and the shared page
    // built in it again, waiting for that rebuild, so a retry or a later run starts where this one did
    async () => {
      await apiWrite(page, 'PUT', '/api/journal/day', 'journal', { date: today, answers: {} });
      if ((await storedLocale(page)) !== found) await apiWrite(page, 'PUT', '/api/food/settings', 'food', { locale: found });
      await openLan(page);
      if ((await htmlLang(page)) !== from) await syncAndReload(page);
    },
  );
});
