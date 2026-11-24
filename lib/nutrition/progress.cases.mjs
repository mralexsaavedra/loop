/* The shared cases of the weight progress (lib/nutrition/progress.mjs): run against the lib (progress.test.mjs),
 * the page's HC_PROG (web/src/client/progress.test.mjs) and the built page (web/test/client-globals-build.test.mjs).
 * Test-time only: kept out of the module so the page bundle (web/src/client/lib-globals.ts) never ships it. */
import { round, weightProgress } from './progress.mjs';

// the cases' expectations are the module's own output, frozen as JSON (the HC_PROG tests compare the page's source)
/** @param {{ start?: unknown, roll?: unknown }} m @param {string} goal @param {number | null} target */
function weightProgressExpect(m, goal, target) {
  return JSON.parse(JSON.stringify(weightProgress(m, { goal: goal, target: target })));
}

// shared fixture: the HC_PROG tests (lib + web/src/client/progress.test.mjs) run the page's source over these
/** A baked weight metric over `days` days, a 7-day average every `every` days (and the last).
 * @param {string} start @param {number} days @param {(i: number) => number} kgAt @param {number} [every] */
function series(start, days, kgAt, every) {
  var roll = /** @type {(number | null)[]} */ ([]);
  for (var i = 0; i < days; i++) roll.push(i % (every || 1) === 0 || i === days - 1 ? round(kgAt(i), 1) : null);
  return { kind: 'sparse', dec: 1, start: start, v: roll.slice(), roll: roll };
}
var CUT = series('2030-01-01', 41, function (i) { return 80 - (0.35 / 7) * i; });
var CUT_SPARSE = series('2030-01-01', 41, function (i) { return 80 - (0.3 / 7) * i; }, 3);
var BULK = series('2030-01-01', 41, function (i) { return 70 + (0.2 / 7) * i; });
var BULK_FAST = series('2030-01-01', 41, function (i) { return 70 + (0.4 / 7) * i; });
export const PROGRESS_CASES = Object.freeze([
  { name: 'cut on pace towards a target', metric: CUT, opts: { goal: 'cut', target: 75 }, expect: weightProgressExpect(CUT, 'cut', 75) },
  { name: 'cut, no target', metric: CUT, opts: { goal: 'cut', target: null }, expect: weightProgressExpect(CUT, 'cut', null) },
  { name: 'bulk with a falling trend: the wrong way', metric: CUT, opts: { goal: 'bulk', target: 85 }, expect: weightProgressExpect(CUT, 'bulk', 85) },
  { name: 'maintain while losing 0.35 kg/week: drifting', metric: CUT, opts: { goal: 'maintain', target: null }, expect: weightProgressExpect(CUT, 'maintain', null) },
  { name: 'bulk at 0.2 kg/week: on pace (0.1–0.25)', metric: BULK, opts: { goal: 'bulk', target: 74 }, expect: weightProgressExpect(BULK, 'bulk', 74) },
  { name: 'bulk at 0.4 kg/week: too fast', metric: BULK_FAST, opts: { goal: 'bulk', target: 80 }, expect: weightProgressExpect(BULK_FAST, 'bulk', 80) },
  { name: 'target reached', metric: CUT, opts: { goal: 'cut', target: 78.2 }, expect: weightProgressExpect(CUT, 'cut', 78.2) },
  { name: 'target on the other side of a cut', metric: CUT, opts: { goal: 'cut', target: 83 }, expect: weightProgressExpect(CUT, 'cut', 83) },
  { name: 'weigh-ins every third day still give a rate', metric: CUT_SPARSE, opts: { goal: 'cut', target: 74 }, expect: weightProgressExpect(CUT_SPARSE, 'cut', 74) },
  { name: 'few readings', metric: series('2030-01-01', 9, function () { return 80; }), opts: { goal: 'cut', target: 75 }, expect: weightProgressExpect(series('2030-01-01', 9, function () { return 80; }), 'cut', 75) },
  { name: 'no weight data', metric: { start: '2030-01-01', v: [null], roll: [null] }, opts: { goal: 'cut', target: 75 }, expect: null },
]);
