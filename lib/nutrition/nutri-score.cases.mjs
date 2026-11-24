/* The shared cases of the nutrition score (lib/nutrition/nutri-score.mjs): run against the lib (nutri-score.test.mjs),
 * the page's HC_NSCORE (web/src/client/nutri-score.test.mjs) and the built page (web/test/client-globals-build.test.mjs).
 * Test-time only: kept out of the module so the page bundle (web/src/client/lib-globals.ts) never ships it. */

// shared fixture: the HC_NSCORE tests (web/src/client/nutri-score.test.mjs, the built page) run the emitted source over these
var TG = { k: 2000, p: 150, g: 70 };
function D(o) {
  var d = { date: '2030-01-10', k: 2000, p: 150, f: 70, n: 3, missing: { p: false, f: false }, groups: { breakfast: 1, lunch: 1, dinner: 1 } };
  Object.keys(o || {}).forEach(function (k) { d[k] = o[k]; });
  return d;
}
export const NSCORE_CASES = Object.freeze([
  { name: 'on every target', day: D(), target: TG, today: '2030-01-11', expect: { score: 100, parts: { k: { v: 2000, t: 2000, pts: 100 }, p: { v: 150, t: 150, pts: 100 }, f: { v: 70, t: 70, pts: 100 } }, inc: false, partial: false, meals: true, assumed: false } },
  { name: 'every component part way', day: D({ k: 2500, p: 105, f: 94.5 }), target: TG, today: '2030-01-11', expect: { score: 46, parts: { k: { v: 2500, t: 2000, pts: 40 }, p: { v: 105, t: 150, pts: 50 }, f: { v: 94.5, t: 70, pts: 50 } }, inc: false, partial: false, meals: true, assumed: false } },
  { name: 'low fat, under-eaten, today so far', day: D({ k: 1300, p: 60, f: 15 }), target: TG, today: '2030-01-10', expect: { score: 0, parts: { k: { v: 1300, t: 2000, pts: 0 }, p: { v: 60, t: 150, pts: 0 }, f: { v: 15, t: 70, pts: 0 } }, inc: false, partial: true, meals: true, assumed: false } },
  { name: 'fat unknown, protein a minimum that reaches the target', day: D({ k: 2300, p: 140, f: 5, missing: { p: true, f: true } }), target: TG, today: '2030-01-11', expect: { score: 90, parts: { k: { v: 2300, t: 2000, pts: 80 }, p: { v: 140, t: 150, pts: 100, min: true }, f: null }, inc: true, partial: false, meals: true, assumed: false } },
  { name: 'protein a minimum below full credit, no dinner, assumed rest day', day: D({ p: 90, missing: { p: true, f: false }, groups: { breakfast: 1, lunch: 2, dinner: 0 } }), target: { k: 2000, p: 150, g: 70, inferred: true }, today: '2030-01-11', expect: { score: 100, parts: { k: { v: 2000, t: 2000, pts: 100 }, p: null, f: { v: 70, t: 70, pts: 100 } }, inc: true, partial: false, meals: false, assumed: true } },
  { name: 'band edges: kcal +10 % exactly, protein 90 % exactly, fat 110 % exactly', day: D({ k: 2200, p: 135, f: 77 }), target: TG, today: '2030-01-11', expect: { score: 100, parts: { k: { v: 2200, t: 2000, pts: 100 }, p: { v: 135, t: 150, pts: 100 }, f: { v: 77, t: 70, pts: 100 } }, inc: false, partial: false, meals: true, assumed: false } },
  { name: 'zero edges: kcal -35 %, protein 50 %, fat 160 %', day: D({ k: 1300, p: 75, f: 112 }), target: TG, today: '2030-01-11', expect: { score: 0, parts: { k: { v: 1300, t: 2000, pts: 0 }, p: { v: 75, t: 150, pts: 0 }, f: { v: 112, t: 70, pts: 0 } }, inc: false, partial: false, meals: true, assumed: false } },
  { name: 'fat 30 % below and a blank protein the sync did not flag', day: D({ p: null, f: 21 }), target: TG, today: '2030-01-11', expect: { score: 67, parts: { k: { v: 2000, t: 2000, pts: 100 }, p: null, f: { v: 21, t: 70, pts: 0 } }, inc: true, partial: false, meals: true, assumed: false } },
  { name: 'no entries', day: D({ n: 0 }), target: TG, today: '2030-01-11', expect: null },
  { name: 'no target', day: D(), target: null, today: '2030-01-11', expect: null },
]);
