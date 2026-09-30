/* scripts/migrate-plan-v2.mjs — upgrades a personal plan-data.json to nutrition v2 (targets.byGoal,
 * carb-flex markers, page.goal). SYNTHETIC fixtures only: never the owner's plan. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { migratePlanV2, runMigration, STAPLE_KEYS, FRUIT_KEYS, backupPath, localDate, parseArgs } from './migrate-plan-v2.mjs';
import { DEFAULT_BY_GOAL } from '../lib/nutrition/targets.mjs';
import { validateNutrition } from '../lib/nutrition/macros.mjs';

const ING = {
  arroz: { per: 100, k: 360, p: 7, c: 79, g: 1, unit: 'g' },
  patata: { per: 100, k: 86, p: 1.9, c: 19.2, g: 0.1, unit: 'g' },
  panecillo: { per: 100, k: 259, p: 8.2, c: 51, g: 1.1, unit: 'g' },
  miel: { per: 100, k: 304, p: 0.3, c: 82, g: 0, unit: 'g' },
  platano: { per: 100, k: 88, p: 0.8, c: 22.5, g: 0.3, unit: 'g' },
  manzana: { per: 100, k: 52, p: 0.3, c: 14, g: 0.2, unit: 'g' },
  pollo: { per: 100, k: 109, p: 22.9, c: 0, g: 2.3, unit: 'g' },
  wheyup: { per: 100, k: 379, p: 71.5, c: 10.5, g: 5.7, unit: 'g' },
  leche: { per: 100, k: 46, p: 3.4, c: 4.8, g: 1.7, unit: 'ml' },
  aceiteoliva: { per: 100, k: 900, p: 0, c: 0, g: 100, unit: 'g' },
};

function fixture() {
  return {
    data: {
      carbo: { train: [{ n: 'Arroz', recipe: [{ ing: 'arroz', amt: 130 }] }], rest: [{ n: 'Arroz', recipe: [{ ing: 'arroz', amt: 100 }] }] },
      postre: [{ n: 'Manzana', recipe: [{ ing: 'manzana', amt: 150 }] }],
      postentreno: [{ n: 'Plátano + batido', recipe: [{ ing: 'platano', amt: 120 }, { ing: 'wheyup', amt: 20 }] }],
      legumbre: [{ n: 'Lentejas', manual: { k: 380, p: 25, c: 63, g: 4 } }],
    },
    extras: {},
    dayPlan: {
      train: {
        meals: [
          { name: 'Comida', parts: [{ ing: 'pollo', amt: 400 }, { use: 'carbo', tier: 'train', match: 'Arroz' }, { use: 'postre', match: 'Manzana' }] },
          { name: 'Pre-entreno', parts: [{ ing: 'leche', amt: 90 }, { ing: 'panecillo', amt: 45 }, { ing: 'miel', amt: 30 }] },
          { name: 'Post-entreno', parts: [{ use: 'postentreno', match: 'Plátano' }] },
          { name: 'Cena', parts: [{ ing: 'pollo', amt: 400 }, { ing: 'patata', amt: 700 }, { use: 'legumbre', match: 'Lentejas' }, { ing: 'aceiteoliva', amt: 15 }] },
        ],
      },
      rest: {
        meals: [
          { name: 'Comida', parts: [{ ing: 'pollo', amt: 400 }, { use: 'carbo', tier: 'rest', match: 'Arroz' }, { ing: 'patata', amt: 200, flex: null }] },
          { name: 'Cena', parts: [{ ing: 'pollo', amt: 300 }, { ing: 'patata', amt: 900 }, { ing: 'aceiteoliva', amt: 11 }] },
        ],
      },
    },
    targets: { train: { p: 150, fatMax: 75 } },
    page: { title: 'Mi plan', hideTabs: ['hoy'] },
  };
}

test('the default flex set is carb STAPLES only; fruit, honey, jam and juice are opt-in (--include-fruit)', () => {
  for (const k of ['arroz', 'rice', 'pasta', 'pan', 'panecillo', 'bread', 'patata', 'potato', 'avena', 'oats', 'cuscus', 'couscous', 'quinoa', 'wrap', 'tortillatrigo']) {
    assert.ok(STAPLE_KEYS.includes(k), k);
  }
  for (const k of ['miel', 'honey', 'platano', 'banana', 'manzana', 'apple', 'naranja', 'zumonaranja', 'mermelada', 'pera']) {
    assert.ok(!STAPLE_KEYS.includes(k), `${k} is not a staple`);
    assert.ok(FRUIT_KEYS.includes(k), `${k} is opt-in`);
  }
  assert.ok(!STAPLE_KEYS.includes('tortilla'), 'a Spanish "tortilla" is an omelette, not a wrap');
  for (const k of ['pollo', 'wheyup', 'leche', 'aceiteoliva', 'avellanas', 'lentejas']) assert.ok(!STAPLE_KEYS.includes(k) && !FRUIT_KEYS.includes(k), k);
});

test('adds targets.byGoal (the approved numbers), page.goal and flex markers on staple-carb parts only', () => {
  const { plan, changes } = migratePlanV2(fixture(), ING);
  for (const g of Object.keys(DEFAULT_BY_GOAL)) assert.deepEqual(plan.targets.byGoal[g], JSON.parse(JSON.stringify(DEFAULT_BY_GOAL[g])));
  assert.equal(plan.targets.train.p, 150, 'the day builder targets stay');
  assert.equal(plan.page.goal, 'maintain');
  assert.deepEqual(plan.page.hideTabs, ['hoy'], 'nothing else in page is touched');
  const tr = plan.dayPlan.train.meals;
  assert.equal(tr[0].parts[0].flex, undefined, 'protein stays fixed');
  assert.equal(tr[0].parts[1].flex, 'carb', 'rice item');
  assert.equal(tr[0].parts[2].flex, undefined, 'fruit is not scaled by default');
  assert.deepEqual(tr[1].parts.map((p) => p.flex), [undefined, 'carb', undefined], 'milk fixed; bread flex; honey not by default');
  assert.equal(tr[2].parts[0].flex, undefined, 'banana + whey is mixed: not scaled');
  assert.deepEqual(tr[3].parts.map((p) => p.flex), [undefined, 'carb', undefined, undefined], 'potato flex; legumes (manual) and oil fixed');
  assert.equal(plan.dayPlan.rest.meals[0].parts[2].flex, null, 'an explicit flex: null opts a part out');
  assert.ok(changes.length >= 4);
  assert.match(changes.join('\n'), /targets\.byGoal/);
  assert.match(changes.join('\n'), /page\.goal/);
  assert.match(changes.join('\n'), /train · Comida · Arroz/);
});

test('--include-fruit also marks fruit and honey (still never a mixed item)', () => {
  const { plan } = migratePlanV2(fixture(), ING, { includeFruit: true });
  const tr = plan.dayPlan.train.meals;
  assert.equal(tr[0].parts[2].flex, 'carb', 'apple');
  assert.deepEqual(tr[1].parts.map((p) => p.flex), [undefined, 'carb', 'carb']);
  assert.equal(tr[2].parts[0].flex, undefined, 'banana + whey stays fixed');
});

// a plan migrated by the first version of this script (fruit + honey were marked too)
function oldMigrated() {
  const plan = migratePlanV2(fixture(), ING, { includeFruit: true }).plan;
  plan.dayPlan.rest.meals[1].parts[1].flex = null; // the owner opted a potato out by hand
  return plan;
}

test('--reset-flex re-derives the markers: drops the non-staple "carb" marks, keeps staples and opt-outs', () => {
  const { plan, changes } = migratePlanV2(oldMigrated(), ING, { resetFlex: true });
  const tr = plan.dayPlan.train.meals;
  assert.equal(tr[0].parts[1].flex, 'carb', 'rice stays');
  assert.equal('flex' in tr[0].parts[2], false, 'apple: mark removed');
  assert.deepEqual(tr[1].parts.map((p) => p.flex), [undefined, 'carb', undefined], 'honey unmarked, bread kept');
  assert.equal('flex' in tr[1].parts[2], false);
  assert.equal(plan.dayPlan.rest.meals[1].parts[1].flex, null, 'a flex: null opt-out is never touched');
  assert.equal(plan.dayPlan.rest.meals[0].parts[2].flex, null);
  assert.match(changes.join('\n'), /train · Comida · Manzana: removed flex "carb"/);
  assert.match(changes.join('\n'), /train · Pre-entreno · miel: removed flex "carb"/);
  // idempotent
  assert.deepEqual(migratePlanV2(plan, ING, { resetFlex: true }).changes, []);
  // with --include-fruit the fruit marks are part of the set again: nothing removed
  assert.deepEqual(migratePlanV2(oldMigrated(), ING, { resetFlex: true, includeFruit: true }).changes, []);
});

test('--reset-flex also marks staples that were never marked; without it existing flex keys are left alone', () => {
  const p = oldMigrated();
  delete p.dayPlan.train.meals[3].parts[1].flex; // potato lost its mark
  const reset = migratePlanV2(p, ING, { resetFlex: true }).plan;
  assert.equal(reset.dayPlan.train.meals[3].parts[1].flex, 'carb');
  const plain = migratePlanV2(oldMigrated(), ING);
  assert.equal(plain.plan.dayPlan.train.meals[0].parts[2].flex, 'carb', 'no reset: the old fruit mark stays');
});

test('a non-object targets or page is an error, never replaced', () => {
  const t = fixture();
  t.targets = [1, 2];
  assert.throws(() => migratePlanV2(t, ING), /targets.*must be an object/);
  const p = fixture();
  p.page = 'x';
  assert.throws(() => migratePlanV2(p, ING), /page.*must be an object/);
  const n = fixture();
  delete n.targets;
  n.page = null;
  const r = migratePlanV2(n, ING).plan;
  assert.equal(typeof r.targets.byGoal, 'object', 'absent / null blocks are created');
  assert.equal(r.page.goal, 'maintain');
});

test('localDate is the local calendar date (the backup name), not the UTC one', () => {
  assert.equal(localDate(new Date(2030, 0, 10, 0, 30)), '2030-01-10');
  assert.equal(localDate(new Date(2030, 11, 31, 23, 59)), '2030-12-31');
});

test('parseArgs: flags and --file', () => {
  assert.deepEqual(parseArgs(['--reset-flex', '--dry-run', '--include-fruit', '--file', 'x.json']), { dryRun: true, resetFlex: true, includeFruit: true, file: 'x.json' });
  assert.deepEqual(parseArgs([]), { dryRun: false, resetFlex: false, includeFruit: false, file: null });
  assert.throws(() => parseArgs(['--nope']), /unknown option/);
});

test('idempotent: a migrated plan has nothing left to change; an existing byGoal / goal is kept', () => {
  const once = migratePlanV2(fixture(), ING).plan;
  const twice = migratePlanV2(once, ING);
  assert.deepEqual(twice.changes, []);
  assert.deepEqual(twice.plan, once);
  const own = fixture();
  own.targets.byGoal = { cut: { rest: { kcal: 2000, p: 170, f: 50 } } };
  own.page.goal = 'cut';
  const r = migratePlanV2(own, ING).plan;
  assert.deepEqual(r.targets.byGoal, { cut: { rest: { kcal: 2000, p: 170, f: 50 } } });
  assert.equal(r.page.goal, 'cut');
});

test('the migrated fixture passes validateNutrition (bands widened for the synthetic plan)', () => {
  const { plan } = migratePlanV2(fixture(), ING);
  plan.validation = { kcalBand: { train: [1000, 6000], rest: [1000, 6000] } };
  assert.equal(validateNutrition(ING, plan).ok, true);
});

function tmpPlan() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'migrate-v2-'));
  const file = path.join(dir, 'plan-data.json');
  const ingFile = path.join(dir, 'ingredients.json');
  fs.writeFileSync(file, JSON.stringify(fixture(), null, 2) + '\n');
  fs.writeFileSync(ingFile, JSON.stringify({ ingredients: ING }));
  return { dir, file, ingFile };
}

test('runMigration: backs up to .pre-v2-<date>.bak first, writes in place; a second run writes nothing', () => {
  const { dir, file, ingFile } = tmpPlan();
  try {
    const before = fs.readFileSync(file, 'utf8');
    const log = [];
    const r1 = runMigration({ file, ingredientsFile: ingFile, today: '2030-01-10', log: (l) => log.push(l) });
    assert.equal(r1.written, true);
    const bak = backupPath(file, '2030-01-10');
    assert.equal(bak, file + '.pre-v2-2030-01-10.bak');
    assert.equal(fs.readFileSync(bak, 'utf8'), before, 'the backup is the untouched original');
    const after = JSON.parse(fs.readFileSync(file, 'utf8'));
    assert.equal(after.page.goal, 'maintain');
    assert.match(log.join('\n'), /Backup:/);
    const mtime = fs.statSync(file).mtimeMs;
    const r2 = runMigration({ file, ingredientsFile: ingFile, today: '2030-01-11', log: () => {} });
    assert.equal(r2.written, false);
    assert.equal(fs.statSync(file).mtimeMs, mtime);
    assert.equal(fs.existsSync(backupPath(file, '2030-01-11')), false, 'no backup when nothing changes');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('runMigration --dry-run reports without touching the file; an existing same-day backup is never overwritten', () => {
  const { dir, file, ingFile } = tmpPlan();
  try {
    const before = fs.readFileSync(file, 'utf8');
    const r = runMigration({ file, ingredientsFile: ingFile, today: '2030-01-10', dryRun: true, log: () => {} });
    assert.equal(r.written, false);
    assert.ok(r.changes.length > 0);
    assert.equal(fs.readFileSync(file, 'utf8'), before);
    fs.writeFileSync(backupPath(file, '2030-01-10'), 'older backup');
    runMigration({ file, ingredientsFile: ingFile, today: '2030-01-10', log: () => {} });
    assert.equal(fs.readFileSync(backupPath(file, '2030-01-10'), 'utf8'), 'older backup');
    assert.equal(fs.readFileSync(backupPath(file, '2030-01-10') + '.1', 'utf8'), before);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('runMigration: a missing plan file is a clear error', () => {
  assert.throws(() => runMigration({ file: '/nonexistent/plan-data.json', ingredientsFile: '/nonexistent/i.json', log: () => {} }), /not found/);
});

test('runMigration --dry-run prints the resulting carb factor and remainder per goal x day type', () => {
  const { dir, file, ingFile } = tmpPlan();
  try {
    const log = [];
    runMigration({ file, ingredientsFile: ingFile, today: '2030-01-10', dryRun: true, log: (l) => log.push(l) });
    const out = log.join('\n');
    for (const g of ['maintain', 'cut', 'bulk']) for (const d of ['rest', 'gym', 'bike', 'bikeLong']) {
      assert.match(out, new RegExp(`${g} +${d} +×\\d+\\.\\d\\d( \\((min|max)\\))? +remainder +[+-]?\\d+ kcal`), `${g}/${d}`);
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('runMigration writes atomically (no temp file left), 2-space JSON with a trailing newline', () => {
  const { dir, file, ingFile } = tmpPlan();
  try {
    runMigration({ file, ingredientsFile: ingFile, today: '2030-01-10', log: () => {} });
    const out = fs.readFileSync(file, 'utf8');
    assert.ok(out.endsWith('}\n'));
    assert.match(out, /^\{\n  "data": \{\n    "carbo"/);
    assert.deepEqual(fs.readdirSync(dir).sort(), ['ingredients.json', 'plan-data.json', 'plan-data.json.pre-v2-2030-01-10.bak']);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('runMigration --reset-flex backs up first and only then rewrites', () => {
  const { dir, file, ingFile } = tmpPlan();
  try {
    fs.writeFileSync(file, JSON.stringify(oldMigrated(), null, 2) + '\n');
    const before = fs.readFileSync(file, 'utf8');
    const r = runMigration({ file, ingredientsFile: ingFile, today: '2030-01-10', resetFlex: true, log: () => {} });
    assert.equal(r.written, true);
    assert.equal(fs.readFileSync(r.backup, 'utf8'), before);
    assert.equal('flex' in JSON.parse(fs.readFileSync(file, 'utf8')).dayPlan.train.meals[0].parts[2], false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
