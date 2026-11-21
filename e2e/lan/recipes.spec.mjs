// Recipes against the real data service (docs/nutrition-food-log.md → Recipes): built from a product, then
// logged from the add sheet's Recipes tab.
import { test, expect, openLan, unique, apiResponse } from './fixtures.mjs';
import { openAddSheet, saveEntry, createProduct, logRow } from './food-ui.mjs';

test('a recipe is built from a product and logged', async ({ page }) => {
  await openLan(page);
  const product = await createProduct(page, { name: unique('E2E rice'), kcal: 130, p: 2.7, c: 28, f: 0.3 });

  const fold = page.locator('#food-recipes');
  if (!(await fold.evaluate((d) => d.open))) await fold.locator('summary').first().click();
  await page.locator('#food-recipes [data-food-act="r-new"]').click();
  const name = unique('E2E bowl');
  await page.locator('#frf-name').fill(name);
  await page.locator('#frf-ing-0').fill(product);
  await page.locator('#frf-list-0 [data-food-act="r-pick"][data-kind="product"]').filter({ hasText: product }).click();
  await page.locator('#frf-amt-0').fill('200');
  await expect(page.locator('#frf-prev')).not.toBeEmpty();
  const saved = apiResponse(page, 'POST', '/api/food/recipes');
  await page.locator('#food-recipes [data-food-act="r-save"]').click();
  const res = await saved;
  expect(res.status(), await res.text()).toBe(201);
  await expect(page.locator('#fr-body')).toContainText(name);

  await openAddSheet(page);
  await page.locator('#fa-meal').selectOption('lunch');
  await page.locator('#detail [data-food-act="tab"][data-tab="recipes"]').click();
  await page.locator('#detail [data-food-act="pick"][data-kind="recipe"]').filter({ hasText: name }).click();
  if (!(await page.locator('#fa-amt').inputValue())) await page.locator('#fa-amt').fill('1');
  const logged = await saveEntry(page);
  expect(logged.request().postDataJSON()).toMatchObject({ refType: 'recipe', meal: 'lunch' });
  await page.locator('#t-nutricion').click();
  await expect(logRow(page, name)).toBeVisible();
});
