// Accessibility of the static example page (WCAG 2.1 A / AA through axe, e2e/a11y.mjs): every tab and one sheet of
// every kind the page opens, in every static project (Chromium phone and desktop, WebKit, Spanish).
import { test, openStatic, DEMO_DAY, expect } from '../fixtures.mjs';
import { expectAccessible } from '../a11y.mjs';

const past = (() => {
  const d = new Date(`${DEMO_DAY}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
})();

for (const tab of ['home', 'entreno', 'health', 'nutricion']) {
  test(`the ${tab} tab`, async ({ page }) => {
    await openStatic(page, `#${tab}`);
    await expectAccessible(page, `#${tab}`);
  });
}

test('Home on a past day', async ({ page }) => {
  await openStatic(page, `#d=${past}`);
  await expect(page.locator('#day-next')).toBeEnabled();
  await expectAccessible(page, `#d=${past}`);
});

const SHEETS = [
  ['a trend sheet', '#detail/weight'],
  ['a dial deep-dive', '#detail/sleep'],
  ['a dated sheet', `#detail/steps/${past}`],
  ['the workouts sheet', '#detail/workouts'],
  ['the profile', '#profile'],
  ['the keyboard help', '#shortcuts'],
  ['Tonight', '#tonight'],
  ['the journal insights', '#journal-insights'],
  ['Customize Home', '#home-edit'],
  ['Customize My dashboard', '#dash-edit'],
];
for (const [name, hash] of SHEETS) {
  test(`${name} (${hash})`, async ({ page }) => {
    await openStatic(page, hash);
    await expect(page.locator('#detail')).toBeVisible();
    await expectAccessible(page, hash);
  });
}
