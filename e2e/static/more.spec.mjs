// More of the static example page (synthetic demo data, LAN features off): dated detail deep links, every
// kind of detail-sheet control (docs/detail-views.md), the ⓘ toggles, tab links and folds (docs/plan-page.md),
// the two Customize sheets of Home (docs/home-tab.md) and the registered views the generic opener loop of
// detail.spec.mjs does not reach (tonight, journal-insights, hoy-session).
import { test, expect, openStatic, DEMO_DAY, zonedInstant, hashOf, settle } from '../fixtures.mjs';

const sheet = (page) => page.locator('#detail');
const inSheet = (page, sel) => page.locator(`#detail ${sel}`);
const pressedDay = (page) => inSheet(page, '[data-dt-act="day"][aria-pressed="true"]');
const dayHeading = (page) => inSheet(page, '.dt-day-h');
const winLabel = (page) => inSheet(page, '.dt-win-lbl');
const rangeBtn = (page, days) => inSheet(page, `[data-dt-act="range"][data-range="${days}"]`);
const infoBtn = (page) => inSheet(page, '[data-dt-act="info"]');
const infoBox = (page) => page.locator('#dd-info');

/** `iso` shifted by `n` days (UTC arithmetic on a calendar date). */
function shiftIso(iso, n) {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** "20 Sep" for 2026-09-20: the day-and-month part every en-GB date label of the page carries. */
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function dayMonth(iso) {
  return `${Number(iso.slice(8, 10))} ${MONTHS[Number(iso.slice(5, 7)) - 1]}`;
}

async function expectOpen(page) {
  await expect(sheet(page)).toBeVisible();
  await expect(page.locator('#dt-title')).not.toBeEmpty();
  await expect(page.locator('.wrap')).toHaveAttribute('inert', '');
}

async function expectClosed(page) {
  await expect(sheet(page)).toBeHidden();
  await expect(page.locator('.wrap')).not.toHaveAttribute('inert', '');
}

/** The ⓘ of the open sheet toggles #dd-info both ways, mirrored in aria-expanded. */
async function expectInfoToggles(page) {
  await expect(infoBtn(page)).toHaveAttribute('aria-expanded', 'false');
  await expect(infoBtn(page)).toHaveAttribute('aria-controls', 'dd-info');
  await expect(infoBox(page)).toBeHidden();
  await infoBtn(page).click();
  await expect(infoBtn(page)).toHaveAttribute('aria-expanded', 'true');
  await expect(infoBox(page)).toBeVisible();
  await expect(infoBox(page)).not.toBeEmpty();
  await infoBtn(page).click();
  await expect(infoBtn(page)).toHaveAttribute('aria-expanded', 'false');
  await expect(infoBox(page)).toBeHidden();
}

const PAST = shiftIso(DEMO_DAY, -8);

test.describe('dated detail deep links', () => {
  test('#detail/<metric>/<date> opens the trend view on that day', async ({ page }) => {
    await openStatic(page, `#detail/steps/${PAST}`);
    await expectOpen(page);
    await expect(page.locator('#t-health')).toHaveAttribute('aria-current', 'page');
    await expect(pressedDay(page)).toHaveCount(1);
    await expect(pressedDay(page)).toHaveAttribute('data-date', PAST);
    await expect(dayHeading(page)).toContainText(dayMonth(PAST));
    expect(hashOf(page)).toBe(`#detail/steps/${PAST}`);
  });

  test('a dated deep link to a dial page opens its History fold on that day', async ({ page }) => {
    await openStatic(page, `#detail/sleep/${PAST}`);
    await expectOpen(page);
    const fold = inSheet(page, '[data-dt-act="hist"]');
    await expect(fold).toHaveAttribute('aria-expanded', 'true');
    await expect(page.locator('#dd-hist')).toBeVisible();
    await expect(pressedDay(page)).toHaveAttribute('data-date', PAST);
    await expect(dayHeading(page)).toContainText(dayMonth(PAST));
    expect(hashOf(page)).toBe(`#detail/sleep/${PAST}`);
  });

  test('an impossible date falls back to the default day and the hash is replaced to match', async ({ page }) => {
    await openStatic(page, '#detail/steps/2026-02-31');
    await expectOpen(page);
    await expect(pressedDay(page)).toHaveCount(1);
    const shown = await pressedDay(page).getAttribute('data-date');
    expect(shown).not.toBe('2026-02-31');
    await expect.poll(() => hashOf(page)).toBe(`#detail/steps/${shown}`);
    await expect(dayHeading(page)).toContainText(dayMonth(shown));
  });
});

test.describe('detail sheet controls', () => {
  test('day: a calendar tap selects that day and replaces the hash without new history', async ({ page }) => {
    await openStatic(page, '#detail/steps');
    await expectOpen(page);
    const before = await page.evaluate(() => history.length);
    const start = await pressedDay(page).getAttribute('data-date');
    const target = shiftIso(start, -2);
    await inSheet(page, `[data-dt-act="day"][data-date="${target}"]`).click();
    await expect(pressedDay(page)).toHaveAttribute('data-date', target);
    await expect(inSheet(page, `[data-dt-act="day"][data-date="${start}"]`)).toHaveAttribute('aria-pressed', 'false');
    await expect(dayHeading(page)).toContainText(dayMonth(target));
    await expect(inSheet(page, `[data-dt-act="day"][data-date="${target}"]`)).toBeFocused();
    expect(hashOf(page)).toBe(`#detail/steps/${target}`);
    expect(await page.evaluate(() => history.length)).toBe(before);
  });

  test('range: W / M / 6M / 1Y press one button and change the window', async ({ page }) => {
    await openStatic(page, '#detail/steps');
    await expectOpen(page);
    // opens on M
    await expect(rangeBtn(page, 30)).toHaveAttribute('aria-pressed', 'true');
    await expect(inSheet(page, '.dt-wdays')).toHaveCount(0);
    const month = await winLabel(page).textContent();

    await rangeBtn(page, 7).click();
    await expect(rangeBtn(page, 7)).toHaveAttribute('aria-pressed', 'true');
    await expect(rangeBtn(page, 30)).toHaveAttribute('aria-pressed', 'false');
    await expect(rangeBtn(page, 7)).toBeFocused();
    await expect(winLabel(page)).not.toHaveText(month);
    // the week chart: weekday labels under 7 bars
    await expect(inSheet(page, '.dt-wdays')).toHaveCount(1);
    const week = await winLabel(page).textContent();

    await rangeBtn(page, 365).click();
    await expect(rangeBtn(page, 365)).toHaveAttribute('aria-pressed', 'true');
    await expect(rangeBtn(page, 7)).toHaveAttribute('aria-pressed', 'false');
    await expect(winLabel(page)).not.toHaveText(week);
    await expect(inSheet(page, '.dt-wdays')).toHaveCount(0);
    await expect(inSheet(page, '[data-dt-act="range"][aria-pressed="true"]')).toHaveCount(1);
  });

  test('win: ‹ steps the window back, › forward again and is disabled at today', async ({ page }) => {
    await openStatic(page, '#detail/steps');
    await expectOpen(page);
    await rangeBtn(page, 7).click();
    const back = inSheet(page, '[data-dt-act="win"][data-wdir="-1"]');
    const fwd = inSheet(page, '[data-dt-act="win"][data-wdir="1"]');
    await expect(fwd).toBeDisabled();
    await expect(back).toBeEnabled();
    const now = await winLabel(page).textContent();
    const sentence = await inSheet(page, '.dt-trend-txt').textContent();

    await back.click();
    await expect(winLabel(page)).not.toHaveText(now);
    await expect(fwd).toBeEnabled();
    // the window moved by its own length: its label names the day before the old window's first day
    await expect(winLabel(page)).toContainText(dayMonth(shiftIso(DEMO_DAY, -7)));
    await expect(rangeBtn(page, 7)).toHaveAttribute('aria-pressed', 'true');

    await fwd.click();
    await expect(winLabel(page)).toHaveText(now);
    await expect(inSheet(page, '.dt-trend-txt')).toHaveText(sentence);
    await expect(fwd).toBeDisabled();
  });

  test('month: the calendar steps back a month and forward again, bounded at the newest', async ({ page }) => {
    await openStatic(page, '#detail/steps');
    await expectOpen(page);
    const title = inSheet(page, '.dt-month');
    const prev = inSheet(page, '[data-dt-act="month"][data-dir="-1"]');
    const next = inSheet(page, '[data-dt-act="month"][data-dir="1"]');
    await expect(title).toContainText('September');
    await expect(next).toBeDisabled();
    const win = await winLabel(page).textContent();

    await prev.click();
    await expect(title).toContainText('August');
    await expect(next).toBeEnabled();
    await expect(inSheet(page, `[data-dt-act="day"][data-date="${DEMO_DAY.slice(0, 7)}-01"]`)).toHaveCount(0);
    // the calendar moves alone: the chart window stays
    await expect(winLabel(page)).toHaveText(win);

    await next.click();
    await expect(title).toContainText('September');
    await expect(next).toBeDisabled();
  });

  test('info: the trend view ⓘ shows and hides the latest value notes', async ({ page }) => {
    await openStatic(page, '#detail/steps');
    await expectOpen(page);
    await expectInfoToggles(page);
  });

  test('learn: "Learn more" opens the ⓘ notes, never closes them, and focuses ⓘ', async ({ page }) => {
    await openStatic(page, '#detail/steps');
    await expectOpen(page);
    const learn = inSheet(page, '[data-dt-act="learn"]');
    await expect(infoBox(page)).toBeHidden();
    await learn.click();
    await expect(infoBox(page)).toBeVisible();
    await expect(infoBtn(page)).toHaveAttribute('aria-expanded', 'true');
    await expect(infoBtn(page)).toBeFocused();
    await learn.click();
    await settle(page);
    await expect(infoBox(page)).toBeVisible();
    await expect(infoBtn(page)).toHaveAttribute('aria-expanded', 'true');
  });

  test('hist: the dial page History fold toggles and is remembered for the session', async ({ page }) => {
    await openStatic(page, '#home');
    const dial = page.locator('.tab-panel[data-tab="home"] [data-detail="sleep"]:visible').first();
    await dial.click();
    await expectOpen(page);
    const fold = () => inSheet(page, '[data-dt-act="hist"]');
    await expect(fold()).toHaveAttribute('aria-expanded', 'false');
    await expect(fold()).toHaveAttribute('aria-controls', 'dd-hist');
    await expect(page.locator('#dd-hist')).toBeHidden();

    await fold().click();
    await expect(fold()).toHaveAttribute('aria-expanded', 'true');
    await expect(page.locator('#dd-hist')).toBeVisible();
    await expect(inSheet(page, '[data-dt-part="cal"] .dt-month')).toBeVisible();
    expect(await page.evaluate(() => sessionStorage.getItem('hc-dd-hist'))).toBe('1');

    // closed and opened again: still open; and after a reload of the page session too
    await page.keyboard.press('Escape');
    await expectClosed(page);
    await dial.click();
    await expect(fold()).toHaveAttribute('aria-expanded', 'true');
    await page.reload();
    await expectOpen(page);
    await expect(fold()).toHaveAttribute('aria-expanded', 'true');
    await expect(page.locator('#dd-hist')).toBeVisible();

    await fold().click();
    await expect(fold()).toHaveAttribute('aria-expanded', 'false');
    await expect(page.locator('#dd-hist')).toBeHidden();
    expect(await page.evaluate(() => sessionStorage.getItem('hc-dd-hist'))).toBe('0');
  });

  test('trend and info on a dial page: the CTA lands on the pressed range, ⓘ toggles the notes', async ({ page }) => {
    await openStatic(page, '#detail/sleep');
    await expectOpen(page);
    await expectInfoToggles(page);

    const cta = inSheet(page, '.cta[data-dt-act="trend"]');
    await cta.scrollIntoViewIfNeeded();
    await cta.click();
    const pressed = inSheet(page, '.dt-range [aria-pressed="true"]');
    await expect(pressed).toBeFocused();
    await expect(pressed).toHaveAttribute('data-range', '30');
    await expect(inSheet(page, '.dt-period')).toBeInViewport();
    expect(hashOf(page)).toBe('#detail/sleep');
  });
});

test.describe('page toggles, tab links and folds', () => {
  for (const tab of ['home', 'entreno', 'health', 'nutricion']) {
    test(`every visible ⓘ on ${tab} shows and hides its notes`, async ({ page }) => {
      await openStatic(page, `#${tab}`);
      const buttons = page.locator(`.tab-panel[data-tab="${tab}"] [data-hs-info]:visible`);
      const count = await buttons.count();
      expect(count, `ⓘ buttons on ${tab}`).toBeGreaterThan(0);
      for (let i = 0; i < count; i++) {
        const btn = buttons.nth(i);
        const id = await btn.getAttribute('data-hs-info');
        const box = page.locator(`[id="${id}"]`);
        await expect(btn, id).toHaveAttribute('aria-controls', id);
        await expect(btn, id).toHaveAttribute('aria-expanded', 'false');
        await expect(box, `#${id} exists`).toHaveCount(1);
        await expect(box, id).toBeHidden();
        await btn.scrollIntoViewIfNeeded();
        await btn.click();
        await expect(btn, id).toHaveAttribute('aria-expanded', 'true');
        await expect(box, id).toBeVisible();
        await btn.click();
        await expect(btn, id).toHaveAttribute('aria-expanded', 'false');
        await expect(box, id).toBeHidden();
      }
      expect(hashOf(page)).toBe(`#${tab}`);
    });
  }

  test('a data-tab-go link on Home switches to its tab and focuses that panel', async ({ page }) => {
    await openStatic(page, '#home');
    const link = page.locator('.tab-panel[data-tab="home"] [data-tab-go="nutricion"]');
    await link.scrollIntoViewIfNeeded();
    await link.click();
    await expect(page.locator('#t-nutricion')).toHaveAttribute('aria-current', 'page');
    await expect(page.locator('.tab-panel[data-tab="nutricion"]')).toBeVisible();
    await expect(page.locator('.tab-panel[data-tab="home"]')).toBeHidden();
    expect(hashOf(page)).toBe('#nutricion');
    const focused = await page.evaluate(() => document.activeElement?.closest('.tab-panel')?.getAttribute('data-tab'));
    expect(focused).toBe('nutricion');
  });

  test('the wordmark (an empty data-tab-go) goes back to the default tab', async ({ page }) => {
    await openStatic(page, '#health');
    await page.locator('[data-tab-go=""]').click();
    await expect(page.locator('#t-home')).toHaveAttribute('aria-current', 'page');
    await expect(page.locator('.tab-panel[data-tab="home"]')).toBeVisible();
    await expect(page.locator('.tab-panel[data-tab="health"]')).toBeHidden();
    expect(hashOf(page)).toBe('#home');
  });

  test('the Tables section fold opens and closes', async ({ page }) => {
    await openStatic(page, '#nutricion');
    const fold = page.locator('details[data-section="tablas"]');
    const summary = fold.locator(':scope > summary');
    await expect(fold).not.toHaveAttribute('open', '');
    await summary.scrollIntoViewIfNeeded();
    await summary.click();
    await expect(fold).toHaveAttribute('open', '');
    await expect(fold.locator(':scope > :not(summary)').first()).toBeVisible();
    await summary.click();
    await expect(fold).not.toHaveAttribute('open', '');
    await expect(fold.locator(':scope > :not(summary)').first()).toBeHidden();
    expect(hashOf(page)).toBe('#nutricion');
  });
});

test.describe('Customize sheets', () => {
  const homeAct = (page, act, key) => inSheet(page, `[data-home-act="${act}"][data-key="${key}"]`);
  const dashAct = (page, act, key) => inSheet(page, `[data-dash-act="${act}"][data-key="${key}"]`);
  const homePrefs = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('hc-home-v1') || 'null'));
  const dashPrefs = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('hc-dash-v1') || 'null'));
  /** True when `a` comes before `b` in document order. */
  const before = (page, a, b) => page.evaluate(([x, y]) => {
    const ex = document.querySelector(x), ey = document.querySelector(y);
    return !!(ex.compareDocumentPosition(ey) & Node.DOCUMENT_POSITION_FOLLOWING);
  }, [a, b]);

  async function openHomeEdit(page) {
    const btn = page.locator('#home-edit');
    await btn.scrollIntoViewIfNeeded();
    await btn.click();
    await expectOpen(page);
    expect(hashOf(page)).toBe('#home-edit');
  }

  test('Customize Home hides a block, keeps it hidden after a reload and shows it again', async ({ page }) => {
    await openStatic(page, '#home');
    await expect(page.locator('#home-tonight')).toBeVisible();
    await openHomeEdit(page);
    const sw = homeAct(page, 'toggle', 'tonight');
    await expect(sw).toHaveAttribute('role', 'switch');
    await expect(sw).toHaveAttribute('aria-checked', 'true');

    await sw.click();
    await expect(homeAct(page, 'toggle', 'tonight')).toHaveAttribute('aria-checked', 'false');
    await expect(homeAct(page, 'toggle', 'tonight')).toBeFocused();
    expect((await homePrefs(page)).hidden).toEqual(['tonight']);
    await page.keyboard.press('Escape');
    await expectClosed(page);
    await expect(page.locator('#home-tonight')).toBeHidden();
    await expect(page.locator('#home-tonight')).toHaveClass(/\bhome-off\b/);
    await expect(page.locator('#my-day')).toBeVisible();

    await page.reload();
    await expect(page.locator('#t-home')).toBeVisible();
    await expect(page.locator('#home-tonight')).toBeHidden();
    await openHomeEdit(page);
    await expect(homeAct(page, 'toggle', 'tonight')).toHaveAttribute('aria-checked', 'false');
    await homeAct(page, 'toggle', 'tonight').click();
    await expect(homeAct(page, 'toggle', 'tonight')).toHaveAttribute('aria-checked', 'true');
    expect((await homePrefs(page)).hidden).toEqual([]);
    await page.keyboard.press('Escape');
    await expect(page.locator('#home-tonight')).toBeVisible();
    await expect(page.locator('#home-tonight')).not.toHaveClass(/\bhome-off\b/);
  });

  test('Customize Home moves a block down and the order survives a reload', async ({ page }) => {
    await openStatic(page, '#home');
    expect(await before(page, '#my-day', '.eat-card')).toBe(true);
    await openHomeEdit(page);
    await expect(homeAct(page, 'up', 'day')).toBeDisabled();
    await homeAct(page, 'down', 'day').click();
    await expect(homeAct(page, 'up', 'day')).toBeEnabled();
    await expect(homeAct(page, 'up', 'eat')).toBeDisabled();
    expect((await homePrefs(page)).order.slice(0, 2)).toEqual(['eat', 'day']);
    await page.keyboard.press('Escape');
    expect(await before(page, '.eat-card', '#my-day')).toBe(true);

    await page.reload();
    await expect(page.locator('#t-home')).toBeVisible();
    expect(await before(page, '.eat-card', '#my-day')).toBe(true);
    await openHomeEdit(page);
    await homeAct(page, 'up', 'day').click();
    await expect(homeAct(page, 'up', 'day')).toBeDisabled();
    await page.keyboard.press('Escape');
    expect(await before(page, '#my-day', '.eat-card')).toBe(true);
  });

  async function openDashEdit(page) {
    const btn = page.locator('#dash-edit');
    await btn.scrollIntoViewIfNeeded();
    await btn.click();
    await expectOpen(page);
    expect(hashOf(page)).toBe('#dash-edit');
  }
  const dashRow = (page, key) => page.locator(`#home-dash [data-detail="${key}"]`);
  const dashKeys = (page) => page.locator('#home-dash [data-detail]').evaluateAll((els) => els.map((e) => e.getAttribute('data-detail')));

  test('Customize My dashboard hides and shows rows, and it survives a reload', async ({ page }) => {
    await openStatic(page, '#home');
    await expect(dashRow(page, 'steps')).toHaveCount(1);
    await expect(dashRow(page, 'vo2max')).toHaveCount(0);
    await openDashEdit(page);
    await expect(dashAct(page, 'toggle', 'steps')).toHaveAttribute('aria-checked', 'true');
    await expect(dashAct(page, 'toggle', 'vo2max')).toHaveAttribute('aria-checked', 'false');

    await dashAct(page, 'toggle', 'steps').click();
    await expect(dashAct(page, 'toggle', 'steps')).toHaveAttribute('aria-checked', 'false');
    await dashAct(page, 'toggle', 'vo2max').click();
    await expect(dashAct(page, 'toggle', 'vo2max')).toHaveAttribute('aria-checked', 'true');
    const prefs = await dashPrefs(page);
    expect(prefs.hidden).toContain('steps');
    expect(prefs.hidden).not.toContain('vo2max');
    await page.keyboard.press('Escape');
    await expectClosed(page);
    await expect(dashRow(page, 'steps')).toHaveCount(0);
    await expect(dashRow(page, 'vo2max')).toHaveCount(1);

    await page.reload();
    await expect(page.locator('#t-home')).toBeVisible();
    await expect(dashRow(page, 'steps')).toHaveCount(0);
    await expect(dashRow(page, 'vo2max')).toHaveCount(1);

    await openDashEdit(page);
    await dashAct(page, 'toggle', 'steps').click();
    await expect(dashAct(page, 'toggle', 'steps')).toHaveAttribute('aria-checked', 'true');
    await dashAct(page, 'toggle', 'vo2max').click();
    await expect(dashAct(page, 'toggle', 'vo2max')).toHaveAttribute('aria-checked', 'false');
    await page.keyboard.press('Escape');
    await expect(dashRow(page, 'steps')).toHaveCount(1);
    await expect(dashRow(page, 'vo2max')).toHaveCount(0);
  });

  test('Customize My dashboard moves a row up and the order survives a reload', async ({ page }) => {
    await openStatic(page, '#home');
    expect((await dashKeys(page)).slice(0, 2)).toEqual(['rhr', 'hrv']);
    await openDashEdit(page);
    await dashAct(page, 'up', 'hrv').click();
    await expect(dashAct(page, 'up', 'hrv')).toBeDisabled();
    await expect(dashAct(page, 'up', 'hrv')).not.toBeFocused();
    await page.keyboard.press('Escape');
    expect((await dashKeys(page)).slice(0, 2)).toEqual(['hrv', 'rhr']);
    expect((await dashPrefs(page)).order.slice(0, 2)).toEqual(['hrv', 'rhr']);

    await page.reload();
    await expect(page.locator('#t-home')).toBeVisible();
    expect((await dashKeys(page)).slice(0, 2)).toEqual(['hrv', 'rhr']);
  });

  test('#home-edit and #dash-edit deep-link to their sheets over Home', async ({ page }) => {
    for (const view of ['home-edit', 'dash-edit']) {
      await openStatic(page, `#${view}`);
      await expectOpen(page);
      await expect(page.locator('#t-home')).toHaveAttribute('aria-current', 'page');
      await expect(inSheet(page, `[data-${view === 'home-edit' ? 'home' : 'dash'}-act="toggle"]`).first()).toBeVisible();
      expect(hashOf(page)).toBe(`#${view}`);
    }
  });
});

test.describe('registered views', () => {
  test('Tonight opens from its card with the bedtime, its rule behind ⓘ and a way to the sleep sheet', async ({ page }) => {
    await openStatic(page, '#home');
    const card = page.locator('.tab-panel[data-tab="home"] [data-detail="tonight"]');
    await card.scrollIntoViewIfNeeded();
    await card.click();
    await expectOpen(page);
    expect(hashOf(page)).toBe('#tonight');
    await expect(inSheet(page, '.dt-num')).toHaveText(/^\d{1,2}:\d{2}$/);
    await expectInfoToggles(page);
    await infoBtn(page).click();
    await expect(inSheet(page, '.tn-rule')).toBeVisible();

    await inSheet(page, '[data-detail="sleep"]').click();
    await expectOpen(page);
    await expect.poll(() => hashOf(page)).toBe('#detail/sleep');
    await expect(inSheet(page, '[data-dt-act="hist"]')).toBeVisible();
    await page.keyboard.press('Escape');
    await expectClosed(page);
    expect(hashOf(page)).toBe('#home');
  });

  test('#tonight deep-links to the view over Home', async ({ page }) => {
    await openStatic(page, '#tonight');
    await expectOpen(page);
    await expect(page.locator('#t-home')).toHaveAttribute('aria-current', 'page');
    await expect(inSheet(page, '.dt-num')).toHaveText(/^\d{1,2}:\d{2}$/);
  });

  test('journal insights open from My journal with ranked rows and the ⓘ caveat', async ({ page }) => {
    await openStatic(page, '#home');
    const btn = page.locator('#my-journal [data-detail="journal-insights"]');
    await btn.scrollIntoViewIfNeeded();
    await btn.click();
    await expectOpen(page);
    expect(hashOf(page)).toBe('#journal-insights');
    await expect(inSheet(page, '.ji-row').first()).toBeVisible();
    await expect(inSheet(page, '.jr-g')).not.toBeEmpty();
    await expectInfoToggles(page);
    await page.keyboard.press('Escape');
    await expectClosed(page);
    await expect(btn).toBeFocused();
  });

  test('#journal-insights deep-links to the view over Home', async ({ page }) => {
    await openStatic(page, '#journal-insights');
    await expectOpen(page);
    await expect(page.locator('#t-home')).toHaveAttribute('aria-current', 'page');
    await expect(inSheet(page, '.ji-row').first()).toBeVisible();
  });

  test('#hoy-session opens nothing on a day without a programmed session', async ({ page }) => {
    await openStatic(page, '#hoy-session');
    await settle(page);
    await expectClosed(page);
    await expect(page.locator('#t-home')).toHaveAttribute('aria-current', 'page');
    await expect.poll(() => hashOf(page)).toBe('#home');
  });

  test.describe('on a day of the example program', () => {
    // the example training program holds sessions on 2026-01-05, 01-08 and 01-10, months before the demo data:
    // on such a day Home's activities card shows the newest baked day (clock skew, client/timeline.js), so
    // the programmed-session row is not listed and the view is reached through its deep link
    const PROGRAM_DAY = '2026-01-05';
    test.use({ now: zonedInstant(PROGRAM_DAY, 10) });

    test('#hoy-session deep-links to the programmed session over Home', async ({ page }) => {
      await openStatic(page, '#hoy-session');
      await expectOpen(page);
      await expect(page.locator('#t-home')).toHaveAttribute('aria-current', 'page');
      expect(hashOf(page)).toBe('#hoy-session');
      await expect(inSheet(page, '.train-day')).toContainText(dayMonth(PROGRAM_DAY));
      await expect(inSheet(page, '.train-focus')).not.toBeEmpty();
      await expect(inSheet(page, '.train-block').first()).toBeVisible();
      await expect(inSheet(page, '.train-meta')).toContainText('My Hybrid Program');
      await page.keyboard.press('Escape');
      await expectClosed(page);
      await expect.poll(() => hashOf(page)).toBe('#home');
    });

  });
});
