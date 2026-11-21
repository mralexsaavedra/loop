// Phone vs desktop layout on the static example page (docs/plan-page.md: one breakpoint at 900 px) and the
// Home day stepper (docs/plan-page.md → Day stepping).
import { test, expect, openStatic, TABS, DEMO_DAY, hashOf } from '../fixtures.mjs';

for (const tab of TABS) {
  test(`${tab} has no horizontal overflow`, async ({ page }) => {
    await openStatic(page, `#${tab}`);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });
}

test('the avatar sits left on a phone and right on a desktop', async ({ page }) => {
  await openStatic(page);
  const width = page.viewportSize().width;
  const box = await page.locator('#avatar-btn').boundingBox();
  const centre = box.x + box.width / 2;
  if (width < 900) expect(centre).toBeLessThan(width / 2);
  else expect(centre).toBeGreaterThan(width / 2);
});

test('the dock shows all four tabs within the viewport', async ({ page }) => {
  await openStatic(page);
  const width = page.viewportSize().width;
  for (const key of TABS) {
    const box = await page.locator(`#t-${key}`).boundingBox();
    expect(box, key).not.toBeNull();
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(width);
  }
});

test('the day stepper walks Home back one day and returns to today', async ({ page }) => {
  await openStatic(page);
  const prev = page.locator('#day-prev');
  const next = page.locator('#day-next');
  await expect(prev).toBeVisible();
  await expect(next).toBeDisabled();

  await prev.click();
  const yesterday = new Date(`${DEMO_DAY}T12:00:00Z`);
  yesterday.setUTCDate(yesterday.getUTCDate() - 1);
  const iso = yesterday.toISOString().slice(0, 10);
  expect(hashOf(page)).toBe(`#d=${iso}`);
  await expect(next).toBeEnabled();

  // a reload keeps the past day
  await page.reload();
  expect(hashOf(page)).toBe(`#d=${iso}`);
  await expect(page.locator('#day-next')).toBeEnabled();

  await page.locator('#day-lbl').click();
  expect(hashOf(page)).toBe('#home');
  await expect(page.locator('#day-next')).toBeDisabled();
});

test('a day out of reach in the hash is replaced by #home', async ({ page }) => {
  await openStatic(page, '#d=2020-01-01');
  await expect.poll(() => hashOf(page)).toBe('#home');
});
