/* The lib code the page runs, as page globals (HC_FMT, HC_BAND, HC_ADH, HC_PROG, HC_NSCORE, HC_FOODLOG,
 * HC_DAYTYPE, HC_FUEL, HC_SCALE, HC_GUIDE, HC_ENERGY): the lib modules' own functions and constants,
 * bundled by esbuild like every client script (web/src/client-bundle.mjs) and published once, first in
 * the manifest, so util.ts and the scripts after it read them and the page carries ONE copy of each
 * function. Each module states what it ships in its plain `CLIENT` descriptor ({consts, hidden, fns}):
 * a global exposes its `consts` then its `fns`, in the descriptor's order (`hidden` constants are the
 * module's own, used by its functions, never exposed). A global built from several modules merges them;
 * one name from two modules must be the same value. */
import { CLIENT as FMT } from '../../../lib/format/numbers.mjs';
import { CLIENT as BAND } from '../../../lib/score/recovery.mjs';
import { CLIENT as ADH } from '../../../lib/nutrition/adherence.mjs';
import { CLIENT as PROG } from '../../../lib/nutrition/progress.mjs';
import { CLIENT as NSCORE } from '../../../lib/nutrition/nutri-score.mjs';
import { CLIENT as FOODLOG } from '../../../lib/nutrition/foodlog.mjs';
import { CLIENT as DAYTYPE } from '../../../lib/nutrition/daytype.mjs';
import { CLIENT as FUEL } from '../../../lib/nutrition/fuel.mjs';
import { CLIENT as AMOUNTS } from '../../../lib/nutrition/amounts.mjs';
import { CLIENT as UNITS } from '../../../lib/nutrition/units.mjs';
import { CLIENT as FILL } from '../../../lib/nutrition/fill.mjs';
import { CLIENT as SCALE } from '../../../lib/nutrition/scale.mjs';
import { CLIENT as GUIDE } from '../../../lib/nutrition/guide.mjs';
import { CLIENT as ENERGY } from '../../../lib/nutrition/energy.mjs';
import { round2, fin } from '../../../lib/nutrition/num.mjs';
import { floorToStep } from '../../../lib/nutrition/amounts.mjs';
import { foldName } from '../../../lib/nutrition/names.mjs';

type Part = { consts?: object; fns?: object };

/** One global from one or more descriptors: every `consts` key, then every `fns` key, first seen first. */
function expose(global: string, ...parts: Part[]): Record<string, unknown> {
  var consts: Record<string, unknown> = {}, fns: Record<string, unknown> = {};
  parts.forEach(function (p) {
    [[consts, p.consts], [fns, p.fns]].forEach(function (pair) {
      var out = pair[0] as Record<string, unknown>, from = (pair[1] || {}) as Record<string, unknown>;
      Object.keys(from).forEach(function (k) {
        if (k in out && out[k] !== from[k]) throw new Error(global + ': two different values named ' + k);
        out[k] = from[k];
      });
    });
  });
  return Object.assign({}, consts, fns);
}

(globalThis as unknown as Record<string, unknown>).HC_FMT = expose('HC_FMT', FMT);
(globalThis as unknown as Record<string, unknown>).HC_BAND = expose('HC_BAND', BAND);
(globalThis as unknown as Record<string, unknown>).HC_ADH = expose('HC_ADH', ADH);
(globalThis as unknown as Record<string, unknown>).HC_PROG = expose('HC_PROG', PROG);
(globalThis as unknown as Record<string, unknown>).HC_NSCORE = expose('HC_NSCORE', NSCORE);
(globalThis as unknown as Record<string, unknown>).HC_FOODLOG = expose('HC_FOODLOG', FOODLOG);
(globalThis as unknown as Record<string, unknown>).HC_DAYTYPE = expose('HC_DAYTYPE', DAYTYPE);
(globalThis as unknown as Record<string, unknown>).HC_FUEL = expose('HC_FUEL', FUEL);
// planFor / solveScale with what they call: amounts, num's round2, units, fill, fuel
(globalThis as unknown as Record<string, unknown>).HC_SCALE = expose('HC_SCALE', AMOUNTS, { fns: { round2 } }, UNITS, FILL, FUEL, SCALE);
// the portion guide with the helpers it calls from its siblings
(globalThis as unknown as Record<string, unknown>).HC_GUIDE = expose('HC_GUIDE', { fns: { fin, floorToStep, foldName } }, GUIDE);
(globalThis as unknown as Record<string, unknown>).HC_ENERGY = expose('HC_ENERGY', ENERGY);
