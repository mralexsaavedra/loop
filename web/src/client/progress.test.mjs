/* web/src/client/progress.js — Nutrición "Progreso" (weight vs the goal) + the profile sheet's line.
 * Runs the real classic script in node:vm against web/test/dom-stub.mjs with a fixed clock and SYNTHETIC
 * weight series; the port is pinned against lib/nutrition/progress.mjs. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { StubDocument } from '../../test/dom-stub.mjs';
import { loadUtil } from '../../test/client-util.mjs';
import { es as esN, en as enN } from '../i18n/nutri-templates.mjs';
import { PROGRESS, PROGRESS_CASES, etaMonths, weeklyRate, rollPoints } from '../../../lib/nutrition/progress.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const source = fs.readFileSync(path.join(here, 'progress.js'), 'utf8');
const CUT = PROGRESS_CASES[0].metric; // 80 -> 78 kg over 41 days, ending 2030-02-10
const text = (html) => String(html).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

function fixedDate(iso) {
  const RealDate = Date;
  return class extends RealDate {
    constructor(...a) { if (a.length) super(...a); else super(iso + 'T12:00:00'); }
    static now() { return new RealDate(iso + 'T12:00:00').getTime(); }
  };
}
function settingsStub(target, ready = true) {
  const fns = [];
  return { fns, ready: () => ready, targetWeight: () => target, onChange: (fn) => fns.push(fn) };
}
function run({ weight = CUT, goal = 'cut', settings = null, locale = 'en', today = '2030-02-10', detail } = {}) {
  const doc = new StubDocument();
  const host = doc.el('nutri-progress');
  const window = { HCNutri: { state: () => ({ goal }) } };
  if (settings) window.HCSettings = settings;
  const ctx = {
    document: doc, window, LOCALE: locale,
    NUTRI: { goal: 'maintain', progress: PROGRESS }, I18N_NUTRI: locale === 'es' ? esN : enN,
    DETAIL: detail !== undefined ? detail : { asOf: today, metrics: weight ? { weight } : {}, sessions: [] },
    Date: fixedDate(today), Math, JSON, Number, String, Object, Array, isFinite,
  };
  vm.createContext(ctx);
  loadUtil(ctx);
  vm.runInContext(source, ctx);
  return { host, window, P: window.HCProgress };
}

test('parity: the port computes exactly what lib/nutrition/progress.mjs computes', () => {
  const { P } = run();
  for (const c of PROGRESS_CASES) assert.deepEqual(JSON.parse(JSON.stringify(P.weightProgress(c.metric, c.opts))), c.expect, c.name);
  for (const c of PROGRESS_CASES) {
    assert.deepEqual(JSON.parse(JSON.stringify(P.rollPoints(c.metric))), rollPoints(c.metric), 'rollPoints ' + c.name);
    assert.deepEqual(JSON.parse(JSON.stringify(P.weeklyRate(rollPoints(c.metric)))), weeklyRate(rollPoints(c.metric)), 'weeklyRate ' + c.name);
  }
  for (const [d, w] of [['2030-02-10', [6, 12]], ['2030-12-20', [1.5, 3]], ['2030-02-10', null], ['x', [1, 2]]]) {
    assert.deepEqual(JSON.parse(JSON.stringify(P.etaMonths(d, w))), etaMonths(d, w), d);
  }
});

test('cut on pace with a target (LAN page): average, rate, status in words, kg to go, ETA months, method note, opens the weight sheet', () => {
  const { host } = run({ settings: settingsStub(75) });
  const h = host.innerHTML, t = text(h);
  assert.match(h, /data-detail="weight"/);
  assert.match(h, /aria-label="See the weight history"/);
  assert.match(t, /7-day average last weigh-in: Sun 10 Feb/);
  assert.match(h, /<b class="pg-kg">78\.0<\/b>/);
  assert.match(t, /-0\.35 kg\/wk rate over the last 28 days/);
  assert.match(h, /class="pg-status pg-s-good"/);
  assert.match(t, /On pace Between 0\.25 and 0\.50 kg a week towards your goal/);
  assert.match(t, /Target weight: 75\.0 kg · 3\.0 kg to lose/);
  assert.match(t, /Estimated arrival at your current rate \(±20 %\): between March 2030 and April 2030\./, '3 kg ÷ 0.35 kg/week = 8.6 weeks ±20 %');
  assert.match(t, /mixes scales: a trend, not an exact number/);
  assert.doesNotMatch(h, /NaN|undefined|null/);
});

test('without the settings API (artifact, example build): no target, no ETA, no hint; the status still reads vs the goal', () => {
  const { host } = run();
  const t = text(host.innerHTML);
  assert.match(t, /On pace/);
  assert.doesNotMatch(t, /Target weight|Estimated arrival|Add a target/);
  const ready = text(run({ settings: settingsStub(null) }).host.innerHTML);
  assert.match(ready, /Add a target weight in your profile\./);
});

test('statuses: the wrong way and faster than safe say so plainly; maintain drifts; a target on the other side is flagged', () => {
  assert.match(text(run({ goal: 'bulk' }).host.innerHTML), /Moving the wrong way Your average is going down and your goal is to gain\./);
  const fast = PROGRESS_CASES[0].metric.roll.map((v, i) => (v == null ? null : Math.round((90 - i * 0.12) * 10) / 10));
  const f = text(run({ weight: { ...CUT, v: fast, roll: fast } }).host.innerHTML);
  assert.match(f, /Too fast More than 0\.50 kg a week or more than 1 % of your weight a week: that risks muscle\./);
  assert.match(text(run({ goal: 'maintain' }).host.innerHTML), /Going down Down more than 0\.10 kg a week while the goal is to maintain/);
  assert.match(text(run({ goal: 'bulk', weight: { ...CUT, v: CUT.roll.map((v) => (v == null ? null : 160 - v)), roll: CUT.roll.map((v) => (v == null ? null : 160 - v)) } }).host.innerHTML), /Too fast More than 0\.25 kg a week: at that pace it is mostly fat\./, 'muscle gain band 0.1–0.25');
  const mis = run({ settings: settingsStub(83) }).host.innerHTML;
  assert.match(text(mis), /Your target weight is above your average and your goal is to lose/);
  assert.doesNotMatch(text(mis), /Estimated arrival/);
  assert.match(text(run({ settings: settingsStub(78.3) }).host.innerHTML), /Target reached/);
});

test('few readings and stale weigh-ins: no rate claimed, no ETA', () => {
  const few = PROGRESS_CASES.find((c) => c.name === 'few readings').metric;
  const t = text(run({ weight: few, today: '2030-01-10', settings: settingsStub(75) }).host.innerHTML);
  assert.match(t, /Too few data Too few data for a rate: it needs 8 averages over at least 21 days \(there are 9\)\./);
  assert.doesNotMatch(t, /kg\/wk|Estimated arrival/);
  const old = text(run({ today: '2030-03-10', settings: settingsStub(75) }).host.innerHTML);
  assert.match(old, /No weigh-in since Sun 10 Feb: the rate is not up to date\./);
  assert.doesNotMatch(old, /On pace|Estimated arrival/);
});

test('no weigh-ins: a one-line empty state, no opener; a broken series renders the block\'s fallback', () => {
  const none = run({ weight: null }).host.innerHTML;
  assert.match(none, /No weigh-ins yet\./);
  assert.doesNotMatch(none, /data-detail/);
  const broken = { asOf: '2030-02-10', sessions: [], get metrics() { throw new Error('boom'); } };
  assert.match(run({ detail: broken }).host.innerHTML, /This block could not be shown\./);
});

test('es: decimal comma and Spanish copy; the profile line', () => {
  const { host, P } = run({ locale: 'es', settings: settingsStub(75) });
  const t = text(host.innerHTML);
  assert.match(t, /media de 7 días/);
  assert.match(t, /-0,35 kg\/sem/);
  assert.match(t, /A buen ritmo/);
  assert.match(t, /Peso objetivo: 75,0 kg · faltan 3,0 kg por bajar/);
  assert.match(t, /Llegada estimada a tu ritmo actual \(±20 %\): entre marzo 2030 y abril 2030/);
  assert.equal(P.line(), '78,0 kg de media · -0,35 kg/sem · A buen ritmo');
  assert.equal(run({ weight: null }).P.line(), '');
  assert.equal(run({ today: '2030-03-10' }).P.line(), '78.0 kg average · no recent weigh-ins', 'a stale series claims no rate');
});

test('a settings change (the target weight saved) re-renders the block', () => {
  const st = settingsStub(null);
  const { host } = run({ settings: st });
  assert.doesNotMatch(text(host.innerHTML), /Target weight: 75/);
  st.targetWeight = () => 75;
  st.fns.forEach((fn) => fn({}));
  assert.match(text(host.innerHTML), /Target weight: 75\.0 kg/);
});
