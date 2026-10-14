/* The nutrition classic-script globals the page runs (HC_ADH, HC_PROG, HC_NSCORE, HC_FOODLOG, HC_ENERGY, and
 * HC_DAYTYPE / HC_FUEL / HC_SCALE / HC_GUIDE for nutri-day.js), emitted at build time from the nutrition
 * modules' OWN function source (lib/format/numbers.mjs classicGlobal; inlined with HC_FMT before util.js by
 * web/layouts/Plan.astro). Each module states what it ships in a plain `CLIENT` descriptor and this file
 * alone imports the emitter, because data/nutrition/generate.mjs loads lib/nutrition on its own (its
 * fresh-clone test copies only this folder). Build / test time only. */
import { classicGlobal } from '../format/numbers.mjs';
import { round2, fin } from './num.mjs';
import { foldName } from './names.mjs';
import { floorToStep, GRID_EPS } from './amounts.mjs';
import { CLIENT as ADH } from './adherence.mjs';
import { CLIENT as PROG } from './progress.mjs';
import { CLIENT as NSCORE } from './score.mjs';
import { CLIENT as FOODLOG } from './foodlog.mjs';
import { CLIENT as DAYTYPE } from './daytype.mjs';
import { CLIENT as FUEL } from './fuel.mjs';
import { CLIENT as AMOUNTS } from './amounts.mjs';
import { CLIENT as UNITS } from './units.mjs';
import { CLIENT as FILL } from './fill.mjs';
import { CLIENT as SCALE } from './scale.mjs';
import { CLIENT as GUIDE } from './guide.mjs';
import { CLIENT as ENERGY } from './energy.mjs';

const NUM = { consts: {}, hidden: {}, fns: { round2 } };
// what guide.mjs calls from its siblings
const GUIDE_DEPS = { consts: {}, hidden: { GRID_EPS }, fns: { fin, floorToStep, foldName } };

/** Several modules' descriptors as ONE global (a function calls its imports by name, so they share one
 * scope); the same name from two modules must be the same value. */
export function mergeClient(...parts) {
  const out = { consts: {}, hidden: {}, fns: {} };
  for (const p of parts) {
    for (const k of ['consts', 'hidden', 'fns']) {
      for (const [name, v] of Object.entries(p[k] || {})) {
        if (name in out[k] && out[k][name] !== v) throw new Error(`mergeClient: two different ${k}.${name}`);
        out[k][name] = v;
      }
    }
  }
  return out;
}

/** var HC_ADH (adherence.mjs, client/adherence.js). */
export function adherenceSource() {
  return classicGlobal('HC_ADH', ADH);
}
/** var HC_PROG (progress.mjs, client/progress.js). */
export function progressSource() {
  return classicGlobal('HC_PROG', PROG);
}
/** var HC_NSCORE (score.mjs, client/nutri-score.js). */
export function scoreSource() {
  return classicGlobal('HC_NSCORE', NSCORE);
}
/** var HC_FOODLOG (foodlog.mjs + num.mjs fin / roundEps, client/food-core.js). */
export function foodlogSource() {
  return classicGlobal('HC_FOODLOG', FOODLOG);
}
/** var HC_DAYTYPE (daytype.mjs) + var HC_FUEL (fuel.mjs) + var HC_SCALE (scale.mjs solveScale / planFor with
 * what they call: amounts.mjs, units.mjs, fill.mjs, fuel.mjs, num.mjs round2) + var HC_GUIDE (guide.mjs, the
 * portion guide): what client/nutri-day.js runs. */
export function nutriDaySource() {
  return [
    classicGlobal('HC_DAYTYPE', DAYTYPE),
    classicGlobal('HC_FUEL', FUEL),
    classicGlobal('HC_SCALE', mergeClient(AMOUNTS, NUM, UNITS, FILL, FUEL, SCALE)),
    classicGlobal('HC_GUIDE', mergeClient(GUIDE_DEPS, GUIDE)),
  ].join('\n');
}
/** var HC_ENERGY (energy.mjs + targets.mjs carbsOf): the in-page onboarding's computed targets, safety
 * screen and bounds (client/onboarding.js). */
export function energySource() {
  return classicGlobal('HC_ENERGY', ENERGY);
}
/** Every nutrition global in page order: what web/layouts/Plan.astro inlines after HC_FMT + HC_BAND. */
export function clientSource() {
  return [adherenceSource(), progressSource(), scoreSource(), foodlogSource(), nutriDaySource(), energySource()].join('\n');
}
