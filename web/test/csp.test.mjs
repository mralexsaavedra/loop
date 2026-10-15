/* The built page ships a real Content-Security-Policy and no inline event handler (web/src/csp.mjs, the
 * `page-post-build` integration in web/astro.config.mjs): every inline script is allowed by its sha256,
 * never by 'unsafe-inline', so an onclick= that comes back would be blocked in the browser. Reads the
 * pretest fixtures (`npm run pretest`); the personal fixture is checked only when it exists. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.join(path.dirname(here), '.test-dist');

const policyOf = (html) => {
  const m = /<meta http-equiv="Content-Security-Policy" content="([^"]+)">/.exec(html);
  assert.ok(m, 'a Content-Security-Policy meta');
  return { at: m.index, map: Object.fromEntries(m[1].split(';').map((d) => d.trim().split(/\s+/)).map(([k, ...v]) => [k, v])) };
};

for (const fixture of ['en-example', 'es-personal']) {
  const htmlPath = path.join(DIST, fixture, 'index.html');
  const skip = fixture === 'es-personal' && !fs.existsSync(htmlPath);

  test(`${fixture}: no inline event handler (on*=) in the markup or in the scripts that build markup`, { skip }, () => {
    const html = fs.readFileSync(htmlPath, 'utf8');
    assert.deepEqual([...html.matchAll(/\son[a-z]+=\\?["']/gi)].map((m) => html.slice(m.index, m.index + 40)), []);
  });

  test(`${fixture}: the CSP meta comes first in <head> and allows exactly the page's inline scripts, by hash`, { skip }, () => {
    const html = fs.readFileSync(htmlPath, 'utf8');
    const { at, map } = policyOf(html);
    const firstTag = Math.min(...['<style', '<script', '<link'].map((t) => html.indexOf(t)).filter((i) => i !== -1));
    assert.ok(at < firstTag, 'before every style, script and link it governs');
    assert.deepEqual(map['default-src'], ["'none'"]);
    const scripts = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
    assert.ok(scripts.length > 10, 'the page has its inline scripts');
    const hashes = new Set(scripts.map((s) => `'sha256-${createHash('sha256').update(s, 'utf8').digest('base64')}'`));
    assert.deepEqual(new Set(map['script-src']), hashes, 'one hash per distinct inline script, nothing else');
    for (const bad of ["'unsafe-inline'", "'unsafe-eval'", "'unsafe-hashes'", "'strict-dynamic'", '*', 'data:']) {
      assert.ok(!map['script-src'].includes(bad), `script-src never carries ${bad}`);
    }
    assert.deepEqual(map['connect-src'], ["'self'"], 'the LAN APIs are same-origin');
    assert.deepEqual(map['img-src'], ['data:']);
    assert.deepEqual(map['font-src'], ['data:']);
    assert.deepEqual(map['object-src'], ["'none'"]);
    assert.deepEqual(map['base-uri'], ["'none'"]);
  });
}

test('en-example: every former onclick action is a delegated data attribute (client/core.js listens)', () => {
  const html = fs.readFileSync(path.join(DIST, 'en-example', 'index.html'), 'utf8');
  assert.match(html, /<button type="button" class="wordmark" data-tab-go=""/, 'the wordmark: the default tab');
  assert.equal([...html.matchAll(/<button type="button" id="t-[a-z]+" data-tab-go="[a-z]+"/g)].length, 4, 'the dock tabs');
  assert.match(html, /<button type="button" class="cta eat-link" data-tab-go="nutricion">/, 'the eat card link');
  assert.match(html, /<button (?:type="button" )?class="lnk" data-jump="acc-anclaje">/, 'the Tablas note link (the example plan-data note still writes the legacy onclick: rewritten at build)');
});
