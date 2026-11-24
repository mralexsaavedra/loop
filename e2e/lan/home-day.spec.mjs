// Home on a past day with the server's data (docs/home-tab.md → Day stepping): food logged for yesterday through
// the data service reaches the page on the next build (Sync), and stepping Home back one day shows that day's
// nutrition score and "Activities · <date>", each opening its sheet on that day. The stack seeds a synthetic Health
// extract ending today (e2e/lan/stack.mjs), which is what makes the day stepper reachable at all.
import { randomUUID } from 'node:crypto';
import { test, expect, openLan, unique, apiWrite, syncAndReload, shiftDays, withCleanup, SYNC_TEST_MS } from './fixtures.mjs';
import { hashOf } from '../fixtures.mjs';

test('a day logged on the server shows on Home when stepping back to it', async ({ page, today }) => {
  test.setTimeout(SYNC_TEST_MS);
  const day = shiftDays(today, -1);
  const label = unique('E2E past lunch');
  const res = await apiWrite(page, 'POST', '/api/food/log', 'food', {
    date: day, meal: 'lunch', refType: 'quick', label, kcal: 650, protein: 40, carbs: 70, fat: 22, requestId: randomUUID(),
  });
  const { entry } = await res.json();
  await withCleanup(async () => {
    await page.addInitScript(() => localStorage.setItem('hc.onboarding.later', '1'));
    await openLan(page);
    // the score and the day's numbers are baked by the page build: Sync publishes them
    await syncAndReload(page);
    await expect(page.locator('#act-btn')).toBeVisible();

    await page.locator('#day-prev').click();
    expect(hashOf(page)).toBe(`#d=${day}`);
    const fmt = await page.evaluate((iso) => /** @type {any} */ (window).HC.fmtDate(iso), day);
    await expect(page.locator('#day-word')).toContainText(fmt, { ignoreCase: true });
    await expect(page.locator('#timeline')).toContainText(fmt);

    // that day's nutrition score, which opens the nutrition sheet on that day
    const score = page.locator('#home-nscore');
    await expect(score).toBeVisible();
    const opener = score.locator(`[data-detail][data-date="${day}"]`).first();
    await expect(opener).toBeVisible();
    await opener.click();
    await expect(page.locator('#detail')).toBeVisible();
    expect(hashOf(page)).toContain(day);
    await page.keyboard.press('Escape');
    await expect(page.locator('#detail')).toBeHidden();
    expect(hashOf(page)).toBe(`#d=${day}`);

    // a reload keeps the past day; the label returns to today
    await page.reload();
    await expect(page.locator('#home-nscore')).toBeVisible();
    expect(hashOf(page)).toBe(`#d=${day}`);
    await page.locator('#day-lbl').click();
    expect(hashOf(page)).toBe('#home');
  }, () => apiWrite(page, 'DELETE', `/api/food/log/${entry.id}`, 'food'));
});
