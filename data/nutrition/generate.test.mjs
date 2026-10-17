/* Tests for the nutrition plan generator. Zero dependencies — Node's built-in
 * runner:  node --test  (from data/nutrition/) or  npm test.
 * Importing generate.mjs reads and writes nothing: load() reads, main() (behind isMain) writes.
 * The generator merges two files: ingredients.json (public food DB) +
 * the personal plan (loop-data/cache/plan.json). These tests exercise the merged result. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import * as gen from './generate.mjs';
import { ingName } from '../../lib/nutrition/names.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.join(__dirname, '..', '..');

// Mirrors the repo structure generate.mjs statically imports (data/nutrition/generate.mjs +
// ../../lib/nutrition/*.mjs + ../../lib/date.mjs + ../../lib/paths.mjs + ../../scripts/lib/is-main.mjs) into a temp root, WITHOUT ever copying
// the real (possibly personal) plan. `files` are the data/nutrition seeds to copy next to it; 'plan-data.json'
// stands for the personal plan and lands where lib/paths.mjs puts it (loop-data/cache/plan.json).
// Returns the temp data/nutrition dir.
const personalOr = (nutDir, name) => {
  if (name !== 'plan-data.json') return path.join(nutDir, name);
  const file = path.join(nutDir, '..', '..', 'loop-data', 'cache', 'plan.json');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  return file;
};

function mirrorTree(root, files) {
  const nutDir = path.join(root, 'data', 'nutrition');
  fs.mkdirSync(nutDir, { recursive: true });
  fs.mkdirSync(path.join(root, 'lib', 'nutrition'), { recursive: true });
  fs.mkdirSync(path.join(root, 'scripts', 'lib'), { recursive: true });
  fs.copyFileSync(path.join(__dirname, 'generate.mjs'), path.join(nutDir, 'generate.mjs'));
  for (const [from, to] of files) fs.copyFileSync(from, personalOr(nutDir, to));
  // the whole lib/nutrition module set (macros.mjs imports its siblings), tests left out
  for (const f of fs.readdirSync(path.join(REPO, 'lib', 'nutrition'))) {
    if (!f.endsWith('.mjs') || f.endsWith('.test.mjs')) continue;
    fs.copyFileSync(path.join(REPO, 'lib', 'nutrition', f), path.join(root, 'lib', 'nutrition', f));
  }
  fs.copyFileSync(path.join(REPO, 'lib', 'date.mjs'), path.join(root, 'lib', 'date.mjs'));
  fs.copyFileSync(path.join(REPO, 'lib', 'paths.mjs'), path.join(root, 'lib', 'paths.mjs'));
  fs.copyFileSync(path.join(REPO, 'scripts', 'lib', 'is-main.mjs'), path.join(root, 'scripts', 'lib', 'is-main.mjs'));
  fs.mkdirSync(path.join(root, 'data', 'apple-health'), { recursive: true });
  fs.copyFileSync(path.join(REPO, 'data', 'apple-health', 'sync-common.mjs'), path.join(root, 'data', 'apple-health', 'sync-common.mjs'));
  return nutDir;
}

const ctx = gen.load();
const { ING, D, macro, mealMacros, DAYPLAN, LEGUMES, LEGUME_PLATE } = ctx;
const buildTables = () => gen.buildTables(ctx);
const validate = () => gen.validate(ctx);
const close = (a, b, tol = 0.5) => Math.abs(a - b) <= tol;

test('generate.mjs builds no HTML (no buildHtml export): it validates and writes plan-tables.md, the page is the Astro build', () => {
  assert.equal(gen.buildHtml, undefined, 'generate.mjs only validates + writes plan-tables.md');
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
  const planRaw = JSON.parse(fs.readFileSync(ctx.PLAN_PATH, 'utf8'));
  assert.ok(!('ingredients' in planRaw), 'plan-data.json must NOT carry an ingredients block (it ships in ingredients.json)');
  const ingRaw = JSON.parse(fs.readFileSync(path.join(__dirname, 'ingredients.json'), 'utf8'));
  assert.ok(ingRaw.ingredients && typeof ingRaw.ingredients === 'object', 'ingredients.json must have a top-level ingredients object');
  // generate.mjs merged them: every key the recipes resolve against comes from the public DB.
  assert.deepEqual(Object.keys(ING).sort(), Object.keys(ingRaw.ingredients).sort());
});

test('generate.mjs fails clearly when ingredients.json is missing', () => {
  // The lib imports are static (they resolve before the module body runs), so the mirrored tree carries
  // them: only ingredients.json is left out, and the error must name it, not a missing module.
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'plan-no-ing-'));
  try {
    const nutDir = mirrorTree(root, [[path.join(__dirname, 'plan-data.example.json'), 'plan-data.json']]);
    assert.throws(
      () => execFileSync(process.execPath, ['generate.mjs', '--check'], { cwd: nutDir, stdio: 'pipe' }),
      /ingredients\.json not found/,
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('generate.mjs falls back to plan-data.example.json (with a clear warning) when the personal plan (loop-data/cache/plan.json) is absent — fresh clone with no seeds copied', () => {
  // Only ingredients.json + the tracked .example seed, exactly like a fresh `git clone` with no
  // bootstrap step run.
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'plan-no-personal-'));
  try {
    const nutDir = mirrorTree(root, [
      [path.join(__dirname, 'ingredients.json'), 'ingredients.json'],
      [path.join(__dirname, 'plan-data.example.json'), 'plan-data.example.json'],
    ]);
    const res = spawnSync(process.execPath, ['generate.mjs', '--check'], { cwd: nutDir, encoding: 'utf8' });
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
  const planRaw = JSON.parse(fs.readFileSync(ctx.PLAN_PATH, 'utf8'));
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
  walk(ctx.RAW); walk(ctx.RAWEX); walk(DAYPLAN);
  LEGUMES.forEach(k => refs.add(k));
  const broken = [...refs].filter(k => !ING[k]);
  assert.deepEqual(broken, [], 'broken refs: ' + broken.join(', '));
});

test('legume reference table is single-sourced (computed, not hand-typed) and per 100 g cooked, not a portion', () => {
  const tables = buildTables();
  // Lentils row must equal the ingredient per its natural unit, proving it renders from the source
  // (named in the plan's locale: "Lentejas" in an es plan, "Lentils" in an en one).
  assert.match(tables, new RegExp(`\\| ${ingName(ING, 'lentejas', ctx.LOCALE)} \\| 100 g cooked \\| ${Math.round(ING.lentejas.k)} \\|`));
  assert.doesNotMatch(tables, new RegExp(`~${LEGUME_PLATE} g \\|`), 'no plate portion in the food tables');
});

test('plan-tables.md food tables are fixed reference values per natural unit (no train / rest portions)', () => {
  const tables = buildTables();
  assert.match(tables, /## Food reference \(fixed values per natural unit\)/);
  // Row names come from the plan's own option names (`n`, else `cap`, else `l`), which are in the plan's
  // language (an `es` plan says "Arroz" / "Plátano"), so look them up instead of hard-coding English.
  const single = (key) => {
    const lists = ['desayuno', 'carboComida', 'carboCena', 'proteina', 'anclaje', 'postentreno', 'postre'];
    const all = lists.flatMap((u) => { const v = ctx.RAW[u] || []; return Array.isArray(v) ? v : Object.values(v).flat(); });
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

test('generate.mjs no longer exports the removed day builder\'s targetFor(train|rest)', () => {
  assert.equal(gen.targetFor, undefined);
  assert.equal(ctx.targetFor, undefined);
  assert.equal(typeof ctx.dayTotalK, 'function');
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

test('strict CLI: --help prints the usage, a typo (--chek) or a stray argument exits 2 before any write', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'plan-cli-'));
  try {
    const nutDir = mirrorTree(root, [
      [path.join(__dirname, 'ingredients.json'), 'ingredients.json'],
      [path.join(__dirname, 'plan-data.example.json'), 'plan-data.json'],
    ]);
    const run = (...args) => spawnSync(process.execPath, ['generate.mjs', ...args], { cwd: nutDir, encoding: 'utf8' });
    const help = run('--help');
    assert.equal(help.status, 0);
    assert.match(help.stdout, /^Usage: node data\/nutrition\/generate\.mjs \[--check\]/);
    for (const args of [['--chek'], ['check']]) {
      const r = run(...args);
      assert.equal(r.status, 2, args.join(' '));
      assert.match(r.stderr, /^ERROR: /);
    }
    assert.ok(!fs.existsSync(path.join(nutDir, 'plan-tables.md')), 'nothing written');
    const ok = run();
    assert.equal(ok.status, 0, ok.stderr);
    assert.match(fs.readFileSync(path.join(nutDir, 'plan-tables.md'), 'utf8'), /^# Plan — reference tables/);
    assert.deepEqual(fs.readdirSync(nutDir).filter((f) => f.endsWith('.tmp')), [], 'written atomically, no temp file left');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('a malformed plan-data.json / ingredients.json is one ERROR line and exit 1, nothing written', () => {
  for (const bad of ['plan-data.json', 'ingredients.json']) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'plan-bad-json-'));
    try {
      const nutDir = mirrorTree(root, [
        [path.join(__dirname, 'ingredients.json'), 'ingredients.json'],
        [path.join(__dirname, 'plan-data.example.json'), 'plan-data.json'],
      ]);
      fs.writeFileSync(personalOr(nutDir, bad), '{ "not": json');
      const r = spawnSync(process.execPath, ['generate.mjs'], { cwd: nutDir, encoding: 'utf8' });
      assert.equal(r.status, 1, bad);
      const lines = r.stderr.trim().split('\n');
      assert.equal(lines.length, 1, r.stderr);
      const name = bad === 'plan-data.json' ? 'loop-data/cache/plan.json' : bad;
      assert.match(lines[0], new RegExp(`^ERROR: ${name.replace(/[./]/g, '\\$&')} is not valid JSON`));
      assert.ok(!fs.existsSync(path.join(nutDir, 'plan-tables.md')));
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  }
});

test('importing generate.mjs reads no file (load() does): it imports fine with no ingredients.json at all', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'plan-import-'));
  try {
    const nutDir = mirrorTree(root, []);
    const r = spawnSync(process.execPath, ['--input-type=module', '-e', "const g = await import('./generate.mjs'); console.log(typeof g.load);"], { cwd: nutDir, encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.stdout.trim(), 'function');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('generate.mjs --check exits non-zero, naming the line, on an {ing} part without an amt (never NaN in the tables)', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'plan-no-amt-'));
  try {
    const plan = JSON.parse(fs.readFileSync(path.join(__dirname, 'plan-data.example.json'), 'utf8'));
    const meal = plan.dayPlan.train.meals.find((m) => m.parts.some((p) => p.ing));
    const part = meal.parts.find((p) => p.ing);
    delete part.amt;
    const planFile = path.join(root, 'plan-src.json');
    fs.writeFileSync(planFile, JSON.stringify(plan));
    const nutDir = mirrorTree(root, [
      [path.join(__dirname, 'ingredients.json'), 'ingredients.json'],
      [planFile, 'plan-data.json'],
    ]);
    const res = spawnSync(process.execPath, ['generate.mjs', '--check'], { cwd: nutDir, encoding: 'utf8' });
    assert.notEqual(res.status, 0, 'a missing amt must fail the check');
    assert.match(res.stderr + res.stdout, /needs a numeric amt > 0 \(got undefined\)/);
    assert.doesNotMatch(res.stderr + res.stdout, /TypeError/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('load(): HC_DATA_DIR reads the personal plan from <data root>/cache/plan.json (ingredients.json stays the clone\'s)', () => {
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'plan-data-root-'));
  try {
    fs.mkdirSync(path.join(data, 'cache'));
    const plan = JSON.parse(fs.readFileSync(path.join(__dirname, 'plan-data.example.json'), 'utf8'));
    fs.writeFileSync(path.join(data, 'cache', 'plan.json'), JSON.stringify({ ...plan, locale: 'es' }));
    const warns = [];
    const ctx = gen.load({ env: { HC_DATA_DIR: data }, warn: (w) => warns.push(w) });
    assert.equal(ctx.PLAN_PATH, path.join(data, 'cache', 'plan.json'));
    assert.equal(ctx.LOCALE, 'es');
    assert.deepEqual(warns, []);
    // an empty data root: the tracked example plan, with the fresh-clone warning
    const empty = gen.load({ env: { HC_DATA_DIR: path.join(data, 'none') }, warn: (w) => warns.push(w) });
    assert.equal(empty.PLAN_PATH, path.join(__dirname, 'plan-data.example.json'));
    assert.match(warns[0], /personal plan .*none.*cache.*plan\.json not found/);
  } finally {
    fs.rmSync(data, { recursive: true, force: true });
  }
});

test('generate --check: a structurally broken plan (the audit\'s two documents) exits 1 with the validation message, never a TypeError', () => {
  const example = JSON.parse(fs.readFileSync(path.join(__dirname, 'plan-data.example.json'), 'utf8'));
  const { dayPlan: _drop, ...noDayPlan } = example;
  const docs = [{ data: { x: { y: 1 } }, targets: {}, dayPlan: {} }, noDayPlan, { ...example, data: { ...example.data, x: { y: 1 } } }];
  for (const doc of docs) {
    const data = fs.mkdtempSync(path.join(os.tmpdir(), 'plan-broken-'));
    try {
      fs.mkdirSync(path.join(data, 'cache'));
      fs.writeFileSync(path.join(data, 'cache', 'plan.json'), JSON.stringify(doc));
      const r = spawnSync(process.execPath, [path.join(__dirname, 'generate.mjs'), '--check'], { encoding: 'utf8', env: { ...process.env, HC_DATA_DIR: data } });
      assert.equal(r.status, 1, r.stdout + r.stderr);
      assert.match(r.stderr, /plan-data\.json validation failed:/);
      assert.doesNotMatch(r.stderr, /TypeError|is not a function|Cannot read prop/);
    } finally {
      fs.rmSync(data, { recursive: true, force: true });
    }
  }
});
