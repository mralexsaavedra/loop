// The product and recipe catalog against the real data service, beyond the happy paths of products.spec.mjs and
// recipes.spec.mjs (docs/nutrition-food-log.md → Products, Recipes; web/src/client/food-catalog.js,
// food-sheet.js; services/loop-ingest/src/food.js): recipe edit / archive, several ingredients, a built-in basic
// as an ingredient, the Atwater override, a batch recipe logged by grams, cancelling either editor; the barcode
// lookup (stubbed at the page's /api/food/off: the real one would call the internet), "log by serving" and a
// server field error shown inline.
//
// Every product / recipe / log entry a test creates is removed in its finally through the API (apiWrite), so the
// shared database keeps only what other specs create.
import { test, expect, openLan, unique, apiResponse, apiWrite } from './fixtures.mjs';
import { settle } from '../fixtures.mjs';
import { openAddSheet, saveEntry, openProducts, logRow } from './food-ui.mjs';

// every test walks a whole flow (several API calls, an editor, a reload or the add sheet) on the shared stack
test.slow(true, 'multi-step catalog flows against the real data service');

/* ---------- local helpers ---------- */

/** Create a product straight through the API (before the page loads, so the page boots with it); returns it. */
async function apiProduct(page, { name, kcal, p, c, f, ...rest }) {
  const res = await apiWrite(page, 'POST', '/api/food/products', 'food', {
    name, store: 'mercadona', unit: 'g', per100: { kcal, protein: p, carbs: c, fat: f }, source: 'label', ...rest,
  });
  return (await res.json()).product;
}

/** A read of the food API (every request needs the X-HC-Food header, docs/lan-services.md). */
const apiGet = (page, pathname) => page.request.get(pathname, { headers: { 'X-HC-Food': '1' } });

/** The catalog as the data service lists it now. */
async function listProducts(page) {
  const res = await apiGet(page, '/api/food/products');
  expect(res.status()).toBe(200);
  return (await res.json()).products;
}
async function listRecipes(page) {
  const res = await apiGet(page, '/api/food/recipes');
  expect(res.status()).toBe(200);
  return (await res.json()).recipes;
}

/** Archive what a test created; a row already archived through the UI is skipped (the service answers 404). */
async function cleanUp(page, { products = [], recipes = [], entries = [] }) {
  for (const id of entries) await apiWrite(page, 'DELETE', `/api/food/log/${id}`, 'food');
  const liveR = new Set((await listRecipes(page)).map((r) => r.id));
  for (const id of recipes) if (liveR.has(id)) await apiWrite(page, 'DELETE', `/api/food/recipes/${id}`, 'food');
  const liveP = new Set((await listProducts(page)).map((p) => p.id));
  for (const id of products) if (liveP.has(id)) await apiWrite(page, 'DELETE', `/api/food/products/${id}`, 'food');
}

/** Open the Nutrition tab's recipes fold (it ships closed). */
async function openRecipes(page) {
  await page.locator('#t-nutricion').click();
  const fold = page.locator('#food-recipes');
  if (!(await fold.evaluate((d) => d.open))) await fold.locator('summary').first().click();
  await expect(page.locator('#fr-body')).toBeVisible();
}

/** Pick one of the user's products for ingredient row i of the open recipe editor. */
async function pickProduct(page, i, product) {
  await page.locator(`#frf-ing-${i}`).fill(product.name);
  await page.locator(`#frf-list-${i} [data-food-act="r-pick"][data-kind="product"][data-id="${product.id}"]`).click();
  await expect(page.locator(`#frf-amt-${i}`)).toBeVisible();
}

/** A built-in basic of the page (window.HCFoodInternal.BASICS, the baked public food DB) measured in grams with
 * no piece (one amount mode), not hidden, whose macros pass (`atwater` true) or break (false) the Atwater check
 * (lib/nutrition/foodlog.mjs atwaterOk); null when the page has none. */
function findBasic(page, atwater) {
  return page.evaluate((want) => {
    const ok = (m) => Math.abs(4 * m[1] + 4 * m[2] + 9 * m[3] - m[0]) <= Math.max(0.25 * m[0], 10);
    const b = window.HCFoodInternal.BASICS.find((x) => x.u === 'g' && !x.pc && !x.h && ok(x.m) === want);
    return b ? { k: b.k, n: b.n, m: b.m } : null;
  }, atwater);
}

/** Every write the page sends to `pathname` from now on (method + path), to prove a cancel sent none. */
function recordWrites(page, pathname) {
  const writes = [];
  page.on('request', (r) => {
    if (r.method() !== 'GET' && new URL(r.url()).pathname.startsWith(pathname)) writes.push(`${r.method()} ${r.url()}`);
  });
  return writes;
}

/** A barcode no other test (or run) uses: the service refuses a second product with the same one. */
const uniqueBarcode = () => String(Date.now()).slice(-9) + String(Math.floor(Math.random() * 1e4)).padStart(4, '0');

/* ---------- recipes ---------- */

test('a recipe of several products is saved, edited and archived', async ({ page }) => {
  const made = { products: [], recipes: [] };
  try {
    const a = await apiProduct(page, { name: unique('E2E rice'), kcal: 130, p: 2.7, c: 28, f: 0.3 });
    const b = await apiProduct(page, { name: unique('E2E beans'), kcal: 120, p: 8, c: 21, f: 0.5 });
    const decoy = await apiProduct(page, { name: unique('E2E decoy'), kcal: 100, p: 5, c: 15, f: 2 });
    made.products.push(a.id, b.id, decoy.id);
    await openLan(page);
    await openRecipes(page);

    // three ingredient rows, the middle one removed again: the rows after it move up with their amounts
    await page.locator('#food-recipes [data-food-act="r-new"]').click();
    const name = unique('E2E stew');
    await page.locator('#frf-name').fill(name);
    await page.locator('#frf-serv').fill('2');
    await pickProduct(page, 0, a);
    await page.locator('#frf-amt-0').fill('200');
    await page.locator('#food-recipes [data-food-act="r-add-ing"]').click();
    await expect(page.locator('#frf-ing-1')).toBeVisible();
    await pickProduct(page, 1, decoy);
    await page.locator('#frf-amt-1').fill('10');
    await page.locator('#food-recipes [data-food-act="r-add-ing"]').click();
    await pickProduct(page, 2, b);
    await page.locator('#frf-amt-2').fill('50');
    await page.locator('#food-recipes [data-food-act="r-del-ing"][data-i="1"]').click();
    await expect(page.locator('#frf-amt-2')).toHaveCount(0);
    await expect(page.locator('#frf-amt-0')).toHaveValue('200');
    await expect(page.locator('#frf-amt-1')).toHaveValue('50');
    await expect(page.locator('#fr-body .fr-ing-picked').nth(1)).toContainText(b.name);

    const saved = apiResponse(page, 'POST', '/api/food/recipes');
    await page.locator('#food-recipes [data-food-act="r-save"]').click();
    const res = await saved;
    expect(res.status(), await res.text()).toBe(201);
    expect(res.request().postDataJSON()).toEqual({
      name, kind: 'serving', servings: 2,
      ingredients: [{ productId: a.id, amount: 200 }, { productId: b.id, amount: 50 }],
    });
    const { recipe } = await res.json();
    made.recipes.push(recipe.id);
    // (130·2 + 120·0.5) / 2 servings = 160 kcal per serving
    expect(recipe.perServing.kcal).toBe(160);
    await expect(page.locator('#frf-name')).toHaveCount(0);
    await expect(page.locator('#fr-body')).toContainText(name);

    // edit: rename it (the editor opens with what was saved)
    const renamed = unique('E2E stew renamed');
    await page.locator(`#food-recipes [data-food-act="r-edit"][data-id="${recipe.id}"]`).click();
    await expect(page.locator('#frf-name')).toHaveValue(name);
    await expect(page.locator('#frf-amt-1')).toHaveValue('50');
    await page.locator('#frf-name').fill(renamed);
    const put = apiResponse(page, 'PUT', `/api/food/recipes/${recipe.id}`);
    await page.locator('#food-recipes [data-food-act="r-save"]').click();
    const putRes = await put;
    expect(putRes.status()).toBe(200);
    expect(putRes.request().postDataJSON()).toMatchObject({ name: renamed, servings: 2 });
    await expect(page.locator('#fr-body')).toContainText(renamed);
    await expect(page.locator('#fr-body')).not.toContainText(name);
    const stored = (await listRecipes(page)).find((r) => r.id === recipe.id);
    expect(stored).toMatchObject({ name: renamed, kind: 'serving', servings: 2 });
    expect(stored.ingredients.map((i) => [i.productId, i.amount])).toEqual([[a.id, 200], [b.id, 50]]);

    // still there after a reload
    await page.reload();
    await expect(page.locator('#act-btn')).toBeVisible();
    await openRecipes(page);
    await expect(page.locator('#fr-body')).toContainText(renamed);

    // archive (two clicks): gone from the list and from the service
    const item = page.locator('#fr-body li').filter({ hasText: renamed });
    await item.locator('[data-food-act="r-archive"]').click();
    const del = apiResponse(page, 'DELETE', `/api/food/recipes/${recipe.id}`);
    await item.locator('[data-food-act="r-archive-ok"]').click();
    expect((await del).status()).toBe(200);
    await expect(page.locator('#fr-body')).not.toContainText(renamed);
    expect((await listRecipes(page)).some((r) => r.id === recipe.id)).toBe(false);
  } finally {
    await cleanUp(page, made);
  }
});

test('a built-in basic ingredient is stored as its snapshot, and Change clears a pick', async ({ page }) => {
  const made = { products: [], recipes: [] };
  try {
    const a = await apiProduct(page, { name: unique('E2E pasta'), kcal: 350, p: 12, c: 70, f: 2 });
    made.products.push(a.id);
    await openLan(page);
    const basic = await findBasic(page, true);
    expect(basic, 'the page bakes a basic measured in grams').not.toBeNull();
    await openRecipes(page);
    await page.locator('#food-recipes [data-food-act="r-new"]').click();
    const name = unique('E2E basic dish');
    await page.locator('#frf-name').fill(name);

    // pick a product, then Change: the row is a search again, with no amount
    await pickProduct(page, 0, a);
    await page.locator('#food-recipes [data-food-act="r-unpick"][data-i="0"]').click();
    await expect(page.locator('#frf-ing-0')).toBeVisible();
    await expect(page.locator('#frf-ing-0')).toHaveValue('');
    await expect(page.locator('#frf-amt-0')).toHaveCount(0);

    // the basic instead, by weight
    await page.locator('#frf-ing-0').fill(basic.n);
    await page.locator(`#frf-list-0 [data-food-act="r-pick"][data-kind="basic"][data-id="${basic.k}"]`).click();
    await expect(page.locator('#fr-body .fr-ing-picked')).toContainText(basic.n);
    await page.locator('#frf-amt-0').fill('150');
    await expect(page.locator('#frf-prev')).not.toBeEmpty();

    const saved = apiResponse(page, 'POST', '/api/food/recipes');
    await page.locator('#food-recipes [data-food-act="r-save"]').click();
    const res = await saved;
    expect(res.status(), await res.text()).toBe(201);
    const per100 = { kcal: basic.m[0], protein: basic.m[1], carbs: basic.m[2], fat: basic.m[3] };
    const snapshot = { basic: basic.k, name: basic.n, unit: 'g', amount: 150, per100 };
    expect(res.request().postDataJSON()).toEqual({ name, kind: 'serving', servings: 1, ingredients: [snapshot] });
    const { recipe } = await res.json();
    made.recipes.push(recipe.id);
    await expect(page.locator('#fr-body')).toContainText(name);
    const stored = (await listRecipes(page)).find((r) => r.id === recipe.id);
    expect(stored.ingredients).toEqual([snapshot]);
  } finally {
    await cleanUp(page, made);
  }
});

test('a basic that breaks the Atwater check is refused until the recipe is saved anyway', async ({ page, pageErrors }) => {
  // the refused save is a 400 on purpose
  pageErrors.allow(/Failed to load resource: the server responded with a status of 400/);
  const made = { recipes: [] };
  try {
    await openLan(page);
    const basic = await findBasic(page, false);
    test.skip(!basic, 'the baked food DB has no gram basic that breaks the Atwater check');
    await openRecipes(page);
    await page.locator('#food-recipes [data-food-act="r-new"]').click();
    const name = unique('E2E odd basic');
    await page.locator('#frf-name').fill(name);
    await page.locator('#frf-ing-0').fill(basic.n);
    await page.locator(`#frf-list-0 [data-food-act="r-pick"][data-kind="basic"][data-id="${basic.k}"]`).click();
    await page.locator('#frf-amt-0').fill('100');

    const refused = apiResponse(page, 'POST', '/api/food/recipes');
    await page.locator('#food-recipes [data-food-act="r-save"]').click();
    const bad = await refused;
    expect(bad.status()).toBe(400);
    expect(await bad.json()).toMatchObject({ error: 'atwater' });
    expect(bad.request().postDataJSON().force).toBeUndefined();
    const force = page.locator('#fr-form-msg [data-food-act="r-save-force"]');
    await expect(force).toBeVisible();
    await expect(page.locator('#frf-name')).toHaveValue(name); // the editor stays open
    expect((await listRecipes(page)).some((r) => r.name === name)).toBe(false);

    const forced = apiResponse(page, 'POST', '/api/food/recipes');
    await force.click();
    const ok = await forced;
    expect(ok.status(), await ok.text()).toBe(201);
    expect(ok.request().postDataJSON()).toMatchObject({ name, force: true, ingredients: [{ basic: basic.k, amount: 100 }] });
    made.recipes.push((await ok.json()).recipe.id);
    await expect(page.locator('#fr-body')).toContainText(name);
    expect((await listRecipes(page)).some((r) => r.name === name)).toBe(true);
  } finally {
    await cleanUp(page, made);
  }
});

test('a batch recipe is saved by its cooked weight and logged by grams', async ({ page, today }) => {
  const made = { products: [], recipes: [], entries: [] };
  try {
    const a = await apiProduct(page, { name: unique('E2E lentils'), kcal: 130, p: 9, c: 20, f: 0.4 });
    made.products.push(a.id);
    await openLan(page);
    await openRecipes(page);
    await page.locator('#food-recipes [data-food-act="r-new"]').click();
    const name = unique('E2E batch');
    await page.locator('#frf-name').fill(name);
    await page.locator('#frf-kind').selectOption('batch');
    await expect(page.locator('#frf-cooked')).toBeVisible();
    await expect(page.locator('#frf-serv')).toHaveCount(0);
    await expect(page.locator('#frf-name')).toHaveValue(name); // the re-render keeps what was typed
    await page.locator('#frf-cooked').fill('800');
    await pickProduct(page, 0, a);
    await page.locator('#frf-amt-0').fill('400');

    const saved = apiResponse(page, 'POST', '/api/food/recipes');
    await page.locator('#food-recipes [data-food-act="r-save"]').click();
    const res = await saved;
    expect(res.status(), await res.text()).toBe(201);
    expect(res.request().postDataJSON()).toEqual({ name, kind: 'batch', cookedWeightG: 800, ingredients: [{ productId: a.id, amount: 400 }] });
    const { recipe } = await res.json();
    made.recipes.push(recipe.id);
    // 130·4 = 520 kcal over 800 g cooked = 65 kcal per 100 g
    expect(recipe).toMatchObject({ kind: 'batch', cookedWeightG: 800, complete: true, per100: { kcal: 65 } });
    await expect(page.locator('#fr-body')).toContainText(name);

    // logged from the add sheet in grams of cooked food (the only unit of a batch recipe)
    await openAddSheet(page);
    await page.locator('#fa-meal').selectOption('dinner');
    await page.locator('#detail [data-food-act="tab"][data-tab="recipes"]').click();
    await page.locator(`#detail [data-food-act="pick"][data-kind="recipe"][data-id="${recipe.id}"]`).click();
    await expect(page.locator('#fa-unit option')).toHaveCount(1);
    await expect(page.locator('#fa-unit')).toHaveValue('g');
    await page.locator('#fa-amt').fill('200');
    const logged = await saveEntry(page);
    expect(logged.request().postDataJSON()).toMatchObject({ date: today, meal: 'dinner', refType: 'recipe', refId: recipe.id, amount: 200, unit: 'g' });
    const { entry } = await logged.json();
    made.entries.push(entry.id);
    expect(entry).toMatchObject({ refType: 'recipe', amount: 200, unit: 'g', kcal: 130 });
    await page.locator('#t-nutricion').click();
    await expect(logRow(page, name)).toBeVisible();
    const day = await (await apiGet(page, `/api/food/log?date=${today}`)).json();
    expect(day.entries.find((e) => e.id === entry.id)).toMatchObject({ refId: recipe.id, amount: 200, unit: 'g', kcal: 130 });
  } finally {
    await cleanUp(page, made);
  }
});

test('cancelling the recipe editor saves nothing', async ({ page }) => {
  const made = { products: [] };
  try {
    const a = await apiProduct(page, { name: unique('E2E oats'), kcal: 380, p: 13, c: 60, f: 7 });
    made.products.push(a.id);
    await openLan(page);
    await openRecipes(page);
    const writes = recordWrites(page, '/api/food/recipes');
    await page.locator('#food-recipes [data-food-act="r-new"]').click();
    const name = unique('E2E cancelled recipe');
    await page.locator('#frf-name').fill(name);
    await pickProduct(page, 0, a);
    await page.locator('#frf-amt-0').fill('80');
    await page.locator('#food-recipes [data-food-act="r-cancel"]').click();
    await expect(page.locator('#frf-name')).toHaveCount(0);
    await expect(page.locator('#food-recipes [data-food-act="r-new"]')).toBeVisible();
    await settle(page);
    expect(writes).toEqual([]);
    await expect(page.locator('#fr-body')).not.toContainText(name);
    expect((await listRecipes(page)).some((r) => r.name === name)).toBe(false);
  } finally {
    await cleanUp(page, made);
  }
});

/* ---------- products ---------- */

test('a barcode lookup fills the form and the product is saved with its code', async ({ page }) => {
  const made = { products: [] };
  try {
    const name = unique('E2E OFF yogurt');
    const code = uniqueBarcode();
    const lookups = [];
    await page.route('**/api/food/off?**', (route) => {
      lookups.push(new URL(route.request().url()).search);
      return route.fulfill({
        json: { product: { code, name, brand: 'E2E dairy', stores: 'Mercadona', unit: 'g', servingSize: 125, per100: { kcal: 60, protein: 4, carbs: 5, fat: 2.5 } } },
      });
    });
    await openLan(page);
    await openProducts(page);
    await page.locator('#food-products [data-food-act="p-new"]').click();
    await page.locator('#fp-code').fill(code);
    await page.locator('#food-products [data-food-act="p-code"]').click();
    await expect(page.locator('#fp-results .off-card')).toHaveCount(1);
    await expect(page.locator('#fp-results')).toContainText(name);
    expect(lookups).toEqual([`?barcode=${code}`]);

    await page.locator('#food-products [data-food-act="p-use"][data-i="0"]').click();
    await expect(page.locator('#fpf-name')).toHaveValue(name);
    await expect(page.locator('#fpf-brand')).toHaveValue('E2E dairy');
    await expect(page.locator('#fpf-store')).toHaveValue('mercadona');
    await expect(page.locator('#fpf-code')).toHaveValue(code);
    await expect(page.locator('#fpf-kcal')).toHaveValue('60');
    await expect(page.locator('#fpf-f')).toHaveValue('2.5');
    await expect(page.locator('#fpf-serv')).toHaveValue('125');

    const saved = apiResponse(page, 'POST', '/api/food/products');
    await page.locator('#fp-save').click();
    const res = await saved;
    expect(res.status(), await res.text()).toBe(201);
    expect(res.request().postDataJSON()).toEqual({
      name, brand: 'E2E dairy', store: 'mercadona', barcode: code, unit: 'g',
      per100: { kcal: 60, protein: 4, carbs: 5, fat: 2.5 }, servingSize: 125, source: 'off', offCode: code,
    });
    const { product } = await res.json();
    made.products.push(product.id);
    await expect(page.locator('#fp-body')).toContainText(name);
    const stored = (await listProducts(page)).find((p) => p.id === product.id);
    expect(stored).toMatchObject({ name, barcode: code, source: 'off', offCode: code, servingSize: 125 });
  } finally {
    await cleanUp(page, made);
  }
});

test('a product marked "log by serving" starts the add sheet in one serving', async ({ page, today }) => {
  const made = { products: [], entries: [] };
  try {
    await openLan(page);
    await openProducts(page);
    const name = unique('E2E bar');
    await page.locator('#food-products [data-food-act="p-new"]').click();
    await page.locator('#food-products [data-food-act="p-label"]').click();
    await page.locator('#fpf-name').fill(name);
    await page.locator('#fpf-kcal').fill('400');
    await page.locator('#fpf-p').fill('20');
    await page.locator('#fpf-c').fill('50');
    await page.locator('#fpf-f').fill('13');
    await page.locator('#fpf-serv').fill('40');
    await expect(page.locator('#fpf-sdef')).toHaveAttribute('aria-checked', 'false');
    await page.locator('#fpf-sdef').click();
    await expect(page.locator('#fpf-sdef')).toHaveAttribute('aria-checked', 'true');
    await expect(page.locator('#fpf-name')).toHaveValue(name); // the switch keeps what was typed

    const saved = apiResponse(page, 'POST', '/api/food/products');
    await page.locator('#fp-save').click();
    const res = await saved;
    expect(res.status(), await res.text()).toBe(201);
    expect(res.request().postDataJSON()).toMatchObject({ name, servingSize: 40, servingDefault: true, source: 'label' });
    const { product } = await res.json();
    made.products.push(product.id);
    expect((await listProducts(page)).find((p) => p.id === product.id)).toMatchObject({ servingSize: 40, servingDefault: true });

    // the add sheet starts it in servings, amount 1; grams stay the second choice
    await openAddSheet(page);
    await page.locator('#fa-meal').selectOption('lunch');
    await page.locator('#detail [data-food-act="tab"][data-tab="products"]').click();
    await page.locator('#fa-q').fill(name);
    await page.locator(`#detail [data-food-act="pick"][data-kind="product"][data-id="${product.id}"]`).click();
    await expect(page.locator('#fa-unit')).toHaveValue('serving');
    await expect(page.locator('#fa-amt')).toHaveValue('1');
    await expect(page.locator('#fa-unit option')).toHaveCount(2);
    const logged = await saveEntry(page);
    expect(logged.request().postDataJSON()).toMatchObject({ date: today, refType: 'product', refId: product.id, amount: 1, unit: 'serving' });
    const { entry } = await logged.json();
    made.entries.push(entry.id);
    // one 40 g serving of 400 kcal / 100 g
    expect(entry).toMatchObject({ amount: 1, unit: 'serving', kcal: 160 });
    await page.locator('#t-nutricion').click();
    await expect(logRow(page, name)).toBeVisible();
  } finally {
    await cleanUp(page, made);
  }
});

test('cancelling the product form saves nothing', async ({ page }) => {
  await openLan(page);
  await openProducts(page);
  const writes = recordWrites(page, '/api/food/products');
  const name = unique('E2E cancelled product');
  await page.locator('#food-products [data-food-act="p-new"]').click();
  await page.locator('#food-products [data-food-act="p-label"]').click();
  await page.locator('#fpf-name').fill(name);
  await page.locator('#fpf-kcal').fill('100');
  await page.locator('#fpf-p').fill('5');
  await page.locator('#fpf-c').fill('15');
  await page.locator('#fpf-f').fill('2');
  await page.locator('#food-products [data-food-act="p-cancel"]').click();
  await expect(page.locator('#fpf-name')).toHaveCount(0);
  await expect(page.locator('#food-products [data-food-act="p-new"]')).toBeVisible();
  await settle(page);
  expect(writes).toEqual([]);
  await expect(page.locator('#fp-body')).not.toContainText(name);
  expect((await listProducts(page)).some((p) => p.name === name)).toBe(false);
});

test('a field the service refuses is marked under that field', async ({ page, pageErrors }) => {
  // both refused saves are a 400 on purpose
  pageErrors.allow(/Failed to load resource: the server responded with a status of 400/);
  const made = { products: [] };
  try {
    await openLan(page);
    await openProducts(page);
    const name = unique('E2E refused');
    await page.locator('#food-products [data-food-act="p-new"]').click();
    await page.locator('#food-products [data-food-act="p-label"]').click();
    await page.locator('#fpf-name').fill(name);
    // over the 900 kcal / 100 g limit (pure fat is ~900): the page sends it, the service names the field
    await page.locator('#fpf-kcal').fill('950');
    await page.locator('#fpf-p').fill('0');
    await page.locator('#fpf-c').fill('0');
    await page.locator('#fpf-f').fill('100');
    let refused = apiResponse(page, 'POST', '/api/food/products');
    await page.locator('#fp-save').click();
    let bad = await refused;
    expect(bad.status()).toBe(400);
    expect(await bad.json()).toMatchObject({ error: 'invalid', field: 'per100.kcal' });
    await expect(page.locator('#fpf-kcal')).toHaveAttribute('aria-invalid', 'true');
    await expect(page.locator('#fpf-kcal-err')).not.toBeEmpty();
    await expect(page.locator('#fp-form-msg')).not.toBeEmpty();

    // "log by serving" without a serving size: refused on that switch
    await page.locator('#fpf-kcal').fill('900');
    await page.locator('#fpf-sdef').click();
    refused = apiResponse(page, 'POST', '/api/food/products');
    await page.locator('#fp-save').click();
    bad = await refused;
    expect(bad.status()).toBe(400);
    expect(await bad.json()).toMatchObject({ error: 'invalid', field: 'servingDefault' });
    await expect(page.locator('#fpf-kcal')).not.toHaveAttribute('aria-invalid', 'true');
    await expect(page.locator('#fpf-kcal-err')).toBeEmpty();
    await expect(page.locator('#fpf-sdef')).toHaveAttribute('aria-invalid', 'true');
    await expect(page.locator('#fpf-sdef-err')).not.toBeEmpty();
    expect((await listProducts(page)).some((p) => p.name === name)).toBe(false);

    // with a serving size it is saved
    await page.locator('#fpf-serv').fill('30');
    const saved = apiResponse(page, 'POST', '/api/food/products');
    await page.locator('#fp-save').click();
    const ok = await saved;
    expect(ok.status(), await ok.text()).toBe(201);
    made.products.push((await ok.json()).product.id);
    await expect(page.locator('#fp-body')).toContainText(name);
    expect((await listProducts(page)).find((p) => p.name === name)).toMatchObject({ servingSize: 30, servingDefault: true });
  } finally {
    await cleanUp(page, made);
  }
});
