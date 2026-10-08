/* Unit tests for lib/score/days.mjs — the per-day dial / monitor history behind Inicio's day stepping. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { daysFromInputs, DAY_HISTORY_DAYS } from './days.mjs';
import { recoveryFromInputs } from './recovery.mjs';
import { monitorFromInputs } from './monitor.mjs';
import { RECENT_DAYS } from './load.mjs';
import { addDays } from '../health/stats.mjs';

const ASOF = '2026-09-29';
const wig = (i) => ((i * 7) % 5) - 2;
// n days of overnight data ending ASOF; `skip` = dates with no row at all (any series)
function inputs(n = 140, skip = []) {
  const ds = Array.from({ length: n }, (_, i) => addDays(ASOF, i - (n - 1))).filter((d) => !skip.includes(d));
  return {
    hrv: ds.flatMap((d, i) => [0, 1, 2, 3].map(() => ({ date: d, value: 60 + wig(i) * 3 }))),
    rhr: ds.map((d, i) => ({ date: d, value: 50 + wig(i) })),
    sleep: ds.map((d, i) => ({ date: d, value: 7.2 + wig(i) * 0.3, bedtime: 23 + wig(i) * 0.1, waketime: 7 + wig(i) * 0.1 })),
    respiratory: ds.map((d, i) => ({ date: d, value: 14 + wig(i) * 0.2 })),
    wristTemp: ds.map((d, i) => ({ date: d, value: 35.5 + wig(i) * 0.05 })),
  };
}

test('bakes DAY_HISTORY_DAYS (= the load dial\'s RECENT_DAYS) days ending at the newest overnight date, oldest first', () => {
  assert.equal(DAY_HISTORY_DAYS, RECENT_DAYS);
  const h = daysFromInputs(inputs());
  assert.equal(h.to, ASOF);
  assert.equal(h.from, addDays(ASOF, -(DAY_HISTORY_DAYS - 1)));
  assert.equal(h.days.length, DAY_HISTORY_DAYS);
  assert.deepEqual(h.days.map((d) => d.date), Array.from({ length: DAY_HISTORY_DAYS }, (_, i) => addDays(h.from, i)));
});

test('the newest day reproduces today\'s bake exactly: the same recovery night, % and the same monitor cards', () => {
  const I = inputs();
  const last = daysFromInputs(I).days.at(-1);
  const R = recoveryFromInputs({ hrv: I.hrv, rhr: I.rhr, sleep: I.sleep });
  assert.equal(R.today.date, ASOF);
  assert.deepEqual(last.rec, { value: R.today.value, band: R.today.band, sleep: true, pct: R.today.pct, pctBand: R.today.pctBand });
  const sd = R.components.find((c) => c.key === 'sleepDur').daily.at(-1);
  assert.equal(last.sleep, sd.value);
  const M = monitorFromInputs({ ...I, sleep: I.sleep.map((s) => ({ date: s.date, value: s.value })) });
  const hrv = M.cards.find((c) => c.key === 'hrv');
  assert.deepEqual(last.monitor.hrv, { value: hrv.value, dec: hrv.dec, status: hrv.status, tone: hrv.tone, date: hrv.date });
  assert.equal(last.monitor.total, 5);
  assert.equal(last.monitor.inR + last.monitor.out, M.cards.filter((c) => c.status === 'normal' || c.status === 'high' || c.status === 'low').length);
});

test('a past day is scored with the inputs cut at that day: later rows never leak into it', () => {
  const I = inputs();
  const t = addDays(ASOF, -5);
  const day = daysFromInputs(I).days.find((d) => d.date === t);
  const cut = (rows) => rows.filter((r) => r.date <= t);
  const R = recoveryFromInputs({ hrv: cut(I.hrv), rhr: cut(I.rhr), sleep: cut(I.sleep) });
  assert.equal(day.rec.value, R.today.value);
  assert.equal(day.rec.pct, R.today.pct);
  // a huge outlier after t changes nothing on t
  const spiked = { ...I, rhr: I.rhr.map((r) => (r.date > t ? { ...r, value: 99 } : r)) };
  assert.deepEqual(daysFromInputs(spiked).days.find((d) => d.date === t), day);
});

test('a day without its own night: no recovery, no sleep (never an older night under its date); the monitor greys by its own dates', () => {
  const gap = addDays(ASOF, -3);
  const day = daysFromInputs(inputs(140, [gap])).days.find((d) => d.date === gap);
  assert.equal(day.rec, null);
  assert.equal(day.sleep, null);
  // the cards' newest values are a day old: still fresh (<= 3 days), so they still count
  assert.ok(day.monitor.inR + day.monitor.out > 0);
  assert.equal(day.monitor.hrv.date, addDays(gap, -1));
});

test('too little history: the recovery entry says gated, sleep follows the dial (none while gated)', () => {
  const h = daysFromInputs(inputs(20));
  assert.equal(h.days[0].rec, 'gated');
  assert.equal(h.days[0].sleep, null);
});

test('no overnight data: null', () => {
  assert.equal(daysFromInputs({}), null);
  assert.equal(daysFromInputs({ hrv: [], rhr: null }), null);
});
