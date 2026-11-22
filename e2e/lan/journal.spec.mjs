// The behaviour journal against the real data service (docs/journal.md): today's answers are saved and read
// back, and a behaviour switched off disappears from the questions.
import { test, expect, openLan, apiResponse, apiWrite } from './fixtures.mjs';

async function openJournal(page) {
  // the `d` shortcut works once journal.js registered its view (after GET /api/journal/settings answered); the My
  // journal card comes from another request and can show first
  await expect(page.locator('#my-journal')).toBeVisible();
  await expect.poll(() => page.evaluate(() => !!(window.HCViews && window.HCViews.journal))).toBe(true);
  await page.keyboard.press('d');
  await expect(page.locator('#jr-save')).toBeVisible();
}

test('today\'s answers are saved and shown again when the journal reopens', async ({ page, today }) => {
  // start from an empty day, so the clicks below mean the same on a retry (the database is shared)
  await apiWrite(page, 'PUT', '/api/journal/day', 'journal', { date: today, answers: {} });
  await openLan(page);
  await expect(page.locator('#my-journal')).toBeVisible();
  await openJournal(page);
  await page.locator('#jr-yes-mobility').click();
  await page.locator('#jr-no-nap').click();
  await page.locator('#jr-inc-alcohol').click();
  await page.locator('#jr-inc-alcohol').click();
  await expect(page.locator('#jr-nv-alcohol')).toHaveText('2');
  await page.locator('#jr-notes').fill('E2E note');

  const saved = apiResponse(page, 'PUT', '/api/journal/day');
  await page.locator('#jr-save').click();
  const res = await saved;
  expect(res.status(), await res.text()).toBe(200);
  expect(res.request().postDataJSON()).toMatchObject({
    date: today,
    answers: { mobility: true, nap: false, alcohol: 2 },
    notes: 'E2E note',
  });
  await expect(page.locator('#detail')).toBeHidden();
  await expect(page.locator(`#my-journal [data-date="${today}"] .jr-on`).first()).toBeVisible();

  // a fresh load reads the day back from the server
  await openLan(page);
  await openJournal(page);
  await expect(page.locator('#jr-yes-mobility')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#jr-no-nap')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#jr-nv-alcohol')).toHaveText('2');
  await expect(page.locator('#jr-notes')).toHaveValue('E2E note');
});

test('a behaviour switched off leaves the questions, and back on returns', async ({ page }) => {
  await openLan(page);
  await openJournal(page);
  await expect(page.locator('#jr-yes-caffeine_late')).toBeVisible();
  await page.locator('summary[data-jr="man"]').click();
  const toggle = page.locator('[data-jr="tog"][data-key="caffeine_late"]');
  await expect(toggle).toHaveAttribute('aria-checked', 'true');

  let passed = false;
  try {
    let put = apiResponse(page, 'PUT', '/api/journal/settings');
    await toggle.click();
    expect((await put).request().postDataJSON()).toEqual({ behaviors: { caffeine_late: false } });
    await expect(toggle).toHaveAttribute('aria-checked', 'false');
    await expect(page.locator('#jr-yes-caffeine_late')).toHaveCount(0);

    put = apiResponse(page, 'PUT', '/api/journal/settings');
    await toggle.click();
    expect((await put).status()).toBe(200);
    await expect(toggle).toHaveAttribute('aria-checked', 'true');
    await expect(page.locator('#jr-yes-caffeine_late')).toBeVisible();
    passed = true;
  } finally {
    // whatever failed above, leave the behaviour on: the LAN specs (and a retry) share one database. A failing
    // clean-up fails a test that passed (the shared state is broken), but never hides the failure that got us here
    await apiWrite(page, 'PUT', '/api/journal/settings', 'journal', { behaviors: { caffeine_late: true } })
      .catch((err) => {
        if (passed) throw err;
        console.warn(`journal clean-up failed: ${err.message}`);
      });
  }
});
