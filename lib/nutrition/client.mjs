/* The classic-script globals web/src/client/nutri-day.js runs, emitted at build time from the nutrition
 * modules' OWN function source (lib/format/numbers.mjs classicGlobal; inlined with HC_FMT before util.js by
 * web/layouts/Plan.astro). Each module states what it ships in a plain `CLIENT` descriptor and this file
 * alone imports the emitter, because data/nutrition/generate.js loads lib/nutrition on its own (its
 * fresh-clone test copies only this folder). Build / test time only. */
import { classicGlobal } from '../format/numbers.mjs';
import { round2 } from './num.mjs';
import { CLIENT as DAYTYPE } from './daytype.mjs';
import { CLIENT as FUEL } from './fuel.mjs';
import { CLIENT as AMOUNTS } from './amounts.mjs';
import { CLIENT as UNITS } from './units.mjs';
import { CLIENT as FILL } from './fill.mjs';
import { CLIENT as SCALE } from './scale.mjs';

const NUM = { consts: {}, hidden: {}, fns: { round2 } };

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

/** var HC_DAYTYPE (daytype.mjs) + var HC_FUEL (fuel.mjs) + var HC_SCALE (scale.mjs solveScale / planFor with
 * what they call: amounts.mjs, units.mjs, fill.mjs, fuel.mjs, num.mjs round2). */
export function clientSource() {
  return [
    classicGlobal('HC_DAYTYPE', DAYTYPE),
    classicGlobal('HC_FUEL', FUEL),
    classicGlobal('HC_SCALE', mergeClient(AMOUNTS, NUM, UNITS, FILL, FUEL, SCALE)),
  ].join('\n');
}
