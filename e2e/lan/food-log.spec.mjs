// The food log against the real data service (docs/nutrition-food-log.md): the "+" button and the `a` key open
// the add sheet; a quick entry and a built-in basic food are logged for today, shown in the day's log and
// deleted again.
import { test, expect, openLan, unique, apiResponse } from './fixtures.mjs';
import { openAddSheet, saveEntry, logRow } from './food-ui.mjs';

test('a quick entry is logged for today, listed in the log and deleted', async ({ page, today }) => {
  await openLan(page);
  await openAddSheet(page);
  const label = unique('E2E quick');
  await page.locator('#fa-meal').selectOption('lunch');
  await page.locator('#detail [data-food-act="tab"][data-tab="quick"]').click();
  await page.locator('#fa-label').fill(label);
  await page.locator('#fa-kcal').fill('420');
  await page.locator('#fa-p').fill('30');
  await page.locator('#fa-c').fill('40');
  await page.locator('#fa-f').fill('15');
  const res = await saveEntry(page);
  expect(res.request().postDataJSON()).toMatchObject({ date: today, meal: 'lunch', refType: 'quick', label });

  await page.locator('#t-nutricion').click();
  const row = logRow(page, label);
  await expect(row).toBeVisible();
  await expect(page.locator('#food-msg')).not.toBeEmpty();

  const deleted = page.waitForResponse((r) => r.request().method() === 'DELETE' && r.url().includes('/api/food/log/'));
  await row.locator('[data-food-act="del"]').click();
  expect((await deleted).status()).toBeLessThan(300);
  await expect(row).toHaveCount(0);
});

test('the a key opens the add sheet, and a built-in basic food is logged by weight', async ({ page, today }) => {
  await openLan(page);
  await page.keyboard.press('a');
  await expect(page.locator('#fa-q')).toBeVisible();
  await page.locator('#fa-meal').selectOption('dinner');
  await page.locator('#fa-q').fill('apple');
  const basic = page.locator('#detail [data-food-act="pick"][data-kind="basic"]').filter({ hasText: 'Apple' }).first();
  await expect(basic).toBeVisible();
  await basic.click();
  // a basic food starts in its own portion; log it by weight
  await page.locator('#fa-unit').selectOption('g');
  await page.locator('#fa-amt').fill('150');
  await expect(page.locator('#fa-prev')).not.toBeEmpty();
  const res = await saveEntry(page);
  expect(res.request().postDataJSON()).toMatchObject({ meal: 'dinner', refType: 'quick', date: today });
  const { entry } = await res.json();

  // listed under today with its own delete button; deleted again (the LAN specs share one database)
  await page.locator('#t-nutricion').click();
  const del = page.locator(`#food-log [data-food-act="del"][data-id="${entry.id}"]`);
  await expect(del).toBeVisible();
  const deleted = apiResponse(page, 'DELETE', `/api/food/log/${entry.id}`);
  await del.click();
  expect((await deleted).status()).toBe(200);
  await expect(del).toHaveCount(0);
});
