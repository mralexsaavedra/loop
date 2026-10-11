/* The classic-script globals web/src/client/nutri-day.js runs, emitted at build time from the nutrition
 * modules' OWN function source (lib/format/numbers.mjs classicGlobal; inlined with HC_FMT before util.js by
 * web/layouts/Plan.astro). Each module states what it ships in a plain `CLIENT` descriptor and this file
 * alone imports the emitter, because data/nutrition/generate.js loads lib/nutrition on its own (its
 * fresh-clone test copies only this folder). Build / test time only. */
import { classicGlobal } from '../format/numbers.mjs';
import { CLIENT as DAYTYPE } from './daytype.mjs';
import { CLIENT as FUEL } from './fuel.mjs';

/** var HC_DAYTYPE (lib/nutrition/daytype.mjs) + var HC_FUEL (lib/nutrition/fuel.mjs). */
export function clientSource() {
  return [classicGlobal('HC_DAYTYPE', DAYTYPE), classicGlobal('HC_FUEL', FUEL)].join('\n');
}
