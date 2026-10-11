import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compareCss, updateFixture, buildDeclarationMap, serializeFixture } from './update-css-fixture.mjs';

const html = (css) => `<html><head><style>${css}</style></head><body></body></html>`;

test('compareCss reports both directions: fixture keys missing from the CSS and CSS declarations missing from the fixture', () => {
  const output = buildDeclarationMap(html('.a{color:red}.b{margin:0}'));
  const fixture = { '|||.a|||color': 'red', '|||.gone|||color': 'blue' };
  assert.deepEqual(compareCss(fixture, output), ['MISSING  |||.gone|||color = blue', 'EXTRA    |||.b|||margin = 0']);
});

test('compareCss reports a changed value and accepts a pre-minification fixture selector', () => {
  const output = buildDeclarationMap(html('@media (min-width:900px){.a>.b{color:red}}.c{gap:2px}'));
  const fixture = { '(min-width:900px)|||.a > .b|||color': 'red', '|||.c|||gap': '4px' };
  assert.deepEqual(compareCss(fixture, output), ['MISMATCH |||.c|||gap: expected="4px" output="2px"']);
});

test('compareCss skips allowlisted keys in either direction', () => {
  const output = buildDeclarationMap(html('.b{margin:0}'));
  const fixture = { '|||.gone|||color': 'blue' };
  assert.deepEqual(compareCss(fixture, output, new Set(['|||.b|||margin', '|||.gone|||color'])), []);
});

test('updateFixture keeps existing key order, updates values in place, drops stale keys and appends new ones', () => {
  const output = buildDeclarationMap(html('.new{top:0}.z{color:blue}.a{color:red}'));
  const fixture = { '|||.z|||color': 'red', '|||.stale|||color': 'red', '|||.a|||color': 'red' };
  const { fixture: next, added, removed, changed } = updateFixture(fixture, output);
  assert.deepEqual(Object.entries(next), [
    ['|||.z|||color', 'blue'],
    ['|||.a|||color', 'red'],
    ['|||.new|||top', '0'],
  ]);
  assert.deepEqual({ added, removed, changed }, { added: 1, removed: 1, changed: 1 });
});

test('updateFixture is a no-op on an up-to-date fixture (keeps the legacy key spelling)', () => {
  const output = buildDeclarationMap(html('.a>.b{color:red}'));
  const fixture = { '|||.a > .b|||color': 'red' };
  const { fixture: next } = updateFixture(fixture, output);
  assert.equal(serializeFixture(next), serializeFixture(fixture));
  assert.deepEqual(compareCss(next, output), []);
});
