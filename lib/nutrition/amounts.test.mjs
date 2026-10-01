/* lib/nutrition/amounts.mjs — the model line and its named accessors (never read positionally). */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LINE, modelLine, lineUnit, lineAmt, lineMac, lineStep, lineKey, pieceOf, scaleLine, isDiscrete } from './amounts.mjs';

const ING = {
  arroz: { per: 100, k: 360, p: 7, c: 79, g: 1, unit: 'g' },
  huevo: { per: 100, k: 72, p: 6, c: 0.4, g: 5, unit: 'ud', piece: { name: { es: 'huevo', en: 'egg' }, amt: 100, g: 50 } },
  platano: { per: 100, k: 88, p: 1, c: 22.5, g: 0.3, unit: 'g', piece: { name: { es: 'plátano', en: 'banana' }, amt: 120 } },
};

test('the line layout is named once: [unit, amt, k, p, c, g, step?, key?]', () => {
  assert.deepEqual({ ...LINE }, { UNIT: 0, AMT: 1, K: 2, P: 3, C: 4, G: 5, STEP: 6, KEY: 7 });
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
