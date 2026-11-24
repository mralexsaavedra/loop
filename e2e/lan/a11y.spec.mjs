// Accessibility of what only the served page has (WCAG 2.1 A / AA through axe, e2e/a11y.mjs): the add-food sheet in
// each of its states, the food log, the product and recipe forms, the journal, the profile with the server settings,
// the "+" menu and the first-run assistant. Nothing here writes to the shared database.
import { test, expect, openLan, openProfile } from './fixtures.mjs';
import { openAddSheet, openProducts } from './food-ui.mjs';
import { expectAccessible } from '../a11y.mjs';

test('the add-food sheet: products, a picked food, recipes and a quick entry', async ({ page }) => {
  await openLan(page);
  await openAddSheet(page);
  await expectAccessible(page, 'add sheet, products tab');
  await page.locator('#fa-q').fill('apple');
  await expect(page.locator('#detail [data-food-act="pick"]').first()).toBeVisible();
  await expectAccessible(page, 'add sheet, search results');
  await page.locator('#detail [data-food-act="pick"]').first().click();
  await expect(page.locator('#fa-amt')).toBeVisible();
  await expectAccessible(page, 'add sheet, a picked food');
  await page.locator('#detail [data-food-act="unpick"]').first().click();
  await page.locator('#detail [data-food-act="tab"][data-tab="recipes"]').click();
  await expectAccessible(page, 'add sheet, recipes tab');
  await page.locator('#detail [data-food-act="tab"][data-tab="quick"]').click();
  await expect(page.locator('#fa-label')).toBeVisible();
  await expectAccessible(page, 'add sheet, quick tab');
});

test('the Nutrition tab with the food log and the product and recipe forms open', async ({ page }) => {
  await openLan(page, '#nutricion');
  await expect(page.locator('#food-log-block')).toBeVisible();
  await expectAccessible(page, 'Nutrition tab with the food log');
  await openProducts(page);
  await page.locator('#food-products [data-food-act="p-new"]').click();
  await expectAccessible(page, 'product lookup');
  await page.locator('#food-products [data-food-act="p-label"]').click();
  await expect(page.locator('#fpf-name')).toBeVisible();
  await expectAccessible(page, 'product form');
  const fold = page.locator('#food-recipes');
  if (!(await fold.evaluate((d) => /** @type {HTMLDetailsElement} */ (d).open))) await fold.locator('summary').first().click();
  await page.locator('#food-recipes [data-food-act="r-new"]').click();
  await expect(page.locator('#frf-name')).toBeVisible();
  await expectAccessible(page, 'recipe form');
});

test('the journal sheet and the "+" menu', async ({ page }) => {
  await openLan(page);
  await page.locator('#act-btn').click();
  await expect(page.locator('#act-pop')).toBeVisible();
  await expectAccessible(page, '"+" menu open');
  await page.locator('#act-pop [data-act="journal"]').click();
  await expect(page.locator('#jr-save')).toBeVisible();
  await expectAccessible(page, 'journal sheet');
  await page.locator('summary[data-jr="man"]').click();
  await expectAccessible(page, 'journal sheet, behaviours open');
});

test('the profile with the server settings', async ({ page }) => {
  await openProfile(page);
  await expect(page.locator('#pf-target')).toBeVisible();
  await expect(page.locator('#pf-lang')).toBeVisible();
  await expectAccessible(page, 'profile with settings');
});

test('the first-run assistant, screen by screen', async ({ page }) => {
  // a first run at the page boundary (no profile, no goal); nothing is saved
  await page.route('**/api/food/profile', (route) =>
    route.request().method() === 'GET' ? route.fulfill({ json: { profile: null } }) : route.abort());
  await page.route('**/api/food/settings', (route) =>
    route.request().method() === 'GET'
      ? route.fulfill({ json: { settings: { goal: null, targetWeightKg: null, locale: null } } })
      : route.abort());
  await page.goto('/');
  const sheet = page.locator('#detail');
  await expect(sheet).toBeVisible();
  const next = page.locator('#detail [data-onb-act="next"]');
  const fill = {
    name: () => page.locator('#onb-name').fill('E2E'),
    sex: () => page.locator('input[name="onb-sex"][value="male"]').check({ force: true }),
    birthdate: () => page.locator('#onb-birthdate').fill('1990-05-10'),
    heightCm: () => page.locator('#onb-heightCm').fill('178'),
    weightKg: () => page.locator('#onb-weightKg').fill('80'),
  };
  // welcome, then each screen until the safety screen: checked as it is shown, then answered
  await expectAccessible(page, 'onboarding: welcome');
  await next.click();
  for (const [key, answer] of Object.entries(fill)) {
    await expectAccessible(page, `onboarding: ${key}`);
    await answer();
    await next.click();
  }
  await expectAccessible(page, 'onboarding: activity');
  await next.click();
  await page.locator('input[name="onb-sport"][value="strength"]').check({ force: true });
  await expectAccessible(page, 'onboarding: sports');
  await next.click();
  await expectAccessible(page, 'onboarding: a sport');
  await next.click();
  await expect(page.locator('#detail [data-onb-field="medical"]')).toBeVisible();
  await expectAccessible(page, 'onboarding: safety');
  await next.click();
  await page.locator('input[name="onb-goal"][value="maintain"]').check({ force: true });
  await expectAccessible(page, 'onboarding: goal');
  await next.click();
  await expectAccessible(page, 'onboarding: summary');
});
