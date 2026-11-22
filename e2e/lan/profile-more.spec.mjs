// The profile sheet's goal section against the page the real data service serves (docs/profile.md,
// web/src/client/profile.js + settings.js): the cut and bulk goals, a cleared target weight and a refused save.
// The settings API is answered at the page boundary (GET with a known goal and target, every PUT recorded and
// asserted), so the shared database the other LAN specs read is never changed under them.
import { test, expect, openProfile } from './fixtures.mjs';
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

// every step waits on the real served page; a loaded host makes 30 s tight
test.describe.configure({ timeout: 90_000 });

const goal = (page, g) => page.locator(`input[name="pf-goal"][value="${g}"]`);

test('Lose fat and Gain are saved as the goal', async ({ page }) => {
  const puts = await mockSettings(page, { goal: 'maintain', targetWeightKg: 74, locale: null });
  await openProfile(page);
  await expect(page.locator('#pf-target')).toBeVisible(); // the settings API answered
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
  await expect(page.locator('#pf-target')).toBeVisible(); // the settings API answered
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
  await expect(page.locator('#pf-target')).toBeVisible(); // the settings API answered
  const T = await copyOf(page);

  await goal(page, 'cut').check({ force: true });
  await expect(page.locator('#pf-goal-msg')).toHaveText(`${T.goal.failed.replace('{reason}', T.goal.reasons.generic)} ${T.goal.pending}`);
  expect(puts).toEqual([{ goal: 'cut' }]);
  // kept on this viewer until a save goes through (retried on the next load)
  expect(await page.evaluate(() => window.HCNutri.pendingGoal())).toBe('cut');
});

test('a #profile link opened before the settings answer shows the target weight and the language once they do', async ({ page }) => {
  // the sheet a deep link opens on load can render before GET /api/food/settings answers (WebKit's order showed
  // it): the answer is held back here, so the race is the same in every engine
  let release;
  const held = new Promise((r) => { release = r; });
  await page.route('**/api/food/settings', async (route) => {
    if (route.request().method() === 'GET') await held;
    return route.fallback();
  });
  await page.addInitScript(() => localStorage.setItem('hc.onboarding.later', '1'));
  await page.goto('/#profile');
  await expect(page.locator('#detail')).toBeVisible();
  await expect(page.locator('#pf-goal')).toBeVisible();
  await expect(page.locator('#pf-target')).toHaveCount(0); // no settings yet: no target field
  // a control the viewer is on keeps the focus through the redraw, and the redraw adds no history entry
  const picked = page.locator('input[name="pf-goal"]').first();
  await picked.focus();
  const value = await picked.getAttribute('value');
  const before = await page.evaluate(() => history.length);
  release();
  await expect(page.locator('#pf-target')).toBeVisible();
  await expect(page.locator('#pf-lang')).toBeVisible();
  await expect(page.locator('#detail')).toBeVisible(); // still the same open sheet
  expect(new URL(page.url()).hash).toBe('#profile');
  await expect(page.locator(`input[name="pf-goal"][value="${value}"]`)).toBeFocused();
  expect(await page.evaluate(() => history.length)).toBe(before);
  // drawn once: a later settings change updates the status line in place, the target field is the same element
  const target = await page.locator('#pf-target').elementHandle();
  await page.locator('#pf-target').fill('77');
  await page.locator('#pf-target').press('Enter');
  await expect(page.locator('#pf-goal-msg')).not.toBeEmpty();
  expect(await target.evaluate((el) => el.isConnected)).toBe(true);
  // one Escape closes it (a deep-linked sheet has no entry of its own to go back to)
  await page.keyboard.press('Escape');
  await expect(page.locator('#detail')).toBeHidden();
});
