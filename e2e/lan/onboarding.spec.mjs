// The first-run assistant's branches (docs/onboarding.md, docs/profile.md → In-page onboarding,
// web/src/client/onboarding.js) against the page the real data service serves. Project `lan-phone`: the shared
// database already holds a profile (lan-setup), so a "first run" is made at the page boundary instead: GET
// /api/food/profile answers no profile and GET /api/food/settings no goal, and every write the assistant makes
// (PUT profile, PUT settings, POST /api/sync) is answered here and its body asserted, never reaching the server.
import { test, expect, openLan } from './fixtures.mjs';
import { settle } from '../fixtures.mjs';
import { en as onbEn, es as onbEs } from '../../web/src/i18n/onboarding-templates.mjs';

// every step waits on the real served page; a loaded host makes 30 s tight
test.describe.configure({ timeout: 90_000 });

const LATER_KEY = 'hc.onboarding.later';
const sheet = (page) => page.locator('#detail');
const next = (page) => page.locator('#detail [data-onb-act="next"]');
const back = (page) => page.locator('#detail .onb-top [data-onb-act="back"]');
const field = (page, key) => page.locator(`#detail [data-onb-field="${key}"]`);
const radio = (page, name, value) => page.locator(`#detail input[name="onb-${name}"][value="${value}"]`);

/** The assistant's copy in the language the page was built in (<html lang>). */
async function copyOf(page) {
  return (await page.evaluate(() => document.documentElement.lang)) === 'es' ? onbEs : onbEn;
}

/** A first run made at the page boundary; returns the writes the page tried, answered here. `profilePut` is the
 * status PUT /api/food/profile answers. */
async function mockFirstRun(page, { profilePut = 200 } = {}) {
  const seen = { profileGets: 0, profile: [], settings: [], sync: 0 };
  const settings = { goal: null, targetWeightKg: null, locale: null };
  await page.route('**/api/food/profile', async (route) => {
    const req = route.request();
    if (req.method() === 'GET') {
      seen.profileGets += 1;
      return route.fulfill({ json: { profile: null } });
    }
    if (req.method() === 'PUT') {
      seen.profile.push(req.postDataJSON());
      return profilePut < 300
        ? route.fulfill({ json: { profile: req.postDataJSON() } })
        : route.fulfill({ status: profilePut, json: { error: 'e2e: refused on purpose' } });
    }
    return route.fallback();
  });
  await page.route('**/api/food/settings', async (route) => {
    const req = route.request();
    if (req.method() === 'GET') return route.fulfill({ json: { settings } });
    if (req.method() === 'PUT') {
      seen.settings.push(req.postDataJSON());
      Object.assign(settings, req.postDataJSON());
      return route.fulfill({ json: { settings } });
    }
    return route.fallback();
  });
  await page.route('**/api/sync', async (route) => {
    if (route.request().method() !== 'POST') return route.fallback();
    seen.sync += 1;
    // a seq no publish reaches: the page keeps waiting and never reloads under the test
    return route.fulfill({ status: 202, json: { seq: 1e12, coalesced: false } });
  });
  return seen;
}

/** Open the page on a mocked first run: the assistant opens by itself. */
async function openFirstRun(page) {
  await openLan(page);
  await expect(sheet(page)).toBeVisible();
  expect(new URL(page.url()).hash).toBe('#onboarding');
}

/** From the cover to the safety screen: about you, one strength sport at its defaults (60 min, 3 a week). */
async function answerAbout(page, { name = 'Onb Tester', sex = 'male', birthdate = '1985-03-02', height = '180', weight = '82' } = {}) {
  await next(page).click(); // cover
  await page.locator('#onb-name').fill(name);
  await next(page).click();
  await radio(page, 'sex', sex).check({ force: true });
  await next(page).click();
  await page.locator('#onb-birthdate').fill(birthdate);
  await next(page).click();
  await page.locator('#onb-heightCm').fill(height);
  await next(page).click();
  await page.locator('#onb-weightKg').fill(weight);
  await next(page).click();
  await radio(page, 'activity', 'light').check({ force: true });
  await next(page).click();
  await radio(page, 'sport', 'strength').check({ force: true });
  await next(page).click();
  await next(page).click(); // the sport's screen: its defaults stand
  await expect(field(page, 'medical')).toBeVisible();
}

/** The profile document the answers of answerAbout() make (targets and goals checked apart). */
const ABOUT = {
  name: 'Onb Tester', sex: 'male', birthdate: '1985-03-02', heightCm: 180, weightKg: 82, activity: 'light',
  sports: [{ sport: 'strength', minutes: 60, perWeek: 3 }],
};

/** Assert the stop screen: its heading and reason, no progress, no numbers, only Close. */
async function expectStop(page, T, reason) {
  const onb = page.locator('#detail .onb');
  await expect(onb.locator('.onb-q')).toHaveText(T.stop.heading);
  await expect(onb.getByText(T.stop[reason], { exact: true })).toBeVisible();
  await expect(onb.locator('.onb-prog')).toHaveCount(0);
  await expect(onb.locator('.onb-ring')).toHaveCount(0);
  await expect(onb.locator('[data-onb-act="next"], [data-onb-act="save"], [data-onb-act="back"]')).toHaveCount(0);
  await expect(onb.locator('.onb-nav button')).toHaveCount(1);
  await expect(onb.locator('.onb-nav [data-onb-act="later"]')).toHaveText(T.stop.close);
}

/** today minus `years` (E2E_TZ's today, as the page sees it), as YYYY-MM-DD. */
function yearsAgo(today, years) {
  const [y, m, d] = today.split('-');
  return `${Number(y) - years}-${m}-${d}`;
}

test('the back arrow keeps every earlier answer', async ({ page }) => {
  const seen = await mockFirstRun(page);
  await openFirstRun(page);
  await next(page).click();
  await page.locator('#onb-name').fill('Back Tester');
  await next(page).click();
  await radio(page, 'sex', 'female').check({ force: true });
  await next(page).click();
  await page.locator('#onb-birthdate').fill('1988-02-03');
  await next(page).click();
  await page.locator('#onb-heightCm').fill('165');

  await back(page).click();
  await expect(page.locator('#onb-birthdate')).toHaveValue('1988-02-03');
  await back(page).click();
  await expect(radio(page, 'sex', 'female')).toBeChecked();
  await expect(radio(page, 'sex', 'male')).not.toBeChecked();
  await back(page).click();
  await expect(page.locator('#onb-name')).toHaveValue('Back Tester');
  // and forward again: the screens after it still hold their answers (the height typed before going back too)
  await next(page).click();
  await expect(radio(page, 'sex', 'female')).toBeChecked();
  await next(page).click();
  await expect(page.locator('#onb-birthdate')).toHaveValue('1988-02-03');
  await next(page).click();
  await expect(page.locator('#onb-heightCm')).toHaveValue('165');
  await settle(page);
  expect(seen).toMatchObject({ profile: [], settings: [], sync: 0 });
});

test('Enter presses the primary button, and a refused step says why', async ({ page }) => {
  await mockFirstRun(page);
  await openFirstRun(page);
  const T = await copyOf(page);
  await next(page).click();
  await page.locator('#onb-name').fill('Enter Tester');
  await page.locator('#onb-name').press('Enter');
  await expect(radio(page, 'sex', 'female')).toBeAttached();
  // Enter on a card
  await radio(page, 'sex', 'female').check({ force: true });
  await radio(page, 'sex', 'female').press('Enter');
  await page.locator('#onb-birthdate').fill('1990-01-01');
  await page.locator('#onb-birthdate').press('Enter');
  // an out-of-range height: Enter is refused with the field's error in the live region, the screen stays
  await page.locator('#onb-heightCm').fill('50');
  await page.locator('#onb-heightCm').press('Enter');
  await expect(page.locator('#onb-status')).toHaveText(T.errors.heightCm);
  await expect(page.locator('#onb-heightCm')).toHaveAttribute('aria-invalid', 'true');
  await expect(page.locator('#onb-weightKg')).toHaveCount(0);
  await page.locator('#onb-heightCm').fill('170');
  await page.locator('#onb-heightCm').press('Enter');
  await expect(page.locator('#onb-weightKg')).toBeVisible();
  await expect(page.locator('#onb-status')).toHaveText('');
});

test('a female answer asks about pregnancy, and ticking it stops with no numbers', async ({ page }) => {
  const seen = await mockFirstRun(page);
  await openFirstRun(page);
  const T = await copyOf(page);
  await answerAbout(page, { sex: 'female', height: '168', weight: '62' });
  await expect(field(page, 'pregnant')).toBeVisible();
  await expect(page.locator('#detail .onb input[type="checkbox"]')).toHaveCount(4);
  await field(page, 'pregnant').check({ force: true });
  await next(page).click();
  await expectStop(page, T, 'pregnancy');

  await page.locator('#detail .onb-nav [data-onb-act="later"]').click();
  await expect(sheet(page)).toBeHidden();
  expect(await page.evaluate((k) => localStorage.getItem(k), LATER_KEY)).toBe('1');
  await settle(page);
  expect(seen).toMatchObject({ profile: [], settings: [], sync: 0 });
});

test('an under-18 birth date stops at once', async ({ page, today }) => {
  const seen = await mockFirstRun(page);
  await openFirstRun(page);
  const T = await copyOf(page);
  await next(page).click();
  await next(page).click(); // the name is optional
  await radio(page, 'sex', 'male').check({ force: true });
  await next(page).click();
  await page.locator('#onb-birthdate').fill(yearsAgo(today, 17));
  await next(page).click();
  await expectStop(page, T, 'minor');
  await settle(page);
  expect(seen).toMatchObject({ profile: [], settings: [], sync: 0 });
});

test('an 18th birthday today is an adult: the flow goes on', async ({ page, today }) => {
  await mockFirstRun(page);
  await openFirstRun(page);
  await next(page).click();
  await next(page).click();
  await radio(page, 'sex', 'male').check({ force: true });
  await next(page).click();
  await page.locator('#onb-birthdate').fill(yearsAgo(today, 18));
  await next(page).click();
  await expect(page.locator('#onb-heightCm')).toBeVisible();
});

for (const box of ['medical', 'eating2']) {
  test(`the "${box}" safety box offers only maintain, which skips the target weight and saves`, async ({ page }) => {
    const seen = await mockFirstRun(page);
    await openFirstRun(page);
    const T = await copyOf(page);
    await answerAbout(page);
    // a male answer has no pregnancy question
    await expect(field(page, 'pregnant')).toHaveCount(0);
    await field(page, box).check({ force: true });
    await next(page).click();

    const goals = page.locator('#detail input[name="onb-goal"]');
    await expect(goals).toHaveCount(1);
    await expect(goals).toHaveValue('maintain');
    await expect(goals).toBeChecked();
    await expect(page.locator('#detail .onb').getByText(T.goal[box === 'medical' ? 'medical' : 'eating'], { exact: true })).toBeVisible();
    await next(page).click();
    // maintain: no target-weight screen, straight to the summary
    await expect(field(page, 'target')).toHaveCount(0);
    await expect(page.locator('#detail .onb-ring .kcal')).toBeVisible();
    await next(page).click();

    await expect(page.locator('#sync-btn')).toBeVisible();
    await page.locator('#detail [data-onb-act="save"]').click();
    await expect(sheet(page)).toBeHidden();
    await expect.poll(() => seen.sync).toBe(1);
    expect(seen.profile).toHaveLength(1);
    expect(seen.profile[0]).toMatchObject({ ...ABOUT, goals: ['maintain'] });
    expect(Object.keys(seen.profile[0].targets).sort()).toEqual(['bulk', 'cut', 'maintain']);
    expect(seen.profile[0].targets.maintain.rest.kcal).toBeGreaterThan(0);
    // the safety answers themselves are never saved
    expect(seen.profile[0]).not.toHaveProperty(box);
    expect(seen.settings).toEqual([{ goal: 'maintain' }, { targetWeightKg: null }]);
    expect(await page.evaluate((k) => localStorage.getItem(k), LATER_KEY)).toBeNull();
  });
}

test('a bulk asks for a target weight, and an adjusted number is what gets saved', async ({ page }) => {
  const seen = await mockFirstRun(page);
  await openFirstRun(page);
  await answerAbout(page);
  await next(page).click(); // safety: nothing applies
  await expect(page.locator('#detail input[name="onb-goal"]')).toHaveCount(3);
  await radio(page, 'goal', 'bulk').check({ force: true });
  await next(page).click();
  await field(page, 'target').fill('86');
  await field(page, 'target').press('Enter'); // Enter = Continue
  await expect(page.locator('#detail .onb-ring .kcal')).toBeVisible();

  // Adjust: the used day types' cells (rest + the strength day), carbs derived and read-only
  await expect(page.locator('#detail [data-onb-cell]')).toHaveCount(0);
  await page.locator('#detail [data-onb-act="adjust"]').click();
  await expect(page.locator('#detail [data-onb-cell]')).toHaveCount(6);
  const cell = page.locator('#detail [data-onb-cell="rest.kcal"]');
  const was = Number(await cell.inputValue());
  const typed = was + 50;
  await cell.fill(String(typed));
  await cell.blur();
  await expect(cell).toHaveValue(String(typed));
  await expect(page.locator('#detail [data-onb-act="reset"]')).toBeVisible();
  await next(page).click();

  await expect(page.locator('#sync-btn')).toBeVisible();
  await page.locator('#detail [data-onb-act="save"]').click();
  await expect(sheet(page)).toBeHidden();
  await expect.poll(() => seen.sync).toBe(1);
  expect(seen.profile).toHaveLength(1);
  expect(seen.profile[0]).toMatchObject({ ...ABOUT, goals: ['maintain', 'cut', 'bulk'] });
  expect(seen.profile[0].targets.bulk.rest.kcal).toBe(typed);
  expect(seen.settings).toEqual([{ goal: 'bulk' }, { targetWeightKg: 86 }]);
});

test('a failed save says so and keeps the assistant open', async ({ page, pageErrors }) => {
  pageErrors.allow(/500/);
  const seen = await mockFirstRun(page, { profilePut: 500 });
  await openFirstRun(page);
  const T = await copyOf(page);
  await answerAbout(page);
  await next(page).click(); // safety
  await next(page).click(); // goal: maintain stands
  await next(page).click(); // summary
  await page.locator('#detail [data-onb-act="save"]').click();
  await expect(page.locator('#onb-status')).toHaveText(T.errors.save.replace('{reason}', T.reasons.generic));
  await expect(sheet(page)).toBeVisible();
  await expect(page.locator('#detail [data-onb-act="save"]')).toBeVisible();
  await settle(page);
  expect(seen.profile).toHaveLength(1);
  expect(seen).toMatchObject({ settings: [], sync: 0 });
  expect(await page.evaluate((k) => localStorage.getItem(k), LATER_KEY)).toBeNull();
});

test('"Later" is remembered across a reload', async ({ page }) => {
  const seen = await mockFirstRun(page);
  await openFirstRun(page);
  expect(seen.profileGets).toBe(1);
  // on the cover the one back arrow is "Later"
  await page.locator('#detail .onb-top [data-onb-act="later"]').click();
  await expect(sheet(page)).toBeHidden();
  expect(await page.evaluate((k) => localStorage.getItem(k), LATER_KEY)).toBe('1');

  await openLan(page);
  await settle(page);
  await expect(sheet(page)).toBeHidden();
  // postponed: the first-run check does not even ask the server
  expect(seen.profileGets).toBe(1);

  // the key alone is why: without it the next load opens the assistant again
  await page.evaluate((k) => localStorage.removeItem(k), LATER_KEY);
  await openLan(page);
  await expect(sheet(page)).toBeVisible();
  expect(seen.profileGets).toBe(2);
  expect(seen).toMatchObject({ profile: [], settings: [], sync: 0 });
});

test("the profile sheet's Edit chip reopens the assistant with the stored answers", async ({ page }) => {
  // no mocks: the real stored profile (lan-setup's answers, baked into this build)
  const writes = [];
  page.on('request', (r) => {
    if (r.method() !== 'GET' && /\/api\/(food\/(profile|settings)|sync)$/.test(new URL(r.url()).pathname)) writes.push(r.url());
  });
  await openLan(page);
  await expect(sheet(page)).toBeHidden();
  await page.locator('#avatar-btn').click();
  await expect(sheet(page)).toBeVisible();
  await page.locator('#detail [data-onb-open]').click();
  await expect(next(page)).toBeVisible();
  await expect(page.locator('#detail .onb')).toBeVisible();

  await next(page).click();
  await expect(page.locator('#onb-name')).toHaveValue('E2E Runner');
  await next(page).click();
  await expect(radio(page, 'sex', 'male')).toBeChecked();
  await next(page).click();
  await expect(page.locator('#onb-birthdate')).toHaveValue('1990-05-10');
  await next(page).click();
  await expect(page.locator('#onb-heightCm')).toHaveValue('178');

  await page.locator('#detail .onb-top .lnk[data-onb-act="later"]').click();
  await expect(sheet(page)).toBeHidden();
  await settle(page);
  expect(writes).toEqual([]);
});
