/* Unit tests for web/test/dom-stub.mjs's own DOM surface — specifically the
 * `document.createElement('div'); el.textContent = s; el.innerHTML` HTML-
 * escaping round-trip (astro-plan-web slice 5's design note: "run legacy
 * IIFEs and Astro scripts in vm with stub DOM (... createElement escaping
 * ...)"). Training-today/training-dash's `esc()` helper (ported verbatim
 * from the legacy `<script>` block) relies on this exact browser behavior:
 * `&`/`<`/`>` are escaped, quotes are NOT (real browsers only escape quotes
 * when serializing an ATTRIBUTE, not a text node) — see
 * web/src/client/training-today.js. Also covers that innerHTML/textContent
 * stay independently overridable — used by the now-retired parity.test.mjs
 * and by web/src/client/nutrition.test.mjs's `<select>` stub, both of which
 * redefine element properties with Object.defineProperty and need that to
 * keep working. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { StubDocument, StubElement } from './dom-stub.mjs';

test('createElement + textContent then reading innerHTML escapes &, < and > (matches real DOM esc() idiom)', () => {
  const doc = new StubDocument();
  const el = doc.createElement('div');
  el.textContent = '<script>alert("x")</script> & stuff';
  assert.equal(el.innerHTML, '&lt;script&gt;alert("x")&lt;/script&gt; &amp; stuff');
});

test('createElement + textContent does NOT escape quotes (real textContent->innerHTML never touches quotes)', () => {
  const doc = new StubDocument();
  const el = doc.createElement('div');
  el.textContent = 'a "quoted" value';
  assert.equal(el.innerHTML, 'a "quoted" value');
});

test('registerCustom makes a caller-supplied node findable via getElementById and querySelectorAll', () => {
  const doc = new StubDocument();
  const node = { tag: 'select', classes: new Set(), attrs: { id: 'my-select' } };
  const registered = doc.registerCustom('my-select', node);
  assert.equal(registered, node, 'returns the same node it was given');
  assert.equal(doc.getElementById('my-select'), node);
  assert.deepEqual(doc.querySelectorAll('select'), [node]);
});

test('textContent getter returns the raw (unescaped) value that was set', () => {
  const doc = new StubDocument();
  const el = doc.createElement('div');
  el.textContent = '<b>raw</b>';
  assert.equal(el.textContent, '<b>raw</b>');
});

test('setting innerHTML directly stores it verbatim (no escaping) and does not touch textContent', () => {
  const el = new StubElement('div');
  el.innerHTML = '<b>trusted</b>';
  assert.equal(el.innerHTML, '<b>trusted</b>');
  assert.equal(el.textContent, '', 'innerHTML setter must not retroactively populate textContent');
});

test('innerHTML remains configurable — Object.defineProperty can still override it per-element (parity.test.mjs pattern for <select>)', () => {
  const el = new StubElement('select');
  assert.doesNotThrow(() => {
    Object.defineProperty(el, 'innerHTML', { set(v) { this._forced = v === ''; }, get() { return 'stub'; } });
  });
  el.innerHTML = '';
  assert.equal(el._forced, true);
  assert.equal(el.innerHTML, 'stub');
});
