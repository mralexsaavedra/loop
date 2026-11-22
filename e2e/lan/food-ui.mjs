// UI steps the food specs share (docs/nutrition-food-log.md; web/src/client/food-*.js).
import { expect, apiResponse } from './fixtures.mjs';

/** Open the add sheet from the "+" button. */
export async function openAddSheet(page) {
  await page.locator('#act-btn').click();
  await page.locator('#act-pop [data-act="food"]').click();
  await expect(page.locator('#detail')).toBeVisible();
  await expect(page.locator('#fa-meal')).toBeVisible();
}

/** Save the add sheet's entry and return the POST /api/food/log response. */
export async function saveEntry(page) {
  const logged = apiResponse(page, 'POST', '/api/food/log');
  await page.locator('#fa-save').click();
  const res = await logged;
  expect(res.status(), await res.text()).toBeLessThan(300);
  await expect(page.locator('#detail')).toBeHidden();
  return res;
}

/** Open the Nutrition tab's products fold (it ships closed). */
export async function openProducts(page) {
  await page.locator('#t-nutricion').click();
  const fold = page.locator('#food-products');
  if (!(await fold.evaluate((d) => d.open))) await fold.locator('summary').first().click();
  await expect(page.locator('#fp-body')).toBeVisible();
}

/** Create a product with macros per 100 g through the products fold; returns its name. */
export async function createProduct(page, { name, kcal, p, c, f }) {
  await openProducts(page);
  await page.locator('#food-products [data-food-act="p-new"]').click();
  await page.locator('#food-products [data-food-act="p-label"]').click();
  await page.locator('#fpf-name').fill(name);
  await page.locator('#fpf-kcal').fill(String(kcal));
  await page.locator('#fpf-p').fill(String(p));
  await page.locator('#fpf-c').fill(String(c));
  await page.locator('#fpf-f').fill(String(f));
  const saved = apiResponse(page, 'POST', '/api/food/products');
  await page.locator('#fp-save').click();
  const res = await saved;
  expect(res.status(), await res.text()).toBeLessThan(300);
  await expect(page.locator('#fp-body')).toContainText(name);
  return name;
}

/** The logged row of `label` in the day's food log. */
export const logRow = (page, label) => page.locator('#food-log li').filter({ hasText: label });
