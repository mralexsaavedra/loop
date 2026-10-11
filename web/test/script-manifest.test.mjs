/* The client script manifest (web/src/client/manifest.mjs) is the ONE list of the page's classic
 * scripts and their order (layouts/Plan.astro renders from it). These checks keep it true:
 * - every web/src/client/*.js is listed exactly once, and the built page inlines them in that order;
 * - `provides` equals a static scan of the file (top-level declarations + `window.X =` writes);
 * - every `requires` is a bake or an EARLIER script's provide, every `probes` a LATER one's;
 * - a load-time trace (web/test/script-trace.mjs) finds no read the manifest does not declare. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CLIENT_SCRIPTS } from '../src/client/manifest.mjs';
import { slimScript } from '../src/slim-script.mjs';
import { declaredGlobals, windowWrites, traceLoad } from './script-trace.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const CLIENT = path.join(here, '..', 'src', 'client');
const PAGE = path.join(here, '..', '.test-dist', 'en-example', 'index.html');
const files = CLIENT_SCRIPTS.map((e) => e.file);
const src = Object.fromEntries(files.map((f) => [f, fs.readFileSync(path.join(CLIENT, f), 'utf8')]));
const sorted = (a) => [...new Set(a)].sort();
const inline = [...fs.readFileSync(PAGE, 'utf8').matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
const bakes = inline.slice(0, inline.length - files.length);
const providerAt = new Map();
CLIENT_SCRIPTS.forEach((e, i) => e.provides.forEach((n) => { if (!providerAt.has(n)) providerAt.set(n, i); }));

test('manifest: every web/src/client/*.js is listed exactly once', () => {
  const onDisk = fs.readdirSync(CLIENT).filter((f) => f.endsWith('.js')).sort();
  assert.deepEqual([...files].sort(), onDisk);
  assert.equal(new Set(files).size, files.length, 'no file listed twice');
});

test('manifest: the built page inlines the client scripts last, in manifest order', () => {
  const tail = inline.slice(inline.length - files.length);
  files.forEach((f, i) => assert.equal(tail[i], slimScript(src[f]), `script #${i} is ${f}`));
});

test('manifest: provides = top-level declarations + window.X writes (static scan)', () => {
  for (const e of CLIENT_SCRIPTS) {
    assert.deepEqual(sorted(e.provides), sorted([...declaredGlobals(src[e.file]), ...windowWrites(src[e.file])]), e.file);
  }
});

const { baked } = traceLoad(bakes, []);

test('manifest: requires come from a bake or an earlier script, probes from a later one', () => {
  CLIENT_SCRIPTS.forEach((e, i) => {
    for (const n of e.requires) {
      assert.ok(baked.includes(n) || providerAt.get(n) < i, `${e.file} requires ${n}: not baked nor provided earlier`);
    }
    for (const n of e.probes || []) {
      assert.ok(!baked.includes(n) && providerAt.get(n) > i, `${e.file} probes ${n}: must be provided by a later script`);
    }
  });
});

for (const hash of ['', '#profile', '#tonight', '#detail/sleep']) {
  test(`manifest: the load-time trace (hash "${hash}") reads nothing undeclared`, () => {
    const { scripts } = traceLoad(bakes, files.map((file) => ({ file, src: src[file] })), hash);
    CLIENT_SCRIPTS.forEach((e, i) => {
      const t = scripts[e.file];
      assert.equal(t.error, null, `${e.file} threw while loading`);
      for (const n of t.reads) {
        if (baked.includes(n) || providerAt.get(n) < i) assert.ok(e.requires.includes(n), `${e.file} reads ${n} at load: add it to requires`);
        else if (providerAt.get(n) > i) assert.ok((e.probes || []).includes(n), `${e.file} reads ${n} before it exists: add it to probes`);
      }
      for (const n of t.wrote) assert.ok(e.provides.includes(n), `${e.file} writes window.${n}: add it to provides`);
    });
  });
}
