import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { addCsp, cspFor, delegateLegacyHandlers, inlineHandlers, scriptHashes } from './csp.mjs';

const sha = (s) => `'sha256-${createHash('sha256').update(s, 'utf8').digest('base64')}'`;
const page = '<!DOCTYPE html><html><head><meta charset="utf-8"><style>a{}</style></head><body><script>var A=1;</script><script>var B="é";</script></body></html>';

test('scriptHashes: the sha256 of every inline script body, in order (UTF-8 bytes)', () => {
  assert.deepEqual(scriptHashes(page), [sha('var A=1;'), sha('var B="é";')]);
});

test('cspFor: hashes only for scripts, never unsafe-inline; a page without scripts gets script-src none', () => {
  const p = cspFor(page);
  assert.match(p, new RegExp(`script-src ${sha('var A=1;').replace(/[+/]/g, '\\$&')} `));
  assert.doesNotMatch(p.split('; ').find((d) => d.startsWith('script-src')), /unsafe/);
  assert.match(cspFor('<p></p>'), /script-src 'none'/);
  assert.equal(cspFor(page + '<script>var A=1;</script>').split(sha('var A=1;')).length, 2, 'a repeated script is listed once');
});

test('addCsp: the meta sits right after <meta charset>; a page without one throws', () => {
  const out = addCsp(page);
  assert.ok(out.startsWith('<!DOCTYPE html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src'));
  assert.throws(() => addCsp('<html><head></head></html>'), /no <meta charset/);
});

test('delegateLegacyHandlers: jump / setTab onclick become data-jump / data-tab-go; other handlers stay', () => {
  assert.equal(delegateLegacyHandlers(`<button class="lnk" onclick="jump('acc-fruta')">x</button>`), '<button class="lnk" data-jump="acc-fruta">x</button>');
  assert.equal(delegateLegacyHandlers(`<a onclick="setTab('nutricion')">x</a>`), '<a data-tab-go="nutricion">x</a>');
  assert.equal(delegateLegacyHandlers(`<a onclick="alert(1)">x</a>`), `<a onclick="alert(1)">x</a>`);
});

test('inlineHandlers: finds on*= attributes in markup and in script strings; none on a clean page', () => {
  assert.deepEqual(inlineHandlers(`<a onclick="x()"></a><img onerror='y'>`), ['onclick="', "onerror='"]);
  assert.deepEqual(inlineHandlers(`'<b onmouseover=\\"z\\">'`), ['onmouseover=\\"']);
  assert.deepEqual(inlineHandlers(page), []);
});
