/* Tests for Inicio's "Tonight" + "My plan" (web/src/client/home-week.js): the weekly goal computations
 * (week boundaries, programmed vs usual week, stale / missing data → row hidden, % = mean completion)
 * and the two renderers, run as the classic script in a vm with a fixed clock. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { es as esT, en as enT } from '../i18n/score-templates.mjs';
import { loadUtil } from '../../test/client-util.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const source = fs.readFileSync(path.join(here, 'home-week.js'), 'utf8');
const addDays = (d, n) => { const t = new Date(d + 'T00:00:00Z'); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };

// 2026-09-30 is a Wednesday: the week is Mon 28 Sep – Sun 4 Oct, 3 days elapsed, 4 left
const WED = '2026-09-30';

function host(id, hidden = false) {
  return { id, innerHTML: '', hidden, querySelector: () => null };
}
function load({ now = WED, locale = 'en', globals = {}, readyState = 'complete' } = {}) {
  const RealDate = Date;
  class FakeDate extends RealDate {
    constructor(...a) { if (a.length) super(...a); else super(new RealDate(now + 'T12:00:00').getTime()); }
    static now() { return new RealDate(now + 'T12:00:00').getTime(); }
  }
  const els = { 'home-tonight': host('home-tonight', true), 'my-plan': host('my-plan', true), 'home-plan': host('home-plan') };
  const listeners = {};
  const ctx = {
    document: { readyState, getElementById: (id) => els[id] || null, addEventListener: (e, f) => { listeners[e] = f; } },
    I18N_SCORE: locale === 'es' ? esT : enT, LOCALE: locale,
    Date: FakeDate, Math, String, Number, Array, Object, JSON,
    ...globals,
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  loadUtil(ctx);
  vm.runInContext(source, ctx);
  return { ctx, els, listeners };
}
// vm-realm arrays / objects -> this realm's (deepEqual compares prototypes)
const plain = (x) => JSON.parse(JSON.stringify(x));
// a dense DETAIL-like series from `start`, one slot per day
const series = (start, vals, extra = {}) => ({ start, v: vals, ...extra });

test('week boundaries: Monday to Sunday of the viewer\'s today; days left after today', () => {
  const { ctx } = load();
  const W = ctx.HCWeekPlan;
  assert.deepEqual({ ...W.weekOf('2026-09-30') }, { start: '2026-09-28', end: '2026-10-04', elapsed: 3, daysLeft: 4 });
  assert.deepEqual({ ...W.weekOf('2026-09-28') }, { start: '2026-09-28', end: '2026-10-04', elapsed: 1, daysLeft: 6 });
  assert.deepEqual({ ...W.weekOf('2026-10-04') }, { start: '2026-09-28', end: '2026-10-04', elapsed: 7, daysLeft: 0 });
  assert.deepEqual({ ...W.GOALS }, { sleepNights: 5, foodDays: 7, kcalDays: 5 }, 'documented defaults');
});

test('sleep row: only this week\'s nights (dated the wake-up day) at or above the target count', () => {
  const { ctx } = load();
  // Sun 27 (last week) 8 h, Mon 28 7.6, Tue 29 7.0, Wed 30 7.5
  const sleep = series('2026-09-27', [8, 7.6, 7.0, 7.5], { target: 7.5 });
  const g = ctx.HCWeekPlan.weekGoals({ today: WED, asOf: WED, sleep });
  assert.equal(g.rows.length, 1);
  const r = g.rows[0];
  assert.equal(r.key, 'sleep');
  assert.equal(r.done, 2);
  assert.equal(r.target, 5);
  assert.equal(r.hours, 7.5);
  assert.equal(r.onTrack, false, 'pace: 2 < 5 × 3/7 ≈ 2.14');
});

test('pace: on track when done ≥ target × elapsed / 7, else behind', () => {
  const { ctx } = load();
  const sleep = series('2026-09-28', [8, 6, 6], { target: 7.5 });
  const r = ctx.HCWeekPlan.weekGoals({ today: WED, asOf: WED, sleep }).rows[0];
  assert.equal(r.done, 1);
  assert.equal(r.onTrack, false, '1 < 5 × 3/7');
});

test('training row: distinct session days vs the days programmed this week', () => {
  const { ctx } = load();
  const sessions = [
    { d: '2026-09-27', m: 'run' }, // last week
    { d: '2026-09-28', m: 'gym' }, { d: '2026-09-28', m: 'run' }, // two sessions, one day
    { d: '2026-09-30', m: 'bike' },
  ];
  const training = { '2026-09-28': { kind: 'gym' }, '2026-09-30': { kind: 'run' }, '2026-10-02': { kind: 'gym' }, '2026-10-05': { kind: 'gym' } };
  const g = ctx.HCWeekPlan.weekGoals({ today: WED, asOf: WED, sessions, sessionsStart: '2026-06-01', training });
  const r = g.rows.find((x) => x.key === 'training');
  assert.equal(r.done, 2);
  assert.equal(r.target, 3, 'only the programmed days inside Mon–Sun');
  assert.equal(r.basis, 'programmed');
});

test('training row without a programme: vs the usual week (median session days of the last 6 complete weeks)', () => {
  const { ctx } = load();
  const sessions = [];
  // weeks before 28 Sep: 4, 3, 4, 2, 5, 4 session days → median 4
  [4, 3, 4, 2, 5, 4].forEach((n, w) => {
    const ws = addDays('2026-09-28', -7 * (w + 1));
    for (let i = 0; i < n; i++) sessions.push({ d: addDays(ws, i), m: 'gym' });
  });
  sessions.push({ d: '2026-09-29', m: 'run' });
  const g = ctx.HCWeekPlan.weekGoals({ today: WED, asOf: WED, sessions, sessionsStart: '2026-06-01', training: {} });
  const r = g.rows.find((x) => x.key === 'training');
  assert.deepEqual(plain([r.done, r.target, r.basis]), [1, 4, 'typical']);
  // only 2 complete weeks covered by the data → no usual week → row hidden (no other row → no card)
  assert.equal(ctx.HCWeekPlan.weekGoals({ today: WED, asOf: WED, sessions, sessionsStart: '2026-09-14', training: null }), null);
  // a usual week of 0 session days hides the row
  assert.equal(ctx.HCWeekPlan.weekGoals({ today: WED, asOf: WED, sessions: [], sessionsStart: '2026-06-01', training: null }), null);
});

test('stale or missing health data hides the sleep and training rows; food rows stay', () => {
  const { ctx } = load();
  const sleep = series('2026-09-01', Array(26).fill(8), { target: 7.5 });
  const sessions = [{ d: '2026-09-20', m: 'gym' }];
  const stale = ctx.HCWeekPlan.weekGoals({ today: WED, asOf: '2026-09-26', sleep, sessions, sessionsStart: '2026-06-01', training: { '2026-09-28': {} } });
  assert.equal(stale, null, 'asOf 4 days old: nothing to count this week');
  const withFood = ctx.HCWeekPlan.weekGoals({ today: WED, asOf: null, sleep, food: [{ date: '2026-09-28', n: 3 }, { date: '2026-09-29', n: 0 }, { date: '2026-09-27', n: 2 }] });
  assert.deepEqual(plain(withFood.rows.map((r) => [r.key, r.done, r.target])), [['food', 1, 7]]);
});

test('food rows (LAN page): days logged this week, days on the kcal target; no summary → rows hidden', () => {
  const { ctx } = load();
  const food = [{ date: '2026-09-28', n: 3 }, { date: '2026-09-29', n: 2 }, { date: '2026-09-30', n: 1 }];
  const kcal = { '2026-09-28': 'on', '2026-09-29': 'over', '2026-09-30': 'partial' };
  const g = ctx.HCWeekPlan.weekGoals({ today: WED, asOf: WED, food, kcal });
  assert.deepEqual(plain(g.rows.map((r) => [r.key, r.done, r.target])), [['food', 3, 7], ['kcal', 1, 5]]);
  assert.equal(ctx.HCWeekPlan.weekGoals({ today: WED, asOf: WED, food: null, kcal }), null);
});

test('% accomplished = the mean of min(1, done / target) over the shown rows', () => {
  const { ctx } = load();
  const sleep = series('2026-09-28', [8, 8, 8], { target: 7.5 }); // 3/5 = .6
  const food = [{ date: '2026-09-28', n: 1 }]; // 1/7 ≈ .143
  const g = ctx.HCWeekPlan.weekGoals({ today: WED, asOf: WED, sleep, food });
  assert.equal(g.pct, Math.round(100 * (0.6 + 1 / 7) / 2));
  const capped = ctx.HCWeekPlan.weekGoals({ today: '2026-10-04', asOf: '2026-10-04', sleep: series('2026-09-28', Array(7).fill(8), { target: 7.5 }) });
  assert.equal(capped.rows[0].done, 7);
  assert.equal(capped.rows[0].frac, 1, 'over the target counts as done, never above 100%');
  assert.equal(capped.pct, 100);
});

const TONIGHT = { asOf: '2026-09-30', wake: 7.25, bed: 23.75, target: 7.5, nights: 12, window: 14 };

test('Tonight: bedtime ↔ usual wake time on the card, the rule only in its sheet; hidden without data', () => {
  const { ctx, els } = load({ globals: { SCORES: { tonight: TONIGHT }, DETAIL: { asOf: WED, metrics: { sleep: series('2026-09-28', [8], { target: 7.5 }) }, sessions: [] } } });
  const h = els['home-tonight'];
  assert.equal(h.hidden, false);
  assert.match(h.innerHTML, /class="sc-card tn"/);
  assert.match(h.innerHTML, /<b>23:45<\/b><\/span><span class="tn-lbl">Recommended bedtime<\/span>[\s\S]*tn-dash[\s\S]*<b>07:15<\/b><\/span><span class="tn-lbl tn-state">Usual wake<\/span><span class="tn-lbl">Last 12 nights<\/span>/, 'the wake side: a teal state line, then the nights it comes from');
  assert.match(h.innerHTML, /data-detail="tonight"/);
  assert.doesNotMatch(h.innerHTML, /median|target/i, 'the rule is not on the card');
  const v = ctx.HCViews.tonight;
  assert.equal(v.title(), "Tonight's sleep");
  const r = v.render(), body = r.body;
  // the rule and the disclaimer sit behind the sheet's ⓘ (r.info), not in the body (the reference app's sheet: the numbers, a way on)
  assert.match(r.info, /<p class="tn-rule">Bedtime 23:45 = your usual wake time \(07:15, the median of your last 12 nights\) minus your sleep target of 7:30\.<\/p><p class="dt-note">/);
  assert.doesNotMatch(body, /tn-rule|dt-note/);
  assert.match(body, /data-detail="sleep"/, 'a way to the sleep history');
  // THE CTA link (HC.cta): a .cta button opening the sleep sheet, the arrow hidden from screen readers
  assert.ok(body.endsWith('<button type="button" class="cta" data-detail="sleep">See sleep history<span aria-hidden="true"> →</span></button>'), body.slice(-200));
  // no sleep metric to open: the sheet keeps its rule and drops the CTA (never a link to an empty sheet)
  const bare = load({ globals: { SCORES: { tonight: TONIGHT }, DETAIL: { asOf: WED, metrics: {}, sessions: [] } } });
  const bareR = bare.ctx.HCViews.tonight.render(), bareBody = bareR.body;
  assert.match(bareR.info, /class="tn-rule"/);
  assert.doesNotMatch(bareBody, /class="cta"|data-detail="sleep"/);
  const none = load({ globals: { SCORES: { tonight: null } } });
  assert.equal(none.els['home-tonight'].hidden, true);
  assert.equal(none.els['home-tonight'].innerHTML, '');
});

test('Tonight (es): Spanish labels; stale data greys the card', () => {
  const { els } = load({ locale: 'es', now: '2026-10-08', globals: { SCORES: { tonight: TONIGHT } } });
  assert.match(els['home-tonight'].innerHTML, /sc-card tn sc-stale/);
  assert.match(els['home-tonight'].innerHTML, /Hora de acostarte[\s\S]*Despertar habitual/);
});

test('My plan renders a collapsible card (title, days left, %, bar) + its rows; hidden when no row', () => {
  const DETAIL = { asOf: WED, metrics: { sleep: series('2026-09-28', [8, 6, 7.5], { target: 7.5 }), workouts: { start: '2026-06-01' } }, sessions: [{ d: '2026-09-28', m: 'gym' }] };
  const { els } = load({ globals: { DETAIL, TRAINING: { '2026-09-28': {}, '2026-10-01': {} } } });
  const html = els['home-plan'].innerHTML;
  assert.equal(els['my-plan'].hidden, false);
  assert.match(html, /^<details class="sc-card wp"><summary class="wp-sum">/);
  assert.match(html, /Weekly plan[\s\S]*4 days left[\s\S]*<b>45<\/b><small>%<\/small> accomplished/);
  assert.match(html, /aria-valuenow="45"/);
  assert.match(html, /Nights ≥ 7:30<small>Goal: 5 this week<\/small>[\s\S]*<b>2<\/b>\/5/);
  assert.match(html, /Training days<small>Vs the days programmed this week<\/small>[\s\S]*<b>1<\/b>\/2/);
  assert.match(html, /data-detail="sleep"/);
  const empty = load({ globals: { DETAIL: { asOf: '2026-09-01', metrics: {}, sessions: [] } } });
  assert.equal(empty.els['my-plan'].hidden, true);
  assert.equal(empty.els['home-plan'].innerHTML, '');
});

test('My plan reads the food log summary (window.HCAdherence) and refreshes when it answers', () => {
  const st = { days: null };
  const HCAdherence = { state: () => st, dayState: (d, t) => (d && t && d.k <= t.k ? 'on' : 'none') };
  const HCNutri = { targetFor: () => ({ k: 2000, p: 150 }) };
  const { ctx, els } = load({ globals: { HCAdherence, HCNutri, DETAIL: { asOf: '2026-09-01', metrics: {}, sessions: [] } } });
  assert.equal(els['my-plan'].hidden, true, 'no summary yet');
  st.days = [{ date: '2026-09-28', n: 4, k: 1900 }, { date: '2026-09-29', n: 2, k: 2500 }];
  ctx.HCWeekPlan.refresh();
  assert.equal(els['my-plan'].hidden, false);
  assert.match(els['home-plan'].innerHTML, /Days with food logged[\s\S]*<b>2<\/b>\/7[\s\S]*Days on kcal target[\s\S]*<b>1<\/b>\/5/);
});

test('renders at once, even while the page is still parsing: it runs at the end of body (layouts/Plan.astro), after its globals and before detail.js', () => {
  const { els, ctx } = load({ readyState: 'loading', globals: { SCORES: { tonight: TONIGHT } } });
  assert.equal(els['home-tonight'].hidden, false, 'rendered without waiting for DOMContentLoaded');
  assert.equal(typeof ctx.window.HCViews.tonight.render, 'function', 'the view is registered before detail.js reads the hash');
});

test('Tonight on a PAST day (the top bar\'s day stepping): hidden, and back on today', () => {
  let sel = '2026-09-29';
  const subs = [];
  const HCDay = { sel: () => sel, on: (fn) => subs.push(fn) };
  const { els } = load({ globals: { SCORES: { tonight: TONIGHT }, HCDay } });
  const h = els['home-tonight'];
  assert.equal(h.hidden, true);
  assert.equal(h.innerHTML, '');
  sel = null;
  subs.forEach((fn) => fn(sel));
  assert.equal(h.hidden, false);
  assert.equal(h.innerHTML, load({ globals: { SCORES: { tonight: TONIGHT } } }).els['home-tonight'].innerHTML);
});
