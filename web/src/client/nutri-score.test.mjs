/* web/src/client/nutri-score.js — the nutrition score (Inicio card + Nutrición block). Runs the real
 * classic script in node:vm against web/test/dom-stub.mjs with a fixed clock, a baked INTAKE.log
 * (SYNTHETIC days), a stand-in HCNutri.targetFor and, optionally, a LAN HCAdherence summary; the port
 * is pinned against lib/nutrition/score.mjs. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { StubDocument } from '../../test/dom-stub.mjs';
import { loadUtil } from '../../test/client-util.mjs';
import { es as esN, en as enN } from '../i18n/nutri-templates.mjs';
import { es as esS, en as enS } from '../i18n/score-templates.mjs';
import { NSCORE, NSCORE_CASES, nutritionScore, scoreSeries } from '../../../lib/nutrition/score.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const source = fs.readFileSync(path.join(here, 'nutri-score.js'), 'utf8');
const TODAY = '2030-01-28';
const text = (html) => String(html).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
const G3 = { breakfast: 1, lunch: 1, dinner: 1 };
const day = (date, k, p, f, o = {}) => ({ date, k, p, f, n: 3, missing: { p: false, f: false }, groups: G3, ...o });
const TG = { k: 2000, p: 150, g: 70 };

// clock.iso = the viewer's day (a test may move it past midnight)
function fixedDate(clock) {
  const RealDate = Date;
  return class extends RealDate {
    constructor(...a) { if (a.length) super(...a); else super(clock.iso + 'T12:00:00'); }
    static now() { return new RealDate(clock.iso + 'T12:00:00').getTime(); }
  };
}
function setup({ log = [], live = null, targetFor, locale = 'en', sel = null, home = true, nutri = true, clock = { iso: TODAY } } = {}) {
  const doc = new StubDocument();
  const els = {};
  if (home) els.home = doc.el('home-nscore', { hidden: true });
  if (nutri) {
    els.block = doc.el('nutri-score-block', { hidden: true });
    els.host = doc.el('nutri-score');
    els.info = doc.el('nutri-score-info');
  }
  const listeners = [];
  const window = { HCNutri: { targetFor: targetFor || (() => TG) } };
  if (live) window.HCAdherence = { state: () => ({ days: live }) };
  const ctx = {
    document: doc, window, LOCALE: locale, NUTRI: { score: NSCORE }, I18N_NUTRI: locale === 'es' ? esN : enN,
    I18N_SCORE: locale === 'es' ? esS : enS, INTAKE: { log: { asOf: null, days: log } },
    HCDay: { sel: () => sel, on: (fn) => listeners.push(fn) },
    DETAIL: { metrics: {} }, Date: fixedDate(clock), Math, JSON, Number, String, Object, Array, isFinite,
  };
  vm.createContext(ctx);
  loadUtil(ctx);
  vm.runInContext(source, ctx);
  return { els, window, S: window.HCNutriScore, step: (d) => { sel = d; listeners.forEach((f) => f()); } };
}
const plain = (x) => JSON.parse(JSON.stringify(x));

test('parity: the port scores exactly what lib/nutrition/score.mjs scores', () => {
  const { S } = setup({ home: false, nutri: false });
  for (const c of NSCORE_CASES) assert.deepEqual(plain(S.nutritionScore(c.day, c.target, { today: c.today })), plain(c.expect), c.name);
  const dates = ['2030-01-04', '2030-01-05', '2030-01-06', '2030-01-07', '2030-01-08', '2030-01-09', '2030-01-10', '2030-01-11'];
  const days = [day('2030-01-04', 2000, 150, 70), day('2030-01-06', 2500, 105, 94.5), day('2030-01-09', 2900, 60, 120, { missing: { p: true, f: false } }), day('2030-01-11', 900, 40, 20)];
  const targets = Object.fromEntries(dates.map((d) => [d, d === '2030-01-08' ? null : TG]));
  assert.deepEqual(plain(S.scoreSeries(dates, days, targets, '2030-01-11')), plain(scoreSeries(dates, days, targets, '2030-01-11')));
  for (const k of [1500, 1799.9, 2200, 2200.1, 2699]) assert.deepEqual(plain(S.nutritionScore(day('x', k, 100, 50), TG, {})), plain(nutritionScore(day('x', k, 100, 50), TG, {})));
});

test('no food log at all: the Nutrición block stays hidden and the metric is null', () => {
  const { els, S } = setup();
  assert.equal(els.block.hidden, true);
  assert.equal(els.host.innerHTML, '');
  assert.equal(S.metric(), null);
});

test('Nutrición: with today being logged the headline is today\'s progress alone (kcal % of target, neutral); yesterday\'s closed score moves to the footer line with the 7 / 30-day averages; formula behind ⓘ', () => {
  const { els } = setup({
    log: [day('2030-01-27', 2000, 150, 70), day('2030-01-26', 2500, 105, 94.5), day('2030-01-10', 2000, 150, 70), day(TODAY, 1500, 120, 60)],
  });
  assert.equal(els.block.hidden, false);
  const h = els.host.innerHTML;
  assert.match(h, /class="sc-card tn en ns" /, 'no band colour: today has no score yet');
  assert.match(h, /<div class="tn-end ns-now"><span class="tn-time"><b class="en-num">75<small>%<\/small><\/b><\/span><span class="tn-lbl">Kcal today<\/span><\/div>/, 'the headline = today\'s kcal eaten / target (1,500 / 2,000)');
  assert.match(h, /data-detail="nutrition"/);
  assert.doesNotMatch(h, /data-date=/, 'with today in progress it opens the sheet on its newest day');
  assert.match(h, /<h3 class="tn-h">Nutrition · in progress<\/h3>/, 'one caps title in one weight, no smaller tag inside');
  assert.doesNotMatch(h, /ns-run-lbl|de-hi|de-mid|de-lo/, 'no second "Today · in progress" line, no band');
  assert.match(text(h), /Kcal 1,500 \/ 2,000 kcal/, 'today: eaten / target only');
  assert.match(text(h), /Protein 120 \/ 150 g/);
  assert.match(text(h), /Fat 60 \/ 70 g/);
  assert.doesNotMatch(text(h), /· \d+ |pts|66/, 'no points and no partial score for today');
  assert.match(h, /<li class="nt-mac ns-run">[\s\S]*?<i style="width:75%"><\/i>/, 'the bar = progress toward the target (1,500 / 2,000), not points');
  assert.match(text(h), /Yesterday 100% · 7-day average 73% · 30-day 82%/, 'yesterday in the footer; 7 days: 100 + 46; 30 days: + 100 (today never counts)');
  // the 30-day line is the Salud sparkline: line + area down to the 0 baseline, a caption under it
  const sp = h.match(/<div class="sc-spark ns-spark"><svg class="spark" viewBox="0 0 200 48"[^>]*><path class="area" d="(M[^"]+)"\/><path class="line" d="(M[^"]+)"\/><\/svg><div class="sc-spark-lbl">Each day's score, last 30 days \(0–100\)<\/div><\/div>/);
  assert.ok(sp, 'anchored sparkline + caption');
  assert.ok(sp[1].startsWith(sp[2]) && / 48 L[\d.]+ 48 Z$/.test(sp[1]), 'the area is the line closed down to the baseline');
  assert.match(text(els.info.innerHTML), /kcal × 0\.4 \+ protein × 0\.4 \+ fat × 0\.2/);
  assert.match(text(els.info.innerHTML), /within ±10% .* 0 at ±35%/);
  assert.match(text(els.info.innerHTML), /100 from 90% .* 0 at 50%/);
});

test('missing macros: the component reads "not logged", the card is flagged incomplete', () => {
  const { els } = setup({ log: [day('2030-01-27', 2000, 100, 5, { missing: { p: true, f: true } })] });
  const t = text(els.host.innerHTML);
  assert.match(t, /Nutrition · incomplete/);
  assert.match(t, /Protein not logged/);
  assert.match(t, /Fat not logged/);
  assert.match(els.host.innerHTML, /<b class="en-num">100<small>%<\/small><\/b>/, 'kcal alone, on target');
  assert.match(els.host.innerHTML, /data-date="2030-01-27"/, 'a past day opens the sheet on it');
});

test('a day with no target (unknown day type) or no log has no score; a stale log shows no card', () => {
  const nt = setup({ log: [day('2030-01-27', 2000, 150, 70)], targetFor: () => null });
  assert.match(text(nt.els.host.innerHTML), /No recent score/);
  assert.equal(nt.S.metric(), null);
  const stale = setup({ log: [day('2030-01-10', 2000, 150, 70)] });
  assert.match(text(stale.els.host.innerHTML), /No recent score/);
  assert.match(text(stale.els.host.innerHTML), /30-day 100%/);
});

test('LAN: the live summary replaces the baked day, refresh() re-scores', () => {
  const live = [{ date: TODAY, k: 2000, p: 150, c: 200, f: 70, n: 4, missing: { p: false, c: false, f: false }, groups: { breakfast: 1, lunch: 1, dinner: 1, addon: 1 } }];
  const t = setup({ log: [day(TODAY, 800, 30, 10)], live });
  assert.match(text(t.els.host.innerHTML), /Kcal 2,000 \/ 2,000 kcal/, 'the live day, not the baked 800');
  t.window.HCAdherence = { state: () => ({ days: [{ ...live[0], k: 1500, p: 120, f: 60 }] }) };
  t.S.refresh();
  assert.match(text(t.els.host.innerHTML), /Kcal 1,500 \/ 2,000 kcal/);
  assert.equal(t.S.metric().days[TODAY].score, 66, 're-scored (kept for the day panel), just not shown while in progress');
});

test('metric(): the sheet\'s series — one value per day of the last 90 ending today, days = per-day results', () => {
  const { S } = setup({ log: [day('2030-01-27', 2000, 150, 70), day(TODAY, 1500, 120, 60)] });
  const m = S.metric();
  assert.equal(m.kind, 'nscore');
  assert.equal(m.dir, 1);
  assert.equal(m.v.length, NSCORE.days);
  assert.equal(m.start, '2029-10-31');
  assert.equal(m.v[m.v.length - 2], 100);
  assert.equal(m.v[m.v.length - 1], null, 'today (in progress) has no point on the chart');
  assert.equal(m.days[TODAY].partial, true);
  assert.equal(m.days[TODAY].score, 66, 'the math is unchanged (lib/nutrition/score.mjs)');
  assert.deepEqual(plain(m.bands), { good: 85, mid: 60 });
});

test('Spanish copy', () => {
  const { els } = setup({ locale: 'es', log: [day('2030-01-27', 2000, 150, 70)] });
  assert.match(text(els.host.innerHTML), /Proteína · 100 pts/, 'a closed day\'s points, labelled');
  assert.match(text(els.host.innerHTML), /100 % Ayer/);
  assert.match(text(els.host.innerHTML), /Media 7 días 100%/);
});

test('Inicio card (the owner\'s real case: today logged, yesterday closed at 56): today\'s progress heads it alone, neutral; "Yesterday 56% · 7-day average" is the footer; the aria names both', () => {
  // 2,700 kcal on a 2,000 target, protein 105 / 150, fat 105 / 70 = a closed 56
  const { els } = setup({ nutri: false, log: [day('2030-01-27', 2600, 105, 95), day(TODAY, 433, 30, 17)] });
  assert.equal(els.home.hidden, false);
  const h = els.home.innerHTML;
  const y = setup({ home: false, nutri: false, log: [day('2030-01-27', 2600, 105, 95)] }).S.metric().days['2030-01-27'].score;
  assert.ok(y < 60, 'a low (red) closed day: ' + y);
  assert.match(h, /class="sc-card tn en ns" data-detail="nutrition" role="button"/, 'no red band on today\'s card');
  assert.match(text(h), /^Nutrition · in progress 22 % Kcal today Kcal 433 \/ 2,000 kcal/);
  assert.match(text(h), new RegExp(`Yesterday ${y}% · 7-day average ${y}%$`), 'yesterday\'s score in the footer line');
  assert.match(h, new RegExp(`aria-label="Nutrition today: in progress, 22% of the kcal target, no score yet · Yesterday: nutrition score ${y}%"`));
  const es = setup({ locale: 'es', nutri: false, log: [day('2030-01-27', 2600, 105, 95), day(TODAY, 433, 30, 17)] });
  assert.match(text(es.els.home.innerHTML), new RegExp(`Ayer ${y}% · Media de 7 días ${y}%$`));
  assert.match(es.els.home.innerHTML, new RegExp(`aria-label="Nutrición hoy: en curso, 22% de las kcal objetivo, aún sin puntuación · Ayer: puntuación de nutrición ${y}%"`));
  assert.doesNotMatch(es.els.home.innerHTML, / el Ayer/, 'never "56% el Ayer"');
});

test('Inicio card: nothing logged today -> the newest scored day while fresh, with its date; stale or no log -> hidden', () => {
  const y = setup({ nutri: false, log: [day('2030-01-26', 2000, 150, 70)] });
  assert.equal(y.els.home.hidden, false);
  assert.match(y.els.home.innerHTML, /data-date="2030-01-26"/);
  assert.doesNotMatch(text(y.els.home.innerHTML), /in progress/);
  assert.match(text(y.els.home.innerHTML), /Kcal · 100 pts/, 'a closed day\'s rows carry their points');
  const stale = setup({ nutri: false, log: [day('2030-01-10', 2000, 150, 70)] });
  assert.equal(stale.els.home.hidden, true);
  assert.equal(stale.els.home.innerHTML, '');
  assert.equal(setup({ nutri: false }).els.home.hidden, true);
});

test('Inicio card: day stepping shows that day\'s final score (no average) or hides on a day without a log', () => {
  const t = setup({ nutri: false, log: [day('2030-01-20', 2500, 105, 94.5), day(TODAY, 1500, 120, 60)] });
  t.step('2030-01-20');
  assert.equal(t.els.home.hidden, false);
  assert.match(t.els.home.innerHTML, /data-detail="nutrition" data-date="2030-01-20"/);
  assert.match(t.els.home.innerHTML, /<b class="en-num">46</);
  assert.doesNotMatch(text(t.els.home.innerHTML), /7-day average|in progress/);
  assert.match(text(t.els.home.innerHTML), /Kcal · \d+ pts/);
  t.step('2030-01-21');
  assert.equal(t.els.home.hidden, true);
  t.step(null);
  assert.match(text(t.els.home.innerHTML), /^Nutrition · in progress 75 % Kcal today Kcal 1,500 \/ 2,000 kcal/, 'no closed day fresh enough: today\'s progress only');
  assert.doesNotMatch(text(t.els.home.innerHTML), /Yesterday|average/, 'no closed day, no footer');
});

test('Inicio card: a day exactly 3 days old still shows (with its date), 4 days old hides', () => {
  const three = setup({ nutri: false, log: [day('2030-01-25', 2000, 150, 70)] });
  assert.equal(three.els.home.hidden, false);
  assert.match(text(three.els.home.innerHTML), /Fri 25 Jan/);
  assert.equal(setup({ nutri: false, log: [day('2030-01-24', 2000, 150, 70)] }).els.home.hidden, true);
});

test('midnight rollover: the cached series is per viewer day, so yesterday stops being "so far"', () => {
  const clock = { iso: TODAY };
  const t = setup({ nutri: false, clock, log: [day(TODAY, 1500, 120, 60)] });
  assert.equal(t.S.metric().days[TODAY].partial, true);
  clock.iso = '2030-01-29';
  const m = t.S.metric();
  assert.equal(m.days[TODAY].partial, false, 'a final score once the day is over');
  assert.equal(m.start, '2029-11-01');
  t.step(null);
  assert.doesNotMatch(text(t.els.home.innerHTML), /in progress/);
  assert.match(text(t.els.home.innerHTML), /66 % Yesterday/, 'after midnight the day closes and heads the card');
});

test('today in progress only: no score, no red %, no "· N" points — the progress and "in progress"', () => {
  const { els } = setup({ log: [day(TODAY, 433, 30, 17)] });
  const h = els.home.innerHTML;
  assert.equal(els.home.hidden, false);
  assert.match(h, /<h3 class="tn-h">Nutrition · in progress<\/h3>/);
  assert.doesNotMatch(h, /de-lo|de-mid|de-hi/, 'no score, no band colour');
  assert.doesNotMatch(text(h), /· 0|pts|0 %/, 'no bare "· 0" that reads like 0 kcal');
  assert.match(text(h), /22 % Kcal today Kcal 433 \/ 2,000 kcal Protein 30 \/ 150 g Fat 17 \/ 70 g/);
  assert.match(h, /aria-label="Nutrition today: in progress, 22% of the kcal target, no score yet"/);
  // kcal not logged today: no headline number, the old words
  const nk = setup({ log: [day(TODAY, null, 30, 17)] });
  assert.doesNotMatch(nk.els.home.innerHTML, /ns-now/);
  assert.match(nk.els.home.innerHTML, /aria-label="Nutrition today: in progress, no score yet"/);
  const es = setup({ locale: 'es', log: [day(TODAY, 433, 30, 17)] });
  assert.match(es.els.home.innerHTML, /<h3 class="tn-h">Nutrición · en curso<\/h3>/);
});
