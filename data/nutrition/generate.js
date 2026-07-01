#!/usr/bin/env node
/* Generator for the nutrition plan.
 * Two sources, merged in memory:
 *   - ingredients.json (TRACKED, public food DB): `ingredients` =
 *     per-100g/ml/ud base foods (verified = real product label). Reusable.
 *   - plan-data.json (GITIGNORED, personal plan): `data`/`dayPlan`/`extras`/etc.
 *     Each item carries a `recipe` ([{ing, amt}]) OR a `manual` macro block
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
const ingPath = path.join(DIR, 'ingredients.json');
if (!fs.existsSync(ingPath)) {
  throw new Error('ingredients.json not found at ' + ingPath + ' — it is the public food DB the plan depends on. A fresh clone ships it; do not delete it.');
}
const ingFile = JSON.parse(fs.readFileSync(ingPath, 'utf8'));
if (!ingFile.ingredients || typeof ingFile.ingredients !== 'object') {
  throw new Error('ingredients.json must contain a top-level "ingredients" object.');
}
const plan = JSON.parse(fs.readFileSync(path.join(DIR, 'plan-data.json'), 'utf8'));
// Merge: public ingredient DB + personal plan. `ingredients` comes only from
// ingredients.json (plan-data.json no longer carries it).
const data = Object.assign({}, plan, { ingredients: ingFile.ingredients });
const { ingredients: ING, data: RAW, extras: RAWEX, quesoKeys: QUESO, vegKeys: VEG, dayPlan: DAYPLAN, extrasDisplay: EXTRASDISPLAY, legumeKeys: LEGUMES, legumePlate: LEGUME_PLATE } = data;

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
  const SKIP = { recipe: 1, manual: 1, tier: 1, cap: 1 }; // tier/cap are breakfast-table-only
  for (const k of Object.keys(o)) { if (!SKIP[k]) out[k] = o[k]; }
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

/* ---------- breakfast detail tables (generated into plan-web.html) ----------
   These per-component reference tables used to be hand-written HTML (a second
   source of truth that drifted). They are now generated from the same recipes.
   Recipe lines may carry display-only fields: `label` (row name), `q` (quantity
   override), `group`+`glabel` (merge several lines into one row, e.g. milk used
   in batter + sauce). Item-level `tier` (🟢/🟡/🔴) + `cap` drive the caption. */
const nd = n => { const r = Math.round(n * 10) / 10; return String(r).replace('.', ','); }; // 1 decimal, comma sep
const lineMacro = (line, key) => { const ing = ING[line.ing]; if (!ing) throw new Error('unknown ingredient: ' + line.ing); return ing[key] * (line.amt / ing.per); };
function brkRows(recipe) {
  const rows = [], byGroup = {};
  for (const line of recipe) {
    const ing = ING[line.ing];
    const m = { k: lineMacro(line, 'k'), p: lineMacro(line, 'p'), c: lineMacro(line, 'c'), g: lineMacro(line, 'g') };
    if (line.group && byGroup[line.group] != null) { // merge into the row that opened this group
      const row = rows[byGroup[line.group]];
      row.amt += line.amt; MACRO.forEach(f => row[f] += m[f]);
      continue;
    }
    if (line.group) byGroup[line.group] = rows.length;
    rows.push({ name: line.glabel || line.label || line.ing, q: line.q || null, link: line.link || null, amt: line.amt, unit: ing.unit, k: m.k, p: m.p, c: m.c, g: m.g });
  }
  return rows;
}
const brkQty = row => row.q ? row.q : (row.unit === 'ud' ? String(row.amt / 100) : row.amt + ' ' + row.unit);
function brkTable(item) {
  const r = resolve(item);
  const cap = `${item.tier} ${item.cap} · ~${r.k} kcal · ${Math.round(r.p)} P · ${Math.round(r.c)} C · ${Math.round(r.g)} G`;
  const trs = brkRows(item.recipe).map(row => {
    const name = row.link ? `<button class="lnk" onclick="jump('${row.link}')">${row.name}</button>` : row.name;
    return `          <tr><td>${name}</td><td>${brkQty(row)}</td><td class="kc">${rk(row.k)}</td><td>${nd(row.p)}</td><td>${nd(row.c)}</td><td>${nd(row.g)}</td></tr>`;
  }).join('\n');
  return [
    '      <div class="table-scroll"><table>',
    `        <caption>${cap}</caption>`,
    '        <thead><tr><th>Componente</th><th>Cant.</th><th>kcal</th><th>P</th><th>C</th><th>G</th></tr></thead>',
    '        <tbody>',
    trs,
    '        </tbody>',
    '      </table></div>',
  ].join('\n');
}
const brkBlock = () => [
  '      <!-- GEN:BREAKFAST START — generated from plan-data.json by generate.js. DO NOT EDIT BY HAND. -->',
  RAW.desayuno.filter(o => !o.none).map(brkTable).join('\n'),
  '      <!-- GEN:BREAKFAST END -->',
].join('\n');

/* ---------- day-summary cards (generated into plan-web.html) ----------
   Both .day-panel cards are rendered from `dayPlan` in plan-data.json. A meal's
   macros are the sum of its parts. A "part" is either a raw ingredient
   ({ing, amt}) or a reference to a resolved item in data[use] (or data[use][tier])
   whose `n` or `l` matches `match` (priority: exact n, exact l, n-includes, l-includes). */
function resolvePart(part) {
  if (part.ing) {
    const ing = ING[part.ing];
    if (!ing) throw new Error('dayPlan part: unknown ingredient: ' + part.ing);
    const f = part.amt / ing.per;
    return { k: ing.k * f, p: ing.p * f, c: ing.c * f, g: ing.g * f };
  }
  const bucket = part.tier ? (RAW[part.use] && RAW[part.use][part.tier]) : RAW[part.use];
  if (!Array.isArray(bucket)) throw new Error('dayPlan part: no items at data.' + part.use + (part.tier ? '.' + part.tier : ''));
  const m = part.match;
  const find = pred => bucket.find(pred);
  const item =
    find(o => o.n === m) ||
    find(o => o.l === m) ||
    find(o => o.n && o.n.includes(m)) ||
    find(o => o.l && o.l.includes(m));
  if (!item) throw new Error('dayPlan part: no match for "' + m + '" in data.' + part.use + (part.tier ? '.' + part.tier : ''));
  const r = resolve(item);
  return { k: r.k, p: r.p, c: r.c, g: r.g };
}
function mealMacros(meal) {
  return meal.parts.reduce((s, part) => {
    const m = resolvePart(part);
    return { k: s.k + m.k, p: s.p + m.p, c: s.c + m.c, g: s.g + m.g };
  }, { k: 0, p: 0, c: 0, g: 0 });
}
const dotThousands = n => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
function dayPanel(day, plan) {
  const meals = plan.meals.map(meal => ({ meal, m: mealMacros(meal) }));
  const total = meals.reduce((s, x) => s + x.m.k, 0);
  const totP = meals.reduce((s, x) => s + x.m.p, 0);
  const totC = meals.reduce((s, x) => s + x.m.c, 0);
  const totG = meals.reduce((s, x) => s + x.m.g, 0);
  const lines = [];
  lines.push(`  <div class="day-panel" data-day="${day}"${day === 'rest' ? ' hidden' : ''}>`);
  lines.push('    <div class="summary">');
  lines.push(`      <div class="kcal">~${dotThousands(rk(total))}<span>kcal</span></div>`);
  lines.push('    </div>');
  lines.push('    <div class="macros">');
  lines.push(`      <div class="mac"><span class="lbl">Prot</span><b>${rk(totP)} g</b></div>`);
  lines.push(`      <div class="mac"><span class="lbl">Carb</span><b>${rk(totC)} g</b></div>`);
  lines.push(`      <div class="mac"><span class="lbl">Grasa</span><b>${rk(totG)} g</b></div>`);
  lines.push('    </div>');
  lines.push(`    <p class="deficit">${plan.kcalNote}</p>`);
  lines.push('');
  lines.push('    <h2>El día</h2>');
  for (const { meal, m } of meals) {
    const name = meal.jump
      ? `<button class="meal-name" onclick="jump('${meal.jump}')">${meal.name}</button>`
      : `<div class="meal-name">${meal.name}</div>`;
    lines.push('    <div class="meal">');
    lines.push(`      <div class="meal-top">${name}<div class="meal-kcal">~${rk(m.k)} kcal</div></div>`);
    const desc = meal.descHtml != null ? meal.descHtml : meal.desc;
    if (desc != null) lines.push(`      <div class="meal-desc">${desc}</div>`);
    if (meal.pcf !== false) lines.push(`      <div class="meal-pcf"><span><b>${rk(m.p)}</b> P</span><span><b>${rk(m.c)}</b> C</span><span><b>${rk(m.g)}</b> G</span></div>`);
    lines.push('    </div>');
  }
  lines.push('  </div>');
  return lines.join('\n');
}
const dayPlanBlock = () => [
  '  <!-- GEN:DAYPLAN START — generated from plan-data.json by generate.js. DO NOT EDIT BY HAND. -->',
  dayPanel('train', DAYPLAN.train),
  dayPanel('rest', DAYPLAN.rest),
  '  <!-- GEN:DAYPLAN END -->',
].join('\n');

/* ---------- live-calculator TARGET (generated into GEN:DATA) ----------
   The Registro calculator grades the day against TARGET and prints "objetivo ~k".
   k is DERIVED from the same day total the summary card shows, so it is impossible
   for the displayed target to drift from the plan it prescribes (this used to be a
   hand-maintained static line that went stale). p (protein goal) and fatMax (fat
   ceiling) are genuine owner-set targets read from plan-data.json `targets`, with
   safe defaults so a plan without that block still generates. */
const TARGET_DEFAULTS = { train: { p: 170, fatMax: 75 }, rest: { p: 170, fatMax: 70 } };
const dayTotalK = day => rk(DAYPLAN[day].meals.reduce((s, m) => s + mealMacros(m).k, 0));
function targetFor(day) {
  const cfg = (data.targets && data.targets[day]) || {};
  const def = TARGET_DEFAULTS[day];
  return { k: dayTotalK(day), p: cfg.p != null ? cfg.p : def.p, fatMax: cfg.fatMax != null ? cfg.fatMax : def.fatMax };
}
const targetJS = () => {
  const one = day => { const t = targetFor(day); return `${day}:{k:${t.k},p:${t.p},fatMax:${t.fatMax}}`; };
  return '    var TARGET = {' + one('train') + ', ' + one('rest') + '};';
};

/* ---------- extras stepper labels (generated into plan-web.html) ----------
   The .extras group labels (qty · ~kcal · note) used to be hand-written and
   duplicated the generated EXTRAS macros. They are now rendered from
   `extrasDisplay`; kcal comes from the resolved EX[key].k. The `key` MUST equal
   the live-calculator key used by bump('key',...) and id="x-key". */
function extraRow(item) {
  const ex = EX[item.key];
  if (!ex) throw new Error('extrasDisplay: unknown extras key: ' + item.key);
  const label = `${item.qty} · ~${ex.k} kcal` + (item.note ? ` · ${item.note}` : '');
  return `      <div class="extra"><span>${item.emoji} ${item.name}<small>${label}</small></span><div class="stepper"><button type="button" aria-label="menos ${item.name}" onclick="bump('${item.key}',-1)">−</button><span class="cnt" id="x-${item.key}">0</span><button type="button" aria-label="más ${item.name}" onclick="bump('${item.key}',1)">+</button></div></div>`;
}
function extrasGroup(group) {
  const lines = [`    <div class="combo-h">${group.header}</div>`];
  if (group.headerNote) lines.push(`    <p class="acc-note" style="margin:-2px 0 6px">${group.headerNote}</p>`);
  lines.push('    <div class="extras">');
  group.items.forEach(item => lines.push(extraRow(item)));
  lines.push('    </div>');
  return lines.join('\n');
}
const extrasDisplayBlock = () => [
  '    <!-- GEN:EXTRAS START — generated from plan-data.json by generate.js. DO NOT EDIT BY HAND. -->',
  EXTRASDISPLAY.map(extrasGroup).join('\n'),
  '    <!-- GEN:EXTRAS END -->',
].join('\n');

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
  targetJS(),
  '    /* GEN:DATA END */',
].join('\n');

const htmlPath = path.join(DIR, 'plan-web.html');
/* Pure: take current plan-web.html text, replace the 5 GEN regions, return new text.
   Throws (not process.exit) on a missing marker so callers/tests can handle it. */
function buildHtml(html) {
  const regions = [
    [/[ \t]*\/\* GEN:DATA START[\s\S]*?\/\* GEN:DATA END \*\//, htmlBlock, 'GEN:DATA'],
    [/[ \t]*<!-- GEN:BREAKFAST START[\s\S]*?<!-- GEN:BREAKFAST END -->/, brkBlock(), 'GEN:BREAKFAST'],
    [/[ \t]*<!-- GEN:DAYPLAN START[\s\S]*?<!-- GEN:DAYPLAN END -->/, dayPlanBlock(), 'GEN:DAYPLAN'],
    [/[ \t]*<!-- GEN:EXTRAS START[\s\S]*?<!-- GEN:EXTRAS END -->/, extrasDisplayBlock(), 'GEN:EXTRAS'],
  ];
  for (const [re, block, name] of regions) {
    if (!re.test(html)) throw new Error(name + ' markers not found in plan-web.html');
    html = html.replace(re, block);
  }
  return html;
}

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

/* breakfast detail as markdown — same recipes/source as the plan-web GEN:BREAKFAST block,
   so plan-tables.md carries the breakfast reference too (food-log no longer hand-maintains it). */
function brkTableMd(item) {
  const r = resolve(item);
  const cap = `${item.tier} ${item.cap} · ~${r.k} kcal · ${Math.round(r.p)} P · ${Math.round(r.c)} C · ${Math.round(r.g)} G`;
  const rows = brkRows(item.recipe).map(row => `| ${row.name} | ${brkQty(row)} | ${rk(row.k)} | ${rm(row.p)} | ${rm(row.c)} | ${rm(row.g)} |`);
  return [`**${cap}**`, '', '| Componente | Cant. | kcal | P | C | G |', '|---|---|---|---|---|---|', ...rows].join('\n');
}

function buildTables() {
const md = [];
md.push('# Plan — reference tables');
md.push('');
md.push('> GENERATED from `plan-data.json` by `generate.js`. **Do not edit this file by hand** —');
md.push('> edit `plan-data.json` and run `node data/nutrition/generate.js`. Macros in grams; this is');
md.push('> the per-serving reference, COMPUTED from the per-100g ingredient layer. Verified per-100g');
md.push('> product labels live in `plan-data.json` (`ingredients`, verified:true).');
md.push('> Not a doctor — see `CLAUDE.md`.');
md.push('');

md.push('## Breakfasts (A/B/C — itemized components)');
md.push('');
md.push('> Generated from the `desayuno` recipes in `plan-data.json` — same source as the plan-web cards.');
md.push('');
RAW.desayuno.filter(o => !o.none).forEach(item => { md.push(brkTableMd(item)); md.push(''); });

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

/* Legumes detail — per ~300 g cooked plate, COMPUTED from the legume ingredients.
   This used to be a hand-typed table in food-log.md duplicating the ingredient macros;
   it now renders from the single source (and is why those ingredients aren't orphans). */
md.push(`## Legumes — per ~${LEGUME_PLATE} g plate (carb + protein hybrid)`);
md.push('');
md.push('> The plan\'s "Legumbre (plato hondo)" row is a deliberate composite (any legume, ~345–420 kcal');
md.push('> by plate fullness). Per-type detail below is computed from the `ingredients` layer.');
md.push('');
const legumeRows = LEGUMES.map(k => {
  const ing = ING[k]; const f = LEGUME_PLATE / ing.per;
  return `| ${ing.name || k} | ~${LEGUME_PLATE} g | ${rk(ing.k * f)} | ${rm(ing.p * f)} | ${rm(ing.c * f)} | ${rm(ing.g * f)} |`;
});
md.push(['| Source | Amount | kcal | P | C | F |\n|---|---|---|---|---|---|', ...legumeRows].join('\n'));
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

/* Verified product labels (per-100g/ml/ud) — the single source for packaged-food
   macros. Rendered from `ingredients` where verified:true, so food-log.md no
   longer hand-maintains a second copy. */
md.push('## Verified product labels (real, per 100 g/ml/ud)');
md.push('');
md.push('> From the user\'s actual product photos — these OVERRIDE generic/database estimates.');
md.push('> SINGLE SOURCE: the `ingredients` (verified:true) in `plan-data.json`. Do not re-type these anywhere else.');
md.push('');
const labelHead = '| Product | Per | kcal | P | C | F | Note |\n|---|---|---|---|---|---|---|';
const labelRows = Object.values(ING)
  .filter(i => i.verified && i.name)
  .map(i => `| ${i.name} | 100 ${i.unit} | ${i.k} | ${i.p} | ${i.c} | ${i.g} | ${i.note || ''} |`);
md.push([labelHead, ...labelRows].join('\n'));
md.push('');

return md.join('\n');
}

/* ---------- integrity validation ----------
   Runs before every generate, and standalone via `node generate.js --check`.
   Catches the failure modes that would silently corrupt the plan numbers. */
function validate() {
  const errors = [];
  const warnings = [];
  const used = new Set();
  // every {ing,...} reference anywhere (recipe lines, dayPlan parts, breakfast lines)
  const walk = o => {
    if (Array.isArray(o)) return o.forEach(walk);
    if (o && typeof o === 'object') {
      if (typeof o.ing === 'string') { used.add(o.ing); if (!ING[o.ing]) errors.push('references unknown ingredient: ' + o.ing); }
      // hand-typed manual blocks are computed by nobody → sanity-check kcal vs Atwater (4·p+4·c+9·g)
      if (o.manual) {
        const m = o.manual, at = 4 * m.p + 4 * m.c + 9 * m.g;
        if (Math.abs(at - m.k) > Math.max(25, m.k * 0.15)) errors.push(`manual block fails Atwater sanity (k=${m.k} vs ~${Math.round(at)}): ${o.n || o.l || '?'}`);
      }
      for (const k of Object.keys(o)) if (k !== 'ingredients') walk(o[k]);
    }
  };
  walk(RAW); walk(RAWEX); walk(DAYPLAN);
  (LEGUMES || []).forEach(k => { used.add(k); if (!ING[k]) errors.push('legumeKeys references unknown ingredient: ' + k); });
  // Unused ingredients are a WARNING, not an error: ingredients.json is a shared
  // public food DB that may legitimately hold more foods than a given plan uses
  // (e.g. the example plan references only a subset). It is NOT corruption.
  for (const k of Object.keys(ING)) if (!used.has(k)) warnings.push('ingredient defined in ingredients.json but not used by this plan: ' + k);
  // key lists must resolve to real resolved-extras entries
  [...(QUESO || []), ...(VEG || [])].forEach(k => { if (!EX[k]) errors.push('queso/veg key has no extras entry: ' + k); });
  // dayPlan `match` must resolve unambiguously (exact name/label, or exactly one substring hit)
  for (const day of ['train', 'rest']) for (const meal of DAYPLAN[day].meals) for (const part of (meal.parts || [])) {
    if (!part.match) continue;
    const bucket = part.tier ? (RAW[part.use] && RAW[part.use][part.tier]) : RAW[part.use];
    if (!Array.isArray(bucket)) { errors.push(`dayPlan ${day} part: no bucket data.${part.use}${part.tier ? '.' + part.tier : ''}`); continue; }
    if (!bucket.some(o => o.n === part.match || o.l === part.match)) {
      const hits = bucket.filter(o => (o.n && o.n.includes(part.match)) || (o.l && o.l.includes(part.match))).length;
      if (hits !== 1) errors.push(`dayPlan ${day} part "${part.match}" resolves ambiguously (${hits} substring hits, no exact) in ${part.use}`);
    }
  }
  // day totals within a sane band — catches a gross bad edit, not a tight target
  const band = { train: [2000, 2800], rest: [1700, 2400] };
  for (const day of ['train', 'rest']) {
    const total = DAYPLAN[day].meals.reduce((s, m) => s + mealMacros(m).k, 0);
    const [lo, hi] = band[day];
    if (total < lo || total > hi) errors.push(`${day}-day total ${Math.round(total)} kcal outside sane band ${lo}-${hi}`);
  }
  if (errors.length) throw new Error('plan-data.json validation failed:\n  - ' + errors.join('\n  - '));
  return { ok: true, warnings };
}

function reportWarnings(warnings) {
  if (warnings && warnings.length) {
    console.warn('Validation warnings (' + warnings.length + '):\n  - ' + warnings.join('\n  - '));
  }
}

function main() {
  reportWarnings(validate().warnings);
  fs.writeFileSync(htmlPath, buildHtml(fs.readFileSync(htmlPath, 'utf8')));
  fs.writeFileSync(path.join(DIR, 'plan-tables.md'), buildTables());
  console.log('Generated: plan-web.html (GEN:DATA block) + plan-tables.md');
}

if (require.main === module) {
  if (process.argv.includes('--check')) { reportWarnings(validate().warnings); console.log('Validation OK: ingredients, recipes, day totals consistent.'); }
  else main();
}

module.exports = { ING, D, EX, MACRO, resolve, macro, mealMacros, buildHtml, buildTables, validate, RAW, RAWEX, DAYPLAN, LEGUMES, LEGUME_PLATE, dayTotalK, targetFor };
