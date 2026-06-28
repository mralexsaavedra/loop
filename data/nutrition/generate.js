#!/usr/bin/env node
/* Generator for the nutrition plan.
 * Single source of truth: plan-data.json
 *   - `ingredients`: per-100g/ml/ud base foods (verified = real product label).
 *   - each item carries a `recipe` ([{ing, amt}]) OR a `manual` macro block
 *     (ranges/estimates with no single label) OR `none` (the "— ninguno —" row).
 * This script COMPUTES per-serving k/p/c/g from ingredient*amt, then outputs
 * (DO NOT edit by hand):
 *   - the GEN:DATA block inside plan-web.html  (flat JS DATA/EXTRAS objects)
 *   - plan-tables.md                           (human-readable reference tables)
 * Run:  node data/nutrition/generate.js
 */
const fs = require('fs');
const path = require('path');

const DIR = __dirname;
const data = JSON.parse(fs.readFileSync(path.join(DIR, 'plan-data.json'), 'utf8'));
const { ingredients: ING, data: RAW, extras: RAWEX, quesoKeys: QUESO, vegKeys: VEG } = data;

/* ---------- compute per-serving macros from the ingredient layer ---------- */
const rk = n => Math.round(n);                 // kcal -> integer
const rm = n => Math.round(n * 10) / 10;       // macros -> 1 decimal (.0 dropped)
function macro(recipe, key) {
  return recipe.reduce((s, r) => {
    const ing = ING[r.ing];
    if (!ing) throw new Error('unknown ingredient: ' + r.ing);
    return s + ing[key] * (r.amt / ing.per);
  }, 0);
}
const MACRO = ['k', 'p', 'c', 'g'];
function resolve(o) {
  const out = {};
  for (const k of Object.keys(o)) { if (k !== 'recipe' && k !== 'manual') out[k] = o[k]; }
  if (o.recipe) { out.k = rk(macro(o.recipe, 'k')); MACRO.slice(1).forEach(f => out[f] = rm(macro(o.recipe, f))); }
  else if (o.manual) { MACRO.forEach(f => out[f] = o.manual[f]); }
  else if (o.none) { MACRO.forEach(f => out[f] = 0); }
  else throw new Error('item has neither recipe, manual nor none: ' + (o.n || o.l));
  return out;
}
// resolved copies used for both outputs
const D = {};
for (const [cat, v] of Object.entries(RAW)) {
  if (Array.isArray(v)) D[cat] = v.map(resolve);
  else { D[cat] = {}; for (const [sub, arr] of Object.entries(v)) D[cat][sub] = arr.map(resolve); }
}
const EX = {};
for (const [k, o] of Object.entries(RAWEX)) EX[k] = resolve(o);

/* ---------- serialize resolved data back to readable JS for the HTML block ---------- */
function jsVal(v) {
  if (typeof v === 'number') return String(v);
  if (typeof v === 'string') return "'" + v.replace(/\\/g, '\\\\').replace(/'/g, "\\'") + "'";
  throw new Error('unexpected value: ' + v);
}
function jsItem(o) {
  return '{' + Object.keys(o).map(k => k + ':' + jsVal(o[k])).join(',') + '}';
}
function jsArr(arr, indent) {
  const pad = ' '.repeat(indent);
  return '[\n' + arr.map(o => pad + '  ' + jsItem(o)).join(',\n') + '\n' + pad + ']';
}
function jsData() {
  const lines = ['    var DATA = {'];
  const keys = Object.keys(D);
  keys.forEach((key, i) => {
    const v = D[key];
    const comma = i < keys.length - 1 ? ',' : '';
    if (Array.isArray(v)) {
      lines.push('      ' + key + ':' + jsArr(v, 6) + comma);
    } else { // {train, rest}
      const subs = Object.keys(v);
      lines.push('      ' + key + ':{');
      subs.forEach((s, j) => lines.push('        ' + s + ':' + jsArr(v[s], 8) + (j < subs.length - 1 ? ',' : '')));
      lines.push('      }' + comma);
    }
  });
  lines.push('    };');
  return lines.join('\n');
}
function jsExtras() {
  const lines = ['    var EXTRAS = {'];
  const keys = Object.keys(EX);
  keys.forEach((k, i) => lines.push('      ' + k + ':' + jsItem(EX[k]) + (i < keys.length - 1 ? ',' : '')));
  lines.push('    };');
  return lines.join('\n');
}
const keysJS = k => '[' + k.map(x => "'" + x + "'").join(',') + ']';

const GEN_HEAD =
`    /* GEN:DATA START — generated from plan-data.json by generate.js. DO NOT EDIT BY HAND.
       Edit data/nutrition/plan-data.json (ingredients + recipes) and run \`node data/nutrition/generate.js\`.
       Macros below are COMPUTED from ingredient*amt — do not hand-tune them here.
       Item fields: l = dropdown label · n/q = table name/amount · k/p/c/g = macros ·
       t = protein tier · note = caption · none = the "— ninguno —" option (skipped in tables). */`;

const htmlBlock = [
  GEN_HEAD,
  jsData(),
  jsExtras(),
  '    var QUESO_KEYS=' + keysJS(QUESO) + ';',
  '    var VEG_KEYS=' + keysJS(VEG) + ';',
  '    /* GEN:DATA END */',
].join('\n');

const htmlPath = path.join(DIR, 'plan-web.html');
let html = fs.readFileSync(htmlPath, 'utf8');
const reBlock = /[ \t]*\/\* GEN:DATA START[\s\S]*?\/\* GEN:DATA END \*\//;
if (!reBlock.test(html)) { console.error('ERROR: GEN:DATA markers not found in plan-web.html'); process.exit(1); }
html = html.replace(reBlock, htmlBlock);
fs.writeFileSync(htmlPath, html);

/* ---------- render plan-tables.md ---------- */
const real = arr => arr.filter(o => !o.none);
function mdTable(items) {
  const head = '| Item | Cant. | kcal | P | C | F |\n|---|---|---|---|---|---|';
  const rows = items.map(o => {
    const name = o.n + (o.note ? ' _(' + o.note + ')_' : '');
    return `| ${name} | ${o.q || ''} | ${o.k} | ${o.p} | ${o.c} | ${o.g} |`;
  });
  return [head, ...rows].join('\n');
}
function extraItems(keys) { return keys.map(k => EX[k]); }

const md = [];
md.push('# Plan — reference tables');
md.push('');
md.push('> GENERATED from `plan-data.json` by `generate.js`. **Do not edit this file by hand** —');
md.push('> edit `plan-data.json` and run `node data/nutrition/generate.js`. Macros in grams; this is');
md.push('> the per-serving reference, COMPUTED from the per-100g ingredient layer. Verified per-100g');
md.push('> product labels live in `plan-data.json` (`ingredients`, verified:true).');
md.push('> Not a doctor — see `CLAUDE.md`.');
md.push('');

md.push('## Protein (~40 g protein/serving, raw weight)');
md.push('');
[['lean', '🟢 Lean — daily base'], ['mod', '🟡 Moderate — with awareness'], ['fat', '🔴 Fatty — occasional']].forEach(([t, title]) => {
  md.push('### ' + title);
  md.push('');
  md.push(mdTable(D.proteina.filter(o => o.t === t)));
  md.push('');
});

md.push('## Carbs — lunch (matched by calories)');
md.push('');
md.push('**🏋️ Training day**');
md.push('');
md.push(mdTable(real(D.carboComida.train)));
md.push('');
md.push('**😴 Rest day**');
md.push('');
md.push(mdTable(real(D.carboComida.rest)));
md.push('');

md.push('## Carbs — dinner (raised portion, cooked/ready weight)');
md.push('');
md.push('**🏋️ Training day**');
md.push('');
md.push(mdTable(real(D.carboCena.train)));
md.push('');
md.push('**😴 Rest day**');
md.push('');
md.push(mdTable(real(D.carboCena.rest)));
md.push('');

md.push('## Post-workout (~25–30 g protein)');
md.push('');
md.push(mdTable(real(D.postentreno)));
md.push('');

md.push('## Protein anchor — rest-day slot (~25 g protein)');
md.push('');
md.push(mdTable(real(D.anclaje)));
md.push('');

md.push('## Fruit (per piece/serving)');
md.push('');
md.push(mdTable(D.postre.filter(o => o.cat === 'fruit')));
md.push('');

md.push('## Dessert (also any fruit above)');
md.push('');
md.push(mdTable(D.postre.filter(o => o.cat === 'yogurt')));
md.push('');

md.push('## Vegetables (per 100 g — ~free in the cut)');
md.push('');
md.push(mdTable(extraItems(VEG)));
md.push('');

md.push('## Cheeses & sauces (count them — not free)');
md.push('');
md.push(mdTable(extraItems(QUESO)));
md.push('');

fs.writeFileSync(path.join(DIR, 'plan-tables.md'), md.join('\n'));

console.log('Generated: plan-web.html (GEN:DATA block) + plan-tables.md');
