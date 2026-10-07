/* web/src/client/intake.js — Nutrición intake rings. Runs the real classic script in node:vm
 * against web/test/dom-stub.mjs with a fixed clock. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { StubDocument } from '../../test/dom-stub.mjs';
import { en as enIntake, es as esIntake } from '../i18n/intake-templates.mjs';
import { loadUtil } from '../../test/client-util.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const source = fs.readFileSync(path.join(here, 'intake.js'), 'utf8');

const TARGET = { train: { k: 2400, p: 170, c: 260, g: 70 }, rest: { k: 2000, p: 160, c: 180, g: 70 } };

function fixedDate(iso) {
  const RealDate = Date;
  return class extends RealDate {
    constructor(...a) { if (a.length) super(...a); else super(iso + 'T12:00:00'); }
    static now() { return new RealDate(iso + 'T12:00:00').getTime(); }
  };
}

// nutriTarget = today's target (client/nutri-day.js); with it the page also has HCNutri.targetFor
// (that date's target), here by default the same target unless the test passes its own.
function run({ latest, today, locale = 'en', nutriTarget = null, targetFor, foodTotals = null, hcFood = null }) {
  const doc = new StubDocument();
  const host = doc.el('intake');
  const window = nutriTarget ? { nutriTarget } : {};
  if (targetFor !== false && (nutriTarget || targetFor)) window.HCNutri = { targetFor: targetFor || (() => nutriTarget()) };
  if (foodTotals) window.foodTotals = foodTotals;
  if (hcFood) window.HCFood = hcFood;
  const ctx = {
    document: doc, window, INTAKE: { latest, target: TARGET, freshDays: 3 }, I18N_INTAKE: locale === 'es' ? esIntake : enIntake, LOCALE: locale,
    Math, String, Number, JSON, Date: fixedDate(today),
  };
  vm.createContext(ctx);
  loadUtil(ctx);
  vm.runInContext(source, ctx);
  return { host, window, doc };
}

test('fresh intake without Nutrición today: four rings (kcal, protein, carbs, fat) vs the plan\'s training-day total', () => {
  const { host } = run({ latest: { date: '2030-01-09', k: 1200, p: 170, c: 130, g: 35 }, today: '2030-01-10' });
  const html = host.innerHTML;
  assert.equal((html.match(/class="ring /g) || []).length, 4);
  assert.match(html, /1200<\/b>/);
  assert.match(html, /of 2400 kcal/);
  assert.match(html, /50%/);
  assert.match(html, /100%/, 'protein 170/170');
  assert.match(html, /Training-day target/);
});

test('no train/rest toggle any more: intakeRefresh re-renders against today\'s target as it is now', () => {
  let t = { k: 2500, p: 150, c: 340, g: 60, fuelK: 0, label: "Today's target · Rest · Maintain" };
  const { host, window, doc } = run({ latest: { date: '2030-01-09', k: 1000, p: 80, c: 90, g: 35 }, today: '2030-01-10', nutriTarget: () => t });
  assert.equal(doc.getElementById('b-train'), null);
  assert.match(host.innerHTML, /of 2500 kcal/);
  t = { k: 3050, p: 150, c: 477, g: 60, fuelK: 0, label: "Today's target · Gym or run · Maintain" };
  window.intakeRefresh();
  assert.match(host.innerHTML, /of 3050 kcal/);
  assert.match(host.innerHTML, /Gym or run/);
});

test('bike days: the rings compare against the MEALS target and the ride fuel is its own line', () => {
  const nutriTarget = () => ({ k: 3070, p: 150, c: 437, g: 60, fuelK: 480, label: "Today's meals · Ride ~2 h · Maintain" });
  const html = run({ latest: { date: '2030-01-09', k: 1535, p: 75, c: 200, g: 30 }, today: '2030-01-10', nutriTarget }).host.innerHTML;
  assert.match(html, /of 3070 kcal/);
  assert.match(html, /50%/);
  assert.match(html, /class="intake-fuel">\+ 480 kcal on the bike</);
  const es = run({ latest: { date: '2030-01-09', k: 1535, p: 75, c: 200, g: 30 }, today: '2030-01-10', locale: 'es', nutriTarget }).host.innerHTML;
  assert.match(es, /\+ 480 kcal en la bici/);
  const rest = run({ latest: { date: '2030-01-09', k: 1535, p: 75, c: 200, g: 30 }, today: '2030-01-10', nutriTarget: () => ({ k: 2500, p: 150, c: 340, g: 60, fuelK: 0, label: 'x' }) }).host.innerHTML;
  assert.doesNotMatch(rest, /intake-fuel/);
});

test('a macro missing on the logged day renders an empty ring with a dash, never a target-filled one', () => {
  const { host } = run({ latest: { date: '2030-01-10', k: 1500, p: null, c: null, g: null }, today: '2030-01-10' });
  const html = host.innerHTML;
  assert.equal((html.match(/class="ring-fill"/g) || []).length, 1, 'only kcal has a fill arc');
  assert.match(html, /ring-none/);
});

test('intake older than 3 days -> the block renders nothing (no rings, no help text)', () => {
  const { host } = run({ latest: { date: '2030-01-06', k: 2000, p: 150, c: 200, g: 60 }, today: '2030-01-10' });
  assert.equal(host.innerHTML, '');
  assert.equal(host.hidden, true);
});

test('no intake ever logged -> the block renders nothing (the owner may not log food)', () => {
  const { host } = run({ latest: null, today: '2030-01-10' });
  assert.equal(host.innerHTML, '');
  assert.equal(host.hidden, true);
});

// the ring circumference the fill arc is measured against (r = 18 in a 44-unit viewBox)
const C = 2 * Math.PI * 18;
const ringOf = (html, key) => html.match(new RegExp('<figure class="ring ring-' + key + '[^"]*"[\\s\\S]*?</figure>'))[0];

test('over target: the percentage keeps the real number, the arc is capped at a full circle, >110% is flagged', () => {
  const { host } = run({ latest: { date: '2030-01-09', k: 2800, p: 180, c: 100, g: 70 }, today: '2030-01-10' });
  const k = ringOf(host.innerHTML, 'k');
  assert.match(k, /class="ring ring-k ring-over"/, '2800 / 2400 = 117% > 110%');
  assert.match(k, />117%</);
  assert.match(k, new RegExp('stroke-dasharray="' + C.toFixed(2) + ' ' + C.toFixed(2) + '"'), 'arc capped at 100%');
  const p = ringOf(host.innerHTML, 'p');
  assert.doesNotMatch(p, /ring-over/, '180 / 170 = 106% is within the 110% tolerance');
  assert.match(p, />106%</);
});

test('a logged 0 g macro is a real 0% (value 0), distinct from a missing macro (dash)', () => {
  const { host } = run({ latest: { date: '2030-01-09', k: 1500, p: 100, c: 150, g: 0 }, today: '2030-01-10' });
  const g = ringOf(host.innerHTML, 'g');
  assert.doesNotMatch(g, /ring-none/);
  assert.match(g, />0%</);
  assert.match(g, /<b>0<\/b>/);
  assert.doesNotMatch(g, /class="ring-fill"/, 'nothing to draw for 0');
  assert.doesNotMatch(g, /—/);
});

test('the aria-label formats numbers for the locale (comma decimals in es)', () => {
  const { host } = run({ latest: { date: '2030-01-09', k: 1500, p: 151.3, c: 150, g: 50 }, today: '2030-01-10', locale: 'es' });
  const p = ringOf(host.innerHTML, 'p');
  assert.match(p, /aria-label="Proteína: 151,3 de 170 g"/);
});

test('freshness boundaries: 3 days ago still shows rings; a future-dated day does not', () => {
  assert.match(run({ latest: { date: '2030-01-07', k: 2000, p: 1, c: 1, g: 1 }, today: '2030-01-10' }).host.innerHTML, /class="ring /);
  assert.doesNotMatch(run({ latest: { date: '2030-01-11', k: 2000, p: 1, c: 1, g: 1 }, today: '2030-01-10' }).host.innerHTML, /class="ring /);
  assert.equal(run({ latest: { date: '2030-01-06', k: 2000, p: 1, c: 1, g: 1 }, today: '2030-01-10' }).host.hidden, true, '4 days ago: hidden');
  assert.equal(run({ latest: { date: '2030-01-07', k: 2000, p: 1, c: 1, g: 1 }, today: '2030-01-10' }).host.hidden, false, '3 days ago: shown');
});

test('a logged day that is the viewer\'s today is labelled as in progress, not as a finished day', () => {
  const today = run({ latest: { date: '2030-01-10', k: 900, p: 60, c: 90, g: 30 }, today: '2030-01-10' }).host.innerHTML;
  assert.match(today, /class="intake-asof">Today, so far</);
  const es = run({ latest: { date: '2030-01-10', k: 900, p: 60, c: 90, g: 30 }, today: '2030-01-10', locale: 'es' }).host.innerHTML;
  assert.match(es, /class="intake-asof">Hoy, en curso</);
  const yesterday = run({ latest: { date: '2030-01-09', k: 900, p: 60, c: 90, g: 30 }, today: '2030-01-10' }).host.innerHTML;
  assert.doesNotMatch(yesterday, /so far/);
});

test('with Nutrición today (window.nutriTarget), the rings measure against that goal x day type target', () => {
  const nutriTarget = () => ({ k: 3050, p: 150, c: 424, g: 60, label: "Today's target · Gym or run · Maintain" });
  const html = run({ latest: { date: '2030-01-09', k: 1525, p: 75, c: 212, g: 30 }, today: '2030-01-10', nutriTarget }).host.innerHTML;
  assert.match(html, /of 3050 kcal/);
  assert.match(html, /50%/);
  assert.match(html, /Today&#39;s target · Gym or run · Maintain|Today's target · Gym or run · Maintain/);
  const broken = run({ latest: { date: '2030-01-09', k: 1200, p: 1, c: 1, g: 1 }, today: '2030-01-10', nutriTarget: () => { throw new Error('x'); } }).host.innerHTML;
  assert.match(broken, /of 2400 kcal/, 'falls back to the plan\'s training-day total');
});

test('a PAST logged day is measured against THAT day\'s target (HCNutri.targetFor(date)), never today\'s', () => {
  const asked = [];
  let todayCalls = 0;
  const nutriTarget = () => { todayCalls += 1; return { k: 2500, p: 150, c: 340, g: 60, fuelK: 0, label: "Today's target · Rest · Maintain" }; };
  const targetFor = (d) => { asked.push(d); return { k: 3070, p: 150, c: 437, g: 60, fuelK: 480, dayType: 'bike', label: "That day's meals · Ride ~2 h · Maintain" }; };
  const html = run({ latest: { date: '2030-01-09', k: 1535, p: 75, c: 200, g: 30 }, today: '2030-01-10', nutriTarget, targetFor }).host.innerHTML;
  assert.deepEqual(asked, ['2030-01-09']);
  assert.equal(todayCalls, 0, 'today\'s target is not read for a past day');
  assert.match(html, /of 3070 kcal/);
  assert.match(html, /50%/);
  assert.match(html, /That day&#39;s meals · Ride ~2 h|That day's meals · Ride ~2 h/);
  assert.match(html, /class="intake-asof">Wed 9 Jan</, 'labelled with that day\'s date (the shared format)');
  assert.match(html, /\+ 480 kcal on the bike/);
});

test('a past day whose day type is unknown (targetFor -> null): no rings at all, never a guessed target', () => {
  const { host } = run({ latest: { date: '2030-01-08', k: 1535, p: 75, c: 200, g: 30 }, today: '2030-01-10', nutriTarget: () => ({ k: 2500, p: 150, c: 340, g: 60, label: 'x' }), targetFor: () => null });
  assert.equal(host.hidden, true);
  assert.equal(host.innerHTML, '');
});

test('Nutrición without HCNutri.targetFor (never in a real build): a past day falls back to the plan total, never today\'s target', () => {
  const html = run({ latest: { date: '2030-01-09', k: 1200, p: 1, c: 1, g: 1 }, today: '2030-01-10', nutriTarget: () => ({ k: 3050, p: 150, c: 424, g: 60, label: 'today' }), targetFor: false }).host.innerHTML;
  assert.match(html, /of 2400 kcal/);
  assert.doesNotMatch(html, /3050/);
});

test('intake logged TODAY with Nutrición present: no rings (the kcal dial and macro bars of Resumen de hoy show it)', () => {
  const nutriTarget = () => ({ k: 3050, p: 150, c: 424, g: 60, label: 'x' });
  const { host } = run({ latest: { date: '2030-01-10', k: 1525, p: 75, c: 212, g: 30 }, today: '2030-01-10', nutriTarget });
  assert.equal(host.innerHTML, '');
  assert.equal(host.hidden, true);
  const y = run({ latest: { date: '2030-01-09', k: 1525, p: 75, c: 212, g: 30 }, today: '2030-01-10', nutriTarget }).host;
  assert.equal(y.hidden, false, 'an earlier fresh day still shows its rings');
});

test('today\'s page food log (window.foodTotals) wins over the Apple Health day: with Nutrición it steps aside, alone it draws the rings labelled as logged here', () => {
  const food = () => ({ date: '2030-01-10', k: 1200, p: 85, c: 130, g: 40, n: 2, missing: { protein: false, carbs: false, fat: false }, src: 'log' });
  const nutriTarget = () => ({ k: 2400, p: 170, c: 260, g: 70, label: 'x' });
  const aside = run({ latest: { date: '2030-01-09', k: 900, p: 1, c: 1, g: 1 }, today: '2030-01-10', nutriTarget, foodTotals: food }).host;
  assert.equal(aside.hidden, true, 'the dial of Resumen de hoy shows today\'s log');
  const alone = run({ latest: { date: '2030-01-09', k: 900, p: 1, c: 1, g: 1 }, today: '2030-01-10', foodTotals: food }).host.innerHTML;
  assert.match(alone, /50%/);
  assert.match(alone, /class="intake-asof">Logged today</);
  const broken = run({ latest: { date: '2030-01-09', k: 1200, p: 1, c: 1, g: 1 }, today: '2030-01-10', foodTotals: () => { throw new Error('x'); } }).host.innerHTML;
  assert.match(broken, /1200/, 'a throwing hook falls back to the Apple Health day');
});

test('rings from the food log: a macro no entry states is a dash (never 0 %); one some entries lack is marked as a minimum', () => {
  const food = () => ({ date: '2030-01-10', k: 1200, p: 85, c: null, g: 40, n: 2, missing: { protein: true, carbs: true, fat: false }, src: 'log' });
  const html = run({ latest: { date: '2030-01-09', k: 900, p: 1, c: 1, g: 1 }, today: '2030-01-10', foodTotals: food }).host.innerHTML;
  assert.match(html, /class="ring ring-c ring-none"/, 'no carbs stated: empty ring');
  assert.doesNotMatch(html, /ring-c[^>]*>[\s\S]*?0%/);
  assert.match(html, /<b>≥ 85<\/b>/, 'protein is a minimum');
  assert.match(html, /<b>40<\/b>/);
  assert.ok(html.includes(enIntake.minNote), 'the minimum is explained');
});

/* LAN page (the food API answered: HCFood.ready()): the food log is the ONE intake source — a past day
 * comes from HCFood.recentDay(freshDays), never from the Apple Health CSV. */
const lanFood = (day, calls = []) => ({ ready: () => true, recentDay: (n) => { calls.push(n); return typeof day === 'function' ? day() : day; } });

test('LAN page, today empty, yesterday logged: rings for yesterday from the food log, labelled by its date, against its own target', () => {
  const calls = [];
  const seen = [];
  const day = { date: '2030-01-09', k: 1200, p: 85, c: 130, g: 40, n: 3, missing: { protein: false, carbs: false, fat: false }, src: 'log' };
  const nutriTarget = () => ({ k: 3050, p: 150, c: 424, g: 60, label: 'today' });
  const targetFor = (d) => { seen.push(d); return { k: 2400, p: 170, c: 260, g: 70, fuelK: 0, label: 'Meals that day' }; };
  const { host } = run({ latest: { date: '2030-01-10', k: 999, p: 1, c: 1, g: 1 }, today: '2030-01-10', nutriTarget, targetFor, foodTotals: () => null, hcFood: lanFood(day, calls) });
  assert.equal(host.hidden, false);
  const html = host.innerHTML;
  assert.match(html, /<b>1200<\/b>/);
  assert.doesNotMatch(html, /999/, 'never the Apple Health day');
  assert.match(html, /of 2400 kcal/);
  assert.match(html, /Meals that day/);
  assert.doesNotMatch(html, /Logged today|Today, so far/);
  assert.match(html, /class="intake-asof">Wed 9 Jan</);
  assert.deepEqual(seen, ['2030-01-09']);
  assert.deepEqual(calls, [3], 'the window is INTAKE.freshDays');
});

test('LAN page, nothing logged in the window: no rings, even with a fresh Apple Health day', () => {
  const { host } = run({ latest: { date: '2030-01-09', k: 1500, p: 100, c: 100, g: 50 }, today: '2030-01-10', foodTotals: () => null, hcFood: lanFood(null) });
  assert.equal(host.hidden, true);
  assert.equal(host.innerHTML, '');
  const thrown = run({ latest: { date: '2030-01-09', k: 1500, p: 100, c: 100, g: 50 }, today: '2030-01-10', foodTotals: () => null, hcFood: lanFood(() => { throw new Error('x'); }) }).host;
  assert.equal(thrown.hidden, true, 'a throwing hook is no data, not a fallback to Apple Health');
  const old = run({ latest: null, today: '2030-01-10', foodTotals: () => null, hcFood: lanFood({ date: '2030-01-02', k: 1500, p: 1, c: 1, g: 1, n: 1, missing: {}, src: 'log' }) }).host;
  assert.equal(old.hidden, true, 'a day outside the window is never shown');
});

test('LAN page, today logged: today\'s food log wins (unchanged), recentDay is not asked', () => {
  const calls = [];
  const food = () => ({ date: '2030-01-10', k: 1200, p: 85, c: 130, g: 40, n: 2, missing: { protein: false, carbs: false, fat: false }, src: 'log' });
  const nutriTarget = () => ({ k: 2400, p: 170, c: 260, g: 70, label: 'x' });
  const aside = run({ latest: { date: '2030-01-09', k: 900, p: 1, c: 1, g: 1 }, today: '2030-01-10', nutriTarget, foodTotals: food, hcFood: lanFood(null, calls) }).host;
  assert.equal(aside.hidden, true);
  const alone = run({ latest: { date: '2030-01-09', k: 900, p: 1, c: 1, g: 1 }, today: '2030-01-10', foodTotals: food, hcFood: lanFood(null, calls) }).host.innerHTML;
  assert.match(alone, /class="intake-asof">Logged today</);
  assert.deepEqual(calls, []);
});

test('LAN page, a past food-log day with a macro some entries lack: shown as a minimum; a day with no target draws nothing', () => {
  const day = { date: '2030-01-08', k: 1500, p: 90, c: null, g: 50, n: 2, missing: { protein: true, carbs: true, fat: false }, src: 'log' };
  const html = run({ latest: null, today: '2030-01-10', foodTotals: () => null, hcFood: lanFood(day) }).host.innerHTML;
  assert.match(html, /<b>≥ 90<\/b>/);
  assert.match(html, /class="ring ring-c ring-none"/);
  assert.ok(html.includes(enIntake.minNote));
  const none = run({ latest: null, today: '2030-01-10', nutriTarget: () => ({ k: 1, p: 1, c: 1, g: 1, label: 'x' }), targetFor: () => null, foodTotals: () => null, hcFood: lanFood(day) }).host;
  assert.equal(none.hidden, true);
});

test('no food API (HCFood absent or not ready): the Apple Health day as before', () => {
  const html = run({ latest: { date: '2030-01-09', k: 1200, p: 170, c: 130, g: 35 }, today: '2030-01-10', hcFood: { ready: () => false, recentDay: () => { throw new Error('never asked'); } } }).host.innerHTML;
  assert.match(html, /1200<\/b>/);
});
