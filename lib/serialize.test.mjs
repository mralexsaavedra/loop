/* Unit tests for lib/serialize.mjs — jsonForScript(), the safe JSON-in-<script> serializer of the baked
 * page globals (web/src/components/Bake.astro): JSON.stringify, then every literal `<` -> \\u003c,
 * U+2028 -> \\u2028, U+2029 -> \\u2029.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { jsonForScript } from './serialize.mjs';

test('jsonForScript serializes a plain object like JSON.stringify', () => {
  const out = jsonForScript({ a: 1, b: 'two', c: [1, 2, 3] });
  assert.equal(out, JSON.stringify({ a: 1, b: 'two', c: [1, 2, 3] }));
});

test('jsonForScript escapes every "<" so a </script> inside string data cannot close the tag early', () => {
  const out = jsonForScript({ html: '</script><script>alert(1)</script>' });
  assert.ok(!out.includes('<'), 'no raw "<" must survive in the output');
  assert.ok(out.includes('\\u003c'), 'escaped as \\u003c');
  // round-trips back to the original string once parsed (proves it is a safe, not lossy, escape)
  const roundTripSource = out.replace(/\\u003c/g, '<');
  assert.equal(JSON.parse(roundTripSource).html, '</script><script>alert(1)</script>');
});

test('jsonForScript escapes U+2028/U+2029 line/paragraph separators (invalid raw inside a <script> JS string)', () => {
  const out = jsonForScript({ s: 'line1' + String.fromCharCode(0x2028) + 'line2' + String.fromCharCode(0x2029) + 'end' });
  assert.ok(!out.includes(String.fromCharCode(0x2028)) && !out.includes(String.fromCharCode(0x2029)), 'raw U+2028/U+2029 must not survive');
  assert.match(out, /\\u2028/);
  assert.match(out, /\\u2029/);
});
