/* scripts/migrate-plan-v2.mjs — upgrades a personal plan-data.json to nutrition v2 (targets.byGoal,
 * carb-flex markers, page.goal). SYNTHETIC fixtures only: never the owner's plan. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { migratePlanV2, runMigration, CARB_KEYS, backupPath } from './migrate-plan-v2.mjs';
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

test('the carb key list covers the obvious carb staples (es + en keys), and no protein / fat food', () => {
  for (const k of ['arroz', 'rice', 'pasta', 'pan', 'panecillo', 'bread', 'patata', 'potato', 'boniato', 'avena', 'oats', 'miel', 'honey', 'platano', 'banana', 'manzana', 'apple', 'naranja', 'pera', 'uvas']) {
    assert.ok(CARB_KEYS.includes(k), k);
  }
  for (const k of ['pollo', 'wheyup', 'leche', 'aceiteoliva', 'avellanas', 'lentejas']) assert.ok(!CARB_KEYS.includes(k), k);
});

test('adds targets.byGoal (the approved numbers), page.goal and flex markers on pure-carb parts only', () => {
  const { plan, changes } = migratePlanV2(fixture(), ING);
  for (const g of Object.keys(DEFAULT_BY_GOAL)) assert.deepEqual(plan.targets.byGoal[g], JSON.parse(JSON.stringify(DEFAULT_BY_GOAL[g])));
  assert.equal(plan.targets.train.p, 150, 'the day builder targets stay');
  assert.equal(plan.page.goal, 'maintain');
  assert.deepEqual(plan.page.hideTabs, ['hoy'], 'nothing else in page is touched');
  const tr = plan.dayPlan.train.meals;
  assert.equal(tr[0].parts[0].flex, undefined, 'protein stays fixed');
  assert.equal(tr[0].parts[1].flex, 'carb', 'rice item');
  assert.equal(tr[0].parts[2].flex, 'carb', 'fruit item');
  assert.deepEqual(tr[1].parts.map((p) => p.flex), [undefined, 'carb', 'carb'], 'milk fixed; bread + honey flex');
  assert.equal(tr[2].parts[0].flex, undefined, 'banana + whey is mixed: not scaled');
  assert.deepEqual(tr[3].parts.map((p) => p.flex), [undefined, 'carb', undefined, undefined], 'potato flex; legumes (manual) and oil fixed');
  assert.equal(plan.dayPlan.rest.meals[0].parts[2].flex, null, 'an explicit flex: null opts a part out');
  assert.ok(changes.length >= 4);
  assert.match(changes.join('\n'), /targets\.byGoal/);
  assert.match(changes.join('\n'), /page\.goal/);
  assert.match(changes.join('\n'), /train · Comida · Arroz/);
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
