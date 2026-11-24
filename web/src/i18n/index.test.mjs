import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getDict, es, en } from './index.mjs';

test('getDict: es and en resolve to their dictionary; anything else, an inherited key included, falls back to en', () => {
  assert.equal(getDict('es'), es);
  assert.equal(getDict('en'), en);
  for (const other of ['fr', '', null, undefined, 'toString', '__proto__']) assert.equal(getDict(other), en, String(other));
});
