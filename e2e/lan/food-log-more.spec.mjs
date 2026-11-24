// More of the food log against the real data service (docs/nutrition-food-log.md, web/src/client/food-log.js,
// food-sheet.js): the ‹ date › navigator and an entry logged on a past day, the empty past day, the per-meal "+ Add"
// buttons, the add sheet's "Change" (unpick), its keyboard, the "Save anyway" path of a quick entry whose kcal do
// not match its macros, and the error states of a save and of a past day's read (provoked with page.route).
import { test, expect, openLan, unique, apiResponse, apiWrite, shiftDays } from './fixtures.mjs';
import { settle } from '../fixtures.mjs';
import { openAddSheet, saveEntry, logRow } from './food-ui.mjs';

/** @typedef {import('@playwright/test').Page} Page */
/** @typedef {import('@playwright/test').Route} Route */
/** A food-log entry as GET /api/food/log lists it (only the fields these tests read are typed). */
/** @typedef {{ id: number, date: string, label: string, meal: string, [key: string]: unknown }} FoodEntry */

/** The day's entries straight from the data service.
 * @param {Page} page
 * @param {string} date
 * @returns {Promise<FoodEntry[]>} */
async function entriesOf(page, date) {
  const res = await page.request.get(`/api/food/log?date=${date}`, { headers: { 'X-HC-Food': '1' } });
  expect(res.status()).toBe(200);
  return (await res.json()).entries;
}

/** Wait for the page's GET /api/food/log of `date` (the request, sent or not answered yet).
 * @param {Page} page
 * @param {string} date */
const dayRequest = (page, date) => page.waitForRequest((r) => {
  const u = new URL(r.url());
  return r.method() === 'GET' && u.pathname === '/api/food/log' && u.searchParams.get('date') === date;
});

/** The page's own label for a past day (HC.fmtDate, the one date formatter).
 * @param {Page} page
 * @param {string} iso
 * @returns {Promise<string>} */
const fmtDate = (page, iso) => page.evaluate((d) => /** @type {any} */ (window).HC.fmtDate(d), iso);

/** Fill the Quick tab of an open add sheet.
 * @param {Page} page
 * @param {{ label: string, kcal: number, p: number, c: number, f: number }} entry */
async function fillQuick(page, { label, kcal, p, c, f }) {
  await page.locator('#detail [data-food-act="tab"][data-tab="quick"]').click();
  await page.locator('#fa-label').fill(label);
  await page.locator('#fa-kcal').fill(String(kcal));
  await page.locator('#fa-p').fill(String(p));
  await page.locator('#fa-c').fill(String(c));
  await page.locator('#fa-f').fill(String(f));
}

/** Delete `id` through the API unless the test already did (the LAN specs share one database).
 * @param {Page} page
 * @param {number | null} id
 * @param {boolean} deleted */
async function cleanUp(page, id, deleted) {
  if (id != null && !deleted) await apiWrite(page, 'DELETE', `/api/food/log/${id}`, 'food');
}

test('the day navigator reads a past day, logs an entry there and comes back to today', async ({ page, today }) => {
  const yesterday = shiftDays(today, -1);
  const label = unique('E2E past');
  /** @type {number | null} */
  let id = null;
  let deleted = false;
  try {
    await openLan(page);
    await page.locator('#t-nutricion').click();
    await expect(page.locator('#food-day-label')).toHaveText('Today');
    await expect(page.locator('#food-day-next')).toBeDisabled();
    await expect(page.locator('#food-day-today')).toBeHidden();

    const read = dayRequest(page, yesterday);
    await page.locator('#food-day-prev').click();
    await read;
    const yLabel = await fmtDate(page, yesterday);
    await expect(page.locator('#food-day-label')).toHaveText(yLabel);
    await expect(page.locator('#food-day-next')).toBeEnabled();
    await expect(page.locator('#food-day-today')).toBeVisible();
    await expect(page.locator('#food-log .food-sum')).toContainText('Day total');

    // the meal's own "+ Add" on a past day opens a sheet for that day, and the save carries its date
    await page.locator('#food-add-lunch').click();
    await expect(page.locator('#fa-meal')).toHaveValue('lunch');
    await expect(page.locator('#detail')).toContainText(`Add food · ${yLabel}`);
    await fillQuick(page, { label, kcal: 300, p: 20, c: 30, f: 10 });
    const res = await saveEntry(page);
    expect(res.request().postDataJSON()).toMatchObject({ date: yesterday, meal: 'lunch', refType: 'quick', label, kcal: 300 });
    ({ entry: { id } } = await res.json());
    await expect(logRow(page, label)).toBeVisible();
    await expect(page.locator('#food-day-label')).toHaveText(yLabel);

    // stored on that day, not on today
    expect((await entriesOf(page, yesterday)).find((/** @type {FoodEntry} */ e) => e.id === id)).toMatchObject({ date: yesterday, label, meal: 'lunch' });
    expect((await entriesOf(page, today)).some((/** @type {FoodEntry} */ e) => e.label === label)).toBe(false);

    // › goes back to today: the entry is not in today's list
    await page.locator('#food-day-next').click();
    await expect(page.locator('#food-day-label')).toHaveText('Today');
    await expect(page.locator('#food-day-next')).toBeDisabled();
    await expect(page.locator('#food-day-today')).toBeHidden();
    await expect(page.locator('#food-day-prev')).toBeFocused();
    await expect(page.locator('#food-log .food-sum')).toContainText('Logged today');
    await expect(logRow(page, label)).toHaveCount(0);

    // two days back, then "back to today" in one step
    await page.locator('#food-day-prev').click();
    await expect(logRow(page, label)).toBeVisible();
    const twoBack = dayRequest(page, shiftDays(today, -2));
    await page.locator('#food-day-prev').click();
    await twoBack;
    await expect(page.locator('#food-day-label')).toHaveText(await fmtDate(page, shiftDays(today, -2)));
    await page.locator('#food-day-today').click();
    await expect(page.locator('#food-day-label')).toHaveText('Today');
    await expect(page.locator('#food-day-today')).toBeHidden();
    await expect(page.locator('#food-day-prev')).toBeFocused();
    await expect(logRow(page, label)).toHaveCount(0);

    // delete it from its own day
    await page.locator('#food-day-prev').click();
    const row = logRow(page, label);
    await expect(row).toBeVisible();
    const del = apiResponse(page, 'DELETE', `/api/food/log/${id}`);
    await row.locator('[data-food-act="del"]').click();
    expect((await del).status()).toBe(200);
    deleted = true;
    await expect(row).toHaveCount(0);
    expect((await entriesOf(page, yesterday)).some((/** @type {FoodEntry} */ e) => e.id === id)).toBe(false);
  } finally {
    await cleanUp(page, id, deleted);
  }
});

test('a past day with nothing logged shows the empty-day copy and its four add buttons', async ({ page, today }) => {
  const day = shiftDays(today, -3);
  expect(await entriesOf(page, day), 'the fresh database has nothing on that day').toEqual([]);
  await openLan(page);
  await page.locator('#t-nutricion').click();
  for (let i = 1; i <= 3; i++) {
    const read = dayRequest(page, shiftDays(today, -i));
    await page.locator('#food-day-prev').click();
    await read;
  }
  await expect(page.locator('#food-day-label')).toHaveText(await fmtDate(page, day));
  const log = page.locator('#food-log');
  await expect(log).toContainText('Nothing logged that day.');
  await expect(log.locator('.food-sum')).toContainText('Day total');
  await expect(log.locator('.food-sum')).toContainText('0 kcal');
  await expect(log.locator('li.fe')).toHaveCount(0);
  await expect(log.locator('.food-meal-kcal')).toHaveCount(0);
  for (const m of ['breakfast', 'lunch', 'dinner', 'addon']) await expect(page.locator(`#food-add-${m}`)).toBeVisible();
  await expect(page.locator('#food-day-retry')).toHaveCount(0);
});

test('each meal\'s add button opens the add sheet with that meal selected', async ({ page }) => {
  await openLan(page);
  await page.locator('#t-nutricion').click();
  for (const meal of ['breakfast', 'lunch', 'dinner', 'addon']) {
    const btn = page.locator(`#food-add-${meal}`);
    await expect(btn).toHaveAttribute('data-food-act', 'add');
    await btn.click();
    await expect(page.locator('#detail')).toBeVisible();
    await expect(page.locator('#fa-meal')).toHaveValue(meal);
    await expect(page.locator('#detail')).toContainText('Add food');
    await expect(page.locator('#fa-q')).toBeFocused();
    // Esc on the list closes the sheet; the focus goes back to the button that opened it
    await page.keyboard.press('Escape');
    await expect(page.locator('#detail')).toBeHidden();
    await expect(btn).toBeFocused();
  }
});

test('"Change" goes back from a picked item to the list', async ({ page }) => {
  await openLan(page);
  await openAddSheet(page);
  await page.locator('#fa-q').fill('apple');
  const apple = page.locator('#detail [data-food-act="pick"][data-kind="basic"]').filter({ hasText: 'Apple' }).first();
  await apple.click();
  await expect(page.locator('#fa-amt')).toBeVisible();
  await expect(page.locator('#fa-q')).toHaveCount(0);
  await page.locator('#detail [data-food-act="unpick"]').click();
  await expect(page.locator('#fa-amt')).toHaveCount(0);
  await expect(page.locator('#fa-q')).toBeFocused();
  await expect(page.locator('#fa-q')).toHaveValue('apple');
  await expect(apple).toBeVisible();
  await expect(page.locator('#detail')).toBeVisible();
});

test('the add sheet\'s keys: arrows highlight, Enter picks, Esc unpicks then closes, ←/→ switch tabs', async ({ page }) => {
  await openLan(page);
  await openAddSheet(page);
  const q = page.locator('#fa-q');
  await q.fill('apple');
  const items = page.locator('#fa-list [data-food-act="pick"]:not([disabled])');
  await expect(items.first()).toBeVisible();
  const n = await items.count();
  expect(n).toBeGreaterThan(1);
  const active = page.locator('#fa-list [data-active="true"]');
  await expect(active).toHaveCount(0);

  await q.press('ArrowDown');
  await expect(active).toHaveCount(1);
  await expect(active).toHaveAttribute('id', 'fa-opt-0');
  await expect(q).toHaveAttribute('aria-activedescendant', 'fa-opt-0');
  await expect(q).toBeFocused();
  await q.press('ArrowDown');
  await expect(active).toHaveAttribute('id', 'fa-opt-1');
  await expect(q).toHaveAttribute('aria-activedescendant', 'fa-opt-1');
  await q.press('ArrowUp');
  await expect(active).toHaveAttribute('id', 'fa-opt-0');
  // wraps at the top
  await q.press('ArrowUp');
  await expect(active).toHaveAttribute('id', `fa-opt-${n - 1}`);
  await q.press('ArrowDown');
  await expect(active).toHaveAttribute('id', 'fa-opt-0');
  await q.press('ArrowDown');
  const second = /** @type {string} */ (await page.locator('#fa-opt-1 .fa-item-name').textContent()).trim();

  // Enter picks the highlighted item
  await q.press('Enter');
  await expect(page.locator('#fa-amt')).toBeFocused();
  await expect(page.locator('#fa-panel .fa-pick .fa-item-name')).toHaveText(second);
  await expect(page.locator('#fa-prev')).not.toBeEmpty();

  // Esc with an item picked goes back to the list (focus in the search), a second Esc closes the sheet
  await page.keyboard.press('Escape');
  await expect(page.locator('#fa-amt')).toHaveCount(0);
  await expect(q).toBeFocused();
  await expect(page.locator('#detail')).toBeVisible();
  await expect(active).toHaveCount(0);
  // Enter with no highlight picks the first match
  const first = /** @type {string} */ (await page.locator('#fa-opt-0 .fa-item-name').textContent()).trim();
  await q.press('Enter');
  await expect(page.locator('#fa-panel .fa-pick .fa-item-name')).toHaveText(first);
  await page.keyboard.press('Escape');
  await expect(q).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.locator('#detail')).toBeHidden();

  // ← / → on a tab switch tabs, wrapping, and the focus stays on the tabs
  await openAddSheet(page);
  const tab = (/** @type {string} */ k) => page.locator(`#detail .fa-tab[data-tab="${k}"]`);
  await tab('products').focus();
  await page.keyboard.press('ArrowRight');
  await expect(tab('recipes')).toHaveAttribute('aria-pressed', 'true');
  await expect(tab('products')).toHaveAttribute('aria-pressed', 'false');
  await expect(tab('recipes')).toBeFocused();
  await page.keyboard.press('ArrowRight');
  await expect(tab('quick')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#fa-label')).toBeVisible();
  await expect(tab('quick')).toBeFocused();
  await page.keyboard.press('ArrowRight');
  await expect(tab('products')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#fa-q')).toBeVisible();
  await page.keyboard.press('ArrowLeft');
  await expect(tab('quick')).toHaveAttribute('aria-pressed', 'true');
  await expect(tab('quick')).toBeFocused();
  // Esc on the Quick tab closes the sheet
  await page.keyboard.press('Escape');
  await expect(page.locator('#detail')).toBeHidden();
});

test('a quick entry whose kcal do not match its macros is refused, then saved with "Save anyway"', async ({ page, today, pageErrors }) => {
  pageErrors.allow(/status of 400/);
  const label = unique('E2E atwater');
  /** @type {number | null} */
  let id = null;
  try {
    await openLan(page);
    await openAddSheet(page);
    await page.locator('#fa-meal').selectOption('dinner');
    // 4·50 + 4·50 + 9·50 = 850 kcal from the macros, 100 typed: far over the 25 % tolerance
    await fillQuick(page, { label, kcal: 100, p: 50, c: 50, f: 50 });
    const refused = apiResponse(page, 'POST', '/api/food/log');
    await page.locator('#fa-save').click();
    const r1 = await refused;
    expect(r1.status()).toBe(400);
    expect(await r1.json()).toMatchObject({ error: 'atwater' });
    const b1 = r1.request().postDataJSON();
    expect(b1.force).toBeUndefined();
    await expect(page.locator('#detail')).toBeVisible();
    await expect(page.locator('#fa-msg')).toContainText('The kcal do not match the macros');
    const force = page.locator('#fa-msg [data-food-act="save-force"]');
    await expect(force).toHaveText('Save anyway');
    expect((await entriesOf(page, today)).some((/** @type {FoodEntry} */ e) => e.label === label)).toBe(false);

    const saved = apiResponse(page, 'POST', '/api/food/log');
    await force.click();
    const r2 = await saved;
    expect(r2.status()).toBeLessThan(300);
    const b2 = r2.request().postDataJSON();
    expect(b2).toMatchObject({ date: today, meal: 'dinner', refType: 'quick', label, kcal: 100, protein: 50, carbs: 50, fat: 50, force: true });
    expect(b2.requestId).toBe(b1.requestId);
    ({ entry: { id } } = await r2.json());
    await expect(page.locator('#detail')).toBeHidden();
    await page.locator('#t-nutricion').click();
    await expect(logRow(page, label)).toContainText('100');
    expect((await entriesOf(page, today)).filter((/** @type {FoodEntry} */ e) => e.label === label)).toMatchObject([{ id, kcal: 100, protein: 50, carbs: 50, fat: 50 }]);
  } finally {
    await cleanUp(page, id, false);
  }
});

test('a save that fails (500, 429, offline) keeps the sheet open with the message, then the retry saves once', async ({ page, today, pageErrors }) => {
  pageErrors.allow(/status of 500/);
  pageErrors.allow(/status of 429/);
  pageErrors.allow(/net::ERR_FAILED/);
  const label = unique('E2E retry');
  /** @type {number | null} */
  let id = null;
  /** @type {{ requestId?: unknown }[]} */
  const bodies = [];
  /** @type {((route: Route) => Promise<void>)[]} */
  const answers = [
    (route) => route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'internal' }) }),
    (route) => route.fulfill({ status: 429, contentType: 'application/json', body: JSON.stringify({ error: 'rate_limited' }) }),
    (route) => route.abort('failed'),
  ];
  const isPost = (/** @type {URL} */ u) => u.pathname === '/api/food/log';
  await page.route(isPost, async (route) => {
    if (route.request().method() !== 'POST') return route.fallback();
    bodies.push(route.request().postDataJSON());
    return answers[bodies.length - 1](route);
  });
  try {
    await openLan(page);
    await openAddSheet(page);
    await page.locator('#fa-meal').selectOption('breakfast');
    await fillQuick(page, { label, kcal: 250, p: 10, c: 30, f: 10 });
    const messages = [
      'Could not complete that. Try again.',
      'Too many changes in a row: wait a minute.',
      'Cannot reach the server: nothing was saved.',
    ];
    for (const [i, msg] of messages.entries()) {
      await page.locator('#fa-save').click();
      await expect(page.locator('#fa-msg')).toHaveText(msg);
      expect(bodies).toHaveLength(i + 1);
      await expect(page.locator('#detail')).toBeVisible();
      await expect(page.locator('#fa-save')).toBeEnabled();
      await expect(page.locator('#fa-label')).toHaveValue(label);
    }
    await page.unroute(isPost);
    await settle(page);
    expect((await entriesOf(page, today)).some((/** @type {FoodEntry} */ e) => e.label === label)).toBe(false);
    await expect(logRow(page, label)).toHaveCount(0);

    // every attempt is the same add: the retry that reaches the server keeps the request id
    expect(bodies.map((b) => b.requestId)).toEqual(Array(3).fill(bodies[0].requestId));
    const res = await saveEntry(page);
    const body = res.request().postDataJSON();
    expect(body).toMatchObject({ date: today, meal: 'breakfast', refType: 'quick', label, kcal: 250 });
    expect(body.requestId).toBe(bodies[0].requestId);
    ({ entry: { id } } = await res.json());
    await page.locator('#t-nutricion').click();
    await expect(logRow(page, label)).toHaveCount(1);
    expect((await entriesOf(page, today)).filter((/** @type {FoodEntry} */ e) => e.label === label)).toMatchObject([{ id, meal: 'breakfast', kcal: 250 }]);
  } finally {
    await page.unrouteAll({ behavior: 'ignoreErrors' });
    await cleanUp(page, id, false);
  }
});

test('a past day that fails to load offers a retry that loads it', async ({ page, today, pageErrors }) => {
  pageErrors.allow(/status of 503/);
  const yesterday = shiftDays(today, -1);
  const isDay = (/** @type {URL} */ u) => u.pathname === '/api/food/log' && u.searchParams.get('date') === yesterday;
  let failed = 0;
  await page.route(isDay, (route) => {
    failed += 1;
    return route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'food_unavailable' }) });
  });
  await openLan(page);
  await page.locator('#t-nutricion').click();
  await page.locator('#food-day-prev').click();
  const retry = page.locator('#food-day-retry');
  await expect(retry).toBeVisible();
  await expect(retry).toHaveAttribute('data-food-act', 'day-retry');
  expect(failed).toBe(1);
  await expect(page.locator('#food-log')).toContainText('Could not complete that. Try again.');
  await expect(page.locator('#food-msg')).toHaveText('Could not complete that. Try again.');
  await expect(page.locator('#food-log .food-sum')).toHaveCount(0);
  await expect(page.locator('#food-add-lunch')).toHaveCount(0);

  await page.unroute(isDay);
  const read = apiResponse(page, 'GET', '/api/food/log');
  await retry.click();
  expect((await read).status()).toBe(200);
  await expect(retry).toHaveCount(0);
  await expect(page.locator('#food-log .food-sum')).toContainText('Day total');
  await expect(page.locator('#food-add-lunch')).toBeVisible();
  await expect(page.locator('#food-msg')).toHaveText('');
  expect(failed).toBe(1);
});
