/* Tests for the nutrition plan generator. Zero dependencies — Node's built-in
 * runner:  node --test  (from data/nutrition/) or  npm test.
 * Importing generate.js does NOT write files (I/O is guarded by require.main).
 * The generator merges two files: ingredients.json (public food DB) +
 * plan-data.json (personal plan). These tests exercise the merged result. */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const os = require('node:os');
const gen = require('./generate.js');

const { ING, D, macro, mealMacros, buildTables, buildHtml, validate, DAYPLAN, LEGUMES, LEGUME_PLATE } = gen;
const find = (arr, sub) => arr.find(o => (o.n || '').includes(sub));
const close = (a, b, tol = 0.5) => Math.abs(a - b) <= tol;

test('validate() passes on the merged ingredients.json + plan-data.json', () => {
  const res = validate();
  assert.equal(res.ok, true);
  // the owner's real plan uses every ingredient in the DB → no unused warnings
  assert.deepEqual(res.warnings, [], 'real plan should leave no unused ingredients: ' + res.warnings.join(', '));
});

test('the food DB lives in ingredients.json, not plan-data.json', () => {
  const planRaw = JSON.parse(fs.readFileSync(path.join(__dirname, 'plan-data.json'), 'utf8'));
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
    fs.copyFileSync(path.join(__dirname, 'plan-data.json'), path.join(dir, 'plan-data.json'));
    // a plan-web.html target so the error is the missing-ingredients one, not a missing template
    fs.writeFileSync(path.join(dir, 'plan-web.html'), '');
    assert.throws(
      () => execFileSync(process.execPath, ['generate.js', '--check'], { cwd: dir, stdio: 'pipe' }),
      /ingredients\.json not found/,
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
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

test('reconciled protein anchors hold their target grams', () => {
  // HANDOFF/CHANGELOG: Atún serving recomputed to hold the ~25 g anchor.
  assert.ok(close(find(D.anclaje, 'Atún natural').p, 25), 'Atún anchor should be ~25 g P');
  // Protein table is matched at ~40 g P by design; Claras = egg whites.
  assert.ok(close(find(D.proteina, 'Claras de huevo').p, 40, 1.0), 'Claras should be ~40 g P');
});

test('day totals are the computed values within a tight band', () => {
  const total = day => DAYPLAN[day].meals.reduce((s, m) => s + mealMacros(m).k, 0);
  assert.ok(close(total('train'), 2440, 60), 'train day ~2440 kcal');
  assert.ok(close(total('rest'), 2031, 60), 'rest day ~2031 kcal');
});

test('no orphan ingredients: every ingredient is referenced somewhere', () => {
  const used = new Set();
  const walk = o => {
    if (Array.isArray(o)) return o.forEach(walk);
    if (o && typeof o === 'object') {
      if (typeof o.ing === 'string') used.add(o.ing);
      for (const k of Object.keys(o)) if (k !== 'ingredients') walk(o[k]);
    }
  };
  walk(gen.RAW); walk(gen.RAWEX); walk(DAYPLAN);
  LEGUMES.forEach(k => used.add(k));
  const orphans = Object.keys(ING).filter(k => !used.has(k));
  assert.deepEqual(orphans, [], 'orphans: ' + orphans.join(', '));
});

test('legume detail table is single-sourced (computed, not hand-typed)', () => {
  const tables = buildTables();
  // Lentils row must equal ingredient × plate, proving it renders from the source.
  const k = Math.round(ING.lentejas.k * LEGUME_PLATE / ING.lentejas.per);
  assert.match(tables, new RegExp(`Lentils \\| ~${LEGUME_PLATE} g \\| ${k} `));
});

test('generation is idempotent (buildTables + buildHtml are stable)', () => {
  assert.equal(buildTables(), buildTables());
  const html = fs.readFileSync(path.join(__dirname, 'plan-web.html'), 'utf8');
  const once = buildHtml(html);
  assert.equal(buildHtml(once), once, 're-running buildHtml on its own output must be a no-op');
});
