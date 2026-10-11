/* The client scripts run the lib's OWN pure functions, emitted at build time (clientSource, inlined by
 * layouts/Plan.astro before util.js), never hand-kept copies: HC_ADH = lib/nutrition/adherence.mjs, HC_PROG = lib/nutrition/progress.mjs,
 * HC_NSCORE = lib/nutrition/score.mjs, HC_FOODLOG = lib/nutrition/foodlog.mjs (+ num.mjs fin / roundEps).
 * Guard: the client files no longer define the copied functions, and the built page carries the
 * emitted source before the script that uses it. Reads the fixture built by `npm run pretest`. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { slimScript } from '../src/slim-script.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const WEB_ROOT = path.dirname(here);
const htmlPath = path.join(WEB_ROOT, '.test-dist', 'en-example', 'index.html');
const html = fs.existsSync(htmlPath) ? fs.readFileSync(htmlPath, 'utf8') : '';
const src = (name) => fs.readFileSync(path.join(WEB_ROOT, 'src', 'client', name), 'utf8');

// [client file, the global it reads, the lib functions it must not re-define] (a file may read several;
// old port names listed too; fuel.mjs `step` is left out: nutri-day.js has its own unrelated render helper step())
const COPIES = [
  ['adherence.js', 'HC_ADH', ['fin', 'isComplete', 'dayState', 'adherence']],
  ['progress.js', 'HC_PROG', ['fin', 'round', 'dayNum', 'isoOf', 'rollPoints', 'weeklyRate', 'weightProgress', 'etaMonths']],
  ['food-core.js', 'HC_FOODLOG', ['fin', 'roundEps', 'round1', 'roundKcal', 'round2', 'roundMacros', 'scaleMacros', 'times', 'productAmount', 'productEntry', 'knownMacros', 'ingredientBasis', 'recipeBasis', 'entryFromBasis', 'recipeEntry', 'dayTotals', 'atwaterOk', 'pieceWeight', 'basicModes', 'basicAmount', 'basicEntry', 'basicLabel', 'basicConvert', 'basicIngredient']],
  ['nutri-score.js', 'HC_NSCORE', ['fin', 'clamp100', 'ratio', 'pts1', 'kcalPoints', 'proteinPoints', 'fatPoints', 'scoreBand', 'hasMeals', 'nutritionScore', 'scoreSeries']],
  ['nutri-day.js', 'HC_DAYTYPE', ['rideType', 'itemType', 'dayTypeOfWorkouts', 'ofWorkouts', 'dayTypeOfProgram', 'ofProgram', 'detectDayType', 'hasValue', 'dayInputFor']],
  ['nutri-day.js', 'HC_FUEL', ['isBikeDay', 'fuelStep', 'range', 'pickItem', 'pickFuelItem', 'ownDuring', 'ownBefore', 'fuelPlan']],
  ['nutri-day.js', 'HC_SCALE', ['round2', 'stepAmount', 'lineUnit', 'lineAmt', 'lineStep', 'lineKey', 'lineCap', 'capFactor', 'floorToStep', 'capAmount', 'pieceOf', 'isDiscrete', 'fmtHalf', 'fmtPieces', 'fmtAmt', 'bound', 'waterFill', 'scaleFill', 'fmtFactor', 'solveScale', 'planFor']],
  ['nutri-day.js', 'HC_GUIDE', ['zero', 'zero4', 'fin', 'finite', 'foldName', 'fold', 'cmp', 'guideBudgets', 'exampleAmount', 'remaining', 'mealState', 'isCovered', 'dayRemaining', 'capByDay', 'roleOptions']],
];

for (const [file, global, fns] of COPIES) {
  test(`${file} defines none of the lib's ${global} functions (${fns.join(', ')}) and reads them from ${global}`, () => {
    const s = src(file);
    for (const fn of fns) assert.doesNotMatch(s, new RegExp(`function ${fn}\\(`), `${file}: function ${fn} is a copy of the lib`);
    assert.match(s, new RegExp(`\\b${global}\\b`), `${file} reads ${global}`);
  });

  test(`the built page inlines var ${global} (clientSource) before ${file}`, () => {
    assert.ok(html, `missing ${htmlPath}: run npm run pretest`);
    const g = html.indexOf(`var ${global}=`) >= 0 ? html.indexOf(`var ${global}=`) : html.indexOf(`var ${global} =`);
    const at = html.indexOf(slimScript(src(file)));
    assert.ok(g > 0, `var ${global} inlined`);
    assert.ok(at > 0, `${file} inlined whole`);
    assert.ok(g < at, `${global} before ${file}`);
  });
}
