// The profile sheet's goal section against the page the real data service serves (docs/profile.md,
// web/src/client/profile.js + settings.js): the cut and bulk goals, a cleared target weight and a refused save.
// The settings API is answered at the page boundary (GET with a known goal and target, every PUT recorded and
// asserted), so the shared database the other LAN specs read is never changed under them.
import { test, expect, openLan } from './fixtures.mjs';
import { en as pfEn, es as pfEs } from '../../web/src/i18n/profile-templates.mjs';

async function copyOf(page) {
  return (await page.evaluate(() => document.documentElement.lang)) === 'es' ? pfEs : pfEn;
}

/** GET /api/food/settings answers `initial`; each PUT is recorded and answered with the merged settings, or with
 * `putStatus` when it is not 2xx. */
async function mockSettings(page, initial, { putStatus = 200 } = {}) {
  const puts = [];
  const settings = { ...initial };
  await page.route('**/api/food/settings', async (route) => {
    const req = route.request();
    if (req.method() === 'GET') return route.fulfill({ json: { settings } });
    if (req.method() !== 'PUT') return route.fallback();
    puts.push(req.postDataJSON());
    if (putStatus >= 300) return route.fulfill({ status: putStatus, json: { error: 'e2e: refused on purpose' } });
    Object.assign(settings, req.postDataJSON());
    return route.fulfill({ json: { settings } });
  });
  return puts;
}

async function openProfile(page) {
  await openLan(page);
  await expect.poll(() => page.evaluate(() => Boolean(window.HCSettings && window.HCSettings.ready()))).toBe(true);
  await page.locator('#avatar-btn').click();
  await expect(page.locator('#detail')).toBeVisible();
  await expect(page.locator('#pf-target')).toBeVisible(); // the settings API answered
}

// every step waits on the real served page; a loaded host makes 30 s tight
test.describe.configure({ timeout: 90_000 });

/** The food log and journal summary reads share one rate limit per client address across every LAN spec
 * (FOOD_SUMMARY_LIMIT / JOURNAL_SUMMARY_LIMIT, 30 a minute), and these tests never look at them: answer them
 * here with an empty range, so this file neither spends nor trips the shared budget. */
async function emptySummaries(page) {
  await page.route(/\/api\/(food\/log|journal)\/summary\?/, (route) => {
    const q = new URL(route.request().url()).searchParams;
    return route.fulfill({ json: { from: q.get('from'), to: q.get('to'), days: [] } });
  });
}
test.beforeEach(async ({ page }) => emptySummaries(page));

const goal = (page, g) => page.locator(`input[name="pf-goal"][value="${g}"]`);

test('Lose fat and Gain are saved as the goal', async ({ page }) => {
  const puts = await mockSettings(page, { goal: 'maintain', targetWeightKg: 74, locale: null });
  await openProfile(page);
  const T = await copyOf(page);
  await expect(goal(page, 'maintain')).toBeChecked();

  await goal(page, 'cut').check({ force: true });
  await expect(page.locator('#pf-goal-msg')).toHaveText(T.goal.savedGoal);
  expect(puts).toEqual([{ goal: 'cut' }]);
  await expect(goal(page, 'cut')).toBeChecked();
  // the plan follows, and the server's answer clears the pending pick
  expect(await page.evaluate(() => [window.HCNutri.state().goal, window.HCNutri.pendingGoal()])).toEqual(['cut', null]);

  await goal(page, 'bulk').check({ force: true });
  await expect.poll(() => puts.length).toBe(2);
  expect(puts[1]).toEqual({ goal: 'bulk' });
  await expect(page.locator('#pf-goal-msg')).toHaveText(T.goal.savedGoal);
  expect(await page.evaluate(() => [window.HCNutri.state().goal, window.HCNutri.pendingGoal()])).toEqual(['bulk', null]);
  // the target weight is left alone
  await expect(page.locator('#pf-target')).toHaveValue('74.0');
});

test('clearing the target weight sends null', async ({ page }) => {
  const puts = await mockSettings(page, { goal: 'cut', targetWeightKg: 74, locale: null });
  await openProfile(page);
  const T = await copyOf(page);
  await expect(page.locator('#pf-target')).toHaveValue('74.0');

  await page.locator('#pf-target').fill('');
  await page.locator('#pf-target').press('Enter');
  await expect(page.locator('#pf-goal-msg')).toHaveText(T.goal.saved);
  expect(puts).toEqual([{ targetWeightKg: null }]);
  await expect(page.locator('#pf-target-err')).toBeEmpty();
  await expect(page.locator('#pf-target')).not.toHaveAttribute('aria-invalid', 'true');
  expect(await page.evaluate(() => window.HCSettings.targetWeight())).toBeNull();
  // the goal is untouched
  await expect(goal(page, 'cut')).toBeChecked();
});

test('a refused goal save says why and keeps the pick pending', async ({ page, pageErrors }) => {
  pageErrors.allow(/500/);
  const puts = await mockSettings(page, { goal: 'maintain', targetWeightKg: 74, locale: null }, { putStatus: 500 });
  await openProfile(page);
  const T = await copyOf(page);

  await goal(page, 'cut').check({ force: true });
  await expect(page.locator('#pf-goal-msg')).toHaveText(`${T.goal.failed.replace('{reason}', T.goal.reasons.generic)} ${T.goal.pending}`);
  expect(puts).toEqual([{ goal: 'cut' }]);
  // kept on this viewer until a save goes through (retried on the next load)
  expect(await page.evaluate(() => window.HCNutri.pendingGoal())).toBe('cut');
});
