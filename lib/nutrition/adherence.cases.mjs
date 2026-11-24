/* The shared cases of the adherence count (lib/nutrition/adherence.mjs): run against the lib (adherence.test.mjs),
 * the page's HC_ADH (web/src/client/adherence.test.mjs) and the built page (web/test/client-globals-build.test.mjs).
 * Test-time only: kept out of the module so the page bundle (web/src/client/lib-globals.ts) never ships it. */

// shared fixture: the HC_ADH tests (lib + web/src/client/adherence.test.mjs) run the page's source over these
var G3 = { breakfast: 1, lunch: 1, dinner: 1, addon: 0 };
/** A test day summary. @param {string} date @param {number | null} k @param {number | null} p
 * @param {Record<string, number> | null} [groups] @param {boolean} [minP] */
function D(date, k, p, groups, minP) {
  return { date: date, k: k, p: p, c: null, f: null, n: 3, missing: { p: !!minP, c: true, f: true }, groups: groups || G3 };
}
var DATES = ['2030-01-04', '2030-01-05', '2030-01-06', '2030-01-07', '2030-01-08', '2030-01-09', '2030-01-10'];
export const ADHERENCE_CASES = Object.freeze([
  { name: 'nothing logged', dates: DATES, days: [], targets: {}, expect: { days: 7, logged: 0, complete: 0, compared: 0, unknown: 0, assumed: 0, meanK: null, meanTarget: null, proteinHit: 0, proteinMin: 0, proteinUnknown: 0, states: DATES.map(function (d) { return { date: d, state: 'none' }; }) } },
  {
    name: 'complete, partial, unknown type and every kcal state',
    dates: DATES,
    days: [
      D('2030-01-04', 2000, 140), D('2030-01-05', 2500, 120), D('2030-01-06', 2950, 160, null, true),
      D('2030-01-07', 900, 40, { breakfast: 1, lunch: 1, dinner: 0, addon: 2 }), D('2030-01-08', 2400, null), D('2030-01-09', 2300, 150),
      D('2030-01-10', 1500, 90),
    ],
    targets: { '2030-01-04': { k: 2500, p: 150 }, '2030-01-05': { k: 2500, p: 150 }, '2030-01-06': { k: 2600, p: 150 }, '2030-01-07': { k: 2500, p: 150 }, '2030-01-08': { k: 2500, p: 150 }, '2030-01-09': null, '2030-01-10': { k: 2500, p: 150, inferred: true } },
    expect: {
      days: 7, logged: 7, complete: 6, compared: 4, unknown: 1, assumed: 1, meanK: 2463, meanTarget: 2525, proteinHit: 2, proteinMin: 1, proteinUnknown: 1,
      states: [
        { date: '2030-01-04', state: 'under' }, { date: '2030-01-05', state: 'on' }, { date: '2030-01-06', state: 'over' }, { date: '2030-01-07', state: 'partial' },
        { date: '2030-01-08', state: 'on' }, { date: '2030-01-09', state: 'unknown' }, { date: '2030-01-10', state: 'assumed' },
      ],
    },
  },
]);
