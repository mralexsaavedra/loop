/* lib/nutrition/amounts.mjs — the model line and its named accessors (never read positionally). */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { LINE, modelLine, lineUnit, lineAmt, lineMac, lineStep, lineKey, lineCap, capFactor, capAmount, floorToStep, GRID_EPS, pieceOf, scaleLine, isDiscrete, validateIngredientCaps, MAX_AMT_LIMIT } from './amounts.mjs';
import { isCarbStaple } from './flex.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const DB = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/nutrition/ingredients.json'), 'utf8')).ingredients;

const ING = {
  arroz: { per: 100, k: 360, p: 7, c: 79, g: 1, unit: 'g' },
  huevo: { per: 100, k: 72, p: 6, c: 0.4, g: 5, unit: 'ud', piece: { name: { es: 'huevo', en: 'egg' }, amt: 100, g: 50 } },
  platano: { per: 100, k: 88, p: 1, c: 22.5, g: 0.3, unit: 'g', piece: { name: { es: 'plátano', en: 'banana' }, amt: 120 } },
};

test('the line layout is named once: [unit, amt, k, p, c, g, step?, key?, cap?]', () => {
  assert.deepEqual({ ...LINE }, { UNIT: 0, AMT: 1, K: 2, P: 3, C: 4, G: 5, STEP: 6, KEY: 7, CAP: 8 });
});

test('accessors read a model line by name', () => {
  const rice = modelLine(ING, { ing: 'arroz', amt: 50 });
  assert.equal(lineUnit(rice), 'g');
  assert.equal(lineAmt(rice), 50);
  assert.deepEqual(lineMac(rice), [180, 3.5, 39.5, 0.5]);
  assert.equal(lineStep(rice), undefined);
  assert.equal(lineKey(rice), undefined);
  assert.equal(isDiscrete(rice), false);
  const banana = modelLine(ING, { ing: 'platano', amt: 120 });
  assert.equal(lineStep(banana), 60, 'half a piece');
  assert.equal(lineKey(banana), 'platano');
  assert.equal(isDiscrete(banana), true);
  const egg = modelLine(ING, { ing: 'huevo', amt: 200 });
  assert.equal(lineStep(egg), 100, 'whole units');
  assert.equal(isDiscrete(egg), true);
});

test('pieceOf: the baked piece entry of a countable line, else null', () => {
  const pieces = { platano: { a: 120, r: null, o: 'banana', m: 'bananas' } };
  assert.equal(pieceOf(pieces, modelLine(ING, { ing: 'platano', amt: 120 })), pieces.platano);
  assert.equal(pieceOf(pieces, modelLine(ING, { ing: 'arroz', amt: 120 })), null);
  assert.equal(pieceOf(null, modelLine(ING, { ing: 'platano', amt: 120 })), null);
  assert.equal(pieceOf({}, modelLine(ING, { ing: 'huevo', amt: 100 })), null);
});

test('scaleLine: the line at a new amount, macros proportional, step and key kept', () => {
  const banana = modelLine(ING, { ing: 'platano', amt: 120 });
  const two = scaleLine(banana, 240);
  assert.equal(lineAmt(two), 240);
  assert.deepEqual(lineMac(two), lineMac(banana).map((v) => v * 2));
  assert.equal(lineStep(two), 60);
  assert.equal(lineKey(two), 'platano');
  assert.notEqual(two, banana, 'a new array');
});

/* ---- realistic portion caps: optional `maxAmt` per ingredient (same scale as a recipe `amt`) ---- */
const CAPPED = {
  arroz: { ...ING.arroz, maxAmt: 150 },
  platano: { ...ING.platano, maxAmt: 250 },
  huevo: { ...ING.huevo, maxAmt: 300 },
};

test('a capped ingredient carries its cap on the model line (step / key null when it is not countable)', () => {
  const rice = modelLine(CAPPED, { ing: 'arroz', amt: 100 });
  assert.deepEqual(rice.slice(LINE.STEP), [null, null, 150]);
  assert.equal(lineCap(rice), 150);
  assert.equal(lineStep(rice), null);
  assert.equal(isDiscrete(rice), false, 'a cap does not make a gram line countable');
  const banana = modelLine(CAPPED, { ing: 'platano', amt: 120 });
  assert.deepEqual(banana.slice(LINE.STEP), [60, 'platano', 250]);
  assert.equal(isDiscrete(banana), true);
  assert.equal(lineCap(modelLine(ING, { ing: 'arroz', amt: 100 })), null, 'no maxAmt, no cap');
  assert.equal(lineCap(scaleLine(rice, 140)), 150, 'scaleLine keeps the cap (it is an absolute amount)');
});

test('capFactor: how far a line may scale before it reaches its cap (Infinity without one)', () => {
  assert.equal(capFactor(modelLine(CAPPED, { ing: 'arroz', amt: 100 })), 1.5);
  assert.equal(capFactor(modelLine(CAPPED, { ing: 'arroz', amt: 200 })), 0.75, 'a base amount above its cap must shrink');
  assert.equal(capFactor(modelLine(ING, { ing: 'arroz', amt: 100 })), Infinity);
});

test('capAmount: a rounded amount never exceeds the cap; it steps DOWN on the line grid', () => {
  const rice = modelLine(CAPPED, { ing: 'arroz', amt: 100 });
  assert.equal(capAmount(145, rice), 145);
  assert.equal(capAmount(155, rice), 150);
  const odd = modelLine({ arroz: { ...ING.arroz, maxAmt: 152 } }, { ing: 'arroz', amt: 100 });
  assert.equal(capAmount(155, odd), 150, '5 g grid');
  const banana = modelLine(CAPPED, { ing: 'platano', amt: 120 });
  assert.equal(capAmount(300, banana), 240, 'half pieces (60 g) below the 250 g cap');
  const eggs = modelLine(CAPPED, { ing: 'huevo', amt: 200 });
  assert.equal(capAmount(400, eggs), 300, 'whole units');
  assert.equal(capAmount(900, modelLine(ING, { ing: 'arroz', amt: 100 })), 900, 'no cap');
});

test('floorToStep: the largest grid multiple at or below the cap (epsilon-safe), never below one step', () => {
  assert.equal(GRID_EPS, 1e-9);
  assert.equal(floorToStep(152, 5), 150);
  assert.equal(floorToStep(150, 5), 150);
  assert.equal(floorToStep(250, 60), 240);
  assert.equal(floorToStep(0.3 * 3, 0.3), 0.3 * 3, 'float noise (0.9 / 0.3 = 2.9999…) does not drop a step');
  assert.equal(floorToStep(3, 5), 5, 'one step at least');
});

test('validateIngredientCaps: maxAmt must be a sane positive amount, at least one rounding step', () => {
  const errs = validateIngredientCaps({
    a: { ...ING.arroz, maxAmt: 0 },
    b: { ...ING.arroz, maxAmt: '150' },
    c: { ...ING.arroz, maxAmt: 3 },
    d: { ...ING.platano, maxAmt: 50 },
    e: { ...ING.huevo, maxAmt: 50 },
    f: { ...ING.arroz, maxAmt: MAX_AMT_LIMIT + 1 },
    g: { ...ING.arroz, maxAmt: Infinity },
  });
  for (const k of ['a', 'b', 'c', 'd', 'e', 'f', 'g']) assert.equal(errs.filter((e) => e.startsWith(`ingredient ${k}: maxAmt`)).length, 1, `${k}: ${errs.join(' | ')}`);
  assert.deepEqual(validateIngredientCaps(CAPPED), []);
  assert.deepEqual(validateIngredientCaps(ING), [], 'maxAmt is optional');
});

test('the tracked food DB caps every carb and fruit food and every sweet carb staple (honey, jam), all valid', () => {
  assert.deepEqual(validateIngredientCaps(DB), []);
  for (const [k, ing] of Object.entries(DB)) {
    const auto = ing.cat === 'carb' || ing.cat === 'fruit' || (ing.cat === 'sweet' && isCarbStaple(DB, { recipe: [{ ing: k, amt: ing.per }] }));
    if (auto) assert.ok(typeof ing.maxAmt === 'number', `${k} (${ing.cat}) has a maxAmt`);
  }
  assert.equal(DB.pasta.maxAmt, 150);
  assert.equal(DB.arroz.maxAmt, 150);
  assert.equal(DB.avena.maxAmt, 100);
  assert.equal(DB.patata.maxAmt, 400);
  assert.equal(DB.miel.maxAmt, 30);
});
