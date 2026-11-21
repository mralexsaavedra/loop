// Products against the real data service (docs/nutrition-food-log.md → Products): create from a label, edit,
// log by amount, archive; the Atwater check and its override; the Open Food Facts lookup (stubbed at the page's
// /api/food/off: the real one would call the internet).
import { test, expect, openLan, unique, apiResponse } from './fixtures.mjs';
import { openAddSheet, saveEntry, openProducts, createProduct, logRow } from './food-ui.mjs';

test('a product is created, edited, logged by amount and archived', async ({ page }) => {
  await openLan(page);
  const name = await createProduct(page, { name: unique('E2E oats'), kcal: 380, p: 13, c: 60, f: 7 });

  // edit: rename it
  const renamed = `${name} v2`;
  await page.locator(`#food-products [data-food-act="p-edit"][aria-label*="${name}"]`).click();
  await page.locator('#fpf-name').fill(renamed);
  const put = page.waitForResponse((r) => r.request().method() === 'PUT' && r.url().includes('/api/food/products/'));
  await page.locator('#fp-save').click();
  expect((await put).status()).toBe(200);
  await expect(page.locator('#fp-body')).toContainText(renamed);

  // log 80 g of it from the add sheet's Products tab
  await openAddSheet(page);
  await page.locator('#fa-meal').selectOption('breakfast');
  await page.locator('#detail [data-food-act="tab"][data-tab="products"]').click();
  await page.locator('#fa-q').fill(renamed);
  await page.locator('#detail [data-food-act="pick"][data-kind="product"]').filter({ hasText: renamed }).click();
  await page.locator('#fa-amt').fill('80');
  const res = await saveEntry(page);
  expect(res.request().postDataJSON()).toMatchObject({ refType: 'product', amount: 80, meal: 'breakfast' });
  await page.locator('#t-nutricion').click();
  await expect(logRow(page, renamed)).toBeVisible();

  // archive (two clicks): gone from the list
  await openProducts(page);
  const item = page.locator('#fp-body li').filter({ hasText: renamed });
  await item.locator('[data-food-act="p-archive"]').click();
  const del = page.waitForResponse((r) => r.request().method() === 'DELETE' && r.url().includes('/api/food/products/'));
  await item.locator('[data-food-act="p-archive-ok"]').click();
  expect((await del).status()).toBe(200);
  await expect(page.locator('#fp-body')).not.toContainText(renamed);
});

test('macros that break the Atwater check are refused until the save is forced', async ({ page, pageErrors }) => {
  // the refused save is a 400 on purpose
  pageErrors.allow(/Failed to load resource: the server responded with a status of 400/);
  await openLan(page);
  await openProducts(page);
  const name = unique('E2E odd label');
  await page.locator('#food-products [data-food-act="p-new"]').click();
  await page.locator('#food-products [data-food-act="p-label"]').click();
  await page.locator('#fpf-name').fill(name);
  // 4·50 + 4·10 + 9·5 = 285 kcal against a label that says 100
  await page.locator('#fpf-kcal').fill('100');
  await page.locator('#fpf-p').fill('50');
  await page.locator('#fpf-c').fill('10');
  await page.locator('#fpf-f').fill('5');
  const refused = apiResponse(page, 'POST', '/api/food/products');
  await page.locator('#fp-save').click();
  expect((await refused).status()).toBe(400);
  await expect(page.locator('#fp-form-msg')).not.toBeEmpty();

  const forced = apiResponse(page, 'POST', '/api/food/products');
  await page.locator('#food-products [data-food-act="p-save-force"]').click();
  expect((await forced).status()).toBe(201);
  await expect(page.locator('#fp-body')).toContainText(name);
});

test('an Open Food Facts search fills the form and the product is saved from it', async ({ page }) => {
  const name = unique('E2E OFF muesli');
  await page.route('**/api/food/off?**', (route) =>
    route.fulfill({
      json: {
        results: [{ code: '8410000000001', name, brand: 'E2E brand', stores: '', unit: 'g', servingSize: 40, per100: { kcal: 370, protein: 10, carbs: 62, fat: 7 } }],
      },
    }),
  );
  await openLan(page);
  await openProducts(page);
  await page.locator('#food-products [data-food-act="p-new"]').click();
  await page.locator('#fp-q').fill('muesli');
  await page.locator('#food-products [data-food-act="p-search"]').click();
  await page.locator('#food-products [data-food-act="p-use"][data-i="0"]').click();
  await expect(page.locator('#fpf-name')).toHaveValue(name);
  await expect(page.locator('#fpf-kcal')).toHaveValue('370');

  const saved = apiResponse(page, 'POST', '/api/food/products');
  await page.locator('#fp-save').click();
  const res = await saved;
  expect(res.status()).toBe(201);
  expect(res.request().postDataJSON()).toMatchObject({ name, source: 'off' });
  await expect(page.locator('#fp-body')).toContainText(name);
});
