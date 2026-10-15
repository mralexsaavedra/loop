/* The ingest service's src/journal-calc.js is GENERATED from lib/journal/journal.mjs: the committed file
 * must be exactly what the generator writes now (a lib change without `npm run gen:journal-calc` fails here). */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { journalCalcSource, JOURNAL_CALC_PATH, JOURNAL_CALC_HEADER } from './gen-journal-calc.mjs';
import * as J from '../lib/journal/journal.mjs';
import * as S from '../services/loop-ingest/src/journal-calc.js';

const committed = readFileSync(JOURNAL_CALC_PATH, 'utf8');

test('journal-calc.js starts with the GENERATED header', () => {
  assert.ok(committed.startsWith('/* ' + JOURNAL_CALC_HEADER), 'services/loop-ingest/src/journal-calc.js is not generated: run `npm run gen:journal-calc`');
});

test('journal-calc.js is current: regenerating it from the lib gives the committed bytes', () => {
  assert.ok(committed === journalCalcSource(), 'services/loop-ingest/src/journal-calc.js is out of date: run `npm run gen:journal-calc`');
});

test('the generator is deterministic', () => {
  assert.equal(journalCalcSource(), journalCalcSource());
});

test('the service module exports exactly the reference behaviours, groups and limits', () => {
  assert.deepEqual(Object.keys(S).sort(), ['JOURNAL_BEHAVIORS', 'JOURNAL_GROUPS', 'JOURNAL_LIMITS']);
  assert.deepEqual(S.JOURNAL_GROUPS, J.JOURNAL_GROUPS);
  assert.deepEqual(S.JOURNAL_BEHAVIORS, J.JOURNAL_BEHAVIORS);
  assert.deepEqual(S.JOURNAL_LIMITS, J.JOURNAL_LIMITS);
});

test('both generators: --help prints the usage, an unknown flag or a stray argument exits 2, --check exits 0 when current', async () => {
  const { spawnSync } = await import('node:child_process');
  const { statSync } = await import('node:fs');
  const { FOOD_CALC_PATH } = await import('./gen-food-calc.mjs');
  for (const [name, file] of [['gen-journal-calc.mjs', JOURNAL_CALC_PATH], ['gen-food-calc.mjs', FOOD_CALC_PATH]]) {
    const script = new URL('./' + name, import.meta.url).pathname;
    const before = statSync(file).mtimeMs;
    const run = (args) => spawnSync(process.execPath, [script, ...args], { encoding: 'utf8' });
    const help = run(['--help']);
    assert.equal(help.status, 0, name);
    assert.match(help.stdout, /^Usage: npm run gen:/);
    for (const args of [['--chek'], ['stray']]) {
      const r = run(args);
      assert.equal(r.status, 2, `${name} ${args}`);
      assert.match(r.stderr, /^ERROR: /);
    }
    assert.equal(run(['--check']).status, 0, name);
    assert.equal(statSync(file).mtimeMs, before, `${name} wrote nothing`);
  }
});
