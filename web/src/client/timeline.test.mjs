/* Tests for Inicio's "today" timeline renderer (web/src/client/timeline.js): runs the classic script
 * in a vm with baked SCORES/I18N_SCORE/LOCALE globals and a controllable clock. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { timelineFromInputs } from '../../../lib/score/timeline.mjs';
import { detailFromInputs } from '../../../lib/detail/detail.mjs';
import { es as esT, en as enT } from '../i18n/score-templates.mjs';
import { loadUtil } from '../../test/client-util.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const source = fs.readFileSync(path.join(here, 'timeline.js'), 'utf8');
const ASOF = '2026-09-29';

const w = (date, type, dur, re = null) => ({ date, type, dur, hrAvg: null, re, kj: null });
const TL = timelineFromInputs(
  [w('2026-09-28', 'TraditionalStrengthTraining', 55, 40), w('2026-09-29', 'Running', 45.4, 94), w('2026-09-29', 'Cycling', 30, null)],
  [{ date: '2026-09-28', value: 7.1 }, { date: '2026-09-29', value: 6.86 }],
);

function render(timeline, { locale = 'en', now = ASOF, at, healthNav = false, entrenoNav = false, T, noLocale = false, detail = false, program = null, day = null } = {}) {
  const host = { innerHTML: '' };
  const RealDate = Date;
  const stamp = at || now + 'T12:00:00';
  class FakeDate extends RealDate {
    constructor(...a) { super(...(a.length ? a : [stamp])); }
    static now() { return new RealDate(stamp).getTime(); }
  }
  const byId = { timeline: host, 't-health': healthNav ? {} : null, 't-entreno': entrenoNav ? {} : null };
  const ctx = {
    document: { getElementById: (id) => byId[id] || null },
    SCORES: timeline === undefined ? undefined : { timeline }, I18N_SCORE: T || (locale === 'es' ? esT : enT), ...(noLocale ? {} : { LOCALE: locale }),
    Date: FakeDate, Math, String, Number, Array, Object, JSON,
  };
  if (detail) ctx.DETAIL = detail === true ? { metrics: {} } : detail;
  if (day) ctx.HCDay = day;
  ctx.window = program ? { HCProgram: program } : {};
  vm.createContext(ctx);
  loadUtil(ctx);
  vm.runInContext(source, ctx);
  return host.innerHTML;
}
const rows = (html) => [...html.matchAll(/<li class="tl-row ([^"]+)"[^>]*>([\s\S]*?)<\/li>/g)].map((m) => ({ cls: m[1], text: m[2].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() }));

test('viewer today: "Today\'s activities" heading, last night\'s sleep first, then each workout: a coloured chip (icon + value), the name, the details stacked on the right', () => {
  const html = render(TL);
  assert.equal(enT.timeline.heading, 'Today\'s activities');
  assert.ok(html.includes(`<h3>${enT.timeline.heading}</h3>`));
  assert.deepEqual(rows(html), [
    { cls: 'tl-sleep', text: '6.9 h Sleep' },
    { cls: 'tl-run', text: '45 min Run RE 94' },
    { cls: 'tl-bike', text: '30 min Bike' },
  ]);
  const sleep = html.match(/<li class="tl-row tl-sleep"[\s\S]*?<\/li>/)[0];
  assert.match(sleep, /<span class="tl-chip"><svg class="tl-ico"[^>]*aria-hidden="true">[\s\S]*?<\/svg><b>6\.9 h<\/b><\/span><span class="tl-name">Sleep<\/span>/);
  assert.match(html, /<li class="tl-row tl-run"[^>]*><span class="tl-chip">[\s\S]*?<\/span><span class="tl-name">Run<\/span><span class="tl-side"><span>RE 94<\/span><\/span>/);
  assert.doesNotMatch(html, /NaN|undefined|<script|src=|href=/);
});

test('today not in the data: the newest earlier day, labelled by its date, and "nothing logged yet today"', () => {
  const html = render(TL, { now: '2026-09-30' });
  assert.ok(html.includes(enT.timeline.dateHeading.replace('{date}', 'Tue 29 Sep')));
  assert.ok(html.includes(enT.timeline.noToday));
  assert.equal(rows(html).length, 3);
  const earlier = render(TL, { now: '2026-09-28' });
  assert.ok(earlier.includes(`<h3>${enT.timeline.heading}</h3>`), 'viewer a day behind the data: their today is the 28th');
  assert.deepEqual(rows(earlier).map((r) => r.cls), ['tl-sleep', 'tl-gym']);
});

test('clock edge: 23:59 is still that day, 00:01 is the next one (local calendar)', () => {
  assert.ok(render(TL, { at: '2026-09-29T23:59:00' }).includes(`<h3>${enT.timeline.heading}</h3>`));
  const after = render(TL, { at: '2026-09-30T00:01:00' });
  assert.ok(after.includes(enT.timeline.dateHeading.replace('{date}', 'Tue 29 Sep')));
  assert.ok(after.includes(enT.timeline.noToday));
  const behind = render(TL, { at: '2026-09-28T00:01:00' });
  assert.deepEqual(rows(behind).map((r) => r.cls), ['tl-sleep', 'tl-gym'], 'just after midnight on the 28th: the 28th');
});

test('clock skew: the viewer\'s today EARLIER than every baked day -> the newest baked day under its date, never the empty state', () => {
  const html = render(TL, { now: '2026-09-20' });
  assert.ok(html.includes(enT.timeline.dateHeading.replace('{date}', 'Tue 29 Sep')), 'labelled by its date');
  assert.ok(!html.includes(enT.timeline.empty), 'not the empty state');
  assert.ok(!html.includes(enT.timeline.noToday), 'no "nothing logged yet today": the day is ahead of the viewer\'s clock');
  assert.equal(rows(html).length, 3);
  assert.doesNotMatch(html, /sc-stale/, 'a day ahead of the clock is not stale');
  const midnight = render(TL, { at: '2026-09-27T23:59:00' });
  assert.ok(midnight.includes(enT.timeline.dateHeading.replace('{date}', 'Tue 29 Sep')), '23:59 the day before the window: same fallback');
});

test('a day without a sleep reading says so, never 0 h', () => {
  const tl = timelineFromInputs([w(ASOF, 'Running', 40, 50)], null);
  const r = rows(render(tl));
  assert.deepEqual(r[0], { cls: 'tl-sleep tl-none', text: '— ' + enT.timeline.noSleep });
});

test('stale data (> 3 days old) is greyed; exactly 3 days is not', () => {
  assert.match(render(TL, { now: '2026-10-03' }), /class="sc-card tl sc-stale"/);
  assert.doesNotMatch(render(TL, { now: '2026-10-02' }), /sc-stale/);
});

test('empty state: no baked days, or no timeline at all', () => {
  assert.ok(render({ asOf: null, days: [] }).includes(enT.timeline.empty));
  assert.doesNotThrow(() => render(undefined));
});

test('es: decimal comma, Spanish labels, merged parts counted', () => {
  const tl = timelineFromInputs([w(ASOF, 'HighIntensityIntervalTraining', 30), w(ASOF, 'TraditionalStrengthTraining', 25, 20)], [{ date: ASOF, value: 7.25 }]);
  const r = rows(render(tl, { locale: 'es' }));
  assert.deepEqual(r, [
    { cls: 'tl-sleep', text: '7,3 h Sueño' },
    { cls: 'tl-gym', text: '55 min Gimnasio Esf. 20 2 partes' },
  ]);
});

test('rows open the detail sheet on that day: sleep -> the sleep view, a scored modality -> its load view, other -> training time', () => {
  const linked = render(TL, { detail: true });
  assert.match(linked, /<li class="tl-row tl-sleep" data-detail="sleep" data-date="2026-09-29" role="button" tabindex="0" aria-haspopup="dialog">/);
  assert.match(linked, /<li class="tl-row tl-run" data-detail="load-run" data-date="2026-09-29" role="button"/);
  assert.match(linked, /<li class="tl-row tl-bike" data-detail="load-bike" data-date="2026-09-29" role="button"/);
  const other = render(timelineFromInputs([w('2026-09-29', 'Walking', 40)], []), { detail: true });
  assert.match(other, /<li class="tl-row tl-other" data-detail="workouts" data-date="2026-09-29"/);
  assert.doesNotMatch(linked, /jumpOr|onclick/);
  assert.doesNotMatch(render(TL), /data-detail/, 'no detail sheet baked: plain rows');
});

test('resilience: a missing LOCALE global renders the card fallback inside the try, never throws', () => {
  let html;
  assert.doesNotThrow(() => { html = render(TL, { noLocale: true }); });
  assert.match(html, /sc-card-error/);
});

test('resilience: a broken baked day renders the card fallback, never throws', () => {
  const html = render({ asOf: ASOF, days: [{ date: ASOF, sleep: 7, items: 'broken' }] });
  assert.match(html, /sc-card-error|tl/);
});

test('sleep row: bedtime and wake time stacked on the right (24 h clock), from the baked night', () => {
  const tl = timelineFromInputs([], [{ date: ASOF, value: 7.5, bedtime: 23.1166, waketime: 6.75 }]);
  const html = render(tl);
  assert.match(html, /<span class="tl-side tl-times"><span>23:07<\/span><span>06:45<\/span><\/span>/);
  const early = render(timelineFromInputs([], [{ date: ASOF, value: 7, bedtime: 24.5, waketime: 7.999 }]));
  assert.match(early, /<span>00:30<\/span><span>08:00<\/span>/, 'past-midnight bedtimes wrap; minutes round');
});

test('programmed session (window.HCProgram, client/training-today.js): a "programmed" row after the done rows, opening the session view; only on the viewer\'s today', () => {
  const prog = { date: ASOF, kind: 'run', focus: 'Tempo <6x1k>' };
  const html = render(TL, { program: prog, detail: true });
  const r = rows(html);
  assert.equal(r.length, 4);
  assert.deepEqual(r[3], { cls: 'tl-prog tl-prog-run', text: `${enT.timeline.programmedChip} Tempo &lt;6x1k&gt; ${enT.timeline.programmed}` });
  assert.match(html, /<li class="tl-row tl-prog tl-prog-run" data-detail="hoy-session" role="button"/);
  assert.doesNotMatch(html, /<6x1k>/, 'untrusted focus text is escaped');
  // another day's program, or the viewer looking at an older day: no row
  assert.equal(rows(render(TL, { program: { ...prog, date: '2026-09-28' } })).length, 3);
  assert.equal(rows(render(TL, { program: prog, now: '2026-09-30' })).filter((x) => x.cls.startsWith('tl-prog')).length, 0);
  // nothing baked yet but a session programmed today: the card lists it instead of the empty state
  const only = render({ asOf: null, days: [] }, { program: prog });
  assert.equal(rows(only).length, 1);
  assert.ok(!only.includes(enT.timeline.empty));
});

test('text diet: the same-day merge note lives in the card\'s ⓘ block (hidden, aria-expanded), not as a visible footnote', () => {
  const html = render(TL);
  assert.match(html, /<div class="sc-head"><h3>[^<]+<\/h3><button type="button" class="hs-i" data-hs-info="tl-info" aria-expanded="false" aria-controls="tl-info"/);
  assert.ok(html.includes(`<div class="hs-info" id="tl-info" hidden><p>${enT.timeline.note}</p></div>`));
  assert.doesNotMatch(html, /<div class="sc-note">Same-day/);
  // no workouts that day: no note, no ⓘ
  const sleepOnly = render(timelineFromInputs([], [{ date: ASOF, value: 7 }]));
  assert.doesNotMatch(sleepOnly, /tl-info/);
});

test('the programmed row keeps its long focus whole for assistive tech (aria-label) while the name ellipsises', () => {
  const focus = 'Lower body strength + threshold intervals on the bike, then core';
  const html = render(TL, { program: { date: ASOF, kind: 'gym', focus }, detail: true });
  const row = html.match(/<li class="tl-row tl-prog[^>]*>/)[0];
  assert.ok(row.includes(` aria-label="${enT.timeline.programmedChip}: ${focus} · ${enT.timeline.programmed}"`), row);
});

/* ---- day stepping (the top bar's ‹ TODAY ›): "My day" lists the selected day from DETAIL ---- */
const SL = [
  { date: '2026-09-26', value: 7.4, bedtime: 23.5, waketime: 7 },
  { date: '2026-09-28', value: 7.1, bedtime: 23.25, waketime: 6.5 },
  { date: '2026-09-29', value: 6.86, bedtime: 0.2, waketime: 7.1 },
];
const WO = [
  w('2026-09-28', 'TraditionalStrengthTraining', 30, 25), w('2026-09-28', 'TraditionalStrengthTraining', 25, 15),
  w('2026-09-28', 'Running', 40, 60), w('2026-09-29', 'Running', 45.4, 94),
].map((r) => ({ ...r, source: 'Strava API' }));
const DET = detailFromInputs({ sleep: SL, workouts: WO });
const TL2 = timelineFromInputs(WO, SL);
function stepper(sel) {
  const subs = [];
  return { sel: () => sel, on: (fn) => subs.push(fn), go: (x) => { sel = x; subs.forEach((fn) => fn(x)); } };
}

test('day stepping: today selected renders byte-identically', () => {
  assert.equal(render(TL2, { detail: DET, day: stepper(null) }), render(TL2, { detail: DET }));
});

test('day stepping: a past day lists THAT day from DETAIL — the same rows SCORES.timeline gives for it — dated, never greyed, no plan row', () => {
  const html = render(TL2, { detail: DET, day: stepper('2026-09-28'), program: { date: ASOF, kind: 'gym', focus: 'Legs' } });
  assert.ok(html.includes('<h3>Activities · Mon 28 Sep</h3>'));
  // the timeline's own rendering of 2026-09-28 (viewer on that day, before 09-29 existed)
  const ref = render(timelineFromInputs(WO.filter((r) => r.date <= '2026-09-28'), SL.filter((r) => r.date <= '2026-09-28')), { detail: DET, now: '2026-09-28' });
  assert.deepEqual(rows(html), rows(ref));
  assert.deepEqual(rows(html).map((r) => r.cls), ['tl-sleep', 'tl-gym', 'tl-run']);
  assert.match(rows(html)[1].text, /55 min.*RE 40.*2 parts/);
  assert.match(html, /data-detail="load-run" data-date="2026-09-28"/);
  assert.doesNotMatch(html, /sc-stale|tl-prog|Nothing logged yet today/);
});

test('day stepping: a night without workouts, a day with nothing, and a change back to today', () => {
  const day = stepper('2026-09-26');
  const host = render(TL2, { detail: DET, day });
  assert.deepEqual(rows(host).map((r) => r.cls), ['tl-sleep']);
  assert.match(rows(host)[0].text, /7.4 h.*23:30.*07:00/);
  const none = render(TL2, { detail: DET, day: stepper('2026-09-27') });
  assert.ok(none.includes(enT.timeline.noDay));
  assert.doesNotMatch(none, /tl-row/);
  const es = render(TL2, { locale: 'es', detail: DET, day: stepper('2026-09-27') });
  assert.ok(es.includes('<h3>Actividades · dom 27 sept</h3>'));
});
