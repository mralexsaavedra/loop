/* Tests for the nutrition plan generator. Zero dependencies — Node's built-in
 * runner:  node --test  (from data/nutrition/) or  npm test.
 * Importing generate.js does NOT write files (I/O is guarded by require.main).
 * The generator merges two files: ingredients.json (public food DB) +
 * plan-data.json (personal plan). These tests exercise the merged result. */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const os = require('node:os');
const gen = require('./generate.js');

const { ING, D, macro, mealMacros, buildTables, validate, DAYPLAN, LEGUMES, LEGUME_PLATE } = gen;
const close = (a, b, tol = 0.5) => Math.abs(a - b) <= tol;

test('generate.js no longer builds plan-web.html — buildHtml is not exported (astro-plan-web cutover)', () => {
  assert.equal(gen.buildHtml, undefined, 'HTML splicing moved to the Astro build; generate.js now only validates + writes plan-tables.md');
});

test('validate() passes on the merged ingredients.json + plan-data.json', () => {
  const res = validate();
  assert.equal(res.ok, true);
  // unused-ingredient warnings are EXPECTED and non-fatal: ingredients.json is a shared DB
  // that may hold more foods than a given plan uses (e.g. the example plan uses a subset).
  // Only `ok` is an invariant that holds for ANY user's plan.
  assert.ok(Array.isArray(res.warnings));
});

test('the food DB lives in ingredients.json, not plan-data.json', () => {
  const planRaw = JSON.parse(fs.readFileSync(gen.PLAN_PATH, 'utf8'));
  assert.ok(!('ingredients' in planRaw), 'plan-data.json must NOT carry an ingredients block (it ships in ingredients.json)');
  const ingRaw = JSON.parse(fs.readFileSync(path.join(__dirname, 'ingredients.json'), 'utf8'));
  assert.ok(ingRaw.ingredients && typeof ingRaw.ingredients === 'object', 'ingredients.json must have a top-level ingredients object');
  // generate.js merged them: every key the recipes resolve against comes from the public DB.
  assert.deepEqual(Object.keys(ING).sort(), Object.keys(ingRaw.ingredients).sort());
});

test('generate.js fails clearly when ingredients.json is missing', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'plan-no-ing-'));
  try {
    fs.copyFileSync(path.join(__dirname, 'generate.js'), path.join(dir, 'generate.js'));
    fs.copyFileSync(gen.PLAN_PATH, path.join(dir, 'plan-data.json'));
    assert.throws(
      () => execFileSync(process.execPath, ['generate.js', '--check'], { cwd: dir, stdio: 'pipe' }),
      /ingredients\.json not found/,
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('generate.js falls back to plan-data.example.json (with a clear warning) when the personal plan-data.json is absent — fresh clone with no seeds copied', () => {
  // Mirrors repo structure (data/nutrition/generate.js + ../../lib/nutrition/macros.mjs)
  // so generate.js's own require() resolves, WITHOUT ever copying the real
  // (possibly personal) plan-data.json — only ingredients.json + the tracked
  // .example seed, exactly like a fresh `git clone` with no bootstrap step run.
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'plan-no-personal-'));
  try {
    const nutDir = path.join(root, 'data', 'nutrition');
    fs.mkdirSync(nutDir, { recursive: true });
    fs.mkdirSync(path.join(root, 'lib', 'nutrition'), { recursive: true });
    fs.copyFileSync(path.join(__dirname, 'generate.js'), path.join(nutDir, 'generate.js'));
    fs.copyFileSync(path.join(__dirname, 'ingredients.json'), path.join(nutDir, 'ingredients.json'));
    fs.copyFileSync(path.join(__dirname, 'plan-data.example.json'), path.join(nutDir, 'plan-data.example.json'));
    // the whole lib/nutrition module set (macros.mjs imports its siblings), tests left out
    for (const f of fs.readdirSync(path.join(__dirname, '..', '..', 'lib', 'nutrition'))) {
      if (!f.endsWith('.mjs') || f.endsWith('.test.mjs')) continue;
      fs.copyFileSync(path.join(__dirname, '..', '..', 'lib', 'nutrition', f), path.join(root, 'lib', 'nutrition', f));
    }
    const res = spawnSync(process.execPath, ['generate.js', '--check'], { cwd: nutDir, encoding: 'utf8' });
    assert.equal(res.status, 0, `expected success, got status=${res.status}, stderr=${res.stderr}`);
    assert.match(res.stderr, /plan-data\.example\.json/, 'must say clearly it is validating the example seed, not silently succeed');
    assert.match(res.stdout, /Validation OK/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('macro() computes per-serving from the ingredient layer', () => {
  // lentejas = 115 kcal / 9 P / 20 C / 0.4 G per 100 g → a 300 g plate
  assert.equal(macro([{ ing: 'lentejas', amt: 300 }], 'k'), 345);
  assert.equal(macro([{ ing: 'lentejas', amt: 300 }], 'p'), 27);
  assert.equal(macro([{ ing: 'lentejas', amt: 300 }], 'c'), 60);
  assert.ok(close(macro([{ ing: 'lentejas', amt: 300 }], 'g'), 1.2, 0.01));
});

test('macro() throws on an unknown ingredient (integrity guard)', () => {
  assert.throws(() => macro([{ ing: '__nope__', amt: 1 }], 'k'), /unknown ingredient/);
});

test('protein items resolve to sane positive macros', () => {
  // Invariant for any plan: every real protein serving computes to positive kcal + protein
  // (not NaN/zero), proving the ingredient→macro layer works whatever foods are chosen.
  // The "— ninguno —" placeholder (none:true) resolves to 0 by design and is excluded.
  const items = D.proteina.filter(o => !o.none);
  assert.ok(items.length > 0, 'protein table should not be empty');
  for (const o of items) {
    assert.ok(o.p > 0 && o.k > 0, 'protein item ' + (o.n || o.l) + ' must have positive P and kcal');
  }
});

test('day totals fall within the sane band validate() enforces', () => {
  // Invariant: any plan's day totals sit inside the bands validate() guards (a gross bad
  // edit lands outside). Exact owner targets are not portable, so we assert the band.
  const total = day => DAYPLAN[day].meals.reduce((s, m) => s + mealMacros(m).k, 0);
  // Same band validate() uses: the plan's optional validation.kcalBand, else the default.
  const planRaw = JSON.parse(fs.readFileSync(gen.PLAN_PATH, 'utf8'));
  const band = (planRaw.validation && planRaw.validation.kcalBand) || { train: [2000, 2800], rest: [1700, 2400] };
  for (const day of ['train', 'rest']) {
    const t = total(day);
    assert.ok(t >= band[day][0] && t <= band[day][1], `${day} total ${Math.round(t)} kcal must be within ${band[day].join('-')}`);
  }
});

test('every ingredient referenced by the plan exists in the DB (no broken refs)', () => {
  // Invariant: a recipe/dayPlan may only reference ingredients that exist. (Unused
  // ingredients in the shared DB are fine — a non-fatal warning, not a broken plan.)
  const refs = new Set();
  const walk = o => {
    if (Array.isArray(o)) return o.forEach(walk);
    if (o && typeof o === 'object') {
      if (typeof o.ing === 'string') refs.add(o.ing);
      for (const k of Object.keys(o)) if (k !== 'ingredients') walk(o[k]);
    }
  };
  walk(gen.RAW); walk(gen.RAWEX); walk(DAYPLAN);
  LEGUMES.forEach(k => refs.add(k));
  const broken = [...refs].filter(k => !ING[k]);
  assert.deepEqual(broken, [], 'broken refs: ' + broken.join(', '));
});

test('legume reference table is single-sourced (computed, not hand-typed) and per 100 g cooked, not a portion', () => {
  const tables = buildTables();
  // Lentils row must equal the ingredient per its natural unit, proving it renders from the source
  // (named in the plan's locale: "Lentejas" in an es plan, "Lentils" in an en one).
  const { ingName } = require('../../lib/nutrition/names.mjs');
  assert.match(tables, new RegExp(`\\| ${ingName(ING, 'lentejas', gen.LOCALE)} \\| 100 g cooked \\| ${Math.round(ING.lentejas.k)} \\|`));
  assert.doesNotMatch(tables, new RegExp(`~${LEGUME_PLATE} g \\|`), 'no plate portion in the food tables');
});

test('plan-tables.md food tables are fixed reference values per natural unit (no train / rest portions)', () => {
  const tables = buildTables();
  assert.match(tables, /## Food reference \(fixed values per natural unit\)/);
  // Row names come from the plan's own option names (`n`, else `cap`, else `l`), which are in the plan's
  // language (an `es` plan says "Arroz" / "Plátano"), so look them up instead of hard-coding English.
  const single = (key) => {
    const lists = ['desayuno', 'carboComida', 'carboCena', 'proteina', 'anclaje', 'postentreno', 'postre'];
    const all = lists.flatMap((u) => { const v = gen.RAW[u] || []; return Array.isArray(v) ? v : Object.values(v).flat(); });
    const item = all.find((o) => o && Array.isArray(o.recipe) && o.recipe.length === 1 && o.recipe[0].ing === key);
    assert.ok(item, `the plan has a single-food ${key} option`);
    return String(item.n || item.cap || item.l);
  };
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const rice = single('arroz');
  assert.match(tables, new RegExp(`\\| ${esc(rice)} \\| 100 g dry \\| ${Math.round(ING.arroz.k)} \\|`));
  const banana = single('platano');
  const pc = ING.platano.piece;
  const bananaK = Math.round(ING.platano.k * pc.amt / ING.platano.per);
  assert.match(tables, new RegExp(`\\| ${esc(banana)} \\| 1 [^|]+ \\(~${pc.amt} g\\) _\\(typical weight\\)_ \\| ${bananaK} \\|`));
  assert.doesNotMatch(tables, /Training day|Rest day|\| Cant\. \|/);
});

test('live-calculator TARGET is single-sourced: k equals the generated day total', () => {
  // Regression guard. TARGET used to be a hand-maintained static line that drifted from
  // the plan (the Registro calculator graded "objetivo ~2570" while the plan prescribed
  // ~2440). targetFor(day).k is DERIVED from the same day total the Astro build bakes
  // (lib/nutrition/macros.mjs), so it cannot drift. p/fatMax stay owner-set (plan-data.json
  // `targets`, with defaults).
  for (const day of ['train', 'rest']) {
    assert.equal(gen.targetFor(day).k, gen.dayTotalK(day), `${day} target k must equal the generated day total`);
  }
});

test('plan-tables.md lists the 12 goal x day type targets with the scaled plan totals (single-sourced from lib/nutrition/scale.mjs)', () => {
  const tables = buildTables();
  assert.match(tables, /## Daily targets by goal and day type/);
  const rows = tables.split('\n').filter((l) => /^\| (maintain|cut|bulk) \| (rest|gym|bike|bikeLong) \|/.test(l));
  assert.equal(rows.length, 12);
});

test('generation is idempotent (buildTables is stable)', () => {
  assert.equal(buildTables(), buildTables());
});
