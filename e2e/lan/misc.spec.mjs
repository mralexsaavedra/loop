// The dock's "+" popover, the journal sheet's other days, its stepper, a failed save and the behaviour insights,
// Sync and freshness failures, and the food summary feeding Constancia, against the real data service
// (web/src/client/nav-actions.js, journal.js, freshness.js, adherence.js; docs/plan-page.md, docs/journal.md,
// docs/nutrition-food-log.md). Each test that writes uses a past day of its own (the allocation table in
// e2e/lan/fixtures.mjs: journal on -2 to -5, food on -6) and resets it in its clean-up.
import { test, expect, openLan, unique, apiResponse, apiWrite, syncAndReload, shiftDays, withCleanup, SYNC_TEST_MS } from './fixtures.mjs';
import { settle } from '../fixtures.mjs';

/** Reset one journal day to no answers and no note (the journal API keeps a row per day). */
const resetJournalDay = (page, date) => apiWrite(page, 'PUT', '/api/journal/day', 'journal', { date, answers: {} });

/** The stored journal day of `date` ({date, answers, notes}) or undefined, read straight from the service. */
async function storedJournalDay(page, date) {
  const res = await page.request.get(`/api/journal/summary?from=${date}&to=${date}`, { headers: { 'X-HC-Journal': '1' } });
  expect(res.status()).toBe(200);
  return (await res.json()).days.find((d) => d.date === date);
}

/** Open the journal sheet from the "+" popover and pick `date` in its strip. */
async function openJournalOn(page, date) {
  await page.locator('#act-btn').click();
  await page.locator('#act-pop [data-act="journal"]').click();
  await expect(page.locator('#jr-save')).toBeVisible();
  const day = page.locator(`#detail [data-jr="day"][data-date="${date}"]`);
  await day.click();
  await expect(day).toHaveAttribute('aria-pressed', 'true');
}

test.describe('the "+" popover', () => {
  test('opens and closes with Escape and the scrim, focus returns to the button', async ({ page }) => {
    await openLan(page);
    const btn = page.locator('#act-btn');
    const pop = page.locator('#act-pop');
    const scrim = page.locator('#act-scrim');
    await expect(btn).toHaveAttribute('aria-expanded', 'false');
    await expect(pop).toBeHidden();

    await btn.click();
    await expect(pop).toBeVisible();
    await expect(scrim).toBeVisible();
    await expect(btn).toHaveAttribute('aria-expanded', 'true');
    // focus moves to the first action
    await expect(pop.locator('.act-item:visible').first()).toBeFocused();

    await page.keyboard.press('Escape');
    await expect(pop).toBeHidden();
    await expect(scrim).toBeHidden();
    await expect(btn).toHaveAttribute('aria-expanded', 'false');
    await expect(btn).toBeFocused();

    await btn.click();
    await expect(pop).toBeVisible();
    // a tap on the scrim, away from the card
    await scrim.click({ position: { x: 10, y: 10 } });
    await expect(pop).toBeHidden();
    await expect(scrim).toBeHidden();
    await expect(btn).toHaveAttribute('aria-expanded', 'false');
    await expect(btn).toBeFocused();
  });

  test('the journal action opens the journal sheet and closes the popover', async ({ page, today }) => {
    await openLan(page);
    await page.locator('#act-btn').click();
    await page.locator('#act-pop [data-act="journal"]').click();
    await expect(page.locator('#act-pop')).toBeHidden();
    await expect(page.locator('#act-btn')).toHaveAttribute('aria-expanded', 'false');
    await expect(page.locator('#detail')).toBeVisible();
    await expect(page.locator('#jr-save')).toBeVisible();
    // it opens on today
    await expect(page.locator(`#detail [data-jr="day"][data-date="${today}"]`)).toHaveAttribute('aria-pressed', 'true');
  });

  test('the sync action starts a Sync: POST /api/sync and the busy button', async ({ page }) => {
    await openLan(page);
    // stubbed: no rebuild of the shared page; a seq the server never reaches keeps the page waiting
    await page.route('**/api/sync', (route) => (route.request().method() === 'POST'
      ? route.fulfill({ status: 202, contentType: 'application/json', body: JSON.stringify({ ok: true, seq: 1e9, coalesced: false }) })
      : route.fallback()));
    await page.locator('#act-btn').click();
    const sync = page.locator('#act-pop [data-act="sync"]');
    await expect(sync).toBeVisible();
    const posted = page.waitForRequest((r) => r.method() === 'POST' && new URL(r.url()).pathname === '/api/sync');
    await sync.click();
    await posted;
    await expect(page.locator('#act-pop')).toBeHidden();
    await expect(page.locator('#sync-btn')).toHaveAttribute('aria-busy', 'true');
    await expect(page.locator('#sync-btn')).toBeDisabled();
    await expect(page.locator('#sync-msg')).toHaveText('Syncing…');
  });
});

test.describe('the journal sheet', () => {
  test('the drink stepper\'s minus lowers the count and stops at 0', async ({ page, today }) => {
    const date = shiftDays(today, -2);
    await resetJournalDay(page, date);
    await withCleanup(async () => {
      await openLan(page);
      await openJournalOn(page, date);
      const n = page.locator('#jr-nv-alcohol');
      const dec = page.locator('#jr-dec-alcohol');
      await expect(n).toHaveText('0');
      await expect(dec).toBeDisabled(); // unanswered: nothing to lower
      await page.locator('#jr-inc-alcohol').click();
      await page.locator('#jr-inc-alcohol').click();
      await expect(n).toHaveText('2');
      await dec.click();
      await expect(n).toHaveText('1');
      await expect(page.locator('#jr-ns-alcohol')).toContainText('1');
      await dec.click();
      await expect(n).toHaveText('0');
      // 0 is an answer ("no drinks"): the ✕ reads pressed, and the minus turns off, never below 0
      await expect(page.locator('#jr-no-alcohol')).toHaveAttribute('aria-pressed', 'true');
      await expect(dec).toBeDisabled();
      await dec.click({ force: true });
      await settle(page);
      await expect(n).toHaveText('0');

      const saved = apiResponse(page, 'PUT', '/api/journal/day');
      await page.locator('#jr-save').click();
      expect((await saved).request().postDataJSON()).toMatchObject({ date, answers: { alcohol: 0 } });
      await expect(page.locator('#detail')).toBeHidden();
      expect((await storedJournalDay(page, date)).answers).toEqual({ alcohol: 0 });
    }, () => resetJournalDay(page, date));
  });

  test('another day of the strip is saved with its own date and read back after a reload', async ({ page, today }) => {
    const date = shiftDays(today, -3);
    await resetJournalDay(page, date);
    await withCleanup(async () => {
      await openLan(page);
      await openJournalOn(page, date);
      await expect(page.locator('#detail .jr-q')).toHaveText(/^What happened on .+\?$/);
      await page.locator('#jr-yes-mobility').click();
      await page.locator('#jr-inc-alcohol').click();
      const note = unique('E2E past day');
      await page.locator('#jr-notes').fill(note);

      const saved = apiResponse(page, 'PUT', '/api/journal/day');
      await page.locator('#jr-save').click();
      const res = await saved;
      expect(res.status(), await res.text()).toBe(200);
      expect(res.request().postDataJSON()).toEqual({ date, answers: { mobility: true, alcohol: 1 }, notes: note });
      await expect(page.locator('#detail')).toBeHidden();
      // the card marks that day, not today's column
      await expect(page.locator(`#my-journal [data-date="${date}"] .jr-on`)).toBeVisible();
      expect(await storedJournalDay(page, date)).toMatchObject({ answers: { mobility: true, alcohol: 1 }, notes: note });

      await openLan(page);
      await openJournalOn(page, date);
      await expect(page.locator('#jr-yes-mobility')).toHaveAttribute('aria-pressed', 'true');
      await expect(page.locator('#jr-nv-alcohol')).toHaveText('1');
      await expect(page.locator('#jr-notes')).toHaveValue(note);
    }, () => resetJournalDay(page, date));
  });

  test('a failed save shows the error, keeps the sheet open and stores nothing', async ({ page, pageErrors, today }) => {
    pageErrors.allow(/500/);
    const date = shiftDays(today, -4);
    await resetJournalDay(page, date);
    await withCleanup(async () => {
      await openLan(page);
      await openJournalOn(page, date);
      await page.locator('#jr-yes-mobility').click();
      await page.route('**/api/journal/day', (route) => (route.request().method() === 'PUT'
        ? route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'e2e_down' }) })
        : route.fallback()));
      const put = page.waitForResponse((r) => r.request().method() === 'PUT' && new URL(r.url()).pathname === '/api/journal/day');
      await page.locator('#jr-save').click();
      expect((await put).status()).toBe(500);

      await expect(page.locator('#jr-status')).toHaveText('Could not save (e2e_down).');
      await expect(page.locator('#jr-status')).toHaveClass(/jr-err/);
      await expect(page.locator('#detail')).toBeVisible();
      await expect(page.locator('#jr-save')).toBeEnabled();
      // the draft is still there
      await expect(page.locator('#jr-yes-mobility')).toHaveAttribute('aria-pressed', 'true');
      await expect(page.locator(`#my-journal [data-date="${date}"] .jr-on`)).toHaveCount(0);
      const stored = await storedJournalDay(page, date);
      expect(stored?.answers ?? {}).toEqual({});
    }, () => resetJournalDay(page, date));
  });

  test('the behaviour insights open from the card, with the formula behind the info button', async ({ page, today }) => {
    // the insights are baked by the page build from the journal: one journaled day, then a Sync
    test.setTimeout(SYNC_TEST_MS);
    const date = shiftDays(today, -5);
    await apiWrite(page, 'PUT', '/api/journal/day', 'journal', { date, answers: { mobility: true } });
    await withCleanup(async () => {
      await openLan(page);
      await syncAndReload(page);
      const open = page.locator('#my-journal [data-detail="journal-insights"]');
      await expect(open).toBeVisible();
      await open.click();
      const sheet = page.locator('#detail');
      await expect(sheet).toBeVisible();
      await expect(sheet).toContainText('Journal insights');
      await expect(sheet.locator('.jr-top .jr-g')).toHaveText(/^Last \d+ days · to /);
      // without recovery data no behaviour has enough days: one shared "need more data" card
      const need = sheet.locator('.ji-empty');
      await expect(need).toContainText('Need more data');
      await expect(need).toContainText('Days that count so far: 0.');
      await expect(sheet.locator('.ji-row:not(.ji-empty)')).toHaveCount(0);

      const info = sheet.locator('[data-dt-act="info"]');
      await expect(info).toHaveAttribute('aria-expanded', 'false');
      await expect(sheet.locator('#dd-info')).toBeHidden();
      await info.click();
      await expect(info).toHaveAttribute('aria-expanded', 'true');
      await expect(sheet.locator('#dd-info')).toBeVisible();
      await expect(sheet.locator('#dd-info')).toContainText('For each behavior: the mean of your recovery %');
    }, () => resetJournalDay(page, date));
  });
});

test.describe('Sync and freshness', () => {
  test('a failed POST /api/sync shows the failure and the button works again', async ({ page, pageErrors }) => {
    pageErrors.allow(/500/);
    await openLan(page);
    const btn = page.locator('#sync-btn');
    await expect(page.locator('#freshness')).toBeVisible();
    let posts = 0;
    await page.route('**/api/sync', (route) => {
      if (route.request().method() !== 'POST') return route.fallback();
      posts++;
      return route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'e2e_down' }) });
    });
    await btn.click();
    await expect(page.locator('#sync-msg')).toHaveText('Could not update, try again');
    await expect(btn).toHaveAttribute('aria-busy', 'false');
    await expect(btn).toBeEnabled();
    await expect(btn).not.toHaveClass(/is-busy/);
    expect(posts).toBe(1);

    // usable again: a second press posts again
    await page.evaluate(() => { document.getElementById('sync-msg').textContent = ''; });
    await btn.click();
    await expect(page.locator('#sync-msg')).toHaveText('Could not update, try again');
    expect(posts).toBe(2);
    await expect(btn).toHaveAttribute('aria-busy', 'false');
  });

  test('an error the server reports for the Sync is shown with its reason', async ({ page }) => {
    // 5 s polling, twice
    test.slow();
    await openLan(page);
    await expect(page.locator('#freshness')).toBeVisible();
    const btn = page.locator('#sync-btn');
    let seq = 1e9;
    await page.route('**/api/sync', (route) => (route.request().method() === 'POST'
      ? route.fulfill({ status: 202, contentType: 'application/json', body: JSON.stringify({ ok: true, seq: ++seq, coalesced: false }) })
      : route.fallback()));

    // synthetic status reads (no route.fetch: a read racing another spec's rebuild must not hang the poll)
    const syncStatus = (extra) => ({
      lastShortcutAt: null, lastStravaOkAt: null, lastStravaError: null, lastTriggerAt: new Date().toISOString(),
      lastTriggerError: null, lastTriggerErrorSeq: null, triggerSeq: 0, stravaConfigured: false, ...extra,
    });
    const pageStatus = (extra) => ({ publishedAt: new Date().toISOString(), commit: 'e2e', processedSeq: 0, ...extra });

    // the data service could not hand the Sync to the builder (/api/sync/status lastTriggerError)
    await page.route('**/api/sync/status', (route) => route.fulfill({
      json: syncStatus({ lastTriggerError: 'trigger_write', lastTriggerErrorSeq: seq }),
    }));
    await page.route('**/status.json', (route) => route.fulfill({ json: pageStatus() }));
    await btn.click();
    await expect(btn).toHaveAttribute('aria-busy', 'true');
    await expect(page.locator('#sync-msg')).toHaveText('Could not update: the service could not notify the server', { timeout: 20_000 });
    await expect(btn).toHaveAttribute('aria-busy', 'false');
    await expect(btn).toBeEnabled();
    await page.unroute('**/api/sync/status');
    await page.unroute('**/status.json');

    // the page build failed (status.json error / errorSeq)
    await page.route('**/api/sync/status', (route) => route.fulfill({ json: syncStatus() }));
    await page.route('**/status.json', (route) => route.fulfill({ json: pageStatus({ error: 'build', errorSeq: seq }) }));
    await btn.click();
    await expect(page.locator('#sync-msg')).toHaveText('Could not update: the page build failed', { timeout: 20_000 });
    await expect(btn).toHaveAttribute('aria-busy', 'false');
    await expect(btn).toBeEnabled();
  });

  test('the freshness summary opens its popover; Escape and a tap outside close it', async ({ page }) => {
    await openLan(page);
    const sum = page.locator('#fresh-sum');
    const pop = page.locator('#fresh-pop');
    await expect(sum).toBeVisible();
    await expect(sum).toHaveAttribute('aria-expanded', 'false');
    await expect(pop).toBeHidden();

    await sum.click();
    await expect(pop).toBeVisible();
    await expect(sum).toHaveAttribute('aria-expanded', 'true');
    await expect(page.locator('#fresh-line')).toContainText('Shortcut: ');
    await expect(page.locator('#fresh-line')).toContainText('Page: ');

    await page.keyboard.press('Escape');
    await expect(pop).toBeHidden();
    await expect(sum).toHaveAttribute('aria-expanded', 'false');
    await expect(sum).toBeFocused();

    await sum.click();
    await expect(pop).toBeVisible();
    // a tap on plain text outside the freshness group
    await page.locator('#my-journal .tn-h').click();
    await expect(pop).toBeHidden();
    await expect(sum).toHaveAttribute('aria-expanded', 'false');
  });
});

test('a logged past day reaches Constancia through the food summary and opens in Registrar', async ({ page, today }) => {
  const date = shiftDays(today, -6);
  const label = unique('E2E summary');
  // the day as it stands before (a retry may find an entry an interrupted attempt left): the summary must add ours
  const before = await page.request.get(`/api/food/log/summary?from=${date}&to=${date}`, { headers: { 'X-HC-Food': '1' } });
  expect(before.status()).toBe(200);
  const base = (await before.json()).days.find((d) => d.date === date) || { k: 0, n: 0, groups: { lunch: 0 } };
  const res = await apiWrite(page, 'POST', '/api/food/log', 'food', { date, meal: 'lunch', refType: 'quick', label, kcal: 437 });
  const { entry } = await res.json();
  await withCleanup(async () => {
    const summary = page.waitForResponse((r) => {
      const u = new URL(r.url());
      return r.request().method() === 'GET' && u.pathname === '/api/food/log/summary' &&
        u.searchParams.get('from') <= date && u.searchParams.get('to') >= date;
    });
    await openLan(page, '#nutricion');
    const sres = await summary;
    expect(sres.status()).toBe(200);
    expect((await sres.json()).days.find((d) => d.date === date)).toMatchObject({ k: base.k + 437, n: base.n + 1, groups: { lunch: base.groups.lunch + 1 } });

    // the Constancia strip marks the day as partly logged (no breakfast, no dinner)
    const cell = page.locator(`#food-adherence [data-adh-day="${date}"]`);
    await expect(cell).toHaveClass(/adh-partial/);
    await expect(cell).toHaveAttribute('aria-label', /partly logged/);
    await expect(cell.locator('.adh-m')).toHaveText('·');

    // a tap opens that day in Registrar, with the entry and its kcal
    await cell.click();
    const row = page.locator('#food-log li').filter({ hasText: label });
    await expect(row).toBeVisible();
    await expect(row.locator('.fe-kcal b')).toHaveText('437');
  }, () => apiWrite(page, 'DELETE', `/api/food/log/${entry.id}`, 'food'));
});
