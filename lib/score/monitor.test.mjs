/* Health monitor (lib/score/monitor.mjs): latest value per overnight signal vs a personal band
 * (median +- 1.5 scaled MAD over the 42 days before that value). Synthetic series only. */
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { monitorFromInputs, monitorCard, buildMonitor, MONITOR_KEYS, BAND_K } from './monitor.mjs';
import { robustBaseline } from './recovery.mjs';

const addDays = (d, n) => { const t = new Date(d + 'T00:00:00Z'); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };
const AS_OF = '2026-09-29';
const wig = (i) => ((i * 7) % 5) - 2; // -2..2, deterministic
// `n` days ending at `asOf`; base value + wiggle * amp; the LAST value replaced by `last` when given
const series = ({ n = 43, base, amp, last, asOf = AS_OF }) => Array.from({ length: n }, (_, i) => ({
  date: addDays(asOf, i - (n - 1)),
  value: i === n - 1 && last != null ? last : base + wig(i) * amp,
}));

test('the five cards in a fixed order, and the band factor is 2 scaled MADs (~5% false flags per card)', () => {
  assert.deepEqual(MONITOR_KEYS, ['respiratory', 'rhr', 'hrv', 'wristTemp', 'sleep']);
  assert.equal(BAND_K, 2);
});

test('band = median +- 2 x scaled MAD over the 42 days BEFORE the latest value (the latest never sets its own band)', () => {
  const rows = series({ base: 50, amp: 1, last: 50 });
  const c = monitorCard('rhr', rows);
  const base = rows.slice(-43, -1).map((r) => r.value);
  const b = robustBaseline(base, 1);
  assert.equal(c.state, 'ok');
  assert.equal(c.n, 42);
  assert.equal(c.date, AS_OF);
  assert.equal(c.value, 50);
  assert.equal(c.band.median, Math.round(b.median * 10) / 10);
  assert.equal(c.band.lo, Math.round((b.median - 2 * b.mad) * 10) / 10);
  assert.equal(c.band.hi, Math.round((b.median + 2 * b.mad) * 10) / 10);
  assert.equal('unit' in c, false, 'display units come from the i18n dict only');
  assert.equal(c.status, 'normal');
  assert.equal(c.tone, 'normal');
});

test('HRV band is computed in log space (like recovery.mjs): asymmetric in ms, exp(median(ln) +- 2 MAD(ln))', () => {
  const rows = series({ base: 60, amp: 6, last: 60 });
  const c = monitorCard('hrv', rows);
  const b = robustBaseline(rows.slice(-43, -1).map((r) => Math.log(r.value)), 0.05);
  assert.equal(c.band.lo, Math.round(Math.exp(b.median - 2 * b.mad) * 10) / 10);
  assert.equal(c.band.hi, Math.round(Math.exp(b.median + 2 * b.mad) * 10) / 10);
  assert.ok(c.band.hi - c.band.median > c.band.median - c.band.lo, 'wider above than below in ms');
});

test('direction: HRV high = good / low = bad; resting HR high = bad / low = good; sleep short = bad', () => {
  assert.deepEqual(pick(monitorCard('hrv', series({ base: 60, amp: 2, last: 90 }))), { status: 'high', tone: 'good' });
  assert.deepEqual(pick(monitorCard('hrv', series({ base: 60, amp: 2, last: 35 }))), { status: 'low', tone: 'bad' });
  assert.deepEqual(pick(monitorCard('rhr', series({ base: 50, amp: 1, last: 60 }))), { status: 'high', tone: 'bad' });
  assert.deepEqual(pick(monitorCard('rhr', series({ base: 50, amp: 1, last: 42 }))), { status: 'low', tone: 'good' });
  assert.deepEqual(pick(monitorCard('sleep', series({ base: 7.5, amp: 0.2, last: 4.5 }))), { status: 'low', tone: 'bad' });
});

test('respiratory rate and wrist temperature are change signals: out of band either way is "watch", never good/bad', () => {
  for (const last of [20, 10]) assert.equal(monitorCard('respiratory', series({ base: 14.5, amp: 0.2, last })).tone, 'watch');
  for (const last of [37.2, 35.2]) assert.equal(monitorCard('wristTemp', series({ base: 36.1, amp: 0.05, last })).tone, 'watch');
});

function pick(c) { return { status: c.status, tone: c.tone }; }

test('the MAD floor keeps a very stable series from flagging a trivial wobble', () => {
  const flat = series({ base: 50, amp: 0, last: 51 }); // MAD 0 -> floored at 1 bpm -> band +-1.5
  assert.equal(monitorCard('rhr', flat).status, 'normal');
});

test('fewer than 14 baseline days: value shown, status "building", no band', () => {
  const c = monitorCard('hrv', series({ n: 10, base: 60, amp: 2 }));
  assert.equal(c.state, 'ok');
  assert.equal(c.status, 'building');
  assert.equal(c.tone, 'normal');
  assert.equal(c.band, null);
  assert.equal(c.bar, null);
  assert.equal(c.n, 9);
  assert.equal(typeof c.value, 'number');
});

test('baseline window: days older than 42 before the latest do not count', () => {
  const old = series({ n: 30, base: 90, amp: 0, asOf: '2026-06-01' });
  const recent = series({ n: 10, base: 60, amp: 2 });
  const c = monitorCard('hrv', [...old, ...recent]);
  assert.equal(c.n, 9, 'the June block is outside the window');
  assert.equal(c.status, 'building');
});

test('a missing / empty series is a "none" card, never a throw', () => {
  assert.deepEqual(monitorCard('hrv', null), { key: 'hrv', state: 'none' });
  assert.deepEqual(monitorCard('hrv', []), { key: 'hrv', state: 'none' });
});

test('several samples a day collapse to the day median; implausible samples are clamped first', () => {
  const rows = series({ base: 60, amp: 2 });
  rows.push({ date: AS_OF, value: 62 }, { date: AS_OF, value: 230 });
  const c = monitorCard('hrv', rows);
  assert.equal(c.date, AS_OF);
  assert.ok(c.value < 100, 'a 230 ms spike does not become the headline');
});

test('bar: fractions (0 = bottom, 1 = top) of a scale that spans +-3 MAD and always contains the value', () => {
  const c = monitorCard('rhr', series({ base: 50, amp: 1, last: 80 }));
  assert.equal(c.bar.v, 1, 'an extreme value sits at the top edge');
  assert.ok(c.bar.lo > 0 && c.bar.lo < c.bar.hi && c.bar.hi < 1);
  const mid = monitorCard('rhr', series({ base: 50, amp: 1, last: 50 }));
  assert.ok(mid.bar.v > mid.bar.lo && mid.bar.v < mid.bar.hi);
});

test('monitorFromInputs: one card per key in order, asOf = newest card date; deterministic + JSON-safe', () => {
  const inp = {
    respiratory: series({ base: 14.5, amp: 0.2 }),
    rhr: series({ base: 50, amp: 1 }),
    hrv: series({ base: 60, amp: 2 }),
    wristTemp: null,
    sleep: series({ base: 7.5, amp: 0.2, asOf: addDays(AS_OF, -1) }),
  };
  const m = monitorFromInputs(inp);
  assert.deepEqual(m.cards.map((c) => c.key), MONITOR_KEYS);
  assert.equal(m.cards[3].state, 'none');
  assert.equal(m.cards[4].date, addDays(AS_OF, -1));
  assert.equal(m.asOf, AS_OF);
  const j = JSON.stringify(m);
  assert.doesNotMatch(j, /NaN|Infinity|score|pct/i);
  assert.equal(j, JSON.stringify(monitorFromInputs(inp)));
  assert.deepEqual(monitorFromInputs({}).cards.map((c) => c.state), ['none', 'none', 'none', 'none', 'none']);
  assert.equal(monitorFromInputs({}).asOf, null);
});

test('buildMonitor reads the extract CSVs (respiratory brpm column, sleep hours) and never depends on the clock', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'score-monitor-'));
  try {
    const ds = Array.from({ length: 20 }, (_, i) => addDays(AS_OF, i - 19));
    fs.writeFileSync(path.join(dir, 'respiratory-daily.csv'), 'date,brpm\n' + ds.map((d, i) => `${d},${14 + wig(i) * 0.1}`).join('\n') + '\n');
    fs.writeFileSync(path.join(dir, 'sleep-daily.csv'), 'date,asleep_hours,source,bedtime,waketime\n' + ds.map((d, i) => `${d},${7 + wig(i) * 0.1},W,23,7`).join('\n') + '\n');
    const at = (iso) => {
      mock.timers.enable({ apis: ['Date'], now: new Date(iso) });
      try { return JSON.stringify(buildMonitor(dir)); } finally { mock.timers.reset(); }
    };
    const a = at('2026-09-30T08:00:00Z');
    assert.equal(a, at('2031-01-01T00:00:00Z'));
    const m = JSON.parse(a);
    assert.equal(m.cards[0].state, 'ok');
    assert.equal(m.cards[4].state, 'ok');
    assert.equal(m.cards[1].state, 'none', 'no rhr.csv');
    assert.equal(buildMonitor(null).asOf, null);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('HRV card: a partial newest day (few samples vs the usual count) falls back to the latest complete day', () => {
  const rows = [];
  for (const r of series({ base: 60, amp: 2, asOf: addDays(AS_OF, -1) })) for (let j = 0; j < 6; j++) rows.push({ date: r.date, value: r.value });
  rows.push({ date: AS_OF, value: 120 }, { date: AS_OF, value: 118 });
  const c = monitorCard('hrv', rows);
  assert.equal(c.date, addDays(AS_OF, -1));
  assert.equal(c.status, 'normal');
  rows.push({ date: AS_OF, value: 119 }); // 3 of a usual 6: complete
  assert.equal(monitorCard('hrv', rows).date, AS_OF);
});
